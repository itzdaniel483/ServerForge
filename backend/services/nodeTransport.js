// Phase 1 node endpoint: identity/pairing only. Browser sessions and node keys never mix.
const https = require('node:https');
const { randomUUID, X509Certificate } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const NODE_PATH = '/node/v1/connect';

async function createNodeTransport({ registry, host = '127.0.0.1', port = 0, key, cert }) {
    if (!registry || !key || !cert) throw new Error('Node transport requires registry and TLS key/certificate');
    const fingerprint = new X509Certificate(cert).fingerprint256;
    const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (_req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Not found');
    });
    server.maxConnections = 256;
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
    const connections = new Set();
    const links = new Map();
    const statuses = new Map();
    const ipAttempts = new Map();
    const unauthByIp = new Map();
    let unauthCount = 0, closing = false;

    const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
    const releaseSlot = state => {
        if (!state.counted) return;
        state.counted = false;
        unauthCount--;
        const remaining = (unauthByIp.get(state.ip) || 1) - 1;
        if (remaining > 0) unauthByIp.set(state.ip, remaining); else unauthByIp.delete(state.ip);
    };
    const armTimeout = (state, ms) => {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => state.ws.terminate(), ms);
        state.timer.unref?.();
    };
    const markSeen = state => {
        if (state.nodeId && links.get(state.nodeId) === state) statuses.set(state.nodeId, { online: true, lastSeen: new Date().toISOString() });
    };
    const authenticate = (state, nodeId) => {
        if (closing || state.ws.readyState !== WebSocket.OPEN || typeof nodeId !== 'string') return;
        const previous = links.get(nodeId);
        state.stage = 'approved'; state.nodeId = nodeId;
        clearTimeout(state.timer);
        releaseSlot(state);
        links.set(nodeId, state);
        markSeen(state);
        if (previous && previous !== state) { previous.stage = 'replaced'; previous.ws.close(4001, 'Replaced by a new connection'); }
        send(state.ws, { type: 'approved', nodeId, hubId: state.hubId, capabilities: [] });
    };
    const approved = ({ candidateId, node }) => {
        for (const state of connections) {
            if (state.stage === 'pending' && state.candidateId === candidateId) authenticate(state, node.id);
        }
    };
    const removed = ({ id }) => {
        const state = links.get(id);
        if (state) {
            statuses.delete(id);
            links.delete(id);
            state.ws.terminate();
        }
        for (const candidate of connections) if (candidate.candidateId === id) candidate.ws.terminate();
    };
    registry.on('approved', approved);
    registry.on('removed', removed);

    server.on('upgrade', (req, socket, head) => {
        const refuse = (status, reason) => { socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
        if (closing || req.method !== 'GET' || req.url !== NODE_PATH) return refuse(404, 'Not Found');
        if (String(req.headers.origin || '').trim()) return refuse(403, 'Forbidden');
        const ip = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const recent = ipAttempts.get(ip);
        if (recent && now - recent.since < 60_000 && recent.count >= 10) return refuse(429, 'Too Many Requests');
        if (unauthCount >= 64 || (unauthByIp.get(ip) || 0) >= 4) return refuse(429, 'Too Many Requests');
        if (!recent || now - recent.since >= 60_000) {
            if (ipAttempts.size >= 4096) return refuse(429, 'Too Many Requests');
            ipAttempts.set(ip, { since: now, count: 1 });
        } else recent.count++;
        wss.handleUpgrade(req, socket, head, ws => {
            const state = { ws, ip, counted: true, alive: true, stage: 'new', messages: 0, messageWindow: now, queue: Promise.resolve() };
            unauthCount++; unauthByIp.set(ip, (unauthByIp.get(ip) || 0) + 1);
            connections.add(state);
            armTimeout(state, 30_000);
            ws.on('error', () => {}); // Transport errors close the link; never log credentials/payloads.
            ws.on('pong', () => { state.alive = true; markSeen(state); });
            ws.on('close', () => {
                clearTimeout(state.timer); releaseSlot(state); connections.delete(state);
                if (state.nodeId && links.get(state.nodeId) === state) {
                    links.delete(state.nodeId);
                    statuses.set(state.nodeId, { online: false, lastSeen: statuses.get(state.nodeId)?.lastSeen || null });
                }
            });
            ws.on('message', (bytes, binary) => {
                if (binary) return ws.close(1003, 'JSON text required');
                if (Date.now() - state.messageWindow >= 10_000) { state.messageWindow = Date.now(); state.messages = 0; }
                if (++state.messages > 20) return ws.close(1008, 'Message limit');
                state.queue = state.queue.then(async () => {
                    if (ws.readyState !== WebSocket.OPEN) return;
                    let msg;
                    try { msg = JSON.parse(bytes.toString()); } catch { return ws.close(1007, 'Invalid JSON'); }
                    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return ws.close(1007, 'Invalid message');
                    if (state.stage === 'approved') {
                        markSeen(state);
                        if (msg.type === 'ping') return send(ws, { type: 'pong' });
                        return send(ws, { type: 'error', code: 'ACTION_UNSUPPORTED', message: 'Node actions are not enabled' });
                    }
                    if (state.stage === 'new' && (msg.type === 'pair' || msg.type === 'hello')) {
                        let identity;
                        state.sessionId = randomUUID();
                        if (msg.type === 'pair') {
                            identity = await registry.beginPair({ code: msg.code, publicKey: msg.publicKey, name: msg.name, os: msg.os, version: msg.version });
                            state.candidateId = identity.id;
                            state.candidateExpiresAt = identity.expiresAt;
                        } else {
                            if (typeof msg.nodeId !== 'string' || msg.nodeId.length > 128) throw new Error('Invalid node identity');
                            identity = { id: msg.nodeId };
                        }
                        const challenge = await registry.createChallenge({ ...(state.candidateId ? { candidateId: identity.id } : { nodeId: identity.id }), sessionId: state.sessionId });
                        state.hubId = challenge.hubId;
                        state.challengeId = challenge.id;
                        state.stage = 'challenge';
                        send(ws, { ...challenge, type: 'challenge' });
                        return;
                    }
                    if (state.stage === 'challenge' && msg.type === 'proof') {
                        if (msg.challengeId !== state.challengeId || typeof msg.signature !== 'string' || msg.signature.length > 2048) throw new Error('Invalid proof');
                        const result = await registry.prove(msg.challengeId, msg.signature);
                        if (ws.readyState !== WebSocket.OPEN) return;
                        if (result.kind === 'approved') return authenticate(state, result.id);
                        if (result.kind !== 'pending' || !state.candidateId || result.id !== state.candidateId) throw new Error('Invalid proof state');
                        state.stage = 'pending';
                        const expiresAt = state.candidateExpiresAt ?? result.expiresAt;
                        const remaining = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 600_000;
                        armTimeout(state, Number.isFinite(remaining) ? Math.max(1, Math.min(600_000, remaining)) : 1);
                        send(ws, { type: 'pending', candidateId: state.candidateId });
                        return;
                    }
                    send(ws, { type: 'error', code: 'ACTION_UNSUPPORTED', message: 'Unexpected node message' });
                    ws.close(1008, 'Unexpected node message');
                }).catch(() => {
                    send(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Node authentication failed' });
                    ws.close(1008, 'Authentication failed');
                });
            });
        });
    });

    const heartbeat = setInterval(() => {
        const now = Date.now();
        for (const [ip, attempt] of ipAttempts) if (now - attempt.since >= 60_000) ipAttempts.delete(ip);
        for (const state of connections) {
            if (!state.alive) { state.ws.terminate(); continue; }
            state.alive = false;
            if (state.ws.readyState === WebSocket.OPEN) state.ws.ping();
        }
    }, 30_000);
    heartbeat.unref?.();

    const close = async () => {
        if (closing) return;
        closing = true;
        clearInterval(heartbeat);
        registry.off('approved', approved); registry.off('removed', removed);
        for (const state of connections) { clearTimeout(state.timer); state.ws.terminate(); }
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
    };
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => { server.off('error', reject); resolve(); });
        });
    } catch (err) { await close(); throw err; }
    return {
        server, close, fingerprint,
        hubUrl: `wss://${host.includes(':') ? `[${host}]` : host}:${server.address().port}${NODE_PATH}`,
        listStatus() {
            const result = {};
            for (const node of registry.list()) result[node.id] = { online: false, lastSeen: null };
            for (const [id, status] of statuses) result[id] = { ...status };
            return result;
        },
    };
}

module.exports = { createNodeTransport };

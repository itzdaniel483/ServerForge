// Authenticated node link. Browser sessions and node keys never mix.
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { randomUUID, X509Certificate } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { ACTIONS, sendPacket, createDecoder } = require('./nodeProtocol');

const NODE_PATH = '/node/v1/connect';
const allowedActions = new Set(ACTIONS);
const readActions = new Set(['servers.list', 'host', 'catalog', 'server.status', 'console.read', 'files.read', 'backups.list',
    'tasks.list', 'settings.read', 'cache.list', 'cache.status', 'templates.list', 'templates.read']);
const streamEvents = new Set(['server-log', 'server-status', 'server-stats', 'server-query', 'install-log', 'cache-download', 'update-log', 'update-complete']);
const rpcError = (message, status, code) => Object.assign(new Error(message), { status, code });

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
    const snapshots = new Map();
    const events = new EventEmitter();
    const ipAttempts = new Map();
    const unauthByIp = new Map();
    let unauthCount = 0, closing = false;

    const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) sendPacket(ws, value); };
    const failPending = state => {
        for (const request of state.pending.values()) {
            clearTimeout(request.timer);
            request.reject(rpcError(request.mutating ? 'Node disconnected; mutation outcome is unknown' : 'Node is offline', 503,
                request.mutating ? 'OUTCOME_UNKNOWN' : 'NODE_OFFLINE'));
        }
        state.pending.clear();
    };
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
        if (previous && previous !== state) { previous.stage = 'replaced'; failPending(previous); previous.decoder?.close(); previous.ws.close(4001, 'Replaced by a new connection'); }
        send(state.ws, { type: 'approved', nodeId, hubId: state.hubId, capabilities: [] });
    };
    const approved = ({ candidateId, node }) => {
        for (const state of connections) {
            if (state.stage === 'pending' && state.candidateId === candidateId) authenticate(state, node.id);
        }
    };
    const removed = ({ id }) => {
        const state = links.get(id);
        snapshots.delete(id);
        statuses.delete(id);
        if (state) {
            failPending(state);
            state.decoder?.close();
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
            const state = { ws, ip, counted: true, alive: true, stage: 'new', messages: 0, bytes: 0, messageWindow: now,
                queue: Promise.resolve(), pending: new Map(), actions: new Set() };
            state.decoder = createDecoder(msg => {
                if (state.stage !== 'approved' || links.get(state.nodeId) !== state) return;
                markSeen(state);
                if (msg.type === 'ping') return send(ws, { type: 'pong' });
                if (msg.type === 'capabilities') {
                    if (!Array.isArray(msg.actions) || msg.actions.length > ACTIONS.length || msg.actions.some(action => !allowedActions.has(action))) throw new Error('Invalid node capabilities');
                    state.actions = new Set(msg.actions);
                    events.emit('capabilities', { nodeId: state.nodeId, actions: [...state.actions] });
                    return;
                }
                if (msg.type === 'rpc.response') {
                    if (typeof msg.id !== 'string' || msg.id.length > 128) throw new Error('Invalid RPC response');
                    const request = state.pending.get(msg.id);
                    if (!request) return; // Timed-out or previous-session responses never resolve a new request.
                    if (!Number.isInteger(msg.status) || msg.status < 100 || msg.status > 599 || !Object.hasOwn(msg, 'body')) throw new Error('Invalid RPC response');
                    clearTimeout(request.timer); state.pending.delete(msg.id);
                    request.resolve({ status: msg.status, body: msg.body });
                    return;
                }
                if (msg.type === 'snapshot') {
                    const data = msg.data;
                    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.servers) || data.servers.length > 1000 ||
                        !data.host || typeof data.host !== 'object' || Array.isArray(data.host) ||
                        (data.catalog && (!Array.isArray(data.catalog.games) || data.catalog.games.length > 1000 || typeof data.catalog.platform !== 'string'))) throw new Error('Invalid node snapshot');
                    snapshots.set(state.nodeId, structuredClone(data));
                    events.emit('snapshot', { nodeId: state.nodeId, data: structuredClone(data) });
                    return;
                }
                if (msg.type === 'stream') {
                    const serverRequired = /^(server-|update-)/.test(msg.event);
                    if (!streamEvents.has(msg.event) || (serverRequired && msg.serverId === undefined) ||
                        (msg.serverId !== undefined && (typeof msg.serverId !== 'string' || !/^[\w.-]{1,128}$/.test(msg.serverId))) ||
                        (msg.event === 'cache-download' && !/^\d{1,12}$/.test(String(msg.appId))) ||
                        (msg.appId !== undefined && (typeof msg.appId !== 'string' || !/^\d{1,12}$/.test(msg.appId)))) throw new Error('Invalid node stream');
                    events.emit('stream', { nodeId: state.nodeId, event: msg.event, serverId: msg.serverId, ...(msg.appId !== undefined ? { appId: msg.appId } : {}), data: msg.data });
                    return;
                }
                send(ws, { type: 'error', code: 'ACTION_UNSUPPORTED', message: 'Unsupported node packet' });
            }, { onError: () => ws.close(1008, 'Invalid packet assembly') });
            unauthCount++; unauthByIp.set(ip, (unauthByIp.get(ip) || 0) + 1);
            connections.add(state);
            armTimeout(state, 30_000);
            ws.on('error', () => {}); // Transport errors close the link; never log credentials/payloads.
            ws.on('pong', () => { state.alive = true; markSeen(state); });
            ws.on('close', () => {
                clearTimeout(state.timer); releaseSlot(state); connections.delete(state);
                state.decoder.close(); failPending(state);
                if (state.nodeId && links.get(state.nodeId) === state) {
                    links.delete(state.nodeId);
                    statuses.set(state.nodeId, { online: false, lastSeen: statuses.get(state.nodeId)?.lastSeen || null });
                }
            });
            ws.on('message', (bytes, binary) => {
                if (binary) return ws.close(1003, 'JSON text required');
                if (Date.now() - state.messageWindow >= 10_000) { state.messageWindow = Date.now(); state.messages = 0; state.bytes = 0; }
                state.bytes += bytes.length;
                if (++state.messages > (state.stage === 'approved' ? 4096 : 20) || state.bytes > (state.stage === 'approved' ? 32 * 1024 * 1024 : 1024 * 1024)) return ws.close(1008, 'Message limit');
                state.queue = state.queue.then(async () => {
                    if (ws.readyState !== WebSocket.OPEN) return;
                    let msg;
                    try { msg = JSON.parse(bytes.toString()); } catch { return ws.close(1007, 'Invalid JSON'); }
                    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return ws.close(1007, 'Invalid message');
                    if (state.stage === 'approved') {
                        return state.decoder.accept(bytes);
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
        for (const state of connections) { clearTimeout(state.timer); failPending(state); state.decoder.close(); state.ws.terminate(); }
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
        server, close, fingerprint, events,
        getSnapshot(nodeId) { return snapshots.has(nodeId) ? structuredClone(snapshots.get(nodeId)) : null; },
        getCapabilities(nodeId) { return [...(links.get(nodeId)?.actions || [])]; },
        async request(nodeId, action, params, actor, { mutating = false, timeoutMs = 30000, operationId } = {}) {
            if (!allowedActions.has(action)) throw rpcError('Unsupported node action', 501, 'ACTION_UNSUPPORTED');
            const state = links.get(nodeId);
            if (!state || state.stage !== 'approved' || state.ws.readyState !== WebSocket.OPEN) throw rpcError('Node is offline', 503, 'NODE_OFFLINE');
            if (!state.actions.has(action)) throw rpcError('Node does not support this action', 501, 'ACTION_UNSUPPORTED');
            if (state.pending.size >= 32) throw rpcError('Too many node requests', 429, 'NODE_BUSY');
            if (!params || typeof params !== 'object' || Array.isArray(params) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 1800000 ||
                (operationId !== undefined && (typeof operationId !== 'string' || !/^[\w-]{1,128}$/.test(operationId)))) throw rpcError('Invalid node RPC request', 400, 'NODE_REQUEST_INVALID');
            const username = typeof actor === 'string' ? actor : actor?.username;
            if (typeof username !== 'string' || username.length < 1 || username.length > 128 || /[\x00-\x1f\x7f]/.test(username)) throw rpcError('Invalid RPC actor', 400, 'NODE_REQUEST_INVALID');
            const actorIdentity = typeof actor === 'string' ? actor : { username, ...(typeof actor.id === 'string' ? { id: actor.id.slice(0, 128) } : {}), ...(typeof actor.role === 'string' ? { role: actor.role.slice(0, 32) } : {}) };
            const id = randomUUID();
            const changesState = mutating || !readActions.has(action);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    state.pending.delete(id);
                    reject(rpcError(changesState ? 'Node request timed out; mutation outcome is unknown' : 'Node request timed out', 504,
                        changesState ? 'OUTCOME_UNKNOWN' : 'NODE_OFFLINE'));
                }, timeoutMs);
                timer.unref?.();
                state.pending.set(id, { resolve, reject, timer, mutating: changesState });
                try { sendPacket(state.ws, { type: 'rpc.request', id, action, params, actor: actorIdentity,
                    ...(changesState ? { operationId: operationId || id } : operationId ? { operationId } : {}) }); }
                catch (err) { clearTimeout(timer); state.pending.delete(id); reject(rpcError(err.message, 503, changesState ? 'OUTCOME_UNKNOWN' : 'NODE_OFFLINE')); }
            });
        },
        hubUrl: `wss://${host.includes(':') ? `[${host}]` : host}:${server.address().port}${NODE_PATH}`,
        listStatus() {
            const result = {};
            for (const node of registry.list()) result[node.id] = { online: false, lastSeen: null };
            for (const [id, status] of statuses) result[id] = { ...status, actions: [...(links.get(id)?.actions || [])], ...(links.has(id) ? { nodeHost: links.get(id).ip } : {}) };
            return result;
        },
    };
}

module.exports = { createNodeTransport };

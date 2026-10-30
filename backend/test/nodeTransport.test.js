const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const https = require('node:https');
const tls = require('node:tls');
const { EventEmitter, once } = require('node:events');
const { randomUUID, generateKeyPairSync, sign, verify, X509Certificate } = require('node:crypto');
const WebSocket = require('ws');
const { createNodeTransport } = require('../services/nodeTransport');

class Registry extends EventEmitter {
    constructor() { super(); this.nodes = new Map(); this.pending = new Map(); this.challenges = new Map(); this.hubId = randomUUID(); }
    beginPair({ code, publicKey, name, os, version }) {
        if (code !== 'one-time-code') throw new Error('Invalid code');
        const candidate = { id: randomUUID(), publicKey, name, os, version, expiresAt: new Date(Date.now() + 600_000).toISOString() };
        this.pending.set(candidate.id, candidate);
        return { ...candidate, fingerprint: 'candidate-fingerprint' };
    }
    createChallenge({ candidateId, nodeId, sessionId }) {
        const identityId = candidateId || nodeId;
        if (!this.pending.has(identityId) && !this.nodes.has(identityId)) throw new Error('Unknown node');
        const challenge = { id: randomUUID(), hubId: this.hubId, identityId, fingerprint: 'candidate-fingerprint', sessionId, nonce: randomUUID(), expiresAt: new Date(Date.now() + 30_000).toISOString() };
        this.challenges.set(challenge.id, challenge);
        return challenge;
    }
    prove(id, signature) {
        const challenge = this.challenges.get(id);
        this.challenges.delete(id);
        const candidate = this.pending.get(challenge.identityId) || this.nodes.get(challenge.identityId);
        if (!verify(null, Buffer.from(payload(challenge)), candidate.publicKey, Buffer.from(signature, 'base64'))) throw new Error('Bad proof');
        return { kind: this.nodes.has(candidate.id) ? 'approved' : 'pending', id: candidate.id, expiresAt: candidate.expiresAt };
    }
    approve(id) {
        const node = this.pending.get(id); this.pending.delete(id); this.nodes.set(id, node);
        this.emit('approved', { candidateId: id, node });
    }
    remove(id) { this.nodes.delete(id); this.emit('removed', { id }); }
    list() { return [...this.nodes.values()].map(({ id }) => ({ id })); }
    listPending() { return [...this.pending.values()]; }
}
const payload = c => JSON.stringify(['serverforge-node-v1', c.hubId, c.identityId, c.fingerprint, c.sessionId, c.nonce]);
const keys = () => generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const receive = ws => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for node message')); }, 3000);
    const message = bytes => { cleanup(); resolve(JSON.parse(bytes.toString())); };
    const error = err => { cleanup(); reject(err); };
    const cleanup = () => { clearTimeout(timer); ws.off('message', message); ws.off('error', error); };
    ws.once('message', message); ws.once('error', error);
});
const sendReceive = (ws, msg) => { const reply = receive(ws); ws.send(JSON.stringify(msg)); return reply; };

let directory, cert, key;
test.before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-node-transport-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem')], { stdio: 'ignore' });
    key = await fs.readFile(path.join(directory, 'key.pem')); cert = await fs.readFile(path.join(directory, 'cert.pem'));
});
test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() {
    const registry = new Registry();
    const transport = await createNodeTransport({ registry, host: '127.0.0.1', port: 0, cert, key });
    const clients = [];
    async function connect(options = {}, suffix) {
        const ws = new WebSocket(suffix ? transport.hubUrl.replace('/node/v1/connect', suffix) : transport.hubUrl, {
            ca: cert,
            checkServerIdentity(hostname, peer) {
                const error = tls.checkServerIdentity(hostname, peer);
                return error || (peer.fingerprint256 !== transport.fingerprint ? new Error('TLS fingerprint mismatch') : undefined);
            },
            ...options,
        });
        clients.push(ws);
        await once(ws, 'open'); return ws;
    }
    return { registry, transport, connect, async close() { for (const ws of clients) ws.terminate(); await transport.close(); } };
}
async function pair(f, pairKeys = keys()) {
    const ws = await f.connect();
    const challenge = await sendReceive(ws, { type: 'pair', code: 'one-time-code', publicKey: pairKeys.publicKey, name: 'Test node', os: 'linux', version: '1' });
    assert.equal(challenge.type, 'challenge');
    const pending = await sendReceive(ws, { type: 'proof', challengeId: challenge.id, signature: sign(null, Buffer.from(payload(challenge)), pairKeys.privateKey).toString('base64') });
    assert.equal(pending.type, 'pending');
    const approved = receive(ws); f.registry.approve(pending.candidateId);
    const result = await approved;
    assert.deepEqual(result, { type: 'approved', nodeId: pending.candidateId, hubId: f.registry.hubId, capabilities: [] });
    return { ws, nodeId: pending.candidateId, pairKeys };
}

test('TLS-only endpoint pairs, waits approval, reconnects, replaces and revokes links', async () => {
    const f = await fixture();
    try {
        assert.equal(f.transport.fingerprint, new X509Certificate(cert).fingerprint256);
        const { ws, nodeId, pairKeys } = await pair(f);
        const status = f.transport.listStatus()[nodeId];
        assert.equal(status.online, true); assert.ok(status.lastSeen);
        assert.equal(JSON.stringify(f.transport.listStatus()).includes(pairKeys.publicKey), false);
        const unsupported = await sendReceive(ws, { type: 'command', command: 'shutdown' });
        assert.equal(unsupported.code, 'ACTION_UNSUPPORTED');
        const replacement = await f.connect();
        const challenge = await sendReceive(replacement, { type: 'hello', nodeId });
        const oldClosed = once(ws, 'close');
        const approved = await sendReceive(replacement, { type: 'proof', challengeId: challenge.id, signature: sign(null, Buffer.from(payload(challenge)), pairKeys.privateKey).toString('base64') });
        assert.equal(approved.type, 'approved');
        assert.equal((await oldClosed)[0], 4001);
        assert.equal(f.transport.listStatus()[nodeId].online, true);
        const closed = once(replacement, 'close'); f.registry.remove(nodeId); await closed;
        assert.notEqual(f.transport.listStatus()[nodeId]?.online, true);
    } finally { await f.close(); }
});

test('strict path, no browser Origin, HTTP404, and TLS pin mismatch are rejected', async () => {
    const f = await fixture();
    try {
        await assert.rejects(f.connect({ origin: 'https://panel.example' }), /403/);
        await assert.rejects(f.connect({}, '/node/v1/connect?token=bad'), /404/);
        await assert.rejects(f.connect({ checkServerIdentity: () => new Error('TLS fingerprint mismatch') }), /fingerprint mismatch/);
        const status = await new Promise((resolve, reject) => {
            const request = https.get(f.transport.hubUrl.replace('wss:', 'https:'), { ca: cert }, res => { res.resume(); resolve(res.statusCode); });
            request.on('error', reject);
        });
        assert.equal(status, 404);
    } finally { await f.close(); }
});

test('proof for another connection challenge is refused and unauthenticated sockets are capped', async () => {
    const f = await fixture();
    try {
        const pairKeys = keys();
        const first = await f.connect(); const second = await f.connect();
        const request = { type: 'pair', code: 'one-time-code', publicKey: pairKeys.publicKey, name: 'Test', os: 'linux', version: '1' };
        const a = await sendReceive(first, request); const b = await sendReceive(second, request);
        const error = await sendReceive(first, { type: 'proof', challengeId: b.id, signature: sign(null, Buffer.from(payload(b)), pairKeys.privateKey).toString('base64') });
        assert.equal(error.code, 'AUTH_FAILED');
        assert.notEqual(a.id, b.id);
        await once(first, 'close');
        await f.connect(); await f.connect(); await f.connect();
        await assert.rejects(f.connect(), /429/);
    } finally { await f.close(); }
});

test('oversized and binary messages are rejected without exposing actions', async () => {
    const f = await fixture();
    try {
        const big = await f.connect(); const closed = once(big, 'close');
        big.send('x'.repeat(65 * 1024));
        assert.equal((await closed)[0], 1009);
        const binary = await f.connect(); const binaryClosed = once(binary, 'close');
        binary.send(Buffer.from('{}'));
        assert.equal((await binaryClosed)[0], 1003);
    } finally { await f.close(); }
});

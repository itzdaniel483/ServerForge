const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const WebSocket = require('ws');
const { NodeRegistry, challengePayload } = require('../services/nodeRegistry');
const { createNodeTransport } = require('../services/nodeTransport');
const { sendPacket, createDecoder, MAX_PACKET_BYTES } = require('../services/nodeProtocol');

const frames = object => {
    const sent = [];
    sendPacket({ readyState: 1, send: value => sent.push(value) }, object);
    return sent;
};

test('packet codec round-trips Unicode files via bounded frames, rejecting malformed and excessive assemblies', () => {
    const object = { type: 'rpc.response', id: 'request', status: 200, body: { content: '😀'.repeat(35000) } };
    const chunks = frames(object);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(raw => Buffer.byteLength(raw) < 64 * 1024 && JSON.parse(raw).data.length <= 32768));
    const packets = [];
    const decoder = createDecoder(packet => packets.push(packet));
    for (const chunk of chunks.toReversed()) decoder.accept(chunk);
    assert.deepEqual(packets, [object]);
    decoder.accept(JSON.stringify({ type: 'ping' }));
    assert.deepEqual(packets[1], { type: 'ping' });
    assert.throws(() => frames({ content: 'x'.repeat(MAX_PACKET_BYTES) }), /8 MiB/);
    decoder.accept(chunks[0]);
    assert.throws(() => decoder.accept(chunks[0]), /Conflicting/);
    for (let i = 0; i < 4; i++) decoder.accept(JSON.stringify({ type: 'packet.chunk', id: `packet-${i}`, index: 0, total: 2, data: 'e30=' }));
    assert.throws(() => decoder.accept(JSON.stringify({ type: 'packet.chunk', id: 'fifth', index: 0, total: 2, data: 'e30=' })), /Too many/);
    decoder.close();
    assert.throws(() => decoder.accept('{}'), /closed/);
});

test('partial packets expire and release their bounded assembly slots', async () => {
    const errors = [];
    const decoder = createDecoder(() => {}, { ttlMs: 15, onError: error => errors.push(error) });
    const chunk = id => JSON.stringify({ type: 'packet.chunk', id, index: 0, total: 2, data: 'e30=' });
    try {
        for (let i = 0; i < 4; i++) decoder.accept(chunk(`old-${i}`));
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(errors.length, 4);
        assert.doesNotThrow(() => decoder.accept(chunk('new')));
        assert.throws(() => decoder.accept(JSON.stringify({ type: 'packet.chunk', id: 'bad', index: 0, total: 2, data: '!!!!' })), /Invalid node chunk/);
    } finally { decoder.close(); }
});

let tlsDirectory, key, cert;
test.before(() => {
    tlsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rpc-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
        '-keyout', path.join(tlsDirectory, 'key.pem'), '-out', path.join(tlsDirectory, 'cert.pem')], { stdio: 'ignore' });
    key = fs.readFileSync(path.join(tlsDirectory, 'key.pem')); cert = fs.readFileSync(path.join(tlsDirectory, 'cert.pem'));
});
test.after(() => fs.rmSync(tlsDirectory, { recursive: true, force: true }));

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rpc-'));
    const registry = new NodeRegistry({ dataDir: dir });
    const transport = await createNodeTransport({ registry, key, cert });
    const keys = crypto.generateKeyPairSync('ed25519');
    const enrol = registry.createEnrolment({ hubUrl: transport.hubUrl, hubFingerprint: transport.fingerprint });
    const candidate = registry.beginPair({ code: enrol.code, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), name: 'RPC test', os: 'linux', version: '1' });
    const proof = registry.createChallenge({ candidateId: candidate.id, sessionId: 'setup' });
    registry.prove(proof.id, crypto.sign(null, Buffer.from(challengePayload(proof)), keys.privateKey).toString('base64'));
    const node = registry.approve(candidate.id, { fingerprintConfirmed: true });
    const clients = [];
    async function connect(actions = ['files.read', 'power.start', 'servers.list']) {
        const ws = new WebSocket(transport.hubUrl, { rejectUnauthorized: false });
        clients.push(ws);
        const bus = new EventEmitter();
        bus.on('error', () => {}); // Protocol error packets are values, not uncaught emitter errors.
        const decoder = createDecoder(packet => bus.emit(packet.type, packet));
        ws.on('message', bytes => decoder.accept(bytes));
        ws.once('close', () => decoder.close());
        await once(ws, 'open');
        const challenge = once(bus, 'challenge');
        sendPacket(ws, { type: 'hello', nodeId: node.id });
        const [packet] = await challenge;
        const approved = once(bus, 'approved');
        sendPacket(ws, { type: 'proof', challengeId: packet.id, signature: crypto.sign(null, Buffer.from(challengePayload(packet)), keys.privateKey).toString('base64') });
        await approved;
        const capabilities = once(transport.events, 'capabilities');
        sendPacket(ws, { type: 'capabilities', actions });
        await capabilities;
        return { ws, bus };
    }
    t.after(async () => { for (const ws of clients) ws.terminate(); await transport.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { transport, registry, node, connect };
}

test('approved RPC checks advertised capabilities, correlates responses, chunks files and authenticates snapshot/stream origin', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    await assert.rejects(f.transport.request(f.node.id, 'files.read', {}, 'admin'), { status: 503, code: 'NODE_OFFLINE' });
    const { ws, bus } = await f.connect();
    assert.deepEqual(f.transport.getCapabilities(f.node.id), ['files.read', 'power.start', 'servers.list']);
    await assert.rejects(f.transport.request(f.node.id, 'files.write', {}, 'admin'), { status: 501, code: 'ACTION_UNSUPPORTED' });
    await assert.rejects(f.transport.request(f.node.id, 'run-shell', {}, 'admin'), { status: 501, code: 'ACTION_UNSUPPORTED' });
    const received = once(bus, 'rpc.request');
    const result = f.transport.request(f.node.id, 'files.read', { serverId: 's1', path: 'large.cfg' }, { username: 'alice', role: 'user' });
    const [request] = await received;
    assert.equal(request.actor.username, 'alice');
    assert.equal(request.action, 'files.read');
    const content = 'config line 😀\n'.repeat(10000);
    sendPacket(ws, { type: 'rpc.response', id: 'stale-request-id', status: 200, body: 'ignored' });
    sendPacket(ws, { type: 'rpc.response', id: request.id, status: 200, body: { content } });
    assert.deepEqual(await result, { status: 200, body: { content } });
    const snapshot = once(f.transport.events, 'snapshot');
    sendPacket(ws, { type: 'snapshot', nodeId: 'forged', data: { servers: [{ id: 's1' }], host: {}, catalog: { platform: 'linux', games: [] } } });
    assert.equal((await snapshot)[0].nodeId, f.node.id);
    const copy = f.transport.getSnapshot(f.node.id); copy.servers.length = 0;
    assert.equal(f.transport.getSnapshot(f.node.id).servers.length, 1);
    const stream = once(f.transport.events, 'stream');
    sendPacket(ws, { type: 'stream', nodeId: 'forged', event: 'server-log', serverId: 's1', data: 'tick' });
    assert.deepEqual((await stream)[0], { nodeId: f.node.id, event: 'server-log', serverId: 's1', data: 'tick' });
    const closed = once(ws, 'close'); ws.close(); await closed;
    assert.equal(f.transport.getSnapshot(f.node.id).servers.length, 1, 'offline metadata retained');
    f.registry.remove(f.node.id);
    assert.equal(f.transport.getSnapshot(f.node.id), null, 'revocation drops metadata');
});

test('timeouts, replacement and revocation never replay mutations or accept stale-session replies', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const first = await f.connect();
    const receive = once(first.bus, 'rpc.request');
    const pending = f.transport.request(f.node.id, 'power.start', { serverId: 's1' }, 'admin', { timeoutMs: 30, operationId: 'op-one' });
    const rejection = assert.rejects(pending, { status: 504, code: 'OUTCOME_UNKNOWN' });
    const [old] = await receive;
    assert.equal(old.operationId, 'op-one');
    await rejection;
    sendPacket(first.ws, { type: 'rpc.response', id: old.id, status: 200, body: {} });
    const nextReceived = once(first.bus, 'rpc.request');
    const mutate = f.transport.request(f.node.id, 'power.start', {}, 'admin');
    const unknown = assert.rejects(mutate, { status: 503, code: 'OUTCOME_UNKNOWN' });
    const [generated] = await nextReceived;
    assert.equal(generated.operationId, generated.id, 'each dispatched mutation receives a stable journal ID');
    const second = await f.connect();
    await unknown;
    let replayed = false; second.bus.on('rpc.request', () => { replayed = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(replayed, false);
    const read = f.transport.request(f.node.id, 'servers.list', {}, 'admin');
    const offline = assert.rejects(read, { status: 503, code: 'NODE_OFFLINE' });
    f.registry.remove(f.node.id);
    await offline;
    await assert.rejects(f.transport.request(f.node.id, 'power.start', {}, 'admin'), { status: 503, code: 'NODE_OFFLINE' });
});

test('RPC pending limits and invalid stream addresses are enforced', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const { ws } = await f.connect();
    const requests = Array.from({ length: 32 }, () => f.transport.request(f.node.id, 'servers.list', {}, 'admin').catch(error => error));
    await assert.rejects(f.transport.request(f.node.id, 'servers.list', {}, 'admin'), { status: 429, code: 'NODE_BUSY' });
    const closed = once(ws, 'close');
    sendPacket(ws, { type: 'stream', event: 'server-log', serverId: '../../escape', data: 'bad' });
    await closed;
    for (const result of await Promise.all(requests)) assert.equal(result.code, 'NODE_OFFLINE');
});

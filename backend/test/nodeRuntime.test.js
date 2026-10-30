const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { EventEmitter } = require('node:events');
const { createNodeRuntime, localApiTarget } = require('../services/nodeRuntime');
const { ACTIONS, getLocalRequest, classifyRemoteRequest } = require('../services/nodeActions');
const actor = { id: 'hub-user-1', username: 'operator', role: 'admin' };
const credentials = () => ({ id: 'local-admin', username: 'admin', role: 'admin', sessionVersion: 3, secret: 'test-runtime-secret-'.repeat(3) });
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sf-runtime-'));
const result = body => ({ status: 200, body });

test('named actions round-trip and reject arbitrary URL/action/native IDs', () => {
    assert.deepEqual(new Set(ACTIONS), new Set(require('../services/nodeProtocol').ACTIONS));
    assert.deepEqual(getLocalRequest('power.start', { serverId: 'native-1', url: 'http://bad/' }), { method: 'POST', path: '/api/server/start', body: { id: 'native-1' } });
    assert.deepEqual(classifyRemoteRequest('POST', '/api/server/stop', { id: 'native-1', nodeId: 'remote' }), { action: 'power.stop', params: { serverId: 'native-1' } });
    assert.deepEqual(classifyRemoteRequest('GET', '/api/server/native-1/files', {}, { path: 'cfg/server.cfg', node: 'remote' }), { action: 'files.read', params: { serverId: 'native-1', path: 'cfg/server.cfg' } });
    assert.equal(classifyRemoteRequest('POST', '/api/settings', { authMode: 'external' }), null);
    for (const id of ['local:native', '../native', '%2f', '__proto__']) assert.throws(() => getLocalRequest('server.status', { serverId: id }), /Invalid native/);
    assert.throws(() => getLocalRequest('http://localhost/'), { code: 'ACTION_UNSUPPORTED' });
    assert.throws(() => getLocalRequest('cache.status', { appId: '../1' }), /Invalid app/);
    assert.throws(() => getLocalRequest('backups.delete', { serverId: 'one', filename: '../../private' }), /Invalid backup/);
    assert.throws(() => getLocalRequest('templates.write', { gameId: '__proto__', templateName: 'x' }), /Invalid native/);
});

test('local API origin is fixed to machine addresses and never resolves arbitrary DNS', () => {
    assert.equal(localApiTarget('http://localhost:3230/'), 'http://127.0.0.1:3230');
    assert.equal(localApiTarget('http://[::1]:3230'), 'http://[::1]:3230');
    for (const url of ['http://192.0.2.99:3230', 'http://evil.test:3230', 'http://localhost.evil.test', 'file:///etc/passwd', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/api/settings']) assert.throws(() => localApiTarget(url));
});

test('runtime signs fresh local admin tokens with hub actor and strips snapshot secrets', async () => {
    const dir = temporary();
    const secret = 'runtime-test-secret-'.repeat(3);
    fs.writeFileSync(path.join(dir, 'jwt-secret'), secret);
    const saveAdmin = version => fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'local-admin', username: 'admin', role: 'admin', passwordHash: 'never-forward', sessionVersion: version }]));
    const tokens = [];
    saveAdmin(1);
    const runtime = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', fetchImpl: async (url, options) => {
        assert.equal(options.redirect, 'error');
        assert.ok(url.startsWith('http://127.0.0.1:3230/api/'));
        const token = jwt.verify(options.headers.Authorization.slice(7), secret);
        tokens.push(token);
        assert.equal(token.role, 'admin');
        assert.ok(token.exp - token.iat <= 60);
        if (url.endsWith('/api/servers')) return new Response(JSON.stringify([{ id: 'one', name: 'Test', status: 'running', rconPassword: 'rcon-secret', path: '/private', env: { API_KEY: 'secret' }, vars: { password: 'secret' }, owner: 'not-hub', access: [{ username: 'intruder' }] }]));
        if (url.endsWith('/api/host')) return new Response(JSON.stringify({ cpuPercent: 10 }));
        return new Response(JSON.stringify({ platform: 'linux', games: [] }));
    } });
    try {
        const list = await runtime.handle('servers.list', {}, actor);
        assert.deepEqual(list.body, [{ id: 'one', name: 'Test', status: 'running' }]);
        assert.deepEqual(tokens[0].hubActor, { id: actor.id, username: actor.username });
        saveAdmin(2);
        const snapshot = await runtime.snapshot();
        assert.deepEqual(snapshot.servers, list.body);
        assert.deepEqual(snapshot.host, { cpuPercent: 10 });
        assert.equal(typeof snapshot.nodeHost, 'string');
        assert.ok(tokens.slice(1).every(token => token.sessionVersion === 2));
        assert.equal(JSON.stringify(snapshot).includes('secret'), false);
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mutation journal deduplicates, detects conflicts, and never replays a crash-pending operation', async () => {
    const dir = temporary();
    let calls = 0, release;
    const runtime = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', requestImpl: async () => {
        calls++;
        const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'node-operations.json')));
        assert.equal(persisted['operation-one'].state, 'pending', 'journal must precede dispatch');
        await new Promise(resolve => { release = resolve; });
        return result({ success: true });
    } });
    try {
        const first = runtime.handle('power.start', { serverId: 'one' }, actor, 'operation-one');
        const second = runtime.handle('power.start', { serverId: 'one' }, actor, 'operation-one');
        assert.equal(calls, 1);
        release();
        assert.deepEqual(await first, await second);
        assert.deepEqual(await runtime.handle('power.start', { serverId: 'one' }, actor, 'operation-one'), result({ success: true }));
        assert.equal(calls, 1);
        await assert.rejects(runtime.handle('power.stop', { serverId: 'one' }, actor, 'operation-one'), { code: 'OPERATION_CONFLICT' });
        assert.equal(fs.statSync(path.join(dir, 'node-operations.json')).mode & 0o777, 0o600);
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'node-operations.json')));
        saved['operation-one'].state = 'pending'; delete saved['operation-one'].result;
        fs.writeFileSync(path.join(dir, 'node-operations.json'), JSON.stringify(saved));
        const restarted = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', requestImpl: async () => { throw new Error('must not replay'); } });
        try {
            assert.equal((await restarted.handle('power.start', { serverId: 'one' }, actor, 'operation-one')).body.code, 'OUTCOME_UNKNOWN');
        } finally { restarted.close(); }
        fs.writeFileSync(path.join(dir, 'node-operations.json'), 'broken');
        assert.throws(() => createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230' }), { code: 'OUTCOME_UNKNOWN' });
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('request and response limits fail safely without unbounded buffering', async () => {
    const dir = temporary();
    let calls = 0;
    const runtime = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', credentials, fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify({ content: 'x'.repeat(8 * 1024 * 1024) }));
    } });
    try {
        await assert.rejects(runtime.handle('files.read', { serverId: 'one', path: 'x.txt' }, actor), { code: 'PAYLOAD_TOO_LARGE' });
        const local = getLocalRequest('files.write', { serverId: 'one', path: 'x', content: 'x'.repeat(5 * 1024 * 1024 + 1) });
        await assert.rejects(runtime.request(local, actor), { code: 'PAYLOAD_TOO_LARGE' });
        assert.equal(calls, 1);
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stream bridge watches native servers and forwards only fixed event shapes', async () => {
    const dir = temporary();
    class Socket extends EventEmitter {
        onAny(callback) { this.callback = callback; }
        deliver(event, data) { this.callback(event, data); }
        disconnect() { this.disconnected = true; }
    }
    const socket = new Socket();
    const watched = [];
    socket.on('watch', id => watched.push(id));
    const runtime = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', socketFactory: () => socket, requestImpl: async local => result(local.path === '/api/servers' ? [{ id: 'one', name: 'One' }] : {}) });
    try {
        const packets = [];
        const unsubscribe = runtime.subscribe(packet => packets.push(packet));
        await runtime.snapshot();
        assert.deepEqual(watched, ['one']);
        socket.deliver('server-log-one', 'hello');
        socket.deliver('server-log-unknown', 'no');
        socket.deliver('cache-download-730', 'cache');
        socket.deliver('install-log', 'install');
        socket.deliver('arbitrary-event', 'no');
        assert.deepEqual(packets, [{ event: 'server-log', serverId: 'one', data: 'hello' }, { event: 'cache-download', appId: '730', data: 'cache' }, { event: 'install-log', data: 'install' }]);
        unsubscribe();
        assert.equal(socket.disconnected, true);
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('console history supports the actual bounded plaintext logs endpoint', async () => {
    const dir = temporary();
    const runtime = createNodeRuntime({ dataDir: dir, localApiUrl: 'http://127.0.0.1:3230', credentials,
        fetchImpl: async () => new Response('Server started\nPlayer joined\n', { headers: { 'content-type': 'text/plain' } }) });
    try {
        assert.deepEqual(await runtime.handle('console.read', { serverId: 'one' }, actor), result('Server started\nPlayer joined\n'));
        await assert.rejects(runtime.handle('host', {}, actor), { code: 'LOCAL_PANEL_INVALID' });
    } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('malformed approved-link packets fail closed without crashing the node client', { timeout: 5000 }, async () => {
    const https = require('node:https');
    const { execFileSync } = require('node:child_process');
    const { WebSocketServer } = require('ws');
    const { X509Certificate, randomUUID } = require('node:crypto');
    const { NodeClient } = require('../services/nodeClient');
    const dir = temporary();
    let server, wss, client;
    try {
        const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
        const cert = fs.readFileSync(certFile);
        server = https.createServer({ cert, key: fs.readFileSync(keyFile) });
        wss = new WebSocketServer({ server });
        const hubId = randomUUID();
        wss.on('connection', socket => socket.once('message', () => {
            socket.send(JSON.stringify({ type: 'approved', nodeId: randomUUID(), hubId }));
            setImmediate(() => socket.send('{broken-json'));
        }));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        client = new NodeClient({ dataDir: path.join(dir, 'identity'), runtime: { capabilities: [], snapshot: async () => ({ servers: [] }), subscribe: () => () => {} } });
        const failed = new Promise(resolve => client.once('failure', resolve));
        await client.pair({ hubId, hubUrl: `wss://127.0.0.1:${server.address().port}/node/v1/connect`, hubFingerprint: new X509Certificate(cert).fingerprint256, code: 'test-code', expiresAt: Date.now() + 60000 });
        assert.equal((await failed).code, 'NODE_PROTOCOL_INVALID');
    } finally {
        client?.stop();
        if (wss) { for (const socket of wss.clients) socket.terminate(); await new Promise(resolve => wss.close(resolve)); }
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

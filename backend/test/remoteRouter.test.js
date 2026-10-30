const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { RemoteServers } = require('../services/remoteServers');
const { createRemoteRouter, uiActions } = require('../services/remoteRouter');
const NODE = '12345678-1234-1234-1234-123456789abc';

test('remote routing preserves native IDs, hub-owned ACLs and explicit offline/uncertain outcomes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-remote-router-'));
    const store = new RemoteServers({ dataDir: tmp });
    const registry = { list: () => [{ id: NODE, name: 'Other PC', os: 'win32' }] };
    store.sync(NODE, { nodeHost: '192.168.55.109', servers: [{ id: 'sameid', name: 'Remote', owner: 'player', access: [{ username: 'player', perms: ['power'] }], path: '/private', rconPassword: 'secret', status: 'stopped' }] });
    let online = true, uncertain = false;
    const calls = [];
    const transport = { listStatus: () => ({ [NODE]: { online } }), request: async (...args) => {
        calls.push(args);
        if (uncertain) throw Object.assign(new Error('Lost contact'), { status: 503, code: 'OUTCOME_UNKNOWN' });
        return { status: 200, body: { success: true } };
    } };
    let revoked = false;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] || 'admin', username: req.headers['x-user'] || 'admin', role: req.headers['x-user'] ? 'user' : 'admin' }; next(); });
    app.use('/api', createRemoteRouter({ registry, getTransport: () => transport, store,
        userStore: { getUsers: async () => [{ username: 'player', role: 'user' }] }, onAccessChanged: () => { revoked = true; } }));
    app.use((_req, res) => res.status(418).json({ error: 'Must not reach local handler' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (method, route, body, user) => {
        const result = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: result.status, body: await result.json() };
    };
    try {
        const id = `${NODE}:sameid`;
        const remote = store.get(id, registry, transport);
        assert.equal(remote.path, undefined); assert.equal(remote.rconPassword, undefined); assert.equal(remote.owner, null); assert.deepEqual(remote.access, []);
        assert.equal((await request('POST', '/api/server/start', { id }, 'player')).status, 403);
        assert.equal(calls.length, 0);
        assert.equal((await request('PUT', `/api/server/${id}/access`, { access: [{ username: 'player', perms: ['power'] }] })).status, 200);
        assert.equal((await request('POST', '/api/server/start', { id }, 'player')).status, 200);
        assert.equal(calls[0][1], 'power.start'); assert.equal(calls[0][2].serverId, 'sameid'); assert.equal(calls[0][3].username, 'player');
        assert.equal((await request('POST', `/api/server/${id}/file`, { path: 'a', content: 'b' }, 'player')).status, 403);
        assert.equal((await request('GET', `/api/server/${id}/files?path=cfg`)).status, 200);
        assert.equal(calls.at(-1)[1], 'files.read'); assert.equal(calls.at(-1)[2].path, 'cfg');
        assert.equal((await request('POST', '/api/install?node=local', { nodeId: NODE })).status, 400);
        assert.equal((await request('GET', '/api/host?node=unknown')).body.code, 'NODE_UNKNOWN');
        online = false;
        assert.equal((await request('GET', `/api/server/${id}/status`)).body.code, 'NODE_OFFLINE');
        assert.equal((await request('GET', `/api/host?node=${NODE}`, undefined, 'player')).body.cpuPercent, null);
        online = true; uncertain = true;
        const before = calls.length;
        assert.equal((await request('POST', '/api/server/start', { id })).body.code, 'OUTCOME_UNKNOWN');
        assert.equal(calls.length, before + 1);
        assert.equal((await request('PUT', `/api/server/${id}/access`, { access: [] })).status, 200);
        assert.equal(revoked, true);
        assert.equal((await request('GET', `/api/server/${id}/status`, undefined, 'player')).status, 403);
        assert.ok(uiActions(['power.start', 'power.stop']).includes('power'));
        assert.ok(!uiActions(['power.start']).includes('power'));
    } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); }
});

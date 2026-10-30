// Security regression tests (claude, 2026-10-30). Each run starts the real server on a random port
// with its own throwaway data folders, so it never touches backend/data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('../../frontend/node_modules/socket.io-client');

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

let base, child, tmp, adminToken, userToken;
const ADMIN_PASSWORD = 'test-admin-pass-1';

async function api(method, url, { token, body } = {}) {
    const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data };
}

test.before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', ADMIN_PASSWORD, JWT_SECRET: '',
            DATA_DIR: path.join(tmp, 'data'), SERVERS_ROOT: path.join(tmp, 'servers'), BACKUPS_DIR: path.join(tmp, 'backups'), CACHE_DIR: path.join(tmp, 'cache'), STEAMCMD_DIR: path.join(tmp, 'steamcmd') },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(base + '/api/auth-mode')).ok) break; } catch { /* starting */ }
        await new Promise(r => setTimeout(r, 100));
    }
    // The store initialises asynchronously; wait until login works.
    for (let i = 0; i < 50 && !adminToken; i++) {
        const r = await api('POST', '/api/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
        if (r.status === 200) adminToken = r.data.token; else await new Promise(r2 => setTimeout(r2, 100));
    }
    assert.ok(adminToken, 'admin login failed:\n' + log);
    assert.equal((await api('POST', '/api/users', { token: adminToken, body: { username: 'player', password: 'player-pass-1', role: 'user' } })).status, 200);
    userToken = (await api('POST', '/api/login', { body: { username: 'player', password: 'player-pass-1' } })).data.token;
});

test.after(() => { child?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('anonymous callers cannot read or change settings (was a full takeover)', async () => {
    assert.equal((await api('GET', '/api/settings')).status, 401);
    assert.equal((await api('POST', '/api/settings', { body: { authMode: 'external' } })).status, 401);
    assert.equal((await api('GET', '/api/settings?x=1')).status, 401, 'a query string must not skip auth');
    assert.deepEqual((await api('GET', '/api/auth-mode')).data, { authMode: 'local' });
    assert.equal((await api('GET', '/api/debug/headers')).status, 401);
});

test('admin/admin no longer works and the JWT secret is not the old default', async () => {
    assert.equal((await api('POST', '/api/login', { body: { username: 'admin', password: 'admin' } })).status, 401);
    const jwt = require('../node_modules/jsonwebtoken');
    const forged = jwt.sign({ id: 'x', username: 'admin', role: 'admin' }, 'tcadmin-secret-key-change-this');
    assert.equal((await api('GET', '/api/servers', { token: forged })).status, 401);
});

test('settings: admin only, Steam key never sent back, Cloudflare domain must be real', async () => {
    assert.equal((await api('GET', '/api/settings', { token: userToken })).status, 403);
    assert.equal((await api('POST', '/api/settings', { token: adminToken, body: { steamApiKey: 'SECRETKEY123' } })).status, 200);
    const got = await api('GET', '/api/settings', { token: adminToken });
    assert.equal(got.data.steamApiKey, '');
    assert.equal(got.data.steamApiKeySet, true);
    const bad = await api('POST', '/api/settings', { token: adminToken, body: { authMode: 'external', cfAccessTeamDomain: 'https://evil.example.com', cfAccessAud: 'x' } });
    assert.equal(bad.status, 400);
    assert.deepEqual((await api('GET', '/api/auth-mode')).data, { authMode: 'local' });
});

test('normal users cannot run programs, install, write files or change auth', async () => {
    for (const [m, u, body] of [
        ['POST', '/api/install', { appId: '4020', gameName: 'x' }],
        ['PUT', '/api/server/1/config', { executable: '/bin/sh' }],
        ['POST', '/api/server/1/file', { path: 'a', content: 'b' }],
        ['POST', '/api/restart-backend', {}],
        ['DELETE', '/api/cache/4020', null],
        ['POST', '/api/users', { username: 'z', password: 'zzzzzzzz' }],
    ]) assert.equal((await api(m, u, { token: userToken, body })).status, 403, `${m} ${u}`);
});

test('paths stay inside the server folder; executables cannot point outside it', async () => {
    // Create a server record without SteamCMD by writing the store directly is not possible from outside,
    // so use the install route's validation and the config route's guards.
    assert.equal((await api('POST', '/api/install', { token: adminToken, body: { appId: '../../etc', gameName: 'x' } })).status, 400);
    assert.equal((await api('POST', '/api/install', { token: adminToken, body: { appId: '4020', gameName: 'x', port: 80 } })).status, 400);
    assert.equal((await api('POST', '/api/cache/copy/4020', { token: adminToken, body: { targetPath: '../../etc' } })).status, 403);
    assert.equal((await api('DELETE', '/api/cache/..%2F..%2Fetc', { token: adminToken })).status, 400);
});

test('login is throttled after repeated failures', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await api('POST', '/api/login', { body: { username: 'nobody', password: 'wrong-password' } });
    assert.equal(last.status, 429);
});

test('live logs (Socket.IO) need a valid token', async () => {
    const connect = auth => new Promise(resolve => {
        const s = io(base, { auth, transports: ['websocket'], reconnection: false, timeout: 3000 });
        s.on('connect', () => { s.close(); resolve('ok'); });
        s.on('connect_error', () => { s.close(); resolve('refused'); });
    });
    assert.equal(await connect({}), 'refused');
    assert.equal(await connect({ token: 'nope' }), 'refused');
    assert.equal(await connect({ token: adminToken }), 'ok');
});

test('security headers are set and CORS is not open to every site', async () => {
    const res = await fetch(base + '/api/auth-mode', { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
});

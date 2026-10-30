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
    // A fake game server (a shell script) so access, tasks and start/stop can be tested without SteamCMD.
    const fake = path.join(tmp, 'servers', 'fake');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'run.sh'), '#!/bin/sh\nwhile true; do echo tick; sleep 1; done\n', { mode: 0o755 });
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'servers.json'), JSON.stringify([{ id: 'fake1', name: 'Fake', game: 'Test', appId: '4020', path: fake, port: 27999, rconPassword: 'r', status: 'stopped', owner: 'admin', executable: 'run.sh', args: [] },
        { id: 'half1', name: 'Half', game: 'Test', appId: '4020', path: path.join(tmp, 'servers', 'half'), port: 27998, rconPassword: 'r', status: 'installing', owner: 'admin', executable: 'run.sh', args: [] }]));
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
        ['PUT', '/api/server/fake1/config', { executable: '/bin/sh' }],
        ['POST', '/api/server/fake1/file', { path: 'a', content: 'b' }],
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

test('users only see and control servers they were given, with the chosen permissions', async () => {
    assert.deepEqual((await api('GET', '/api/servers', { token: userToken })).data, []);
    assert.equal((await api('GET', '/api/server/fake1/status', { token: userToken })).status, 403);
    assert.equal((await api('POST', '/api/server/start', { token: userToken, body: { id: 'fake1' } })).status, 403);
    assert.equal((await api('PUT', '/api/server/fake1/access', { token: userToken, body: { access: [] } })).status, 403);
    assert.equal((await api('PUT', '/api/server/fake1/access', { token: adminToken, body: { access: [{ username: 'ghost', perms: ['power'] }] } })).status, 400, 'unknown user');
    assert.equal((await api('PUT', '/api/server/fake1/access', { token: adminToken, body: { access: [{ username: 'player', perms: ['power'] }] } })).status, 200);
    const seen = (await api('GET', '/api/servers', { token: userToken })).data;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].rconPassword, undefined, 'no RCON password for users');
    assert.equal(seen[0].path, undefined, 'no host paths for users');
    assert.deepEqual(seen[0].perms.sort(), ['power', 'view']);
    assert.equal((await api('GET', '/api/server/fake1/files', { token: userToken })).status, 403, 'no files permission');
    assert.equal((await api('POST', '/api/server/start', { token: userToken, body: { id: 'fake1' } })).status, 200);
    assert.equal((await api('GET', '/api/server/fake1/status', { token: userToken })).data.status, 'running');
    assert.equal((await api('POST', '/api/server/stop', { token: userToken, body: { id: 'fake1' } })).status, 200);
    const log = (await api('GET', '/api/activity', { token: adminToken })).data;
    assert.ok(log.some(r => r.action === 'start' && r.user === 'player'), 'activity log records who started it');
});

test('scheduled tasks: admins only, sane timetables, and they actually run', async () => {
    assert.equal((await api('POST', '/api/server/fake1/tasks', { token: userToken, body: { type: 'restart', cron: '0 6 * * *' } })).status, 403);
    assert.equal((await api('POST', '/api/server/fake1/tasks', { token: adminToken, body: { type: 'restart', cron: '* * * * *' } })).status, 400, 'every minute is refused');
    assert.equal((await api('POST', '/api/server/fake1/tasks', { token: adminToken, body: { type: 'rm', cron: '0 6 * * *' } })).status, 400);
    const t = await api('POST', '/api/server/fake1/tasks', { token: adminToken, body: { type: 'start', cron: '0 6 * * *' } });
    assert.equal(t.status, 200);
    assert.equal((await api('GET', '/api/server/fake1/tasks', { token: userToken })).data.tasks.length, 1, 'users with access can see the schedule');
    const run = await api('POST', `/api/tasks/${t.data.id}/run`, { token: adminToken });
    assert.equal(run.data.ok, true);
    assert.equal((await api('GET', '/api/server/fake1/status', { token: adminToken })).data.status, 'running');
    await api('POST', '/api/server/stop', { token: adminToken, body: { id: 'fake1' } });
    assert.equal((await api('DELETE', `/api/tasks/${t.data.id}`, { token: adminToken })).status, 200);
});

test('revoking server access stops live logs on an existing socket', async () => {
    assert.equal((await api('PUT', '/api/server/fake1/access', { token: adminToken, body: { access: [{ username: 'player', perms: ['view'] }] } })).status, 200);
    const socket = io(base, { auth: { token: userToken }, transports: ['websocket'], reconnection: false });
    try {
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        const nextLog = () => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('expected live game output')), 3000);
            socket.once('server-log-fake1', () => { clearTimeout(timer); resolve(); });
        });
        socket.emit('watch', 'fake1');
        const first = nextLog();
        assert.equal((await api('POST', '/api/server/start', { token: adminToken, body: { id: 'fake1' } })).status, 200);
        await first;
        assert.equal((await api('PUT', '/api/server/fake1/access', { token: adminToken, body: { access: [] } })).status, 200);
        let leaked = false;
        socket.on('server-log-fake1', () => { leaked = true; });
        socket.emit('watch', 'fake1'); // Rejoining after revocation must also fail.
        await new Promise(resolve => setTimeout(resolve, 1300));
        assert.equal(leaked, false, 'revoked user still receives live logs');
        assert.equal((await api('GET', '/api/server/fake1/status', { token: userToken })).status, 403);
    } finally {
        socket.close();
        await api('POST', '/api/server/stop', { token: adminToken, body: { id: 'fake1' } });
    }
});

test('deleting an account disconnects its live socket and refuses its old token', async () => {
    const users = await api('GET', '/api/users', { token: adminToken });
    const user = users.data.find(user => user.username === 'player');
    const token = userToken;
    const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 3000 });
    try {
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        socket.emit('watch', 'fake1');
        const disconnected = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('deleted account socket remained connected')), 3000);
            socket.once('disconnect', reason => { clearTimeout(timer); resolve(reason); });
        });
        assert.equal((await api('DELETE', `/api/users/${user.id}`, { token: adminToken })).status, 200);
        assert.equal(await disconnected, 'io server disconnect');
        assert.equal((await api('GET', '/api/servers', { token })).status, 401);
        const retry = io(base, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 3000 });
        try {
            const outcome = await new Promise(resolve => { retry.once('connect', () => resolve('connected')); retry.once('connect_error', () => resolve('refused')); });
            assert.equal(outcome, 'refused');
        } finally { retry.close(); }
    } finally { socket.close(); }
});

test('an install cut off by a restart shows as failed and cannot be started', async () => {
    const list = await api('GET', '/api/servers', { token: adminToken });
    const half = list.data.find(s => s.id === 'half1');
    assert.equal(half.status, 'failed');
    assert.match(half.installError, /interrupted/);
    assert.equal((await api('POST', '/api/server/start', { token: adminToken, body: { id: 'half1' } })).status, 409);
});

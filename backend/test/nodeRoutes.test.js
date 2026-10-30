// Node management routes with the TLS listener switched on (claude, 2026-10-30). The listener-off
// case is in security.test.js; this catches route bugs the registry/transport unit tests can't
// (the first enrol route threw after creating the code and left a live code behind).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

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
    return { status: res.status, data, headers: res.headers };
}

test.before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-noderoutes-'));
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
    const [port, nodePort] = [await freePort(), await freePort()];
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', ADMIN_PASSWORD, JWT_SECRET: '',
            NODE_PORT: String(nodePort), NODE_HOST: '127.0.0.1', NODE_TLS_KEY_FILE: path.join(tmp, 'key.pem'), NODE_TLS_CERT_FILE: path.join(tmp, 'cert.pem'),
            DATA_DIR: path.join(tmp, 'data'), SERVERS_ROOT: path.join(tmp, 'servers'), BACKUPS_DIR: path.join(tmp, 'backups'), CACHE_DIR: path.join(tmp, 'cache'), STEAMCMD_DIR: path.join(tmp, 'steamcmd') },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 100 && !adminToken; i++) {
        try {
            const r = await api('POST', '/api/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
            if (r.status === 200) adminToken = r.data.token;
        } catch { /* starting */ }
        if (!adminToken) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(adminToken, 'admin login failed:\n' + log);
    assert.equal((await api('POST', '/api/users', { token: adminToken, body: { username: 'player', password: 'player-pass-1', role: 'user' } })).status, 200);
    userToken = (await api('POST', '/api/login', { body: { username: 'player', password: 'player-pass-1' } })).data.token;
});

test.after(() => { child?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('config reports the listener and its certificate pin', async () => {
    const r = await api('GET', '/api/nodes/config', { token: adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.enabled, true);
    assert.match(r.data.hubUrl, /^wss:\/\/127\.0\.0\.1:\d+\/node\/v1\/connect$/);
    assert.ok(r.data.hubFingerprint);
});

test('enrol issues a no-store code, is audited without the code, and can be cancelled', async () => {
    assert.equal((await api('POST', '/api/nodes/enrol', { token: userToken })).status, 403);
    const r = await api('POST', '/api/nodes/enrol', { token: adminToken });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (const k of ['codeId', 'code', 'expiresAt', 'hubId', 'hubUrl', 'hubFingerprint']) assert.ok(r.data[k], `missing ${k}`);

    const activity = (await api('GET', '/api/activity', { token: adminToken })).data;
    const entry = activity.find(a => a.action === 'node-enrol');
    assert.ok(entry, 'enrol not audited');
    assert.equal(entry.user, 'admin');
    assert.ok(!JSON.stringify(activity).includes(r.data.code), 'code leaked into the audit log');

    assert.equal((await api('DELETE', `/api/nodes/enrol/${r.data.codeId}`, { token: adminToken })).status, 200);
    assert.notEqual((await api('DELETE', `/api/nodes/enrol/${r.data.codeId}`, { token: adminToken })).status, 200);
});

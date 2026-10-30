// Enabled-listener regression: exercise real HTTP routes, registry, TLS transport and node client.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const { NodeClient } = require('../services/nodeClient');

const freePort = () => new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
const waitEvent = (emitter, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(name, listener); reject(new Error(`Node client never emitted ${name}`)); }, 5000);
    const listener = value => { clearTimeout(timer); resolve(value); };
    emitter.once(name, listener);
});
const noSecrets = value => {
    const json = JSON.stringify(value);
    for (const field of ['privateKey', 'publicKey', 'codeHash']) assert.equal(json.includes(`"${field}"`), false, `API exposed ${field}`);
};

test('enabled node API enrols, audits, pairs, approves and removes through real HTTP/TLS', { timeout: 25000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-node-api-'));
    let child, client;
    let serverOutput = '';
    try {
        const keyFile = path.join(tmp, 'tls-key.pem');
        const certFile = path.join(tmp, 'tls-cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
        const port = await freePort();
        const base = `http://127.0.0.1:${port}`;
        const adminPassword = 'node-api-admin-password';
        for (const directory of ['data', 'servers', 'backups', 'cache', 'steamcmd']) fs.mkdirSync(path.join(tmp, directory));
        child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', APP_URL: '', AUTH_MODE: 'local', ALLOW_DEV_AUTH: '0',
                ADMIN_PASSWORD: adminPassword, JWT_SECRET: '', DATA_DIR: path.join(tmp, 'data'), SERVERS_ROOT: path.join(tmp, 'servers'),
                BACKUPS_DIR: path.join(tmp, 'backups'), CACHE_DIR: path.join(tmp, 'cache'), STEAMCMD_DIR: path.join(tmp, 'steamcmd'),
                NODE_HOST: '127.0.0.1', NODE_PORT: '0', NODE_PUBLIC_URL: '', NODE_TLS_KEY_FILE: keyFile, NODE_TLS_CERT_FILE: certFile },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', data => { serverOutput = (serverOutput + data).slice(-16000); });
        child.stderr.on('data', data => { serverOutput = (serverOutput + data).slice(-16000); });
        const request = async (method, route, token, body) => {
            const response = await fetch(base + route, {
                method, signal: AbortSignal.timeout(3000),
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined,
            });
            return { status: response.status, data: await response.json(), headers: response.headers };
        };
        let ready = false;
        for (let i = 0; i < 80; i++) {
            if (child.exitCode !== null) break;
            try { ready = (await request('GET', '/api/auth-mode')).status === 200; } catch { /* server starting */ }
            if (ready) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(ready, `isolated API failed to start:\n${serverOutput}`);
        const login = await request('POST', '/api/login', null, { username: 'admin', password: adminPassword });
        assert.equal(login.status, 200);
        const adminToken = login.data.token;
        const config = await request('GET', '/api/nodes/config', adminToken);
        assert.equal(config.status, 200);
        assert.equal(config.data.enabled, true, serverOutput);
        const nodeUrl = new URL(config.data.hubUrl);
        assert.equal(nodeUrl.protocol, 'wss:');
        assert.equal(nodeUrl.pathname, '/node/v1/connect');
        assert.notEqual(Number(nodeUrl.port), port, 'node endpoint shares panel listener');
        assert.ok(Number(nodeUrl.port) > 0);
        assert.equal(config.data.hubFingerprint, new X509Certificate(fs.readFileSync(certFile)).fingerprint256);
        assert.equal((await request('POST', '/api/nodes/enrol')).status, 401);
        assert.equal((await request('POST', '/api/users', adminToken, { username: 'node-viewer', password: 'node-viewer-password', role: 'user' })).status, 200);
        const user = await request('POST', '/api/login', null, { username: 'node-viewer', password: 'node-viewer-password' });
        assert.equal(user.status, 200);
        assert.equal((await request('POST', '/api/nodes/enrol', user.data.token)).status, 403);
        assert.equal((await request('GET', '/api/nodes/config', user.data.token)).status, 403);

        const first = await request('POST', '/api/nodes/enrol', adminToken);
        assert.equal(first.status, 201, JSON.stringify(first.data));
        assert.equal(first.headers.get('cache-control'), 'no-store');
        assert.match(first.data.code, /^[A-Za-z0-9_-]{43}$/);
        assert.match(first.data.codeId, /^[a-f0-9-]{36}$/i);
        assert.match(first.data.hubId, /^[a-f0-9-]{36}$/i);
        assert.match(first.data.hubFingerprint, /^[a-f0-9]{64}$/);
        assert.ok(first.data.expiresAt > Date.now());
        assert.equal(first.data.hubUrl, config.data.hubUrl);
        assert.equal((await request('DELETE', `/api/nodes/enrol/${first.data.codeId}`, adminToken)).status, 200);
        let audit = await request('GET', '/api/activity', adminToken);
        assert.ok(audit.data.some(row => row.action === 'node-enrol' && row.user === 'admin' && row.detail === first.data.codeId));
        assert.ok(audit.data.some(row => row.action === 'node-enrol-cancel' && row.detail === first.data.codeId));
        assert.equal(JSON.stringify(audit.data).includes(first.data.code), false);

        const enrol = await request('POST', '/api/nodes/enrol', adminToken);
        assert.equal(enrol.status, 201);
        const failures = [];
        client = new NodeClient({ dataDir: path.join(tmp, 'node-client'), name: 'HTTP Test Node', platform: 'win32' });
        client.on('failure', error => failures.push(error.message));
        const pendingEvent = waitEvent(client, 'pending');
        await client.pair(enrol.data);
        const pending = await pendingEvent;
        const candidates = await request('GET', '/api/nodes/pending', adminToken);
        assert.equal(candidates.status, 200);
        assert.equal(candidates.data.length, 1);
        assert.equal(candidates.data[0].id, pending.candidateId);
        assert.equal(candidates.data[0].proved, true);
        noSecrets(candidates.data);
        assert.equal((await request('POST', `/api/nodes/${pending.candidateId}/approve`, adminToken, {})).status, 409);
        const online = waitEvent(client, 'online');
        const approve = await request('POST', `/api/nodes/${pending.candidateId}/approve`, adminToken, { fingerprintConfirmed: true });
        assert.equal(approve.status, 200);
        assert.equal((await online).nodeId, pending.candidateId);
        noSecrets(approve.data);
        const nodes = await request('GET', '/api/nodes', adminToken);
        const node = nodes.data.find(item => item.id === pending.candidateId);
        assert.equal(node.online, true);
        assert.equal(node.name, 'HTTP Test Node');
        assert.equal(node.os, 'win32');
        assert.ok(node.lastSeen);
        assert.deepEqual(node.actions, []);
        noSecrets(nodes.data);
        assert.equal((await request('GET', `/api/games?node=${node.id}`, adminToken)).status, 501);
        const offline = waitEvent(client, 'offline');
        assert.equal((await request('DELETE', `/api/nodes/${node.id}`, adminToken)).status, 200);
        await offline;
        assert.equal((await request('GET', '/api/nodes', adminToken)).data.some(item => item.id === node.id), false);
        audit = await request('GET', '/api/activity', adminToken);
        assert.ok(audit.data.some(row => row.action === 'node-approve' && row.detail === node.id));
        assert.ok(audit.data.some(row => row.action === 'node-remove' && row.detail === node.id));
        for (const code of [first.data.code, enrol.data.code]) {
            assert.equal(JSON.stringify(audit.data).includes(code), false);
            assert.equal(fs.readFileSync(path.join(tmp, 'data', 'activity.jsonl'), 'utf8').includes(code), false);
        }
        assert.deepEqual(failures, []);
    } finally {
        client?.stop();
        if (child && child.exitCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill('SIGTERM');
            const force = setTimeout(() => child.kill('SIGKILL'), 2000);
            await exited; clearTimeout(force);
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

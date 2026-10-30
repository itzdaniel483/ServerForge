const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const { NodeClient } = require('../services/nodeClient');
const { createNodeRuntime } = require('../services/nodeRuntime');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });

test('two real panels federate list, ACLs, files, power/streams, tasks, backups, install and cache without local fallback', { timeout: 60000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-federation-'));
    const children = [];
    let client, runtime, browser, hub, node, nodeId, liveTimer;
    const PASSWORD = 'federation-test-password';
    async function panel(name, tls = false) {
        const dir = path.join(root, name);
        for (const sub of ['data', 'servers', 'backups', 'cache', 'steamcmd']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        fs.writeFileSync(path.join(dir, 'steamcmd', 'steamcmd.sh'), '#!/bin/sh\ndest=""\napp=""\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "+force_install_dir" ]; then shift; dest="$1"; fi\n if [ "$1" = "+app_update" ]; then shift; app="$1"; fi\n shift\ndone\nmkdir -p "$dest"\necho fixture > "$dest/steam-fixture.txt"\necho "progress: 50.0 (test fixture)"\necho "Success! App \x27$app\x27 fully installed."\nexit 0\n', { mode: 0o755 });
        if (!tls) {
            const game = path.join(dir, 'servers', 'fixture'); fs.mkdirSync(game);
            fs.writeFileSync(path.join(game, 'run.sh'), '#!/bin/sh\nwhile true; do echo federation-tick; sleep 0.2; done\n', { mode: 0o755 });
            fs.writeFileSync(path.join(game, 'config.txt'), 'original');
            fs.writeFileSync(path.join(dir, 'data', 'servers.json'), JSON.stringify([{ id: 'sameid', name: 'Fixture', game: 'Team Fortress 2', gameId: 'tf2', appId: '232250', path: game, executable: 'run.sh', args: [], port: 29099, vars: { name: 'Fixture', port: 29099, password: 'node-private-secret' }, rconPassword: 'node-rcon-secret', owner: 'player', access: [{ username: 'player', perms: ['power'] }], status: 'stopped' }]));
        }
        const port = await freePort();
        const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), NODE_PORT: '', APP_URL: '', JWT_SECRET: '', ADMIN_PASSWORD: PASSWORD,
            DATA_DIR: path.join(dir, 'data'), SERVERS_ROOT: path.join(dir, 'servers'), BACKUPS_DIR: path.join(dir, 'backups'), CACHE_DIR: path.join(dir, 'cache'), STEAMCMD_DIR: path.join(dir, 'steamcmd') };
        if (tls) {
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
            Object.assign(env, { NODE_PORT: '0', NODE_HOST: '127.0.0.1', NODE_PUBLIC_URL: '', NODE_TLS_KEY_FILE: path.join(dir, 'key.pem'), NODE_TLS_CERT_FILE: path.join(dir, 'cert.pem') });
        }
        const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
        let log = ''; child.stdout.on('data', data => { log = (log + data).slice(-12000); }); child.stderr.on('data', data => { log = (log + data).slice(-12000); });
        const api = async (method, route, body, token) => {
            const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, signal: AbortSignal.timeout(35000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
            const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
            return { status: response.status, data };
        };
        for (let i = 0; i < 100; i++) { try { if ((await api('GET', '/api/auth-mode')).status === 200) break; } catch {} await pause(100); }
        const login = await api('POST', '/api/login', { username: 'admin', password: PASSWORD });
        assert.equal(login.status, 200, log);
        return { dir, port, token: login.data.token, api };
    }
    async function until(fn) { for (let i = 0; i < 80; i++) { const value = await fn(); if (value) return value; await pause(100); } throw new Error('Timed out waiting for federated state'); }
    try {
        hub = await panel('hub', true); node = await panel('node');
        runtime = createNodeRuntime({ dataDir: path.join(node.dir, 'data'), localApiUrl: `http://127.0.0.1:${node.port}` });
        client = new NodeClient({ dataDir: path.join(root, 'identity'), name: 'Fixture Linux', runtime });
        const bundle = await hub.api('POST', '/api/nodes/enrol', {}, hub.token); assert.equal(bundle.status, 201);
        const pending = once(client, 'pending'); await client.pair(bundle.data); const [candidate] = await pending;
        assert.equal((await hub.api('POST', `/api/nodes/${candidate.candidateId}/approve`, { fingerprintConfirmed: true }, hub.token)).status, 200);
        nodeId = candidate.candidateId; const id = `${nodeId}:sameid`;
        const remote = await until(async () => (await hub.api('GET', '/api/servers', undefined, hub.token)).data.find(server => server.id === id));
        assert.equal(remote.nodeOnline, true); assert.ok(remote.actions.includes('power')); assert.equal(remote.path, undefined); assert.equal(remote.rconPassword, undefined);
        assert.equal((await hub.api('GET', `/api/games?node=${nodeId}`, undefined, hub.token)).data.nodeId, nodeId);
        assert.ok((await hub.api('GET', `/api/host?node=${nodeId}`, undefined, hub.token)).data.memory.total > 0);
        assert.equal((await hub.api('POST', '/api/users', { username: 'player', password: PASSWORD, role: 'user' }, hub.token)).status, 200);
        const user = (await hub.api('POST', '/api/login', { username: 'player', password: PASSWORD })).data.token;
        assert.deepEqual((await hub.api('GET', '/api/servers', undefined, user)).data, []);
        assert.equal((await hub.api('POST', '/api/server/start', { id }, user)).status, 403);
        assert.equal((await hub.api('PUT', `/api/server/${id}/access`, { access: [{ username: 'player', perms: ['power', 'files'] }] }, hub.token)).status, 200);
        assert.equal((await hub.api('GET', `/api/servers?node=${nodeId}`, undefined, user)).data[0].id, id);
        const settings = await hub.api('GET', `/api/server/${id}/settings`, undefined, user); assert.equal(settings.data.vars.password, undefined);
        browser = io(`http://127.0.0.1:${hub.port}`, { auth: { token: user }, transports: ['websocket'], reconnection: false }); await once(browser, 'connect'); browser.emit('watch', id);
        const live = new Promise((resolve, reject) => { liveTimer = setTimeout(() => reject(new Error('Missing remote console stream')), 8000); browser.once(`server-log-${id}`, data => { clearTimeout(liveTimer); resolve([data]); }); });
        live.catch(() => {}); // A preceding assertion can fail before this event is awaited.
        const started = await hub.api('POST', '/api/server/start', { id }, user);
        assert.equal(started.status, 200, JSON.stringify(started.data)); assert.match(String((await live)[0]), /federation-tick/);
        assert.match(String((await hub.api('GET', `/api/server/${id}/logs`, undefined, user)).data), /federation-tick/);
        assert.equal((await hub.api('POST', '/api/server/stop', { id }, user)).status, 200);
        assert.equal((await hub.api('GET', `/api/server/${id}/files?path=config.txt`, undefined, user)).data.content, 'original');
        assert.equal((await hub.api('POST', `/api/server/${id}/file`, { path: 'config.txt', content: 'changed' }, user)).status, 403);
        assert.equal((await hub.api('POST', `/api/server/${id}/file`, { path: 'config.txt', content: 'changed' }, hub.token)).status, 200);
        assert.equal(fs.readFileSync(path.join(node.dir, 'servers', 'fixture', 'config.txt'), 'utf8'), 'changed');
        assert.equal((await hub.api('GET', `/api/server/${id}/files?path=../../data/users.json`, undefined, hub.token)).status, 403);
        const backup = await hub.api('POST', `/api/server/${id}/backups`, {}, hub.token); assert.equal(backup.status, 200);
        assert.equal((await hub.api('POST', `/api/server/${id}/file`, { path: 'config.txt', content: 'restore me' }, hub.token)).status, 200);
        assert.equal((await hub.api('POST', `/api/server/${id}/backups/restore`, { filename: backup.data.backup.filename }, hub.token)).status, 200);
        assert.equal(fs.readFileSync(path.join(node.dir, 'servers', 'fixture', 'config.txt'), 'utf8'), 'changed');
        assert.equal((await hub.api('DELETE', `/api/server/${id}/backups/${backup.data.backup.filename}`, undefined, hub.token)).status, 200);
        const task = await hub.api('POST', `/api/server/${id}/tasks`, { type: 'start', cron: '0 6 * * *' }, hub.token); assert.equal(task.status, 200); assert.ok(task.data.id.startsWith(nodeId + ':'));
        assert.ok((await hub.api('GET', `/api/server/${id}/tasks`, undefined, hub.token)).data.tasks.some(item => item.id === task.data.id));
        assert.equal((await hub.api('POST', `/api/tasks/${task.data.id}/run`, {}, hub.token)).data.ok, true);
        assert.equal((await hub.api('POST', '/api/server/stop', { id }, user)).status, 200);
        assert.equal((await hub.api('PUT', `/api/tasks/${task.data.id}`, { enabled: false }, hub.token)).status, 200);
        assert.equal((await hub.api('DELETE', `/api/tasks/${task.data.id}`, undefined, hub.token)).status, 200);
        const updated = await hub.api('PUT', `/api/server/${id}/settings`, { vars: { name: 'Updated fixture', port: 29099, map: 'cp_badlands', maxplayers: 8 } }, hub.token);
        assert.equal(updated.status, 200); assert.equal(updated.data.server.id, id);
        assert.equal((await hub.api('GET', `/api/server/${id}/settings`, undefined, hub.token)).data.vars.name, 'Updated fixture');
        assert.equal((await hub.api('POST', `/api/server/${id}/update`, {}, hub.token)).status, 200);
        const installed = await hub.api('POST', '/api/install', { nodeId, gameId: 'tf2', vars: { name: 'Remote install', port: 29101 } }, hub.token); assert.equal(installed.status, 200); assert.ok(installed.data.server.id.startsWith(nodeId + ':'));
        assert.equal((await hub.api('DELETE', `/api/server/${installed.data.server.id}`, undefined, hub.token)).status, 200);
        assert.equal((await hub.api('POST', `/api/cache/download/232250?node=${nodeId}`, { gameName: 'TF2 fixture' }, hub.token)).status, 202);
        await until(async () => (await hub.api('GET', `/api/cache/status/232250?node=${nodeId}`, undefined, hub.token)).data.status === 'ready');
        assert.equal((await hub.api('POST', `/api/cache/copy/232250?node=${nodeId}`, { targetPath: 'copied-cache' }, hub.token)).status, 200);
        assert.equal((await hub.api('DELETE', `/api/cache/232250?node=${nodeId}`, undefined, hub.token)).status, 200);
        const audit = (await node.api('GET', '/api/activity', undefined, node.token)).data;
        assert.ok(audit.some(row => row.user === 'player' && row.action === 'start'));
        const delegatedStart = audit.find(row => row.user === 'player' && row.action === 'start');
        assert.equal(delegatedStart.ip, '127.0.0.1'); assert.equal(delegatedStart.peerIp, '127.0.0.1');
        assert.equal(delegatedStart.viaHub, true); assert.ok(delegatedStart.userAgent);
        client.stop(); await until(async () => (await hub.api('GET', '/api/servers', undefined, hub.token)).data.find(server => server.id === id)?.nodeOnline === false);
        assert.equal((await hub.api('POST', '/api/server/start', { id }, hub.token)).data.code, 'NODE_OFFLINE');
        assert.equal((await hub.api('GET', '/api/servers', undefined, hub.token)).data.some(server => server.id === 'sameid'), false);
    } finally {
        clearTimeout(liveTimer);
        browser?.close(); client?.stop(); runtime?.close();
        if (node) await node.api('POST', '/api/server/stop', { id: 'sameid' }, node.token).catch(() => {});
        for (const child of children) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), pause(2000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
        fs.rmSync(root, { recursive: true, force: true });
    }
});

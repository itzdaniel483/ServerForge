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


// Move between machines end to end (claude, Daniel #gamemanager 3576/3580): node server → hub, fresh install +
// configs/saves, started and checked, then the original removed.
test('move a server from a node to the hub: fresh install, configs copied, running, original removed', { timeout: 90000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-move-e2e-'));
    const children = [];
    let client, runtime, hub, node;
    const PASSWORD = 'federation-test-password';
    async function panel(name, tls = false, cacheSeed = null) {
        const dir = path.join(root, name);
        for (const sub of ['data', 'servers', 'backups', 'cache', 'steamcmd']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        if (cacheSeed) fs.writeFileSync(path.join(dir, 'cache', 'cache.json'), JSON.stringify(cacheSeed));
        fs.writeFileSync(path.join(dir, 'steamcmd', 'steamcmd.sh'), '#!/bin/sh\ndest=""\napp=""\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "+force_install_dir" ]; then shift; dest="$1"; fi\n if [ "$1" = "+app_update" ]; then shift; app="$1"; fi\n shift\ndone\nmkdir -p "$dest"\necho fixture > "$dest/steam-fixture.txt"\nprintf \"#!/bin/sh\\nwhile true; do echo moved-tick; sleep 0.3; done\\n\" > \"$dest/srcds_run\"\nchmod +x \"$dest/srcds_run\"\necho "progress: 50.0 (test fixture)"\necho "Success! App \x27$app\x27 fully installed."\nexit 0\n', { mode: 0o755 });
        if (!tls) {
            const game = path.join(dir, 'servers', 'fixture'); fs.mkdirSync(game);
            fs.writeFileSync(path.join(game, 'run.sh'), '#!/bin/sh\nwhile true; do echo federation-tick; sleep 0.2; done\n', { mode: 0o755 });
            fs.writeFileSync(path.join(game, 'config.txt'), 'original'); fs.mkdirSync(path.join(game, 'tf', 'cfg'), { recursive: true }); fs.writeFileSync(path.join(game, 'tf', 'cfg', 'server.cfg'), 'hostname "Moved across"');
            fs.writeFileSync(path.join(dir, 'data', 'servers.json'), JSON.stringify([{ id: 'sameid', workshopCollectionId: '1234567', name: 'Fixture', game: 'Team Fortress 2', gameId: 'tf2', appId: '232250', path: game, executable: 'run.sh', args: [], port: 29099, vars: { name: 'Fixture', port: 29099, password: 'node-private-secret' }, rconPassword: 'node-rcon-secret', owner: 'player', access: [{ username: 'player', perms: ['power'] }], status: 'stopped' }]));
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
    try {
        hub = await panel('hub', true, { '232250': { name: 'Team Fortress 2', status: 'ready' } }); node = await panel('node');
        // Moving to a machine with a ready cache should reuse it instead of invoking SteamCMD.
        const cachedGame = path.join(hub.dir, 'cache', '232250'); fs.mkdirSync(cachedGame, { recursive: true });
        fs.writeFileSync(path.join(cachedGame, 'srcds_run'), '#!/bin/sh\nwhile true; do echo cached-game-tick; sleep 0.2; done\n', { mode: 0o755 });
        runtime = createNodeRuntime({ dataDir: path.join(node.dir, 'data'), localApiUrl: `http://127.0.0.1:${node.port}` });
        runtime.capabilities = [...runtime.capabilities, 'future.action'];   // a newer node: the hub must ignore what it doesn't know, not drop the link
        client = new NodeClient({ dataDir: path.join(root, 'identity'), name: 'Fixture Linux', runtime });
        const bundle = await hub.api('POST', '/api/nodes/enrol', {}, hub.token);
        const pending = once(client, 'pending'); await client.pair(bundle.data); const [candidate] = await pending;
        await hub.api('POST', `/api/nodes/${candidate.candidateId}/approve`, { fingerprintConfirmed: true }, hub.token);
        const nodeId = candidate.candidateId, remoteId = `${nodeId}:sameid`;
        for (let i = 0; i < 80 && !(await hub.api('GET', '/api/servers', undefined, hub.token)).data.some(s => s.id === remoteId); i++) await pause(100);
        // Machine settings page (Daniel 3730): the hub shows a node's folders and where each server lives.
        const machine = await hub.api('GET', `/api/nodes/${nodeId}/machine`, undefined, hub.token);
        assert.equal(machine.status, 200, JSON.stringify(machine.data));
        assert.equal(machine.data.folders.find(f => f.key === 'servers').path, path.join(node.dir, 'servers'));
        assert.equal(machine.data.servers.find(s => s.id === 'sameid').path, path.join(node.dir, 'servers', 'fixture'));
        assert.ok(machine.data.folders.every(f => typeof f.label === 'string' && 'free' in f));
        assert.equal((await hub.api('GET', '/api/nodes/local/machine', undefined, hub.token)).data.folders[0].path, path.join(hub.dir, 'servers'));
        // Schedules and access come along (checklist): one task on the node server, one user grant kept by the hub.
        assert.equal((await hub.api('POST', '/api/users', { username: 'mover', password: 'mover-password-123', role: 'user' }, hub.token)).status, 200);
        assert.equal((await hub.api('PUT', `/api/server/${remoteId}/access`, { access: [{ username: 'mover', perms: ['power', 'console'] }] }, hub.token)).status, 200);
        const task = await hub.api('POST', `/api/server/${remoteId}/tasks`, { type: 'command', cron: '0 6 * * *', command: 'say morning', label: 'Morning hello' }, hub.token);
        assert.equal(task.status, 200, JSON.stringify(task.data));
        const start = await hub.api('POST', '/api/moves', { serverId: remoteId, targetNodeId: 'local' }, hub.token);
        assert.equal(start.status, 202);
        let job;
        for (let i = 0; i < 200; i++) { job = (await hub.api('GET', `/api/moves/${start.data.moveId}`, undefined, hub.token)).data; if (['done', 'failed'].includes(job.step)) break; await pause(200); }
        assert.equal(job.step, 'done', JSON.stringify(job.log));
        assert.ok(job.log.some(line => /destination machine's ready cache/i.test(line)), JSON.stringify(job.log));
        const moved = (await hub.api('GET', '/api/servers', undefined, hub.token)).data.find(s => s.id === job.newServerId);
        assert.ok(moved, 'new server is on the hub'); assert.equal(moved.nodeId, 'local');
        const hubServers = JSON.parse(fs.readFileSync(path.join(hub.dir, 'data', 'servers.json'), 'utf8'));
        const rec = hubServers.find(s => s.id === job.newServerId);
        assert.equal(fs.readFileSync(path.join(rec.path, 'tf', 'cfg', 'server.cfg'), 'utf8'), 'hostname "Moved across"');
        assert.match(fs.readFileSync(path.join(rec.path, 'srcds_run'), 'utf8'), /cached-game-tick/, 'files came from the destination cache');
        assert.equal(fs.existsSync(path.join(rec.path, 'steam-fixture.txt')), false, 'SteamCMD was not run for the cached move');
        assert.equal(rec.workshopCollectionId, '1234567', 'Workshop collection copied'); assert.ok(rec.args.includes('+host_workshop_collection') && rec.args.includes('1234567'), JSON.stringify(rec.args));
        assert.deepEqual(rec.access, [{ username: 'mover', perms: ['view', 'power', 'console'] }], 'access copied');
        const tasks = (await hub.api('GET', `/api/server/${job.newServerId}/tasks`, undefined, hub.token)).data.tasks;
        assert.deepEqual(tasks.map(t => [t.type, t.cron, t.command, t.label, t.enabled]), [['command', '0 6 * * *', 'say morning', 'Morning hello', true]], 'schedule copied');
        assert.ok(job.log.some(l => /Copied 1 schedule\./.test(l)) && job.log.some(l => /Copied access for 1 user\./.test(l)), JSON.stringify(job.log));
        assert.deepEqual(job.warnings, []);
        const finished = await hub.api('POST', `/api/moves/${start.data.moveId}/finish`, { removeSource: true }, hub.token);
        assert.equal(finished.status, 200); assert.equal(finished.data.filesRemoved, true, 'original game files removed');
        for (let i = 0; i < 50 && (await hub.api('GET', '/api/servers', undefined, hub.token)).data.some(s => s.id === remoteId); i++) await pause(200);
        assert.equal((await hub.api('GET', '/api/servers', undefined, hub.token)).data.some(s => s.id === remoteId), false, 'original removed');
        await hub.api('POST', '/api/server/stop', { id: job.newServerId }, hub.token);
        // A failed move's cleanup deletes with removeFiles (Daniel 3731: leftover installs). Folder goes; only when stopped.
        for (let i = 0; i < 30 && (await hub.api('GET', `/api/server/${job.newServerId}/status`, undefined, hub.token)).data.status === 'running'; i++) await pause(200);
        const del = await hub.api('DELETE', `/api/server/${job.newServerId}`, { removeFiles: true }, hub.token);
        assert.equal(del.status, 200); assert.equal(del.data.filesRemoved, true, JSON.stringify(del.data));
        assert.equal(fs.existsSync(rec.path), false, 'game files removed with the record');
    } finally {
        client?.stop(); runtime?.close?.();
        for (const c of children) c.kill('SIGKILL');
        fs.rmSync(root, { recursive: true, force: true });
    }
});

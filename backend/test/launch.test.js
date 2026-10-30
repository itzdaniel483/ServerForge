// Command line templates (claude, Daniel #gamemanager 3576, contract #3581). Real server on a random port, temp data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');
const catalog = require('../services/catalog');
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let base, child, tmp, admin, user;
const PW = 'test-admin-pass-1';
async function api(method, url, { token, body } = {}) {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* not json */ } return { status: res.status, data };
}
test.before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-launch-'));
    const dir = path.join(tmp, 'servers', 'gm'); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(tmp, 'data'));
    const game = catalog.get('gmod'), vars = { name: 'My Server', map: 'gm_construct', maxplayers: 16, port: 27015 };
    const launch = catalog.buildLaunch(game, vars, { rconPassword: 'secretrcon' });
    fs.writeFileSync(path.join(tmp, 'data', 'servers.json'), JSON.stringify([{ id: 'gm1', name: 'My Server', game: 'Garry\'s Mod', gameId: 'gmod', appId: '4020', path: dir, port: 27015, rconPassword: 'secretrcon', status: 'stopped', owner: 'admin', vars, ...launch }]));
    const port = await freePort(); base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', ADMIN_PASSWORD: PW, JWT_SECRET: '', DATA_DIR: path.join(tmp, 'data'), SERVERS_ROOT: path.join(tmp, 'servers'), BACKUPS_DIR: path.join(tmp, 'b'), CACHE_DIR: path.join(tmp, 'c'), STEAMCMD_DIR: path.join(tmp, 's') }, stdio: 'ignore' });
    for (let i = 0; i < 100 && !admin; i++) { try { const r = await api('POST', '/api/login', { body: { username: 'admin', password: PW } }); if (r.status === 200) admin = r.data.token; } catch { /* starting */ } if (!admin) await new Promise(r => setTimeout(r, 100)); }
    await api('POST', '/api/users', { token: admin, body: { username: 'player', password: 'player-pass-1', role: 'user' } });
    user = (await api('POST', '/api/login', { body: { username: 'player', password: 'player-pass-1' } })).data.token;
});
test.after(() => { child?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET shows the default template, variables and a preview without the RCON password', async () => {
    const r = await api('GET', '/api/server/gm1/launch', { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.data.template, null);
    assert.match(r.data.defaultTemplate, /\+map \{map\}/);
    assert.equal(r.data.variables.map, 'gm_construct');
    assert.ok(r.data.preview.includes('gm_construct'));
    assert.ok(!JSON.stringify(r.data).includes('secretrcon'));
    assert.equal((await api('GET', '/api/server/gm1/launch', { token: user })).status, 403);
});
test('preview validates without saving: bad variable, unclosed quote, quoted args stay one argument', async () => {
    assert.equal((await api('POST', '/api/server/gm1/launch/preview', { token: admin, body: { template: '+map {mapp}', customArgs: '' } })).status, 400);
    const q = await api('POST', '/api/server/gm1/launch/preview', { token: admin, body: { template: '+map "{map}', customArgs: '' } });
    assert.equal(q.status, 400); assert.equal(q.data.at, 5);
    const ok = await api('POST', '/api/server/gm1/launch/preview', { token: admin, body: { template: '+hostname "{name}" +map {map}', customArgs: '+sv_lan 0' } });
    assert.deepEqual(ok.data.preview, ['+hostname', 'My Server', '+map', 'gm_construct', '+sv_lan', '0']);
    assert.equal((await api('GET', '/api/server/gm1/launch', { token: admin })).data.template, null, 'preview never saves');
});
test('PUT saves; a Settings save keeps the template and custom args but refreshes values; reset goes back to default', async () => {
    const put = await api('PUT', '/api/server/gm1/launch', { token: admin, body: { template: '-console +map {map} +maxplayers {maxplayers}', customArgs: '-tickrate 66 +sv_lan 0' } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.data.preview, ['-console', '+map', 'gm_construct', '+maxplayers', '16', '-tickrate', '66', '+sv_lan', '0']);
    const set = await api('PUT', '/api/server/gm1/settings', { token: admin, body: { vars: { name: 'My Server', map: 'gm_flatgrass', maxplayers: 24, port: 27015 }, autoRestart: true } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const after = await api('GET', '/api/server/gm1/launch', { token: admin });
    assert.equal(after.data.template, '-console +map {map} +maxplayers {maxplayers}');
    assert.deepEqual(after.data.preview, ['-console', '+map', 'gm_flatgrass', '+maxplayers', '24', '-tickrate', '66', '+sv_lan', '0']);
    const reset = await api('PUT', '/api/server/gm1/launch', { token: admin, body: { template: null, customArgs: '' } });
    assert.equal(reset.data.template, null); assert.ok(reset.data.preview.includes('+gamemode'));
    assert.equal((await api('PUT', '/api/server/gm1/launch', { token: user, body: { template: 'x', customArgs: '' } })).status, 403);
});

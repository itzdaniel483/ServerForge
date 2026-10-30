// Game modes (claude, Daniel #gamemanager 3576): catalogue modes, workshop args, pinned downloads, zip-slip guard.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const catalog = require('../services/catalog');
const md = require('../services/modeDownloads');
test('Gmod lists its modes; the gamemode var drives +gamemode and Workshop adds its args', () => {
    const g = catalog.list().find(x => x.id === 'gmod');
    assert.deepEqual(g.modes.map(m => m.id), ['sandbox', 'terrortown', 'darkrp', 'workshop']);
    assert.ok(!JSON.stringify(g.modes).includes('codeload'), 'download URLs stay server-side');
    const game = catalog.get('gmod');
    const { vars, errors } = catalog.cleanVars(game, { gamemode: 'terrortown', workshop: '123456' });
    assert.deepEqual(errors, []);
    const args = catalog.buildLaunch(game, vars, {}).args;
    assert.deepEqual(args.slice(args.indexOf('+gamemode'), args.indexOf('+gamemode') + 4), ['+gamemode', 'terrortown', '+host_workshop_collection', '123456']);
    assert.ok(catalog.cleanVars(game, { gamemode: 'bad;rm -rf' }).errors.length > 0);
    assert.ok(catalog.cleanVars(game, { workshop: '12a' }).errors.length > 0);
});
const zipOf = files => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); };
test('mode downloads must match their pinned checksum and unpack inside the target only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-modes-'));
    try {
        await assert.rejects(md.installModeFiles('darkrp', dir, () => {}, async () => Buffer.from('not the real file')), /pinned checksum/);
        assert.equal(fs.existsSync(path.join(dir, 'garrysmod')), false);
        const good = zipOf({ 'Top-1/gamemode/init.lua': 'print(1)', 'Top-1/README.md': 'x' });
        md.unpack(good, path.join(dir, 'out'));
        assert.equal(fs.readFileSync(path.join(dir, 'out', 'gamemode', 'init.lua'), 'utf8'), 'print(1)');
        const evil = new AdmZip(); evil.addFile('Top-1/ok.txt', Buffer.from('a'));
        evil.getEntries()[0].entryName = 'Top-1/../../escape.txt';
        assert.throws(() => md.unpack(evil.toBuffer(), path.join(dir, 'out2')), /outside the folder/);
        assert.equal(fs.existsSync(path.join(dir, 'escape.txt')), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

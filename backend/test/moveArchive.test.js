// Move between machines, per-machine archive part (claude, Daniel #gamemanager 3576/3580).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const AdmZip = require('adm-zip');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-move-')); process.env.DATA_DIR = path.join(tmp, 'data');
const mv = require('../services/moveArchive');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test('keep paths: source games keep cfg/data/addons/sv.db/darkrp; others nothing unless listed', () => {
    assert.ok(mv.keepPaths({ engine: 'source', gameDir: 'garrysmod' }).includes('garrysmod/sv.db'));
    assert.deepEqual(mv.keepPaths({ engine: 'other' }), []);
    assert.deepEqual(mv.keepPaths({ keep: ['saves'] }), ['saves']);
});
test('export → chunked read → receive → import recreates configs and saves; nothing else', () => {
    const src = path.join(tmp, 'src'), dst = path.join(tmp, 'dst');
    fs.mkdirSync(path.join(src, 'garrysmod', 'cfg'), { recursive: true }); fs.mkdirSync(path.join(src, 'garrysmod', 'data', 'darkrp'), { recursive: true });
    fs.writeFileSync(path.join(src, 'garrysmod', 'cfg', 'server.cfg'), 'hostname "Moved"');
    fs.writeFileSync(path.join(src, 'garrysmod', 'sv.db'), Buffer.from([0, 1, 2, 3, 255]));
    fs.writeFileSync(path.join(src, 'garrysmod', 'data', 'darkrp', 'money.txt'), '1000');
    fs.writeFileSync(path.join(src, 'srcds_run'), 'binary stays put');
    const out = mv.exportServer(src, mv.keepPaths({ engine: 'source', gameDir: 'garrysmod' }));
    fs.mkdirSync(dst);
    for (let offset = 0; offset < out.size;) { const part = mv.readChunk(out.token, offset); mv.receiveChunk({ token: out.token, offset, data: part.data, total: out.size }); offset += Buffer.from(part.data, 'base64').length; }
    assert.ok(mv.importInto(dst, out.token).files >= 3);
    assert.equal(fs.readFileSync(path.join(dst, 'garrysmod', 'cfg', 'server.cfg'), 'utf8'), 'hostname "Moved"');
    assert.deepEqual([...fs.readFileSync(path.join(dst, 'garrysmod', 'sv.db'))], [0, 1, 2, 3, 255]);
    assert.equal(fs.readFileSync(path.join(dst, 'garrysmod', 'data', 'darkrp', 'money.txt'), 'utf8'), '1000');
    assert.equal(fs.existsSync(path.join(dst, 'srcds_run')), false, 'only configs/saves move');
    mv.cleanup(out.token);
    assert.throws(() => mv.readChunk(out.token, 0), /not found/);
});
test('import refuses entries outside the server folder; bad tokens and out-of-order chunks are refused', () => {
    const z = new AdmZip(); z.addFile('ok.txt', Buffer.from('a')); z.getEntries()[0].entryName = '../escape.txt';
    const buf = z.toBuffer(); const t = 'a'.repeat(32);
    mv.receiveChunk({ token: t, offset: 0, data: buf.toString('base64'), total: buf.length });
    assert.throws(() => mv.importInto(path.join(tmp, 'victim'), t), /outside the server folder/);
    assert.equal(fs.existsSync(path.join(tmp, 'escape.txt')), false);
    assert.throws(() => mv.readChunk('../../etc/passwd', 0), /Invalid move token/);
    assert.throws(() => mv.receiveChunk({ token: 'b'.repeat(32), offset: 5, data: 'AAAA', total: 10 }), /Expected the chunk at 0/);
});
test('symlinks: import refuses to write through a link in the target; export never follows one (codex 3614)', () => {
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not copy');
    // Export: a linked cfg folder and a linked file are skipped, real files still go.
    const src = path.join(tmp, 'lsrc'); fs.mkdirSync(path.join(src, 'garrysmod', 'data'), { recursive: true });
    fs.writeFileSync(path.join(src, 'garrysmod', 'data', 'real.txt'), 'real');
    fs.symlinkSync(outside, path.join(src, 'garrysmod', 'cfg'));
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(src, 'garrysmod', 'data', 'leak.txt'));
    const out = mv.exportServer(src, mv.keepPaths({ engine: 'source', gameDir: 'garrysmod' }));
    const names = new AdmZip(fs.readFileSync(path.join(process.env.DATA_DIR, 'moves', `out-${out.token}.zip`))).getEntries().map(e => e.entryName);
    assert.ok(names.includes('garrysmod/data/real.txt'));
    assert.ok(!names.some(n => /secret|leak|garrysmod\/cfg/.test(n)), names.join(','));
    mv.cleanup(out.token);
    // Import: target has garrysmod/cfg -> outside; an archive writing cfg/server.cfg is refused before anything lands.
    const dst = path.join(tmp, 'ldst'); fs.mkdirSync(path.join(dst, 'garrysmod'), { recursive: true });
    fs.symlinkSync(outside, path.join(dst, 'garrysmod', 'cfg'));
    const z = new AdmZip(); z.addFile('garrysmod/a-first.txt', Buffer.from('x')); z.addFile('garrysmod/cfg/server.cfg', Buffer.from('owned'));
    const buf = z.toBuffer(); const t = 'c'.repeat(32);
    mv.receiveChunk({ token: t, offset: 0, data: buf.toString('base64'), total: buf.length });
    assert.throws(() => mv.importInto(dst, t), /Refusing to follow a link/);
    assert.equal(fs.existsSync(path.join(outside, 'server.cfg')), false, 'nothing written through the link');
    assert.equal(fs.existsSync(path.join(dst, 'garrysmod', 'a-first.txt')), false, 'nothing half-imported');
    // A linked file as the final component is refused too.
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dst, 'garrysmod', 'sv.db'));
    const z2 = new AdmZip(); z2.addFile('garrysmod/sv.db', Buffer.from('overwrite')); const b2 = z2.toBuffer(); const t2 = 'd'.repeat(32);
    mv.receiveChunk({ token: t2, offset: 0, data: b2.toString('base64'), total: b2.length });
    assert.throws(() => mv.importInto(dst, t2), /Refusing to follow a link/);
    assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'do not copy');
});

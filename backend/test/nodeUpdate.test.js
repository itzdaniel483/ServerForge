// One-click node updates (claude, Daniel #gamemanager 3591/3595): signing, chunked receive, staging, and the
// updater's refusal of anything not signed by this panel's key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-update-'));
process.env.DATA_DIR = path.join(tmp, 'hub'); fs.mkdirSync(process.env.DATA_DIR);
process.env.NODE_UPDATE_DIR = path.join(tmp, 'node-update');
process.env.NODE_UPDATE_PACKAGE = path.join(tmp, 'node-update.zip');
const nodeUpdate = require('../services/nodeUpdate');
const { verify } = require('../../installers/windows-node/service/apply-update.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const pkg = crypto.randomBytes(7 * 1024 * 1024 + 123);   // more than two chunks
fs.writeFileSync(process.env.NODE_UPDATE_PACKAGE, pkg); fs.writeFileSync(path.join(tmp, 'node-update.version'), 'abc123def456\n');

test('the hub signs a manifest for its package; the private key stays owner-only', () => {
    const info = nodeUpdate.packageInfo();
    assert.equal(info.manifest.version, 'abc123def456'); assert.equal(info.manifest.size, pkg.length);
    assert.equal(fs.statSync(path.join(process.env.DATA_DIR, 'update-signing-key.pem')).mode & 0o077, 0);
    const pub = fs.readFileSync(nodeUpdate.PUB_FILE);
    assert.equal(verify({ ready: { manifest: info.manifest, signature: info.signature }, packageBytes: pkg, publicKeyPem: pub }), null);
});

test('chunks are received in order, staged, and the updater verifies them; tampering is refused', () => {
    const info = nodeUpdate.packageInfo(), sha = info.manifest.sha256, total = pkg.length;
    assert.throws(() => nodeUpdate.receiveChunk({ offset: nodeUpdate.CHUNK, data: pkg.subarray(0, 10).toString('base64'), total, sha256: sha }), /Expected the chunk at 0/);
    for (let offset = 0; offset < total; offset += nodeUpdate.CHUNK) nodeUpdate.receiveChunk({ offset, data: pkg.subarray(offset, offset + nodeUpdate.CHUNK).toString('base64'), total, sha256: sha });
    assert.deepEqual(nodeUpdate.stage({ manifest: info.manifest, signature: info.signature }), { staged: true });
    const ready = JSON.parse(fs.readFileSync(path.join(process.env.NODE_UPDATE_DIR, 'ready.json'), 'utf8'));
    const staged = fs.readFileSync(path.join(process.env.NODE_UPDATE_DIR, 'package.zip'));
    const pub = fs.readFileSync(nodeUpdate.PUB_FILE);
    assert.equal(verify({ ready, packageBytes: staged, publicKeyPem: pub }), null);
    const tampered = Buffer.from(staged); tampered[100] ^= 1;
    assert.match(verify({ ready, packageBytes: tampered, publicKeyPem: pub }), /hash/);
    // A local attacker rewriting ready.json to match a malicious package can't produce the panel's signature.
    const evil = crypto.randomBytes(1000);
    const forged = { manifest: { version: 'evil', sha256: crypto.createHash('sha256').update(evil).digest('hex'), size: evil.length }, signature: ready.signature };
    assert.match(verify({ ready: forged, packageBytes: evil, publicKeyPem: pub }), /signature/);
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    assert.match(verify({ ready, packageBytes: staged, publicKeyPem: other }), /signature/);
});

test('staging refuses a damaged or missing package and bad input', () => {
    const info = nodeUpdate.packageInfo();
    assert.throws(() => nodeUpdate.stage({ manifest: info.manifest, signature: info.signature }), /No package received/);
    nodeUpdate.receiveChunk({ offset: 0, data: Buffer.from('short').toString('base64'), total: pkg.length, sha256: info.manifest.sha256 });
    assert.throws(() => nodeUpdate.stage({ manifest: info.manifest, signature: info.signature }), /damaged/);
    assert.throws(() => nodeUpdate.receiveChunk({ offset: 0, data: 'not base64!', total: 10, sha256: info.manifest.sha256 }), /base64/);
    assert.throws(() => nodeUpdate.receiveChunk({ offset: 0, data: 'AAAA', total: 10, sha256: '../../etc' }), /hash/);
});

// ---- Updater protocol 2 (codex review #gamemanager 3616) ----
const updater = require('../../installers/windows-node/service/apply-update.js');
test('release numbers: only strictly newer ones apply; hash builds are older than any release', () => {
    assert.equal(updater.isNewer('1.0.2', '1.0.1'), true);
    assert.equal(updater.isNewer('1.0.10', '1.0.9'), true);
    assert.equal(updater.isNewer('1.1', '1.0.9'), true);
    assert.equal(updater.isNewer('1.0.1', '1.0.1'), false, 'same version is not an update');
    assert.equal(updater.isNewer('1.0.0', '1.0.1'), false, 'no downgrade');
    assert.equal(updater.isNewer('1.0.1', 'b7c113c227c0'), true);
    assert.equal(updater.isNewer('evil', '1.0.1'), false);
    assert.equal(nodeUpdate.isNewer('1.0.2', '1.0.1'), true); assert.equal(nodeUpdate.isNewer('1.0.1', '1.0.1'), false);
});

// A signed package for a given version, as the hub would make it.
function signed(version, bytes = crypto.randomBytes(2048)) {
    const key = crypto.createPrivateKey(fs.readFileSync(path.join(process.env.DATA_DIR, 'update-signing-key.pem')));
    const manifest = { version, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    return { ready: { manifest, signature: crypto.sign(null, Buffer.from(updater.manifestText(manifest)), key).toString('base64') }, bytes };
}
function machine(name, { appVersion = '1.0.1' } = {}) {
    const root = path.join(tmp, name), data = path.join(root, 'data'), install = path.join(root, 'install');
    fs.mkdirSync(path.join(data, 'update'), { recursive: true }); fs.mkdirSync(path.join(install, 'app'), { recursive: true });
    fs.writeFileSync(path.join(install, 'app', 'VERSION'), appVersion);
    const run = () => updater.main(['node', 'apply-update.js', '--data', data, '--install', install, '--key', nodeUpdate.PUB_FILE]);
    const resultFile = path.join(install, 'update-result.json');
    return { root, data, install, upd: path.join(data, 'update'), run, result: () => JSON.parse(fs.readFileSync(resultFile, 'utf8')), hasResult: () => fs.existsSync(resultFile) };
}

test('updater: an old signed package (replay/downgrade) or the same version is refused; result goes to Program Files only', () => {
    nodeUpdate.packageInfo();   // make sure the hub key exists
    for (const v of ['1.0.0', '1.0.1']) {
        const m = machine(`replay-${v}`), p = signed(v);
        fs.writeFileSync(path.join(m.upd, 'ready.json'), JSON.stringify(p.ready)); fs.writeFileSync(path.join(m.upd, 'package.zip'), p.bytes);
        assert.equal(m.run(), 1);
        assert.match(m.result().error, /not newer than the installed 1\.0\.1/);
        assert.deepEqual(fs.readdirSync(m.upd), [], 'request cleared, and nothing written into the game-writable folder');
        assert.equal(fs.readFileSync(path.join(m.install, 'app', 'VERSION'), 'utf8'), '1.0.1');
    }
});

test('updater: links and junction-like swaps in the game-writable folder are refused without touching anything', () => {
    const outside = path.join(tmp, 'system32'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'ready.json'), 'precious');
    // The update folder itself replaced with a link: the updater does nothing at all (no delete, no write).
    const a = machine('linkdir'); fs.rmSync(a.upd, { recursive: true }); fs.symlinkSync(outside, a.upd);
    assert.equal(a.run(), 1);
    assert.equal(fs.readFileSync(path.join(outside, 'ready.json'), 'utf8'), 'precious'); assert.equal(a.hasResult(), false);
    // package.zip as a link to a real signed package elsewhere: refused (only plain files are read).
    const b = machine('linkfile'), p = signed('1.0.2');
    const elsewhere = path.join(tmp, 'elsewhere.zip'); fs.writeFileSync(elsewhere, p.bytes);
    fs.writeFileSync(path.join(b.upd, 'ready.json'), JSON.stringify(p.ready)); fs.symlinkSync(elsewhere, path.join(b.upd, 'package.zip'));
    assert.equal(b.run(), 1); assert.match(b.result().error, /is a link/);
    assert.ok(fs.existsSync(elsewhere), 'the link target is never deleted');
    // ready.json as a link: refused.
    const c = machine('linkready'); fs.symlinkSync(path.join(outside, 'ready.json'), path.join(c.upd, 'ready.json'));
    assert.equal(c.run(), 1); assert.match(c.result().error, /is a link/);
    assert.equal(fs.readFileSync(path.join(outside, 'ready.json'), 'utf8'), 'precious');
});

test('updater: the verified bytes are what gets unpacked; swapping the staged file afterwards has no effect', () => {
    // readOnce returns a private copy: changing the file after the read (the TOCTOU window) can't change what is used.
    const f = path.join(tmp, 'pkg-once.zip'); const good = crypto.randomBytes(4096); fs.writeFileSync(f, good);
    const copy = updater.readOnce(f, 1e6);
    fs.writeFileSync(f, crypto.randomBytes(4096));
    assert.deepEqual(copy, good);
    assert.throws(() => updater.readOnce(f, 100), /too large/);
    // The work copy is written from memory into the install folder, never re-read from DATA_DIR: check the code path.
    const src = fs.readFileSync(require.resolve('../../installers/windows-node/service/apply-update.js'), 'utf8');
    assert.match(src, /writeFileSync\(workPkg, packageBytes/);
    assert.match(src, /Expand-Archive -LiteralPath '\$\{workPkg/);
    assert.ok(!/Expand-Archive -LiteralPath '\$\{pkgFile/.test(src), 'never unpacks from the game-writable folder');
});

test('node status reads the updater protocol and the result from the install folder (not the game-writable one)', () => {
    const inst = path.join(tmp, 'status-install'); fs.mkdirSync(path.join(inst, 'service'), { recursive: true });
    const code = `
        process.env.NODE_INSTALL_DIR = ${JSON.stringify(inst)}; process.env.DATA_DIR = ${JSON.stringify(path.join(tmp, 'hub'))};
        process.env.NODE_UPDATE_DIR = ${JSON.stringify(process.env.NODE_UPDATE_DIR)};
        const u = require(${JSON.stringify(require.resolve('../services/nodeUpdate'))});
        console.log(JSON.stringify([u.updaterProtocol(), u.status().result]));`;
    const run = () => JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
    assert.deepEqual(run(), [0, null]);
    fs.writeFileSync(path.join(inst, 'service', 'apply-update.js'), '// first updater');
    assert.equal(run()[0], 1);
    fs.copyFileSync(require.resolve('../../installers/windows-node/service/apply-update.js'), path.join(inst, 'service', 'apply-update.js'));
    assert.equal(run()[0], 2);
    fs.writeFileSync(path.join(process.env.NODE_UPDATE_DIR, 'result.json'), JSON.stringify({ status: 'done', version: '9.9.9' }));
    assert.equal(run()[1], null, 'a result planted in DATA_DIR is ignored');
    fs.writeFileSync(path.join(inst, 'update-result.json'), JSON.stringify({ status: 'done', version: '1.0.2' }));
    assert.equal(run()[1].version, '1.0.2');
});

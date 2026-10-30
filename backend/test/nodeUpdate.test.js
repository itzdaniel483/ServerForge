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

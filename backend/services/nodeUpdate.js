// One-click node updates (claude, Daniel #gamemanager 3591/3595).
// Hub side: an Ed25519 signing key (private, in DATA_DIR) and the app-only update package built by
// scripts/build-windows-node.sh (release/node-update.zip + .version). The manifest "version\nsha256\nsize" is signed;
// a node's SYSTEM updater only applies a package whose signature checks out against the public key Setup stored in
// Program Files (where the LocalService game account cannot write), so a compromised game server can't fake one.
// Node side: chunk/stage endpoints write into DATA_DIR/update; the updater picks it up from there.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'update-signing-key.pem');
const PUB_FILE = path.join(DATA_DIR, 'update-signing-key.pub.pem');
const PACKAGE = process.env.NODE_UPDATE_PACKAGE || path.join(__dirname, '..', '..', 'release', 'node-update.zip');
const UPDATE_DIR = process.env.NODE_UPDATE_DIR || path.join(DATA_DIR, 'update');
const MAX_PACKAGE = 300 * 1024 * 1024, CHUNK = 3 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'NODE_UPDATE_INVALID' });

// ---------- hub ----------
function signingKey() {
    if (!fs.existsSync(KEY_FILE)) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
        fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        fs.writeFileSync(PUB_FILE, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    }
    const key = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
    if (!fs.existsSync(PUB_FILE)) fs.writeFileSync(PUB_FILE, crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    return key;
}
const manifestText = m => `${m.version}\n${m.sha256}\n${m.size}`;
// Same rule as the updater's (installers/windows-node/service/apply-update.js): only a strictly newer release.
const RELEASE = /^\d{1,6}(\.\d{1,6}){1,3}$/;
function isNewer(candidate, current) {
    if (!RELEASE.test(candidate || '')) return false;
    if (!RELEASE.test(current || '')) return true;
    const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; }
    return false;
}
function packageInfo(file = PACKAGE) {
    if (!fs.existsSync(file)) return null;
    const version = fs.readFileSync(file.replace(/\.zip$/, '.version'), 'utf8').trim();
    if (!/^[\w.-]{1,40}$/.test(version)) throw fail('The update package has no valid version', 500);
    const data = fs.readFileSync(file);
    const manifest = { version, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length };
    const signature = crypto.sign(null, Buffer.from(manifestText(manifest)), signingKey()).toString('base64');
    return { manifest, signature, data };
}

// ---------- node ----------
const cleanSha = v => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw fail('Invalid package hash'); return v; };
function receiveChunk({ offset, data, total, sha256 }) {
    const sha = cleanSha(sha256);
    if (!Number.isInteger(total) || total < 1 || total > MAX_PACKAGE) throw fail('Invalid package size');
    if (!Number.isInteger(offset) || offset < 0 || offset >= total) throw fail('Invalid chunk offset');
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) throw fail('Chunk must be base64');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > CHUNK || offset + bytes.length > total) throw fail('Invalid chunk length');
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const file = path.join(UPDATE_DIR, `incoming-${sha}.zip`);
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (offset === 0 && have) fs.rmSync(file);
    else if (offset !== have) throw fail(`Expected the chunk at ${have}`, 409);
    fs.appendFileSync(file, bytes);
    return { received: offset + bytes.length, total };
}
function stage({ manifest, signature }) {
    if (!manifest || typeof manifest !== 'object') throw fail('Missing manifest');
    const sha = cleanSha(manifest.sha256);
    if (typeof manifest.version !== 'string' || !/^[\w.-]{1,40}$/.test(manifest.version) || !Number.isInteger(manifest.size)) throw fail('Invalid manifest');
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/=]{40,200}$/.test(signature)) throw fail('Invalid signature');
    const file = path.join(UPDATE_DIR, `incoming-${sha}.zip`);
    if (!fs.existsSync(file)) throw fail('No package received', 409);
    const data = fs.readFileSync(file);
    if (data.length !== manifest.size || crypto.createHash('sha256').update(data).digest('hex') !== sha) { fs.rmSync(file); throw fail('The package arrived damaged; send it again', 409); }
    // The updater re-verifies everything (hash + signature) as SYSTEM; this is only an early, friendly check.
    fs.renameSync(file, path.join(UPDATE_DIR, 'package.zip'));
    fs.writeFileSync(path.join(UPDATE_DIR, 'ready.json'), JSON.stringify({ manifest: { version: manifest.version, sha256: sha, size: manifest.size }, signature }));
    return { staged: true };
}
// On a Windows node this file is <install>\app\backend\services; the updater lives in <install>\service and (from
// protocol 2) writes its result to <install>\update-result.json, where the game account can't forge it.
const INSTALL_DIR = process.env.NODE_INSTALL_DIR || path.join(__dirname, '..', '..', '..');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function status() {
    return { version: currentVersion(), updater: updaterProtocol(), pending: fs.existsSync(path.join(UPDATE_DIR, 'ready.json')), result: readJson(path.join(INSTALL_DIR, 'update-result.json')) };
}
// 0 = no updater, 1 = the first one (verify-then-reopen; the panel won't push to it), 2+ = safe staging.
function updaterProtocol() {
    try { const m = /UPDATER_PROTOCOL\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(INSTALL_DIR, 'service', 'apply-update.js'), 'utf8')); return m ? Number(m[1]) : 1; }
    catch { return 0; }
}
function currentVersion() { try { return fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim() || 'dev'; } catch { return 'dev'; } }

module.exports = { signingKey, packageInfo, manifestText, isNewer, receiveChunk, stage, status, currentVersion, updaterProtocol, CHUNK, PUB_FILE, UPDATE_DIR };

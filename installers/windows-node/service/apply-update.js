// ServerForge node updater (claude, Daniel #gamemanager 3591/3595). Runs every minute as SYSTEM (scheduled task
// "ServerForge Updater", registered by Install-ServerForgeService.ps1) with the bundled node.exe.
// It applies a staged update only if the package's SHA-256 and size match a manifest signed by the panel's Ed25519
// key, checked against update-key.pem next to this file (Program Files: the LocalService game account can read but
// not write it). Then: stop services, unpack to a staging folder, swap app folders, start services, and roll back
// to the previous app if the services don't come up. Usage:
//   node apply-update.js --data <ProgramData\ServerForge\data> --install <Program Files\ServerForge> --key <update-key.pem>
//
// Protocol 2 (codex review, #gamemanager 3616). DATA_DIR\update can be written by the LocalService game account, so:
// - nothing there is trusted twice: ready.json and package.zip are read ONCE into memory, those bytes are verified,
//   written to a SYSTEM-only folder in Program Files, and only that copy is unpacked (no swap after verification);
// - links/junctions are refused (the folders and both files), and SYSTEM never writes there (the result goes to
//   Program Files\ServerForge\update-result.json, which the node app can read);
// - only a strictly newer release number is applied, so an old signed package can't be replayed to downgrade;
// - after a good update the updater replaces itself from app\updater (service\ isn't touched by app updates).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const UPDATER_PROTOCOL = 2;   // the node app reports this; the panel only pushes updates to protocol >= 2
const manifestText = m => `${m.version}\n${m.sha256}\n${m.size}`;
const RELEASE = /^\d{1,6}(\.\d{1,6}){1,3}$/;

// Is `candidate` a release number strictly newer than `current`? Builds before 1.0 used hashes; any release beats those.
function isNewer(candidate, current) {
    if (!RELEASE.test(candidate || '')) return false;
    if (!RELEASE.test(current || '')) return true;
    const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; }
    return false;
}

// Pure check, exported for tests: returns null when the package may be applied, else the reason.
function verify({ ready, packageBytes, publicKeyPem, currentVersion }) {
    const m = ready?.manifest;
    if (!m || typeof m.version !== 'string' || !/^[\w.-]{1,40}$/.test(m.version) || !/^[a-f0-9]{64}$/.test(m.sha256 || '') || !Number.isInteger(m.size)) return 'invalid manifest';
    if (typeof ready.signature !== 'string') return 'missing signature';
    let ok = false;
    try { ok = crypto.verify(null, Buffer.from(manifestText(m)), crypto.createPublicKey(publicKeyPem), Buffer.from(ready.signature, 'base64')); } catch { ok = false; }
    if (!ok) return 'signature does not match this panel\'s key';
    if (!packageBytes || packageBytes.length !== m.size) return 'package size does not match';
    if (crypto.createHash('sha256').update(packageBytes).digest('hex') !== m.sha256) return 'package hash does not match';
    if (currentVersion !== undefined && !isNewer(m.version, currentVersion)) return `version ${m.version} is not newer than the installed ${currentVersion || 'version'}`;
    return null;
}

// lstat reports junctions as links on Windows too. Throws unless `p` is a real folder/file (or, if allowed, absent).
function plain(p, kind, { mayBeMissing = false } = {}) {
    let st;
    try { st = fs.lstatSync(p); } catch (err) { if (mayBeMissing && err.code === 'ENOENT') return false; throw err; }
    if (st.isSymbolicLink()) throw new Error(`${p} is a link; refusing to use it`);
    if (kind === 'dir' ? !st.isDirectory() : !st.isFile()) throw new Error(`${p} is not a ${kind === 'dir' ? 'folder' : 'file'}`);
    return true;
}
// Read a file in DATA_DIR once, refusing links, and check it wasn't swapped for another file while opening.
function readOnce(p, max) {
    plain(p, 'file');
    const before = fs.lstatSync(p, { bigint: true });
    const fd = fs.openSync(p, 'r');
    try {
        const st = fs.fstatSync(fd, { bigint: true });
        if (st.ino !== before.ino || st.dev !== before.dev || !st.isFile()) throw new Error(`${p} changed while opening`);
        if (st.size > BigInt(max)) throw new Error(`${p} is too large`);
        const buf = Buffer.alloc(Number(st.size)); let off = 0;
        while (off < buf.length) { const n = fs.readSync(fd, buf, off, buf.length - off, off); if (!n) break; off += n; }
        return buf.subarray(0, off);
    } finally { fs.closeSync(fd); }
}

function main(argv = process.argv) {
    const arg = name => { const i = argv.indexOf(`--${name}`); return i > 0 ? argv[i + 1] : null; };
    const dataDir = arg('data'), installDir = arg('install'), keyFile = arg('key');
    if (!dataDir || !installDir || !keyFile) { console.error('usage: --data --install --key'); return 2; }
    const updDir = path.join(dataDir, 'update');
    const readyFile = path.join(updDir, 'ready.json'), pkgFile = path.join(updDir, 'package.zip');
    const resultFile = path.join(installDir, 'update-result.json');   // Program Files: only SYSTEM writes here
    try { if (!plain(dataDir, 'dir', { mayBeMissing: true }) || !plain(updDir, 'dir', { mayBeMissing: true })) return 0; }
    catch (err) { console.error(err.message); return 1; }   // a planted link: touch nothing
    if (!fs.existsSync(readyFile)) return 0;   // nothing to do (the usual case, every minute)
    const result = (status, extra = {}) => fs.writeFileSync(resultFile, JSON.stringify({ status, at: new Date().toISOString(), protocol: UPDATER_PROTOCOL, ...extra }));
    // Deleting only unlinks names inside updDir (checked above); it never follows a link.
    const clear = () => { for (const f of [readyFile, pkgFile]) try { fs.unlinkSync(f); } catch { /* ignore */ } };
    const app = path.join(installDir, 'app'), old = path.join(installDir, 'app.old'), staging = path.join(installDir, 'app.staging');
    const work = path.join(installDir, 'update-work'), workPkg = path.join(work, 'package.zip');
    let currentVersion = '';
    try { currentVersion = fs.readFileSync(path.join(app, 'VERSION'), 'utf8').trim(); } catch { /* very old build */ }

    let ready, packageBytes;
    try {
        ready = JSON.parse(readOnce(readyFile, 64 * 1024).toString('utf8'));
        packageBytes = readOnce(pkgFile, 300 * 1024 * 1024);
    } catch (err) { result('failed', { error: `Update refused: ${err.message}` }); clear(); return 1; }
    const reason = verify({ ready, packageBytes, publicKeyPem: fs.readFileSync(keyFile), currentVersion });
    if (reason) { result('failed', { error: `Update refused: ${reason}` }); clear(); return 1; }
    clear();   // from here on only the verified bytes in memory / the SYSTEM-only copy are used

    const version = ready.manifest.version;
    const sc = (...a) => spawnSync('sc.exe', a, { encoding: 'utf8', windowsHide: true });
    const state = name => (/STATE\s*:\s*\d+\s+(\w+)/.exec(sc('query', name).stdout || '') || [])[1] || 'UNKNOWN';
    const waitFor = (name, want, secs) => { for (let i = 0; i < secs * 2; i++) { if (state(name) === want) return true; spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], { windowsHide: true }); } return false; };
    const stopAll = () => { for (const s of ['ServerForgeNode', 'ServerForge']) { sc('stop', s); waitFor(s, 'STOPPED', 40); } };
    const startAll = () => { for (const s of ['ServerForge', 'ServerForgeNode']) sc('start', s); return waitFor('ServerForge', 'RUNNING', 40) && waitFor('ServerForgeNode', 'RUNNING', 40); };

    result('applying', { version });
    try {
        for (const p of [work, staging]) fs.rmSync(p, { recursive: true, force: true });
        fs.mkdirSync(work);
        fs.writeFileSync(workPkg, packageBytes, { flag: 'wx' });
        const ex = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${workPkg.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`], { encoding: 'utf8', windowsHide: true });
        if (ex.status !== 0 || !fs.existsSync(path.join(staging, 'app', 'backend', 'server.js'))) throw new Error(`could not unpack the package ${ex.stderr || ''}`.trim());
        if (fs.readFileSync(path.join(staging, 'app', 'VERSION'), 'utf8').trim() !== version) throw new Error('the package version does not match its manifest');
    } catch (err) { result('failed', { error: `Update not applied: ${err.message}` }); for (const p of [work, staging]) fs.rmSync(p, { recursive: true, force: true }); return 1; }
    fs.rmSync(work, { recursive: true, force: true });

    stopAll();
    try {
        fs.rmSync(old, { recursive: true, force: true });
        fs.renameSync(app, old);
        fs.renameSync(path.join(staging, 'app'), app);
        fs.rmSync(staging, { recursive: true, force: true });
    } catch (err) {
        if (!fs.existsSync(app) && fs.existsSync(old)) fs.renameSync(old, app);
        startAll(); result('failed', { error: `Could not swap the app folder: ${err.message}` }); return 1;
    }
    if (startAll()) { selfUpdate(app); result('done', { version }); return 0; }
    // New version didn't come up: put the old one back.
    stopAll();
    try { fs.rmSync(app + '.failed', { recursive: true, force: true }); fs.renameSync(app, app + '.failed'); fs.renameSync(old, app); } catch { /* best effort */ }
    startAll();
    result('failed', { error: `Version ${version} did not start; the previous version was restored.` });
    return 1;
}

// Replace this script with the copy the (verified) package brought, if it differs. Write-then-rename, so a
// half-written updater never runs.
function selfUpdate(app) {
    try {
        const next = path.join(app, 'updater', 'apply-update.js');
        if (!fs.existsSync(next)) return;
        const code = fs.readFileSync(next);
        if (code.equals(fs.readFileSync(__filename))) return;
        const tmp = `${__filename}.new`;
        fs.writeFileSync(tmp, code); fs.renameSync(tmp, __filename);
    } catch (err) { console.error(`Updater self-update skipped: ${err.message}`); }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, verify, manifestText, isNewer, plain, readOnce, UPDATER_PROTOCOL };

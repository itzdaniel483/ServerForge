// ServerForge node updater (claude, Daniel #gamemanager 3591/3595). Runs every minute as SYSTEM (scheduled task
// "ServerForge Updater", registered by Install-ServerForgeService.ps1) with the bundled node.exe.
// It applies a staged update only if the package's SHA-256 and size match a manifest signed by the panel's Ed25519
// key, checked against update-key.pem next to this file (Program Files: the LocalService game account can read but
// not write it). Then: stop services, unpack to a staging folder, swap app folders, start services, and roll back
// to the previous app if the services don't come up. Usage:
//   node apply-update.js --data <ProgramData\ServerForge\data> --install <Program Files\ServerForge> --key <update-key.pem>
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const manifestText = m => `${m.version}\n${m.sha256}\n${m.size}`;

// Pure check, exported for tests: returns null when the package may be applied, else the reason.
function verify({ ready, packageBytes, publicKeyPem }) {
    const m = ready?.manifest;
    if (!m || typeof m.version !== 'string' || !/^[\w.-]{1,40}$/.test(m.version) || !/^[a-f0-9]{64}$/.test(m.sha256 || '') || !Number.isInteger(m.size)) return 'invalid manifest';
    if (typeof ready.signature !== 'string') return 'missing signature';
    let ok = false;
    try { ok = crypto.verify(null, Buffer.from(manifestText(m)), crypto.createPublicKey(publicKeyPem), Buffer.from(ready.signature, 'base64')); } catch { ok = false; }
    if (!ok) return 'signature does not match this panel\'s key';
    if (!packageBytes || packageBytes.length !== m.size) return 'package size does not match';
    if (crypto.createHash('sha256').update(packageBytes).digest('hex') !== m.sha256) return 'package hash does not match';
    return null;
}

function main() {
    const dataDir = arg('data'), installDir = arg('install'), keyFile = arg('key');
    if (!dataDir || !installDir || !keyFile) { console.error('usage: --data --install --key'); return 2; }
    const updDir = path.join(dataDir, 'update');
    const readyFile = path.join(updDir, 'ready.json'), pkgFile = path.join(updDir, 'package.zip'), resultFile = path.join(updDir, 'result.json');
    if (!fs.existsSync(readyFile)) return 0;   // nothing to do (the usual case, every minute)
    const result = (status, extra = {}) => fs.writeFileSync(resultFile, JSON.stringify({ status, at: new Date().toISOString(), ...extra }));
    const clear = () => { for (const f of [readyFile, pkgFile]) try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } };
    let ready;
    try { ready = JSON.parse(fs.readFileSync(readyFile, 'utf8')); } catch { result('failed', { error: 'Unreadable update request' }); clear(); return 1; }
    const reason = verify({ ready, packageBytes: fs.existsSync(pkgFile) ? fs.readFileSync(pkgFile) : null, publicKeyPem: fs.readFileSync(keyFile) });
    if (reason) { result('failed', { error: `Update refused: ${reason}` }); clear(); return 1; }

    const version = ready.manifest.version;
    const sc = (...a) => spawnSync('sc.exe', a, { encoding: 'utf8', windowsHide: true });
    const state = name => (/STATE\s*:\s*\d+\s+(\w+)/.exec(sc('query', name).stdout || '') || [])[1] || 'UNKNOWN';
    const waitFor = (name, want, secs) => { for (let i = 0; i < secs * 2; i++) { if (state(name) === want) return true; spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], { windowsHide: true }); } return false; };
    const stopAll = () => { for (const s of ['ServerForgeNode', 'ServerForge']) { sc('stop', s); waitFor(s, 'STOPPED', 40); } };
    const startAll = () => { for (const s of ['ServerForge', 'ServerForgeNode']) sc('start', s); return waitFor('ServerForge', 'RUNNING', 40) && waitFor('ServerForgeNode', 'RUNNING', 40); };

    result('applying', { version });
    const app = path.join(installDir, 'app'), old = path.join(installDir, 'app.old'), staging = path.join(installDir, 'app.staging');
    try {
        fs.rmSync(staging, { recursive: true, force: true });
        const ex = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${pkgFile.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`], { encoding: 'utf8', windowsHide: true });
        if (ex.status !== 0 || !fs.existsSync(path.join(staging, 'app', 'backend', 'server.js'))) throw new Error(`could not unpack the package ${ex.stderr || ''}`.trim());
        if (fs.readFileSync(path.join(staging, 'app', 'VERSION'), 'utf8').trim() !== version) throw new Error('the package version does not match its manifest');
    } catch (err) { result('failed', { error: `Update not applied: ${err.message}` }); fs.rmSync(staging, { recursive: true, force: true }); clear(); return 1; }

    stopAll();
    try {
        fs.rmSync(old, { recursive: true, force: true });
        fs.renameSync(app, old);
        fs.renameSync(path.join(staging, 'app'), app);
        fs.rmSync(staging, { recursive: true, force: true });
    } catch (err) {
        if (!fs.existsSync(app) && fs.existsSync(old)) fs.renameSync(old, app);
        startAll(); result('failed', { error: `Could not swap the app folder: ${err.message}` }); clear(); return 1;
    }
    if (startAll()) { result('done', { version }); clear(); return 0; }
    // New version didn't come up: put the old one back.
    stopAll();
    try { fs.rmSync(app + '.failed', { recursive: true, force: true }); fs.renameSync(app, app + '.failed'); fs.renameSync(old, app); } catch { /* best effort */ }
    startAll();
    result('failed', { error: `Version ${version} did not start; the previous version was restored.` }); clear();
    return 1;
}

if (require.main === module) process.exitCode = main();
module.exports = { verify, manifestText };

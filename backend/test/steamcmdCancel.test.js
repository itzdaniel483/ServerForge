const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let tmp, steamcmd;
const isRunning = async pid => {
    try {
        const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
        return !/^\d+ \(.*\) [ZX]/.test(stat);
    } catch { return false; }
};

test.before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-steamcancel-'));
    process.env.STEAMCMD_DIR = tmp;
    const script = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.argv[process.argv.indexOf('+force_install_dir') + 1];
if (mode.endsWith('signal')) { process.kill(process.pid, 'SIGTERM'); }
else if (mode.endsWith('success')) {
 process.stdout.write('Success! App 1 fully installed.');
 setTimeout(() => { fs.writeFileSync(mode + '.closed', 'done'); process.exit(0); }, 100);
} else if (mode.endsWith('split')) {
 process.stdout.write('Success! Ap');
 setTimeout(() => { process.stdout.write('p 1 already up to date.'); process.kill(process.pid, 'SIGTERM'); }, 20);
} else if (mode.endsWith('success-hang')) {
 process.on('SIGTERM', () => {});
 fs.writeFileSync(mode + '.pid', String(process.pid));
 process.stdout.write('Success! App 1 fully installed.');
 setInterval(() => {}, 1000);
} else {
 process.on('SIGTERM', () => {});
 const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
 fs.writeFileSync(mode + '.pids', process.pid + ' ' + child.pid);
 setTimeout(() => process.stdout.write('READY\\n'), 100);
 setInterval(() => {}, 1000);
}
`;
    await fs.writeFile(path.join(tmp, 'steamcmd.sh'), script, { mode: 0o755 });
    steamcmd = require('../services/steamcmd');
});
test.after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

test('abort before/during initialization never spawns an installer', async () => {
    const originalInit = steamcmd.init;
    let initCalls = 0, release;
    steamcmd.ready = false;
    steamcmd.init = () => { initCalls++; return new Promise(resolve => { release = resolve; }); };
    try {
        const before = new AbortController(); before.abort();
        await assert.rejects(steamcmd.install('1', tmp, null, null, { signal: before.signal }), { code: 'ABORT_ERR' });
        assert.equal(initCalls, 0);
        const during = new AbortController();
        const installing = steamcmd.install('1', tmp, null, null, { signal: during.signal });
        during.abort();
        await assert.rejects(installing, { name: 'AbortError', code: 'ABORT_ERR' });
        release();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(steamcmd.children.size, 0);
    } finally { steamcmd.init = originalInit; steamcmd.ready = false; }
});

test('abort kills SteamCMD and its TERM-resistant descendant before returning', { skip: process.platform !== 'linux' }, async () => {
    const controller = new AbortController();
    const installPath = path.join(tmp, 'cancel');
    await assert.rejects(steamcmd.install('1', installPath, msg => {
        if (msg.includes('READY')) controller.abort();
    }, null, { signal: controller.signal }), { code: 'ABORT_ERR' });
    const pids = (await fs.readFile(installPath + '.pids', 'utf8')).split(' ').map(Number);
    // SIGKILL has been issued before rejection; allow the scheduler to reap the processes.
    for (let i = 0; i < 30 && (await Promise.all(pids.map(isRunning))).some(Boolean); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(await Promise.all(pids.map(isRunning)), [false, false]);
    assert.equal(steamcmd.children.size, 0);
});

test('signal exit is failure without success, and success waits for child close', { skip: process.platform === 'win32' }, async () => {
    await assert.rejects(steamcmd.install('1', path.join(tmp, 'signal')), /SIGTERM/);
    const installPath = path.join(tmp, 'success');
    await steamcmd.install('1', installPath);
    assert.equal(await fs.readFile(installPath + '.closed', 'utf8'), 'done');
    await steamcmd.install('1', path.join(tmp, 'split'));
    assert.equal(steamcmd.children.size, 0);
});

test('a successful but hung SteamCMD is closed before resolution', { skip: process.platform !== 'linux' }, async () => {
    const installPath = path.join(tmp, 'success-hang');
    await steamcmd.install('1', installPath);
    const pid = Number(await fs.readFile(installPath + '.pid', 'utf8'));
    assert.equal(await isRunning(pid), false);
    assert.equal(steamcmd.children.size, 0);
});

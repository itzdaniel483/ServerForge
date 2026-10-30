const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const STEAMCMD_URL = IS_WIN
    ? 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
    : 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
// Downloaded on first use; never committed to git.
const INSTALL_DIR = process.env.STEAMCMD_DIR || path.join(__dirname, '..', 'steamcmd');
const EXECUTABLE = path.join(INSTALL_DIR, IS_WIN ? 'steamcmd.exe' : 'steamcmd.sh');

class SteamCMD {
    constructor() {
        this.ready = false;
        this.initializing = null;
        this.children = new Set();
    }

    async init() {
        if (this.initializing) return this.initializing;
        this.initializing = this.initialize().finally(() => { this.initializing = null; });
        return this.initializing;
    }

    async initialize() {
        if (fs.existsSync(EXECUTABLE)) {
            this.ready = true;
            console.log('SteamCMD found.');
            return;
        }
        console.log('SteamCMD not found. Downloading...');
        await this.downloadAndExtract();
    }

    async downloadAndExtract() {
        await fs.ensureDir(INSTALL_DIR);
        const zipPath = path.join(INSTALL_DIR, IS_WIN ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz');

        const writer = fs.createWriteStream(zipPath);
        const response = await axios({
            url: STEAMCMD_URL,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    console.log('Download complete. Extracting...');
                    if (IS_WIN) {
                        new AdmZip(zipPath).extractAllTo(INSTALL_DIR, true);
                    } else {
                        await new Promise((ok, fail) => {
                            const tar = spawn('tar', ['-xzf', zipPath, '-C', INSTALL_DIR]);
                            tar.on('error', fail);
                            tar.on('close', code => code === 0 ? ok() : fail(new Error(`tar exited with code ${code}`)));
                        });
                    }
                    fs.unlinkSync(zipPath); // Cleanup
                    this.ready = true;
                    console.log('SteamCMD ready.');
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
            writer.on('error', reject);
        });
    }

    async createServerConfig(installPath, gameDir, rconPassword, hostname) {
        const cfgPath = path.join(installPath, gameDir, 'cfg', 'server.cfg');
        await fs.ensureDir(path.dirname(cfgPath));

        const content = `
hostname "${hostname}"
rcon_password "${rconPassword}"
        `.trim();

        await fs.writeFile(cfgPath, content);
        console.log(`Created server config at ${cfgPath}`);
    }

    async install(appId, installPath, onLog, beta = null, { signal } = {}) {
        const abortError = () => Object.assign(new Error('SteamCMD install cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
        if (signal?.aborted) throw abortError();
        if (!/^\d{1,12}$/.test(String(appId))) throw new Error('Invalid app ID');
        if (!this.ready) {
            // Initialization is shared. One caller cancelling must not cancel another caller's download,
            // but this install must return promptly and never spawn after its signal has been aborted.
            await new Promise((resolve, reject) => {
                const aborted = () => { cleanup(); reject(abortError()); };
                const cleanup = () => signal?.removeEventListener('abort', aborted);
                signal?.addEventListener('abort', aborted, { once: true });
                if (signal?.aborted) return aborted();
                this.init().then(() => { cleanup(); resolve(); }, err => { cleanup(); reject(err); });
            });
        }
        if (signal?.aborted) throw abortError();

        return new Promise((resolve, reject) => {
            const args = ['+force_install_dir', installPath, '+login', 'anonymous', '+app_update', String(appId)];
            if (beta) args.push('-beta', beta);
            args.push('+quit');
            const child = spawn(EXECUTABLE, args, { detached: !IS_WIN });
            this.children.add(child);
            let success = false, aborted = false, closed = false, settled = false;
            let exitCode, exitSignal, startError, successTimer, killTimer;
            let terminating = false, treeKilled = false;
            let outputTail = '';

            const killTree = force => {
                if (!child.pid) return;
                if (IS_WIN) {
                    // taskkill traverses descendants even when SteamCMD has spawned a wrapper.
                    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                    killer.on('error', () => { try { child.kill(); } catch { /* already exited */ } });
                } else {
                    try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
                    catch (err) { if (err.code !== 'ESRCH') { try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already exited */ } } }
                }
            };
            const finish = () => {
                if (settled || !closed || (terminating && !treeKilled)) return;
                settled = true;
                clearTimeout(successTimer); clearTimeout(killTimer);
                signal?.removeEventListener('abort', onAbort);
                this.children.delete(child);
                if (aborted) reject(abortError());
                else if (startError) reject(new Error(`SteamCMD could not start: ${startError.message}`));
                else if (success || exitCode === 0 || exitCode === 7) resolve();
                else reject(new Error(`SteamCMD exited with code ${exitCode}${exitSignal ? ` (${exitSignal})` : ''}`));
            };
            const terminate = () => {
                if (terminating) return;
                terminating = true;
                killTree(false);
                // Keep the escalation even if the parent closes first: descendants may ignore TERM.
                killTimer = setTimeout(() => { killTree(true); treeKilled = true; finish(); }, 1000);
            };
            const onAbort = () => { aborted = true; clearTimeout(successTimer); terminate(); };
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();

            child.on('error', err => { startError = err; });
            child.stdout.on('data', data => {
                const msg = data.toString();
                if (onLog && !success && !aborted) onLog(msg);
                // SteamCMD may split a success line over stream chunks.
                outputTail = (outputTail + msg).slice(-8192);
                if (!success && !aborted && /Success! App[^\r\n]*(?:fully installed|already up to date)/.test(outputTail)) {
                    success = true;
                    // Allow normal cleanup, then stop a hung process without resolving before close.
                    successTimer = setTimeout(terminate, 2000);
                }
            });
            child.stderr.on('data', data => { if (onLog && !success && !aborted) onLog(data.toString()); });
            child.on('close', (code, sig) => { closed = true; exitCode = code; exitSignal = sig; finish(); });
        });
    }

    // Download one Workshop item and copy it to <server>/garrysmod/addons/<id>.
    // server.js called this but it was never written, so every Workshop install failed.
    async downloadWorkshopAddon(workshopId, serverPath, appId = 4000) {
        if (!/^\d{1,12}$/.test(String(workshopId)) || !/^\d{1,12}$/.test(String(appId))) throw new Error('Invalid Workshop ID');
        if (!this.ready) await this.init();
        await new Promise((resolve, reject) => {
            const child = spawn(EXECUTABLE, ['+login', 'anonymous', '+workshop_download_item', String(appId), String(workshopId), '+quit']);
            let out = '';
            child.stdout.on('data', d => { out += d.toString(); });
            child.on('error', err => reject(new Error(`SteamCMD could not start: ${err.message}`)));
            child.on('close', code => (/Success\. Downloaded item/.test(out) || code === 0) ? resolve() : reject(new Error(`Workshop download failed (code ${code})`)));
        });
        const source = path.join(INSTALL_DIR, 'steamapps', 'workshop', 'content', String(appId), String(workshopId));
        if (!await fs.pathExists(source)) throw new Error('Workshop item downloaded but no files were found');
        const target = path.join(serverPath, 'garrysmod', 'addons', String(workshopId));
        await fs.ensureDir(path.dirname(target));
        await fs.copy(source, target, { overwrite: true });
    }
}

module.exports = new SteamCMD();

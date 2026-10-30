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
    }

    async init() {
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

    async install(appId, installPath, onLog, beta = null) {
        if (!this.ready) await this.init();

        if (!/^\d{1,12}$/.test(String(appId))) throw new Error('Invalid app ID');
        return new Promise((resolve, reject) => {
            const args = [
                '+force_install_dir', installPath,
                '+login', 'anonymous',
                '+app_update', appId
            ];

            // Add beta branch if specified
            if (beta) {
                args.push('-beta', beta);
            }

            args.push('+quit');

            console.log(`Running SteamCMD: ${EXECUTABLE} ${args.join(' ')}`);
            const process = spawn(EXECUTABLE, args);

            let isFinished = false;
            // Without this, a missing SteamCMD crashes the whole panel instead of failing the install.
            process.on('error', err => reject(new Error(`SteamCMD could not start: ${err.message}`)));

            process.stdout.on('data', (data) => {
                const msg = data.toString();
                // Only emit logs if we haven't finished yet
                if (onLog && !isFinished) onLog(msg);
                console.log(`[SteamCMD] ${msg.trim()}`);

                // Detect success message to handle cases where SteamCMD hangs
                if ((msg.includes('Success! App') && msg.includes('fully installed')) ||
                    (msg.includes('Success! App') && msg.includes('already up to date'))) {
                    console.log('[SteamCMD] Success message detected. Marking as complete.');
                    isFinished = true; // Stop sending logs to frontend

                    // We wait a brief moment for any final cleanup then resolve
                    setTimeout(() => {
                        if (!process.killed) process.kill(); // Force kill if it hangs
                        resolve();
                    }, 2000);
                }
            });

            process.stderr.on('data', (data) => {
                const msg = data.toString();
                if (onLog && !isFinished) onLog(msg);
                console.error(`[SteamCMD Error] ${msg.trim()}`);
            });

            process.on('close', (code) => {
                console.log(`[SteamCMD] Process exited with code ${code}`);
                // SteamCMD exit codes: 0 = success, 7 = reboot required
                if (code === 0 || code === 7 || code === null) { // code is null if we killed it
                    resolve();
                } else {
                    reject(new Error(`SteamCMD exited with code ${code}`));
                }
            });
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

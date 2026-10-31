// What a machine is set up with (claude, Daniel #gamemanager 3730: "when I click into a Node I should be able to see its
// configuration like where games are set to install or the directory of current servers"). Read-only, admin only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SERVERS_ROOT } = require('../middleware/guard');

const dirs = () => [
    ['servers', 'Game servers', SERVERS_ROOT],
    ['cache', 'Download cache', process.env.CACHE_DIR || path.join(__dirname, '../..', 'cache')],
    ['backups', 'Backups', process.env.BACKUPS_DIR || path.join(__dirname, '../backups')],
    ['steamcmd', 'SteamCMD', process.env.STEAMCMD_DIR || path.join(__dirname, '..', 'steamcmd')],
    ['data', 'Panel data', process.env.DATA_DIR || path.join(__dirname, '..', 'data')],
];

async function folder([key, label, dir]) {
    const full = path.resolve(dir);
    const out = { key, label, path: full, exists: fs.existsSync(full), free: null, total: null };
    try {
        const st = await fs.promises.statfs(full);
        const free = st.bsize * st.bavail, total = st.bsize * st.blocks;
        if (Number.isSafeInteger(free) && Number.isSafeInteger(total)) Object.assign(out, { free, total });
    } catch { /* missing folder or no statfs: shown as unknown */ }
    return out;
}

async function machineInfo({ servers = [], version = 'dev', statusOf = s => s.status } = {}) {
    return {
        hostname: os.hostname(), platform: process.platform, os: `${os.type()} ${os.release()}`, arch: process.arch,
        cpus: os.cpus().length, memory: os.totalmem(), uptime: Math.round(os.uptime()), runtime: process.version, version,
        folders: await Promise.all(dirs().map(folder)),
        servers: servers.map(s => ({ id: s.id, name: s.name, game: s.game || null, port: Number.isInteger(s.port) ? s.port : null,
            status: statusOf(s) || 'stopped', path: s.path ? path.resolve(s.path) : null })),
    };
}

module.exports = { machineInfo };

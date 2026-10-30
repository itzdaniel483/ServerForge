// Extra files some game modes need (claude, Daniel #gamemanager 3576: "DarkRP and other gamemodes installable").
// Each download is pinned to an exact commit AND its SHA-256; anything else is refused. Zip entries are checked so
// nothing can be written outside the target folder.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const DOWNLOADS = {
    darkrp: [
        { label: 'DarkRP gamemode', url: 'https://codeload.github.com/FPtje/DarkRP/zip/5abcf7abab9e489b2d882a55d95f84c206d9d05c',
            sha256: 'eef02496240233bb4eecdea31b266994bd1c2c94e40c0509956381adc3ffc86c', into: 'garrysmod/gamemodes/darkrp' },
        { label: 'DarkRP settings addon (darkrpmodification)', url: 'https://codeload.github.com/FPtje/darkrpmodification/zip/7c318f14afc9445343aa312320f54dd4bc4a0ada',
            sha256: 'eb495c4b61c8b9d9f667c2f41a344465287693d6daa717368a811c14cf41b5f7', into: 'garrysmod/addons/darkrpmodification' },
    ],
};

function inside(root, p) { const rel = path.relative(root, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }

// Unpack a GitHub archive (single top folder) into dest, refusing any entry that would land outside it.
function unpack(buffer, dest) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const top = entries[0]?.entryName.split('/')[0];
    if (!top || entries.some(e => !e.entryName.startsWith(`${top}/`))) throw new Error('Unexpected archive layout');
    fs.mkdirSync(dest, { recursive: true });
    for (const e of entries) {
        const rel = e.entryName.slice(top.length + 1);
        if (!rel) continue;
        const target = path.resolve(dest, rel);
        if (!inside(dest, target)) throw new Error(`Refusing archive entry outside the folder: ${e.entryName}`);
        if (e.isDirectory) fs.mkdirSync(target, { recursive: true });
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.getData()); }
    }
}

async function installModeFiles(modeDownload, serverPath, onLog = () => {}, fetch = url => axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 50 * 1024 * 1024 }).then(r => Buffer.from(r.data))) {
    const list = DOWNLOADS[modeDownload];
    if (!list) throw new Error(`Unknown mode download: ${modeDownload}`);
    for (const d of list) {
        onLog(`Downloading ${d.label}…\n`);
        const data = await fetch(d.url);
        const sha = crypto.createHash('sha256').update(data).digest('hex');
        if (sha !== d.sha256) throw new Error(`${d.label} did not match its pinned checksum; not installed`);
        const dest = path.resolve(serverPath, d.into);
        if (!inside(path.resolve(serverPath), dest)) throw new Error('Bad target folder');
        unpack(data, dest);
        onLog(`Installed ${d.label} into ${d.into}\n`);
    }
}

module.exports = { installModeFiles, unpack, DOWNLOADS };

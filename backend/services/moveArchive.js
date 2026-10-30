// Move a server between machines, per-machine part (claude, Daniel #gamemanager 3576/3580: fresh install on the
// target + copy configs/saves). Each panel can pack a server's "keep" paths into an archive, hand it out in chunks,
// and receive + unpack one into a server folder. The hub orchestrates (services/moveJob.js).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'moves');
const CHUNK = 3 * 1024 * 1024, MAX = 1024 * 1024 * 1024;
const fail = (m, status = 400) => Object.assign(new Error(m), { status, code: 'MOVE_INVALID' });
const token = v => { if (typeof v !== 'string' || !/^[a-f0-9]{32}$/.test(v)) throw fail('Invalid move token'); return v; };
const inside = (root, p) => { const rel = path.relative(root, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

// What survives a move: settings files and saves. Source games: cfg, data, addons, sv.db and downloaded gamemodes.
function keepPaths(game) {
    if (Array.isArray(game?.keep)) return game.keep;
    if (game?.engine === 'source' && game.gameDir) return ['cfg', 'data', 'addons', 'sv.db', 'gamemodes/darkrp', 'maps'].map(p => `${game.gameDir}/${p}`);
    return [];
}

function exportServer(serverPath, keep) {
    fs.mkdirSync(DIR, { recursive: true });
    const zip = new AdmZip(); let bytes = 0;
    for (const rel of keep) {
        const abs = path.resolve(serverPath, rel);
        if (!inside(path.resolve(serverPath), abs) || !fs.existsSync(abs)) continue;
        const st = fs.statSync(abs);
        if (st.isDirectory()) zip.addLocalFolder(abs, rel); else zip.addLocalFile(abs, path.dirname(rel) === '.' ? '' : path.dirname(rel));
        bytes += st.isDirectory() ? 0 : st.size;
        if (bytes > MAX) throw fail('There is too much to move in one go (over 1 GB of configs/saves)');
    }
    const id = crypto.randomBytes(16).toString('hex');
    const file = path.join(DIR, `out-${id}.zip`);
    zip.writeZip(file);
    return { token: id, size: fs.statSync(file).size, entries: zip.getEntries().length };
}
function readChunk(t, offset) {
    const file = path.join(DIR, `out-${token(t)}.zip`);
    if (!fs.existsSync(file)) throw fail('Archive not found', 404);
    const size = fs.statSync(file).size, off = Number(offset);
    if (!Number.isInteger(off) || off < 0 || off > size) throw fail('Invalid offset');
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(CHUNK, size - off));
    try { fs.readSync(fd, buf, 0, buf.length, off); } finally { fs.closeSync(fd); }
    return { data: buf.toString('base64'), offset: off, size };
}
function receiveChunk({ token: t, offset, data, total }) {
    const file = path.join(DIR, `in-${token(t)}.zip`);
    if (!Number.isInteger(total) || total < 1 || total > MAX * 2) throw fail('Invalid size');
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(data)) throw fail('Chunk must be base64');
    const bytes = Buffer.from(data, 'base64');
    fs.mkdirSync(DIR, { recursive: true });
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (offset === 0 && have) fs.rmSync(file); else if (offset !== have) throw fail(`Expected the chunk at ${have}`, 409);
    if (bytes.length > CHUNK || offset + bytes.length > total) throw fail('Invalid chunk');
    fs.appendFileSync(file, bytes);
    return { received: offset + bytes.length };
}
function importInto(serverPath, t) {
    const file = path.join(DIR, `in-${token(t)}.zip`);
    if (!fs.existsSync(file)) throw fail('Nothing received', 409);
    const root = path.resolve(serverPath);
    const zip = new AdmZip(file);
    let count = 0;
    for (const e of zip.getEntries()) {
        const target = path.resolve(root, e.entryName);
        if (!inside(root, target)) throw fail(`Refusing archive entry outside the server folder: ${e.entryName}`);
        if (e.isDirectory) fs.mkdirSync(target, { recursive: true });
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.getData()); count++; }
    }
    fs.rmSync(file, { force: true });
    return { files: count };
}
function cleanup(t) { for (const p of ['out', 'in']) fs.rmSync(path.join(DIR, `${p}-${token(t)}.zip`), { force: true }); return { removed: true }; }

module.exports = { keepPaths, exportServer, readChunk, receiveChunk, importInto, cleanup, CHUNK };

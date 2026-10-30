// Crash-safe JSON files. A power cut during a plain writeFile can leave a 0-byte file
// (this happened to servers.json on 2026-10-30). Writes go to a temp file, are fsynced,
// then renamed over the original; the previous good copy is kept as <file>.bak.
// Reads fall back to the .bak copy when the main file is missing, empty or corrupt.
const fs = require('fs');
const path = require('path');

function writeJsonSync(file, data, { mode = 0o600, indent = 2 } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', mode);
    try {
        fs.writeSync(fd, JSON.stringify(data, null, indent));
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    if (isGood(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
    try {
        const dir = fs.openSync(path.dirname(file), 'r');
        fs.fsyncSync(dir);
        fs.closeSync(dir);
    } catch { /* directory fsync is best effort */ }
}

function parse(file) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) throw new Error('empty');
    return JSON.parse(text);
}

function isGood(file) {
    try { parse(file); return true; } catch { return false; }
}

// Returns the parsed file, else the .bak copy, else `fallback` (missing on first run is normal).
function readJsonSync(file, fallback) {
    try {
        return parse(file);
    } catch (err) {
        const firstRun = err.code === 'ENOENT';
        try {
            const data = parse(`${file}.bak`);
            console.error(`[jsonFile] ${path.basename(file)} unreadable (${err.message}); restored from .bak`);
            return data;
        } catch {
            if (!firstRun) console.error(`[jsonFile] ${path.basename(file)} unreadable (${err.message}) and no good .bak`);
            return fallback;
        }
    }
}

// True when the file exists but is unreadable and there is no backup: callers that would
// otherwise rebuild defaults (e.g. a new admin) should refuse instead of overwriting it.
function isCorruptWithoutBackup(file) {
    return fs.existsSync(file) && fs.statSync(file).size > 0 && !isGood(file) && !isGood(`${file}.bak`);
}

module.exports = {
    writeJsonSync,
    readJsonSync,
    isCorruptWithoutBackup,
    writeJson: async (file, data, opts) => writeJsonSync(file, data, opts),
    readJson: async (file, fallback) => readJsonSync(file, fallback),
};

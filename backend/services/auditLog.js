// Activity log (claude, 2026-10-30): who did what to which server, newest first.
// JSON Lines in DATA_DIR/activity.jsonl, trimmed to the last 2000 entries. No passwords or file contents.
const fs = require('fs-extra');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'activity.jsonl');
const MAX = 2000;
let writes = 0;

function add(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    try {
        fs.ensureDirSync(path.dirname(FILE));
        fs.appendFileSync(FILE, line, { mode: 0o600 });
        if (++writes % 100 === 0) trim();
    } catch (err) {
        console.error('Activity log write failed:', err.message);
    }
}

function trim() {
    const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
    if (lines.length > MAX) fs.writeFileSync(FILE, lines.slice(-MAX).join('\n') + '\n', { mode: 0o600 });
}

function list({ serverId, limit = 200 } = {}) {
    try {
        const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        return rows.filter(r => !serverId || r.serverId === serverId).reverse().slice(0, limit);
    } catch {
        return [];
    }
}

module.exports = { add, list };

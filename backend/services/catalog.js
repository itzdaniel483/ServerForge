// Game catalogue (claude, 2026-10-30): reads catalog/games.json and turns a game + its settings into
// an executable, argument list, environment and working folder. Every value is validated before it is
// placed into an argument, and nothing goes through a shell.
const path = require('path');
const crypto = require('crypto');
const raw = require('../catalog/games.json');

// Source-engine games share one launch line; the catalogue only lists their game folder.
function sourceLaunch(game, platform) {
    const exe = platform === 'win32' ? 'srcds.exe' : 'srcds_run';
    const args = ['-game', game.gameDir, '-console', '-usercon', '+map', '{{map}}', '+maxplayers', '{{maxplayers}}', '-port', '{{port}}', '+hostname', '{{name}}', ...(game.extraArgs || [])];
    return { executable: exe, args };
}

// Settings a game can expose. Each has a label, a check, and how to clean the value.
const VARS = {
    name: { label: 'Server name', type: 'text', test: v => /^[\w .:'!&()#+,-]{1,60}$/.test(v), help: 'Up to 60 letters, numbers and spaces' },
    map: { label: 'Map', type: 'text', test: v => /^(?!.*\.\.)(?![/.])[\w./-]{1,64}$/.test(v), help: 'Map name, e.g. de_dust2' },
    world: { label: 'World / save name', type: 'text', test: v => /^[\w-]{1,40}$/.test(v), help: 'Letters, numbers, - and _' },
    maxplayers: { label: 'Max players', type: 'number', min: 1, max: 256 },
    port: { label: 'Game port', type: 'number', min: 1024, max: 65535 },
    queryport: { label: 'Query port', type: 'number', min: 1024, max: 65535 },
    rconport: { label: 'RCON port', type: 'number', min: 1024, max: 65535 },
    worldsize: { label: 'World size', type: 'number', min: 1000, max: 6000 },
    seed: { label: 'World seed', type: 'number', min: 0, max: 2147483647 },
    password: { label: 'Password', type: 'secret', test: v => /^[A-Za-z0-9!@#$%^*_+=.,-]{0,32}$/.test(v), help: 'Blank for none (some games need one). No spaces or quotes' },
};

const games = raw.games.map(g => {
    const out = { ...g };
    if (g.engine === 'source') { out.linux = sourceLaunch(g, 'linux'); out.win32 = sourceLaunch(g, 'win32'); out.configFile = `${g.gameDir}/cfg/server.cfg`; }
    return out;
});
const byId = new Map(games.map(g => [g.id, g]));

const platformKey = () => (process.platform === 'win32' ? 'win32' : 'linux');

// What the installer shows: no launch internals, just what's needed to choose and configure.
function list() {
    const p = platformKey();
    return games.map(g => ({
        id: g.id, name: g.name, appId: g.appId, category: g.category, notes: g.notes || null,
        supported: !!g[p], platforms: ['linux', 'win32'].filter(k => g[k]),
        vars: varFields(g),
    }));
}

function varFields(game) {
    return [{ key: 'name', ...VARS.name, default: game.name }, ...Object.entries(game.vars || {}).map(([key, def]) => ({ key, ...VARS[key], default: def }))]
        .map(({ test, ...f }) => f);
}

const get = id => byId.get(String(id));
const findByAppId = appId => games.find(g => g.appId === String(appId));

// Check and normalise a game's settings. Unknown keys are dropped; missing ones take the default.
function cleanVars(game, input = {}) {
    const out = {}, errors = [];
    for (const f of varFields(game)) {
        const def = VARS[f.key];
        let v = input[f.key];
        if (v === undefined || v === null || v === '') v = f.default;
        if (def.type === 'number') {
            const n = Number(v);
            if (!Number.isInteger(n) || n < def.min || n > def.max) errors.push(`${def.label} must be ${def.min}-${def.max}`);
            else out[f.key] = n;
        } else {
            v = String(v).trim();
            if (!def.test(v)) errors.push(`${def.label}: ${def.help}`);
            else out[f.key] = v;
        }
    }
    if (game.id === 'valheim' && (out.password || '').length < 5) errors.push('Valheim needs a password of at least 5 characters');
    return { vars: out, errors };
}

// Fill {{tokens}}. rconpassword comes from the server record (generated), never from the client.
function buildLaunch(game, vars, server = {}) {
    const p = platformKey();
    const spec = game[p];
    if (!spec) throw Object.assign(new Error(`${game.name} has no ${p === 'win32' ? 'Windows' : 'Linux'} server`), { status: 400 });
    const values = { ...vars, rconpassword: server.rconPassword || '' };
    const fill = s => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] === undefined ? '' : String(values[k])));
    return {
        executable: spec.executable,
        args: spec.args.map(fill),
        env: spec.env || {},
        cwd: spec.cwd || '',
    };
}

const newRconPassword = () => crypto.randomBytes(12).toString('base64url');

module.exports = { list, get, findByAppId, cleanVars, buildLaunch, newRconPassword, platformKey, VARS };

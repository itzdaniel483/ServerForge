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
    gamemode: { label: 'Game mode', type: 'text', test: v => /^[A-Za-z0-9_]{1,40}$/.test(v), help: 'Gamemode folder name, e.g. sandbox, terrortown, darkrp, prop_hunt' },
    workshop: { label: 'Workshop collection ID', type: 'text', test: v => /^\d{0,20}$/.test(v), help: 'Numbers only, blank for none. Uses the Steam Web API key from Settings' },
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
        id: g.id, name: g.name, appId: g.appId, storeAppId: g.storeAppId, category: g.category, notes: g.notes || null,
        supported: !!g[p], platforms: ['linux', 'win32'].filter(k => g[k]),
        vars: varFields(g),
        // Game modes (Daniel #gamemanager 3576): what the installer offers; download/gamemode details stay server-side.
        ...(g.modes ? { modes: g.modes.map(m => ({ id: m.id, name: m.name, description: m.description || '', ...(m.downloads ? { downloads: m.downloads } : {}), ...(m.needsWorkshopKey ? { needsWorkshopKey: true } : {}), ...(m.customGamemode ? { customGamemode: true } : {}) })) } : {}),
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
// Command-line templates (claude, Daniel #gamemanager 3576, contract #3581): TCAdmin-style text such as
// `-console +map {map} +port {port}` plus free custom parameters. Split on spaces with "double quotes" for grouping;
// {var} is replaced inside its own argument, so a value with spaces never becomes extra arguments. No shell is ever
// involved (spawn gets an argv array) and the program itself is never chosen here.
const TEMPLATE_MAX = 2000, CUSTOM_MAX = 1000, ARGS_MAX = 120;
const badTemplate = (message, at) => Object.assign(new Error(message), { status: 400, code: 'LAUNCH_TEMPLATE_INVALID', at });
function tokenize(text, max) {
    if (typeof text !== 'string') throw badTemplate('The command line must be text');
    if (text.length > max) throw badTemplate(`Keep it under ${max} characters`);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw badTemplate('Remove control characters');
    const out = []; let cur = '', quoted = false, started = false, openAt = -1;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { quoted = !quoted; started = true; if (quoted) openAt = i; continue; }
        if (!quoted && /\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
        cur += c; started = true;
    }
    if (quoted) throw badTemplate('A quote (") is not closed', openAt);
    if (started) out.push(cur);
    return out;
}
function fillToken(token, values) {
    return token.replace(/\{(\w*)\}/g, (whole, k) => {
        if (!Object.hasOwn(values, k)) throw badTemplate(`Unknown variable {${k}}`);
        return String(values[k] ?? '');
    });
}
const quoteArg = a => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '')}"` : a);
// The game's own default as editable text: {{var}} placeholders become {var}.
function defaultTemplate(game) {
    const spec = game?.[platformKey()];
    return spec ? spec.args.map(a => quoteArg(String(a).replace(/\{\{(\w+)\}\}/g, '{$1}'))).join(' ') : '';
}
// Servers installed before a variable existed (e.g. gamemode, added 2026-10-30) get the game's default for it.
function launchValues(vars, server = {}, game = null) {
    const defaults = game ? Object.fromEntries(varFields(game).map(f => [f.key, f.default])) : {};
    const values = { ...defaults, ...(vars || {}), rconpassword: server.rconPassword || '' };
    for (const k of Object.keys(values)) if (values[k] === undefined || values[k] === null) values[k] = '';
    return values;
}
function renderArgs(template, customArgs, values) {
    const args = [...tokenize(template, TEMPLATE_MAX), ...tokenize(customArgs || '', CUSTOM_MAX)].map(t => fillToken(t, values));
    if (args.length > ARGS_MAX) throw badTemplate(`Too many arguments (max ${ARGS_MAX})`);
    return args;
}

// A Workshop collection (game mode "Workshop collection", or set in Settings) is added at launch build time, so it
// survives Settings saves and template edits. Gmod needs the Steam Web API key from Settings to download it.
function workshopArgs(values, { mask = false } = {}) {
    if (!/^\d{1,20}$/.test(String(values.workshop || ''))) return [];
    let key = '';
    try { key = require('./settingsStore').getAll().steamApiKey || ''; } catch { key = ''; }
    return ['+host_workshop_collection', String(values.workshop), ...(key ? ['-authkey', mask ? '••••' : key] : [])];
}

function buildLaunch(game, vars, server = {}) {
    const p = platformKey();
    const spec = game[p];
    if (!spec) throw Object.assign(new Error(`${game.name} has no ${p === 'win32' ? 'Windows' : 'Linux'} server`), { status: 400 });
    const values = launchValues(vars, server, game);
    const fill = s => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] === undefined ? '' : String(values[k])));
    // A saved template / custom parameters survive settings changes; only the variable values are refreshed.
    const custom = typeof server.launchTemplate === 'string' || (typeof server.customArgs === 'string' && server.customArgs.trim());
    const args = custom ? renderArgs(server.launchTemplate ?? defaultTemplate(game), server.customArgs || '', values) : spec.args.map(fill);
    return {
        executable: spec.executable,
        args: [...args, ...workshopArgs(values)],
        env: spec.env || {},
        cwd: spec.cwd || '',
    };
}

const newRconPassword = () => crypto.randomBytes(12).toString('base64url');

module.exports = { workshopArgs, list, get, findByAppId, cleanVars, buildLaunch, newRconPassword, platformKey, VARS, tokenize, renderArgs, defaultTemplate, launchValues, quoteArg, TEMPLATE_MAX, CUSTOM_MAX };

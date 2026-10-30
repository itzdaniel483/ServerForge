// Game catalogue + crash recovery tests (claude, 2026-10-30).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../services/catalog');
const { games: gamedigGames } = require('gamedig');

test('every catalogue game has a launch line, known settings and a real query type', () => {
    const list = catalog.list();
    assert.ok(list.length >= 30, `only ${list.length} games`);
    const ids = new Set();
    for (const g of list) {
        assert.ok(!ids.has(g.id), `duplicate id ${g.id}`); ids.add(g.id);
        assert.match(g.appId, /^\d+$/, g.id);
        assert.ok(g.platforms.length > 0, `${g.id} has no platform`);
        for (const f of g.vars) assert.ok(f.label, `${g.id}.${f.key} is not a known setting`);
        const full = catalog.get(g.id);
        if (full.query) assert.ok(gamedigGames[full.query], `${g.id}: gamedig has no "${full.query}"`);
        const { vars, errors } = catalog.cleanVars(full, {});
        assert.deepEqual(errors, [], `${g.id} defaults fail their own checks`);
        for (const p of g.platforms) {
            const spec = full[p];
            const left = JSON.stringify(spec.args).match(/\{\{(\w+)\}\}/g) || [];
            for (const t of left) assert.ok(t === '{{rconpassword}}' || t.slice(2, -2) in vars, `${g.id}/${p} uses ${t} but has no such setting`);
        }
    }
});

test('settings are checked before they reach a launch line', () => {
    const tf2 = catalog.get('tf2');
    const bad = catalog.cleanVars(tf2, { name: 'x"; rm -rf /', map: '../../etc/passwd', maxplayers: 999, port: 22 });
    assert.equal(bad.errors.length, 4);
    const ok = catalog.cleanVars(tf2, { name: "Dan's TF2", map: 'ctf_2fort', maxplayers: '24', port: '27020' });
    assert.deepEqual(ok.errors, []);
    const launch = catalog.buildLaunch(tf2, ok.vars, { rconPassword: 'r' });
    assert.ok(launch.args.includes('ctf_2fort'));
    assert.ok(launch.args.includes('27020'));
    assert.ok(launch.args.includes("Dan's TF2"), 'name stays one argument (no shell splitting)');
    assert.equal(catalog.cleanVars(catalog.get('valheim'), { password: 'abc' }).errors.length, 1, 'Valheim needs 5+ character password');
});

test('a crashing server is restarted at most 3 times in 10 minutes, and a manual stop is not a crash', async () => {
    const pm = require('../services/processManager');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-crash-'));
    const script = path.join(dir, 'crash.sh');
    fs.writeFileSync(script, '#!/bin/sh\necho boom\nexit 3\n', { mode: 0o755 });
    const events = [];
    const onCrash = e => events.push(e);
    const onRestart = ({ id }) => { if (id === 'c1') pm.start('c1', script, [], dir, {}, { autoRestart: true }); };
    pm.on('crashed', onCrash);
    pm.on('restart-request', onRestart);
    // Speed up: emit restart requests immediately instead of after 10s.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 10000 ? 5 : ms, ...a);
    try {
        pm.start('c1', script, [], dir, {}, { autoRestart: true });
        for (let i = 0; i < 100 && events.length < 4; i++) await new Promise(r => realSetTimeout(r, 50));
        assert.equal(events.length, 4);
        assert.deepEqual(events.map(e => e.willRestart), [true, true, true, false]);

        const sleeper = path.join(dir, 'sleep.sh');
        fs.writeFileSync(sleeper, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
        events.length = 0;
        pm.start('c2', sleeper, [], dir, {}, { autoRestart: true });
        await new Promise(r => realSetTimeout(r, 200));
        pm.stop('c2');
        await new Promise(r => realSetTimeout(r, 300));
        assert.equal(events.length, 0, 'stopping on purpose must not count as a crash');
        assert.equal(pm.getStatus('c2'), 'stopped');
    } finally {
        global.setTimeout = realSetTimeout;
        pm.off('crashed', onCrash);
        pm.off('restart-request', onRestart);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { cpuPercent } = require('../services/hostMetrics');
const queries = require('../services/querySnapshot');

test('CPU uses a measured idle/total delta and rejects reset counters', () => {
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 125, total: 300 }), 75);
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), null);
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 0, total: 0 }), null);
});

test('player counts are nullable, expire, and clear on failures or lifecycle changes', () => {
    queries.record('test', { online: true, players: 0, maxPlayers: 20 }, 1000);
    assert.deepEqual(queries.get('test', true, 2000), { players: 0, maxPlayers: 20 });
    assert.deepEqual(queries.get('test', false, 2000), { players: null, maxPlayers: null });
    assert.deepEqual(queries.get('test', true, 32000), { players: null, maxPlayers: null });
    queries.record('test', { online: false });
    assert.deepEqual(queries.get('test', true), { players: null, maxPlayers: null });
    queries.record('test', { online: true, players: 2, maxPlayers: 10 });
    queries.clear('test');
    assert.deepEqual(queries.get('test', true), { players: null, maxPlayers: null });
});

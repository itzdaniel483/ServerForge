// Unit tests for the outside-node public address (claude, 2026-11-03).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePublicAddress, normalizePublicAddress, outsideHubUrl } = require('../services/nodePublicAddress');

test('public address: accepts public hosts/IPs, defaults the port, rejects everything else', () => {
    assert.equal(parsePublicAddress('', 3231), null);
    assert.deepEqual(parsePublicAddress('home.example.com', 3231), { host: 'home.example.com', port: 3231 });
    assert.deepEqual(parsePublicAddress('HOME.example.com:4000', 3231), { host: 'home.example.com', port: 4000 });
    assert.deepEqual(parsePublicAddress('203.0.113.7', 3231), { host: '203.0.113.7', port: 3231 });
    assert.equal(normalizePublicAddress(' a.b.co ', 3231), 'a.b.co:3231');
    for (const bad of ['wss://a.b.co', 'https://a.b.co', 'a.b.co/path', 'a.b.co?x', 'u@a.b.co', 'a b.co', '-bad.com', 'a..b', '999.1.1.1',
        '10.0.0.1', '192.168.1.5', '172.20.0.1', '127.0.0.1', 'localhost', 'nas.local', 'a.b.co:0', 'a.b.co:70000', 'a.b.co:x', '1.2.3']) {
        assert.throws(() => parsePublicAddress(bad, 3231), undefined, `accepted ${bad}`);
    }
});

test('outside hub URL keeps the LAN path and the saved host/port', () => {
    assert.equal(outsideHubUrl('home.example.com', 'wss://192.0.2.10:3231/node/v1/connect', 3231), 'wss://home.example.com:3231/node/v1/connect');
    assert.equal(outsideHubUrl('', 'wss://192.0.2.10:3231/node/v1/connect', 3231), null);
});

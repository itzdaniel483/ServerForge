const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGameArt } = require('../services/gameArt');
const games = { get: id => id === 'valheim' ? { storeAppId: '892970' } : id === 'invalid' ? { storeAppId: '../secret' } : undefined };
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

test('catalogue exposes storefront IDs separately from dedicated-server IDs', () => {
    const catalogue = require('../services/catalog');
    assert.ok(catalogue.list().every(game => /^[1-9]\d*$/.test(game.storeAppId)));
    assert.equal(catalogue.get('valheim').appId, '896660');
    assert.equal(catalogue.get('valheim').storeAppId, '892970');
    assert.equal(catalogue.list().find(game => game.id === 'gmod').storeAppId, '4000');
});

test('art uses fixed Steam URL, deduplicates concurrent downloads and persists cache', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-art-'));
    let calls = 0;
    const download = async (url, options) => {
        calls++;
        assert.equal(url, 'https://shared.steamstatic.com/store_item_assets/steam/apps/892970/header.jpg');
        assert.equal(options.maxRedirects, 0);
        assert.equal(options.timeout, 8000);
        return { data: jpg, headers: { 'content-type': 'image/jpeg' } };
    };
    try {
        const service = createGameArt({ games, cacheDir, download });
        const [a, b] = await Promise.all([service.getArt('valheim'), service.getArt('valheim')]);
        assert.deepEqual(a, b);
        assert.equal(a.mime, 'image/jpeg');
        assert.equal(calls, 1);
        assert.deepEqual(await fs.readFile(a.path), jpg);
        assert.equal((await fs.stat(a.path)).mode & 0o777, 0o600);
        assert.deepEqual(await createGameArt({ games, cacheDir, download }).getArt('valheim'), a);
        assert.equal(calls, 1, 'cache survives service recreation');
        assert.equal(await service.getArt('../../etc/passwd'), null);
        assert.equal(await service.getArt('invalid'), null);
        assert.equal(calls, 1, 'unrecognized ids never reach network');
    } finally { await fs.rm(cacheDir, { recursive: true, force: true }); }
});

test('art rejects non-JPEG/oversized content and backs off failed downloads', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-art-'));
    let calls = 0, clock = 0;
    const service = createGameArt({ games, cacheDir, now: () => clock, download: async () => {
        calls++;
        return calls === 1 ? { data: Buffer.from('<svg/>'), headers: { 'content-type': 'image/svg+xml' } }
            : { data: Buffer.alloc(2 * 1024 * 1024 + 1), headers: { 'content-type': 'image/jpeg' } };
    } });
    try {
        assert.equal(await service.getArt('valheim'), null);
        assert.equal(await service.getArt('valheim'), null);
        assert.equal(calls, 1);
        clock = 60_001;
        assert.equal(await service.getArt('valheim'), null);
        assert.equal(calls, 2);
        assert.deepEqual(await fs.readdir(cacheDir), []);
    } finally { await fs.rm(cacheDir, { recursive: true, force: true }); }
});

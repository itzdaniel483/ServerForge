const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fsExtra = require('fs-extra');
const { CacheService } = require('../services/cacheService');

test('startup recovers interrupted jobs; cancellation holds locks until installer closes; retry and progress work', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cache-'));
    fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify({ '4020': { name: 'GMod', status: 'downloading', progress: 23 } }));
    let output, finish, calls = 0;
    const steam = { install: async (_id, _path, log, _beta, { signal }) => {
        calls++;
        output = log;
        await new Promise(resolve => { finish = resolve; });
        if (signal.aborted) throw new Error('aborted');
    } };
    const service = new CacheService({ cacheDir: dir, steam });
    try {
        assert.equal((await service.getCacheStatus('4020')).status, 'interrupted');
        assert.equal((await service.startDownload('4020', 'GMod')).status, 'downloading');
        // Allow the runner's path lookup to finish.
        await new Promise(resolve => setImmediate(resolve));
        output('progress: 42.5 (download)\n');
        assert.equal((await service.getCacheStatus('4020')).progress, 42.5);
        await assert.rejects(service.startDownload('4020', 'Duplicate'), { status: 409 });
        await assert.rejects(service.deleteCache('4020'), { status: 409 });
        const cancelling = service.cancelDownload('4020');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(service.jobs.get('4020').controller.signal.aborted, true);
        await assert.rejects(service.startDownload('4020', 'Too soon'), { status: 409 });
        finish();
        assert.equal((await cancelling).status, 'cancelled');
        assert.equal((await service.getCacheStatus('4020')).status, 'cancelled');
        await service.startDownload('4020', 'Resume');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await service.getCacheStatus('4020')).error, undefined, 'a retry clears the previous failure text');
        output('progress: 120\n' + 'x'.repeat(20000));
        assert.equal((await service.getCacheStatus('4020')).progress, 100);
        assert.ok(Buffer.byteLength((await service.getCacheStatus('4020')).logs) <= 16000);
        const completion = service.jobs.get('4020').completion;
        finish();
        assert.equal((await completion).status, 'ready');
        assert.equal(calls, 2);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cache.json')))[4020].status, 'ready');
        await service.deleteCache('4020');
        assert.equal((await service.getCacheStatus('4020')).status, 'not_cached');
        await assert.rejects(service.startDownload('../../etc', 'Bad'), { status: 400 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ready cache can be refreshed in place and cannot be copied or deleted during refresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cache-update-'));
    let finish;
    const steam = { install: async (_id, _path, _log, _beta, { signal }) => {
        await new Promise(resolve => { finish = resolve; });
        if (signal.aborted) throw new Error('aborted');
    } };
    const service = new CacheService({ cacheDir: dir, steam });
    try {
        const gamePath = path.join(dir, '4020');
        fs.mkdirSync(gamePath);
        fs.writeFileSync(path.join(gamePath, 'game.txt'), 'cached');
        service.cache['4020'] = { name: 'GMod', status: 'ready', downloadedDate: '2026-01-01T00:00:00Z', diskSize: '0.01 GB' };
        await service.saveCache();

        assert.equal((await service.startDownload('4020', 'GMod')).status, 'updating');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await service.getCacheStatus('4020')).status, 'updating');
        await assert.rejects(service.copyFromCache('4020', path.join(dir, 'copy')), { status: 409 });
        await assert.rejects(service.deleteCache('4020'), { status: 409 });

        const cancelling = service.cancelDownload('4020');
        await new Promise(resolve => setImmediate(resolve));
        finish();
        assert.equal((await cancelling).status, 'cancelled');
        assert.equal((await service.getCacheStatus('4020')).status, 'cancelled');

        // A completed refresh restores a usable ready state and copies retain the update.
        assert.equal((await service.startDownload('4020', 'GMod')).status, 'downloading');
        await new Promise(resolve => setImmediate(resolve));
        const completion = service.jobs.get('4020').completion;
        finish();
        assert.equal((await completion).status, 'ready');
        const target = path.join(dir, 'copy');
        await service.copyFromCache('4020', target);
        assert.equal(fs.readFileSync(path.join(target, 'game.txt'), 'utf8'), 'cached');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a cache copy holds the app ID against concurrent update or deletion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cache-copy-'));
    const service = new CacheService({ cacheDir: dir, steam: { install: async () => {} } });
    const cachePath = path.join(dir, '4020');
    fs.mkdirSync(cachePath);
    fs.writeFileSync(path.join(cachePath, 'game.txt'), 'ready');
    try {
        await service.ready;
        service.cache['4020'] = { name: 'GMod', status: 'ready' };
        const originalCopy = fsExtra.copy;
        let signalCopyStarted;
        const copyStarted = new Promise(resolve => { signalCopyStarted = resolve; });
        let releaseCopy;
        const copyGate = new Promise(resolve => { releaseCopy = resolve; });
        fsExtra.copy = async (...args) => { signalCopyStarted(); await copyGate; return originalCopy(...args); };
        try {
            const copying = service.copyFromCache('4020', path.join(dir, 'target'));
            await copyStarted;
            assert.equal(service.copying.has('4020'), true, 'the real copy operation owns the lock');
            await assert.rejects(service.startDownload('4020', 'GMod'), { status: 409 });
            await assert.rejects(service.deleteCache('4020'), { status: 409 });
            await assert.rejects(service.copyFromCache('4020', path.join(dir, 'second-target')), { status: 409 });
            releaseCopy();
            await copying;
            assert.equal(service.copying.has('4020'), false, 'the lock releases after success');
            assert.equal(fs.readFileSync(path.join(dir, 'target', 'game.txt'), 'utf8'), 'ready');
        } finally { releaseCopy(); fsExtra.copy = originalCopy; }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

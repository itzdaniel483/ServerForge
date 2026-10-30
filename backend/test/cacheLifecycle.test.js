const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { auditContext, cleanIp, cleanUserAgent } = require('../services/auditContext');

test('audit source uses socket peer, ignores spoofed forwarding, and bounds browser text', () => {
    assert.deepEqual(auditContext({ socket: { remoteAddress: '::ffff:192.168.55.109' }, headers: { 'user-agent': 'Browser/1.0\r\nInjected', 'x-forwarded-for': '203.0.113.5', 'cf-connecting-ip': '203.0.113.6' } }),
        { ip: '192.168.55.109', peerIp: '192.168.55.109', userAgent: 'Browser/1.0Injected', viaHub: false });
    assert.equal(cleanIp('192.168.1.1:80'), null);
    assert.equal(cleanIp('not an IP'), null);
    assert.equal(cleanUserAgent('x'.repeat(900)).length, 512);
    assert.deepEqual(auditContext({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'user-agent': 'node-runtime' }, hubActor: {} }),
        { ip: null, userAgent: null, peerIp: '127.0.0.1', viaHub: true });
});

test('old and system audit records normalize new fields without losing existing activity', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-audit-'));
    const previous = process.env.DATA_DIR; process.env.DATA_DIR = tmp;
    try {
        fs.writeFileSync(path.join(tmp, 'activity.jsonl'), JSON.stringify({ at: '2026-10-30T00:00:00Z', user: 'admin', action: 'delete', detail: 'old entry' }) + '\n');
        const log = require('../services/auditLog');
        log.add({ user: 'scheduler', action: 'task-start' });
        const rows = log.list();
        assert.equal(rows[1].detail, 'old entry');
        for (const row of rows) { assert.equal(row.ip, null); assert.equal(row.userAgent, null); assert.equal(row.peerIp, null); assert.equal(row.viaHub, false); }
    } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(tmp, { recursive: true, force: true }); }
});

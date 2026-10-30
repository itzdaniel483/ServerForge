const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sched-'));
const scheduler = require('../services/schedulerService');

const check = cron => scheduler.validate({ type: 'restart', cron }, 'fake1');

test('timetables closer than 5 minutes are refused however they are written', () => {
    for (const cron of ['* * * * *', '*/4 * * * *', '0-59 * * * *', '1,2,3 * * * *', '0-10/2 * * * *', '0,58 * * * *', '10-14 6 * * *', '58/1 * * * *'])
        assert.ok(check(cron).error, `${cron} should be refused`);
});

test('ordinary timetables are accepted', () => {
    for (const cron of ['0 6 * * *', '*/5 * * * *', '0,30 * * * *', '0-55/5 * * * *', '15 */2 * * 1-5', '7 3 1 * *'])
        assert.ok(!check(cron).error, `${cron} should be accepted: ${check(cron).error}`);
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonSync, readJsonSync, isCorruptWithoutBackup } = require('../services/jsonFile');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-json-'));
const file = path.join(dir, 'servers.json');

test('missing file returns the fallback', () => {
    assert.deepStrictEqual(readJsonSync(file, []), []);
});

test('write then read round-trips, leaves no temp file, owner-only', () => {
    writeJsonSync(file, [{ id: 1 }]);
    assert.deepStrictEqual(readJsonSync(file, []), [{ id: 1 }]);
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('a 0-byte file (crash mid-write) restores the previous save from .bak', () => {
    writeJsonSync(file, [{ id: 2 }]);          // .bak now holds [{id:1}]
    writeJsonSync(file, [{ id: 3 }]);          // .bak now holds [{id:2}]
    fs.writeFileSync(file, '');
    assert.deepStrictEqual(readJsonSync(file, []), [{ id: 2 }]);
});

test('corrupt file with no good backup is detected', () => {
    const f = path.join(dir, 'users.json');
    fs.writeFileSync(f, '{"broken');
    assert.strictEqual(isCorruptWithoutBackup(f), true);
    writeJsonSync(f, []);                      // bad file is not copied over a .bak
    assert.strictEqual(fs.existsSync(f + '.bak'), false);
    assert.strictEqual(isCorruptWithoutBackup(f), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('a login comparing the old password cannot acquire the rotated session version', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rotation-'));
    const previousDir = process.env.DATA_DIR;
    const previousPassword = process.env.ADMIN_PASSWORD;
    process.env.DATA_DIR = tmp;
    process.env.ADMIN_PASSWORD = 'old-password-1';
    const bcrypt = require('bcryptjs');
    const originalCompare = bcrypt.compare;
    try {
        const store = require('../services/userStore');
        await store.init();
        let release, started;
        const waiting = new Promise(resolve => { started = resolve; });
        bcrypt.compare = (...args) => {
            bcrypt.compare = originalCompare;
            started();
            return new Promise(resolve => { release = () => resolve(true); });
        };
        const login = store.authenticate('admin', 'old-password-1');
        await waiting;
        const admin = (await store.getUsers())[0];
        await store.changePassword(admin.id, 'old-password-1', 'new-password-1');
        release();
        assert.equal(await login, null);
        assert.equal((await store.authenticate('admin', 'new-password-1')).sessionVersion, 1);
    } finally {
        bcrypt.compare = originalCompare;
        if (previousDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDir;
        if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previousPassword;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

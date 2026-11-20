// codex review 20 Nov 2026 (claude): bootstrap password file removal + stale move archive cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('first-run admin password file is removed once it no longer matches, and after a password change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-users-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../services/userStore')];
  const store = require('../services/userStore');
  await store.init();
  const file = path.join(dir, 'initial-admin-password');
  assert.ok(fs.existsSync(file), 'file written on first run');
  const pw = fs.readFileSync(file, 'utf8').trim();
  const admin = store.users.find((u) => u.username === 'admin');
  // still the live password: kept on the next start
  store.initialized = false; await store.init(); assert.ok(fs.existsSync(file));
  await store.changePassword(admin.id, pw, 'a-new-long-password');
  assert.equal(fs.existsSync(file), false, 'removed after the password change');
  // file re-appears with a password that no longer works (e.g. restored backup): removed on start
  fs.writeFileSync(file, pw + '\n'); store.initialized = false; await store.init();
  assert.equal(fs.existsSync(file), false, 'stale file removed at start');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stale move archives older than 24 h are removed, fresh ones kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-moves-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../services/moveArchive')];
  const mv = require('../services/moveArchive');
  fs.mkdirSync(mv.DIR, { recursive: true });
  const old = path.join(mv.DIR, 'in-oldtoken.zip'), fresh = path.join(mv.DIR, 'out-newtoken.zip'), other = path.join(mv.DIR, 'notes.txt');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
  const past = (Date.now() - 48 * 3600e3) / 1000; fs.utimesSync(old, past, past); fs.utimesSync(other, past, past);
  assert.equal(mv.cleanupStale(), 1);
  assert.equal(fs.existsSync(old), false); assert.ok(fs.existsSync(fresh)); assert.ok(fs.existsSync(other), 'unrelated files untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});

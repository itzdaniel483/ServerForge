const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NodeRegistry, challengePayload } = require('../services/nodeRegistry');

function fixture(t) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-nodes-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    let clock = 1_800_000_000_000;
    const now = () => clock;
    const registry = new NodeRegistry({ dataDir, now });
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const enrol = () => registry.createEnrolment({ hubUrl: 'wss://192.168.1.2:3240/node', hubFingerprint: 'AB:'.repeat(31) + 'AB' });
    const begin = (code = enrol().code, overrides = {}) => registry.beginPair({ code, publicKey, name: 'Windows PC', os: 'win32', version: '1.0.0', ...overrides });
    const sign = challenge => crypto.sign(null, Buffer.from(challengePayload(challenge)), pair.privateKey).toString('base64');
    return { registry, pair, publicKey, dataDir, now, advance: ms => { clock += ms; }, enrol, begin, sign };
}

test('enrolment persists only a code hash and stable hub ID in owner-only storage', t => {
    const f = fixture(t);
    const enrol = f.enrol();
    assert.equal(enrol.hubFingerprint, 'ab'.repeat(32));
    assert.equal(enrol.expiresAt, f.now() + 600_000);
    assert.ok(Buffer.from(enrol.code, 'base64url').length >= 16);
    const file = path.join(f.dataDir, 'nodes.json');
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(enrol.code), false);
    assert.equal(JSON.parse(raw).enrolments[0].codeHash.length, 64);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(new NodeRegistry({ dataDir: f.dataDir, now: f.now }).hubId, enrol.hubId);
    f.registry.cancelEnrolment(enrol.codeId);
    assert.throws(() => f.begin(enrol.code), { status: 401 });
    assert.throws(() => f.registry.createEnrolment({ hubUrl: 'ws://hub/node', hubFingerprint: 'ab'.repeat(32) }), { status: 400 });
    assert.throws(() => f.registry.createEnrolment({ hubUrl: 'wss://user:password@hub/node', hubFingerprint: 'ab'.repeat(32) }), { status: 400 });
});

test('pairing binds code to Ed25519 key and requires one-use key proof plus fingerprint approval', t => {
    const f = fixture(t);
    const enrol = f.enrol();
    const candidate = f.begin(enrol.code);
    assert.equal(candidate.publicKey, undefined);
    assert.equal(candidate.proved, false);
    assert.throws(() => f.begin(enrol.code), { status: 401 });
    assert.throws(() => f.registry.approve(candidate.id, { fingerprintConfirmed: true }), { status: 409 });
    const challenge = f.registry.createChallenge({ candidateId: candidate.id, sessionId: 'socket-1' });
    assert.equal(challenge.identityId, candidate.id);
    assert.equal(challenge.hubId, f.registry.hubId);
    assert.equal(challengePayload(challenge), JSON.stringify(['serverforge-node-v1', challenge.hubId, candidate.id, candidate.fingerprint, 'socket-1', challenge.nonce]));
    const signature = f.sign(challenge);
    assert.equal(f.registry.prove(challenge.id, signature).kind, 'pending');
    assert.throws(() => f.registry.prove(challenge.id, signature), { status: 401 });
    assert.throws(() => f.registry.approve(candidate.id, { fingerprintConfirmed: 'true' }), { status: 409 });
    let approved;
    f.registry.once('approved', event => { approved = event; });
    const node = f.registry.approve(candidate.id, { fingerprintConfirmed: true });
    assert.equal(approved.candidateId, candidate.id);
    assert.equal(approved.node.id, node.id);
    assert.equal(node.id, candidate.id);
    assert.equal(node.publicKey, f.publicKey);
    assert.deepEqual(f.registry.listPending(), []);
    assert.equal(f.registry.list()[0].publicKey, undefined);
    assert.equal(f.registry.list()[0].code, undefined);
    const reconnect = f.registry.createChallenge({ nodeId: node.id, sessionId: 'socket-2' });
    assert.equal(f.registry.prove(reconnect.id, f.sign(reconnect)).kind, 'approved');
    const persisted = new NodeRegistry({ dataDir: f.dataDir, now: f.now });
    const fresh = persisted.createChallenge({ nodeId: node.id, sessionId: 'socket-3' });
    assert.equal(persisted.prove(fresh.id, f.sign(fresh)).id, node.id);
});

test('wrong keys, changed session/domain data and invalid signatures consume challenges', t => {
    const f = fixture(t);
    const candidate = f.begin();
    const challenge = () => f.registry.createChallenge({ candidateId: candidate.id, sessionId: 'session' });
    const wrong = crypto.generateKeyPairSync('ed25519');
    for (const transform of [
        c => crypto.sign(null, Buffer.from(challengePayload(c)), wrong.privateKey).toString('base64'),
        c => f.sign({ ...c, sessionId: 'attacker-session' }),
        c => f.sign({ ...c, hubId: crypto.randomUUID() }),
        () => 'bad',
    ]) {
        const c = challenge();
        assert.throws(() => f.registry.prove(c.id, transform(c)), { status: 401 });
        assert.throws(() => f.registry.prove(c.id, f.sign(c)), { status: 401 });
    }
    assert.equal(f.registry.listPending()[0].proved, false);
});

test('expiry and restart invalidate proofs; revocation invalidates approved challenges immediately', t => {
    const f = fixture(t);
    const expired = f.enrol();
    f.advance(600_000);
    assert.throws(() => f.begin(expired.code), { status: 401 });
    const candidate = f.begin();
    const c = f.registry.createChallenge({ candidateId: candidate.id, sessionId: 'old' });
    f.advance(30_000);
    assert.throws(() => f.registry.prove(c.id, f.sign(c)), { status: 401 });
    const valid = f.registry.createChallenge({ candidateId: candidate.id, sessionId: 'live' });
    f.registry.prove(valid.id, f.sign(valid));
    const restarted = new NodeRegistry({ dataDir: f.dataDir, now: f.now });
    assert.equal(restarted.listPending()[0].proved, false);
    assert.throws(() => restarted.approve(candidate.id, { fingerprintConfirmed: true }), { status: 409 });
    const node = f.registry.approve(candidate.id, { fingerprintConfirmed: true });
    const reconnect = f.registry.createChallenge({ nodeId: node.id, sessionId: 'new' });
    let removed;
    f.registry.once('removed', event => { removed = event; });
    f.registry.remove(node.id);
    assert.deepEqual(removed, { id: node.id });
    assert.throws(() => f.registry.prove(reconnect.id, f.sign(reconnect)), { status: 401 });
    assert.throws(() => f.registry.createChallenge({ nodeId: node.id, sessionId: 'retry' }), { status: 404 });
    assert.deepEqual(new NodeRegistry({ dataDir: f.dataDir, now: f.now }).list(), []);
    const pending = f.begin();
    f.advance(600_000);
    assert.deepEqual(f.registry.listPending(), []);
    assert.throws(() => f.registry.approve(pending.id, { fingerprintConfirmed: true }), { status: 404 });
});

test('rejects unsupported keys, oversized metadata, ambiguous identities and excess enrolments', t => {
    const f = fixture(t);
    const code = f.enrol().code;
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' });
    assert.throws(() => f.begin(code, { publicKey: rsa }), { status: 400 });
    assert.throws(() => f.begin(code, { name: 'x'.repeat(81) }), { status: 400 });
    assert.throws(() => f.begin(code, { name: '<script>' }), { status: 400 });
    const candidate = f.begin(code, { name: '__proto__' });
    assert.equal(f.registry.listPending()[0].name, '__proto__');
    assert.throws(() => f.registry.createChallenge({ candidateId: candidate.id, nodeId: candidate.id, sessionId: 'x' }), { status: 400 });
    assert.throws(() => f.registry.createChallenge({ nodeId: '__proto__', sessionId: 'x' }), { status: 404 });
    for (let i = 0; i < 20; i++) f.enrol();
    assert.throws(() => f.enrol(), { status: 409 });
    f.advance(600_000);
    assert.doesNotThrow(() => f.enrol());
});

test('unreadable or inconsistent persisted registry fails closed rather than resetting trust', t => {
    const f = fixture(t);
    const file = path.join(f.dataDir, 'nodes.json');
    f.enrol(); // Leaves a valid backup, which must not silently restore older trust.
    fs.writeFileSync(file, '{broken');
    assert.throws(() => new NodeRegistry({ dataDir: f.dataDir }), /unreadable/);
    fs.rmSync(file + '.bak', { force: true });
    assert.throws(() => new NodeRegistry({ dataDir: f.dataDir }), /unreadable/);
    fs.writeFileSync(file, JSON.stringify({ hubId: crypto.randomUUID(), nodes: [null], pending: [], enrolments: [] }));
    assert.throws(() => new NodeRegistry({ dataDir: f.dataDir }), /Invalid stored node/);
});

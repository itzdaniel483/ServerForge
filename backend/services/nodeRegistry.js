const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { readJsonSync, writeJsonSync } = require('./jsonFile');

const TTL = 10 * 60_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
function text(value, label, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f<>]/.test(value)) throw fail(`Invalid ${label}`);
    return value.trim();
}
function keyInfo(value) {
    if (typeof value !== 'string' || value.length > 1024 || !value.trim().startsWith('-----BEGIN PUBLIC KEY-----')) throw fail('Invalid Ed25519 public key');
    try {
        const key = crypto.createPublicKey(value);
        if (key.asymmetricKeyType !== 'ed25519') throw new Error('Wrong key algorithm');
        const der = key.export({ type: 'spki', format: 'der' });
        return { publicKey: key.export({ type: 'spki', format: 'pem' }), fingerprint: digest(der) };
    } catch { throw fail('Invalid Ed25519 public key'); }
}
// Domain-separated, ordered bytes shared by hub and client. Never sign a supplied payload.
function challengePayload(challenge) {
    return JSON.stringify(['serverforge-node-v1', challenge.hubId, challenge.identityId,
        challenge.fingerprint, challenge.sessionId, challenge.nonce]);
}
const publicNode = ({ id, name, os, version, fingerprint, createdAt }) => ({ id, name, os, version, fingerprint, createdAt });
const publicCandidate = node => ({ ...publicNode(node), expiresAt: node.expiresAt, proved: node.proved });

class NodeRegistry extends EventEmitter {
    constructor({ dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), now = Date.now } = {}) {
        super();
        this.now = now;
        this.file = path.join(dataDir, 'nodes.json');
        this.challenges = new Map();
        // Trust must never silently roll back to a backup containing a revoked key.
        // Keep the generic JSON helper for reads/writes, but require manual recovery
        // if an existing trust database is missing or corrupt.
        const existing = fs.existsSync(this.file) || fs.existsSync(this.file + '.bak');
        if (existing) {
            try { JSON.parse(fs.readFileSync(this.file, 'utf8')); }
            catch { throw fail('Node registry is unreadable; restore its backup manually', 500); }
        }
        const state = readJsonSync(this.file, null);
        if (state === null && (fs.existsSync(this.file) || fs.existsSync(this.file + '.bak'))) throw fail('Node registry is unreadable; restore its backup', 500);
        if (state !== null && (!state || !uuid(state.hubId) || !Array.isArray(state.nodes) || !Array.isArray(state.pending) || !Array.isArray(state.enrolments) || state.nodes.length > 100 || state.pending.length > 20 || state.enrolments.length > 20)) throw fail('Invalid node registry', 500);
        this.hubId = state?.hubId || crypto.randomUUID();
        this.nodes = new Map();
        this.pending = new Map();
        this.enrolments = new Map();
        for (const node of state?.nodes || []) {
            this.validateStoredNode(node);
            if (this.nodes.has(node.id)) throw fail('Duplicate node identity in registry', 500);
            this.nodes.set(node.id, node);
        }
        for (const candidate of state?.pending || []) {
            this.validateStoredNode(candidate);
            if (!Number.isFinite(candidate.expiresAt)) throw fail('Invalid pending node expiry', 500);
            // Private-key proof belongs to a live session and never survives a hub restart.
            this.pending.set(candidate.id, { ...candidate, proved: false });
        }
        for (const enrolment of state?.enrolments || []) {
            if (!uuid(enrolment.id) || !/^[a-f0-9]{64}$/.test(enrolment.codeHash) || !Number.isFinite(enrolment.expiresAt)) throw fail('Invalid enrolment record', 500);
            this.enrolments.set(enrolment.id, enrolment);
        }
        this.prune();
        this.save();
    }
    validateStoredNode(node) {
        if (!node || !uuid(node.id)) throw fail('Invalid stored node identity', 500);
        text(node.name, 'node name', 80); text(node.os, 'OS', 32); text(node.version, 'version', 64);
        const key = keyInfo(node.publicKey);
        if (key.fingerprint !== node.fingerprint) throw fail('Stored node key fingerprint mismatch', 500);
    }
    save() {
        writeJsonSync(this.file, { hubId: this.hubId, nodes: [...this.nodes.values()], pending: [...this.pending.values()], enrolments: [...this.enrolments.values()] }, { mode: 0o600 });
    }
    prune() {
        const now = this.now();
        let changed = false;
        for (const map of [this.pending, this.enrolments, this.challenges]) {
            for (const [id, value] of map) if (value.expiresAt <= now) { map.delete(id); changed = true; }
        }
        if (changed) this.save();
    }
    createEnrolment({ hubUrl, hubFingerprint } = {}) {
        this.prune();
        let url;
        try { url = new URL(hubUrl); } catch { throw fail('Invalid hub URL'); }
        if (typeof hubUrl !== 'string' || hubUrl.length > 2048 || url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw fail('Hub URL must be WSS without credentials');
        if (typeof hubFingerprint !== 'string' || !/^(?:[a-f\d]{64}|(?:[a-f\d]{2}:){31}[a-f\d]{2})$/i.test(hubFingerprint)) throw fail('Invalid hub TLS fingerprint');
        if (this.enrolments.size >= 20 || this.pending.size >= 20 || this.nodes.size >= 100) throw fail('Node enrolment limit reached', 409);
        const codeId = crypto.randomUUID();
        const code = crypto.randomBytes(32).toString('base64url');
        const expiresAt = this.now() + TTL;
        this.enrolments.set(codeId, { id: codeId, codeHash: digest(code), expiresAt });
        try { this.save(); } catch (err) { this.enrolments.delete(codeId); throw err; }
        return { codeId, code, expiresAt, hubId: this.hubId, hubUrl: url.href, hubFingerprint: hubFingerprint.replaceAll(':', '').toLowerCase() };
    }
    cancelEnrolment(codeId) {
        this.prune();
        if (!this.enrolments.has(codeId)) throw fail('Enrolment not found', 404);
        this.enrolments.delete(codeId);
        this.save();
        return { success: true };
    }
    beginPair({ code, publicKey, name, os, version } = {}) {
        this.prune();
        if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw fail('Invalid or expired pairing code', 401);
        const info = keyInfo(publicKey);
        const fields = { name: text(name, 'node name', 80), os: text(os, 'OS', 32), version: text(version, 'version', 64) };
        const hash = digest(code);
        const enrolment = [...this.enrolments.values()].find(entry => crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(entry.codeHash, 'hex')));
        if (!enrolment) throw fail('Invalid or expired pairing code', 401);
        if (this.pending.size >= 20 || this.nodes.size >= 100) throw fail('Node enrolment limit reached', 409);
        if ([...this.nodes.values(), ...this.pending.values()].some(node => node.fingerprint === info.fingerprint)) throw fail('Public key is already registered', 409);
        const candidate = { id: crypto.randomUUID(), ...fields, ...info, createdAt: new Date(this.now()).toISOString(), expiresAt: enrolment.expiresAt, proved: false };
        this.enrolments.delete(enrolment.id);
        this.pending.set(candidate.id, candidate);
        try { this.save(); } catch (err) { this.pending.delete(candidate.id); this.enrolments.set(enrolment.id, enrolment); throw err; }
        return publicCandidate(candidate);
    }
    createChallenge({ candidateId, nodeId, sessionId } = {}) {
        this.prune();
        if (!!candidateId === !!nodeId) throw fail('Choose one node identity');
        const session = text(sessionId, 'session ID', 128);
        const kind = candidateId ? 'pending' : 'approved';
        const identity = (candidateId ? this.pending : this.nodes).get(candidateId || nodeId);
        if (!identity) throw fail('Node identity not found', 404);
        if (this.challenges.size >= 200) throw fail('Too many pending challenges', 429);
        const challenge = { id: crypto.randomUUID(), hubId: this.hubId, identityId: identity.id, fingerprint: identity.fingerprint,
            sessionId: session, nonce: crypto.randomBytes(32).toString('base64url'), expiresAt: Math.min(this.now() + 30_000, identity.expiresAt ?? Infinity) };
        this.challenges.set(challenge.id, { ...challenge, kind });
        return challenge;
    }
    prove(challengeId, signature) {
        this.prune();
        const challenge = this.challenges.get(challengeId);
        this.challenges.delete(challengeId); // Consume even failed attempts, not only valid signatures.
        if (!challenge || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw fail('Invalid or expired node proof', 401);
        const identity = (challenge.kind === 'pending' ? this.pending : this.nodes).get(challenge.identityId);
        if (!identity || identity.fingerprint !== challenge.fingerprint || !crypto.verify(null, Buffer.from(challengePayload(challenge)), identity.publicKey, Buffer.from(signature, 'base64'))) throw fail('Invalid or expired node proof', 401);
        if (challenge.kind === 'pending') { identity.proved = true; this.save(); }
        return { kind: challenge.kind, id: identity.id, publicKey: identity.publicKey, fingerprint: identity.fingerprint };
    }
    approve(candidateId, { fingerprintConfirmed } = {}) {
        this.prune();
        const candidate = this.pending.get(candidateId);
        if (!candidate) throw fail('Pending node not found', 404);
        if (fingerprintConfirmed !== true || !candidate.proved) throw fail('Confirm the fingerprint after the node proves its key', 409);
        if (this.nodes.size >= 100) throw fail('Node limit reached', 409);
        const { proved, expiresAt, ...node } = candidate;
        this.pending.delete(candidateId);
        this.nodes.set(node.id, node);
        try { this.save(); } catch (err) { this.nodes.delete(node.id); this.pending.set(candidateId, candidate); throw err; }
        const approved = { ...node };
        this.emit('approved', { candidateId, node: approved });
        return approved;
    }
    remove(nodeId) {
        this.prune();
        const node = this.nodes.get(nodeId);
        if (!node) throw fail('Node not found', 404);
        this.nodes.delete(nodeId);
        try { this.save(); } catch (err) { this.nodes.set(nodeId, node); throw err; }
        for (const [id, challenge] of this.challenges) if (challenge.identityId === nodeId) this.challenges.delete(id);
        this.emit('removed', { id: nodeId });
        return { success: true };
    }
    list() { this.prune(); return [...this.nodes.values()].map(publicNode); }
    listPending() { this.prune(); return [...this.pending.values()].map(publicCandidate); }
}

module.exports = { NodeRegistry, challengePayload };

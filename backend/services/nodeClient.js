const { EventEmitter } = require('node:events');
const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { readJsonSync, writeJsonSync } = require('./jsonFile');
const { challengePayload } = require('./nodeRegistry');

function normalizePin(pin) {
    const hex = String(pin || '').replace(/:/g, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('A SHA-256 hub certificate fingerprint is required');
    return hex;
}

async function connectPinned(hubUrl, fingerprint) {
    const url = new URL(hubUrl);
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/node/v1/connect') throw new Error('Expected the dedicated wss:// hub node endpoint');
    const pin = normalizePin(fingerprint);
    // This socket sends no application bytes until its certificate matches the
    // out-of-band pin. Self-signed trust is isolated to this one connection.
    const socket = await new Promise((resolve, reject) => {
        const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: net.isIP(url.hostname) ? undefined : url.hostname,
            rejectUnauthorized: false, minVersion: 'TLSv1.2' });
        socket.setTimeout(10000, () => socket.destroy(new Error('Node TLS handshake timed out')));
        socket.once('error', reject);
        socket.once('secureConnect', () => {
            const certificate = socket.getPeerCertificate();
            const actual = certificate.raw && crypto.createHash('sha256').update(certificate.raw).digest('hex');
            if (actual !== pin) { socket.destroy(new Error('Hub certificate fingerprint mismatch')); return; }
            socket.setTimeout(0);
            resolve(socket);
        });
    });
    return new WebSocket(url, { createConnection: () => socket, handshakeTimeout: 10000, maxPayload: 65536, perMessageDeflate: false });
}

class NodeClient extends EventEmitter {
    constructor({ dataDir, name = os.hostname(), platform = process.platform, reconnectDelay = 5000 } = {}) {
        super();
        this.file = path.join(dataDir || process.env.NODE_DATA_DIR || path.join(__dirname, '..', 'node-data'), 'node-identity.json');
        if (fs.existsSync(this.file) || fs.existsSync(this.file + '.bak')) {
            try {
                const identity = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                const url = new URL(identity.hubUrl);
                if (url.protocol !== 'wss:' || url.pathname !== '/node/v1/connect' || url.username || url.password || url.search || url.hash) throw new Error('Invalid hub URL');
                normalizePin(identity.hubFingerprint);
                const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
                if (!uuid(identity.hubId) || (identity.nodeId !== undefined && !uuid(identity.nodeId))) throw new Error('Invalid identity ID');
                const privateKey = crypto.createPrivateKey(identity.privateKey);
                if (privateKey.asymmetricKeyType !== 'ed25519' || crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== identity.publicKey) throw new Error('Invalid node key pair');
            } catch { throw new Error('Node identity is invalid; recover it manually instead of restoring stale trust'); }
        }
        this.identity = readJsonSync(this.file, null);
        this.name = name;
        this.platform = platform;
        this.reconnectDelay = reconnectDelay;
        this.stopped = true;
        this.socket = null;
        this.timer = null;
    }
    save() { writeJsonSync(this.file, this.identity); }
    async pair(bundle) {
        if (!this.stopped) throw new Error('A node connection is already active');
        if (this.identity?.nodeId) throw new Error('This node is already paired');
        if (!bundle?.hubId || typeof bundle.code !== 'string') throw new Error('Invalid enrolment bundle');
        normalizePin(bundle.hubFingerprint);
        if (!Number.isFinite(bundle.expiresAt) || bundle.expiresAt <= Date.now()) throw new Error('Enrolment code expired');
        const keys = crypto.generateKeyPairSync('ed25519');
        this.identity = { hubUrl: bundle.hubUrl, hubId: bundle.hubId, hubFingerprint: normalizePin(bundle.hubFingerprint),
            privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
        this.save();
        this.stopped = false;
        await this.connect(bundle.code);
    }
    async start() {
        if (!this.stopped) throw new Error('A node connection is already active');
        if (!this.identity?.nodeId) throw new Error('Pair this node first');
        this.stopped = false;
        await this.connect();
    }
    async connect(code) {
        const ws = await connectPinned(this.identity.hubUrl, this.identity.hubFingerprint);
        if (this.stopped) { ws.close(); return; }
        this.socket = ws;
        ws.on('open', () => {
            ws.send(JSON.stringify(code ? { type: 'pair', code, publicKey: this.identity.publicKey, name: this.name, os: this.platform, version: '1' }
                : { type: 'hello', nodeId: this.identity.nodeId }));
        });
        ws.on('message', raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'challenge') {
                    if (this.identity.nodeId && msg.identityId !== this.identity.nodeId) throw new Error('Node challenge ID mismatch');
                    if (msg.hubId !== this.identity.hubId || msg.fingerprint !== crypto.createHash('sha256').update(crypto.createPublicKey(this.identity.publicKey).export({ type: 'spki', format: 'der' })).digest('hex')) throw new Error('Hub challenge identity mismatch');
                    const signature = crypto.sign(null, Buffer.from(challengePayload(msg)), this.identity.privateKey).toString('base64');
                    ws.send(JSON.stringify({ type: 'proof', challengeId: msg.id, signature }));
                } else if (msg.type === 'pending') this.emit('pending', { candidateId: msg.candidateId, fingerprint: crypto.createHash('sha256').update(crypto.createPublicKey(this.identity.publicKey).export({ type: 'spki', format: 'der' })).digest('hex') });
                else if (msg.type === 'approved') {
                    if (msg.hubId !== this.identity.hubId || typeof msg.nodeId !== 'string') throw new Error('Invalid approval');
                    this.identity.nodeId = msg.nodeId;
                    this.save();
                    this.emit('online', { nodeId: msg.nodeId, capabilities: [] });
                } else if (msg.type === 'error') this.emit('failure', new Error(msg.error || msg.code || 'Node connection refused'));
                // No RPC dispatcher exists in Phase 1.
            } catch (err) { this.emit('failure', err); ws.close(1008); }
        });
        ws.on('error', err => this.emit('failure', err));
        ws.on('close', () => {
            this.emit('offline');
            if (!this.stopped && this.identity.nodeId) {
                this.timer = setTimeout(() => this.connect().catch(err => { this.emit('failure', err); this.scheduleReconnect(); }), this.reconnectDelay);
            }
        });
    }
    scheduleReconnect() {
        if (!this.stopped) this.timer = setTimeout(() => this.connect().catch(err => { this.emit('failure', err); this.scheduleReconnect(); }), this.reconnectDelay);
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.socket?.terminate(); }
}

module.exports = { NodeClient, connectPinned, normalizePin };

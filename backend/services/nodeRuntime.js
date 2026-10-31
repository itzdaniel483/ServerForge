const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { cleanIp, cleanUserAgent } = require('./auditContext');
const { ACTIONS, getLocalRequest, nativeId } = require('./nodeActions');
const { writeJsonSync } = require('./jsonFile');
const MAX_RESPONSE = 8 * 1024 * 1024 - 4096;
const MAX_BODY = 5 * 1024 * 1024;
const problem = (message, code = 'NODE_REQUEST_INVALID', status = 400) => Object.assign(new Error(message), { code, status });
const snapshotFields = ['workshopCollectionId', 'id', 'name', 'game', 'gameId', 'appId', 'port', 'status', 'players', 'maxPlayers', 'installError'];
function sanitizeServer(server) { return Object.fromEntries(snapshotFields.filter(field => Object.hasOwn(server, field)).map(field => [field, server[field]])); }
function localApiTarget(value) {
    const supplied = value || process.env.NODE_LOCAL_API_URL;
    let host = process.env.HOST || '127.0.0.1';
    if (host === '0.0.0.0') host = '127.0.0.1';
    if (host === '::') host = '::1';
    const url = new URL(supplied || `http://${host.includes(':') ? `[${host}]` : host}:${process.env.PORT || 3000}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw problem('A fixed local panel origin is required');
    let address = url.hostname.replace(/^\[|\]$/g, '');
    if (address === 'localhost') address = '127.0.0.1'; // Never resolve a caller-supplied DNS name.
    const local = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address));
    if (!net.isIP(address) || !(address === '::1' || /^127\./.test(address) || local.has(address))) throw problem('Node local API must use an address on this machine');
    url.hostname = address.includes(':') ? `[${address}]` : address;
    return url.origin;
}
function actorIdentity(actor) {
    if (!actor || typeof actor !== 'object' || typeof actor.id !== 'string' || typeof actor.username !== 'string' ||
        !actor.id || actor.id.length > 128 || !actor.username || actor.username.length > 128 || /[\x00-\x1f\x7f]/.test(actor.id + actor.username)) throw problem('A hub actor identity is required');
    return { id: actor.id, username: actor.username, ip: cleanIp(actor.ip), userAgent: cleanUserAgent(actor.userAgent) };
}
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
class NodeRuntime {
    constructor({ dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), localApiUrl, fetchImpl = globalThis.fetch, socketFactory, credentials, requestImpl } = {}) {
        this.dataDir = dataDir;
        this.origin = localApiTarget(localApiUrl);
        this.fetch = fetchImpl;
        this.socketFactory = socketFactory;
        this.credentials = credentials || (() => this.readCredentials());
        this.requestImpl = requestImpl;
        this.capabilities = [...ACTIONS];
        this.journalFile = path.join(dataDir, 'node-operations.json');
        this.journal = {};
        if (fs.existsSync(this.journalFile) || fs.existsSync(this.journalFile + '.bak')) {
            try {
                const value = JSON.parse(fs.readFileSync(this.journalFile, 'utf8'));
                if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length > 1000) throw new Error('Invalid journal');
                for (const [id, entry] of Object.entries(value)) {
                    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !entry || !['pending', 'done'].includes(entry.state) || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isFinite(entry.at)) throw new Error('Invalid operation');
                    if (entry.state === 'done' && (!entry.result || !Number.isInteger(entry.result.status) || entry.result.status < 100 || entry.result.status > 599 || !Object.hasOwn(entry.result, 'body'))) throw new Error('Invalid operation result');
                }
                this.journal = value;
            } catch { throw problem('Node operation journal is unreadable; recover it manually', 'OUTCOME_UNKNOWN', 503); }
        }
        this.inFlight = new Map();
        this.subscribers = new Set();
        this.watched = new Set();
        this.socket = null;
        this.closed = false;
    }
    readCredentials() {
        let users;
        try { users = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'users.json'), 'utf8')); }
        catch { throw problem('Local panel user store is not ready', 'LOCAL_PANEL_NOT_READY', 503); }
        const admin = Array.isArray(users) && users.find(user => user.role === 'admin' && typeof user.id === 'string');
        if (!admin) throw problem('Local panel requires an existing administrator', 'LOCAL_PANEL_NOT_READY', 503);
        let secret = process.env.JWT_SECRET || '';
        if (secret.length < 32 || /change-this|your-secret|random-secret/i.test(secret)) {
            try { secret = fs.readFileSync(path.join(this.dataDir, 'jwt-secret'), 'utf8').trim(); } catch { secret = ''; }
        }
        if (secret.length < 32) throw problem('Local panel JWT secret is not ready', 'LOCAL_PANEL_NOT_READY', 503);
        return { id: admin.id, username: admin.username, role: 'admin', sessionVersion: admin.sessionVersion ?? 0, secret };
    }
    async token(actor) {
        const user = await this.credentials();
        return jwt.sign({ id: user.id, role: 'admin', sessionVersion: user.sessionVersion ?? 0, hubActor: actorIdentity(actor) }, user.secret, { expiresIn: '60s', algorithm: 'HS256' });
    }
    async request(local, actor) {
        if (this.closed) throw problem('Node runtime is stopped', 'NODE_OFFLINE', 503);
        if (this.requestImpl) return this.requestImpl(local, actor);
        const url = new URL(local.path, this.origin);
        for (const [key, value] of Object.entries(local.query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
        const serialized = local.body === undefined ? undefined : JSON.stringify(local.body);
        if (serialized && Buffer.byteLength(serialized) > MAX_BODY) throw problem('Request body exceeds 5 MiB', 'PAYLOAD_TOO_LARGE', 413);
        const long = local.path === '/api/install' || /\/update$/.test(local.path);
        // Installs/updates answer only when SteamCMD is done: fetch would give up after 300 s, so use node:http.
        if (long && this.fetch === globalThis.fetch) {
            const r = await require('./longRequest').longRequest(url.href, { method: local.method, timeoutMs: 30 * 60_000, maxBytes: MAX_RESPONSE,
                headers: { Authorization: `Bearer ${await this.token(actor)}`, ...(serialized ? { 'Content-Type': 'application/json' } : {}) }, body: serialized });
            let body; try { body = r.text ? JSON.parse(r.text) : null; } catch { throw problem('Local panel returned a non-JSON response', 'LOCAL_PANEL_INVALID', 502); }
            return { status: r.status, body };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), long ? 30 * 60_000 : 5 * 60_000);
        timeout.unref?.();
        try {
            const response = await this.fetch(url.href, { method: local.method, redirect: 'error', signal: controller.signal,
                headers: { Authorization: `Bearer ${await this.token(actor)}`, ...(serialized ? { 'Content-Type': 'application/json' } : {}) }, body: serialized });
            if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { controller.abort(); throw problem('Local response exceeds transport limit', 'PAYLOAD_TOO_LARGE', 502); }
            let length = 0;
            const chunks = [];
            for await (const chunk of response.body || []) {
                length += chunk.length;
                if (length > MAX_RESPONSE) { controller.abort(); throw problem('Local response exceeds transport limit', 'PAYLOAD_TOO_LARGE', 502); }
                chunks.push(Buffer.from(chunk));
            }
            const text = Buffer.concat(chunks).toString('utf8');
            let body;
            if (response.status >= 200 && response.status < 300 && /^\/api\/server\/[A-Za-z0-9_-]{1,128}\/logs$/.test(local.path)) body = text;
            else {
                try { body = text ? JSON.parse(text) : null; } catch { throw problem('Local panel returned a non-JSON response', 'LOCAL_PANEL_INVALID', 502); }
            }
            return { status: response.status, body };
        } finally { clearTimeout(timeout); }
    }
    async handle(action, params = {}, actor, operationId) {
        const hubActor = actorIdentity(actor);
        const local = getLocalRequest(action, params);
        if (local.body !== undefined && Buffer.byteLength(JSON.stringify(local.body)) > MAX_BODY) throw problem('Request body exceeds 5 MiB', 'PAYLOAD_TOO_LARGE', 413);
        const mutation = local.method !== 'GET';
        if (!mutation) return this.execute(action, local, hubActor);
        if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId) || ['__proto__', 'constructor', 'prototype'].includes(operationId)) throw problem('Mutation requires an operation ID');
        const hash = crypto.createHash('sha256').update(canonical({ action, local, actor: { id: hubActor.id, username: hubActor.username } })).digest('hex');
        const previous = this.journal[operationId];
        if (previous) {
            if (previous.hash !== hash) throw problem('Operation ID was used for different input', 'OPERATION_CONFLICT', 409);
            if (this.inFlight.has(operationId)) return this.inFlight.get(operationId);
            if (previous.state === 'done') return previous.result;
            return { status: 409, body: { code: 'OUTCOME_UNKNOWN', error: 'Previous operation may have run; verify its outcome before retrying' } };
        }
        const entries = Object.entries(this.journal);
        if (entries.length >= 1000) {
            const completed = entries.filter(([, entry]) => entry.state === 'done').sort((a, b) => a[1].at - b[1].at)[0];
            if (!completed) throw problem('Operation journal is full of unresolved operations', 'OUTCOME_UNKNOWN', 503);
            delete this.journal[completed[0]];
        }
        this.journal[operationId] = { state: 'pending', hash, at: Date.now() };
        try { writeJsonSync(this.journalFile, this.journal); }
        catch (err) { delete this.journal[operationId]; throw err; }
        const promise = this.execute(action, local, hubActor).then(result => {
            this.journal[operationId] = { state: 'done', hash, at: Date.now(), result };
            writeJsonSync(this.journalFile, this.journal);
            return result;
        }).catch(err => {
            // Keep pending after transport/persistence failure: the local action may already have run.
            this.journal[operationId] = { state: 'pending', hash, at: Date.now() };
            throw problem('Local operation outcome is unknown; verify before retrying', 'OUTCOME_UNKNOWN', 502);
        }).finally(() => this.inFlight.delete(operationId));
        this.inFlight.set(operationId, promise);
        return promise;
    }
    async execute(action, local, actor) {
        const result = await this.request(local, actor);
        if (action === 'servers.list' && Array.isArray(result.body)) result.body = result.body.map(sanitizeServer);
        return result;
    }
    async snapshot() {
        const actor = { id: 'hub-snapshot', username: 'hub-snapshot' };
        const [servers, host, catalog] = await Promise.all([
            this.request(getLocalRequest('servers.list'), actor), this.request(getLocalRequest('host'), actor), this.request(getLocalRequest('catalog'), actor),
        ]);
        if ([servers, host, catalog].some(result => result.status !== 200) || !Array.isArray(servers.body)) throw problem('Local panel snapshot is unavailable', 'LOCAL_PANEL_NOT_READY', 503);
        const clean = servers.body.map(sanitizeServer);
        this.watchServers(clean);
        const configured = process.env.NODE_GAME_HOST;
        const addresses = Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal);
        const nodeHost = configured && net.isIP(configured) ? configured : addresses[0]?.address || '127.0.0.1';
        return { servers: clean, host: host.body, catalog: catalog.body, nodeHost };
    }
    watchServers(servers) {
        if (!this.socket) return;
        const next = new Set(servers.map(server => { try { return nativeId(server.id); } catch { return null; } }).filter(Boolean));
        for (const id of this.watched) if (!next.has(id)) this.socket.emit('unwatch', id);
        for (const id of next) if (!this.watched.has(id)) this.socket.emit('watch', id);
        this.watched = next;
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        if (!this.socket) {
            const factory = this.socketFactory || require('socket.io-client').io;
            this.socket = factory(this.origin, { auth: async cb => {
                try { cb({ token: await this.token({ id: 'hub-stream', username: 'hub-stream' }) }); } catch { cb({ token: '' }); }
            }, transports: ['websocket'] });
            this.socket.on('connect', () => { for (const id of this.watched) this.socket.emit('watch', id); });
            const socket = this.socket;
            this.socket.on('disconnect', reason => {
                // A local admin password rotation forces Socket.IO server-disconnect.
                // Socket.IO will not reconnect automatically for that reason.
                if (reason !== 'io server disconnect') return;
                clearTimeout(this.socketRetry);
                this.socketRetry = setTimeout(() => { if (this.socket === socket && this.subscribers.size) socket.connect(); }, 1000);
                this.socketRetry.unref?.();
            });
            this.socket.onAny((name, data) => {
                let packet;
                if (name === 'install-log') packet = { event: name, data };
                else if (/^cache-download-\d{1,12}$/.test(name)) packet = { event: 'cache-download', appId: name.slice('cache-download-'.length), data };
                else {
                    const match = /^(server-log|server-status|server-stats|server-query|update-log|update-complete)-([A-Za-z0-9_-]{1,128})$/.exec(name);
                    if (match && this.watched.has(match[2])) packet = { event: match[1], serverId: match[2], data };
                }
                if (packet) for (const subscriber of this.subscribers) { try { subscriber(packet); } catch { /* disconnected subscriber */ } }
            });
        }
        return () => {
            this.subscribers.delete(callback);
            if (!this.subscribers.size) { clearTimeout(this.socketRetry); this.socket?.disconnect(); this.socket = null; this.watched.clear(); }
        };
    }
    close() { this.closed = true; clearTimeout(this.socketRetry); this.subscribers.clear(); this.socket?.disconnect(); this.socket = null; this.watched.clear(); }
}
function createNodeRuntime(options) { return new NodeRuntime(options); }
module.exports = { NodeRuntime, createNodeRuntime, localApiTarget, sanitizeServer };

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const steamcmd = require('./services/steamcmd');
const processManager = require('./services/processManager');
const serverStore = require('./services/serverStore');
const templateStore = require('./services/templateStore');
const pluginService = require('./services/pluginService');

const userStore = require('./services/userStore');
const settingsStore = require('./services/settingsStore');
const { authMiddleware, socketAuth, JWT_SECRET, validTeamDomain } = require('./middleware/auth');
const { safeJoin, isInside, isNumericId, isBackupName, SERVERS_ROOT, requireAdmin, loginBlocked, loginFailed, loginSucceeded } = require('./middleware/guard');
const cron = require('node-cron');
const crypto = require('crypto');
const catalog = require('./services/catalog');
const access = require('./services/access');
const hostMetrics = require('./services/hostMetrics');
const { NodeRegistry } = require('./services/nodeRegistry');
const nodeRegistry = new NodeRegistry();
const { RemoteServers, splitRemoteId } = require('./services/remoteServers');
const { createRemoteRouter, uiActions, nullHost } = require('./services/remoteRouter');
const remoteServers = new RemoteServers();
let nodeTransport = null;
const nodeTransportReady = (async () => {
    if (!process.env.NODE_PORT) return;
    const key = fs.readFileSync(process.env.NODE_TLS_KEY_FILE);
    const cert = fs.readFileSync(process.env.NODE_TLS_CERT_FILE);
    nodeTransport = await require('./services/nodeTransport').createNodeTransport({
        registry: nodeRegistry, host: process.env.NODE_HOST || '127.0.0.1', port: Number(process.env.NODE_PORT), key, cert,
    });
    wireRemoteTransport(nodeTransport);
})().catch(err => { console.error('Node listener disabled:', err.message); });
const querySnapshot = require('./services/querySnapshot');
const schedulerService = require('./services/schedulerService');
const backupService = require('./services/backupService');
const cacheService = require('./services/cacheService');
const auditLog = require('./services/auditLog');
const { auditContext } = require('./services/auditContext');
const audit = (req, action, srv, detail) => auditLog.add({ user: req.hubActor?.username || req.user?.username || 'system', action, serverId: srv?.id || null, server: srv?.name || null, detail: detail || null, ...auditContext(req) });
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
// Same-origin only: the panel serves its own frontend, so no cross-site API or socket access.
const io = new Server(server, {
    cors: process.env.APP_URL ? { origin: process.env.APP_URL, methods: ["GET", "POST"] } : undefined
});
io.use(socketAuth);
userStore.on('identities-changed', users => require('./services/socketSessions').invalidateChangedUsers(io, users));
nodeRegistry.on('removed', ({ id }) => {
    try { remoteServers.removeNode(id); } catch (err) { console.error('Remote metadata cleanup failed:', err.message); }
    for (const socket of io.sockets.sockets.values()) {
        for (const room of socket.rooms) if (room.startsWith(`srv:${id}:`)) socket.leave(room);
    }
});

function wireRemoteTransport(transport) {
    transport.events.on('snapshot', ({ nodeId, data }) => {
        try { remoteServers.sync(nodeId, data); } catch (err) { console.error('Remote snapshot persistence failed:', err.message); }
    });
    transport.events.on('stream', ({ nodeId, event, serverId, appId, data }) => {
        if (event === 'install-log') return io.to('admins').emit(`install-log-${nodeId}`, String(data).slice(-16000));
        if (event === 'cache-download' && /^\d{1,12}$/.test(String(appId))) return io.to('admins').emit(`cache-download-${nodeId}:${appId}`, String(data).slice(-16000));
        const compositeId = `${nodeId}:${serverId}`;
        if (!remoteServers.get(compositeId, nodeRegistry, transport)) return;
        if (['server-log', 'update-log'].includes(event)) data = String(data).slice(-16000);
        else if (event === 'server-status') {
            if (!['running', 'stopped', 'failed', 'installing'].includes(data)) return;
        } else if (event === 'server-stats') {
            data = { cpu: Number.isFinite(data?.cpu) && data.cpu >= 0 ? data.cpu : 0, memory: Number.isFinite(data?.memory) && data.memory >= 0 ? data.memory : 0 };
        } else if (event === 'server-query') {
            data = { online: data?.online === true, players: Number.isInteger(data?.players) && data.players >= 0 ? data.players : null,
                maxPlayers: Number.isInteger(data?.maxPlayers) && data.maxPlayers >= 0 ? data.maxPlayers : null, map: String(data?.map || '').slice(0, 128) };
        } else if (event === 'update-complete') data = { success: data?.success === true, error: String(data?.error || '').slice(0, 2000) };
        else return;
        io.to(`srv:${compositeId}`).emit(`${event}-${compositeId}`, data);
    });
}

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
app.use(express.json({ limit: '6mb' }));
fs.ensureDirSync(SERVERS_ROOT);

// Kill all orphaned srcds.exe processes on startup (Windows only)
function cleanupOrphanedProcesses() {
    // Skip cleanup on Linux/Docker (process management handled differently)
    if (process.platform !== 'win32') {
        console.log('Skipping Windows-specific process cleanup (running on', process.platform + ')');
        return;
    }

    console.log('Cleaning up orphaned server processes...');
    const cleanup = spawn('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Process srcds -ErrorAction SilentlyContinue | Stop-Process -Force'
    ]);

    cleanup.on('close', (code) => {
        console.log('Process cleanup complete.');
    });

    cleanup.on('error', (err) => {
        console.log('Process cleanup skipped:', err.message);
    });
}

cleanupOrphanedProcesses();

// SteamCMD downloads on first install (steamcmd.install calls init), not at every start.
// An unhandled failure here used to crash the panel when offline.

// Load server data from disk before any operations
(async () => {
    await serverStore.load();
    await userStore.init(); // Initialize user store (creates default admin if needed)
    const servers = serverStore.getAll();
    for (const srv of servers) {
        if (srv.status === 'installing') {
            // The panel stopped (restart or host crash) part-way through a download.
            await serverStore.update(srv.id, { status: 'failed', installError: 'Install was interrupted. Use Update to finish it.' });
        } else if (srv.status !== 'stopped' && srv.status !== 'failed') {
            await serverStore.updateStatus(srv.id, 'stopped');
        }
    }
})();



// Serve static frontend files in production (BEFORE Auth Middleware)
// Check both Docker path (./frontend/dist) and development path (../frontend/dist)
console.log('__dirname:', __dirname);
let frontendPath = path.join(__dirname, 'frontend/dist');
console.log('Checking Docker path:', frontendPath, '- Exists:', fs.existsSync(frontendPath));
if (!fs.existsSync(frontendPath)) {
    frontendPath = path.join(__dirname, '../frontend/dist');
    console.log('Checking dev path:', frontendPath, '- Exists:', fs.existsSync(frontendPath));
}

if (fs.existsSync(frontendPath)) {
    console.log('✅ Serving frontend from:', frontendPath);
    app.use(express.static(frontendPath));
} else {
    console.log('❌ Frontend build not found at:', frontendPath);
}


// Apply Auth Middleware (Only for API routes)
app.use('/api', authMiddleware);
app.use('/api', createRemoteRouter({ registry: nodeRegistry, getTransport: () => nodeTransport, store: remoteServers, userStore, audit,
    onAccessChanged: (id, srv) => { for (const socket of io.sockets.sockets.values()) if (socket.rooms.has(`srv:${id}`) && !access.can(socket.data.user, srv, 'view')) socket.leave(`srv:${id}`); } }));

// Per-server permissions for non-admins (services/access.js). Admins pass straight through.
app.use('/api/server', (req, res, next) => {
    if (!req.user || req.user.role === 'admin') return next();
    const parts = req.path.split('/').filter(Boolean);   // e.g. ['abc', 'files'] or ['start']
    let srv, perm;
    if (parts.length === 1 && ['start', 'stop'].includes(parts[0]) && req.method === 'POST') {
        srv = serverStore.get(req.body?.id); perm = 'power';
    } else {
        srv = serverStore.get(parts[0]); perm = access.needed(req.method, parts[1] || '');
    }
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (!perm || !access.can(req.user, srv, perm)) return res.status(403).json({ error: "You don't have access to that" });
    next();
});

// Routes

// Auth Routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.socket.remoteAddress;
    if (loginBlocked(ip)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username and password required' });
    try {
        const user = await userStore.authenticate(username, password);
        if (!user) {
            loginFailed(ip);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        loginSucceeded(ip);

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, sessionVersion: user.sessionVersion },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Debug endpoint to check Cloudflare headers (public route)
app.get('/api/debug/headers', requireAdmin, (req, res) => {
    res.json({
        cfJwt: req.headers['cf-access-jwt-assertion'] ? 'Present' : 'Missing',
        cfJwtLength: req.headers['cf-access-jwt-assertion']?.length || 0,
        allHeaders: Object.keys(req.headers),
        userAgent: req.headers['user-agent']
    });
});

app.get('/api/users', async (req, res) => {
    try {
        // Only admin can list users
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const users = await userStore.getUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const { username, password, role } = req.body;
        const newUser = await userStore.addUser(username, password, role);
        res.json(newUser);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        await userStore.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/users/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        await userStore.changePassword(req.user.id, currentPassword, newPassword);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Settings endpoints. Only the auth mode is public (the login page needs it); the rest is admin-only.
const SETTING_KEYS = ['steamApiKey', 'authMode', 'cfAccessTeamDomain', 'cfAccessAud'];
const publicSettings = s => ({ ...s, steamApiKey: '', steamApiKeySet: !!s.steamApiKey });

app.get('/api/auth-mode', async (req, res) => {
    const settings = await settingsStore.getSettings();
    res.json({ authMode: settings.authMode === 'external' ? 'external' : 'local' });
});

app.get('/api/settings', requireAdmin, async (req, res) => {
    try {
        res.json(publicSettings(await settingsStore.getSettings()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
    try {
        const update = {};
        for (const k of SETTING_KEYS) if (typeof req.body?.[k] === 'string') update[k] = req.body[k].trim();
        if (update.steamApiKey === '') delete update.steamApiKey;   // blank field = keep the saved key
        if ('authMode' in update && !['local', 'external'].includes(update.authMode)) return res.status(400).json({ error: 'Auth mode must be local or external' });
        const next = { ...(await settingsStore.getSettings()), ...update };
        if (next.authMode === 'external' && (!validTeamDomain(next.cfAccessTeamDomain) || !next.cfAccessAud)) {
            return res.status(400).json({ error: 'Set a team domain like https://<team>.cloudflareaccess.com and the AUD tag first' });
        }
        res.json(publicSettings(await settingsStore.updateSettings(update)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/servers', (req, res) => {
    // Users only see servers they can access; secrets and host paths are for admins only.
    const all = [...serverStore.getAll().map(s => ({ ...s, nodeId: 'local', nodeName: 'Local host', nodeOs: process.platform, nodeOnline: true, ...querySnapshot.get(s.id, processManager.getStatus(s.id) === 'running') })),
        ...remoteServers.list(nodeRegistry, nodeTransport).map(s => ({ ...s, actions: uiActions(nodeTransport?.getCapabilities(s.nodeId) || []) }))];
    if (req.user?.role === 'admin') return res.json(all.map(s => ({ ...s, perms: access.PERMS })));
    res.json(all.filter(s => access.can(req.user, s, 'view')).map(({ rconPassword, path: _p, env, access: _a, vars, ...s }) => ({ ...s, perms: access.permsFor(req.user, { ...s, access: _a }) })));
});

app.get('/api/host', async (req, res) => {
    if (req.user.role !== 'admin' && !serverStore.getAll().some(s => access.can(req.user, s, 'view'))) {
        return res.status(403).json({ error: 'Server access required' });
    }
    res.json(await hostMetrics.snapshot());
});

const nodeError = (res, err) => res.status(err.status || 400).json({ error: err.message, code: err.status === 404 ? 'NODE_UNKNOWN' : 'NODE_REQUEST_INVALID' });
app.get('/api/nodes', requireAdmin, async (_req, res) => {
    const statuses = nodeTransport?.listStatus() || {};
    res.json([{ id: 'local', name: 'Local host', os: process.platform, online: true, lastSeen: new Date().toISOString(), version: '1', host: await hostMetrics.snapshot(), actions: [] },
        ...nodeRegistry.list().map(node => {
            const capabilities = nodeTransport?.getCapabilities(node.id) || [];
            return { ...node, ...(statuses[node.id] || { online: false, lastSeen: null }), host: statuses[node.id]?.online ? nodeTransport?.getSnapshot(node.id)?.host || nullHost() : nullHost(),
                actions: [...(capabilities.includes('install') ? ['install'] : []), ...(capabilities.includes('cache.list') && capabilities.includes('cache.download') ? ['cache'] : [])] };
        })]);
});
app.get('/api/nodes/pending', requireAdmin, (_req, res) => res.json(nodeRegistry.listPending()));
app.get('/api/nodes/config', requireAdmin, async (_req, res) => {
    await nodeTransportReady;
    res.json({ enabled: !!nodeTransport, hubUrl: process.env.NODE_PUBLIC_URL || nodeTransport?.hubUrl || null, hubFingerprint: nodeTransport?.fingerprint || null });
});
app.post('/api/nodes/enrol', requireAdmin, async (req, res) => {
    await nodeTransportReady;
    if (!nodeTransport) return res.status(503).json({ error: 'Configure the dedicated TLS node listener first', code: 'NODE_LISTENER_DISABLED' });
    try {
        const bundle = nodeRegistry.createEnrolment({ hubUrl: process.env.NODE_PUBLIC_URL || nodeTransport.hubUrl, hubFingerprint: nodeTransport.fingerprint });
        audit(req, 'node-enrol', null, bundle.codeId);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json(bundle);
    }
    catch (err) { nodeError(res, err); }
});
app.delete('/api/nodes/enrol/:codeId', requireAdmin, (req, res) => {
    try { nodeRegistry.cancelEnrolment(req.params.codeId); audit(req, 'node-enrol-cancel', null, req.params.codeId); res.json({ success: true }); }
    catch (err) { nodeError(res, err); }
});
app.post('/api/nodes/:id/approve', requireAdmin, (req, res) => {
    try { const node = nodeRegistry.approve(req.params.id, req.body || {}); audit(req, 'node-approve', null, node.id); res.json(nodeRegistry.list().find(item => item.id === node.id)); }
    catch (err) { nodeError(res, err); }
});
// ---- One-click node updates (claude, Daniel #gamemanager 3591/3595). See services/nodeUpdate.js. ----
const nodeUpdate = require('./services/nodeUpdate');
try { nodeUpdate.signingKey(); } catch (err) { console.error('Node update signing key unavailable:', err.message); }
// Node side: the hub pushes the package in chunks over the link, then stages it for the SYSTEM updater.
app.post('/api/node-update/chunk', requireAdmin, (req, res) => { try { res.json(nodeUpdate.receiveChunk(req.body || {})); } catch (err) { res.status(err.status || 400).json({ error: err.message, code: err.code }); } });
app.post('/api/node-update/stage', requireAdmin, (req, res) => { try { res.json(nodeUpdate.stage(req.body || {})); } catch (err) { res.status(err.status || 400).json({ error: err.message, code: err.code }); } });
app.get('/api/node-update/status', requireAdmin, (_req, res) => res.json(nodeUpdate.status()));
// Hub side.
const updateJobs = new Map();   // nodeId -> { step, sent, total, version, error, at }
app.get('/api/nodes/update-info', requireAdmin, (_req, res) => {
    try { const info = nodeUpdate.packageInfo(); res.json({ available: !!info, version: info?.manifest.version || null, size: info?.manifest.size || null }); }
    catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
app.get('/api/nodes/:id/update', requireAdmin, (req, res) => res.json(updateJobs.get(req.params.id) || { step: 'idle' }));
app.post('/api/nodes/:id/update', requireAdmin, async (req, res) => {
    const id = req.params.id;
    if (!nodeRegistry.list().some(n => n.id === id)) return res.status(404).json({ error: 'Unknown node', code: 'NODE_UNKNOWN' });
    if (!nodeTransport?.listStatus()[id]?.online) return res.status(503).json({ error: 'That machine is offline', code: 'NODE_OFFLINE' });
    const running = updateJobs.get(id);
    if (running && ['sending', 'waiting'].includes(running.step)) return res.status(409).json({ error: 'An update is already in progress' });
    let info;
    try { info = nodeUpdate.packageInfo(); } catch (err) { return res.status(500).json({ error: err.message }); }
    if (!info) return res.status(503).json({ error: 'No update package has been built on this panel yet' });
    const job = { step: 'sending', sent: 0, total: info.manifest.size, version: info.manifest.version, error: null, at: Date.now() };
    updateJobs.set(id, job);
    audit(req, 'node-update', null, `${id} → ${info.manifest.version}`);
    res.status(202).json(job);
    const actor = { id: req.user.id || req.user.username, username: req.user.username, role: req.user.role };
    try {
        const call = async (action, params) => {
            const r = await nodeTransport.request(id, action, params, actor, { timeoutMs: 120000 });
            if (r.status < 200 || r.status >= 300) throw new Error(r.body?.error || `${action} failed (${r.status})`);
            return r.body;
        };
        for (let offset = 0; offset < info.data.length; offset += nodeUpdate.CHUNK) {
            const part = info.data.subarray(offset, offset + nodeUpdate.CHUNK);
            await call('update.chunk', { offset, data: part.toString('base64'), total: info.data.length, sha256: info.manifest.sha256 });
            job.sent = offset + part.length;
        }
        await call('update.stage', { manifest: info.manifest, signature: info.signature });
        job.step = 'waiting';
        // The PC's updater checks every minute, swaps the app and restarts; the link comes back with the new version.
        const deadline = Date.now() + 10 * 60000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const st = nodeTransport.listStatus()[id];
            if (st?.online && st.version === info.manifest.version) { job.step = 'done'; return; }
            if (st?.online) {
                try { const s = await call('update.status', {}); if (s?.result?.status === 'failed') { job.step = 'failed'; job.error = s.result.error || 'The update failed on the machine; it kept its old version.'; return; } } catch { /* restarting */ }
            }
        }
        job.step = 'failed'; job.error = 'The machine did not come back with the new version within 10 minutes. Check it is running the latest Setup (with the updater).';
    } catch (err) { job.step = 'failed'; job.error = err.message; }
});

// ---- Move a server to another machine (claude, Daniel #gamemanager 3576/3580). ----
// Per machine: pack the game's configs/saves, hand the archive out in chunks, receive + unpack into a server folder.
const moveArchive = require('./services/moveArchive');
const moveErr = (res, err) => res.status(err.status || 400).json({ error: err.message, code: err.code });
const gameOf = srv => catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
app.post('/api/server/:id/export', requireAdmin, (req, res) => {
    const srv = serverStore.get(req.params.id); if (!srv) return res.status(404).json({ error: 'Server not found' });
    try { res.json(moveArchive.exportServer(srv.path, moveArchive.keepPaths(gameOf(srv)))); } catch (err) { moveErr(res, err); }
});
app.get('/api/move-archive/:token', requireAdmin, (req, res) => { try { res.json(moveArchive.readChunk(req.params.token, req.query.offset)); } catch (err) { moveErr(res, err); } });
app.delete('/api/move-archive/:token', requireAdmin, (req, res) => { try { res.json(moveArchive.cleanup(req.params.token)); } catch (err) { moveErr(res, err); } });
app.post('/api/server/:id/import-chunk', requireAdmin, (req, res) => {
    if (!serverStore.get(req.params.id)) return res.status(404).json({ error: 'Server not found' });
    try { res.json(moveArchive.receiveChunk(req.body || {})); } catch (err) { moveErr(res, err); }
});
app.post('/api/server/:id/import', requireAdmin, (req, res) => {
    const srv = serverStore.get(req.params.id); if (!srv) return res.status(404).json({ error: 'Server not found' });
    try { res.json(moveArchive.importInto(srv.path, req.body?.token)); } catch (err) { moveErr(res, err); }
});

// Hub: the move job. Each step talks to the source/target the same way the browser would: local routes over HTTP
// with a short-lived token for the admin who started it, remote ones as named actions over the node link.
const moveJobs = new Map();
async function moveCaller(req) {
    const user = (await userStore.getUsers()).find(u => u.id === req.user.id);
    const token = user ? jwt.sign({ id: user.id, username: user.username, role: user.role, sessionVersion: user.sessionVersion }, JWT_SECRET, { expiresIn: '2h' }) : null;
    const actor = { id: req.user.id || req.user.username, username: req.user.username, role: req.user.role };
    return async (side, method, route, body, { query, timeoutMs = 120000 } = {}) => {
        if (side === 'local') {
            if (!token) throw new Error('Cannot act as this user locally');
            const url = `http://${HOST && HOST !== '0.0.0.0' ? HOST : '127.0.0.1'}:${PORT}${route}${query ? `?${new URLSearchParams(query)}` : ''}`;
            // node:http, not fetch: a local install can take far longer than fetch's 300 s header limit.
            const r = await require('./services/longRequest').longRequest(url, { method, timeoutMs, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
            let data = {}; try { data = r.text ? JSON.parse(r.text) : {}; } catch { data = {}; }
            if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(data.error || `${route} failed (${r.status})`), { status: r.status });
            return data;
        }
        if (!nodeTransport?.listStatus()[side]?.online) throw new Error('That machine is offline');
        const mapped = require('./services/nodeActions').classifyRemoteRequest(method, route, body || {}, query || {});
        if (!mapped) throw new Error(`Unsupported step ${method} ${route}`);
        const r = await nodeTransport.request(side, mapped.action, mapped.params, actor, { timeoutMs });
        if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(r.body?.error || `${mapped.action} failed (${r.status})`), { status: r.status });
        return r.body;
    };
}
const splitId = id => { const m = /^([0-9a-f-]{36}):(.+)$/.exec(id); return m ? { node: m[1], id: m[2] } : { node: 'local', id }; };
app.post('/api/moves', requireAdmin, async (req, res) => {
    const { serverId, targetNodeId } = req.body || {};
    if (typeof serverId !== 'string' || typeof targetNodeId !== 'string') return res.status(400).json({ error: 'Pick a server and a machine' });
    const src = splitId(serverId);
    if (src.node === targetNodeId) return res.status(400).json({ error: 'The server is already on that machine' });
    if (targetNodeId !== 'local' && !nodeRegistry.list().some(n => n.id === targetNodeId)) return res.status(404).json({ error: 'Unknown machine', code: 'NODE_UNKNOWN' });
    const call = await moveCaller(req);
    const moveId = crypto.randomBytes(8).toString('hex');
    const job = { id: moveId, serverId, targetNodeId, step: 'stopping', progress: 0, log: [], error: null, newServerId: null, wasRunning: false };
    const log = line => { job.log.push(line); if (job.log.length > 200) job.log.shift(); };
    moveJobs.set(moveId, job);
    audit(req, 'move', null, `${serverId} → ${targetNodeId}`);
    res.status(202).json({ moveId });
    let archive = null, created = null;
    try {
        const list = await call(src.node, 'GET', '/api/servers');
        const srv = (Array.isArray(list) ? list : []).find(s => s.id === src.id || s.id === serverId);
        if (!srv) throw new Error('Server not found on its machine');
        const { vars } = await call(src.node, 'GET', `/api/server/${src.id}/settings`);
        const game = catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
        if (!game) throw new Error('Only servers installed from the game list can be moved');
        const mode = (game.modes || []).find(m => m.gamemode && m.gamemode === vars?.gamemode && m.download);
        job.wasRunning = srv.status === 'running';
        if (job.wasRunning) { log('Stopping the server…'); await call(src.node, 'POST', '/api/server/stop', { id: src.id }); }
        job.progress = 5;
        log('Packing configs and saves…');
        archive = await call(src.node, 'POST', `/api/server/${src.id}/export`, {});
        log(`Packed ${archive.entries} items (${Math.round(archive.size / 1024)} KB).`);
        job.step = 'installing'; job.progress = 10;
        log(`Installing ${game.name} on the new machine (this downloads the game; it can take a while)…`);
        const installed = await call(targetNodeId, 'POST', '/api/install', { gameId: game.id, vars, ...(mode ? { mode: mode.id } : {}) }, { timeoutMs: 1800000 });
        created = installed?.server?.id ? splitId(installed.server.id).id : null;
        if (!created) throw new Error('The install did not report a new server');
        job.newServerId = targetNodeId === 'local' ? created : `${targetNodeId}:${created}`;
        job.step = 'copying'; job.progress = 70;
        log('Copying configs and saves…');
        for (let offset = 0; offset < archive.size || offset === 0; ) {
            const part = await call(src.node, 'GET', `/api/move-archive/${archive.token}`, null, { query: { offset } });
            await call(targetNodeId, 'POST', `/api/server/${created}/import-chunk`, { token: archive.token, offset, data: part.data, total: archive.size || 1 });
            offset += Buffer.from(part.data, 'base64').length;
            job.progress = 70 + Math.round((offset / Math.max(archive.size, 1)) * 15);
            if (!part.data) break;
        }
        const imported = await call(targetNodeId, 'POST', `/api/server/${created}/import`, { token: archive.token });
        log(`Copied ${imported.files} files.`);
        job.step = 'verifying'; job.progress = 90;
        log('Starting it on the new machine…');
        await call(targetNodeId, 'POST', '/api/server/start', { id: created });
        let running = false;
        for (let i = 0; i < 15 && !running; i++) { await new Promise(r => setTimeout(r, 2000)); running = (await call(targetNodeId, 'GET', `/api/server/${created}/status`)).status === 'running'; }
        if (!running) throw new Error('It installed but did not stay running on the new machine');
        job.step = 'done'; job.progress = 100; log('Running on the new machine.');
    } catch (err) {
        job.failedAt = job.step; job.step = 'failed'; job.error = err.code === 'OUTCOME_UNKNOWN' || /outcome is unknown/i.test(err.message) ? `${err.message}. The other machine may still be finishing that step: check its server list before trying again.` : err.message; log(`Failed: ${job.error}`);
        if (created) { try { await call(targetNodeId, 'DELETE', `/api/server/${created}`); log('Removed the half-made copy on the new machine.'); } catch { /* best effort */ } }
        if (job.wasRunning) { try { await call(src.node, 'POST', '/api/server/start', { id: src.id }); log('Restarted the original.'); } catch { /* best effort */ } }
    } finally {
        if (archive?.token) { for (const side of [src.node, targetNodeId]) { try { await call(side, 'DELETE', `/api/move-archive/${archive.token}`); } catch { /* temp file */ } } }
    }
    job.finish = async removeSource => {
        if (removeSource) await call(src.node, 'DELETE', `/api/server/${src.id}`);
        job.step = 'finished';
    };
});
app.get('/api/moves/:id', requireAdmin, (req, res) => {
    const job = moveJobs.get(req.params.id); if (!job) return res.status(404).json({ error: 'Unknown move' });
    const { finish, ...view } = job; res.json(view);
});
app.post('/api/moves/:id/finish', requireAdmin, async (req, res) => {
    const job = moveJobs.get(req.params.id); if (!job) return res.status(404).json({ error: 'Unknown move' });
    if (job.step !== 'done' || !job.finish) return res.status(409).json({ error: 'The move has not finished yet' });
    try { await job.finish(req.body?.removeSource === true); audit(req, 'move-finish', null, `${job.serverId} removeSource=${req.body?.removeSource === true}`); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/nodes/:id', requireAdmin, (req, res) => {
    try { nodeRegistry.remove(req.params.id); audit(req, 'node-remove', null, req.params.id); res.json({ success: true }); }
    catch (err) { nodeError(res, err); }
});

app.get('/api/art/:gameId', async (req, res) => {
    try {
        const art = await require('./services/gameArt').getArt(req.params.gameId);
        if (!art) return res.status(404).end();
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.type(art.mime).sendFile(art.path);
    } catch { res.status(404).end(); }
});

// Admin: who else can use this server, and what they can do.
app.put('/api/server/:id/access', requireAdmin, async (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const users = (await userStore.getUsers()).filter(u => u.role !== 'admin').map(u => u.username);
    const list = access.cleanAccess(req.body?.access, users);
    if (!list) return res.status(400).json({ error: 'Pick existing users and valid permissions' });
    const updated = await serverStore.update(srv.id, { access: list });
    // Room membership outlives HTTP requests: revoke existing live subscriptions too.
    const room = `srv:${srv.id}`;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.rooms.has(room) && !access.can(socket.data.user, updated, 'view')) socket.leave(room);
    }
    audit(req, 'access', srv, list.map(a => `${a.username}:${a.perms.join('+')}`).join(', ') || 'none');
    res.json({ success: true, access: updated.access });
});


// Install from the game catalogue (catalog/games.json). The client sends a catalogue id and the
// game's settings; launch lines are built server-side, so the client never chooses a program to run.
app.get('/api/games', (req, res) => res.json({ nodeId: 'local', platform: catalog.platformKey(), games: catalog.list() }));

app.post('/api/install', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const game = catalog.get(body.gameId) || catalog.findByAppId(body.appId);
    if (!game) return res.status(400).json({ error: 'Pick a game' });
    // Game modes (claude, Daniel #gamemanager 3576): the mode sets +gamemode, a Workshop collection, extra downloads.
    let mode = null;
    if (body.mode !== undefined) {
        mode = (game.modes || []).find(m => m.id === body.mode);
        if (!mode) return res.status(400).json({ error: 'Pick one of this game\'s modes' });
        if (mode.needsWorkshopKey && !/^\d{1,20}$/.test(String(body.workshopCollection || ''))) return res.status(400).json({ error: 'Enter the Workshop collection ID (the number at the end of its Steam link)' });
    }
    const modeVars = mode ? { ...(mode.gamemode ? { gamemode: mode.gamemode } : {}), ...(mode.needsWorkshopKey ? { workshop: String(body.workshopCollection) } : {}),
        ...(mode.customGamemode && typeof body.gamemode === 'string' && body.gamemode ? { gamemode: body.gamemode } : {}) } : {};
    const { vars, errors } = catalog.cleanVars(game, { ...(body.vars || {}), ...modeVars, ...(body.hostname ? { name: body.hostname } : {}), ...(body.port ? { port: body.port } : {}) });
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    if (!game[catalog.platformKey()]) return res.status(400).json({ error: `${game.name} only has a ${game.linux ? 'Linux' : 'Windows'} server` });
    const clash = serverStore.getAll().find(s => Number(s.port) === vars.port);
    if (clash) return res.status(409).json({ error: `Port ${vars.port} is already used by ${clash.name}` });

    let newServer = null;
    try {
        // Every server goes in its own folder under SERVERS_ROOT; the folder name comes from the server name.
        let folder = vars.name.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || game.id;
        if (await fs.pathExists(path.join(SERVERS_ROOT, folder))) folder = `${folder}-${Date.now().toString(36)}`;
        const installPath = safeJoin(SERVERS_ROOT, folder);
        console.log(`Installing ${game.name} (${game.appId}) to ${installPath}...`);
        const log = line => io.to('admins').emit('install-log', line);

        // Save the record before downloading, so a crash or restart mid-install leaves a
        // visible "failed" server (finish it with Update) instead of a nameless folder.
        const rconPassword = catalog.newRconPassword();
        const launch = catalog.buildLaunch(game, vars, { rconPassword });
        newServer = await serverStore.add({
            id: crypto.randomUUID(),
            name: vars.name,
            game: game.name,
            gameId: game.id,
            appId: game.appId,
            path: installPath,
            port: vars.port,
            vars,
            rconPassword,
            status: 'installing',
            owner: req.user ? req.user.username : 'admin',
            autoRestart: true,
            ...launch,
        });

        if (body.useCache && await cacheService.isCached(game.appId)) {
            log('Copying from cache...\n');
            await cacheService.copyFromCache(game.appId, installPath);
        } else {
            await steamcmd.install(game.appId, installPath, log, game.beta || null);
        }

        if (game.engine === 'source') await steamcmd.createServerConfig(installPath, game.gameDir, rconPassword, vars.name);
        if (mode?.download) await require('./services/modeDownloads').installModeFiles(mode.download, installPath, log);
        audit(req, 'install', newServer, mode ? `${game.name} · ${mode.name}` : game.name);
        newServer = await serverStore.update(newServer.id, { status: 'stopped', installError: undefined });
        log(`\nDone: ${vars.name} is ready.\n`);
        res.json({ success: true, server: newServer });
    } catch (err) {
        console.error('Installation failed:', err);
        if (newServer) await serverStore.update(newServer.id, { status: 'failed', installError: err.message }).catch(() => {});
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Change a server's settings (name, map, players, ports...). Rebuilds the launch line from the catalogue.
app.put('/api/server/:id/settings', requireAdmin, async (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const game = catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
    if (!game) return res.status(400).json({ error: 'This server was not installed from the catalogue; edit its launch line instead' });
    const { vars, errors } = catalog.cleanVars(game, { ...(srv.vars || {}), ...(req.body?.vars || {}) });
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const clash = serverStore.getAll().find(s => s.id !== srv.id && Number(s.port) === vars.port);
    if (clash) return res.status(409).json({ error: `Port ${vars.port} is already used by ${clash.name}` });
    if (!srv.rconPassword) srv.rconPassword = catalog.newRconPassword();
    const launch = catalog.buildLaunch(game, vars, srv);
    const autoRestart = typeof req.body?.autoRestart === 'boolean' ? req.body.autoRestart : srv.autoRestart !== false;
    const updated = await serverStore.update(srv.id, { vars, name: vars.name, port: vars.port, autoRestart, rconPassword: srv.rconPassword, ...launch });
    audit(req, 'settings', srv);
    res.json({ success: true, server: updated, restartNeeded: processManager.getStatus(srv.id) === 'running' });
});

app.get('/api/server/:id/settings', (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const game = catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
    const fields = game ? catalog.list().find(g => g.id === game.id).vars : [];
    const vars = { ...(srv.vars || {}) };
    if (req.user.role !== 'admin') delete vars.password;
    res.json({ fields, vars, autoRestart: srv.autoRestart !== false, configFile: game?.configFile || null, notes: game?.notes || null });
});

// Command line (claude, Daniel #gamemanager 3576, contract #3581): admin-only template + custom parameters with a
// preview. The RCON password is never shown in the preview. Servers not from the catalogue edit their raw args.
function launchView(srv, template, customArgs) {
    const game = catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
    const shown = { ...catalog.launchValues(game ? srv.vars : { port: srv.port }, srv, game), rconpassword: '••••' };
    const def = game ? catalog.defaultTemplate(game) : (srv.args || []).map(catalog.quoteArg).join(' ');
    const tpl = template === undefined ? (game ? (srv.launchTemplate ?? null) : def) : template;
    const custom = customArgs === undefined ? (game ? (srv.customArgs || '') : '') : customArgs;
    const { rconpassword, ...variables } = shown;
    return { game, def, executable: srv.executable || '', template: tpl, defaultTemplate: def, customArgs: custom, variables: { ...variables, rconpassword: '(hidden)' },
        preview: [...catalog.renderArgs(tpl ?? def, custom, shown), ...(game ? catalog.workshopArgs(shown, { mask: true }) : [])] };
}
const launchError = (res, err) => res.status(err.status || 400).json({ error: err.message, ...(err.at !== undefined ? { at: err.at } : {}), code: err.code || 'LAUNCH_TEMPLATE_INVALID' });
app.get('/api/server/:id/launch', requireAdmin, (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try { const { game, def, ...view } = launchView(srv); res.json(view); } catch (err) { launchError(res, err); }
});
app.post('/api/server/:id/launch/preview', requireAdmin, (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { template, customArgs } = req.body || {};
    try { const { preview } = launchView(srv, template ?? null, typeof customArgs === 'string' ? customArgs : ''); res.json({ preview }); } catch (err) { launchError(res, err); }
});
app.put('/api/server/:id/launch', requireAdmin, async (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { template = null, customArgs = '' } = req.body || {};
    if ((template !== null && typeof template !== 'string') || typeof customArgs !== 'string') return res.status(400).json({ error: 'Send the template and custom parameters as text', code: 'LAUNCH_TEMPLATE_INVALID' });
    try {
        const { game, def } = launchView(srv, template, customArgs);   // validates both
        const values = catalog.launchValues(game ? srv.vars : { port: srv.port }, srv, game);
        const tpl = template !== null && template.trim() === def.trim() ? null : template;
        const args = [...catalog.renderArgs(tpl ?? def, customArgs, values), ...(game ? catalog.workshopArgs(values) : [])];
        await serverStore.update(srv.id, game ? { launchTemplate: tpl, customArgs, args } : { args });
        audit(req, 'settings', srv, 'Command line changed');
        const { game: _g, def: _d, ...view } = launchView(serverStore.get(srv.id));
        res.json(view);
    } catch (err) { launchError(res, err); }
});

app.post('/api/server/start', async (req, res) => {
    const { id } = req.body || {};
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        await startServer(srv);
        audit(req, 'start', srv);
        res.json({ success: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Shared by the start route, scheduled tasks and crash recovery.
async function startServer(srv) {
    if (srv.status === 'installing') throw Object.assign(new Error('Still installing'), { status: 409 });
    if (srv.status === 'failed') throw Object.assign(new Error('Install did not finish. Run Update first.'), { status: 409 });
    if (!srv.executable) {
        const game = catalog.get(srv.gameId) || catalog.findByAppId(srv.appId);
        if (!game) throw Object.assign(new Error('No launch line set. Add one in the Launch tab.'), { status: 400 });
        const { vars } = catalog.cleanVars(game, srv.vars || { name: srv.name, port: srv.port });
        Object.assign(srv, catalog.buildLaunch(game, vars, srv));
        await serverStore.update(srv.id, { executable: srv.executable, args: srv.args, env: srv.env, cwd: srv.cwd });
    }
    // The program and working folder must live inside the server's own folder.
    const execPath = path.resolve(srv.path, srv.executable);
    const cwd = path.resolve(srv.path, srv.cwd || '');
    if (!isInside(srv.path, execPath) || !isInside(srv.path, cwd)) throw Object.assign(new Error('Executable must be inside the server folder'), { status: 400 });
    if (!await fs.pathExists(execPath)) throw Object.assign(new Error(`Program not found: ${srv.executable}. Has the game finished installing?`), { status: 400 });
    // Only plain NAME=value pairs from the catalogue; never PATH or loader overrides that point outside.
    const env = {};
    for (const [k, v] of Object.entries(srv.env || {})) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !['PATH', 'LD_PRELOAD', 'NODE_OPTIONS'].includes(k)) env[k] = String(v);
    processManager.start(srv.id, execPath, srv.args || [], cwd, env, { autoRestart: srv.autoRestart !== false });
    await serverStore.updateStatus(srv.id, 'running');
}

app.post('/api/server/stop', async (req, res) => {
    const { id } = req.body || {};
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });

    try {
        processManager.stop(id);
        await serverStore.updateStatus(id, 'stopped');
        audit(req, 'stop', serverStore.get(id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Activity log: admins see everything; users only their servers (filtered client-side by server id).
app.get('/api/activity', requireAdmin, (req, res) => {
    const serverId = typeof req.query.server === 'string' ? req.query.server : undefined;
    res.json(auditLog.list({ serverId, limit: Math.min(Number(req.query.limit) || 200, 1000) }));
});

app.post('/api/server/:id/update', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (srv.status === 'installing') return res.status(409).json({ error: 'Still installing' });

    try {
        // Stop server if running
        const status = processManager.getStatus(id);
        if (status === 'running') {
            console.log(`Stopping server ${srv.name} for update...`);
            processManager.stop(id);
            await serverStore.updateStatus(id, 'stopped');
            // Wait a bit for process to fully release files
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`Starting update for ${srv.name} (${srv.appId})...`);

        // Run SteamCMD update (install)
        // We use the install method which runs app_update
        steamcmd.install(srv.appId, srv.path, (log) => {
            toServer(id).emit(`update-log-${id}`, log);
        }).then(async () => {
            // Update also finishes an install that failed or was interrupted.
            if (serverStore.get(id)?.status === 'failed') await serverStore.update(id, { status: 'stopped', installError: undefined });
            toServer(id).emit(`update-complete-${id}`, { success: true });
        }).catch((err) => {
            console.error('Update failed:', err);
            toServer(id).emit(`update-complete-${id}`, { success: false, error: err.message });
        });

        res.json({ success: true, message: 'Update started' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/server/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });

    try {
        audit(req, 'delete', serverStore.get(id));
        processManager.stop(id);
        await serverStore.remove(id);
        schedulerService.removeForServer(id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/server/:id/status', (req, res) => {
    const { id } = req.params;
    const status = processManager.getStatus(id);
    res.json({ status });
});

app.get('/api/server/:id/logs', (req, res) => {
    const { id } = req.params;
    const logs = processManager.getLogs(id);
    res.send(logs);
});

app.post('/api/restart-backend', requireAdmin, (req, res) => {
    res.json({ success: true, message: 'Backend restarting...' });
    setTimeout(() => {
        console.log('Backend restart requested via API');
        process.exit(0);
    }, 500);
});

// File management routes
app.get('/api/server/:id/files', async (req, res) => {
    const { id } = req.params;
    const { path: relativePath = '' } = req.query;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        const fullPath = safeJoin(srv.path, relativePath);

        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            const items = await fs.readdir(fullPath, { withFileTypes: true });
            const files = await Promise.all(items.map(async (item) => {
                const itemPath = path.join(fullPath, item.name);
                try {
                    const itemStats = await fs.stat(itemPath);
                    return {
                        name: item.name,
                        isDirectory: item.isDirectory(),
                        size: itemStats.size,
                        modified: itemStats.mtime
                    };
                } catch (e) {
                    return null;
                }
            }));
            res.json({ path: relativePath, files: files.filter(f => f) });
        } else {
            if (stats.size > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'File too large to edit (max 5MB)' });
            }
            const content = await fs.readFile(fullPath, 'utf8');
            res.json({ content, size: stats.size });
        }
    } catch (err) {
        res.status(err.status || (err.code === 'ENOENT' ? 404 : 500)).json({ error: err.code === 'ENOENT' ? 'Not found' : err.message });
    }
});

app.post('/api/server/:id/file', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { path: relativePath, content } = req.body || {};
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (!relativePath) return res.status(400).json({ error: 'Path required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content required' });

    try {
        const fullPath = safeJoin(srv.path, relativePath);
        if (fullPath === path.resolve(srv.path)) return res.status(400).json({ error: 'Pick a file' });

        if (await fs.pathExists(fullPath)) {
            await fs.copy(fullPath, `${fullPath}.bak`);
        }

        await fs.writeFile(fullPath, content, 'utf8');
        audit(req, 'file-save', srv, path.relative(srv.path, fullPath));
        res.json({ success: true, message: 'File saved (backup created)' });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.put('/api/server/:id/config', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { executable, args } = req.body || {};
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (executable !== undefined && (typeof executable !== 'string' || !executable || !isInside(srv.path, path.resolve(srv.path, executable)))) {
        return res.status(400).json({ error: 'Executable must be a file inside the server folder' });
    }
    if (args !== undefined && !(Array.isArray(args) && args.every(a => typeof a === 'string'))) {
        return res.status(400).json({ error: 'Arguments must be a list of text values' });
    }

    try {
        await serverStore.updateServerConfig(id, { executable, args });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/schedule', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { schedule } = req.body || {}; // cron expression or null
    if (schedule && (typeof schedule !== 'string' || !cron.validate(schedule))) return res.status(400).json({ error: 'That schedule is not a valid cron expression' });

    try {
        const srv = serverStore.get(id);
        if (!srv) return res.status(404).json({ error: 'Server not found' });

        if (schedule) {
            schedulerService.scheduleRestart(id, schedule);
        } else {
            schedulerService.cancelSchedule(id);
        }

        srv.restartSchedule = schedule;
        await serverStore.save();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RCON: send one console command to a running Source-style server.
async function sendRcon(srv, command) {
    if (processManager.getStatus(srv.id) !== 'running') throw Object.assign(new Error('Server is not running'), { status: 400 });
    const Rcon = require('rcon-srcds').default;
    let port = Number(srv.vars?.rconport || srv.vars?.port || srv.port) || 27015;
    const portIndex = (srv.args || []).indexOf('+port');
    if (portIndex !== -1 && srv.args[portIndex + 1]) port = parseInt(srv.args[portIndex + 1], 10);
    const rcon = new Rcon({ host: '127.0.0.1', port, timeout: 5000 });
    try {
        await rcon.authenticate(srv.rconPassword || '');
        return await rcon.execute(command);
    } finally {
        try { rcon.disconnect(); } catch { /* already closed */ }
    }
}

app.post('/api/server/:id/command', async (req, res) => {
    const srv = serverStore.get(req.params.id);
    const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (!command || command.length > 500 || /[\r\n]/.test(command)) return res.status(400).json({ error: 'Enter one command' });
    try {
        const response = await sendRcon(srv, command);
        audit(req, 'command', srv, command.slice(0, 80));
        res.json({ success: true, response: response || 'Command executed (no response)' });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'RCON command failed' });
    }
});

// Scheduled tasks (services/schedulerService.js). Anyone signed in can see a server's tasks; only admins change them.
app.get('/api/server/:id/tasks', (req, res) => {
    if (!serverStore.get(req.params.id)) return res.status(404).json({ error: 'Server not found' });
    res.json({ types: schedulerService.TYPES, tasks: schedulerService.list(req.params.id) });
});

app.post('/api/server/:id/tasks', requireAdmin, (req, res) => {
    const srv = serverStore.get(req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { task, error } = schedulerService.validate(req.body, srv.id);
    if (error) return res.status(400).json({ error });
    try {
        const added = schedulerService.add(task);
        audit(req, 'task-add', srv, `${task.type} ${task.cron}`);
        res.json(added);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.put('/api/tasks/:taskId', requireAdmin, (req, res) => {
    const current = schedulerService.tasks.find(t => t.id === req.params.taskId);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    const { task, error } = schedulerService.validate({ ...current, ...req.body }, current.serverId);
    if (error) return res.status(400).json({ error });
    res.json(schedulerService.update(current.id, task));
});

app.delete('/api/tasks/:taskId', requireAdmin, (req, res) => {
    const current = schedulerService.tasks.find(t => t.id === req.params.taskId);
    if (!current || !schedulerService.remove(current.id)) return res.status(404).json({ error: 'Task not found' });
    audit(req, 'task-delete', serverStore.get(current.serverId), current.type);
    res.json({ success: true });
});

app.post('/api/tasks/:taskId/run', requireAdmin, async (req, res) => {
    const current = schedulerService.tasks.find(t => t.id === req.params.taskId);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    audit(req, 'task-run', serverStore.get(current.serverId), current.type);
    res.json(await schedulerService.run(current.id));
});

const pause = ms => new Promise(r => setTimeout(r, ms));

// What each task type does. Throws on failure so the task's "last run" shows the reason.
async function runTask(task) {
    const srv = serverStore.get(task.serverId);
    if (!srv) throw new Error('Server no longer exists');
    const running = processManager.getStatus(srv.id) === 'running';
    const log = line => toServer(srv.id).emit(`server-log-${srv.id}`, `\r\n\x1b[36m● ${line}\x1b[0m\r\n`);
    auditLog.add({ user: 'scheduler', action: `task-${task.type}`, serverId: srv.id, server: srv.name, detail: task.label || task.cron });
    switch (task.type) {
        case 'start':
            if (running) return 'Already running';
            await startServer(srv); return 'Started';
        case 'stop':
            if (!running) return 'Already stopped';
            processManager.stop(srv.id); await serverStore.updateStatus(srv.id, 'stopped'); return 'Stopped';
        case 'restart':
            log('Scheduled restart');
            if (running) { processManager.stop(srv.id); await serverStore.updateStatus(srv.id, 'stopped'); await pause(5000); }
            await startServer(srv); return 'Restarted';
        case 'update':
            log('Scheduled update');
            if (running) { processManager.stop(srv.id); await serverStore.updateStatus(srv.id, 'stopped'); await pause(5000); }
            await steamcmd.install(srv.appId, srv.path, line => toServer(srv.id).emit(`update-log-${srv.id}`, line));
            if (running) await startServer(srv);
            return running ? 'Updated and restarted' : 'Updated';
        case 'backup': {
            const b = await backupService.createBackup(srv);
            await backupService.prune?.(srv.id, Number(process.env.BACKUP_KEEP) || 10);
            return `Backup ${b.filename}`;
        }
        case 'command': {
            const out = await sendRcon(srv, task.command);
            return String(out || 'Sent').slice(0, 200);
        }
        default:
            throw new Error('Unknown task');
    }
}

// Template Routes
app.get('/api/templates', (req, res) => {
    const games = templateStore.getAllGames();
    res.json(games);
});

app.get('/api/templates/:gameId', (req, res) => {
    const { gameId } = req.params;
    const templates = templateStore.getTemplates(gameId);
    res.json(templates);
});

app.post('/api/templates/:gameId/:templateName', requireAdmin, async (req, res) => {
    const { gameId, templateName } = req.params;
    const config = req.body;

    try {
        const template = await templateStore.saveTemplate(gameId, templateName, config);
        res.json({ success: true, template });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/templates/:gameId/:templateName', requireAdmin, async (req, res) => {
    const { gameId, templateName } = req.params;

    try {
        const deleted = await templateStore.deleteTemplate(gameId, templateName);
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Template not found' });
        }
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Backup Routes

app.get('/api/server/:id/backups', async (req, res) => {
    const { id } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });
    try {
        const backups = await backupService.listBackups(id);
        res.json(backups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/backups', async (req, res) => {
    const { id } = req.params;
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        const backup = await backupService.createBackup(srv);
        audit(req, 'backup', srv, backup.filename);
        res.json({ success: true, backup });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/backups/restore', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { filename } = req.body || {};
    if (!isBackupName(filename)) return res.status(400).json({ error: 'Unknown backup' });
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Stop server first if running
        if (processManager.getStatus(id) === 'running') {
            processManager.stop(id);
            await serverStore.updateStatus(id, 'stopped');
        }

        await backupService.restoreBackup(srv, filename);
        audit(req, 'restore', srv, filename);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/server/:id/backups/:filename', requireAdmin, async (req, res) => {
    const { id, filename } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });
    if (!isBackupName(filename)) return res.status(400).json({ error: 'Unknown backup' });
    try {
        await backupService.deleteBackup(id, filename);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Plugin Routes
app.get('/api/server/:id/plugins', async (req, res) => {
    try {
        const plugins = await pluginService.getAvailablePlugins(req.params.id);
        res.json(plugins);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/plugins/install', requireAdmin, async (req, res) => {
    try {
        const result = await pluginService.installPlugin(req.params.id, req.body.pluginId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Workshop Search Route
app.get('/api/server/:id/workshop/search', async (req, res) => {
    const { id } = req.params;
    const { q, page } = req.query;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Use server key or global key
        let apiKey = srv.steamApiKey;
        if (!apiKey) {
            const settings = await settingsStore.getSettings();
            apiKey = settings.steamApiKey;
        }

        if (!apiKey) {
            return res.status(400).json({ error: 'Steam Web API Key not configured (Server or Global)' });
        }

        // Use Garry's Mod App ID (4000) for workshop search, regardless of server game
        // Or use srv.appId if we want to support other games later
        const appId = 4000;

        const results = await pluginService.searchWorkshop(apiKey, appId, q, page);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/workshop', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { collectionId } = req.body || {};
    if (collectionId && !isNumericId(collectionId)) return res.status(400).json({ error: 'Collection ID must be a number' });

    try {
        await pluginService.updateWorkshop(id, collectionId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Install a workshop addon
app.post('/api/server/:id/workshop/install', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { workshopId } = req.body || {};
    if (!isNumericId(workshopId)) return res.status(400).json({ error: 'Workshop ID must be a number' });

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const steamcmd = require('./services/steamcmd');
        // Always use app ID 4000 for Garry's Mod workshop downloads
        // (server.appId might be 4020 for the dedicated server, but workshop uses 4000)
        const workshopAppId = 4000;

        await steamcmd.downloadWorkshopAddon(workshopId, server.path, workshopAppId);
        res.json({ success: true, message: 'Addon installed successfully' });
    } catch (err) {
        console.error('Workshop install error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get list of installed workshop addons
app.get('/api/server/:id/workshop/installed', async (req, res) => {
    const { id } = req.params;

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const addonsPath = path.join(server.path, 'garrysmod', 'addons');

        if (!await fs.pathExists(addonsPath)) {
            return res.json({ addons: [] });
        }

        const entries = await fs.readdir(addonsPath, { withFileTypes: true });
        const addons = [];

        // Get API key from settings
        const settings = await settingsStore.getSettings();
        const apiKey = settings.steamApiKey;

        for (const entry of entries) {
            if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
                // This is a workshop addon (numeric folder name)
                const addonPath = path.join(addonsPath, entry.name);
                const stats = await fs.stat(addonPath);

                // Count files in addon
                let fileCount = 0;
                const countFiles = async (dir) => {
                    const items = await fs.readdir(dir, { withFileTypes: true });
                    for (const item of items) {
                        if (item.isFile()) fileCount++;
                        else if (item.isDirectory()) {
                            await countFiles(path.join(dir, item.name));
                        }
                    }
                };
                await countFiles(addonPath);

                // Fetch addon details from Steam API if we have an API key
                let title = entry.name;
                let thumbnail = null;

                if (apiKey) {
                    try {
                        const formData = new URLSearchParams();
                        formData.append('key', apiKey);
                        formData.append('itemcount', '1');
                        formData.append('publishedfileids[0]', entry.name);

                        console.log(`Fetching Steam data for addon ${entry.name}`);

                        const steamRes = await axios.post(
                            'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
                            formData.toString(),
                            {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                }
                            }
                        );

                        console.log(`Steam API response for ${entry.name}:`, JSON.stringify(steamRes.data, null, 2));

                        const details = steamRes.data?.response?.publishedfiledetails?.[0];
                        if (details && details.result === 1) {
                            title = details.title || entry.name;
                            thumbnail = details.preview_url || null;
                            console.log(`✓ Found title: ${title}`);
                        } else {
                            console.warn(`✗ No valid data for addon ${entry.name}, result: ${details?.result}`);
                        }
                    } catch (err) {
                        console.warn(`Failed to fetch Steam data for addon ${entry.name}:`, err.message);
                    }
                } else {
                    console.warn('No Steam API key configured - addon names will show as IDs');
                }

                addons.push({
                    id: entry.name,
                    name: title,
                    thumbnail,
                    path: addonPath,
                    installedDate: stats.mtime,
                    fileCount
                });
            }
        }

        res.json({ addons });
    } catch (err) {
        console.error('Error listing installed addons:', err);
        res.status(500).json({ error: err.message });
    }
});

// Uninstall a workshop addon
app.delete('/api/server/:id/workshop/installed/:addonId', requireAdmin, async (req, res) => {
    const { id, addonId } = req.params;
    if (!isNumericId(addonId)) return res.status(400).json({ error: 'Unknown addon' });

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const addonPath = path.join(server.path, 'garrysmod', 'addons', addonId);

        if (!await fs.pathExists(addonPath)) {
            return res.status(404).json({ error: 'Addon not found' });
        }

        await fs.remove(addonPath);
        res.json({ success: true, message: 'Addon uninstalled successfully' });
    } catch (err) {
        console.error('Error uninstalling addon:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Cache Management API Endpoints
// ============================================

// List all cached games
app.get('/api/cache/list', requireAdmin, async (req, res) => {
    try {
        const cached = await cacheService.listCached();
        res.json({ cached });
    } catch (err) {
        console.error('Error listing cache:', err);
        res.status(500).json({ error: err.message });
    }
});

// Download game to cache
app.post('/api/cache/download/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });
    const { gameName } = req.body || {};

    try {
        // Start download in background
        const result = await cacheService.startDownload(appId, gameName, (log) => {
            io.to('admins').emit(`cache-download-${appId}`, log);
        });
        res.status(202).json(result);
    } catch (err) {
        console.error('Error downloading to cache:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.post('/api/cache/:appId/cancel', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });
    try { res.json(await cacheService.cancelDownload(appId)); }
    catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Check if game is cached
app.get('/api/cache/status/:appId', async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const status = await cacheService.getCacheStatus(appId);
        if (req.user.role !== 'admin') {
            const { logs, error, ...metadata } = status;
            return res.json(metadata);
        }
        res.json(status);
    } catch (err) {
        console.error('Error getting cache status:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete cached game
app.delete('/api/cache/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const result = await cacheService.deleteCache(appId);
        res.json(result);
    } catch (err) {
        console.error('Error deleting cache:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Copy from cache (used during install)
app.post('/api/cache/copy/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    const { targetPath } = req.body || {};
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const result = await cacheService.copyFromCache(appId, safeJoin(SERVERS_ROOT, targetPath));
        res.json(result);
    } catch (err) {
        console.error('Error copying from cache:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});


// Initialize services
schedulerService.init(runTask);
settingsStore.load();

// Socket.IO
// Live updates go to rooms, so a user only receives logs for servers they can see.
io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user?.role === 'admin') socket.join('admins');
    socket.on('watch', id => {
        const srv = splitRemoteId(String(id)) ? remoteServers.get(String(id), nodeRegistry, nodeTransport) : serverStore.get(String(id));
        if (srv && access.can(user, srv, 'view')) socket.join(`srv:${srv.id}`);
    });
    socket.on('unwatch', id => socket.leave(`srv:${String(id)}`));
});
const toServer = id => io.to(`srv:${id}`);

processManager.on('log', ({ id, data }) => {
    toServer(id).emit(`server-log-${id}`, data);
});

processManager.on('status-change', async ({ id, status }) => {
    querySnapshot.clear(id);
    await serverStore.updateStatus(id, status);
    toServer(id).emit(`server-status-${id}`, status);
});

// Crash recovery (processManager decides when; this restarts with the stored launch line).
processManager.on('crashed', ({ id, code, attempt, willRestart }) => {
    const srv = serverStore.get(id);
    const msg = willRestart ? `Crashed (exit ${code}). Restarting in 10 seconds (try ${attempt} of 3)...` : `Crashed ${attempt} times in 10 minutes. Not restarting; check the console.`;
    toServer(id).emit(`server-log-${id}`, `\r\n\x1b[31m● ${msg}\x1b[0m\r\n`);
    auditLog.add({ user: 'system', action: willRestart ? 'crash-restart' : 'crash-gave-up', serverId: id, server: srv?.name || null, detail: `exit ${code}` });
});
processManager.on('restart-request', async ({ id }) => {
    const srv = serverStore.get(id);
    if (!srv || processManager.getStatus(id) === 'running') return;
    try { await startServer(srv); } catch (err) { toServer(id).emit(`server-log-${id}`, `\r\n\x1b[31m● Restart failed: ${err.message}\x1b[0m\r\n`); }
});

processManager.on('stats', ({ id, stats }) => {
    toServer(id).emit(`server-stats-${id}`, stats);
});

const queryService = require('./services/queryService');
const queriesInFlight = new Set();

// Query loop
setInterval(async () => {
    const servers = serverStore.getAll();
    for (const srv of servers) {
        if (processManager.getStatus(srv.id) === 'running' && !queriesInFlight.has(srv.id)) {
            const entry = processManager.processes.get(srv.id);
            queriesInFlight.add(srv.id);
            try {
                const result = await queryService.query(srv);
                // Ignore responses from a process stopped/replaced during the query.
                if (!serverStore.get(srv.id) || processManager.processes.get(srv.id) !== entry || processManager.getStatus(srv.id) !== 'running') continue;
                querySnapshot.record(srv.id, result);
                if (result?.online) toServer(srv.id).emit(`server-query-${srv.id}`, result);
            } finally { queriesInFlight.delete(srv.id); }
        }
    }
}, 5000);

// Handle SPA routing - return index.html for any unknown route
// Using regex /.*/ to avoid Express 5/path-to-regexp error with '*'
// This must be AFTER API routes so it doesn't intercept them
if (fs.existsSync(frontendPath)) {
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(frontendPath, 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || undefined;   // e.g. 127.0.0.1 or a LAN address; default = all interfaces
server.listen(PORT, HOST, () => {
    console.log(`🚀 ServerForge running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Access at: ${process.env.APP_URL || `http://localhost:${PORT}`}`);
});


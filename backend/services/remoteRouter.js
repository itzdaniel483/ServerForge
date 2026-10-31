const access = require('./access');
const { READ_ACTIONS } = require('./nodeTransport');
const { auditContext } = require('./auditContext');
const { splitRemoteId } = require('./remoteServers');
const nullHost = () => ({ cpuPercent: null, memory: { used: null, total: null }, disk: { used: null, total: null } });
const GROUPS = {
    status: ['server.status'], 'console.read': ['console.read'], power: ['power.start', 'power.stop'],
    'console.command': ['console.command'], 'files.read': ['files.read'], 'files.write': ['files.write'],
    backups: ['backups.list'], tasks: ['tasks.list'], settings: ['settings.read'], update: ['update'], delete: ['delete'],
};
const USER_PERM = { 'server.status': 'view', 'console.read': 'view', 'console.command': 'console', 'power.start': 'power', 'power.stop': 'power',
    'files.read': 'files', 'backups.list': 'backups', 'backups.create': 'backups', 'tasks.list': 'view', 'settings.read': 'view' };
function uiActions(capabilities) { return Object.entries(GROUPS).filter(([, required]) => required.every(a => capabilities.includes(a))).map(([group]) => group); }

function createRemoteRouter({ registry, getTransport, store, userStore, onAccessChanged = () => {}, audit = () => {} }) {
    return async (req, res, next) => {
        try {
            const url = new URL(req.originalUrl, 'http://local');
            const pathname = decodeURIComponent(url.pathname);
            const queryNode = req.query.node, bodyNode = req.body?.nodeId;
            if ([queryNode, bodyNode].some(v => v !== undefined && typeof v !== 'string') || (queryNode !== undefined && bodyNode !== undefined && queryNode !== bodyNode)) {
                return res.status(400).json({ error: 'Conflicting or invalid node selection', code: 'NODE_REQUEST_INVALID' });
            }
            let selected = queryNode ?? bodyNode;
            let nativePath = pathname;
            let body = { ...(req.body || {}) };
            let remoteId;
            const routeServer = pathname.match(/^\/api\/server\/([^/]+)(\/.*)?$/);
            const bodyServer = ['start', 'stop'].includes(routeServer?.[1]) && req.method === 'POST' ? splitRemoteId(body.id) : null;
            const pathServer = routeServer && splitRemoteId(routeServer[1]);
            const parsed = bodyServer || pathServer;
            const nodeTask = pathname.match(/^\/api\/nodes\/([^/]+)\/tasks\/(.+)$/);
            const taskPath = pathname.match(/^\/api\/tasks\/([^/]+)(\/run)?$/);
            const compositeTask = taskPath && splitRemoteId(taskPath[1]);
            if (parsed) {
                if (selected !== undefined && selected !== parsed.nodeId) return res.status(400).json({ error: 'Conflicting node selection', code: 'NODE_REQUEST_INVALID' });
                selected = parsed.nodeId;
                remoteId = `${parsed.nodeId}:${parsed.serverId}`;
                if (bodyServer) body.id = parsed.serverId;
                else nativePath = `/api/server/${parsed.serverId}${routeServer[2] || ''}`;
            } else if (compositeTask) {
                if (selected !== undefined && selected !== compositeTask.nodeId) return res.status(400).json({ error: 'Conflicting node selection', code: 'NODE_REQUEST_INVALID' });
                selected = compositeTask.nodeId; nativePath = `/api/tasks/${compositeTask.serverId}${taskPath[2] || ''}`;
            } else if (nodeTask) {
                if (selected !== undefined && selected !== nodeTask[1]) return res.status(400).json({ error: 'Conflicting node selection', code: 'NODE_REQUEST_INVALID' });
                selected = nodeTask[1]; nativePath = `/api/tasks/${nodeTask[2]}`;
            }
            if (selected === undefined || selected === 'local') return next();
            const node = registry.list().find(n => n.id === selected);
            if (!node) return res.status(404).json({ error: 'Unknown node', code: 'NODE_UNKNOWN' });
            const transport = getTransport();
            const srv = remoteId && store.get(remoteId, registry, transport);
            if (remoteId && !srv) return res.status(404).json({ error: 'Server not found' });
            if (remoteId && pathname.endsWith('/access') && req.method === 'PUT') {
                if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
                const users = (await userStore.getUsers()).filter(u => u.role !== 'admin').map(u => u.username);
                const list = access.cleanAccess(body.access, users);
                if (!list) return res.status(400).json({ error: 'Pick existing users and valid permissions' });
                store.setAccess(remoteId, list); onAccessChanged(remoteId, { ...srv, access: list });
                audit(req, 'remote-access', srv, 'Permissions updated');
                return res.json({ success: true, access: list });
            }
            const { classifyRemoteRequest } = require('./nodeActions');
            const mapped = classifyRemoteRequest(req.method, nativePath, body, req.query);
            if (!mapped) return res.status(501).json({ error: 'This remote action is unsupported', code: 'ACTION_UNSUPPORTED' });
            if (mapped.action === 'servers.list') {
                const visible = store.list(registry, transport).filter(server => server.nodeId === selected && access.can(req.user, server, 'view'));
                return res.json(visible.map(({ access: grants, ...server }) => ({ ...server,
                    perms: access.permsFor(req.user, { ...server, access: grants }), actions: uiActions(transport?.getCapabilities(selected) || []) })));
            }
            if (req.user.role !== 'admin') {
                const permission = USER_PERM[mapped.action];
                const hostAllowed = mapped.action === 'host' && store.list(registry, transport).some(s => s.nodeId === selected && access.can(req.user, s, 'view'));
                if (!hostAllowed && (!srv || !permission || !access.can(req.user, srv, permission))) return res.status(403).json({ error: "You don't have access to that" });
            }
            if (!transport?.listStatus()[selected]?.online) {
                if (mapped.action === 'host') return res.json(nullHost());
                return res.status(503).json({ error: 'Node is offline', code: 'NODE_OFFLINE' });
            }
            const { ip, userAgent } = auditContext(req);
            const result = await transport.request(selected, mapped.action, mapped.params, { id: req.user.id || req.user.username, username: req.user.username, role: req.user.role, ip, userAgent },
                { timeoutMs: ['install', 'update', 'backups.restore', 'cache.copy'].includes(mapped.action) ? 1800000 : 30000 });
            let response = result.body;
            if (mapped.action === 'catalog' && response && typeof response === 'object') response = { ...response, nodeId: selected };
            if (mapped.action === 'tasks.list' && Array.isArray(response?.tasks)) response = { ...response, tasks: response.tasks.map(task => ({ ...task, id: `${selected}:${task.id}`, serverId: `${selected}:${task.serverId}` })) };
            if (['tasks.create', 'tasks.update'].includes(mapped.action) && response?.id) response = { ...response, id: `${selected}:${response.id}`, serverId: `${selected}:${response.serverId}` };
            if (response?.server?.id) {
                if (mapped.action === 'install' && result.status >= 200 && result.status < 300) store.upsert(selected, response.server);
                response = { ...response, server: { ...response.server, id: `${selected}:${response.server.id}`, nodeId: selected } };
            }
            if (mapped.action === 'delete' && remoteId && result.status >= 200 && result.status < 300) store.removeServer(remoteId);
            if (req.user.role !== 'admin' && mapped.action === 'settings.read' && response && typeof response === 'object') {
                response = { ...response, vars: Object.fromEntries(Object.entries(response.vars || {}).filter(([key]) => !/password|secret|token|key/i.test(key))) };
            }
            // Only changes go in the activity log; page views (status, console, settings reads…) were 80% of it (Daniel 3730).
            if (!READ_ACTIONS.has(mapped.action)) audit(req, `remote-${mapped.action}`, srv || { id: null, name: node.name }, `${node.id}:${result.status}`);
            return res.status(result.status).json(response);
        } catch (err) { return res.status(err.status || 500).json({ error: err.message, code: err.code || 'REMOTE_ERROR' }); }
    };
}
module.exports = { createRemoteRouter, uiActions, nullHost };

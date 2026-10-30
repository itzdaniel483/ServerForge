// The node link accepts named actions, never a URL, HTTP method, shell or auth setting.
const problem = message => Object.assign(new Error(message), { status: 400, code: 'NODE_REQUEST_INVALID' });
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function nativeId(value, name = 'id') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || forbidden.has(value)) throw problem(`Invalid native ${name}`);
    return value;
}
const identifier = (value, name) => {
    if (name === 'appId') { if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) throw problem('Invalid app ID'); return value; }
    if (name === 'filename') { if (typeof value !== 'string' || !/^backup_[\w-]+\.zip$/.test(value)) throw problem('Invalid backup filename'); return value; }
    if (name === 'templateName') { if (typeof value !== 'string' || !/^[\w .-]{1,80}$/.test(value) || value.includes('..') || forbidden.has(value)) throw problem('Invalid template name'); return value; }
    return nativeId(value, name);
};
const definitions = {
    'servers.list': ['GET', '/api/servers'], host: ['GET', '/api/host'], catalog: ['GET', '/api/games'],
    'server.status': ['GET', '/api/server/:serverId/status'], 'console.read': ['GET', '/api/server/:serverId/logs'],
    'power.start': ['POST', '/api/server/start', ['id']], 'power.stop': ['POST', '/api/server/stop', ['id']],
    'console.command': ['POST', '/api/server/:serverId/command', ['command']],
    'files.read': ['GET', '/api/server/:serverId/files', [], ['path']], 'files.write': ['POST', '/api/server/:serverId/file', ['path', 'content']],
    'backups.list': ['GET', '/api/server/:serverId/backups'], 'backups.create': ['POST', '/api/server/:serverId/backups'],
    'backups.restore': ['POST', '/api/server/:serverId/backups/restore', ['filename']], 'backups.delete': ['DELETE', '/api/server/:serverId/backups/:filename'],
    'tasks.list': ['GET', '/api/server/:serverId/tasks'], 'tasks.create': ['POST', '/api/server/:serverId/tasks', ['type', 'cron', 'command', 'label', 'enabled']],
    'tasks.update': ['PUT', '/api/tasks/:taskId', ['type', 'cron', 'command', 'label', 'enabled']], 'tasks.delete': ['DELETE', '/api/tasks/:taskId'], 'tasks.run': ['POST', '/api/tasks/:taskId/run'],
    'settings.read': ['GET', '/api/server/:serverId/settings'], 'settings.write': ['PUT', '/api/server/:serverId/settings', ['vars', 'autoRestart']],
    'config.write': ['PUT', '/api/server/:serverId/config', ['executable', 'args']], 'schedule.write': ['POST', '/api/server/:serverId/schedule', ['schedule']],
    update: ['POST', '/api/server/:serverId/update'], delete: ['DELETE', '/api/server/:serverId'],
    install: ['POST', '/api/install', ['gameId', 'appId', 'vars', 'useCache', 'hostname', 'port']],
    'cache.list': ['GET', '/api/cache/list'], 'cache.status': ['GET', '/api/cache/status/:appId'], 'cache.download': ['POST', '/api/cache/download/:appId', ['gameName']],
    'cache.cancel': ['POST', '/api/cache/:appId/cancel'], 'cache.delete': ['DELETE', '/api/cache/:appId'], 'cache.copy': ['POST', '/api/cache/copy/:appId', ['targetPath']],
    'templates.list': ['GET', '/api/templates'], 'templates.read': ['GET', '/api/templates/:gameId'],
    'templates.write': ['POST', '/api/templates/:gameId/:templateName', ['name', 'executable', 'args', 'port', 'maxPlayers', 'defaultMap']], 'templates.delete': ['DELETE', '/api/templates/:gameId/:templateName'],
};
const ACTIONS = Object.freeze(Object.keys(definitions));
const pick = (params, fields = []) => Object.fromEntries(fields.filter(field => Object.hasOwn(params, field)).map(field => [field, params[field]]));
function getLocalRequest(action, params = {}) {
    if (!Object.hasOwn(definitions, action)) throw Object.assign(problem('Action is not supported'), { status: 501, code: 'ACTION_UNSUPPORTED' });
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw problem('Invalid action parameters');
    const [method, pattern, fields, queryFields] = definitions[action];
    const localPath = pattern.replace(/:([A-Za-z]+)/g, (_, field) => encodeURIComponent(identifier(params[field], field)));
    const body = pick(params, fields);
    if (action === 'power.start' || action === 'power.stop') body.id = nativeId(params.serverId, 'serverId');
    if (action === 'install') {
        if (params.gameId !== undefined) nativeId(params.gameId, 'gameId');
        if (params.appId !== undefined) identifier(params.appId, 'appId');
    }
    return { method, path: localPath, ...(method !== 'GET' && Object.keys(body).length ? { body } : {}), ...(queryFields ? { query: pick(params, queryFields) } : {}) };
}
function classifyRemoteRequest(method, routePath, body = {}, query = {}) {
    if (typeof routePath !== 'string' || routePath.includes('?') || routePath.includes('#')) return null;
    for (const [action, [verb, pattern, fields, queryFields]] of Object.entries(definitions)) {
        if (verb !== method.toUpperCase()) continue;
        const names = [];
        const expression = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z]+)/g, (_, name) => { names.push(name); return '([^/]+)'; });
        const match = new RegExp(`^${expression}$`).exec(routePath);
        if (!match) continue;
        const params = { ...pick(body, fields), ...pick(query, queryFields) };
        names.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]); });
        if (action === 'power.start' || action === 'power.stop') { params.serverId = body.id; delete params.id; }
        getLocalRequest(action, params); // Enforce the same native-id boundary in both directions.
        return { action, params };
    }
    return null;
}
module.exports = { ACTIONS, getLocalRequest, classifyRemoteRequest, nativeId };

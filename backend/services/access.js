// Per-server access for non-admin users (claude, 2026-10-30), TCAdmin-style.
// A server's owner gets every user permission; others are listed in server.access with chosen permissions.
// Admins can do everything. Anything not listed below is admin-only.
const PERMS = ['view', 'power', 'console', 'files', 'backups'];

function permsFor(user, srv) {
    if (!user || !srv) return [];
    if (user.role === 'admin') return [...PERMS];
    if (srv.owner === user.username) return [...PERMS];
    const entry = (srv.access || []).find(a => a.username === user.username);
    if (!entry) return [];
    return ['view', ...entry.perms.filter(p => PERMS.includes(p) && p !== 'view')];
}

const can = (user, srv, perm) => permsFor(user, srv).includes(perm);

// What a non-admin needs for each server route. Missing = admin only.
function needed(method, sub) {
    const key = `${method} ${sub}`;
    return ({
        'GET status': 'view', 'GET logs': 'view', 'GET settings': 'view', 'GET tasks': 'view', 'GET': 'view',
        'POST command': 'console',
        'GET files': 'files',
        'GET backups': 'backups', 'POST backups': 'backups',
    })[key] || null;
}

function cleanAccess(list, knownUsers) {
    if (!Array.isArray(list) || list.length > 50) return null;
    const out = [];
    for (const a of list) {
        if (!a || typeof a.username !== 'string' || !knownUsers.includes(a.username)) return null;
        if (!Array.isArray(a.perms) || !a.perms.every(p => PERMS.includes(p))) return null;
        if (out.some(o => o.username === a.username)) continue;
        out.push({ username: a.username, perms: [...new Set(['view', ...a.perms])] });
    }
    return out;
}

module.exports = { PERMS, permsFor, can, needed, cleanAccess };

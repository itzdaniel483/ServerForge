// Request guards shared by the API routes (claude, 2026-10-30 security pass).
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

// True only when `target` is `base` itself or sits inside it. startsWith() alone lets
// /srv/game match /srv/game2, so compare with path.relative instead.
function isInside(base, target) {
    const rel = path.relative(path.resolve(base), path.resolve(target));
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolve a user-supplied relative path under base, or throw a 403-tagged error.
function safeJoin(base, relative = '') {
    const full = path.resolve(base, String(relative));
    if (!isInside(base, full)) {
        const err = new Error('Access denied');
        err.status = 403;
        throw err;
    }
    return full;
}

const isNumericId = v => /^\d{1,12}$/.test(String(v ?? ''));
const isBackupName = v => /^backup_[\w-]+\.zip$/.test(String(v ?? ''));

// Where game servers may be installed. Every install/cache target must live under this folder.
const SERVERS_ROOT = path.resolve(process.env.SERVERS_ROOT || path.join(__dirname, '..', '..', 'servers'));

// Admin-only routes: anything that can run programs, change auth, or touch the host.
function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Admins only' });
}

// Login throttle: 10 failed tries per address per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;
function loginBlocked(ip) {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.first > WINDOW_MS) { failures.delete(ip); return false; }
    return f.count >= MAX_FAILS;
}
function loginFailed(ip) {
    const f = failures.get(ip);
    if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
    else f.count++;
    if (failures.size > 5000) failures.clear();
}
const loginSucceeded = ip => failures.delete(ip);

// JWT secret: env var, else a random one saved next to the data (never the old hard-coded default).
function loadJwtSecret() {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) return process.env.JWT_SECRET;
    const file = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'jwt-secret');
    try {
        const saved = fs.readFileSync(file, 'utf8').trim();
        if (saved.length >= 32) return saved;
    } catch { /* first run */ }
    const secret = crypto.randomBytes(48).toString('base64url');
    fs.ensureDirSync(path.dirname(file));
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
}

module.exports = { isInside, safeJoin, isNumericId, isBackupName, SERVERS_ROOT, requireAdmin, loginBlocked, loginFailed, loginSucceeded, loadJwtSecret };

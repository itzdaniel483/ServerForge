// Long HTTP calls (claude, 2026-10-30). Node's fetch (undici) gives up when response headers take longer than
// 300 s, whatever AbortSignal says. Install/update routes only answer when SteamCMD finishes (a Gmod download takes
// much longer), so a move to a node failed with "outcome unknown" (Daniel #gamemanager 3604). This uses node:http,
// which has no such limit; the caller's own timeout still applies.
const http = require('http');
const https = require('https');

function longRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 30 * 60_000, maxBytes = Infinity } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); reject(new Error('Redirects are not followed')); return; }
            const chunks = []; let length = 0;
            let over = false;
            res.on('data', c => {
                if (over) return;
                length += c.length;
                if (length > maxBytes) { over = true; reject(Object.assign(new Error('Response too large'), { code: 'PAYLOAD_TOO_LARGE' })); res.destroy(); req.destroy(); return; }
                chunks.push(c);
            });
            res.on('end', () => { if (!over) resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }); });
            res.on('error', err => { if (!over) reject(err); });
        });
        const timer = setTimeout(() => { reject(new Error('Timed out')); req.destroy(); }, timeoutMs);
        timer.unref?.();
        req.on('error', err => { clearTimeout(timer); reject(err); });   // reject is a no-op once settled
        req.on('close', () => clearTimeout(timer));
        if (body !== undefined) req.write(body);
        req.end();
    });
}

module.exports = { longRequest };

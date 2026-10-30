// Long local calls (claude, Daniel #gamemanager 3604): node:http helper used for installs/updates instead of fetch,
// whose 300 s header timeout broke a Gmod move to a node.
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('node:http');
const { longRequest } = require('../services/longRequest');
test('waits for a slow response, refuses redirects and oversized bodies, honours its own timeout', async t => {
    const server = http.createServer((req, res) => {
        if (req.url === '/slow') setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, method: req.method })); }, 1200);
        else if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://example.com/' }); res.end(); }
        else if (req.url === '/big') { res.writeHead(200); res.end('x'.repeat(5000)); }
        else { /* never answers */ }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await longRequest(`${base}/slow`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.text), { ok: true, method: 'POST' });
    await assert.rejects(longRequest(`${base}/redirect`), /Redirects/);
    await assert.rejects(longRequest(`${base}/big`, { maxBytes: 100 }), /too large/);
    await assert.rejects(longRequest(`${base}/hang`, { timeoutMs: 300 }), /Timed out/);
});

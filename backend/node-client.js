// Node agent: connects the existing local panel to a hub; no new browser listener.
const fs = require('node:fs');
const { NodeClient } = require('./services/nodeClient');
const { createNodeRuntime } = require('./services/nodeRuntime');
const runtime = process.env.NODE_LINK_ONLY === '1' ? null : createNodeRuntime();
const client = new NodeClient({ runtime });
client.on('pending', ({ candidateId, fingerprint }) => console.log(`Approval pending: ${candidateId}\nNode key fingerprint: ${fingerprint.match(/.{1,4}/g).join(' ')}\nCompare this fingerprint on the hub, then approve.`));
client.on('online', ({ nodeId, capabilities }) => console.log(`Node connected: ${nodeId} (${capabilities.length ? 'local panel actions enabled' : 'pairing/link only'})`));
client.on('offline', () => console.log('Node link offline'));
client.on('failure', err => console.error(err.message));
const stop = () => { client.stop(); runtime?.close(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
// Installer mode (claude, 2026-10-30, Windows Setup): `pair <file> --until-approved` prints one
// parseable `FINGERPRINT xxxx xxxx ...` line, exits 0 once the admin approves, or 1 on a refusal or
// when the pairing file expires. The identity it saves is then used by the service's `node:run`.
const untilApproved = process.argv[2] === 'pair' && process.argv.includes('--until-approved');
if (untilApproved) {
    let pending = false;
    const finish = (code, text) => { if (text) (code ? console.error : console.log)(text); stop(); process.exit(code); };
    client.on('pending', ({ fingerprint }) => { if (!pending) console.log(`FINGERPRINT ${fingerprint.match(/.{1,4}/g).join(' ')}`); pending = true; });
    client.on('online', () => finish(0, 'APPROVED'));
    // Before the hub accepts the candidate any failure is final; afterwards only refusals are.
    const plain = m => (/AUTH_FAILED|ENROL/i.test(m) ? 'the pairing file was already used, cancelled or has expired. Make a new one on the panel (Nodes > Add node).'
        : /mismatch/i.test(m) ? "the panel's certificate doesn't match the pairing file. Make a new pairing file on the panel." : m);
    client.on('failure', err => { if (!pending || /expired|invalid|revoked|refused|unknown|mismatch|AUTH_FAILED/i.test(err.message)) finish(1, `PAIRING FAILED: ${plain(err.message)}`); });
    try {
        const { expiresAt } = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        const wait = Math.max(0, Number(expiresAt) - Date.now()) + 60000;
        setTimeout(() => finish(1, 'PAIRING FAILED: not approved before the pairing file expired. Make a new one on the panel (Nodes > Add node).'), wait).unref();
    } catch { /* pair() reports a bad file */ }
}
const run = process.argv[2] === 'pair'
    ? async () => {
        if (!process.argv[3]) throw new Error('Usage: node node-client.js pair /private/path/enrolment.json');
        // Fail before pairing if the runtime cannot reach the same-DATA_DIR local panel.
        if (runtime) await runtime.snapshot();
        await client.pair(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    }
    : async () => { if (runtime) await runtime.snapshot(); await client.start(); };
run().catch(err => { console.error(err.message); stop(); process.exitCode = 1; });

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
const run = process.argv[2] === 'pair'
    ? async () => {
        if (!process.argv[3]) throw new Error('Usage: node node-client.js pair /private/path/enrolment.json');
        // Fail before pairing if the runtime cannot reach the same-DATA_DIR local panel.
        if (runtime) await runtime.snapshot();
        await client.pair(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    }
    : async () => { if (runtime) await runtime.snapshot(); await client.start(); };
run().catch(err => { console.error(err.message); stop(); process.exitCode = 1; });

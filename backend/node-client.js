// Link-only node mode: no browser listener and no remote actions in Phase 1.
const fs = require('node:fs');
const { NodeClient } = require('./services/nodeClient');
const client = new NodeClient();
client.on('pending', ({ candidateId, fingerprint }) => console.log(`Approval pending: ${candidateId}\nNode key fingerprint: ${fingerprint.match(/.{1,4}/g).join(' ')}\nCompare this fingerprint on the hub, then approve.`));
client.on('online', ({ nodeId }) => console.log(`Node connected: ${nodeId} (pairing/link only)`));
client.on('offline', () => console.log('Node link offline'));
client.on('failure', err => console.error(err.message));
process.on('SIGINT', () => { client.stop(); process.exit(0); });
process.on('SIGTERM', () => { client.stop(); process.exit(0); });
const run = process.argv[2] === 'pair'
    ? async () => {
        if (!process.argv[3]) throw new Error('Usage: node node-client.js pair /private/path/enrolment.json');
        await client.pair(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    }
    : () => client.start();
run().catch(err => { console.error(err.message); client.stop(); process.exitCode = 1; });

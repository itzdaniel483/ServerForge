# Remote execution backend (Phases 2–3)

Backend owner: codex and its broker/runtime agents. Frontend, product diagrams, rollout and checklist owner: claude. Changes remain local until the deployment owner runs the combined gate. No git push is authorized.

```mermaid
sequenceDiagram
    participant U as Authenticated browser
    participant H as Hub remoteRouter
    participant A as Hub ACL database
    participant B as Authenticated node transport
    participant N as Node runtime
    participant P as Node local panel API
    U->>H: Composite server ID / selected node
    H->>A: Current per-server permission
    A-->>H: Allow or deny
    H->>B: Named action + actor + operation ID
    B->>N: Bounded authenticated RPC
    N->>N: Persist mutation intent / check duplicate
    N->>P: Fixed local endpoint + short-lived signed actor token
    P->>P: Existing path / catalogue / executable validation
    P-->>N: Result / progress events
    N-->>B: Correlated result + snapshot / stream
    B-->>H: Current-session response
    H-->>U: Composite IDs / room-scoped events
    Note over H,N: Lost contact during mutation = OUTCOME_UNKNOWN; no automatic replay
```

## Running a node

Run the existing ServerForge panel on the node first, in local authentication mode. The companion node client reuses its local API validators and process manager; it does not start a second set of game processes. Set `DATA_DIR` to that panel's actual data folder and `NODE_LOCAL_API_URL` to its local listening origin (or use its matching `HOST`/`PORT`). The adapter accepts only loopback or an IP bound to the same machine, rejects redirects and never accepts a hub-supplied URL. No node user secret or admin JWT crosses the hub link.

Set `NODE_DATA_DIR` to a private persistent folder for the paired identity. `npm run node:pair -- /private/path/bundle.json` pairs and remains online; `npm run node:run` reconnects an existing identity. Runtime mode is the default. `NODE_LINK_ONLY=1` preserves the original pairing-only rehearsal with no advertised actions. Routine deployment must keep both local panel and companion under service/server-console control; Windows service packaging and actual Windows validation remain Phase 4. No port is opened on the node for federation: its link is outbound. Game ports are separate.

The local adapter currently requires local login mode and an existing administrator. It reads current identity/version metadata for each short-lived local JWT and reconnects stream subscriptions after password rotation. The hub-generated actor is signed into that JWT and used by the node's activity log; it never changes the local admin's authorization role. Cloudflare-only node API authentication is not implemented by this adapter.

## Routes and authority

- Local server IDs, routes and event names are unchanged. Remote server and task IDs are `<node UUID>:<native ID>`. Routing resolves path IDs, start/stop body IDs, node-scoped task routes, and explicit `?node=` cache/template/host/catalogue selections before local middleware. Conflicting selections fail instead of executing locally.
- Hub-owned `remote-servers.json` holds sanitized snapshots and remote grants. Node-supplied owner/access fields never create permissions. Newly discovered servers are admin-only; grant access through the existing Access endpoint using the composite server ID. Revocation evicts existing browser rooms. Node removal deletes its cached metadata/grants and disconnects its link.
- The hub checks current grants on every action. Nonadmins can use only assigned view/power/console/files/backup permissions, matching local behavior. File writes, task mutations, configuration, update/delete, installation and cache mutations remain admin-only. User responses omit secrets and host paths; settings reads remove secret-bearing variables.
- `/api/servers` includes `nodeId`, `nodeName`, `nodeOs`, `nodeOnline`, `nodeHost`, and remote `actions[]`. Explicit remote server lists also return canonical IDs. `/api/nodes[].actions` includes `install` and `cache` only when advertised. Remote game catalogues include `nodeId` and the node's platform. Offline host metrics are null, while offline control returns `NODE_OFFLINE`.
- Named UI actions: `status`, `console.read`, `power`, `console.command`, `files.read`, `files.write`, `backups`, `tasks`, `settings`, `update`, `delete`. Wire actions are finer grained (for example `power.start`, `tasks.update`); see `nodeActions.js` and `nodeProtocol.js`. Plugins/workshop and panel-user/auth management are not federation actions.

## Events and delivery bounds

- Per-server remote events use the existing prefix plus composite ID: `server-log-<node>:<server>`, `server-status-...`, `server-stats-...`, `server-query-...`, `update-log-...`, `update-complete-...`. Only the hub derives browser room names from the authenticated node identity.
- Remote install logs are `install-log-<node>`; cache logs are `cache-download-<node>:<appId>`. These are admin-only. Local event names remain unchanged.
- Frames stay within 64KB; packets larger than 48KB use bounded chunks, up to 8MiB assembled, at most four concurrent assemblies and a 30-second expiry. Pending RPCs are bounded per node. Malformed data closes the link without uncaught decoder exceptions.
- Each mutation has an operation ID. The node persists pending intent before dispatch, records completed results, and refuses to repeat an unresolved operation after reconnect/restart. The journal is owner-only and fails closed on corruption. Hub disconnect/timeout returns `OUTCOME_UNKNOWN`, not an automatic retry. The UI must ask the operator to check the server first. Cache jobs already acknowledge immediately; install/update requests allow up to 30 minutes while streaming logs.

## Verification and limits

`nodeFederation.test.js` runs two actual panel backends with temporary data and a pinned TLS link. Fake game and SteamCMD scripts exercise discovery, host/catalogue, default-deny/granted/revoked ACLs, power, live and historical console output, file/path guards, backup/restore/delete, task run/toggle/delete, settings, update, install/delete, cache copy/delete, actor auditing and offline behavior. No large game download or production game process is involved.

`nodeRpc.test.js` covers chunk limits, pending request bounds, stale responses and mutation uncertainty. Runtime tests cover local-only targets, actor tokens, journaling and malformed messages. Windows-specific service/process/filesystem behavior and a real game's RCON commands still require real-host validation; the remote command path reuses the existing local RCON implementation.

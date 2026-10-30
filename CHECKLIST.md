# ServerForge checklist

Goal (Daniel, #gamemanager 2026-10-30): a self-hosted game-server panel as close to TCAdmin as we can get.
Owner: claude (checklist/deploy/UI); codex back 2026-10-30 on backend review. Branch: `claude/overhaul`. **Nothing is pushed without Daniel's OK.**

## Phase 0: security + UI (done 2026-10-30)
- [x] Fixed public settings takeover, hard-coded JWT secret, admin/admin, user RCE via executable path, path traversal, open sockets/CORS
- [x] Fixed crashes on missing SteamCMD, missing Workshop download, installer/file-save/template route mismatches
- [x] New full-width UI (top bar, server cards, server page, installer)
- [x] Runs on Linux (SteamCMD tarball, srcds_run, process groups)
- [x] Test deploy: `app-serverforge` on http://192.168.55.216:3220 (exact devices only), in the server console

## Phase 1: games + reliability
- [x] Game catalogue `backend/catalog/games.json`: 34 games, 28 run on Linux; per-game settings (map, players, ports, world, password)
- [x] Launch lines built server-side from validated settings (no shell, no client-chosen programs)
- [x] Crash auto-restart (3 tries in 10 min, then stops and logs it)
- [x] Live players/map query fixed (gamedig v5 import was wrong)
- [x] `lib32gcc-s1` installed so Linux SteamCMD runs
- [x] Crash-safe data files: atomic write + .bak restore (host crash 2026-10-30 left servers.json at 0 bytes)
- [x] Scheduler 5-minute gap enforced for cron ranges/lists (codex finding)
- [x] Revoking server access evicts live-log sockets (codex)
- [x] Deleting/renaming/demoting a user disconnects their live sockets (codex)
- [x] Password change ends every existing session; UI signs out with a notice (codex backend, claude UI)
- [x] Non-admin users can change their own password (new Account tab; was hidden in admin-only Settings)
- [ ] Any future password-reset path must bump sessionVersion
- [x] Install saves an 'installing' record first; interrupted/failed installs show as Install failed and Update finishes them
- [x] Real install verified end to end: Valheim installed (2.1 GB), started, listening, stopped (2026-10-30)
- [x] Valheim UDP 2456-2457 open to .109/.134/.217 only (Daniel, 2026-10-30); join details in console outbox
- [ ] Non-Steam games: Minecraft (Paper/Vanilla jar download), Terraria

## Phase 2: hosting features
- [x] Per-server access for users (start/stop, console, files, backups); users only see their servers
- [x] Live logs per server (Socket.IO rooms), not broadcast to everyone
- [x] Scheduled tasks: restart, start, stop, update, backup (keeps newest 10), console command
- [x] Activity log (who did what, when), per server and global
- [x] Settings tab with plain fields; raw launch line under Advanced
- [ ] Email/Discord notifications on crash

## Phase 3: player + server tools
- [ ] Player list with kick/ban (RCON per game)
- [ ] Config editor presets per game
- [ ] Resource limits per server (CPU/RAM via systemd scopes)
- [ ] Update checks (compare Steam build id)
- [ ] Per-server SFTP/FTP access

## Tests
- `cd backend && npm test` (security, access, tasks, catalogue, crash recovery)
- Browser walkthrough: desktop 1440, phone 390, admin and normal user

## UI v2 (2026-10-30, Daniel: "too basic and the colour scheme")
- [x] Runtime themes: Steel (default), Nebula, Aurora, Ember; picker in the top bar, remembered per browser
- [x] Frosted top bar with pill nav and live host CPU/RAM/disk (codex /api/host)
- [x] Servers dashboard: stat tiles, filter + search, game-art cards with players bar
- [x] Server page: art hero, live meters, pill tabs, themed console
- [x] Installer: game-art grid, art header on the form, SteamCMD progress bar
- [x] Login: gradient hero
- [x] Daniel picked Steel as default (2026-10-30)
- [x] Inner tools (Files, Backups, Schedule, Plugins, Updates, Settings) on the v2 kit: frosted panels, gradient buttons, pill tabs; duplicate Settings title removed

## Multi-node (2026-10-30, Daniel: "combine windows and linux servers")
Design: docs/MULTI-NODE.md (claude). Backend protocol: codex. UI: claude.
- [x] Design draft 1: hub + nodes, nodes dial out, explicit enrolment + approve, allow-listed messages
- [x] Daniel: LAN first, outside nodes later (node endpoint kept separate so it can be published alone)
- [x] codex protocol draft 2 (security review) + claude UI contract
- [ ] codex confirms the UI contract (nodeOnline, actions, error codes, fingerprint confirm, cancel code)
- [ ] Daniel names the first Windows PC (LAN IP) for the UFW rule
- [x] Phase 1 backend (codex, 47/47) + Nodes page (claude); e2e tested on a throwaway hub
- [x] Phase 1 LIVE 2026-10-30: enrol fix + enabled-listener test (codex, 48/48); node listener wss://192.168.55.216:3231 (cert in /etc/serverforge/node-tls via systemd credentials, drop-in deploy/app-serverforge.service.d/nodes.conf); UFW 3231 for .109/.134/.217 only; live pair→approve→online→remove verified with a throwaway node
- [ ] Daniel's own pairing test on the live panel
- [x] Phases 2-3 backend (codex 2e83ca2, 63/63): remote list/console/power/files/backups/tasks/settings/update/delete/install/cache over the link, hub-owned ACLs, OUTCOME_UNKNOWN
- [x] Phases 2-3 UI (claude d0d0ef3, 516bc71): badges, machine filter, Node offline, actions-gated tabs, nodeHost, Install/Cache machine pickers; Plugins local-only
- [x] Phases 2-3 LIVE 2026-10-30 14:03; real E2E against the live hub with a throwaway node panel on this VM: pair → server listed with badge → Start → live console → Files → Stop → node killed shows Node offline → reconnect → removed, all cleaned up
- [x] Garry's Mod record deleted on live 14:03:59 by admin (cause unknown); restored 14:18 at Daniel's request, start/stop verified, left stopped (empty list kept as servers.json.empty-1416)
- [x] Activity From column UI (claude 349fcea, live)
- [ ] Activity IP + browser backend fields (codex) → deploy + test (claude)
- [x] Per-person logins: Daniel's own admin login 'daniel' (outbox file); others via Settings → Users
- [ ] Phase 4: Windows node package + test on a real Windows PC
  - [x] Setup.cmd/Uninstall.cmd/setup.ps1 (claude; parses on pwsh 7.6, ScriptAnalyzer clean apart from Write-Host style)
  - [x] scripts/build-windows-node.sh: bundled Node v22.23.3 win-x64 (SHA-256 checked), prod modules, frontend; draft zip 38 MB, no secrets
  - [x] Nodes page "Add node" explains the Windows Setup; docs/MULTI-NODE.md phase 4 diagram
  - [x] Service scripts (WinSW pinned, LocalService, LAN-only game-port rule), `pair --until-approved`, Windows taskkill /T: claude took these over while codex was at its usage limit (af181b9); tested pair flag against the live hub
  - [ ] codex review of af181b9 when back; open notes: startup `srcds` kill-all on Windows, Windows disk metrics, RCON on Windows
  - [x] Final zip in console Outbox (ServerForge-Node-Setup.zip + .sha256), step list sent to Daniel
  - [ ] Daniel: VM IP → UFW 3231 rule (claude); VM test; fix whatever it finds

## UI v3 (Daniel 2026-10-30: "too bubble like… not like an actual interface")
- [x] Flat kit (radii 2-6px, 1px borders, no glows/gradients, 14px root), left sidebar + breadcrumb bar
- [x] Servers/Nodes/Users as tables; compact server header + underline tabs; Install game list; plain login
- [x] Tested 1440 + 390 every screen; multi-node mock 22/22; LIVE e987477
- [ ] codex independent review (layout, keyboard, phone)
- [x] Daniel approved v3 ("Looks good", 14:36): sidebar stays

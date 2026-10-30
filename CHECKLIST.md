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
- [ ] Deleting/demoting a user drops their live sockets (follow-up)
- [x] Install saves an 'installing' record first; interrupted/failed installs show as Install failed and Update finishes them
- [x] Real install verified end to end: Valheim installed (2.1 GB), started, listening, stopped (2026-10-30)
- [ ] Open Valheim UDP 2456-2457 in UFW for LAN play (ask Daniel which devices)
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

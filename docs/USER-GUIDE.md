# Using ServerForge

## Install and operate
Choose Install, pick a game, then select a compatible machine and its settings. A ready cache on that machine can avoid a fresh download. Servers shows status, address and available actions. Open a server to use Console, Files, Schedule, Backups and Settings. Features on a remote server depend on the node's advertised capabilities.

## Accounts and access
Admins manage accounts in Settings → Users. Reset password, role changes and disabling an account end its current sessions. The last active admin cannot be disabled, deleted or demoted. Use a server's Access tab to grant individual permissions to ordinary users; admins already have full access. Account lets a signed-in user change their own password.

## Plugins and Workshop
The Plugins tab lists installed and available plugins. Install downloads the selected supported plugin. Restart the game to load it. Plugin uninstall is not implemented. Workshop items should be added to a Steam Workshop collection; set its numeric collection ID in the panel. Workshop search needs a Steam Web API key in Settings. Remote plugin management requires an updated node.

## Moving servers
Move to… prepares a fresh installation on the target, copies supported configurations/saves and verifies that it starts. A ready destination cache is used when available. Schedules, access and Workshop collection settings are copied; read any warnings and restore missing settings before removing the source. Keep both retains the source. Remove old copy and files requests deletion of the old record and game files; the UI reports if files could not be removed. Back up valuable saves before a move.

## Download cache
Settings → Manage Cache chooses a machine. Download creates its cache; Update refreshes an existing cache on demand. Cancel waits for the installer to stop, and Resume retries interrupted work. An in-use cache cannot be updated or deleted while copying. Cache binaries are OS-specific. There is no overnight auto-update or node-to-node cache copy in this release.

## Versions and operation
Panel release tags and Windows node package versions are separate. Use Nodes → Update for node packages. The machine details show configuration paths and capacity; offline nodes cannot accept new operations. Run the panel under your service manager and preserve its data directories when updating source.

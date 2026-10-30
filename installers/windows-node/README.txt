ServerForge Node for Windows
============================

Joins this Windows PC to your ServerForge panel, so the panel can install and run
Windows game servers (V Rising, Enshrouded, Conan Exiles, The Forest...) on it.

1. On the panel: Nodes > Add node > Download file (the pairing file).
   Copy it to this PC. It works once and expires after 10 minutes.
2. Unzip this whole folder, then double-click Setup.cmd and allow administrator rights.
3. Pick the pairing file when asked. Setup shows a fingerprint.
4. On the panel: Nodes > the waiting card > check the fingerprint matches > tick > Approve.

That's it. ServerForge runs as a Windows service and starts with Windows.
It doesn't open any ports on this PC: it connects out to the panel.
(Game servers you install need their own game ports; the panel shows them.)

What it installs
  C:\Program Files\ServerForge     the app, with its own Node.js (nothing else needed)
  C:\ProgramData\ServerForge       game servers, backups, settings, SteamCMD, setup.log

Uninstall: C:\Program Files\ServerForge\Uninstall.cmd
  (keeps your game servers; add -Purge in PowerShell to delete them too)
Then remove the PC on the panel: Nodes > Remove.

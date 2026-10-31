# ServerForge 1.11

This release brings the multi-node panel updates onto the main branch, including:

- Game-first installation with a compatible-machine picker, readable UI and machine detail cards.
- Moves that preserve schedules/access and Workshop settings, pace large archives, and optionally remove the original game files.
- Node capability compatibility, so unfamiliar advertised actions do not disconnect newer nodes.
- User roles, disable/enable and password reset with session invalidation.
- Remote plugin management, corrected ULib/ULX directory layout, Workshop settings persistence, and corrected installed/available plugin display.
- On-demand cache updates, progress/cancel controls and copy/update exclusion.
- Activity focused on changes, refreshed documentation and sample-data screenshots.

Validation: backend suite passed twice consecutively (89/89 each) and production frontend build passed. The plugin list UI was checked separately using mocked API responses. An earlier unidentified intermittent backend failure did not reproduce; no fix is claimed for it. Vite's bundle-size warning remains.

Known limits: plugins cannot be uninstalled from the panel; caches are OS-specific and node-to-node copy is not implemented. Real Windows plugin installation and a real Steam cache update remain machine-specific checks. Panel tags are separate from the Windows node package version.

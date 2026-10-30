const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const steamcmd = require('./services/steamcmd');
const processManager = require('./services/processManager');
const serverStore = require('./services/serverStore');
const templateStore = require('./services/templateStore');
const pluginService = require('./services/pluginService');

const userStore = require('./services/userStore');
const settingsStore = require('./services/settingsStore');
const { authMiddleware, socketAuth, JWT_SECRET, validTeamDomain } = require('./middleware/auth');
const { safeJoin, isInside, isNumericId, isBackupName, SERVERS_ROOT, requireAdmin, loginBlocked, loginFailed, loginSucceeded } = require('./middleware/guard');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
// Same-origin only: the panel serves its own frontend, so no cross-site API or socket access.
const io = new Server(server, {
    cors: process.env.APP_URL ? { origin: process.env.APP_URL, methods: ["GET", "POST"] } : undefined
});
io.use(socketAuth);

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
app.use(express.json({ limit: '6mb' }));
fs.ensureDirSync(SERVERS_ROOT);

// Kill all orphaned srcds.exe processes on startup (Windows only)
function cleanupOrphanedProcesses() {
    // Skip cleanup on Linux/Docker (process management handled differently)
    if (process.platform !== 'win32') {
        console.log('Skipping Windows-specific process cleanup (running on', process.platform + ')');
        return;
    }

    console.log('Cleaning up orphaned server processes...');
    const cleanup = spawn('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Process srcds -ErrorAction SilentlyContinue | Stop-Process -Force'
    ]);

    cleanup.on('close', (code) => {
        console.log('Process cleanup complete.');
    });

    cleanup.on('error', (err) => {
        console.log('Process cleanup skipped:', err.message);
    });
}

cleanupOrphanedProcesses();

// SteamCMD downloads on first install (steamcmd.install calls init), not at every start.
// An unhandled failure here used to crash the panel when offline.

// Load server data from disk before any operations
(async () => {
    await serverStore.load();
    await userStore.init(); // Initialize user store (creates default admin if needed)
    const servers = serverStore.getAll();
    for (const srv of servers) {
        if (srv.status !== 'stopped') {
            await serverStore.updateStatus(srv.id, 'stopped');
        }
    }
})();



// Serve static frontend files in production (BEFORE Auth Middleware)
// Check both Docker path (./frontend/dist) and development path (../frontend/dist)
console.log('__dirname:', __dirname);
let frontendPath = path.join(__dirname, 'frontend/dist');
console.log('Checking Docker path:', frontendPath, '- Exists:', fs.existsSync(frontendPath));
if (!fs.existsSync(frontendPath)) {
    frontendPath = path.join(__dirname, '../frontend/dist');
    console.log('Checking dev path:', frontendPath, '- Exists:', fs.existsSync(frontendPath));
}

if (fs.existsSync(frontendPath)) {
    console.log('✅ Serving frontend from:', frontendPath);
    app.use(express.static(frontendPath));
} else {
    console.log('❌ Frontend build not found at:', frontendPath);
}


// Apply Auth Middleware (Only for API routes)
app.use('/api', authMiddleware);

// Routes

// Auth Routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.socket.remoteAddress;
    if (loginBlocked(ip)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username and password required' });
    try {
        const user = await userStore.authenticate(username, password);
        if (!user) {
            loginFailed(ip);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        loginSucceeded(ip);

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Debug endpoint to check Cloudflare headers (public route)
app.get('/api/debug/headers', requireAdmin, (req, res) => {
    res.json({
        cfJwt: req.headers['cf-access-jwt-assertion'] ? 'Present' : 'Missing',
        cfJwtLength: req.headers['cf-access-jwt-assertion']?.length || 0,
        allHeaders: Object.keys(req.headers),
        userAgent: req.headers['user-agent']
    });
});

app.get('/api/users', async (req, res) => {
    try {
        // Only admin can list users
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const users = await userStore.getUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const { username, password, role } = req.body;
        const newUser = await userStore.addUser(username, password, role);
        res.json(newUser);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        await userStore.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/users/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        await userStore.changePassword(req.user.id, currentPassword, newPassword);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Settings endpoints. Only the auth mode is public (the login page needs it); the rest is admin-only.
const SETTING_KEYS = ['steamApiKey', 'authMode', 'cfAccessTeamDomain', 'cfAccessAud'];
const publicSettings = s => ({ ...s, steamApiKey: '', steamApiKeySet: !!s.steamApiKey });

app.get('/api/auth-mode', async (req, res) => {
    const settings = await settingsStore.getSettings();
    res.json({ authMode: settings.authMode === 'external' ? 'external' : 'local' });
});

app.get('/api/settings', requireAdmin, async (req, res) => {
    try {
        res.json(publicSettings(await settingsStore.getSettings()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
    try {
        const update = {};
        for (const k of SETTING_KEYS) if (typeof req.body?.[k] === 'string') update[k] = req.body[k].trim();
        if (update.steamApiKey === '') delete update.steamApiKey;   // blank field = keep the saved key
        if ('authMode' in update && !['local', 'external'].includes(update.authMode)) return res.status(400).json({ error: 'Auth mode must be local or external' });
        const next = { ...(await settingsStore.getSettings()), ...update };
        if (next.authMode === 'external' && (!validTeamDomain(next.cfAccessTeamDomain) || !next.cfAccessAud)) {
            return res.status(400).json({ error: 'Set a team domain like https://<team>.cloudflareaccess.com and the AUD tag first' });
        }
        res.json(publicSettings(await settingsStore.updateSettings(update)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/servers', (req, res) => {
    // RCON passwords are for admins only.
    const all = serverStore.getAll();
    res.json(req.user?.role === 'admin' ? all : all.map(({ rconPassword, ...s }) => s));
});

const GAME_DEFAULTS = {
    '4020': { executable: 'srcds_win64.exe', args: ['-console', '-game', 'garrysmod', '+map', 'gm_construct', '+maxplayers', '16'], beta: 'x86-64' },
    '232250': { executable: 'srcds.exe', args: ['-console', '-game', 'tf', '+map', 'cp_dustbowl', '+maxplayers', '24'] },
    '740': { executable: 'srcds.exe', args: ['-console', '-game', 'csgo', '-usercon', '+game_type', '0', '+game_mode', '1', '+mapgroup', 'mg_active', '+map', 'de_dust2'] },
    '4940': { executable: 'srcds.exe', args: ['-console', '-game', 'cstrike', '+map', 'de_dust2', '+maxplayers', '16'] },
    '222860': { executable: 'srcds.exe', args: ['-console', '-game', 'left4dead2', '+map', 'c1m1_hotel'] },
    '1007': { executable: 'srcds.exe', args: ['-console', '-game', 'hl2mp', '+map', 'dm_lockdown'] }
};

app.post('/api/install', requireAdmin, async (req, res) => {
    const { appId, gameName, templateName = 'Default', hostname, useCache } = req.body || {};
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Pick a game' });
    if (typeof gameName !== 'string' || !gameName.trim()) return res.status(400).json({ error: 'Game name required' });
    const port = req.body.port == null || req.body.port === '' ? null : Number(req.body.port);
    if (port !== null && !(Number.isInteger(port) && port >= 1024 && port <= 65535)) return res.status(400).json({ error: 'Port must be 1024-65535' });

    try {
        // Every server goes in its own folder under SERVERS_ROOT; the client only names the folder.
        const folder = String(req.body.installPath || hostname || gameName).split(/[\\/]/).pop().replace(/[^\w .-]/g, '').trim() || `server-${Date.now()}`;
        const installPath = safeJoin(SERVERS_ROOT, folder);
        if (installPath === SERVERS_ROOT) return res.status(400).json({ error: 'Choose a folder name' });
        console.log(`Installing ${gameName} (${appId}) to ${installPath} using template "${templateName}"...`);

        if (useCache) {
            io.emit('install-log', `Checking cache for ${gameName}...`);
            const isCached = await cacheService.isCached(appId);

            if (isCached) {
                io.emit('install-log', `Found cached version. Copying files... (This is much faster)`);
                await cacheService.copyFromCache(appId, installPath);
                io.emit('install-log', `Files copied successfully!`);
            } else {
                io.emit('install-log', `Game not found in cache. Falling back to standard download...`);
                const defaults = GAME_DEFAULTS[appId];
                await steamcmd.install(appId, installPath, (log) => {
                    io.emit('install-log', log);
                }, defaults?.beta);
            }
        } else {
            const defaults = GAME_DEFAULTS[appId];
            await steamcmd.install(appId, installPath, (log) => {
                io.emit('install-log', log);
            }, defaults?.beta);
        }

        // Get template configuration
        const template = templateStore.getTemplate(appId, templateName);
        const defaults = { ...(template || GAME_DEFAULTS[appId] || { executable: 'srcds.exe', args: ['-console'] }) };
        // Templates name the Windows program; Linux SteamCMD installs the srcds_run launchers instead.
        if (process.platform !== 'win32' && /^srcds(_win64)?\.exe$/.test(defaults.executable)) {
            defaults.executable = defaults.executable === 'srcds_win64.exe' ? 'srcds_run_x64' : 'srcds_run';
        }

        // Prepare args with custom port
        let args = [...defaults.args];
        const serverPort = port || defaults.port || 27015;
        if (port && !args.includes('+port')) args.push('+port', String(port));

        // Extract game directory from args (usually follows -game)
        const gameDirIndex = args.indexOf('-game');
        const gameDir = gameDirIndex !== -1 ? args[gameDirIndex + 1] : gameName.toLowerCase().replace(/\s+/g, '');

        // Create new server object
        const newServer = {
            id: Date.now().toString(),
            name: hostname || gameName,
            game: gameName,
            appId: appId,
            path: installPath,
            port: serverPort,
            rconPassword: Math.random().toString(36).slice(-8),
            status: 'stopped',
            owner: req.user ? req.user.username : 'admin',
            executable: defaults.executable,
            args: args
        };

        // Add to store
        await serverStore.add(newServer);

        await steamcmd.createServerConfig(
            installPath,
            gameDir,
            newServer.rconPassword,
            hostname || gameName
        );

        res.json({ success: true, server: newServer });
    } catch (err) {
        console.error('Installation failed:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.post('/api/server/start', async (req, res) => {
    const { id } = req.body;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Safety check for missing executable/args (legacy data support)
        if (!srv.executable) {
            const defaults = GAME_DEFAULTS[srv.appId];
            if (defaults) {
                console.log(`Server ${srv.name} missing executable, using default: ${defaults.executable}`);
                srv.executable = defaults.executable;
                srv.args = srv.args || defaults.args;
                // Save these fixes to the store
                await serverStore.updateServerConfig(id, { executable: srv.executable, args: srv.args });
            } else {
                return res.status(500).json({ error: 'Server configuration missing executable path. Please reinstall or update config.' });
            }
        }

        // Construct full executable path
        // The program must live inside the server's own folder.
        const execPath = path.resolve(srv.path, srv.executable);
        if (!isInside(srv.path, execPath)) return res.status(400).json({ error: 'Executable must be inside the server folder' });
        if (!await fs.pathExists(execPath)) return res.status(400).json({ error: `Executable not found: ${srv.executable}` });
        const args = srv.args || [];
        const cwd = srv.path;  // Use server install directory as working directory

        processManager.start(id, execPath, args, cwd);
        await serverStore.updateStatus(id, 'running');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/stop', async (req, res) => {
    const { id } = req.body || {};
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });

    try {
        processManager.stop(id);
        await serverStore.updateStatus(id, 'stopped');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/update', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Stop server if running
        const status = processManager.getStatus(id);
        if (status === 'running') {
            console.log(`Stopping server ${srv.name} for update...`);
            processManager.stop(id);
            await serverStore.updateStatus(id, 'stopped');
            // Wait a bit for process to fully release files
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`Starting update for ${srv.name} (${srv.appId})...`);

        // Run SteamCMD update (install)
        // We use the install method which runs app_update
        steamcmd.install(srv.appId, srv.path, (log) => {
            io.emit(`update-log-${id}`, log);
        }).then(() => {
            io.emit(`update-complete-${id}`, { success: true });
        }).catch((err) => {
            console.error('Update failed:', err);
            io.emit(`update-complete-${id}`, { success: false, error: err.message });
        });

        res.json({ success: true, message: 'Update started' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/server/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });

    try {
        processManager.stop(id);
        await serverStore.remove(id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/server/:id/status', (req, res) => {
    const { id } = req.params;
    const status = processManager.getStatus(id);
    res.json({ status });
});

app.get('/api/server/:id/logs', (req, res) => {
    const { id } = req.params;
    const logs = processManager.getLogs(id);
    res.send(logs);
});

app.post('/api/restart-backend', requireAdmin, (req, res) => {
    res.json({ success: true, message: 'Backend restarting...' });
    setTimeout(() => {
        console.log('Backend restart requested via API');
        process.exit(0);
    }, 500);
});

// File management routes
app.get('/api/server/:id/files', async (req, res) => {
    const { id } = req.params;
    const { path: relativePath = '' } = req.query;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        const fullPath = safeJoin(srv.path, relativePath);

        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            const items = await fs.readdir(fullPath, { withFileTypes: true });
            const files = await Promise.all(items.map(async (item) => {
                const itemPath = path.join(fullPath, item.name);
                try {
                    const itemStats = await fs.stat(itemPath);
                    return {
                        name: item.name,
                        isDirectory: item.isDirectory(),
                        size: itemStats.size,
                        modified: itemStats.mtime
                    };
                } catch (e) {
                    return null;
                }
            }));
            res.json({ path: relativePath, files: files.filter(f => f) });
        } else {
            if (stats.size > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'File too large to edit (max 5MB)' });
            }
            const content = await fs.readFile(fullPath, 'utf8');
            res.json({ content, size: stats.size });
        }
    } catch (err) {
        res.status(err.status || (err.code === 'ENOENT' ? 404 : 500)).json({ error: err.code === 'ENOENT' ? 'Not found' : err.message });
    }
});

app.post('/api/server/:id/file', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { path: relativePath, content } = req.body || {};
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (!relativePath) return res.status(400).json({ error: 'Path required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content required' });

    try {
        const fullPath = safeJoin(srv.path, relativePath);
        if (fullPath === path.resolve(srv.path)) return res.status(400).json({ error: 'Pick a file' });

        if (await fs.pathExists(fullPath)) {
            await fs.copy(fullPath, `${fullPath}.bak`);
        }

        await fs.writeFile(fullPath, content, 'utf8');
        res.json({ success: true, message: 'File saved (backup created)' });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.put('/api/server/:id/config', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { executable, args } = req.body || {};
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (executable !== undefined && (typeof executable !== 'string' || !executable || !isInside(srv.path, path.resolve(srv.path, executable)))) {
        return res.status(400).json({ error: 'Executable must be a file inside the server folder' });
    }
    if (args !== undefined && !(Array.isArray(args) && args.every(a => typeof a === 'string'))) {
        return res.status(400).json({ error: 'Arguments must be a list of text values' });
    }

    try {
        await serverStore.updateServerConfig(id, { executable, args });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/schedule', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { schedule } = req.body || {}; // cron expression or null
    if (schedule && (typeof schedule !== 'string' || !cron.validate(schedule))) return res.status(400).json({ error: 'That schedule is not a valid cron expression' });

    try {
        const srv = serverStore.get(id);
        if (!srv) return res.status(404).json({ error: 'Server not found' });

        if (schedule) {
            schedulerService.scheduleRestart(id, schedule);
        } else {
            schedulerService.cancelSchedule(id);
        }

        srv.restartSchedule = schedule;
        await serverStore.save();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RCON Command Route
app.post('/api/server/:id/command', async (req, res) => {
    const { id } = req.params;
    const { command } = req.body;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (!command) return res.status(400).json({ error: 'Command required' });

    // Check if server is running
    if (processManager.getStatus(id) !== 'running') {
        return res.status(400).json({ error: 'Server is not running' });
    }

    try {
        const Rcon = require('rcon-srcds').default;

        // Extract port from server args
        let port = Number(srv.port) || 27015;
        const portIndex = srv.args.indexOf('+port');
        if (portIndex !== -1 && srv.args[portIndex + 1]) {
            port = parseInt(srv.args[portIndex + 1]);
        }

        // Use RCON password from server config, or default
        const rconPassword = srv.rconPassword || 'changeme';

        console.log(`Sending RCON command to ${id} (localhost:${port}): ${command}`);

        // Create RCON connection
        const rcon = new Rcon({ host: 'localhost', port: port });

        // Connect and authenticate
        await rcon.authenticate(rconPassword);

        // Send command
        const response = await rcon.execute(command);

        // Disconnect
        rcon.disconnect();

        res.json({ success: true, response: response || 'Command executed (no response)' });
    } catch (err) {
        console.error('RCON command failed:', err);
        res.status(500).json({ error: err.message || 'RCON command failed' });
    }
});

// Template Routes
app.get('/api/templates', (req, res) => {
    const games = templateStore.getAllGames();
    res.json(games);
});

app.get('/api/templates/:gameId', (req, res) => {
    const { gameId } = req.params;
    const templates = templateStore.getTemplates(gameId);
    res.json(templates);
});

app.post('/api/templates/:gameId/:templateName', requireAdmin, async (req, res) => {
    const { gameId, templateName } = req.params;
    const config = req.body;

    try {
        const template = await templateStore.saveTemplate(gameId, templateName, config);
        res.json({ success: true, template });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/templates/:gameId/:templateName', requireAdmin, async (req, res) => {
    const { gameId, templateName } = req.params;

    try {
        const deleted = await templateStore.deleteTemplate(gameId, templateName);
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Template not found' });
        }
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Backup Routes
const backupService = require('./services/backupService');

app.get('/api/server/:id/backups', async (req, res) => {
    const { id } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });
    try {
        const backups = await backupService.listBackups(id);
        res.json(backups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/backups', async (req, res) => {
    const { id } = req.params;
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        const backup = await backupService.createBackup(srv);
        res.json({ success: true, backup });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/backups/restore', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { filename } = req.body || {};
    if (!isBackupName(filename)) return res.status(400).json({ error: 'Unknown backup' });
    const srv = serverStore.get(id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Stop server first if running
        if (processManager.getStatus(id) === 'running') {
            processManager.stop(id);
            await serverStore.updateStatus(id, 'stopped');
        }

        await backupService.restoreBackup(srv, filename);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/server/:id/backups/:filename', requireAdmin, async (req, res) => {
    const { id, filename } = req.params;
    if (!serverStore.get(id)) return res.status(404).json({ error: 'Server not found' });
    if (!isBackupName(filename)) return res.status(400).json({ error: 'Unknown backup' });
    try {
        await backupService.deleteBackup(id, filename);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Plugin Routes
app.get('/api/server/:id/plugins', async (req, res) => {
    try {
        const plugins = await pluginService.getAvailablePlugins(req.params.id);
        res.json(plugins);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/plugins/install', requireAdmin, async (req, res) => {
    try {
        const result = await pluginService.installPlugin(req.params.id, req.body.pluginId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Workshop Search Route
app.get('/api/server/:id/workshop/search', async (req, res) => {
    const { id } = req.params;
    const { q, page } = req.query;
    const srv = serverStore.get(id);

    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
        // Use server key or global key
        let apiKey = srv.steamApiKey;
        if (!apiKey) {
            const settings = await settingsStore.getSettings();
            apiKey = settings.steamApiKey;
        }

        if (!apiKey) {
            return res.status(400).json({ error: 'Steam Web API Key not configured (Server or Global)' });
        }

        // Use Garry's Mod App ID (4000) for workshop search, regardless of server game
        // Or use srv.appId if we want to support other games later
        const appId = 4000;

        const results = await pluginService.searchWorkshop(apiKey, appId, q, page);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/server/:id/workshop', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { collectionId } = req.body || {};
    if (collectionId && !isNumericId(collectionId)) return res.status(400).json({ error: 'Collection ID must be a number' });

    try {
        await pluginService.updateWorkshop(id, collectionId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Install a workshop addon
app.post('/api/server/:id/workshop/install', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { workshopId } = req.body || {};
    if (!isNumericId(workshopId)) return res.status(400).json({ error: 'Workshop ID must be a number' });

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const steamcmd = require('./services/steamcmd');
        // Always use app ID 4000 for Garry's Mod workshop downloads
        // (server.appId might be 4020 for the dedicated server, but workshop uses 4000)
        const workshopAppId = 4000;

        await steamcmd.downloadWorkshopAddon(workshopId, server.path, workshopAppId);
        res.json({ success: true, message: 'Addon installed successfully' });
    } catch (err) {
        console.error('Workshop install error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get list of installed workshop addons
app.get('/api/server/:id/workshop/installed', async (req, res) => {
    const { id } = req.params;

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const addonsPath = path.join(server.path, 'garrysmod', 'addons');

        if (!await fs.pathExists(addonsPath)) {
            return res.json({ addons: [] });
        }

        const entries = await fs.readdir(addonsPath, { withFileTypes: true });
        const addons = [];

        // Get API key from settings
        const settings = await settingsStore.getSettings();
        const apiKey = settings.steamApiKey;

        for (const entry of entries) {
            if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
                // This is a workshop addon (numeric folder name)
                const addonPath = path.join(addonsPath, entry.name);
                const stats = await fs.stat(addonPath);

                // Count files in addon
                let fileCount = 0;
                const countFiles = async (dir) => {
                    const items = await fs.readdir(dir, { withFileTypes: true });
                    for (const item of items) {
                        if (item.isFile()) fileCount++;
                        else if (item.isDirectory()) {
                            await countFiles(path.join(dir, item.name));
                        }
                    }
                };
                await countFiles(addonPath);

                // Fetch addon details from Steam API if we have an API key
                let title = entry.name;
                let thumbnail = null;

                if (apiKey) {
                    try {
                        const formData = new URLSearchParams();
                        formData.append('key', apiKey);
                        formData.append('itemcount', '1');
                        formData.append('publishedfileids[0]', entry.name);

                        console.log(`Fetching Steam data for addon ${entry.name}`);

                        const steamRes = await axios.post(
                            'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
                            formData.toString(),
                            {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                }
                            }
                        );

                        console.log(`Steam API response for ${entry.name}:`, JSON.stringify(steamRes.data, null, 2));

                        const details = steamRes.data?.response?.publishedfiledetails?.[0];
                        if (details && details.result === 1) {
                            title = details.title || entry.name;
                            thumbnail = details.preview_url || null;
                            console.log(`✓ Found title: ${title}`);
                        } else {
                            console.warn(`✗ No valid data for addon ${entry.name}, result: ${details?.result}`);
                        }
                    } catch (err) {
                        console.warn(`Failed to fetch Steam data for addon ${entry.name}:`, err.message);
                    }
                } else {
                    console.warn('No Steam API key configured - addon names will show as IDs');
                }

                addons.push({
                    id: entry.name,
                    name: title,
                    thumbnail,
                    path: addonPath,
                    installedDate: stats.mtime,
                    fileCount
                });
            }
        }

        res.json({ addons });
    } catch (err) {
        console.error('Error listing installed addons:', err);
        res.status(500).json({ error: err.message });
    }
});

// Uninstall a workshop addon
app.delete('/api/server/:id/workshop/installed/:addonId', requireAdmin, async (req, res) => {
    const { id, addonId } = req.params;
    if (!isNumericId(addonId)) return res.status(400).json({ error: 'Unknown addon' });

    try {
        const server = serverStore.get(id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const addonPath = path.join(server.path, 'garrysmod', 'addons', addonId);

        if (!await fs.pathExists(addonPath)) {
            return res.status(404).json({ error: 'Addon not found' });
        }

        await fs.remove(addonPath);
        res.json({ success: true, message: 'Addon uninstalled successfully' });
    } catch (err) {
        console.error('Error uninstalling addon:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Cache Management API Endpoints
// ============================================

const cacheService = require('./services/cacheService');

// List all cached games
app.get('/api/cache/list', async (req, res) => {
    try {
        const cached = await cacheService.listCached();
        res.json({ cached });
    } catch (err) {
        console.error('Error listing cache:', err);
        res.status(500).json({ error: err.message });
    }
});

// Download game to cache
app.post('/api/cache/download/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });
    const { gameName } = req.body;

    try {
        // Start download in background
        const result = await cacheService.downloadToCache(appId, gameName, (log) => {
            io.emit(`cache-download-${appId}`, log);
        });
        res.json(result);
    } catch (err) {
        console.error('Error downloading to cache:', err);
        res.status(500).json({ error: err.message });
    }
});

// Check if game is cached
app.get('/api/cache/status/:appId', async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const status = await cacheService.getCacheStatus(appId);
        res.json(status);
    } catch (err) {
        console.error('Error getting cache status:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete cached game
app.delete('/api/cache/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const result = await cacheService.deleteCache(appId);
        res.json(result);
    } catch (err) {
        console.error('Error deleting cache:', err);
        res.status(500).json({ error: err.message });
    }
});

// Copy from cache (used during install)
app.post('/api/cache/copy/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    const { targetPath } = req.body || {};
    if (!isNumericId(appId)) return res.status(400).json({ error: 'Unknown game' });

    try {
        const result = await cacheService.copyFromCache(appId, safeJoin(SERVERS_ROOT, targetPath));
        res.json(result);
    } catch (err) {
        console.error('Error copying from cache:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

const schedulerService = require('./services/schedulerService');

// Initialize services
schedulerService.init();
settingsStore.load();

// Socket.IO
io.on('connection', (socket) => {
    console.log('Client connected');
});

processManager.on('log', ({ id, data }) => {
    io.emit(`server-log-${id}`, data);
});

processManager.on('status-change', async ({ id, status }) => {
    await serverStore.updateStatus(id, status);
    io.emit(`server-status-${id}`, status);
});

processManager.on('stats', ({ id, stats }) => {
    io.emit(`server-stats-${id}`, stats);
});

const queryService = require('./services/queryService');

// Query loop
setInterval(async () => {
    const servers = serverStore.getAll();
    for (const srv of servers) {
        if (processManager.getStatus(srv.id) === 'running') {
            const result = await queryService.query(srv);
            if (result && result.online) {
                io.emit(`server-query-${srv.id}`, result);
            }
        }
    }
}, 5000);

// Handle SPA routing - return index.html for any unknown route
// Using regex /.*/ to avoid Express 5/path-to-regexp error with '*'
// This must be AFTER API routes so it doesn't intercept them
if (fs.existsSync(frontendPath)) {
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(frontendPath, 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || undefined;   // e.g. 127.0.0.1 or a LAN address; default = all interfaces
server.listen(PORT, HOST, () => {
    console.log(`🚀 ServerForge running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Access at: ${process.env.APP_URL || `http://localhost:${PORT}`}`);
});


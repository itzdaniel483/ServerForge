const jwt = require('jsonwebtoken');
const settingsStore = require('../services/settingsStore');
const userStore = require('../services/userStore');
const axios = require('axios');

const { loadJwtSecret } = require('./guard');

// Never a hard-coded default: anyone who knew it could sign their own admin token.
const JWT_SECRET = loadJwtSecret();

// Only real Cloudflare Access team domains, so a changed setting can't point key lookups at a forger's server.
const validTeamDomain = d => /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(String(d || ''));


// Cache for Cloudflare public keys
let cfPublicKeysCache = null;
let cfKeysCacheTime = 0;
const CF_KEYS_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch Cloudflare Access public keys for JWT verification
 */
async function getCloudflarePublicKeys(teamDomain) {
    const now = Date.now();

    // Return cached keys if still valid
    if (cfPublicKeysCache && (now - cfKeysCacheTime) < CF_KEYS_CACHE_TTL) {
        return cfPublicKeysCache;
    }

    try {
        // Cloudflare publishes their public keys at this endpoint
        if (!validTeamDomain(teamDomain)) throw new Error('Team domain must look like https://<team>.cloudflareaccess.com');
        const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
        const response = await axios.get(certsUrl, { timeout: 10000, maxRedirects: 0 });

        cfPublicKeysCache = response.data;
        cfKeysCacheTime = now;

        return cfPublicKeysCache;
    } catch (err) {
        console.error('Failed to fetch Cloudflare public keys:', err.message);
        throw new Error('Unable to verify Cloudflare JWT: Cannot fetch public keys');
    }
}

/**
 * Verify Cloudflare Access JWT token
 */
async function verifyCloudflareJWT(token, teamDomain, audience) {
    try {
        // Decode token header to get the key ID (kid)
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || !decoded.header || !decoded.header.kid) {
            throw new Error('Invalid JWT format');
        }

        const kid = decoded.header.kid;

        // Get Cloudflare public keys
        const keys = await getCloudflarePublicKeys(teamDomain);

        // Find the matching public key
        const publicKey = keys.public_certs?.find(cert => cert.kid === kid);
        if (!publicKey) {
            throw new Error('Public key not found for token');
        }

        // Verify the JWT using the public key
        const verified = jwt.verify(token, publicKey.cert, {
            audience: audience,
            algorithms: ['RS256']
        });

        return verified;
    } catch (err) {
        console.error('Cloudflare JWT verification failed:', err.message);
        throw err;
    }
}

const authMiddleware = async (req, res, next) => {
    // Public routes, matched on method AND path. (Before: '/api/settings' was public for every method,
    // so anyone could POST new auth settings and take over the panel.)
    const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
    if (route === 'POST /api/login' || route === 'GET /api/auth-mode') {
        return next();
    }

    try {
        const settings = await settingsStore.getSettings();

        // External Auth Mode (Cloudflare Zero Trust)
        if (settings.authMode === 'external') {
            // Check for Cloudflare Access JWT
            const cfJwt = req.headers['cf-access-jwt-assertion'];

            // No Cloudflare JWT: refuse, unless local testing was switched on explicitly.
            if (!cfJwt) {
                console.log('[Auth] No Cloudflare JWT found in headers');
                if (process.env.ALLOW_DEV_AUTH !== '1') {
                    return res.status(401).json({
                        error: 'Cloudflare Access JWT required. Please access this application through your Cloudflare Access URL.'
                    });
                }

                console.warn('External auth mode enabled but no Cloudflare JWT found. Allowing for local testing (development mode).');
                req.user = {
                    username: 'local_test_user',
                    role: 'admin',
                    local_testing: true
                };
                return next();
            }

            console.log('[Auth] Cloudflare JWT found, verifying...');

            // Verify we have the required Cloudflare configuration
            if (!settings.cfAccessTeamDomain || !settings.cfAccessAud) {
                console.error('[Auth] Cloudflare config missing:', {
                    teamDomain: !!settings.cfAccessTeamDomain,
                    aud: !!settings.cfAccessAud
                });
                return res.status(500).json({
                    error: 'Cloudflare Access not properly configured. Please set Team Domain and AUD in Settings.'
                });
            }

            console.log('[Auth] Using Team Domain:', settings.cfAccessTeamDomain);
            console.log('[Auth] Using AUD:', settings.cfAccessAud.substring(0, 10) + '...');

            try {
                // Verify the Cloudflare JWT
                const verified = await verifyCloudflareJWT(
                    cfJwt,
                    settings.cfAccessTeamDomain,
                    settings.cfAccessAud
                );

                console.log('[Auth] JWT verified successfully for:', verified.email || verified.sub);

                // Extract user info from the verified token
                req.user = {
                    username: verified.email || verified.sub || 'cloudflare_user',
                    role: 'admin', // You can customize this based on Cloudflare groups
                    email: verified.email,
                    cloudflare: true
                };

                return next();
            } catch (err) {
                console.error('[Auth] Cloudflare JWT verification failed:', err.message);
                return res.status(401).json({ error: 'Invalid Cloudflare Access JWT' });
            }
        }

        // Local Auth Mode - verify local JWT
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            // Use the stored role, so a deleted or demoted user's old token stops working.
            const current = (await userStore.getUsers()).find(u => u.id === decoded.id);
            if (!current) return res.status(401).json({ error: 'Invalid token' });
            req.user = { id: current.id, username: current.username, role: current.role };
            next();
        } catch (err) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

// Socket.IO uses the same rules: a local token in the handshake, or a verified Cloudflare JWT.
async function socketAuth(socket, next) {
    try {
        const settings = await settingsStore.getSettings();
        if (settings.authMode === 'external') {
            const cfJwt = socket.handshake.headers['cf-access-jwt-assertion'];
            if (!cfJwt) return next(process.env.ALLOW_DEV_AUTH === '1' ? undefined : new Error('unauthorized'));
            await verifyCloudflareJWT(cfJwt, settings.cfAccessTeamDomain, settings.cfAccessAud);
            return next();
        }
        jwt.verify(String(socket.handshake.auth?.token || ''), JWT_SECRET, { algorithms: ['HS256'] });
        return next();
    } catch {
        return next(new Error('unauthorized'));
    }
}

module.exports = { authMiddleware, socketAuth, JWT_SECRET, validTeamDomain };

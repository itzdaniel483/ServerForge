const net = require('node:net');
function cleanIp(value) {
    if (typeof value !== 'string') return null;
    const ip = value.startsWith('::ffff:') && net.isIP(value.slice(7)) === 4 ? value.slice(7) : value;
    return net.isIP(ip) ? ip : null;
}
function cleanUserAgent(value) {
    if (typeof value !== 'string') return null;
    return value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512) || null;
}
function auditContext(req) {
    const peerIp = cleanIp(req.socket?.remoteAddress);
    // Only authMiddleware can attach hubActor after validating a local admin JWT.
    // Forwarded HTTP headers are deliberately never trusted for attribution.
    if (req.hubActor) return { ip: cleanIp(req.hubActor.ip), userAgent: cleanUserAgent(req.hubActor.userAgent), peerIp, viaHub: true };
    return { ip: peerIp, userAgent: cleanUserAgent(req.headers?.['user-agent']), peerIp, viaHub: false };
}
module.exports = { cleanIp, cleanUserAgent, auditContext };

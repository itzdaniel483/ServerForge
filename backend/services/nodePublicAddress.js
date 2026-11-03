// Public address for nodes outside the LAN (claude, 2026-11-03, Planka "Public address setting", Daniel chose port forward).
// The admin saves "host" or "host:port" once; outside pairing files then tell the node to dial wss://host:port/<node path>.
// Nodes pin the hub's certificate fingerprint, so a different hostname is fine for TLS.

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// Returns { host, port } or throws an Error with a plain-English message. '' means "not set".
function parsePublicAddress(raw, defaultPort) {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    if (value.length > 260) throw new Error('That address is too long');
    if (/[\s/@?#]/.test(value) || /^[a-z]+:\/\//i.test(value)) throw new Error('Enter just the address, like home.example.com or home.example.com:3231 (no wss://, no paths)');
    const m = value.match(/^([^:]+)(?::(\d{1,5}))?$/);
    if (!m) throw new Error('Enter an address like home.example.com or 203.0.113.7:3231');
    const host = m[1].toLowerCase();
    const port = m[2] ? Number(m[2]) : Number(defaultPort);
    if (!IPV4_RE.test(host) && !(HOST_RE.test(host) && /[a-z]/.test(host))) throw new Error('That isn’t a valid host name or IPv4 address');
    if (/^(localhost|.*\.local)$/.test(host) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        throw new Error('That’s a private address. Use your home’s public address or domain');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
    return { host, port };
}

function normalizePublicAddress(raw, defaultPort) {
    const p = parsePublicAddress(raw, defaultPort);
    return p ? `${p.host}:${p.port}` : '';
}

// Outside hub URL from the saved setting, reusing the LAN URL's path (e.g. /nodes).
function outsideHubUrl(saved, lanHubUrl, defaultPort) {
    const p = parsePublicAddress(saved, defaultPort);
    if (!p || !lanHubUrl) return null;
    const lan = new URL(lanHubUrl);
    return `wss://${p.host}:${p.port}${lan.pathname}`;
}

module.exports = { parsePublicAddress, normalizePublicAddress, outsideHubUrl };

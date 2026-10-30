const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { writeJsonSync } = require('./jsonFile');
const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const composite = new RegExp(`^(${UUID}):([A-Za-z0-9_-]{1,128})$`, 'i');
function splitRemoteId(value) {
    const match = typeof value === 'string' && value.match(composite);
    return match ? { nodeId: match[1], serverId: match[2] } : null;
}
function cleanServer(server) {
    if (!server || !/^[A-Za-z0-9_-]{1,128}$/.test(server.id)) return null;
    const out = { id: server.id };
    for (const field of ['name', 'game', 'gameId', 'appId', 'status', 'installError']) {
        if (typeof server[field] === 'string') out[field] = server[field].slice(0, field === 'installError' ? 2000 : 160);
    }
    for (const field of ['port', 'players', 'maxPlayers']) out[field] = Number.isInteger(server[field]) && server[field] >= 0 ? server[field] : null;
    return out;
}
class RemoteServers {
    constructor({ dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data') } = {}) {
        this.file = path.join(dataDir, 'remote-servers.json');
        // ACLs must not silently roll back to a backup containing revoked grants.
        try {
            this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!this.state || !this.state.nodes || !this.state.access) throw new Error('Invalid state');
        } catch (err) {
            if (err.code !== 'ENOENT' || fs.existsSync(this.file + '.bak')) throw new Error('Remote server ACL database requires manual recovery');
            this.state = { nodes: {}, access: {} };
        }
    }
    save() { writeJsonSync(this.file, this.state); }
    sync(nodeId, snapshot) {
        if (!Array.isArray(snapshot?.servers)) return;
        const servers = snapshot.servers.slice(0, 1000).map(cleanServer).filter(Boolean);
        const nodeHost = typeof snapshot.nodeHost === 'string' && net.isIP(snapshot.nodeHost) ? snapshot.nodeHost : null;
        const next = { servers, nodeHost };
        if (JSON.stringify(this.state.nodes[nodeId]) !== JSON.stringify(next)) { this.state.nodes[nodeId] = next; this.save(); }
    }
    list(registry, transport) {
        const status = transport?.listStatus() || {};
        return registry.list().flatMap(node => {
            const cached = this.state.nodes[node.id];
            return (cached?.servers || []).map(server => ({ ...server, id: `${node.id}:${server.id}`, nativeServerId: server.id,
                nodeId: node.id, nodeName: node.name, nodeOs: node.os, nodeOnline: !!status[node.id]?.online,
                nodeHost: cached.nodeHost || status[node.id]?.nodeHost || null, owner: null,
                access: this.state.access[`${node.id}:${server.id}`] || [] }));
        });
    }
    get(id, registry, transport) { return this.list(registry, transport).find(server => server.id === id); }
    upsert(nodeId, server) {
        const clean = cleanServer(server);
        if (!clean) return;
        const cached = this.state.nodes[nodeId] || { servers: [], nodeHost: null };
        cached.servers = [...cached.servers.filter(item => item.id !== clean.id), clean].slice(-1000);
        this.state.nodes[nodeId] = cached; this.save();
    }
    removeServer(id) {
        const parsed = splitRemoteId(id);
        if (!parsed || !this.state.nodes[parsed.nodeId]) return;
        this.state.nodes[parsed.nodeId].servers = this.state.nodes[parsed.nodeId].servers.filter(server => server.id !== parsed.serverId);
        delete this.state.access[id]; this.save();
    }
    setAccess(id, list) {
        const previous = this.state.access[id];
        this.state.access[id] = list;
        try { this.save(); }
        catch (err) { if (previous === undefined) delete this.state.access[id]; else this.state.access[id] = previous; throw err; }
    }
    removeNode(id) {
        delete this.state.nodes[id];
        for (const key of Object.keys(this.state.access)) if (key.startsWith(id + ':')) delete this.state.access[key];
        this.save();
    }
}
module.exports = { RemoteServers, splitRemoteId, cleanServer };

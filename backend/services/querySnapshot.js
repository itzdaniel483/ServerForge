// Ephemeral query counts; never persist potentially stale players to servers.json.
const snapshots = new Map();
function record(id, result, at = Date.now()) {
    if (!result?.online) return snapshots.delete(id);
    const count = value => Number.isInteger(value) && value >= 0 ? value : null;
    snapshots.set(id, { players: count(result.players), maxPlayers: count(result.maxPlayers), at });
}
function get(id, running, now = Date.now()) {
    const data = snapshots.get(id);
    if (!running || !data || now - data.at > 30000) return { players: null, maxPlayers: null };
    return { players: data.players, maxPlayers: data.maxPlayers };
}
module.exports = { record, get, clear: id => snapshots.delete(id) };

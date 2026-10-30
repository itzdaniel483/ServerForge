// Local socket identities are snapshots taken at handshake time. Force a fresh
// authenticated connection after deletion, rename or role change.
function invalidateChangedUsers(io, users) {
    const current = new Map(users.map(user => [user.id, user]));
    for (const socket of io.sockets.sockets.values()) {
        const identity = socket.data.user;
        // Cloudflare identities have no local account id.
        if (!identity?.id) continue;
        const user = current.get(identity.id);
        if (!user || user.username !== identity.username || user.role !== identity.role) socket.disconnect(true);
    }
}

module.exports = { invalidateChangedUsers };

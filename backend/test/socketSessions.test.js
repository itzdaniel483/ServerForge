const test = require('node:test');
const assert = require('node:assert/strict');
const { invalidateChangedUsers } = require('../services/socketSessions');

test('account deletion and demotion disconnect all affected sockets, preserving unchanged and external users', () => {
    const sockets = [
        { id: 'deleted', username: 'gone', role: 'user' },
        { id: 'demoted', username: 'former-admin', role: 'admin' },
        { id: 'demoted', username: 'former-admin', role: 'admin' },
        { id: 'kept', username: 'kept', role: 'admin' },
        { username: 'external', role: 'admin' },
    ].map(user => ({ data: { user }, disconnected: false, disconnect(force) { this.disconnected = force; } }));
    invalidateChangedUsers({ sockets: { sockets: new Map(sockets.map((socket, i) => [i, socket])) } }, [
        { id: 'demoted', username: 'former-admin', role: 'user' },
        { id: 'kept', username: 'kept', role: 'admin' },
    ]);
    assert.deepEqual(sockets.map(socket => socket.disconnected), [true, true, true, false, false]);
});

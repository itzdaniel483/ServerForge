// Live player/map query (claude, 2026-10-30). gamedig v5 exports { GameDig }; the old code called
// Gamedig.query, which doesn't exist, so players and map never showed. The game type now comes from
// the catalogue, and the port from the server's query port (or game port).
const { GameDig } = require('gamedig');
const catalog = require('./catalog');

class QueryService {
    async query(server) {
        const game = catalog.get(server.gameId) || catalog.findByAppId(server.appId);
        if (!game?.query) return null;
        const port = Number(server.vars?.queryport || server.vars?.port || server.port) || 27015;
        try {
            const state = await GameDig.query({ type: game.query, host: '127.0.0.1', port, maxRetries: 0, socketTimeout: 1500, attemptTimeout: 3000 });
            return {
                online: true,
                players: state.numplayers ?? state.players.length,
                maxPlayers: state.maxplayers,
                name: state.name,
                map: state.map,
                playerList: state.players.map(p => ({ name: p.name || 'Connecting…', score: p.raw?.score ?? p.score ?? null, time: p.raw?.time ?? null })),
            };
        } catch {
            return { online: false };
        }
    }
}

module.exports = new QueryService();

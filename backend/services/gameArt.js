// Steam header artwork is fetched by the backend, never by a browser or from a client URL.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const catalog = require('./catalog');

const MAX_BYTES = 2 * 1024 * 1024;
const jpeg = bytes => Buffer.isBuffer(bytes) && bytes.length >= 4 && bytes.length <= MAX_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

function createGameArt({ games = catalog, cacheDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'game-art'), download = axios.get, now = Date.now } = {}) {
    const pending = new Map();
    const failedUntil = new Map();

    async function load(storeId) {
        const file = path.join(cacheDir, `${storeId}.jpg`);
        try {
            const stat = await fs.lstat(file);
            if (stat.isFile() && stat.size <= MAX_BYTES && jpeg(await fs.readFile(file))) return { path: file, mime: 'image/jpeg' };
        } catch { /* first fetch */ }
        if ((failedUntil.get(storeId) || 0) > now()) return null;
        let temporary;
        try {
            const response = await download(`https://shared.steamstatic.com/store_item_assets/steam/apps/${storeId}/header.jpg`, {
                responseType: 'arraybuffer', timeout: 8000, maxRedirects: 0,
                maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES,
            });
            const bytes = Buffer.from(response.data);
            if (!/^image\/jpeg(?:\s*;|$)/i.test(String(response.headers['content-type'] || '')) || !jpeg(bytes)) throw new Error('Invalid Steam artwork');
            await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
            temporary = `${file}.${crypto.randomUUID()}.tmp`;
            await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, file);
            failedUntil.delete(storeId);
            return { path: file, mime: 'image/jpeg' };
        } catch {
            failedUntil.set(storeId, now() + 60_000);
            if (temporary) await fs.unlink(temporary).catch(() => {});
            return null;
        }
    }

    async function getArt(gameId) {
        const game = games.get(gameId);
        const storeId = String(game?.storeAppId || '');
        if (!/^[1-9]\d{0,9}$/.test(storeId)) return null;
        if (!pending.has(storeId)) {
            const request = load(storeId).finally(() => pending.delete(storeId));
            pending.set(storeId, request);
        }
        return pending.get(storeId);
    }
    return { getArt };
}

module.exports = { ...createGameArt(), createGameArt };

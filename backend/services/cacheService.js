const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const steamcmd = require('./steamcmd');
const { writeJson } = require('./jsonFile');

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '../..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');

class CacheService {
    constructor() {
        this.cache = {};
        this.init();
    }

    async init() {
        await fs.ensureDir(CACHE_DIR);
        await this.loadCache();
    }

    async loadCache() {
        try {
            if (await fs.pathExists(CACHE_FILE)) {
                const data = await fs.readFile(CACHE_FILE, 'utf8');
                this.cache = JSON.parse(data);
            }
        } catch (err) {
            console.error('Failed to load cache.json:', err);
            this.cache = {};
        }
    }

    async saveCache() {
        await writeJson(CACHE_FILE, this.cache);
    }

    async listCached() {
        await this.loadCache();
        return Object.keys(this.cache).map(appId => ({
            appId,
            ...this.cache[appId]
        }));
    }

    async isCached(appId) {
        await this.loadCache();
        return this.cache[appId] && this.cache[appId].status === 'ready';
    }

    async getCachePath(appId) {
        return path.join(CACHE_DIR, appId.toString());
    }

    async downloadToCache(appId, gameName, onProgress) {
        const cachePath = await this.getCachePath(appId);

        // Update cache status to downloading
        this.cache[appId] = {
            name: gameName,
            status: 'downloading',
            downloadedDate: null,
            lastChecked: new Date().toISOString(),
            diskSize: null
        };
        await this.saveCache();

        try {
            // Use SteamCMD to download the game to cache
            await steamcmd.install(appId, cachePath, onProgress);

            // Calculate disk size
            const size = await this.getDiskSize(cachePath);

            // Update cache status to ready
            this.cache[appId] = {
                name: gameName,
                status: 'ready',
                downloadedDate: new Date().toISOString(),
                lastChecked: new Date().toISOString(),
                diskSize: size
            };
            await this.saveCache();

            return { success: true };
        } catch (err) {
            // Update cache status to error
            this.cache[appId] = {
                name: gameName,
                status: 'error',
                downloadedDate: null,
                lastChecked: new Date().toISOString(),
                diskSize: null,
                error: err.message
            };
            await this.saveCache();
            throw err;
        }
    }

    async copyFromCache(appId, targetPath) {
        const isCached = await this.isCached(appId);
        if (!isCached) {
            throw new Error(`Game ${appId} is not cached. Please download it first.`);
        }

        const cachePath = await this.getCachePath(appId);

        // Copy the cached game to the target path
        await fs.copy(cachePath, targetPath, {
            overwrite: false,
            errorOnExist: false
        });

        return { success: true };
    }

    async deleteCache(appId) {
        const cachePath = await this.getCachePath(appId);

        if (await fs.pathExists(cachePath)) {
            await fs.remove(cachePath);
        }

        delete this.cache[appId];
        await this.saveCache();

        return { success: true };
    }

    async getDiskSize(dirPath) {
        let totalSize = 0;

        const calculateSize = async (dir) => {
            const items = await fs.readdir(dir, { withFileTypes: true });
            for (const item of items) {
                const itemPath = path.join(dir, item.name);
                if (item.isFile()) {
                    const stats = await fs.stat(itemPath);
                    totalSize += stats.size;
                } else if (item.isDirectory()) {
                    await calculateSize(itemPath);
                }
            }
        };

        if (await fs.pathExists(dirPath)) {
            await calculateSize(dirPath);
        }

        // Convert to GB
        return (totalSize / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    async getCacheStatus(appId) {
        await this.loadCache();
        return this.cache[appId] || { status: 'not_cached' };
    }
}

const cacheService = new CacheService();
module.exports = cacheService;

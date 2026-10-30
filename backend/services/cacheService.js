const fs = require('fs-extra');
const path = require('path');
const steamcmd = require('./steamcmd');
const { readJson, writeJson } = require('./jsonFile');
const failure = (message, status = 409) => Object.assign(new Error(message), { status });

class CacheService {
    constructor({ cacheDir = process.env.CACHE_DIR || path.join(__dirname, '../..', 'cache'), steam = steamcmd } = {}) {
        this.dir = path.resolve(cacheDir);
        this.file = path.join(this.dir, 'cache.json');
        this.steam = steam;
        this.cache = {};
        this.jobs = new Map();
        this.deleting = new Set();
        this.ready = this.init();
    }
    async init() {
        await fs.ensureDir(this.dir);
        const data = await readJson(this.file, {});
        this.cache = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        let changed = false;
        for (const entry of Object.values(this.cache)) {
            if (entry.status === 'downloading' || entry.status === 'cancelling') {
                entry.status = 'interrupted';
                entry.error = 'Download interrupted by panel restart. Retry to resume.';
                changed = true;
            }
        }
        if (changed) await this.saveCache();
    }
    async saveCache() { await writeJson(this.file, this.cache); }
    checkId(appId) {
        if (!/^\d{1,12}$/.test(String(appId))) throw failure('Invalid app ID', 400);
        return String(appId);
    }
    async listCached() { await this.ready; return Object.entries(this.cache).map(([appId, entry]) => ({ appId, ...entry })); }
    async isCached(appId) { await this.ready; return this.cache[this.checkId(appId)]?.status === 'ready'; }
    async getCachePath(appId) { return path.join(this.dir, this.checkId(appId)); }
    async getCacheStatus(appId) { await this.ready; return this.cache[this.checkId(appId)] || { status: 'not_cached' }; }

    async startDownload(appId, gameName, onProgress = () => {}) {
        await this.ready;
        appId = this.checkId(appId);
        if (this.jobs.has(appId) || this.deleting.has(appId)) throw failure('Cache operation already in progress');
        const controller = new AbortController();
        const job = { controller, completion: null, lastSaved: 0, tail: '' };
        job.completion = new Promise(resolve => { job.finish = resolve; });
        this.jobs.set(appId, job); // Reserve before the first await.
        this.cache[appId] = { name: String(gameName || appId).slice(0, 120), status: 'downloading', progress: 0,
            downloadedDate: null, lastChecked: new Date().toISOString(), diskSize: null, logs: '' };
        try { await this.saveCache(); }
        catch (err) { this.jobs.delete(appId); delete this.cache[appId]; job.finish({ success: false }); throw err; }
        this.runDownload(appId, job, onProgress).then(job.finish);
        return { success: true, status: 'downloading', appId };
    }
    async runDownload(appId, job, onProgress) {
        const entry = this.cache[appId];
        try {
            await this.steam.install(appId, await this.getCachePath(appId), chunk => {
                const text = String(chunk);
                entry.logs = Buffer.from(entry.logs + text).subarray(-15996).toString('utf8').split('\n').slice(-100).join('\n');
                const combined = job.tail + text;
                const matches = [...combined.matchAll(/progress:\s*(\d+(?:\.\d+)?)/g)];
                job.tail = combined.slice(-512);
                if (matches.length) entry.progress = Math.max(0, Math.min(100, Number(matches.at(-1)[1])));
                if (Date.now() - job.lastSaved >= 1000) {
                    job.lastSaved = Date.now();
                    this.saveCache().catch(err => console.error('Cache progress save failed:', err.message));
                }
                onProgress(text);
            }, null, { signal: job.controller.signal });
            if (job.controller.signal.aborted) throw failure('Download cancelled');
            entry.diskSize = await this.getDiskSize(await this.getCachePath(appId));
            entry.status = job.controller.signal.aborted ? 'cancelled' : 'ready';
            if (entry.status === 'ready') { entry.progress = 100; entry.downloadedDate = new Date().toISOString(); }
        } catch (err) {
            entry.status = job.controller.signal.aborted ? 'cancelled' : 'error';
            entry.error = entry.status === 'cancelled' ? 'Download cancelled. Retry to resume.' : err.message;
        } finally {
            entry.lastChecked = new Date().toISOString();
            try { await this.saveCache(); }
            catch (err) { console.error('Cache completion save failed:', err.message); }
            this.jobs.delete(appId);
        }
        return { success: entry.status === 'ready', status: entry.status };
    }
    async cancelDownload(appId) {
        await this.ready;
        appId = this.checkId(appId);
        const job = this.jobs.get(appId);
        if (!job) throw failure('No download is running');
        job.controller.abort();
        // The runner owns the final status only after SteamCMD has closed.
        await job.completion;
        return { success: true, status: this.cache[appId].status };
    }
    // Compatibility for callers that explicitly need to wait for a complete download.
    async downloadToCache(appId, gameName, onProgress) {
        await this.startDownload(appId, gameName, onProgress);
        return this.jobs.get(String(appId))?.completion || { success: this.cache[appId]?.status === 'ready' };
    }
    async copyFromCache(appId, targetPath) {
        if (!await this.isCached(appId)) throw failure(`Game ${appId} is not cached. Please download it first.`, 400);
        await fs.copy(await this.getCachePath(appId), targetPath, { overwrite: false, errorOnExist: false });
        return { success: true };
    }
    async deleteCache(appId) {
        await this.ready;
        appId = this.checkId(appId);
        if (this.jobs.has(appId) || this.deleting.has(appId)) throw failure('Cannot delete cache while an operation is running');
        this.deleting.add(appId);
        try {
            await fs.remove(await this.getCachePath(appId));
            delete this.cache[appId];
            await this.saveCache();
            return { success: true };
        } finally { this.deleting.delete(appId); }
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

}
module.exports = new CacheService();
module.exports.CacheService = CacheService;

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const serverStore = require('./serverStore');

const PLUGINS = {
    metamod: {
        name: 'Metamod: Source',
        type: 'alliedmods',
        baseUrl: 'https://mms.alliedmods.net/mmsdrop/1.12/',
        latestFile: 'mmsource-latest-windows',
        checkFile: 'addons/metamod.vdf'
    },
    sourcemod: {
        name: 'SourceMod',
        type: 'alliedmods',
        baseUrl: 'https://sm.alliedmods.net/smdrop/1.13/',
        latestFile: 'sourcemod-latest-windows',
        checkFile: 'addons/sourcemod/bin/sourcemod_mm.dll'
    },
    ulib: {
        name: 'ULib',
        type: 'direct',
        url: 'https://github.com/TeamUlysses/ulib/archive/refs/heads/master.zip',
        checkFile: 'addons/ulib/lua/ulib/init.lua'
    },
    ulx: {
        name: 'ULX',
        type: 'direct',
        url: 'https://github.com/TeamUlysses/ulx/archive/refs/heads/master.zip',
        checkFile: 'addons/ulx/lua/ulx/init.lua'
    }
};

class PluginService {
    async getAvailablePlugins(serverId) {
        const server = serverStore.get(serverId);
        if (!server) throw new Error('Server not found');

        const installPath = server.path;
        const gameDir = this.getGameDir(server.game);

        const plugins = [];
        for (const [key, config] of Object.entries(PLUGINS)) {
            const isInstalled = await fs.pathExists(path.join(installPath, gameDir, config.checkFile));
            plugins.push({
                id: key,
                name: config.name,
                installed: isInstalled
            });
        }
        return plugins;
    }

    async installPlugin(serverId, pluginId) {
        const server = serverStore.get(serverId);
        if (!server) throw new Error('Server not found');

        const pluginConfig = PLUGINS[pluginId];
        if (!pluginConfig) throw new Error('Plugin not supported');

        const installPath = server.path;
        const gameDir = this.getGameDir(server.game);
        const targetDir = path.join(installPath, gameDir);

        let downloadUrl;
        let filename;

        if (pluginConfig.type === 'alliedmods') {
            // 1. Get latest filename
            console.log(`[Plugin] Fetching latest version for ${pluginId}...`);
            const versionRes = await axios.get(pluginConfig.baseUrl + pluginConfig.latestFile);
            filename = path.basename(String(versionRes.data).trim()); // remote text: keep it a plain file name
            downloadUrl = pluginConfig.baseUrl + filename;
        } else {
            // Direct download
            downloadUrl = pluginConfig.url;
            filename = `${pluginId}.zip`;
        }

        // 2. Download file
        console.log(`[Plugin] Downloading ${filename}...`);
        const tempDir = path.join(installPath, 'temp_downloads');
        await fs.ensureDir(tempDir);
        const zipPath = path.join(tempDir, filename);

        const writer = fs.createWriteStream(zipPath);
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 3. Extract
        console.log(`[Plugin] Extracting to ${targetDir}...`);
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(targetDir, true);

        // 4. Cleanup
        await fs.remove(tempDir);
        console.log(`[Plugin] ${pluginId} installed successfully.`);

        return { success: true, message: `${pluginConfig.name} installed successfully.` };
    }

    getGameDir(game) {
        // Map game names to their directory names (e.g., "Garry's Mod" -> "garrysmod")
        // This is a simplified mapping. Ideally, this should be in the template or server config.
        const map = {
            "Garry's Mod": "garrysmod",
            "Team Fortress 2": "tf",
            "Counter-Strike: Global Offensive": "csgo",
            "Counter-Strike: Source": "cstrike",
            "Left 4 Dead 2": "left4dead2",
            "Half-Life 2: Deathmatch": "hl2mp"
        };
        return map[game] || game.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    async updateWorkshop(serverId, collectionId) {
        const server = serverStore.get(serverId);
        if (!server) throw new Error('Server not found');

        // Get API key from global settings
        const settingsStore = require('./settingsStore');
        const settings = settingsStore.getAll();
        const apiKey = settings.steamApiKey;

        // Update server args
        let args = [...server.args];

        // Remove existing workshop args
        const removeArgs = ['+host_workshop_collection', '-authkey'];
        for (let i = 0; i < args.length; i++) {
            if (removeArgs.includes(args[i])) {
                args.splice(i, 2); // Remove flag and value
                i--;
            }
        }

        // Add new args if provided
        if (collectionId) {
            args.push('+host_workshop_collection', collectionId);
        }
        if (apiKey) {
            args.push('-authkey', apiKey);
        }

        // Save server
        server.args = args;
        // Save collection ID for UI retrieval
        server.workshopCollectionId = collectionId;

        serverStore.update(server.id, server);
        return { success: true };
    }

    async searchWorkshop(apiKey, appId, query, page = 1) {
        if (!apiKey) throw new Error('Steam Web API Key is required');

        const perPage = 16;
        // IPublishedFileService/QueryFiles/v1/
        const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/`;

        try {
            const response = await axios.get(url, {
                params: {
                    key: apiKey,
                    appid: appId,
                    search_text: query,
                    numperpage: perPage,
                    page: page,
                    return_vote_data: true,
                    return_tags: true,
                    return_kv_tags: true,
                    return_previews: true,
                    return_children: true,
                    return_short_description: true,
                    query_type: 1 // k_PublishedFileQueryType_RankedByVote
                }
            });

            if (!response.data || !response.data.response || !response.data.response.publishedfiledetails) {
                return { items: [], total: 0 };
            }

            const items = response.data.response.publishedfiledetails.map(item => ({
                id: item.publishedfileid,
                title: item.title,
                preview: item.preview_url,
                author: item.app_name,
                views: item.views,
                subscriptions: item.subscriptions,
                fileSize: item.file_size,
                description: item.short_description || item.file_description || ''
            }));

            return {
                items,
                total: response.data.response.total
            };
        } catch (error) {
            console.error('Steam API Error:', error.response?.data || error.message);
            throw new Error('Failed to search Steam Workshop');
        }
    }
}

module.exports = new PluginService();

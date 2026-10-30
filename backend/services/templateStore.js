const fs = require('fs-extra');
const path = require('path');

const TEMPLATES_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'templates.json');

// Default templates for each game
const DEFAULT_TEMPLATES = {
    '4020': { // Garry's Mod
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'garrysmod', '+map', 'gm_construct', '+maxplayers', '16'],
            port: 27015,
            maxPlayers: 16,
            defaultMap: 'gm_construct'
        }
    },
    '232250': { // Team Fortress 2
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'tf', '+map', 'cp_dustbowl', '+maxplayers', '24'],
            port: 27015,
            maxPlayers: 24,
            defaultMap: 'cp_dustbowl'
        }
    },
    '740': { // CS:GO
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'csgo', '-usercon', '+game_type', '0', '+game_mode', '1', '+mapgroup', 'mg_active', '+map', 'de_dust2'],
            port: 27015,
            maxPlayers: 10,
            defaultMap: 'de_dust2'
        }
    },
    '4940': { // Counter-Strike: Source
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'cstrike', '+map', 'de_dust2', '+maxplayers', '16'],
            port: 27015,
            maxPlayers: 16,
            defaultMap: 'de_dust2'
        }
    },
    '222860': { // Left 4 Dead 2
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'left4dead2', '+map', 'c1m1_hotel'],
            port: 27015,
            maxPlayers: 4,
            defaultMap: 'c1m1_hotel'
        }
    },
    '1007': { // Half-Life 2: Deathmatch
        'Default': {
            name: 'Default',
            executable: 'srcds.exe',
            args: ['-console', '-game', 'hl2mp', '+map', 'dm_lockdown'],
            port: 27015,
            maxPlayers: 16,
            defaultMap: 'dm_lockdown'
        }
    }
};

class TemplateStore {
    constructor() {
        this.templates = {};
    }

    async load() {
        await fs.ensureFile(TEMPLATES_FILE);
        try {
            const data = await fs.readFile(TEMPLATES_FILE, 'utf8');
            this.templates = data ? JSON.parse(data) : {};

            // Merge with defaults (don't overwrite custom templates)
            for (const [gameId, gameTemplates] of Object.entries(DEFAULT_TEMPLATES)) {
                if (!this.templates[gameId]) {
                    this.templates[gameId] = {};
                }
                // Always ensure Default template exists
                if (!this.templates[gameId]['Default']) {
                    this.templates[gameId]['Default'] = gameTemplates['Default'];
                }
            }

            await this.save();
        } catch (err) {
            this.templates = DEFAULT_TEMPLATES;
            await this.save();
        }
    }

    async save() {
        await fs.writeFile(TEMPLATES_FILE, JSON.stringify(this.templates, null, 2));
    }

    /**
     * Get all templates for a specific game
     */
    getTemplates(gameId) {
        return this.templates[gameId] || {};
    }

    /**
     * Get a specific template
     */
    getTemplate(gameId, templateName) {
        return this.templates[gameId]?.[templateName] || null;
    }

    /**
     * Get all games with their template counts
     */
    getAllGames() {
        const games = {
            '4020': 'Garry\'s Mod',
            '232250': 'Team Fortress 2',
            '740': 'Counter-Strike: Global Offensive',
            '4940': 'Counter-Strike: Source',
            '222860': 'Left 4 Dead 2',
            '1007': 'Half-Life 2: Deathmatch'
        };

        return Object.entries(games).map(([id, name]) => ({
            id,
            name,
            templateCount: Object.keys(this.templates[id] || {}).length
        }));
    }

    /**
     * Save or update a template
     */
    async saveTemplate(gameId, templateName, config) {
        if (!this.templates[gameId]) {
            this.templates[gameId] = {};
        }

        this.templates[gameId][templateName] = {
            name: templateName,
            ...config
        };

        await this.save();
        return this.templates[gameId][templateName];
    }

    /**
     * Delete a custom template (cannot delete Default)
     */
    async deleteTemplate(gameId, templateName) {
        if (templateName === 'Default') {
            throw new Error('Cannot delete default template');
        }

        if (this.templates[gameId]?.[templateName]) {
            delete this.templates[gameId][templateName];
            await this.save();
            return true;
        }

        return false;
    }

    /**
     * Get default template for a game
     */
    getDefaultTemplate(gameId) {
        return this.templates[gameId]?.['Default'] || DEFAULT_TEMPLATES[gameId]?.['Default'] || null;
    }
}

const store = new TemplateStore();
store.load().catch(console.error);

module.exports = store;

const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'settings.json');

class SettingsStore {
    constructor() {
        this.settings = {
            steamApiKey: '',
            authMode: 'local', // Default to local authentication
            cfAccessTeamDomain: '',
            cfAccessAud: ''
        };
    }

    async load() {
        await fs.ensureFile(DATA_FILE);
        try {
            const data = await fs.readFile(DATA_FILE, 'utf8');
            if (data) {
                this.settings = { ...this.settings, ...JSON.parse(data) };
            }

            // Environment variable overrides (Higher priority than file)
            // Allows fixing lockout via Docker env vars
            if (process.env.AUTH_MODE) {
                console.log(`[Settings] Overriding Auth Mode via ENV: ${process.env.AUTH_MODE}`);
                this.settings.authMode = process.env.AUTH_MODE;
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }

    async save() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.settings, null, 2));
    }

    async getSettings() {
        await this.load();
        return this.settings;
    }

    async updateSettings(newSettings) {
        await this.load();
        this.settings = { ...this.settings, ...newSettings };
        await this.save();
        return this.settings;
    }

    getSteamApiKey() {
        return this.settings.steamApiKey;
    }
}

const store = new SettingsStore();
store.load().catch(console.error);

module.exports = store;

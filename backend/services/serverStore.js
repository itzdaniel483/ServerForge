const fs = require('fs-extra');
const path = require('path');
const { readJson, writeJson } = require('./jsonFile');

const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'servers.json');

class ServerStore {
    constructor() {
        this.servers = [];
    }

    async load() {
        const data = await readJson(DATA_FILE, []);
        this.servers = Array.isArray(data) ? data : [];
    }

    async save() {
        await writeJson(DATA_FILE, this.servers);
    }

    async add(serverData) {
        await this.load();
        const server = {
            id: this.generateId(),
            status: 'stopped',
            created: Date.now(),
            rconPassword: this.generateRconPassword(), // Auto-generate RCON password
            ...serverData
        };
        this.servers.push(server);
        await this.save();
        return server;
    }

    async remove(id) {
        await this.load();
        this.servers = this.servers.filter(s => s.id !== id);
        await this.save();
    }

    async updateStatus(id, status) {
        await this.load();
        const server = this.servers.find(s => s.id === id);
        if (server) {
            server.status = status;
            await this.save();
        }
    }

    async updateServerConfig(id, { executable, args }) {
        await this.load();
        const server = this.servers.find(s => s.id === id);
        if (!server) throw new Error('Server not found');

        if (executable !== undefined) server.executable = executable;
        if (args !== undefined) server.args = args;

        await this.save();
        return server;
    }

    async update(id, updates) {
        await this.load();
        const index = this.servers.findIndex(s => s.id === id);
        if (index !== -1) {
            this.servers[index] = { ...this.servers[index], ...updates };
            await this.save();
            return this.servers[index];
        }
        throw new Error('Server not found');
    }

    get(id) {
        return this.servers.find(s => s.id === id);
    }

    getAll() {
        return this.servers;
    }

    generateId() {
        return Math.random().toString(36).substr(2, 15);
    }

    generateRconPassword() {
        // Generate a secure random password
        return Math.random().toString(36).substr(2, 12) + Math.random().toString(36).substr(2, 12);
    }
}

const store = new ServerStore();
store.load().catch(console.error);

module.exports = store;

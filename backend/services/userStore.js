const fs = require('fs-extra');
const path = require('path');
const { readJson, writeJson, isCorruptWithoutBackup } = require('./jsonFile');
const bcrypt = require('bcryptjs');
const { randomUUID: uuidv4 } = require('crypto');
const { EventEmitter } = require('events');

const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'users.json');

class UserStore extends EventEmitter {
    constructor() {
        super();
        this.users = [];
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        // Never replace a damaged users file with a fresh admin: that would wipe every account.
        if (isCorruptWithoutBackup(DATA_FILE)) throw new Error(`${DATA_FILE} is corrupt and has no .bak; fix or remove it to continue`);
        const data = await readJson(DATA_FILE, []);
        this.users = Array.isArray(data) ? data : [];

        // First run: create 'admin' with ADMIN_PASSWORD, or a random password saved to data/initial-admin-password
        // (owner-only file). Never the old admin/admin default.
        if (this.users.length === 0) {
            let password = process.env.ADMIN_PASSWORD;
            if (!password || password.length < 8) {
                password = require('crypto').randomBytes(12).toString('base64url');
                const file = path.join(path.dirname(DATA_FILE), 'initial-admin-password');
                await fs.writeFile(file, password + '\n', { mode: 0o600 });
                console.log(`No users found. Created 'admin'; its password is in ${file}`);
            } else {
                console.log("No users found. Created 'admin' with ADMIN_PASSWORD.");
            }
            await this.addUser('admin', password, 'admin');
        }

        this.initialized = true;
    }

    async save() {
        await writeJson(DATA_FILE, this.users);
        this.emit('identities-changed', this.users.map(({ id, username, role, sessionVersion = 0 }) => ({ id, username, role, sessionVersion })));
    }

    async addUser(username, password, role = 'user') {
        if (typeof username !== 'string' || !/^[\w.@-]{1,32}$/.test(username)) throw new Error('Username: 1-32 letters, numbers, . _ @ or -');
        if (typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters');
        if (!['admin', 'user'].includes(role)) throw new Error('Role must be admin or user');
        // Check if user already exists
        if (this.users.find(u => u.username === username)) {
            throw new Error('Username already exists');
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const newUser = {
            id: uuidv4(),
            username,
            passwordHash,
            role,
            sessionVersion: 0,
            createdAt: new Date().toISOString()
        };

        this.users.push(newUser);
        await this.save();
        return { id: newUser.id, username: newUser.username, role: newUser.role };
    }

    async authenticate(username, password) {
        await this.init();
        const user = this.users.find(u => u.username === username);
        if (!user) {
            await bcrypt.compare(password, '$2a$10$CwTycUXWue0Thq9StjUM0uJ8DPLKXt1FYlwYpaW7d1a6X1L8YkqWa'); // same time as a real check
            return null;
        }

        const passwordHash = user.passwordHash;
        const sessionVersion = user.sessionVersion ?? 0;
        const isValid = await bcrypt.compare(password, passwordHash);
        // A rotation may complete while bcrypt yields. Never mint a new-version
        // token for credentials checked against the previous hash.
        if (!isValid || user.passwordHash !== passwordHash || (user.sessionVersion ?? 0) !== sessionVersion) return null;

        return { id: user.id, username: user.username, role: user.role, sessionVersion: user.sessionVersion ?? 0 };
    }

    async getUsers() {
        await this.init();
        return this.users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            sessionVersion: u.sessionVersion ?? 0,
            createdAt: u.createdAt
        }));
    }

    async deleteUser(id) {
        await this.init();
        const index = this.users.findIndex(u => u.id === id);
        if (index === -1) throw new Error('User not found');

        // Prevent deleting the last admin
        const user = this.users[index];
        if (user.role === 'admin') {
            const adminCount = this.users.filter(u => u.role === 'admin').length;
            if (adminCount <= 1) {
                throw new Error('Cannot delete the last admin user');
            }
        }

        this.users.splice(index, 1);
        await this.save();
    }

    async changePassword(userId, currentPassword, newPassword) {
        await this.init();
        const user = this.users.find(u => u.id === userId);
        if (!user) throw new Error('User not found');

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) throw new Error('Current password is incorrect');

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        // Update password
        user.passwordHash = passwordHash;
        user.sessionVersion = (user.sessionVersion ?? 0) + 1;
        await this.save();

        return { success: true };
    }
}

const userStore = new UserStore();
module.exports = userStore;

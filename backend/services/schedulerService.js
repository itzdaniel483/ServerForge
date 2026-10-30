// Scheduled tasks (claude, 2026-10-30). Each server can have tasks that run on a cron timetable:
// restart, start, stop, update, backup, or send a console command. Stored in DATA_DIR/tasks.json.
// The old file was a stub, so the "restart schedule" button always failed.
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { readJsonSync, writeJsonSync } = require('./jsonFile');
const cron = require('node-cron');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'tasks.json');
const TYPES = ['restart', 'start', 'stop', 'update', 'backup', 'command'];

class SchedulerService {
    constructor() {
        this.tasks = [];
        this.jobs = new Map();   // task id -> cron job
        this.runner = null;      // set by server.js: async (task) => result text
    }

    init(runner) {
        this.runner = runner || this.runner;
        this.tasks = readJsonSync(FILE, []);
        if (!Array.isArray(this.tasks)) this.tasks = [];
        for (const t of this.tasks) this.arm(t);
        console.log(`Scheduler: ${this.tasks.length} task(s) loaded`);
    }

    save() {
        writeJsonSync(FILE, this.tasks, { indent: 1 });
    }

    arm(task) {
        this.jobs.get(task.id)?.stop();
        this.jobs.delete(task.id);
        if (!task.enabled) return;
        const job = cron.schedule(task.cron, () => this.run(task.id), { timezone: process.env.TZ || 'Europe/London' });
        this.jobs.set(task.id, job);
    }

    async run(id) {
        const task = this.tasks.find(t => t.id === id);
        if (!task || !this.runner) return;
        let result;
        try { result = { ok: true, text: String(await this.runner(task) || 'Done') }; }
        catch (err) { result = { ok: false, text: err.message }; }
        task.lastRun = { at: new Date().toISOString(), ...result };
        this.save();
        return task.lastRun;
    }

    // Validate a task from the client. Returns { task } or { error }.
    validate(input, serverId) {
        const type = String(input?.type || '');
        if (!TYPES.includes(type)) return { error: 'Pick what the task does' };
        const expr = String(input?.cron || '').trim();
        if (!cron.validate(expr) || expr.split(/\s+/).length !== 5) return { error: 'That timetable is not valid (5-part cron, e.g. 0 6 * * *)' };
        // Every-minute tasks would hammer the server and SteamCMD.
        if (/^\*\s/.test(expr) || /^\*\/[1-4]\s/.test(expr)) return { error: 'Run tasks at most every 5 minutes' };
        const command = type === 'command' ? String(input?.command || '').trim() : '';
        if (type === 'command' && (!command || command.length > 200 || /[\r\n]/.test(command))) return { error: 'Enter one console command (up to 200 characters)' };
        const label = String(input?.label || '').replace(/[<>\r\n]/g, '').trim().slice(0, 60);
        return { task: { type, cron: expr, command, label, enabled: input?.enabled !== false, serverId } };
    }

    list(serverId) { return this.tasks.filter(t => !serverId || t.serverId === serverId); }

    add(fields) {
        if (this.list(fields.serverId).length >= 20) throw Object.assign(new Error('Up to 20 tasks per server'), { status: 400 });
        const task = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), lastRun: null, ...fields };
        this.tasks.push(task);
        this.save();
        this.arm(task);
        return task;
    }

    update(id, fields) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return null;
        Object.assign(task, fields);
        this.save();
        this.arm(task);
        return task;
    }

    remove(id) {
        this.jobs.get(id)?.stop();
        this.jobs.delete(id);
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(t => t.id !== id);
        if (this.tasks.length !== before) this.save();
        return this.tasks.length !== before;
    }

    removeForServer(serverId) { for (const t of this.list(serverId)) this.remove(t.id); }

    // Old single "restart schedule" setting from the Launch tab, kept working as a restart task.
    scheduleRestart(serverId, expr) {
        this.cancelSchedule(serverId);
        return this.add({ type: 'restart', cron: expr, command: '', label: 'Restart (from Launch tab)', enabled: true, serverId, legacy: true });
    }

    cancelSchedule(serverId) {
        for (const t of this.list(serverId).filter(t => t.legacy)) this.remove(t.id);
    }
}

module.exports = new SchedulerService();
module.exports.TYPES = TYPES;

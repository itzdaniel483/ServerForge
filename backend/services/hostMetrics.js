const os = require('node:os');
const fs = require('node:fs/promises');
const { SERVERS_ROOT } = require('../middleware/guard');

function cpuTotals(cpus) {
    return cpus.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}

function cpuPercent(previous, current) {
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total <= 0 || idle < 0 || idle > total) return null;
    return Math.round(Math.max(0, Math.min(100, 100 * (1 - idle / total))) * 10) / 10;
}

let previous = cpuTotals(os.cpus());
let cpu = null;
setInterval(() => {
    const current = cpuTotals(os.cpus());
    cpu = cpuPercent(previous, current);
    previous = current;
}, 2000).unref();

async function snapshot() {
    const total = os.totalmem();
    let disk = { used: null, total: null };
    try {
        const stat = await fs.statfs(SERVERS_ROOT);
        const size = stat.bsize * stat.blocks;
        const used = stat.bsize * (stat.blocks - stat.bfree);
        if (Number.isSafeInteger(size) && Number.isSafeInteger(used) && used >= 0 && used <= size) disk = { used, total: size };
    } catch { /* Missing volume or unsupported statfs: UI displays unavailable. */ }
    return { cpuPercent: cpu, memory: { used: Math.max(0, total - os.freemem()), total }, disk };
}

module.exports = { snapshot, cpuPercent, cpuTotals };

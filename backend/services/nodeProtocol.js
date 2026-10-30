const { randomUUID } = require('node:crypto');

const ACTIONS = Object.freeze(['servers.list', 'host', 'catalog', 'server.status', 'console.read', 'power.start', 'power.stop',
    'console.command', 'files.read', 'files.write', 'backups.list', 'backups.create', 'backups.restore', 'backups.delete',
    'tasks.list', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.run', 'settings.read', 'settings.write', 'config.write', 'launch.read', 'launch.preview', 'launch.write', 'update.chunk', 'update.stage', 'update.status',
    'schedule.write', 'update', 'delete', 'cache.list', 'cache.status', 'cache.download', 'cache.cancel', 'cache.delete',
    'cache.copy', 'templates.list', 'templates.read', 'templates.write', 'templates.delete', 'install']);
const MAX_PACKET_BYTES = 8 * 1024 * 1024;
const RAW_CHUNK_BYTES = 24 * 1024; // At most 32 KiB of base64, plus a small JSON envelope.
const MAX_CHUNKS = Math.ceil(MAX_PACKET_BYTES / RAW_CHUNK_BYTES);
const problem = message => Object.assign(new Error(message), { code: 'NODE_PROTOCOL_INVALID' });

function sendPacket(ws, object) {
    const json = JSON.stringify(object);
    if (typeof json !== 'string') throw problem('A JSON packet is required');
    const bytes = Buffer.from(json);
    if (bytes.length > MAX_PACKET_BYTES) throw problem('Node packet exceeds 8 MiB');
    if (ws.readyState !== 1) throw problem('Node connection is closed');
    if ((ws.bufferedAmount || 0) > 16 * 1024 * 1024) throw problem('Node send queue is full');
    if (bytes.length <= 48 * 1024) { ws.send(json); return; }
    const id = randomUUID();
    const total = Math.ceil(bytes.length / RAW_CHUNK_BYTES);
    for (let index = 0; index < total; index++) {
        ws.send(JSON.stringify({ type: 'packet.chunk', id, index, total,
            data: bytes.subarray(index * RAW_CHUNK_BYTES, (index + 1) * RAW_CHUNK_BYTES).toString('base64') }));
    }
}

function createDecoder(onPacket, { onError = () => {}, ttlMs = 30_000 } = {}) {
    const pending = new Map();
    let buffered = 0, closed = false;
    const drop = id => {
        const packet = pending.get(id);
        if (!packet) return;
        clearTimeout(packet.timer); buffered -= packet.size; pending.delete(id);
    };
    const parse = raw => {
        let packet;
        try { packet = JSON.parse(raw); } catch { throw problem('Invalid node JSON'); }
        if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw problem('Invalid node packet');
        return packet;
    };
    return {
        accept(raw) {
            if (closed) throw problem('Node decoder is closed');
            if (Buffer.byteLength(raw) > 64 * 1024) throw problem('Node frame exceeds 64 KiB');
            const message = parse(raw.toString());
            if (message.type !== 'packet.chunk') return onPacket(message);
            const { id, index, total, data } = message;
            if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id) || !Number.isInteger(total) || total < 2 || total > MAX_CHUNKS ||
                !Number.isInteger(index) || index < 0 || index >= total || typeof data !== 'string' || data.length === 0 || data.length > 32768 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
                if (typeof id === 'string') drop(id);
                throw problem('Invalid node chunk');
            }
            let packet = pending.get(id);
            if (!packet) {
                if (pending.size >= 4) throw problem('Too many fragmented node packets');
                packet = { total, chunks: new Map(), size: 0 };
                packet.timer = setTimeout(() => { drop(id); onError(problem('Node packet assembly timed out')); }, ttlMs);
                packet.timer.unref?.(); pending.set(id, packet);
            }
            if (packet.total !== total || packet.chunks.has(index)) { drop(id); throw problem('Conflicting node chunks'); }
            const chunk = Buffer.from(data, 'base64');
            if (chunk.toString('base64') !== data || buffered + chunk.length > MAX_PACKET_BYTES) { drop(id); throw problem('Node packet assembly exceeds bounds'); }
            packet.chunks.set(index, chunk); packet.size += chunk.length; buffered += chunk.length;
            if (packet.chunks.size !== total) return;
            const bytes = Buffer.concat(Array.from({ length: total }, (_, i) => packet.chunks.get(i)), packet.size);
            drop(id);
            const decoded = parse(bytes.toString('utf8'));
            if (decoded.type === 'packet.chunk') throw problem('Nested node chunks are forbidden');
            return onPacket(decoded);
        },
        close() { closed = true; for (const id of pending.keys()) drop(id); },
    };
}

module.exports = { ACTIONS, MAX_PACKET_BYTES, sendPacket, createDecoder };

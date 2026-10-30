// Nodes page (claude, multi-node phase 1, 2026-10-30; UI v3 table). Admin-only. Lists the hub ("Local host") and
// paired nodes, adds a node with a one-time enrolment bundle, approves a pending node only after the
// admin confirms its key fingerprint, and removes nodes. API: codex, docs/MULTI-NODE.md (#3359).
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Network, Plus, Trash2, Download, X, ShieldCheck, Monitor, Server as ServerIcon, Clock, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { Button, Card, Notice, PageHeader, Meter } from '../ui';
import { errorText } from '../api';

const osName = os => (os === 'win32' ? 'Windows' : os === 'linux' ? 'Linux' : os === 'darwin' ? 'macOS' : os || 'Unknown');
const OsIcon = ({ os, size = 18 }) => (os === 'win32' ? <Monitor size={size} /> : <ServerIcon size={size} />);
// Fingerprints are long hex/base64 strings; groups of 4 make them comparable by eye.
const groupPrint = fp => String(fp || '').replace(/[^0-9a-zA-Z+/=]/g, '').match(/.{1,4}/g)?.join(' ') || '—';
const pct = (u, t) => (u != null && t ? (u / t) * 100 : null);
const ago = t => {
    if (!t) return 'never';
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export default function Nodes() {
    const [nodes, setNodes] = useState(null);
    const [pending, setPending] = useState([]);
    const [config, setConfig] = useState(null);
    const [error, setError] = useState('');
    const [enrolment, setEnrolment] = useState(null);

    const load = useCallback(async () => {
        try {
            const [n, p, c] = await Promise.all([axios.get('/api/nodes'), axios.get('/api/nodes/pending'), axios.get('/api/nodes/config')]);
            setNodes(n.data); setPending(p.data); setConfig(c.data);
        } catch (err) { setError(errorText(err)); }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
        const t = setInterval(load, 4000);
        return () => clearInterval(t);
    }, [load]);

    async function addNode() {
        setError('');
        try { setEnrolment((await axios.post('/api/nodes/enrol')).data); load(); } catch (err) { setError(errorText(err)); }
    }
    async function remove(node) {
        if (!window.confirm(`Remove ${node.name}? Its key is revoked and it disconnects now. Its game servers keep running on that machine.`)) return;
        try { await axios.delete(`/api/nodes/${encodeURIComponent(node.id)}`); load(); } catch (err) { setError(errorText(err)); }
    }

    if (!nodes) return <div className="text-gray-400">{error || 'Loading…'}</div>;
    const remote = nodes.filter(n => n.id !== 'local');

    return (
        <div className="space-y-4">
            <PageHeader title="Nodes" sub="Other ServerForge machines joined to this panel, for example a Windows PC for Windows-only games."
                actions={<Button variant="primary" onClick={addNode} disabled={!config?.enabled || !!enrolment}><Plus size={15} />Add node</Button>} />

            {error && <Notice>{error}</Notice>}
            {config && !config.enabled && (
                <Notice tone="ok">Node connections are switched off on this panel. They're turned on during deployment, once a Windows PC is ready to join.</Notice>
            )}

            {enrolment && <EnrolPanel enrolment={enrolment} onClose={() => { setEnrolment(null); load(); }} onError={setError} />}

            {pending.map(c => <PendingCard key={c.id} candidate={c} onDone={load} onError={setError} />)}

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                        <thead><tr><th className="th w-28">Status</th><th className="th">Machine</th><th className="th hidden md:table-cell w-36">CPU</th><th className="th hidden md:table-cell w-36">RAM</th><th className="th hidden lg:table-cell w-36">Disk</th><th className="th hidden sm:table-cell">Connection</th><th className="th text-right">Actions</th></tr></thead>
                        <tbody>{nodes.map(n => <NodeRow key={n.id} node={n} onRemove={remove} />)}</tbody>
                    </table>
                </div>
                {remote.length === 0 && pending.length === 0 && !enrolment && (
                    <div className="px-3 py-3 text-xs text-gray-500 border-t border-gray-800">No other machines yet. Use Add node to join one.</div>
                )}
            </Card>
        </div>
    );
}

function NodeRow({ node, onRemove }) {
    const local = node.id === 'local';
    const h = node.host || {};
    const meters = [
        { label: 'CPU', v: h.cpuPercent, cls: 'hidden md:table-cell' },
        { label: 'RAM', v: pct(h.memory?.used, h.memory?.total), cls: 'hidden md:table-cell' },
        { label: 'Disk', v: pct(h.disk?.used, h.disk?.total), cls: 'hidden lg:table-cell' },
    ];
    return (
        <tr className="hover:bg-gray-800/40">
            <td className="td"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${node.online ? 'text-go-300' : 'text-gray-400'}`}><span className={`w-2 h-2 rounded-full ${node.online ? 'bg-go-400' : 'bg-gray-500'}`} />{node.online ? 'Online' : 'Offline'}</span></td>
            <td className="td">
                <div className="flex items-center gap-2.5">
                    <span className="text-gray-400"><OsIcon os={node.os} size={15} /></span>
                    <span className="min-w-0">
                        <span className="flex items-center gap-2"><span className="font-medium text-white truncate">{node.name}</span>{local && <span className="h-4 px-1 inline-flex items-center rounded-sm border border-accent-500/50 text-[10px] font-medium text-accent-300">This panel</span>}</span>
                        <span className="block text-xs text-gray-500">{osName(node.os)}{node.version ? ` · v${node.version}` : ''}</span>
                    </span>
                </div>
            </td>
            {meters.map(m => (
                <td key={m.label} className={`td ${m.cls}`}>
                    {m.v == null ? <span className="text-gray-600">—</span> : (
                        <div className="w-28"><div className="text-xs text-gray-200 tabular-nums">{Math.round(m.v)}%</div><Meter value={m.v} label={`${node.name} ${m.label}`} className="mt-1" /></div>
                    )}
                </td>
            ))}
            <td className="td hidden sm:table-cell text-xs text-gray-400"><span className="inline-flex items-center gap-1.5"><Clock size={12} />{local ? 'Always connected' : node.online ? 'Connected' : `Last seen ${ago(node.lastSeen)}`}</span></td>
            <td className="td text-right">{!local && <Button size="sm" variant="quiet" onClick={() => onRemove(node)} aria-label={`Remove ${node.name}`}><Trash2 size={13} />Remove</Button>}</td>
        </tr>
    );
}

// The one-time bundle is shown once. It's offered as a file download (never shown as text or
// copied to the clipboard) because the node client reads it from a private file.
function EnrolPanel({ enrolment, onClose, onError }) {
    const [left, setLeft] = useState(() => Math.max(0, enrolment.expiresAt - Date.now()));
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        const t = setInterval(() => setLeft(Math.max(0, enrolment.expiresAt - Date.now())), 1000);
        return () => clearInterval(t);
    }, [enrolment.expiresAt]);

    function download() {
        const blob = new Blob([JSON.stringify(enrolment, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: 'serverforge-enrolment.json' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setSaved(true);
    }
    async function cancel() {
        try { await axios.delete(`/api/nodes/enrol/${encodeURIComponent(enrolment.codeId)}`); } catch (err) { onError(errorText(err)); }
        onClose();
    }
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    const expired = left === 0;

    return (
        <Card className="p-4 ring-1 ring-accent-400/40 space-y-5">
            <div className="flex items-start gap-3">
                <Network size={22} className="text-accent-300 mt-0.5" />
                <div className="flex-1">
                    <div className="text-xl font-semibold text-white">Add a node</div>
                    <div className={`text-sm font-semibold ${expired ? 'text-stop-300' : 'text-gray-400'}`}>{expired ? 'This code has expired. Start again.' : `Code expires in ${mm}:${String(ss).padStart(2, '0')}. It works once.`}</div>
                </div>
                <Button size="sm" variant="quiet" onClick={saved || expired ? onClose : cancel} aria-label={saved || expired ? 'Close' : 'Cancel this code'}><X size={16} />{saved || expired ? 'Close' : 'Cancel code'}</Button>
            </div>
            <ol className="grid md:grid-cols-3 gap-3 text-sm">
                <li className="glass rounded-xl p-4 space-y-3">
                    <div className="font-bold text-white">1. Save the enrolment file</div>
                    <div className="text-gray-400">Copy it privately to the new machine (USB stick or a private share). Never paste it into chat.</div>
                    <Button variant="primary" size="sm" onClick={download} disabled={expired}><Download size={15} />{saved ? 'Download again' : 'Download file'}</Button>
                </li>
                <li className="glass rounded-xl p-4 space-y-2">
                    <div className="font-bold text-white">2. Join from the new machine</div>
                    <div className="text-gray-400">In its ServerForge <span className="font-mono text-gray-200">backend</span> folder run:</div>
                    <div className="font-mono text-xs text-gray-100 bg-gray-950/80 rounded-lg p-2 break-all">npm run node:pair -- path/to/serverforge-enrolment.json</div>
                    <div className="text-gray-400">It prints a fingerprint.</div>
                </li>
                <li className="glass rounded-xl p-4 space-y-2">
                    <div className="font-bold text-white">3. Approve it here</div>
                    <div className="text-gray-400">It appears below as waiting. Check the fingerprint matches, tick, approve. Then delete the file.</div>
                </li>
            </ol>
            <div className="text-xs text-gray-500">Hub fingerprint (the new machine checks this): <span className="font-mono text-gray-300">{groupPrint(enrolment.hubFingerprint)}</span></div>
        </Card>
    );
}

function PendingCard({ candidate, onDone, onError }) {
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const left = Math.max(0, candidate.expiresAt - Date.now());
    async function approve() {
        setBusy(true);
        try { await axios.post(`/api/nodes/${encodeURIComponent(candidate.id)}/approve`, { fingerprintConfirmed: true }); onDone(); }
        catch (err) { onError(errorText(err)); }
        finally { setBusy(false); }
    }
    return (
        <Card className="p-4 ring-1 ring-warn-500/40 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <ShieldCheck size={22} className="text-warn-300" />
                <div className="text-lg font-semibold text-white">A machine wants to join</div>
                <span className="text-sm text-gray-400">expires in {Math.ceil(left / 60000)} min</span>
            </div>
            <div className="text-sm text-gray-300">
                Reported by the machine: <b className="text-white">{candidate.name || 'unnamed'}</b> · {osName(candidate.os)}{candidate.version ? ` · v${candidate.version}` : ''}
                {!candidate.proved && <span className="ml-2 text-stop-300 font-semibold">Key not proven yet. Wait for it to connect.</span>}
            </div>
            <div>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">Its fingerprint</div>
                <div className="font-mono text-xl sm:text-lg font-bold tracking-wider text-white break-all">{groupPrint(candidate.fingerprint)}</div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" className="w-5 h-5 accent-accent-500" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                <span className="text-sm font-semibold text-gray-100">The fingerprint matches what the new machine shows</span>
            </label>
            <Button variant="primary" onClick={approve} disabled={!confirmed || !candidate.proved || busy}><ShieldCheck size={17} />Approve node</Button>
        </Card>
    );
}

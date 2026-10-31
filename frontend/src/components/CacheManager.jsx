// Download cache (claude, UI v2 2026-10-30). Games come from the catalogue (only ones this host can
// run). Each row shows its state from codex's cache API: progress while downloading, Cancel, and
// Resume after a cancel, a failure or a panel restart (SteamCMD carries on from what's on disk).
// With other machines joined, a picker chooses whose cache to manage: each machine keeps its own
// (a Windows download can't feed a Linux install), so every call carries ?node= for remote ones.
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Download, Trash2, X, RotateCw, ChevronDown, HardDrive, Search } from 'lucide-react';
import { Button, Card, Meter, Notice, GameArt } from '../ui';
import { getSocket, errorText, stripAnsi } from '../api';
import { OsIcon } from '../nodes';
import { osLabel } from '../nodeUtils';

const BUSY = ['downloading', 'updating', 'cancelling', 'deleting'];
const RESUMABLE = ['interrupted', 'cancelled', 'error'];

export default function CacheManager() {
    const [games, setGames] = useState([]);
    const [cache, setCache] = useState({});
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('');
    const [pending, setPending] = useState({});
    const [nodes, setNodes] = useState([]);
    const [nodeId, setNodeId] = useState('local');
    const q = nodeId === 'local' ? '' : `?node=${encodeURIComponent(nodeId)}`;

    useEffect(() => { axios.get('/api/nodes').then(r => setNodes(r.data)).catch(() => setNodes([])); }, []);

    const load = useCallback(async () => {
        try {
            const r = await axios.get(`/api/cache/list${q}`);
            setCache(Object.fromEntries(r.data.cached.map(c => [String(c.appId), c])));
        } catch (err) {
            setError(errorText(err));
        }
    }, [q]);

    useEffect(() => {
        setCache({}); setGames([]);
        axios.get(`/api/games${q}`).then(r => setGames(r.data.games.filter(g => g.supported && g.appId))).catch(err => setError(errorText(err)));
        load();
        const t = setInterval(load, 2000);
        return () => clearInterval(t);
    }, [load]);

    async function run(appId, fn) {
        setPending(p => ({ ...p, [appId]: true }));
        setError('');
        try { await fn(); } catch (err) { setError(errorText(err)); } finally {
            setPending(p => ({ ...p, [appId]: false }));
            load();
        }
    }
    const download = g => run(g.appId, () => axios.post(`/api/cache/download/${g.appId}${q}`, { gameName: g.name }));
    const cancel = g => run(g.appId, () => axios.post(`/api/cache/${g.appId}/cancel${q}`));
    const remove = g => window.confirm(`Delete the cached copy of ${g.name}?`) && run(g.appId, () => axios.delete(`/api/cache/${g.appId}${q}`));
    // Only machines that are online and offer cache actions (this panel always does).
    const usable = n => n.id === 'local' || (n.online && (n.actions || []).includes('cache'));

    const needle = filter.trim().toLowerCase();
    // Active and cached games first, then the rest by name.
    const rank = g => { const s = cache[g.appId]?.status; return BUSY.includes(s) ? 0 : RESUMABLE.includes(s) ? 1 : s === 'ready' ? 2 : 3; };
    const shown = games.filter(g => !needle || g.name.toLowerCase().includes(needle))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const ready = Object.values(cache).filter(c => c.status === 'ready').length;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-gray-300 mr-auto">
                    <HardDrive size={18} className="text-accent-300" />
                    <span>Pre-download a game once, then new servers copy it instead of downloading again. <b className="text-white">{ready}</b> cached.</span>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a game" aria-label="Find a game"
                        className="w-full h-8 pl-10 pr-4 rounded-xl bg-gray-900 border border-gray-800 text-white placeholder-gray-500 focus:outline-none focus:border-accent-400" />
                </div>
            </div>
            {nodes.length > 1 && (
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Machine">
                    <span className="text-sm font-semibold text-gray-300 mr-1">Cache on</span>
                    {nodes.map(n => (
                        <button key={n.id} role="radio" aria-checked={nodeId === n.id} disabled={!usable(n)} onClick={() => setNodeId(n.id)}
                            title={usable(n) ? '' : n.online ? "This machine can't manage a cache yet" : 'This machine is offline'}
                            className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold ring-1 transition disabled:opacity-40 disabled:cursor-not-allowed ${nodeId === n.id ? 'bg-accent-500/20 text-white ring-accent-400' : 'bg-gray-900 text-gray-300 ring-gray-700 hover:text-white'}`}>
                            <OsIcon os={n.os} size={15} />{n.id === 'local' ? 'This panel' : n.name}
                            <span className="text-xs font-medium text-gray-400">{osLabel(n.os)}</span>
                        </button>
                    ))}
                </div>
            )}
            {error && <Notice>{error}</Notice>}
            <div className="grid gap-3">
                {shown.map(g => <CacheRow key={`${nodeId}-${g.appId}`} game={g} entry={cache[g.appId]} pending={pending[g.appId]} nodeId={nodeId} onDownload={download} onCancel={cancel} onDelete={remove} />)}
                {games.length > 0 && shown.length === 0 && <div className="text-gray-400 py-6">No games match.</div>}
            </div>
        </div>
    );
}

function CacheRow({ game, entry, pending, nodeId, onDownload, onCancel, onDelete }) {
    const status = entry?.status || 'not_cached';
    const busy = BUSY.includes(status);
    const [showLog, setShowLog] = useState(false);
    const [log, setLog] = useState('');

    // Live SteamCMD output for this game while the log is open.
    useEffect(() => {
        if (!showLog) return undefined;
        const socket = getSocket();
        const onLine = d => setLog(l => (l + stripAnsi(d)).slice(-20000));
        // Remote machines stream on cache-download-<nodeId>:<appId>; local keeps cache-download-<appId>.
        const event = nodeId === 'local' ? `cache-download-${game.appId}` : `cache-download-${nodeId}:${game.appId}`;
        socket.on(event, onLine);
        return () => socket.off(event, onLine);
    }, [showLog, game.appId, nodeId]);

    const label = {
        downloading: `Downloading ${Math.round(entry?.progress || 0)}%`,
        updating: `Updating ${Math.round(entry?.progress || 0)}%`,
        cancelling: 'Cancelling…',
        deleting: 'Deleting…',
        ready: `Cached${entry?.diskSize ? ` · ${entry.diskSize}` : ''}${entry?.downloadedDate ? ` · updated ${new Date(entry.downloadedDate).toLocaleDateString()}` : ''}`,
        interrupted: 'Interrupted',
        cancelled: 'Cancelled',
        error: 'Failed',
        not_cached: 'Not cached',
    }[status] || status;
    const tone = status === 'ready' ? 'text-go-300' : RESUMABLE.includes(status) ? 'text-warn-300' : busy ? 'text-accent-200' : 'text-gray-400';

    return (
        <Card className={`overflow-hidden ${busy ? 'ring-1 ring-accent-400/40' : RESUMABLE.includes(status) ? 'ring-1 ring-warn-500/30' : ''}`}>
            <div className="flex flex-wrap items-center gap-4 p-3 pr-4">
                <GameArt gameId={game.id} name={game.name} className="w-32 h-[60px] rounded-xl shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="font-bold text-white truncate">{game.name}</div>
                    <div className={`text-sm font-semibold ${tone}`}>{label}</div>
                    {RESUMABLE.includes(status) && entry?.error && <div className="text-xs text-gray-400 truncate">{entry.error}</div>}
                </div>
                <div className="flex items-center gap-2">
                    {busy && <Button size="sm" variant="quiet" onClick={() => setShowLog(s => !s)} aria-expanded={showLog}>Log<ChevronDown size={15} className={showLog ? 'rotate-180' : ''} /></Button>}
                    {(status === 'downloading' || status === 'updating') && <Button size="sm" variant="stop" disabled={pending} onClick={() => onCancel(game)}><X size={15} />Cancel</Button>}
                    {RESUMABLE.includes(status) && <Button size="sm" variant="primary" disabled={pending} onClick={() => onDownload(game)}><RotateCw size={15} />Resume</Button>}
                    {status === 'not_cached' && <Button size="sm" variant="primary" disabled={pending} onClick={() => onDownload(game)}><Download size={15} />Download</Button>}
                    {status === 'ready' && <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDownload(game)} title="Get the latest version from Steam"><RotateCw size={15} />Update</Button>}
                    {(status === 'ready' || RESUMABLE.includes(status)) && <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(game)} title="Delete cached files" aria-label={`Delete cached ${game.name}`}><Trash2 size={15} /></Button>}
                </div>
            </div>
            {(status === 'downloading' || status === 'updating') && <Meter value={entry?.progress || 0} label={`${game.name} download`} className="mx-4 mb-3" />}
            {busy && showLog && (
                <pre className="mx-4 mb-4 h-48 overflow-auto rounded-xl bg-gray-950/80 border border-gray-800 p-3 font-mono text-xs text-gray-300 whitespace-pre-wrap">{log || 'Waiting for SteamCMD output…'}</pre>
            )}
        </Card>
    );
}

// Download cache (claude, UI v2 2026-10-30). Games come from the catalogue (only ones this host can
// run). Each row shows its state from codex's cache API: progress while downloading, Cancel, and
// Resume after a cancel, a failure or a panel restart (SteamCMD carries on from what's on disk).
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Download, Trash2, X, RotateCw, ChevronDown, HardDrive, Search } from 'lucide-react';
import { Button, Card, Meter, Notice, GameArt } from '../ui';
import { getSocket, errorText, stripAnsi } from '../api';

const BUSY = ['downloading', 'cancelling', 'deleting'];
const RESUMABLE = ['interrupted', 'cancelled', 'error'];

export default function CacheManager() {
    const [games, setGames] = useState([]);
    const [cache, setCache] = useState({});
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('');
    const [pending, setPending] = useState({});

    const load = useCallback(async () => {
        try {
            const r = await axios.get('/api/cache/list');
            setCache(Object.fromEntries(r.data.cached.map(c => [String(c.appId), c])));
        } catch (err) {
            setError(errorText(err));
        }
    }, []);

    useEffect(() => {
        axios.get('/api/games').then(r => setGames(r.data.games.filter(g => g.supported && g.appId))).catch(err => setError(errorText(err)));
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
    const download = g => run(g.appId, () => axios.post(`/api/cache/download/${g.appId}`, { gameName: g.name }));
    const cancel = g => run(g.appId, () => axios.post(`/api/cache/${g.appId}/cancel`));
    const remove = g => window.confirm(`Delete the cached copy of ${g.name}?`) && run(g.appId, () => axios.delete(`/api/cache/${g.appId}`));

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
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[.03] border border-white/[.08] text-white placeholder-gray-500 focus:outline-none focus:border-accent-400" />
                </div>
            </div>
            {error && <Notice>{error}</Notice>}
            <div className="grid gap-3">
                {shown.map(g => <CacheRow key={g.appId} game={g} entry={cache[g.appId]} pending={pending[g.appId]} onDownload={download} onCancel={cancel} onDelete={remove} />)}
                {games.length > 0 && shown.length === 0 && <div className="text-gray-400 py-6">No games match.</div>}
            </div>
        </div>
    );
}

function CacheRow({ game, entry, pending, onDownload, onCancel, onDelete }) {
    const status = entry?.status || 'not_cached';
    const busy = BUSY.includes(status);
    const [showLog, setShowLog] = useState(false);
    const [log, setLog] = useState('');

    // Live SteamCMD output for this game while the log is open.
    useEffect(() => {
        if (!showLog) return undefined;
        const socket = getSocket();
        const onLine = d => setLog(l => (l + stripAnsi(d)).slice(-20000));
        socket.on(`cache-download-${game.appId}`, onLine);
        return () => socket.off(`cache-download-${game.appId}`, onLine);
    }, [showLog, game.appId]);

    const label = {
        downloading: `Downloading ${Math.round(entry?.progress || 0)}%`,
        cancelling: 'Cancelling…',
        deleting: 'Deleting…',
        ready: `Cached${entry?.diskSize ? ` · ${entry.diskSize}` : ''}${entry?.downloadedDate ? ` · ${new Date(entry.downloadedDate).toLocaleDateString()}` : ''}`,
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
                    {status === 'downloading' && <Button size="sm" variant="stop" disabled={pending} onClick={() => onCancel(game)}><X size={15} />Cancel</Button>}
                    {RESUMABLE.includes(status) && <Button size="sm" variant="primary" disabled={pending} onClick={() => onDownload(game)}><RotateCw size={15} />Resume</Button>}
                    {status === 'not_cached' && <Button size="sm" variant="primary" disabled={pending} onClick={() => onDownload(game)}><Download size={15} />Download</Button>}
                    {(status === 'ready' || RESUMABLE.includes(status)) && <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(game)} title="Delete cached files" aria-label={`Delete cached ${game.name}`}><Trash2 size={15} /></Button>}
                </div>
            </div>
            {status === 'downloading' && <Meter value={entry?.progress || 0} label={`${game.name} download`} className="mx-4 mb-3" />}
            {busy && showLog && (
                <pre className="mx-4 mb-4 h-48 overflow-auto rounded-xl bg-gray-950/80 border border-white/[.06] p-3 font-mono text-xs text-gray-300 whitespace-pre-wrap">{log || 'Waiting for SteamCMD output…'}</pre>
            )}
        </Card>
    );
}

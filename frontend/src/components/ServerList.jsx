import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Play, Square, RotateCw, Server as ServerIcon, Plus, ArrowRight, Activity, Users, AlertTriangle, Search } from 'lucide-react';
import { Button, Card, Status, Stat, Empty, Notice, PageHeader, Meter, GameArt } from '../ui';
import { errorText } from '../api';
import { NodeBadge } from '../nodes';
import { can, isRemote, nodeOffline } from '../nodeUtils';

// Servers home (claude, UI v2 2026-10-30): totals, filter + search, then game-art cards.
// Actions are always visible (they used to appear only on hover, so touch screens never saw them).
function ServerList({ onOpen, onInstall, isAdmin }) {
    const [servers, setServers] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState({});
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [node, setNode] = useState('all');

    const load = useCallback(async () => {
        try {
            setServers((await axios.get('/api/servers')).data);
            setError('');
        } catch (err) {
            setError(errorText(err));
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
    }, [load]);

    async function act(id, steps) {
        setBusy(b => ({ ...b, [id]: true }));
        try {
            for (const s of steps) {
                await axios.post(`/api/server/${s}`, { id });
                if (steps.length > 1) await new Promise(r => setTimeout(r, 2000));   // let the port free up before restarting
            }
            setError('');
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(b => ({ ...b, [id]: false }));
            load();
        }
    }

    if (!servers) return <div className="text-gray-400">{error || 'Loading…'}</div>;

    const online = servers.filter(s => s.status === 'running' && !nodeOffline(s));
    // Player counts come from game queries and can be unknown (null); never show unknown as 0.
    const known = online.filter(s => s.players !== null && s.players !== undefined);
    const players = known.length ? known.reduce((n, s) => n + Number(s.players), 0) : null;
    const needle = search.trim().toLowerCase();
    // Machines appear only once another node has servers; until then the page looks as it always did.
    const multi = servers.some(isRemote);
    const machines = multi ? [...new Map(servers.map(s => [s.nodeId || 'local', isRemote(s) ? (s.nodeName || 'Other machine') : 'This panel'])).entries()] : [];
    const shown = servers.filter(s => (filter === 'all' || (filter === 'online') === (s.status === 'running'))
        && (node === 'all' || (s.nodeId || 'local') === node)
        && (!needle || `${s.name} ${s.game} ${s.nodeName || ''}`.toLowerCase().includes(needle)));

    return (
        <div className="space-y-6">
            <PageHeader title="Servers" sub={servers.length ? `${online.length} of ${servers.length} online` : 'Install your first game server to get started.'}
                actions={isAdmin && servers.length > 0 && <Button variant="primary" onClick={onInstall}><Plus size={18} />New server</Button>} />

            {error && <Notice>{error}</Notice>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Stat icon={ServerIcon} label="Servers" value={servers.length} />
                <Stat icon={Activity} label="Online" value={online.length} tone={online.length ? 'text-go-300' : 'text-white'} meter={servers.length ? (online.length / servers.length) * 100 : 0} />
                <Stat icon={Users} label="Players" value={players ?? '—'}
                    sub={!online.length ? 'no servers running' : known.length < online.length ? `${online.length - known.length} server${online.length - known.length > 1 ? 's' : ''} not reporting` : 'across online servers'} />
                <Stat icon={AlertTriangle} label="Need attention" value={servers.filter(s => s.status === 'failed').length}
                    tone={servers.some(s => s.status === 'failed') ? 'text-stop-300' : 'text-white'} sub="failed installs" />
            </div>

            {servers.length === 0 ? (
                <Empty icon={<ServerIcon size={40} />} title="No servers yet" sub="Pick a game, name it, and ServerForge downloads and sets it up."
                    action={isAdmin && <Button variant="primary" size="lg" onClick={onInstall}><Plus size={18} />Install a server</Button>} />
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex p-1 rounded-xl bg-white/[.03] border border-white/[.06]">
                            {['all', 'online', 'offline'].map(f => (
                                <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                                    className={`h-9 px-4 rounded-lg text-sm font-semibold capitalize ${filter === f ? 'bg-white/[.1] text-white' : 'text-gray-400 hover:text-white'}`}>{f}</button>
                            ))}
                        </div>
                        {multi && (
                            <select value={node} onChange={e => setNode(e.target.value)} aria-label="Machine"
                                className="h-11 px-3 rounded-xl bg-white/[.03] border border-white/[.08] text-white focus:outline-none focus:border-accent-400 [&>option]:bg-gray-900">
                                <option value="all">All machines</option>
                                {machines.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                            </select>
                        )}
                        <div className="relative flex-1 min-w-[220px] max-w-md">
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a server" aria-label="Find a server"
                                className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[.03] border border-white/[.08] text-white placeholder-gray-500 focus:outline-none focus:border-accent-400" />
                        </div>
                    </div>

                    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))]">
                        {shown.map(s => <ServerCard key={s.id} s={s} multi={multi} isAdmin={isAdmin} busy={busy[s.id]} act={act} onOpen={onOpen} />)}
                        {shown.length === 0 && <div className="text-gray-400 py-10">No servers match.</div>}
                    </div>
                </>
            )}
        </div>
    );
}

function ServerCard({ s, multi, isAdmin, busy, act, onOpen }) {
    const offline = nodeOffline(s);
    const on = s.status === 'running' && !offline;
    const canPower = (isAdmin || (s.perms || []).includes('power')) && s.status !== 'installing' && s.status !== 'failed' && can(s, 'power');
    const hasPlayers = on && s.maxPlayers && s.players !== null && s.players !== undefined;
    return (
        <Card className={`overflow-hidden flex flex-col transition-all hover:-translate-y-0.5 ${on ? 'ring-1 ring-go-500/40 shadow-[0_12px_40px_-16px_rgba(34,197,94,.45)]' : s.status === 'failed' ? 'ring-1 ring-stop-500/40' : 'hover:shadow-glow'}`}>
            <button onClick={() => onOpen(s)} className="text-left" aria-label={`Open ${s.name}`}>
                <GameArt gameId={s.gameId} name={s.game} className="h-36" imgClassName={`object-center ${offline ? 'grayscale opacity-50' : ''}`}>
                    {multi && <div className="absolute top-3 left-3"><NodeBadge s={s} /></div>}
                    <div className="absolute top-3 right-3"><Status status={offline ? 'nodeoffline' : s.status} /></div>
                    <div className="absolute bottom-3 left-4 right-4">
                        <div className="text-xl font-extrabold text-white truncate drop-shadow">{s.name || 'Unnamed server'}</div>
                        <div className="text-sm font-medium text-gray-300 truncate">{s.game || 'Unknown game'}</div>
                    </div>
                </GameArt>
            </button>
            <div className="p-4 flex flex-col gap-4 flex-1">
                <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Port</div><div className="font-mono font-semibold text-gray-100">{s.port || '—'}</div></div>
                    <div><div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Players</div><div className="font-semibold text-gray-100 tabular-nums">{hasPlayers ? `${s.players}/${s.maxPlayers}` : '—'}</div></div>
                    <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Owner</div><div className="font-semibold text-gray-100 truncate">{s.owner || '—'}</div></div>
                </div>
                {hasPlayers ? <Meter value={(Number(s.players) / Number(s.maxPlayers)) * 100} label={`${s.name} players`} /> : null}
                {s.installError && <div className="text-sm font-semibold text-stop-300">{s.installError}</div>}
                <div className="mt-auto flex items-center gap-2">
                    {!canPower ? null : on ? (
                        <>
                            <Button variant="stop" size="sm" disabled={busy} onClick={() => act(s.id, ['stop'])}><Square size={15} />Stop</Button>
                            <Button size="sm" disabled={busy} onClick={() => act(s.id, ['stop', 'start'])} title="Restart"><RotateCw size={15} />Restart</Button>
                        </>
                    ) : (
                        <Button variant="go" size="sm" disabled={busy} onClick={() => act(s.id, ['start'])}><Play size={15} />Start</Button>
                    )}
                    <Button variant="quiet" size="sm" className="ml-auto" onClick={() => onOpen(s)}>Manage<ArrowRight size={15} /></Button>
                </div>
            </div>
        </Card>
    );
}

export default ServerList;

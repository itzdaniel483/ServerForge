import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Play, Square, RotateCw, Server as ServerIcon, Plus, ArrowRight, Activity, Users, AlertTriangle, Search } from 'lucide-react';
import { Button, Card, Status, Stat, Empty, Notice, PageHeader, Meter, GameArt } from '../ui';
import { errorText } from '../api';
import { NodeBadge } from '../nodes';
import { can, isRemote, nodeOffline } from '../nodeUtils';

// Servers home (claude, UI v3 2026-10-30): totals, then one dense table with filter/search in its
// toolbar. Actions are always visible (never hover-only, so touch screens see them).
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
        <div className="space-y-4">
            <PageHeader title="Servers" sub={servers.length ? `${online.length} of ${servers.length} running` : 'No servers yet.'}
                actions={isAdmin && servers.length > 0 && <Button variant="primary" onClick={onInstall}><Plus size={15} />New server</Button>} />

            {error && <Notice>{error}</Notice>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat icon={ServerIcon} label="Servers" value={servers.length} />
                <Stat icon={Activity} label="Running" value={online.length} tone={online.length ? 'text-go-300' : 'text-white'} meter={servers.length ? (online.length / servers.length) * 100 : 0} />
                <Stat icon={Users} label="Players" value={players ?? '—'}
                    sub={!online.length ? 'no servers running' : known.length < online.length ? `${online.length - known.length} not reporting` : 'across running servers'} />
                <Stat icon={AlertTriangle} label="Failed installs" value={servers.filter(s => s.status === 'failed').length}
                    tone={servers.some(s => s.status === 'failed') ? 'text-stop-300' : 'text-white'} />
            </div>

            {servers.length === 0 ? (
                <Empty icon={<ServerIcon size={28} />} title="No servers yet" sub="Pick a game, name it, and ServerForge downloads and sets it up."
                    action={isAdmin && <Button variant="primary" onClick={onInstall}><Plus size={15} />Install a server</Button>} />
            ) : (
                <Card>
                    <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-gray-800">
                        <div className="flex rounded border border-gray-700 overflow-hidden">
                            {['all', 'online', 'offline'].map(f => (
                                <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                                    className={`h-7 px-3 text-xs font-medium border-r border-gray-700 last:border-r-0 ${filter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>{{ all: 'All', online: 'Running', offline: 'Stopped' }[f]}</button>
                            ))}
                        </div>
                        {multi && (
                            <select value={node} onChange={e => setNode(e.target.value)} aria-label="Machine"
                                className="h-7 px-2 rounded border border-gray-700 bg-gray-950 text-xs text-white focus:outline-none focus:border-accent-500">
                                <option value="all">All machines</option>
                                {machines.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                            </select>
                        )}
                        <div className="relative ml-auto w-full sm:w-64">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter servers" aria-label="Find a server"
                                className="w-full h-7 pl-8 pr-2 rounded border border-gray-700 bg-gray-950 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-accent-500" />
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr>
                                    <th className="th w-28">Status</th>
                                    <th className="th">Server</th>
                                    {multi && <th className="th hidden md:table-cell">Machine</th>}
                                    <th className="th hidden sm:table-cell">Address</th>
                                    <th className="th hidden md:table-cell">Players</th>
                                    <th className="th hidden lg:table-cell">Owner</th>
                                    <th className="th text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(s => <ServerRow key={s.id} s={s} multi={multi} isAdmin={isAdmin} busy={busy[s.id]} act={act} onOpen={onOpen} />)}
                            </tbody>
                        </table>
                        {shown.length === 0 && <div className="px-3 py-6 text-sm text-gray-400">No servers match.</div>}
                    </div>
                </Card>
            )}
        </div>
    );
}

function ServerRow({ s, multi, isAdmin, busy, act, onOpen }) {
    const offline = nodeOffline(s);
    const on = s.status === 'running' && !offline;
    const canPower = (isAdmin || (s.perms || []).includes('power')) && s.status !== 'installing' && s.status !== 'failed' && can(s, 'power');
    const hasPlayers = on && s.maxPlayers && s.players !== null && s.players !== undefined;
    const host = (isRemote(s) && s.nodeHost) || window.location.hostname;
    return (
        <tr className={`group hover:bg-gray-800/40 ${offline ? 'opacity-60' : ''}`}>
            <td className="td"><Status status={offline ? 'nodeoffline' : s.status} /></td>
            <td className="td">
                <button onClick={() => onOpen(s)} className="flex items-center gap-3 text-left min-w-0" aria-label={`Open ${s.name}`}>
                    <GameArt gameId={s.gameId} name={s.game} className="w-16 h-[30px] rounded-sm shrink-0" />
                    <span className="min-w-0">
                        <span className="block font-medium text-white truncate group-hover:text-accent-300">{s.name || 'Unnamed server'}</span>
                        <span className="block text-xs text-gray-500 truncate">{s.game || 'Unknown game'}{s.installError ? ` · ${s.installError}` : ''}</span>
                    </span>
                </button>
            </td>
            {multi && <td className="td hidden md:table-cell"><NodeBadge s={s} /></td>}
            <td className="td hidden sm:table-cell font-mono text-xs text-gray-300">{s.port ? `${host}:${s.port}` : '—'}</td>
            <td className="td hidden md:table-cell">
                {hasPlayers ? (
                    <div className="w-24">
                        <div className="text-xs text-gray-200 tabular-nums">{s.players}/{s.maxPlayers}</div>
                        <Meter value={(Number(s.players) / Number(s.maxPlayers)) * 100} label={`${s.name} players`} className="mt-1" />
                    </div>
                ) : <span className="text-gray-600">—</span>}
            </td>
            <td className="td hidden lg:table-cell text-gray-400">{s.owner || '—'}</td>
            <td className="td">
                <div className="flex items-center justify-end gap-1.5">
                    {!canPower ? null : on ? (
                        <>
                            <Button variant="stop" size="sm" disabled={busy} onClick={() => act(s.id, ['stop'])}><Square size={12} />Stop</Button>
                            <Button size="sm" disabled={busy} onClick={() => act(s.id, ['stop', 'start'])} title="Restart" aria-label="Restart"><RotateCw size={12} /></Button>
                        </>
                    ) : (
                        <Button variant="go" size="sm" disabled={busy} onClick={() => act(s.id, ['start'])}><Play size={12} />Start</Button>
                    )}
                    <Button variant="quiet" size="sm" className="hidden sm:inline-flex" onClick={() => onOpen(s)} aria-label={`Manage ${s.name}`}>Manage<ArrowRight size={12} /></Button>
                </div>
            </td>
        </tr>
    );
}

export default ServerList;

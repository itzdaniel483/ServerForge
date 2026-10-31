import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Search, Check, Zap } from 'lucide-react';
import { getSocket, errorText, stripAnsi } from '../api';
import { Button, Card, Notice, PageHeader, GameArt, Meter } from '../ui';
import { VarFields } from './VarFields';
import { OsIcon } from '../nodes';
import { osLabel } from '../nodeUtils';

// Installer (claude, 2026-10-30). Games come from the server's catalogue (/api/games), with each
// game's own settings (map, players, ports, world...). Games without a server for this OS are shown
// but can't be picked. With other machines joined, the game comes first and the machine is chosen with it (3730);
// the catalogue is fetched for that machine, and a game that needs another OS offers to switch to it.
export default function Installer({ onDone }) {
    // Pick the game first, then the machine (Daniel #gamemanager 3730: "I should have to select the server when
    // choosing a game, not selecting that machine at the top"). Every installable machine's catalogue is loaded and
    // merged; the chosen game lists the machines that can run it.
    const [catalogs, setCatalogs] = useState(null);   // { [machineId]: { platform, games } }
    const [gameId, setGameId] = useState(null);
    const [filter, setFilter] = useState('');
    const [category, setCategory] = useState('All');
    const [vars, setVars] = useState({});
    const [useCache, setUseCache] = useState(false);
    const [cache, setCache] = useState({});
    const [installing, setInstalling] = useState(false);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const [nodes, setNodes] = useState([]);
    // Game modes (Daniel #gamemanager 3576; contract #3584): e.g. Gmod Sandbox / TTT / DarkRP / Workshop collection.
    const [mode, setMode] = useState('');
    const [collection, setCollection] = useState('');
    const [gmName, setGmName] = useState('');
    const [nodeId, setNodeId] = useState(null);   // the machine chosen for this game (null = not chosen yet)
    const logRef = useRef(null);
    const nodeQuery = !nodeId || nodeId === 'local' ? '' : `?node=${encodeURIComponent(nodeId)}`;
    // A machine can take installs if it's this panel, or online and offering "install".
    const installable = n => n.id === 'local' || (n.online && (n.actions || []).includes('install'));

    useEffect(() => {
        let alive = true;
        axios.get('/api/nodes').then(async r => {
            const list = r.data.length ? r.data : [{ id: 'local', name: 'This panel', os: 'linux', online: true }];
            if (!alive) return;
            setNodes(list);
            const entries = await Promise.all(list.filter(installable).map(n =>
                axios.get(`/api/games${n.id === 'local' ? '' : `?node=${encodeURIComponent(n.id)}`}`).then(x => [n.id, x.data]).catch(() => null)));
            if (alive) setCatalogs(Object.fromEntries(entries.filter(Boolean)));
        }).catch(err => { if (alive) { setCatalogs({}); setResult({ ok: false, text: errorText(err) }); } });
        return () => { alive = false; };
    }, []);

    // One row per game: the machines whose catalogue says it runs there.
    const machines = nodes.filter(n => catalogs?.[n.id]);
    const merged = (() => {
        const byId = new Map();
        for (const m of machines) for (const g of catalogs[m.id].games) {
            const row = byId.get(g.id) || { ...g, on: [] };
            if (g.supported) row.on.push(m.id);
            byId.set(g.id, row);
        }
        return [...byId.values()].map(g => ({ ...g, supported: g.on.length > 0 }));
    })();
    const picked = merged.find(g => g.id === gameId) || null;
    // The machine's own copy of the game (settings/modes come from the machine that will run it).
    const game = picked && nodeId && catalogs?.[nodeId]?.games.find(g => g.id === picked.id) || null;

    // Choosing a game: preselect the machine only when exactly one can run it; otherwise the admin picks.
    function chooseGame(g) {
        setGameId(g.id); setResult(null);
        setNodeId(g.on.length === 1 ? g.on[0] : (g.on.includes(nodeId) ? nodeId : null));
    }

    useEffect(() => {
        if (!game) return;
        setUseCache(false);
        setMode(game.modes?.[0]?.id || ''); setCollection(''); setGmName('');
        setVars(Object.fromEntries(game.vars.map(f => [f.key, f.default])));
        axios.get(`/api/cache/status/${game.appId}${nodeQuery}`).then(r => setCache(r.data)).catch(() => setCache({}));
    }, [game, nodeQuery]);

    useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

    async function install() {
        setInstalling(true); setLogs([]); setResult(null);
        const socket = getSocket();
        const onLog = d => setLogs(l => [...l.slice(-800), stripAnsi(d)]);
        // Remote installs stream on install-log-<nodeId>; local keeps install-log.
        const event = nodeId === 'local' ? 'install-log' : `install-log-${nodeId}`;
        socket.on(event, onLog);
        try {
            await axios.post('/api/install', { gameId: game.id, vars, useCache, ...(nodeId === 'local' ? {} : { nodeId }), ...(mode ? { mode } : {}), ...(currentMode?.needsWorkshopKey && collection ? { workshopCollection: collection } : {}), ...(currentMode?.customGamemode && gmName ? { gamemode: gmName } : {}) });
            setResult({ ok: true, text: `${vars.name} is installed.` });
        } catch (err) {
            setResult({ ok: false, text: errorText(err) });
        } finally {
            socket.off(event, onLog);
            setInstalling(false);
        }
    }

    const machine = nodes.find(n => n.id === nodeId) || null;
    const nameOf = n => (n.id === 'local' ? 'This panel' : n.name);

    if (!catalogs) return <div className="text-gray-400">{result?.text || 'Loading games…'}</div>;

    // SteamCMD prints "progress: 42.17 (...)" while downloading; show the latest as a bar.
    const progress = (() => {
        for (let i = logs.length - 1; i >= Math.max(0, logs.length - 40); i--) {
            const m = [...logs[i].matchAll(/progress:\s*([\d.]+)/g)].pop();
            if (m) return Math.min(100, Number(m[1]));
        }
        return result?.ok ? 100 : null;
    })();
    const categories = ['All', ...new Set(merged.map(g => g.category))];
    const shown = merged
        .filter(g => (category === 'All' || g.category === category) && g.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => (b.supported - a.supported) || a.name.localeCompare(b.name));
    const runsOn = g => g.on.map(id => nodes.find(n => n.id === id)).filter(Boolean);

    const currentMode = game?.modes?.find(m => m.id === mode);
    const plat = g => (g.platforms.includes('linux') && g.platforms.includes('win32') ? 'Linux, Windows' : g.platforms.includes('win32') ? 'Windows only' : 'Linux only');
    return (
        <div className="space-y-4">
            <PageHeader title="Install a server" sub={`Pick a game, then the machine to run it on. ${merged.filter(g => g.supported).length} games across ${machines.length} machine${machines.length === 1 ? '' : 's'}.`} />
            <div className="grid lg:grid-cols-[1fr_400px] gap-4 items-start">
                <Card className="min-w-0">
                    <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-gray-800">
                        <div className="relative w-full sm:w-64">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input className="w-full h-7 pl-8 pr-2 rounded border border-gray-700 bg-gray-950 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-accent-500" placeholder="Find a game" aria-label="Find a game" value={filter} onChange={e => setFilter(e.target.value)} disabled={installing} />
                        </div>
                        <div className="flex flex-wrap rounded border border-gray-700 overflow-hidden">
                            {categories.map(c => (
                                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                                    className={`h-7 px-2.5 text-xs font-medium border-r border-gray-700 last:border-r-0 ${category === c ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>{c}</button>
                            ))}
                        </div>
                    </div>
                    <div className="divide-y divide-gray-800/70">
                        {shown.map(g => {
                            const on = gameId === g.id;
                            const row = 'w-full flex items-center gap-3 px-3 py-2 text-left text-sm leading-tight transition-colors disabled:cursor-not-allowed';
                            return (
                                <button key={g.id} disabled={installing || !g.supported} onClick={() => chooseGame(g)} aria-pressed={on}
                                    title={g.supported ? '' : 'None of your machines can run this game'}
                                    className={`${row} ${on ? 'bg-accent-500/10 shadow-[inset_2px_0_0_0_rgb(var(--a-500))]' : 'hover:bg-gray-800/50'} ${g.supported ? '' : 'opacity-40'}`}>
                                    <GameArt gameId={g.id} name={g.name} className={`w-16 h-[30px] rounded-sm shrink-0 ${g.supported ? '' : 'grayscale'}`} />
                                    <span className="min-w-0 flex-1"><span className={`block font-medium truncate ${on ? 'text-white' : 'text-gray-100'}`}>{g.name}</span><span className="block mt-0.5 text-xs text-gray-500">{g.category}</span></span>
                                    <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">{g.supported ? runsOn(g).map(n => <span key={n.id} className="inline-flex items-center gap-1" title={`Runs on ${nameOf(n)}`}><OsIcon os={n.os} size={11} />{nameOf(n)}</span>) : plat(g)}</span>
                                    {on && <Check size={15} className="text-accent-400 shrink-0" />}
                                </button>
                            );
                        })}
                        {shown.length === 0 && <div className="px-3 py-6 text-sm text-gray-400">No games match.</div>}
                    </div>
                </Card>

                <Card className="lg:sticky lg:top-16 min-w-0">
                    <div className="h-10 px-4 flex items-center border-b border-gray-800 text-sm font-semibold text-gray-100">
                        {picked ? `New ${picked.name} server${machine ? ` on ${nameOf(machine)}` : ''}` : 'New server'}
                    </div>
                    {!picked ? (
                        <div className="px-4 py-10 text-center text-sm text-gray-400">
                            <Download size={20} className="mx-auto mb-2 text-gray-500" />Pick a game from the list. Then choose the machine and settings here.
                        </div>
                    ) : (
                        <div className="p-4 space-y-4">
                            <div role="radiogroup" aria-label="Install on" className="space-y-1.5">
                                <div className="text-xs font-medium text-gray-300">Install on</div>
                                {nodes.map(n => {
                                    const can = picked.on.includes(n.id);
                                    const why = can ? '' : !installable(n) ? (n.online ? "can't install servers yet" : 'offline') : `${osLabel(n.os)} can't run this game`;
                                    return (
                                        <label key={n.id} className={`flex items-center gap-2.5 px-3 py-2 rounded border ${nodeId === n.id ? 'border-accent-500 bg-accent-500/10' : 'border-gray-700'} ${can ? 'cursor-pointer hover:border-gray-600' : 'opacity-45 cursor-not-allowed'}`}>
                                            <input type="radio" name="install-machine" className="accent-accent-500" checked={nodeId === n.id} onChange={() => setNodeId(n.id)} disabled={installing || !can} />
                                            <span className="text-gray-400"><OsIcon os={n.os} size={14} /></span>
                                            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white truncate">{nameOf(n)}</span><span className="block text-xs text-gray-400">{osLabel(n.os)}{why ? ` · ${why}` : ''}</span></span>
                                        </label>
                                    );
                                })}
                            </div>
                            {!game && <div className="text-sm text-gray-400">Choose a machine to see this game's settings.</div>}
                        </div>
                    )}
                    {game && (
                        <div className="px-4 pb-4 space-y-4">
                            {game.notes && <div className="text-xs text-accent-300">{game.notes}</div>}
                            {game.modes?.length > 0 && (
                                <div role="radiogroup" aria-label="Game mode" className="space-y-1.5">
                                    <div className="text-xs font-medium text-gray-300">Game mode</div>
                                    {game.modes.map(m => (
                                        <label key={m.id} className={`flex items-start gap-2.5 px-3 py-2 rounded border cursor-pointer ${mode === m.id ? 'border-accent-500 bg-accent-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
                                            <input type="radio" name="game-mode" className="mt-0.5 accent-accent-500" checked={mode === m.id} onChange={() => setMode(m.id)} disabled={installing} />
                                            <span className="min-w-0">
                                                <span className="block text-sm font-medium text-white">{m.name}</span>
                                                {m.description && <span className="block text-xs text-gray-400">{m.description}</span>}
                                                {m.downloads && <span className="block text-[12px] text-accent-300">Also downloads: {m.downloads}</span>}
                                            </span>
                                        </label>
                                    ))}
                                    {currentMode?.needsWorkshopKey && (
                                        <label className="block pt-1">
                                            <span className="block text-xs font-medium text-gray-300 mb-1">Workshop collection ID</span>
                                            <input value={collection} onChange={e => setCollection(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder="e.g. 123456789" disabled={installing}
                                                className="w-full h-8 bg-gray-950 text-white text-sm px-2.5 rounded border border-gray-700 focus:border-accent-500 focus:outline-none" />
                                            <span className="block text-[12px] text-gray-500 mt-1">The number at the end of the collection's Steam link. Uses the Steam Web API key from Settings.</span>
                                        </label>
                                    )}
                                    {currentMode?.customGamemode && (
                                        <label className="block">
                                            <span className="block text-xs font-medium text-gray-300 mb-1">Gamemode name</span>
                                            <input value={gmName} onChange={e => setGmName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40))} placeholder="e.g. prop_hunt" disabled={installing}
                                                className="w-full h-8 bg-gray-950 text-white text-sm font-mono px-2.5 rounded border border-gray-700 focus:border-accent-500 focus:outline-none" />
                                            <span className="block text-[12px] text-gray-500 mt-1">The folder name of the gamemode in the collection (shown on its Workshop page). Blank = sandbox.</span>
                                        </label>
                                    )}
                                </div>
                            )}
                            <VarFields fields={game.vars} values={vars} onChange={setVars} disabled={installing} />
                            <label className={`flex items-center gap-2.5 px-3 h-9 rounded border ${cache.status === 'ready' ? 'border-gray-700 cursor-pointer' : 'border-gray-800 opacity-60'}`}>
                                <input type="checkbox" className="w-4 h-4 accent-accent-500" checked={useCache} onChange={e => setUseCache(e.target.checked)} disabled={installing || cache.status !== 'ready'} />
                                <Zap size={14} className="text-accent-400" />
                                <span className="text-xs text-gray-200">{cache.status === 'ready' ? `Fast install from cache (${cache.diskSize || '?'})` : 'Not cached'}</span>
                            </label>
                            <Button variant="primary" size="lg" className="w-full" onClick={install} disabled={installing}>
                                <Download size={15} />{installing ? 'Installing… (can take a while)' : 'Install'}
                            </Button>
                            {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.text}</Notice>}
                            {result?.ok && <Button className="w-full" onClick={onDone}>Go to servers</Button>}
                        </div>
                    )}
                </Card>
            </div>

            {(installing || logs.length > 0) && (
                <Card>
                    <div className="h-10 px-4 flex items-center justify-between border-b border-gray-800 text-sm font-semibold">
                        <span className="text-gray-100">SteamCMD output</span>
                        {progress !== null && <span className="text-white tabular-nums">{progress.toFixed(0)}%</span>}
                    </div>
                    <div className="p-3 space-y-2">
                        {progress !== null && <Meter value={progress} />}
                        <pre ref={logRef} className="h-72 overflow-auto rounded bg-gray-950 border border-gray-800 p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">{logs.join('') || 'Starting…'}</pre>
                    </div>
                </Card>
            )}
        </div>
    );
}

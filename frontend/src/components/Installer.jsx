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
// but can't be picked. With other machines joined (multi-node phase 3) a machine picker comes first;
// the catalogue is fetched for that machine, and a game that needs another OS offers to switch to it.
export default function Installer({ onDone }) {
    const [catalog, setCatalog] = useState(null);
    const [game, setGame] = useState(null);
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
    const [nodeId, setNodeId] = useState('local');
    const logRef = useRef(null);
    const nodeQuery = nodeId === 'local' ? '' : `?node=${encodeURIComponent(nodeId)}`;
    // A machine can take installs if it's this panel, or online and offering "install".
    const installable = n => n.id === 'local' || (n.online && (n.actions || []).includes('install'));

    useEffect(() => {
        axios.get('/api/nodes').then(r => setNodes(r.data)).catch(() => setNodes([]));
    }, []);

    useEffect(() => {
        setCatalog(null); setGame(null); setResult(null);
        axios.get(`/api/games${nodeQuery}`).then(r => setCatalog(r.data)).catch(err => setResult({ ok: false, text: errorText(err) }));
    }, [nodeQuery]);

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

    const machine = nodes.find(n => n.id === nodeId) || { id: 'local', name: 'This panel' };
    const machineName = nodeId === 'local' ? 'this panel' : machine.name;
    const picker = nodes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Machine">
            <span className="text-xs font-medium text-gray-400 mr-1">Install on</span>
            {nodes.map(n => {
                const ok = installable(n);
                return (
                    <button key={n.id} role="radio" aria-checked={nodeId === n.id} disabled={installing || !ok} onClick={() => setNodeId(n.id)}
                        title={ok ? '' : n.online ? "This machine can't install servers yet" : 'This machine is offline'}
                        className={`inline-flex items-center gap-2 h-8 px-3 rounded border text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${nodeId === n.id ? 'bg-accent-500/15 text-white border-accent-500' : 'bg-gray-900 text-gray-300 border-gray-700 hover:text-white'}`}>
                        <OsIcon os={n.os} size={13} />{n.id === 'local' ? 'This panel' : n.name}
                        <span className="text-xs font-medium text-gray-400">{osLabel(n.os)}{n.id !== 'local' && !n.online ? ' · offline' : ''}</span>
                    </button>
                );
            })}
        </div>
    );
    // For a game this machine can't run: another installable machine with the right OS.
    const otherMachine = g => nodes.find(n => n.id !== nodeId && installable(n) && g.platforms.includes(n.os));

    if (!catalog) return <div className="space-y-4">{picker}<div className="text-gray-400">{result?.text || 'Loading games…'}</div></div>;

    // SteamCMD prints "progress: 42.17 (...)" while downloading; show the latest as a bar.
    const progress = (() => {
        for (let i = logs.length - 1; i >= Math.max(0, logs.length - 40); i--) {
            const m = [...logs[i].matchAll(/progress:\s*([\d.]+)/g)].pop();
            if (m) return Math.min(100, Number(m[1]));
        }
        return result?.ok ? 100 : null;
    })();
    const os = catalog.platform === 'win32' ? 'Windows' : 'Linux';
    const categories = ['All', ...new Set(catalog.games.map(g => g.category))];
    const shown = catalog.games
        .filter(g => (category === 'All' || g.category === category) && g.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => (b.supported - a.supported) || a.name.localeCompare(b.name));

    const currentMode = game?.modes?.find(m => m.id === mode);
    const plat = g => (g.platforms.includes('linux') && g.platforms.includes('win32') ? 'Linux, Windows' : g.platforms.includes('win32') ? 'Windows only' : 'Linux only');
    return (
        <div className="space-y-4">
            <PageHeader title="Install a server" sub={`${catalog.games.filter(g => g.supported).length} games run on ${machineName} (${os}).`} />
            {picker}
            <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
                <Card>
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
                            const on = game?.id === g.id;
                            const other = !g.supported && otherMachine(g);
                            const row = 'w-full flex items-center gap-3 px-3 py-2 text-left text-[13px] leading-tight transition-colors disabled:cursor-not-allowed';
                            if (other) return (
                                <button key={g.id} disabled={installing} onClick={() => setNodeId(other.id)} title={`Switch to ${other.name}`} className={`${row} hover:bg-gray-800/50`}>
                                    <GameArt gameId={g.id} name={g.name} className="w-16 h-[30px] rounded-sm shrink-0" imgClassName="object-center grayscale opacity-60" />
                                    <span className="min-w-0 flex-1"><span className="block font-medium text-gray-300 truncate">{g.name}</span><span className="block mt-0.5 text-xs text-gray-500">{g.category}</span></span>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-300 whitespace-nowrap"><OsIcon os={other.os} size={11} />Install on {other.name}</span>
                                </button>
                            );
                            return (
                                <button key={g.id} disabled={installing || !g.supported} onClick={() => setGame(g)} aria-pressed={on}
                                    title={g.supported ? '' : `No ${os} server for this game`}
                                    className={`${row} ${on ? 'bg-accent-500/10 shadow-[inset_2px_0_0_0_rgb(var(--a-500))]' : 'hover:bg-gray-800/50'} ${g.supported ? '' : 'opacity-40'}`}>
                                    <GameArt gameId={g.id} name={g.name} className={`w-16 h-[30px] rounded-sm shrink-0 ${g.supported ? '' : 'grayscale'}`} />
                                    <span className="min-w-0 flex-1"><span className={`block font-medium truncate ${on ? 'text-white' : 'text-gray-100'}`}>{g.name}</span><span className="block mt-0.5 text-xs text-gray-500">{g.category}</span></span>
                                    <span className="hidden sm:block text-xs text-gray-500 whitespace-nowrap">{plat(g)}</span>
                                    {on && <Check size={15} className="text-accent-400 shrink-0" />}
                                </button>
                            );
                        })}
                        {shown.length === 0 && <div className="px-3 py-6 text-[13px] text-gray-400">No games match.</div>}
                    </div>
                </Card>

                <Card className="lg:sticky lg:top-16">
                    <div className="h-10 px-4 flex items-center border-b border-gray-800 text-[13px] font-semibold text-gray-100">
                        {game ? `New ${game.name} server${nodeId !== 'local' ? ` on ${machine.name}` : ''}` : 'New server'}
                    </div>
                    {!game ? (
                        <div className="px-4 py-10 text-center text-[13px] text-gray-400">
                            <Download size={20} className="mx-auto mb-2 text-gray-500" />Pick a game from the list. Its settings appear here.
                        </div>
                    ) : (
                        <div className="p-4 space-y-4">
                            {game.notes && <div className="text-xs text-accent-300">{game.notes}</div>}
                            {game.modes?.length > 0 && (
                                <div role="radiogroup" aria-label="Game mode" className="space-y-1.5">
                                    <div className="text-xs font-medium text-gray-300">Game mode</div>
                                    {game.modes.map(m => (
                                        <label key={m.id} className={`flex items-start gap-2.5 px-3 py-2 rounded border cursor-pointer ${mode === m.id ? 'border-accent-500 bg-accent-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
                                            <input type="radio" name="game-mode" className="mt-0.5 accent-accent-500" checked={mode === m.id} onChange={() => setMode(m.id)} disabled={installing} />
                                            <span className="min-w-0">
                                                <span className="block text-[13px] font-medium text-white">{m.name}</span>
                                                {m.description && <span className="block text-xs text-gray-400">{m.description}</span>}
                                                {m.downloads && <span className="block text-[11px] text-accent-300">Also downloads: {m.downloads}</span>}
                                            </span>
                                        </label>
                                    ))}
                                    {currentMode?.needsWorkshopKey && (
                                        <label className="block pt-1">
                                            <span className="block text-xs font-medium text-gray-300 mb-1">Workshop collection ID</span>
                                            <input value={collection} onChange={e => setCollection(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder="e.g. 123456789" disabled={installing}
                                                className="w-full h-8 bg-gray-950 text-white text-[13px] px-2.5 rounded border border-gray-700 focus:border-accent-500 focus:outline-none" />
                                            <span className="block text-[11px] text-gray-500 mt-1">The number at the end of the collection's Steam link. Uses the Steam Web API key from Settings.</span>
                                        </label>
                                    )}
                                    {currentMode?.customGamemode && (
                                        <label className="block">
                                            <span className="block text-xs font-medium text-gray-300 mb-1">Gamemode name</span>
                                            <input value={gmName} onChange={e => setGmName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40))} placeholder="e.g. prop_hunt" disabled={installing}
                                                className="w-full h-8 bg-gray-950 text-white text-[13px] font-mono px-2.5 rounded border border-gray-700 focus:border-accent-500 focus:outline-none" />
                                            <span className="block text-[11px] text-gray-500 mt-1">The folder name of the gamemode in the collection (shown on its Workshop page). Blank = sandbox.</span>
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
                    <div className="h-10 px-4 flex items-center justify-between border-b border-gray-800 text-[13px] font-semibold">
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

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
        setVars(Object.fromEntries(game.vars.map(f => [f.key, f.default])));
        axios.get(`/api/cache/status/${game.appId}${nodeQuery}`).then(r => setCache(r.data)).catch(() => setCache({}));
    }, [game, nodeQuery]);

    useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

    async function install() {
        setInstalling(true); setLogs([]); setResult(null);
        const socket = getSocket();
        const onLog = d => setLogs(l => [...l.slice(-800), stripAnsi(d)]);
        socket.on('install-log', onLog);
        try {
            await axios.post('/api/install', { gameId: game.id, vars, useCache, ...(nodeId === 'local' ? {} : { nodeId }) });
            setResult({ ok: true, text: `${vars.name} is installed.` });
        } catch (err) {
            setResult({ ok: false, text: errorText(err) });
        } finally {
            socket.off('install-log', onLog);
            setInstalling(false);
        }
    }

    const machine = nodes.find(n => n.id === nodeId) || { id: 'local', name: 'This panel' };
    const machineName = nodeId === 'local' ? 'this panel' : machine.name;
    const picker = nodes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Machine">
            <span className="text-sm font-semibold text-gray-300 mr-1">Install on</span>
            {nodes.map(n => {
                const ok = installable(n);
                return (
                    <button key={n.id} role="radio" aria-checked={nodeId === n.id} disabled={installing || !ok} onClick={() => setNodeId(n.id)}
                        title={ok ? '' : n.online ? "This machine can't install servers yet" : 'This machine is offline'}
                        className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold ring-1 transition disabled:opacity-40 disabled:cursor-not-allowed ${nodeId === n.id ? 'bg-accent-500/20 text-white ring-accent-400' : 'bg-white/[.03] text-gray-300 ring-white/10 hover:text-white'}`}>
                        <OsIcon os={n.os} size={15} />{n.id === 'local' ? 'This panel' : n.name}
                        <span className="text-xs font-medium text-gray-400">{osLabel(n.os)}{n.id !== 'local' && !n.online ? ' · offline' : ''}</span>
                    </button>
                );
            })}
        </div>
    );
    // For a game this machine can't run: another installable machine with the right OS.
    const otherMachine = g => nodes.find(n => n.id !== nodeId && installable(n) && g.platforms.includes(n.os));

    if (!catalog) return <div className="space-y-6">{picker}<div className="text-gray-400">{result?.text || 'Loading games…'}</div></div>;

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

    return (
        <div className="space-y-6">
            <PageHeader title="Install a server" sub={`${catalog.games.filter(g => g.supported).length} games run on ${machineName} (${os}). Pick one, name it, install.`} />
            {picker}
            <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input className="w-full h-11 bg-white/[.03] text-white placeholder-gray-500 pl-11 pr-4 rounded-xl border border-white/[.08] focus:border-accent-400 focus:outline-none" placeholder="Find a game" value={filter} onChange={e => setFilter(e.target.value)} disabled={installing} />
                        </div>
                        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-white/[.03] border border-white/[.06]">
                            {categories.map(c => (
                                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                                    className={`h-9 px-4 rounded-lg text-sm font-semibold ${category === c ? 'bg-white/[.1] text-white' : 'text-gray-400 hover:text-white'}`}>{c}</button>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr))]">
                        {shown.map(g => {
                            const on = game?.id === g.id;
                            const other = !g.supported && otherMachine(g);
                            if (other) return (
                                <button key={g.id} disabled={installing} onClick={() => setNodeId(other.id)} title={`Switch to ${other.name}`}
                                    className="group text-left rounded-2xl overflow-hidden glass transition-all hover:ring-1 hover:ring-white/20 disabled:cursor-not-allowed">
                                    <GameArt gameId={g.id} name={g.name} className="h-28" imgClassName="object-center grayscale opacity-60">
                                        <div className="absolute bottom-2.5 left-3 right-3 font-extrabold text-white leading-snug drop-shadow">{g.name}</div>
                                    </GameArt>
                                    <div className="px-3 py-2.5 flex items-center gap-2 text-xs">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[.06] font-semibold text-gray-300">{g.category}</span>
                                        <span className="inline-flex items-center gap-1.5 font-semibold text-accent-200 truncate"><OsIcon os={other.os} size={12} />Install on {other.name}</span>
                                    </div>
                                </button>
                            );
                            return (
                                <button key={g.id} disabled={installing || !g.supported} onClick={() => setGame(g)} aria-pressed={on}
                                    title={g.supported ? '' : `No ${os} server for this game`}
                                    className={`group text-left rounded-2xl overflow-hidden glass transition-all disabled:cursor-not-allowed ${on ? 'ring-2 ring-accent-400 shadow-glow' : 'hover:-translate-y-0.5 hover:ring-1 hover:ring-white/20'} ${g.supported ? '' : 'opacity-35 grayscale'}`}>
                                    <GameArt gameId={g.id} name={g.name} className="h-28">
                                        {on && <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full grid place-items-center bg-accent-500 text-white shadow-glow"><Check size={16} /></span>}
                                        <div className="absolute bottom-2.5 left-3 right-3 font-extrabold text-white leading-snug drop-shadow">{g.name}</div>
                                    </GameArt>
                                    <div className="px-3 py-2.5 flex items-center gap-2 text-xs">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[.06] font-semibold text-gray-300">{g.category}</span>
                                        {!g.supported && <span className="font-semibold text-gray-400">{g.platforms.includes('win32') ? 'Windows only' : 'Linux only'}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <Card className="overflow-hidden lg:sticky lg:top-24">
                    {!game ? (
                        <div className="py-16 px-6 text-center">
                            <div className="w-16 h-16 mx-auto rounded-2xl grid place-items-center bg-accent-500/10 text-accent-300 ring-1 ring-accent-400/30 mb-4"><Download size={28} /></div>
                            <div className="text-lg font-bold text-white">Pick a game</div>
                            <div className="text-sm text-gray-400 mt-1">Its settings appear here.</div>
                        </div>
                    ) : (
                        <>
                        <GameArt gameId={game.id} name={game.name} className="h-36">
                            <div className="absolute bottom-3 left-5 right-5">
                                <div className="text-xs font-bold uppercase tracking-wider text-accent-200">New server{nodeId !== 'local' ? ` on ${machine.name}` : ''}</div>
                                <div className="text-2xl font-black text-white drop-shadow">{game.name}</div>
                            </div>
                        </GameArt>
                        <div className="p-6 space-y-5">
                            {game.notes && <div className="text-sm text-accent-200">{game.notes}</div>}
                            <VarFields fields={game.vars} values={vars} onChange={setVars} disabled={installing} />
                            <label className={`flex items-center gap-3 p-3 rounded-xl ring-1 ${cache.status === 'ready' ? 'ring-white/15 cursor-pointer' : 'ring-white/[.06] opacity-60'}`}>
                                <input type="checkbox" className="w-5 h-5 accent-ember-500" checked={useCache} onChange={e => setUseCache(e.target.checked)} disabled={installing || cache.status !== 'ready'} />
                                <Zap size={18} className="text-ember-400" />
                                <span className="text-sm font-semibold text-gray-100">{cache.status === 'ready' ? `Fast install from cache (${cache.diskSize || '?'})` : 'Not cached'}</span>
                            </label>
                            <Button variant="primary" size="lg" className="w-full" onClick={install} disabled={installing}>
                                <Download size={18} />{installing ? 'Installing… (can take a while)' : 'Install'}
                            </Button>
                            {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.text}</Notice>}
                            {result?.ok && <Button className="w-full" onClick={onDone}>Go to servers</Button>}
                        </div>
                        </>
                    )}
                </Card>
            </div>

            {(installing || logs.length > 0) && (
                <Card className="p-5 space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold">
                        <span className="text-gray-200">SteamCMD output</span>
                        {progress !== null && <span className="text-white tabular-nums">{progress.toFixed(0)}%</span>}
                    </div>
                    {progress !== null && <Meter value={progress} />}
                    <pre ref={logRef} className="h-72 overflow-auto rounded-xl bg-gray-950/80 border border-white/[.06] p-4 font-mono text-xs text-gray-200 whitespace-pre-wrap">{logs.join('') || 'Starting…'}</pre>
                </Card>
            )}
        </div>
    );
}

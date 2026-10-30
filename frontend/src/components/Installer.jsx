import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Search, Check, Zap } from 'lucide-react';
import { getSocket, errorText } from '../api';
import { Button, Card, Notice } from '../ui';
import { VarFields } from './VarFields';

// Installer (claude, 2026-10-30). Games come from the server's catalogue (/api/games), with each
// game's own settings (map, players, ports, world...). Games without a server for this OS are shown
// but can't be picked.
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
    const logRef = useRef(null);

    useEffect(() => {
        axios.get('/api/games').then(r => setCatalog(r.data)).catch(err => setResult({ ok: false, text: errorText(err) }));
    }, []);

    useEffect(() => {
        if (!game) return;
        setUseCache(false);
        setVars(Object.fromEntries(game.vars.map(f => [f.key, f.default])));
        axios.get(`/api/cache/status/${game.appId}`).then(r => setCache(r.data)).catch(() => setCache({}));
    }, [game]);

    useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

    async function install() {
        setInstalling(true); setLogs([]); setResult(null);
        const socket = getSocket();
        const onLog = d => setLogs(l => [...l.slice(-800), String(d)]);
        socket.on('install-log', onLog);
        try {
            await axios.post('/api/install', { gameId: game.id, vars, useCache });
            setResult({ ok: true, text: `${vars.name} is installed.` });
        } catch (err) {
            setResult({ ok: false, text: errorText(err) });
        } finally {
            socket.off('install-log', onLog);
            setInstalling(false);
        }
    }

    if (!catalog) return <div className="text-gray-400">{result?.text || 'Loading games…'}</div>;

    const os = catalog.platform === 'win32' ? 'Windows' : 'Linux';
    const categories = ['All', ...new Set(catalog.games.map(g => g.category))];
    const shown = catalog.games
        .filter(g => (category === 'All' || g.category === category) && g.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => (b.supported - a.supported) || a.name.localeCompare(b.name));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h1 className="text-3xl font-extrabold text-white">Install a server</h1>
                <span className="text-sm text-gray-400">{catalog.games.filter(g => g.supported).length} games run on this {os} host</span>
            </div>
            <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input className="w-full h-11 bg-gray-950 text-white placeholder-gray-500 pl-11 pr-4 rounded-lg border border-gray-700 focus:border-ember-400 focus:outline-none" placeholder="Find a game" value={filter} onChange={e => setFilter(e.target.value)} disabled={installing} />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {categories.map(c => (
                                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                                    className={`h-11 px-4 rounded-lg text-sm font-semibold ${category === c ? 'bg-white text-gray-950' : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-600'}`}>{c}</button>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                        {shown.map(g => {
                            const on = game?.id === g.id;
                            return (
                                <button key={g.id} disabled={installing || !g.supported} onClick={() => setGame(g)} aria-pressed={on}
                                    title={g.supported ? '' : `No ${os} server for this game`}
                                    className={`text-left p-4 rounded-xl border-2 transition-colors disabled:cursor-not-allowed ${on ? 'border-ember-400 bg-ember-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-600'} ${g.supported ? '' : 'opacity-40'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-bold text-white leading-snug">{g.name}</span>
                                        {on && <Check size={18} className="text-ember-400 shrink-0" />}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-xs">
                                        <span className="text-gray-400">{g.category}</span>
                                        {!g.supported && <span className="font-semibold text-gray-300">{g.platforms.includes('win32') ? 'Windows only' : 'Linux only'}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <Card className="p-6 space-y-5 lg:sticky lg:top-24">
                    {!game ? (
                        <div className="text-gray-300 py-10 text-center">Pick a game.</div>
                    ) : (
                        <>
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Installing</div>
                                <div className="text-xl font-bold text-white">{game.name}</div>
                                {game.notes && <div className="mt-2 text-sm text-ember-200">{game.notes}</div>}
                            </div>
                            <VarFields fields={game.vars} values={vars} onChange={setVars} disabled={installing} />
                            <label className={`flex items-center gap-3 p-3 rounded-lg ring-1 ${cache.status === 'ready' ? 'ring-gray-700 cursor-pointer' : 'ring-gray-800 opacity-60'}`}>
                                <input type="checkbox" className="w-5 h-5 accent-ember-500" checked={useCache} onChange={e => setUseCache(e.target.checked)} disabled={installing || cache.status !== 'ready'} />
                                <Zap size={18} className="text-ember-400" />
                                <span className="text-sm font-semibold text-gray-100">{cache.status === 'ready' ? `Fast install from cache (${cache.diskSize || '?'})` : 'Not cached'}</span>
                            </label>
                            <Button variant="primary" size="lg" className="w-full" onClick={install} disabled={installing}>
                                <Download size={18} />{installing ? 'Installing… (can take a while)' : 'Install'}
                            </Button>
                            {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.text}</Notice>}
                            {result?.ok && <Button className="w-full" onClick={onDone}>Go to servers</Button>}
                        </>
                    )}
                </Card>
            </div>

            {(installing || logs.length > 0) && (
                <div>
                    <div className="text-sm font-semibold text-gray-300 mb-2">SteamCMD output</div>
                    <pre ref={logRef} className="h-72 overflow-auto rounded-xl bg-gray-950 border border-gray-800 p-4 font-mono text-xs text-gray-200 whitespace-pre-wrap">{logs.join('') || 'Starting…'}</pre>
                </div>
            )}
        </div>
    );
}

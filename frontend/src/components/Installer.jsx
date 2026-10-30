import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Search, Check, Zap } from 'lucide-react';
import { getSocket, errorText } from '../api';
import { Button, Card, Field, Notice, inputClass } from '../ui';

const GAMES = [
    { appId: '4020', name: "Garry's Mod" },
    { appId: '232250', name: 'Team Fortress 2' },
    { appId: '740', name: 'Counter-Strike: Global Offensive' },
    { appId: '4940', name: 'Counter-Strike: Source' },
    { appId: '222860', name: 'Left 4 Dead 2' },
    { appId: '1007', name: 'Half-Life 2: Deathmatch' },
    { appId: '232290', name: 'Day of Defeat: Source' },
    { appId: '17505', name: 'Zombie Panic! Source' },
    { appId: '237410', name: 'Insurgency' },
    { appId: '258550', name: 'Rust' },
    { appId: '376030', name: 'ARK: Survival Evolved' },
    { appId: '294420', name: '7 Days to Die' },
    { appId: '215350', name: 'Killing Floor' },
    { appId: '556450', name: 'The Forest' },
    { appId: '380870', name: 'Project Zomboid' },
];

// Installer (claude overhaul, 2026-10-30). It used to send gameId/template, which the server
// doesn't read, so every install failed; it now sends appId/gameName. Folder paths are chosen by
// the server (inside its servers folder), so there's no Windows path box any more.
export default function Installer({ onDone }) {
    const [game, setGame] = useState(null);
    const [filter, setFilter] = useState('');
    const [name, setName] = useState('');
    const [port, setPort] = useState('');
    const [useCache, setUseCache] = useState(false);
    const [cache, setCache] = useState({});
    const [installing, setInstalling] = useState(false);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const logRef = useRef(null);

    useEffect(() => {
        if (!game) return;
        setUseCache(false);
        axios.get(`/api/cache/status/${game.appId}`).then(r => setCache(r.data)).catch(() => setCache({}));
    }, [game]);

    useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

    async function install() {
        setInstalling(true); setLogs([]); setResult(null);
        const socket = getSocket();
        const onLog = d => setLogs(l => [...l.slice(-800), String(d)]);
        socket.on('install-log', onLog);
        try {
            await axios.post('/api/install', { appId: game.appId, gameName: game.name, hostname: name.trim() || game.name, port: port || null, useCache });
            setResult({ ok: true, text: `${name.trim() || game.name} is installed.` });
        } catch (err) {
            setResult({ ok: false, text: errorText(err) });
        } finally {
            socket.off('install-log', onLog);
            setInstalling(false);
        }
    }

    const shown = GAMES.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-extrabold text-white">Install a server</h1>
            <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
                <div className="space-y-4">
                    <div className="relative">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input className={`${inputClass} pl-11`} placeholder="Find a game" value={filter} onChange={e => setFilter(e.target.value)} disabled={installing} />
                    </div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                        {shown.map(g => {
                            const on = game?.appId === g.appId;
                            return (
                                <button key={g.appId} disabled={installing} onClick={() => setGame(g)} aria-pressed={on}
                                    className={`text-left p-4 rounded-xl border-2 transition-colors disabled:opacity-50 ${on ? 'border-ember-400 bg-ember-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-600'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-bold text-white leading-snug">{g.name}</span>
                                        {on && <Check size={18} className="text-ember-400 shrink-0" />}
                                    </div>
                                    <div className="mt-1 text-xs font-mono text-gray-400">App {g.appId}</div>
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
                            </div>
                            <Field label="Server name">
                                <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder={game.name} maxLength={60} disabled={installing} />
                            </Field>
                            <Field label="Port" hint="Blank = 27015">
                                <input className={inputClass} value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} placeholder="27015" inputMode="numeric" maxLength={5} disabled={installing} />
                            </Field>
                            <label className={`flex items-center gap-3 p-3 rounded-lg ring-1 ${cache.status === 'ready' ? 'ring-gray-700 cursor-pointer' : 'ring-gray-800 opacity-60'}`}>
                                <input type="checkbox" className="w-5 h-5 accent-ember-500" checked={useCache} onChange={e => setUseCache(e.target.checked)} disabled={installing || cache.status !== 'ready'} />
                                <Zap size={18} className="text-ember-400" />
                                <span className="text-sm font-semibold text-gray-100">{cache.status === 'ready' ? `Fast install from cache (${cache.diskSize || '?'})` : 'Not cached'}</span>
                            </label>
                            <Button variant="primary" size="lg" className="w-full" onClick={install} disabled={installing}>
                                <Download size={18} />{installing ? 'Installing…' : 'Install'}
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

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Play, Square, RotateCw, Server as ServerIcon, Plus, ArrowRight } from 'lucide-react';
import { Button, Card, Status, Stat, Empty, Notice } from '../ui';
import { errorText } from '../api';

// Servers home (claude overhaul, 2026-10-30): totals across the top, then a full-width grid of cards.
// Actions are always visible (they used to appear only on hover, so touch screens never saw them).
function ServerList({ onOpen, onInstall, isAdmin }) {
    const [servers, setServers] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState({});

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

    const online = servers.filter(s => s.status === 'running').length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <h1 className="text-3xl font-extrabold text-white">Servers</h1>
                {isAdmin && servers.length > 0 && <Button variant="primary" onClick={onInstall}><Plus size={18} />New server</Button>}
            </div>

            {error && <Notice>{error}</Notice>}

            <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <Stat label="Total" value={servers.length} />
                <Stat label="Online" value={online} tone={online ? 'text-go-300' : 'text-white'} />
                <Stat label="Offline" value={servers.length - online} />
            </div>

            {servers.length === 0 ? (
                <Empty icon={<ServerIcon size={56} />} title="No servers yet"
                    action={isAdmin && <Button variant="primary" size="lg" onClick={onInstall}><Plus size={18} />Install a server</Button>} />
            ) : (
                <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                    {servers.map(s => {
                        const on = s.status === 'running';
                        return (
                            <Card key={s.id} className={`p-5 flex flex-col gap-4 ${on ? 'ring-1 ring-go-500/30' : ''}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-lg font-bold text-white truncate">{s.name || 'Unnamed server'}</div>
                                        <div className="text-sm text-gray-400 truncate">{s.game || 'Unknown game'}</div>
                                    </div>
                                    <Status status={s.status} />
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-gray-400">Port <span className="font-mono font-semibold text-gray-100">{s.port || 27015}</span></span>
                                    {s.owner && <span className="text-gray-400 truncate">Owner <span className="font-semibold text-gray-100">{s.owner}</span></span>}
                                </div>
                                {s.installError && <div className="text-sm font-semibold text-red-300">{s.installError}</div>}
                                <div className="mt-auto flex items-center gap-2">
                                    {!(isAdmin || (s.perms || []).includes('power')) || s.status === 'installing' || s.status === 'failed' ? null : on ? (
                                        <>
                                            <Button variant="stop" size="sm" disabled={busy[s.id]} onClick={() => act(s.id, ['stop'])}><Square size={15} />Stop</Button>
                                            <Button size="sm" disabled={busy[s.id]} onClick={() => act(s.id, ['stop', 'start'])} title="Restart"><RotateCw size={15} />Restart</Button>
                                        </>
                                    ) : (
                                        <Button variant="go" size="sm" disabled={busy[s.id]} onClick={() => act(s.id, ['start'])}><Play size={15} />Start</Button>
                                    )}
                                    <Button variant="quiet" size="sm" className="ml-auto" onClick={() => onOpen(s)}>Open<ArrowRight size={15} /></Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default ServerList;

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import axios from 'axios';
import { Play, Square, RotateCw, Terminal as TerminalIcon, FolderOpen, SlidersHorizontal, Archive, RefreshCw, Package, Copy, Trash2, Send, CalendarClock, Users, History, Cpu, MemoryStick, Map as MapIcon } from 'lucide-react';
import FileManager from './FileManager';
import ServerSettings from './ServerSettings';
import BackupManager from './BackupManager';
import UpdateManager from './UpdateManager';
import PluginManager from './PluginManager';
import TaskManager from './TaskManager';
import AccessManager from './AccessManager';
import ActivityLog from './ActivityLog';
import { getSocket, errorText } from '../api';
import { Button, Card, Status, Stat, Notice, GameArt } from '../ui';
import { themeColor } from '../theme';

// Server page (claude, UI v2 2026-10-30): game-art hero with address and power buttons, live
// meters, pill tabs; the console fills the rest of the screen. Admin-only tabs are hidden from users.
function ServerControl({ server, isAdmin, onDeleted }) {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitRef = useRef(null);
    const [status, setStatus] = useState(server.status || 'stopped');
    const [stats, setStats] = useState({ cpu: 0, memory: 0 });
    const [query, setQuery] = useState(null);
    const [tab, setTab] = useState('console');
    const [command, setCommand] = useState('');
    const [history, setHistory] = useState([]);
    const [histIdx, setHistIdx] = useState(-1);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const id = server.id;
    const address = `${window.location.hostname}:${server.port || 27015}`;

    useEffect(() => {
        if (tab !== 'console') return undefined;
        const term = new Terminal({
            theme: { background: themeColor('g-950'), foreground: themeColor('g-200'), cursor: themeColor('a-400'), selectionBackground: themeColor('a-400', 0.3) },
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13, lineHeight: 1.4, convertEol: true, scrollback: 5000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(terminalRef.current);
        fit.fit();
        xtermRef.current = term; fitRef.current = fit;
        const onResize = () => fit.fit();
        window.addEventListener('resize', onResize);

        const socket = getSocket();
        const watch = () => socket.emit('watch', id);   // join this server's live-log room
        watch();
        socket.on('connect', watch);
        const onLog = d => term.write(d);
        const onStatus = s => {
            setStatus(s);
            term.write(s === 'running' ? '\r\n\x1b[32m● Server started\x1b[0m\r\n' : '\r\n\x1b[31m● Server stopped\x1b[0m\r\n');
            if (s !== 'running') { setStats({ cpu: 0, memory: 0 }); setQuery(null); }
        };
        socket.on(`server-log-${id}`, onLog);
        socket.on(`server-status-${id}`, onStatus);
        socket.on(`server-stats-${id}`, setStats);
        socket.on(`server-query-${id}`, setQuery);

        axios.get(`/api/server/${id}/status`).then(r => setStatus(r.data.status)).catch(() => {});
        axios.get(`/api/server/${id}/logs`).then(r => { if (r.data) term.write(r.data); else term.write('\x1b[90mNo output yet. Start the server to see its console.\x1b[0m\r\n'); }).catch(() => {});

        return () => {
            window.removeEventListener('resize', onResize);
            socket.off('connect', watch);
            socket.off(`server-log-${id}`, onLog);
            socket.off(`server-status-${id}`, onStatus);
            socket.off(`server-stats-${id}`, setStats);
            socket.off(`server-query-${id}`, setQuery);
            term.dispose();
            xtermRef.current = null;
        };
    }, [id, tab]);

    async function power(steps) {
        setError('');
        try {
            for (const s of steps) {
                await axios.post(`/api/server/${s}`, { id });
                if (steps.length > 1) await new Promise(r => setTimeout(r, 2000));
            }
            const r = await axios.get(`/api/server/${id}/status`);
            setStatus(r.data.status);
        } catch (err) {
            setError(errorText(err));
        }
    }

    async function send() {
        const c = command.trim();
        if (!c) return;
        setHistory(h => [...h, c]); setHistIdx(-1); setCommand('');
        xtermRef.current?.write(`\r\n\x1b[38;5;209m> ${c}\x1b[0m\r\n`);
        try {
            const r = await axios.post(`/api/server/${id}/command`, { command: c });
            if (r.data.response) xtermRef.current?.write(r.data.response + '\r\n');
        } catch (err) {
            xtermRef.current?.write(`\x1b[31m${errorText(err)}\x1b[0m\r\n`);
        }
    }

    function onKey(e) {
        if (e.key === 'Enter') send();
        else if (e.key === 'ArrowUp' && history.length) {
            e.preventDefault();
            const i = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
            setHistIdx(i); setCommand(history[i]);
        } else if (e.key === 'ArrowDown' && histIdx !== -1) {
            e.preventDefault();
            const i = histIdx + 1;
            if (i >= history.length) { setHistIdx(-1); setCommand(''); } else { setHistIdx(i); setCommand(history[i]); }
        }
    }

    async function remove() {
        if (!window.confirm(`Delete "${server.name}" from ServerForge? Its files stay on disk.`)) return;
        try { await axios.delete(`/api/server/${id}`); onDeleted(); } catch (err) { setError(errorText(err)); }
    }

    function copyAddress() {
        navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
    }

    const on = status === 'running';
    const perms = server.perms || [];
    const may = p => isAdmin || perms.includes(p);
    const tabs = [
        { id: 'console', label: 'Console', icon: TerminalIcon },
        ...(may('files') ? [{ id: 'files', label: 'Files', icon: FolderOpen }] : []),
        ...(isAdmin ? [{ id: 'config', label: 'Settings', icon: SlidersHorizontal }] : []),
        { id: 'tasks', label: 'Schedule', icon: CalendarClock },
        ...(may('backups') ? [{ id: 'backups', label: 'Backups', icon: Archive }] : []),
        ...(isAdmin ? [{ id: 'updates', label: 'Updates', icon: RefreshCw }, { id: 'plugins', label: 'Plugins', icon: Package }, { id: 'access', label: 'Access', icon: Users }, { id: 'activity', label: 'Activity', icon: History }] : []),
    ];

    const cpu = Number(stats.cpu || 0);
    const memMb = Number(stats.memory || 0) / 1048576;
    return (
        <div className="space-y-5">
            <Card className="overflow-hidden">
                <GameArt gameId={server.gameId} name={server.game} className="h-56 sm:h-64" imgClassName="object-[center_15%]">
                    <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 flex flex-wrap items-end gap-x-6 gap-y-4">
                        <div className="min-w-0 mr-auto">
                            <div className="flex items-center gap-3 flex-wrap">
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white truncate drop-shadow-lg">{server.name}</h1>
                                <Status status={status} />
                            </div>
                            <div className="mt-2.5 flex items-center gap-3 flex-wrap text-sm">
                                <span className="font-semibold text-gray-200">{server.game}</span>
                                <button onClick={copyAddress} className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-gray-950/70 backdrop-blur ring-1 ring-white/15 font-mono text-gray-100 hover:ring-accent-400" title="Copy address">
                                    {address}<Copy size={14} className="text-gray-400" />{copied && <span className="font-sans text-go-300">Copied</span>}
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {!may('power') || status === 'installing' || status === 'failed' ? null : on ? (
                                <>
                                    <Button variant="stop" size="lg" onClick={() => power(['stop'])}><Square size={18} />Stop</Button>
                                    <Button size="lg" className="backdrop-blur" onClick={() => power(['stop', 'start'])}><RotateCw size={18} />Restart</Button>
                                </>
                            ) : (
                                <Button variant="go" size="lg" onClick={() => power(['start'])}><Play size={18} />Start</Button>
                            )}
                            {isAdmin && <Button variant="ghost" size="lg" className="backdrop-blur" onClick={remove} title="Delete server" aria-label="Delete server"><Trash2 size={18} /></Button>}
                        </div>
                    </div>
                </GameArt>
            </Card>

            {error && <Notice>{error}</Notice>}
            {server.installError && <Notice>{server.installError}</Notice>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Stat icon={Users} label="Players" value={on && query ? `${query.players}/${query.maxPlayers}` : '—'} meter={on && query?.maxPlayers ? (query.players / query.maxPlayers) * 100 : undefined} />
                <Stat icon={MapIcon} label="Map" value={on && query?.map ? query.map : '—'} />
                <Stat icon={Cpu} label="CPU" value={on ? `${cpu.toFixed(0)}%` : '—'} meter={on ? cpu : undefined} />
                <Stat icon={MemoryStick} label="Memory" value={on ? (memMb >= 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${memMb.toFixed(0)} MB`) : '—'} />
            </div>

            <div className="flex gap-1 p-1 rounded-2xl bg-white/[.03] border border-white/[.06] overflow-x-auto">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                        className={`flex items-center gap-2 h-10 px-4 rounded-xl font-semibold whitespace-nowrap transition-all ${tab === t.id ? 'bg-white/[.1] text-white ring-1 ring-white/10' : 'text-gray-400 hover:text-white hover:bg-white/[.04]'}`}>
                        <t.icon size={17} className={tab === t.id ? 'text-accent-300' : ''} />{t.label}
                    </button>
                ))}
            </div>

            {tab === 'console' && (
                <Card className="overflow-hidden flex flex-col !bg-gray-950/90">
                    <div className="h-10 px-4 flex items-center gap-2 border-b border-white/[.06] text-xs font-bold uppercase tracking-wider text-gray-400">
                        <span className="flex gap-1.5 mr-2"><i className="w-3 h-3 rounded-full bg-stop-500/70" /><i className="w-3 h-3 rounded-full bg-warn-500/70" /><i className="w-3 h-3 rounded-full bg-go-500/70" /></span>
                        <TerminalIcon size={14} className="text-accent-300" />Live console
                        {on && <span className="ml-auto flex items-center gap-1.5 text-go-300"><span className="w-1.5 h-1.5 rounded-full bg-go-400 animate-pulse" />streaming</span>}
                    </div>
                    <div ref={terminalRef} className="h-[calc(100vh-560px)] min-h-[360px] p-3" />
                    <div className="border-t border-white/[.06] p-3 flex items-center gap-2 bg-white/[.02]">
                        <span className="font-mono text-ember-400 font-bold">&gt;</span>
                        <input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={onKey} disabled={!on || !may('console')}
                            placeholder={!may('console') ? 'Read-only console' : on ? 'Type a command (status, say, changelevel…)' : 'Start the server to send commands'}
                            className="flex-1 h-10 bg-transparent text-white placeholder-gray-500 font-mono text-sm focus:outline-none disabled:cursor-not-allowed" />
                        <Button variant="primary" size="sm" onClick={send} disabled={!on || !may('console') || !command.trim()}><Send size={15} />Send</Button>
                    </div>
                </Card>
            )}
            {tab === 'files' && <FileManager serverId={id} canEdit={isAdmin} />}
            {tab === 'config' && <ServerSettings server={server} />}
            {tab === 'backups' && <BackupManager serverId={id} canRestore={isAdmin} />}
            {tab === 'updates' && <UpdateManager server={server} />}
            {tab === 'plugins' && <PluginManager server={server} />}
            {tab === 'tasks' && <TaskManager server={server} canEdit={isAdmin} />}
            {tab === 'access' && <AccessManager server={server} />}
            {tab === 'activity' && <ActivityLog serverId={id} />}
        </div>
    );
}

export default ServerControl;

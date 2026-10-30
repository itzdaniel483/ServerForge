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
import { Button, Card, Status, Stat, Notice, GameArt, Tabs } from '../ui';
import { themeColor } from '../theme';
import { NodeBadge } from '../nodes';
import { can, isRemote, nodeOffline } from '../nodeUtils';

// Server page (claude, UI v3 2026-10-30): one compact header row (thumbnail, name, status, address,
// power), stat tiles, underline tabs; the console fills the rest of the screen. Admin-only tabs are hidden from users.
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
    // A server on another machine is joined at that machine's address, not this panel's.
    const address = `${(isRemote(server) && server.nodeHost) || window.location.hostname}:${server.port || 27015}`;
    const offline = nodeOffline(server);

    // Page-wide: stay in this server's room (and rejoin after a reconnect) on every tab, so the hero
    // stats keep updating and tabs like Updates still get their completion events.
    useEffect(() => {
        const socket = getSocket();
        const watch = () => socket.emit('watch', id);
        watch();
        socket.on('connect', watch);
        const onStatus = s => {
            setStatus(s);
            if (s !== 'running') { setStats({ cpu: 0, memory: 0 }); setQuery(null); }
        };
        socket.on(`server-status-${id}`, onStatus);
        socket.on(`server-stats-${id}`, setStats);
        socket.on(`server-query-${id}`, setQuery);
        axios.get(`/api/server/${id}/status`).then(r => setStatus(r.data.status)).catch(() => {});
        return () => {
            socket.off('connect', watch);
            socket.off(`server-status-${id}`, onStatus);
            socket.off(`server-stats-${id}`, setStats);
            socket.off(`server-query-${id}`, setQuery);
        };
    }, [id]);

    // Console tab only: the terminal and its output.
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
        const onLog = d => term.write(d);
        const onStatus = s => term.write(s === 'running' ? '\r\n\x1b[32m● Server started\x1b[0m\r\n' : '\r\n\x1b[31m● Server stopped\x1b[0m\r\n');
        socket.on(`server-log-${id}`, onLog);
        socket.on(`server-status-${id}`, onStatus);
        axios.get(`/api/server/${id}/logs`).then(r => { if (r.data) term.write(r.data); else term.write('\x1b[90mNo output yet. Start the server to see its console.\x1b[0m\r\n'); }).catch(() => {});

        return () => {
            window.removeEventListener('resize', onResize);
            socket.off(`server-log-${id}`, onLog);
            socket.off(`server-status-${id}`, onStatus);
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

    const on = status === 'running' && !offline;
    const perms = server.perms || [];
    // User permission AND what the server's machine supports (local servers support everything).
    const NODE_ACTION = { power: 'power', console: 'console.command', files: 'files.read', backups: 'backups' };
    const may = p => (isAdmin || perms.includes(p)) && can(server, NODE_ACTION[p]);
    const admin = action => isAdmin && can(server, action);
    const tabs = [
        { id: 'console', label: 'Console', icon: TerminalIcon },
        ...(may('files') ? [{ id: 'files', label: 'Files', icon: FolderOpen }] : []),
        ...(admin('settings') ? [{ id: 'config', label: 'Settings', icon: SlidersHorizontal }] : []),
        ...(can(server, 'tasks') ? [{ id: 'tasks', label: 'Schedule', icon: CalendarClock }] : []),
        ...(may('backups') ? [{ id: 'backups', label: 'Backups', icon: Archive }] : []),
        ...(admin('update') ? [{ id: 'updates', label: 'Updates', icon: RefreshCw }] : []),
        // Plugins/workshop aren't federation actions, so they stay local-only.
        ...(isAdmin && !isRemote(server) ? [{ id: 'plugins', label: 'Plugins', icon: Package }] : []),
        // Access rules and the activity log live on this panel, so they work for any machine.
        ...(isAdmin ? [{ id: 'access', label: 'Access', icon: Users }, { id: 'activity', label: 'Activity', icon: History }] : []),
    ];

    const cpu = Number(stats.cpu || 0);
    const memMb = Number(stats.memory || 0) / 1048576;
    return (
        <div className="space-y-4">
            <Card className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-3">
                <GameArt gameId={server.gameId} name={server.game} className="w-24 h-[45px] rounded-sm shrink-0" />
                <div className="min-w-0 mr-auto">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-lg font-semibold text-white truncate">{server.name}</h1>
                        <Status status={offline ? 'nodeoffline' : status} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-gray-400">
                        <span>{server.game}</span>
                        {isRemote(server) && <NodeBadge s={server} />}
                        <button onClick={copyAddress} className="inline-flex items-center gap-1.5 h-5 px-1.5 rounded-sm border border-gray-700 bg-gray-950 font-mono text-gray-200 hover:border-accent-500" title="Copy address">
                            {address}<Copy size={11} className="text-gray-500" />{copied && <span className="font-sans text-go-300">Copied</span>}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {!may('power') || status === 'installing' || status === 'failed' ? null : on ? (
                        <>
                            <Button variant="stop" onClick={() => power(['stop'])}><Square size={14} />Stop</Button>
                            <Button onClick={() => power(['stop', 'start'])}><RotateCw size={14} />Restart</Button>
                        </>
                    ) : (
                        <Button variant="go" onClick={() => power(['start'])}><Play size={14} />Start</Button>
                    )}
                    {admin('delete') && <Button variant="quiet" onClick={remove} title="Delete server" aria-label="Delete server"><Trash2 size={14} /></Button>}
                </div>
            </Card>

            {offline && <Notice>{server.nodeName || 'This server\'s machine'} is offline. Its controls come back when it reconnects.</Notice>}
            {error && <Notice>{error}</Notice>}
            {server.installError && <Notice>{server.installError}</Notice>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat icon={Users} label="Players" value={on && query ? `${query.players}/${query.maxPlayers}` : '—'} meter={on && query?.maxPlayers ? (query.players / query.maxPlayers) * 100 : undefined} />
                <Stat icon={MapIcon} label="Map" value={on && query?.map ? query.map : '—'} />
                <Stat icon={Cpu} label="CPU" value={on ? `${cpu.toFixed(0)}%` : '—'} meter={on ? cpu : undefined} />
                <Stat icon={MemoryStick} label="Memory" value={on ? (memMb >= 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${memMb.toFixed(0)} MB`) : '—'} />
            </div>

            <Tabs items={tabs} value={tab} onChange={setTab} />

            {tab === 'console' && (
                <Card className="overflow-hidden flex flex-col !bg-gray-950">
                    <div className="h-9 px-3 flex items-center gap-2 border-b border-gray-800 text-xs font-medium text-gray-400">
                        <TerminalIcon size={13} />Console
                        {on && <span className="ml-auto flex items-center gap-1.5 text-go-300"><span className="w-1.5 h-1.5 rounded-full bg-go-400 animate-pulse" />streaming</span>}
                    </div>
                    <div ref={terminalRef} className="h-[calc(100vh-360px)] min-h-[360px] p-2" />
                    <div className="border-t border-gray-800 px-3 py-2 flex items-center gap-2 bg-gray-900">
                        <span className="font-mono text-accent-400">&gt;</span>
                        <input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={onKey} disabled={!on || !may('console')}
                            placeholder={!may('console') ? 'Read-only console' : on ? 'Type a command (status, say, changelevel…)' : 'Start the server to send commands'}
                            className="flex-1 h-7 bg-transparent text-white placeholder-gray-500 font-mono text-[13px] focus:outline-none disabled:cursor-not-allowed" />
                        <Button variant="primary" size="sm" onClick={send} disabled={!on || !may('console') || !command.trim()}><Send size={12} />Send</Button>
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

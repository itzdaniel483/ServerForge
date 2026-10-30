import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import axios from 'axios';
import { Play, Square, RotateCw, Terminal as TerminalIcon, FolderOpen, SlidersHorizontal, Archive, RefreshCw, Package, Copy, Trash2, Send } from 'lucide-react';
import FileManager from './FileManager';
import CommandEditor from './CommandEditor';
import BackupManager from './BackupManager';
import UpdateManager from './UpdateManager';
import PluginManager from './PluginManager';
import { getSocket, errorText } from '../api';
import { Button, Status, Stat, Notice } from '../ui';

// Server page (claude overhaul, 2026-10-30): one header band with the address, power buttons and
// live numbers; the console fills the rest of the screen. Admin-only tabs are hidden from users.
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
            theme: { background: '#0a0d12', foreground: '#e3e8ef', cursor: '#ff8a3d', selectionBackground: 'rgba(255,138,61,.3)' },
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
    const tabs = [
        { id: 'console', label: 'Console', icon: TerminalIcon },
        { id: 'files', label: 'Files', icon: FolderOpen },
        ...(isAdmin ? [{ id: 'config', label: 'Launch', icon: SlidersHorizontal }] : []),
        { id: 'backups', label: 'Backups', icon: Archive },
        ...(isAdmin ? [{ id: 'updates', label: 'Updates', icon: RefreshCw }, { id: 'plugins', label: 'Plugins', icon: Package }] : []),
    ];

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <div className="min-w-0 mr-auto">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl font-extrabold text-white truncate">{server.name}</h1>
                        <Status status={status} />
                    </div>
                    <div className="mt-2 flex items-center gap-3 flex-wrap text-sm">
                        <span className="text-gray-300">{server.game}</span>
                        <button onClick={copyAddress} className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-gray-900 ring-1 ring-gray-700 font-mono text-gray-100 hover:ring-ember-400" title="Copy address">
                            {address}<Copy size={14} className="text-gray-400" />{copied && <span className="font-sans text-go-300">Copied</span>}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {on ? (
                        <>
                            <Button variant="stop" size="lg" onClick={() => power(['stop'])}><Square size={18} />Stop</Button>
                            <Button size="lg" onClick={() => power(['stop', 'start'])}><RotateCw size={18} />Restart</Button>
                        </>
                    ) : (
                        <Button variant="go" size="lg" onClick={() => power(['start'])}><Play size={18} />Start</Button>
                    )}
                    {isAdmin && <Button variant="quiet" size="lg" onClick={remove} title="Delete server" aria-label="Delete server"><Trash2 size={18} /></Button>}
                </div>
            </div>

            {error && <Notice>{error}</Notice>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Players" value={on && query ? `${query.players}/${query.maxPlayers}` : '—'} />
                <Stat label="Map" value={on && query?.map ? query.map : '—'} />
                <Stat label="CPU" value={on ? `${Number(stats.cpu || 0).toFixed(0)}%` : '—'} />
                <Stat label="Memory" value={on ? `${(Number(stats.memory || 0) / 1048576).toFixed(0)} MB` : '—'} />
            </div>

            <div className="flex gap-1 border-b border-gray-800 overflow-x-auto">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                        className={`relative flex items-center gap-2 h-11 px-4 font-semibold whitespace-nowrap transition-colors ${tab === t.id ? 'text-white' : 'text-gray-400 hover:text-white'}`}>
                        <t.icon size={17} />{t.label}
                        {tab === t.id && <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t bg-ember-400" />}
                    </button>
                ))}
            </div>

            {tab === 'console' && (
                <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950 flex flex-col">
                    <div ref={terminalRef} className="h-[calc(100vh-480px)] min-h-[340px] p-3" />
                    <div className="border-t border-gray-800 p-3 flex items-center gap-2 bg-gray-900">
                        <span className="font-mono text-ember-400 font-bold">&gt;</span>
                        <input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={onKey} disabled={!on}
                            placeholder={on ? 'Type a command (status, say, changelevel…)' : 'Start the server to send commands'}
                            className="flex-1 h-10 bg-transparent text-white placeholder-gray-500 font-mono text-sm focus:outline-none disabled:cursor-not-allowed" />
                        <Button variant="primary" size="sm" onClick={send} disabled={!on || !command.trim()}><Send size={15} />Send</Button>
                    </div>
                </div>
            )}
            {tab === 'files' && <FileManager serverId={id} canEdit={isAdmin} />}
            {tab === 'config' && <CommandEditor serverId={id} serverData={server} />}
            {tab === 'backups' && <BackupManager serverId={id} canRestore={isAdmin} />}
            {tab === 'updates' && <UpdateManager server={server} />}
            {tab === 'plugins' && <PluginManager server={server} />}
        </div>
    );
}

export default ServerControl;

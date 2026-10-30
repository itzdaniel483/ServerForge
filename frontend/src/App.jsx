import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Server, Download, Settings as SettingsIcon, LogOut, ChevronRight, History, KeyRound, Cpu, MemoryStick, HardDrive, Palette, Check, Network } from 'lucide-react';
import ServerList from './components/ServerList';
import ServerControl from './components/ServerControl';
import Installer from './components/Installer';
import Settings from './components/Settings';
import Login from './components/Login';
import ActivityLog from './components/ActivityLog';
import ChangePassword from './components/ChangePassword';
import Nodes from './components/Nodes';
import { setToken } from './api';
import { PageHeader, Meter } from './ui';
import { THEMES, getTheme, applyTheme } from './theme';

// App shell (claude, UI v2 2026-10-30): full-width frosted top bar (Daniel prefers it to a sidebar)
// with pill nav, live host load and a theme picker. Server detail is reached from the Servers grid.
function App() {
    const [user, setUser] = useState(null);
    const [authMode, setAuthMode] = useState('local');
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('servers');
    const [server, setServer] = useState(null);

    useEffect(() => {
        (async () => {
            let mode = 'local';
            try { mode = (await axios.get('/api/auth-mode')).data.authMode; } catch { /* offline: show login */ }
            setAuthMode(mode);
            if (mode === 'external') {
                setToken(null);
                try {
                    await axios.get('/api/servers');
                    setUser({ username: 'Cloudflare user', role: 'admin', cloudflare: true });
                } catch { /* not signed in through Cloudflare */ }
            } else {
                const token = localStorage.getItem('token');
                const stored = localStorage.getItem('user');
                if (token && stored) {
                    setToken(token);
                    try {
                        await axios.get('/api/servers');   // token still valid?
                        setUser(JSON.parse(stored));
                    } catch {
                        localStorage.removeItem('token'); localStorage.removeItem('user'); setToken(null);
                    }
                }
            }
            setLoading(false);
        })();
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
        setServer(null);
        setTab('servers');
    }, []);

    useEffect(() => {
        window.addEventListener('serverforge:signout', logout);
        return () => window.removeEventListener('serverforge:signout', logout);
    }, [logout]);

    // Any 401 after login (expired token, deleted user) returns to the login screen.
    useEffect(() => {
        const id = axios.interceptors.response.use(r => r, err => {
            if (err?.response?.status === 401 && authMode === 'local' && localStorage.getItem('token')) logout();
            return Promise.reject(err);
        });
        return () => axios.interceptors.response.eject(id);
    }, [authMode, logout]);

    if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>;
    if (!user) return <Login authMode={authMode} onLogin={setUser} />;

    const go = t => { setTab(t); setServer(null); };
    const nav = [
        { id: 'servers', label: 'Servers', icon: Server },
        ...(user.role === 'admin' ? [{ id: 'installer', label: 'Install', icon: Download }, { id: 'nodes', label: 'Nodes', icon: Network }, { id: 'activity', label: 'Activity', icon: History }, { id: 'settings', label: 'Settings', icon: SettingsIcon }] : []),
        // Everyone with a local login can change their own password (it used to sit in admin-only Settings).
        ...(authMode === 'local' ? [{ id: 'account', label: 'Account', icon: KeyRound }] : []),
    ];

    return (
        <div className="min-h-screen flex flex-col">
            <header className="sticky top-0 z-30 bg-gray-950/70 backdrop-blur-xl border-b border-white/[.06]">
                <div className="min-h-[68px] px-4 sm:px-8 py-2 sm:py-0 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 sm:gap-6">
                    <button onClick={() => go('servers')} className="flex items-center gap-3 shrink-0" aria-label="ServerForge home">
                        <Logo size={36} />
                        <span className="hidden sm:block text-xl font-black tracking-tight text-white">Server<span className="text-gradient">Forge</span></span>
                    </button>
                    {/* Below sm the nav takes its own full-width row so the bar fits a 360px phone. */}
                    <nav aria-label="Main" className="order-last sm:order-none w-full sm:w-auto flex items-center justify-between sm:justify-start gap-1 p-1 rounded-2xl bg-white/[.03] border border-white/[.06]">
                        {nav.map(n => {
                            const on = tab === n.id;
                            return (
                                <button key={n.id} onClick={() => go(n.id)} aria-current={on ? 'page' : undefined} aria-label={n.label}
                                    className={`h-10 flex items-center gap-2 px-3 sm:px-4 rounded-xl font-semibold transition-all ${on ? 'bg-gradient-to-r from-accent-800 to-accent-600 text-white shadow-glow' : 'text-gray-300 hover:text-white hover:bg-white/[.06]'}`}>
                                    <n.icon size={17} />
                                    <span className="hidden md:inline">{n.label}</span>
                                </button>
                            );
                        })}
                    </nav>
                    <HostChips />
                    <div className="ml-auto flex items-center gap-2 sm:gap-3">
                        <ThemePicker />
                        <div className="hidden md:flex items-center gap-2.5 pl-3 border-l border-white/10">
                            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500 to-accent2-500 grid place-items-center text-xs font-black uppercase text-white">{user.username.slice(0, 2)}</span>
                            <div className="leading-tight">
                                <div className="text-sm font-bold text-white">{user.username}</div>
                                <div className="text-xs text-gray-400 capitalize">{user.role}</div>
                            </div>
                        </div>
                        {!user.cloudflare && (
                            <button onClick={logout} className="h-10 w-10 rounded-xl grid place-items-center text-gray-300 hover:text-white hover:bg-white/[.06]" title="Log out" aria-label="Log out">
                                <LogOut size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full px-4 sm:px-8 py-6 sm:py-8 space-y-6">
                {server && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <button onClick={() => setServer(null)} className="text-gray-400 hover:text-white">Servers</button>
                        <ChevronRight size={14} className="text-gray-600" />
                        <span className="text-white truncate">{server.name}</span>
                    </div>
                )}
                {tab === 'servers' && !server && <ServerList onOpen={setServer} onInstall={() => go('installer')} isAdmin={user.role === 'admin'} />}
                {tab === 'servers' && server && <ServerControl server={server} isAdmin={user.role === 'admin'} onDeleted={() => setServer(null)} />}
                {tab === 'installer' && <Installer onDone={() => go('servers')} />}
                {tab === 'nodes' && <Nodes />}
                {tab === 'settings' && <><PageHeader title="Settings" sub="Panel options, users and the download cache." /><Settings /></>}
                {tab === 'account' && <><PageHeader title="Account" sub={`Signed in as ${user.username}.`} /><ChangePassword /></>}
                {tab === 'activity' && <><PageHeader title="Activity" sub="Every change made in the panel." /><ActivityLog /></>}
            </main>
        </div>
    );
}

// Live host load in the top bar (codex's GET /api/host). Hidden until the endpoint answers.
function HostChips() {
    const [host, setHost] = useState(null);
    useEffect(() => {
        let alive = true;
        const load = () => axios.get('/api/host').then(r => alive && setHost(r.data)).catch(() => alive && setHost(null));
        load();
        const t = setInterval(load, 10000);
        return () => { alive = false; clearInterval(t); };
    }, []);
    if (!host) return null;
    const pct = (used, total) => (total ? Math.round((used / total) * 100) : null);
    const chips = [
        { icon: Cpu, label: 'CPU', v: host.cpuPercent },
        { icon: MemoryStick, label: 'RAM', v: pct(host.memory?.used, host.memory?.total) },
        { icon: HardDrive, label: 'Disk', v: pct(host.disk?.used, host.disk?.total) },
    ];
    return (
        <div className="hidden xl:flex items-center gap-2">
            {chips.filter(c => c.v !== null && c.v !== undefined).map(c => (
                <div key={c.label} className="w-28 px-3 py-1.5 rounded-xl bg-white/[.03] border border-white/[.06]" title={`Host ${c.label}`}>
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-400">
                        <span className="flex items-center gap-1"><c.icon size={12} className="text-accent-300" />{c.label}</span>
                        <span className="text-white tabular-nums">{Math.round(c.v)}%</span>
                    </div>
                    <Meter value={c.v} label={`Host ${c.label}`} className="mt-1" />
                </div>
            ))}
        </div>
    );
}

function ThemePicker() {
    const [current, setCurrent] = useState(getTheme());
    const [open, setOpen] = useState(false);
    const ref = React.useRef(null);
    // Close on Escape or a click outside; focus the selected palette when the menu opens.
    useEffect(() => {
        if (!open) return undefined;
        ref.current?.querySelector('[aria-checked="true"]')?.focus();
        const onKey = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
        const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
    }, [open]);
    return (
        <div className="relative" ref={ref}>
            <button onClick={() => setOpen(o => !o)} className="h-10 w-10 rounded-xl grid place-items-center text-gray-300 hover:text-white hover:bg-white/[.06]" title="Colour theme" aria-label="Colour theme" aria-haspopup="menu" aria-expanded={open}>
                <Palette size={18} />
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-56 p-2 glass rounded-2xl z-40" role="menu">
                    {THEMES.map(t => (
                        <button key={t.id} role="menuitemradio" aria-checked={current === t.id}
                            onClick={() => { applyTheme(t.id, true); setCurrent(t.id); setOpen(false); }}
                            className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-sm font-semibold ${current === t.id ? 'bg-white/[.08] text-white' : 'text-gray-300 hover:bg-white/[.05]'}`}>
                            <span className="w-7 h-7 rounded-lg ring-1 ring-white/20" style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
                            {t.label}
                            {current === t.id && <Check size={16} className="ml-auto text-accent-300" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Logo({ size = 32 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
            <defs>
                <linearGradient id="sf-logo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="rgb(var(--a-500))" />
                    <stop offset="1" stopColor="rgb(var(--b-500))" />
                </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#sf-logo)" />
            <path d="M8 21h16l-2 4H10z" fill="#fff" />
            <path d="M11 9h10v4h-3v6h-4v-6h-3z" fill="#fff" />
            <circle cx="24" cy="8" r="2" fill="#fff" opacity=".8" />
        </svg>
    );
}

export default App;

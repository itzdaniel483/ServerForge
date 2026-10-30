import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Server, Download, Settings as SettingsIcon, LogOut, ChevronRight, History, KeyRound, Cpu, MemoryStick, HardDrive, Palette, Check, Network, Menu } from 'lucide-react';
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

// App shell (claude, UI v3 2026-10-30): fixed left sidebar (nav, host load, user, theme) and a slim
// breadcrumb bar. Daniel asked for a "complete change … locations of it all" away from the v2 top bar.
function App() {
    const [user, setUser] = useState(null);
    const [authMode, setAuthMode] = useState('local');
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('servers');
    const [server, setServer] = useState(null);
    const [menu, setMenu] = useState(false);

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

    // Escape closes the phone menu drawer.
    useEffect(() => {
        if (!menu) return undefined;
        const onKey = e => { if (e.key === 'Escape') setMenu(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [menu]);

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

    const go = t => { setTab(t); setServer(null); setMenu(false); };
    const nav = [
        { id: 'servers', label: 'Servers', icon: Server },
        ...(user.role === 'admin' ? [{ id: 'installer', label: 'Install', icon: Download }, { id: 'nodes', label: 'Nodes', icon: Network }, { id: 'activity', label: 'Activity', icon: History }, { id: 'settings', label: 'Settings', icon: SettingsIcon }] : []),
        // Everyone with a local login can change their own password (it used to sit in admin-only Settings).
        ...(authMode === 'local' ? [{ id: 'account', label: 'Account', icon: KeyRound }] : []),
    ];

    const page = nav.find(n => n.id === tab);
    return (
        <div className="min-h-screen lg:pl-56">
            {/* Sidebar: fixed on desktop, a drawer on small screens. */}
            <aside className={`fixed inset-y-0 left-0 z-40 w-56 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform lg:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Sidebar">
                <button onClick={() => go('servers')} className="h-12 px-4 flex items-center gap-2.5 border-b border-gray-800 shrink-0" aria-label="ServerForge home">
                    <Logo size={22} />
                    <span className="text-[15px] font-semibold tracking-tight text-white">ServerForge</span>
                </button>
                <nav aria-label="Main" className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
                    {nav.map(n => {
                        const on = tab === n.id;
                        return (
                            <button key={n.id} onClick={() => go(n.id)} aria-current={on ? 'page' : undefined}
                                className={`relative w-full h-8 flex items-center gap-2.5 px-2.5 rounded text-[13px] font-medium transition-colors ${on ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}>
                                {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-500" />}
                                <n.icon size={16} className={on ? 'text-accent-400' : ''} />{n.label}
                            </button>
                        );
                    })}
                </nav>
                <HostLoad />
                <div className="border-t border-gray-800 p-2 flex items-center gap-2">
                    <span className="w-7 h-7 rounded bg-gray-800 border border-gray-700 grid place-items-center text-[11px] font-semibold uppercase text-gray-200 shrink-0">{user.username.slice(0, 2)}</span>
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-[13px] font-medium text-white truncate">{user.username}</div>
                        <div className="text-[11px] text-gray-500 capitalize">{user.role}</div>
                    </div>
                    <ThemePicker />
                    {!user.cloudflare && (
                        <button onClick={logout} className="h-7 w-7 rounded grid place-items-center text-gray-400 hover:text-white hover:bg-gray-800" title="Log out" aria-label="Log out">
                            <LogOut size={15} />
                        </button>
                    )}
                </div>
            </aside>
            {menu && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenu(false)} aria-hidden="true" />}

            <header className="sticky top-0 z-20 h-12 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 sm:px-6 flex items-center gap-3">
                <button onClick={() => setMenu(true)} className="lg:hidden h-8 w-8 -ml-1 rounded grid place-items-center text-gray-300 hover:bg-gray-800" aria-label="Open menu">
                    <Menu size={18} />
                </button>
                <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] min-w-0">
                    {server ? (
                        <>
                            <button onClick={() => setServer(null)} className="text-gray-400 hover:text-white">Servers</button>
                            <ChevronRight size={13} className="text-gray-600 shrink-0" />
                            <span className="text-white font-medium truncate">{server.name}</span>
                        </>
                    ) : <span className="text-white font-medium">{page?.label}</span>}
                </nav>
            </header>

            <main className="w-full px-4 sm:px-6 py-5 space-y-5">
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

// Host load in the sidebar (codex's GET /api/host). Hidden until the endpoint answers.
function HostLoad() {
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
    const rows = [
        { icon: Cpu, label: 'CPU', v: host.cpuPercent },
        { icon: MemoryStick, label: 'RAM', v: pct(host.memory?.used, host.memory?.total) },
        { icon: HardDrive, label: 'Disk', v: pct(host.disk?.used, host.disk?.total) },
    ].filter(r => r.v !== null && r.v !== undefined);
    return (
        <div className="px-4 py-3 border-t border-gray-800 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">This host</div>
            {rows.map(r => (
                <div key={r.label}>
                    <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-gray-400"><r.icon size={12} />{r.label}</span>
                        <span className="text-gray-200 tabular-nums">{Math.round(r.v)}%</span>
                    </div>
                    <Meter value={r.v} label={`Host ${r.label}`} className="mt-1" />
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
            <button onClick={() => setOpen(o => !o)} className="h-7 w-7 rounded grid place-items-center text-gray-400 hover:text-white hover:bg-gray-800" title="Colour theme" aria-label="Colour theme" aria-haspopup="menu" aria-expanded={open}>
                <Palette size={15} />
            </button>
            {open && (
                <div className="absolute left-0 bottom-9 w-48 p-1 bg-gray-900 border border-gray-700 rounded-md shadow-xl z-50" role="menu">
                    {THEMES.map(t => (
                        <button key={t.id} role="menuitemradio" aria-checked={current === t.id}
                            onClick={() => { applyTheme(t.id, true); setCurrent(t.id); setOpen(false); }}
                            className={`w-full flex items-center gap-2.5 px-2 h-8 rounded text-[13px] ${current === t.id ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/60'}`}>
                            <span className="w-4 h-4 rounded-sm" style={{ background: t.swatch[0] }} />
                            {t.label}
                            {current === t.id && <Check size={14} className="ml-auto text-accent-400" />}
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
            <rect width="32" height="32" rx="5" fill="rgb(var(--a-600))" />
            <path d="M8 21h16l-2 4H10z" fill="#fff" />
            <path d="M11 9h10v4h-3v6h-4v-6h-3z" fill="#fff" />
            <circle cx="24" cy="8" r="2" fill="#fff" opacity=".8" />
        </svg>
    );
}

export default App;

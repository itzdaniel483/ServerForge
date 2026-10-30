import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Server, Download, Settings as SettingsIcon, LogOut, ChevronRight, History } from 'lucide-react';
import ServerList from './components/ServerList';
import ServerControl from './components/ServerControl';
import Installer from './components/Installer';
import Settings from './components/Settings';
import Login from './components/Login';
import ActivityLog from './components/ActivityLog';
import { setToken } from './api';

// App shell (claude overhaul, 2026-10-30): full-width top bar instead of a sidebar, so every
// screen gets the whole desktop width. Server detail is reached from the Servers grid.
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
        ...(user.role === 'admin' ? [{ id: 'installer', label: 'Install', icon: Download }, { id: 'activity', label: 'Activity', icon: History }, { id: 'settings', label: 'Settings', icon: SettingsIcon }] : []),
    ];

    return (
        <div className="min-h-screen flex flex-col">
            <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800">
                <div className="h-16 px-4 sm:px-8 flex items-center gap-4 sm:gap-8">
                    <button onClick={() => go('servers')} className="flex items-center gap-2.5 shrink-0" aria-label="ServerForge home">
                        <Logo />
                        <span className="hidden sm:block text-lg font-extrabold tracking-tight text-white">Server<span className="text-ember-400">Forge</span></span>
                    </button>
                    <nav className="flex items-center gap-1 h-full">
                        {nav.map(n => {
                            const on = tab === n.id;
                            return (
                                <button key={n.id} onClick={() => go(n.id)} aria-current={on ? 'page' : undefined}
                                    className={`relative h-full flex items-center gap-2 px-3 sm:px-4 font-semibold transition-colors ${on ? 'text-white' : 'text-gray-400 hover:text-white'}`}>
                                    <n.icon size={18} />
                                    <span className="hidden sm:inline">{n.label}</span>
                                    {on && <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t bg-ember-400" />}
                                </button>
                            );
                        })}
                    </nav>
                    <div className="ml-auto flex items-center gap-3">
                        <div className="hidden md:flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-full bg-gray-800 ring-1 ring-gray-700 grid place-items-center text-xs font-bold uppercase text-gray-200">{user.username.slice(0, 2)}</span>
                            <span className="text-sm font-semibold text-gray-200">{user.username}</span>
                        </div>
                        {!user.cloudflare && (
                            <button onClick={logout} className="h-9 px-3 rounded-lg flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white hover:bg-gray-800" title="Log out">
                                <LogOut size={16} /><span className="hidden sm:inline">Log out</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full px-4 sm:px-8 py-6 sm:py-8">
                {server && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold mb-5">
                        <button onClick={() => setServer(null)} className="text-gray-400 hover:text-white">Servers</button>
                        <ChevronRight size={14} className="text-gray-600" />
                        <span className="text-white truncate">{server.name}</span>
                    </div>
                )}
                {tab === 'servers' && !server && <ServerList onOpen={setServer} onInstall={() => go('installer')} isAdmin={user.role === 'admin'} />}
                {tab === 'servers' && server && <ServerControl server={server} isAdmin={user.role === 'admin'} onDeleted={() => setServer(null)} />}
                {tab === 'installer' && <Installer onDone={() => go('servers')} />}
                {tab === 'settings' && <Settings />}
                {tab === 'activity' && <div className="space-y-6"><h1 className="text-3xl font-extrabold text-white">Activity</h1><ActivityLog /></div>}
            </main>
        </div>
    );
}

export function Logo({ size = 32 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#c4470a" />
            <path d="M8 21h16l-2 4H10z" fill="#fff" />
            <path d="M11 9h10v4h-3v6h-4v-6h-3z" fill="#fff" />
            <circle cx="24" cy="8" r="2" fill="#ffa766" />
        </svg>
    );
}

export default App;

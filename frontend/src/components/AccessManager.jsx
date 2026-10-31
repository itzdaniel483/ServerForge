import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Save, Plus, RefreshCw, X } from 'lucide-react';
import { errorText } from '../api';
import { Button, Card, Notice, inputClass } from '../ui';

// Access tab (claude, 2026-10-30): give non-admin users this server, with chosen permissions.
// The owner (who installed it) always has everything; admins always have everything.
const PERMS = [
    { key: 'power', label: 'Start / stop' },
    { key: 'console', label: 'Console commands' },
    { key: 'files', label: 'View files' },
    { key: 'backups', label: 'Backups' },
];

export default function AccessManager({ server }) {
    const [users, setUsers] = useState([]);
    const [list, setList] = useState(server.access || []);
    const [pick, setPick] = useState('');
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [usersBusy, setUsersBusy] = useState(false);
    const usersRequest = useRef(0);

    const refreshUsers = useCallback(async () => {
        const request = ++usersRequest.current;
        setUsersBusy(true);
        try {
            const { data } = await axios.get('/api/users');
            if (request !== usersRequest.current) return;
            const available = data.filter(u => u.role !== 'admin');
            setUsers(available);
            setPick(current => current && available.some(u => u.username === current) ? current : '');
        } catch (err) {
            if (request === usersRequest.current) setMsg({ ok: false, text: errorText(err) });
        } finally {
            if (request === usersRequest.current) setUsersBusy(false);
        }
    }, []);

    useEffect(() => {
        refreshUsers();
        const onFocus = () => refreshUsers();
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshUsers();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [refreshUsers, server.id]);

    const toggle = (username, perm) => setList(l => l.map(a => a.username !== username ? a : { ...a, perms: a.perms.includes(perm) ? a.perms.filter(p => p !== perm) : [...a.perms, perm] }));
    const addUser = () => { if (pick && !list.some(a => a.username === pick)) setList([...list, { username: pick, perms: ['view', 'power', 'console'] }]); setPick(''); };

    async function save() {
        setBusy(true); setMsg(null);
        try { const r = await axios.put(`/api/server/${server.id}/access`, { access: list }); setList(r.data.access); setMsg({ ok: true, text: 'Saved.' }); }
        catch (err) { setMsg({ ok: false, text: errorText(err) }); }
        finally { setBusy(false); }
    }

    const free = users.filter(u => !list.some(a => a.username === u.username));

    return (
        <Card className="p-4 space-y-5 max-w-4xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold text-white">Who can use this server</h2>
                    <div className="text-sm text-gray-400">Owner <span className="font-semibold text-gray-200">{server.owner || 'admin'}</span> and admins can do everything. Admin accounts are not assignable here.</div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={refreshUsers} disabled={usersBusy} title="Reload users available for server access">
                        <RefreshCw size={16} className={usersBusy ? 'animate-spin' : ''} />{usersBusy ? 'Refreshing…' : 'Refresh users'}
                    </Button>
                    <Button variant="primary" onClick={save} disabled={busy}><Save size={17} />Save</Button>
                </div>
            </div>
            {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
            {list.length === 0 && <div className="text-gray-300">No other users yet.</div>}
            {list.map(a => (
                <div key={a.username} className="flex flex-wrap items-center gap-3 p-3 rounded-lg ring-1 ring-gray-800">
                    <span className="font-bold text-white w-40 truncate">{a.username}</span>
                    {PERMS.map(p => (
                        <button key={p.key} onClick={() => toggle(a.username, p.key)} aria-pressed={a.perms.includes(p.key)}
                            className={`h-9 px-3 rounded-lg text-sm font-semibold ${a.perms.includes(p.key) ? 'bg-go-600 text-white' : 'bg-gray-950 text-gray-400 ring-1 ring-gray-700'}`}>{p.label}</button>
                    ))}
                    <button onClick={() => setList(list.filter(x => x.username !== a.username))} className="ml-auto p-2 text-gray-400 hover:text-white" aria-label={`Remove ${a.username}`}><X size={18} /></button>
                </div>
            ))}
            <div className="flex gap-2">
                <select className={`${inputClass} max-w-xs`} value={pick} onChange={e => setPick(e.target.value)}>
                    <option value="">{usersBusy ? 'Loading users…' : free.length ? 'Add a user…' : 'No more users (create them in Settings → Users)'}</option>
                    {free.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
                </select>
                <Button onClick={addUser} disabled={!pick}><Plus size={17} />Add</Button>
            </div>
        </Card>
    );
}

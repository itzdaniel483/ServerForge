// Settings (claude, UI v3 2026-10-30): underline tabs; General is a column of titled panels,
// Users is a table. Logic unchanged from v2.
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Trash2, Plus, X } from 'lucide-react';
import axios from 'axios';
import CacheManager from './CacheManager';
import { Button, Panel, Tabs, Field, Notice, inputClass } from '../ui';

function Settings() {
    const [activeTab, setActiveTab] = useState('general');
    return (
        <div className="space-y-4">
            <Tabs items={[{ id: 'general', label: 'General' }, { id: 'users', label: 'Users' }, { id: 'cache', label: 'Manage Cache' }]} value={activeTab} onChange={setActiveTab} />
            {activeTab === 'general' && (
                <div className="grid xl:grid-cols-2 gap-4 items-start">
                    <AuthSettings />
                    <SteamSettings />
                    <Panel title="Restart backend">
                        <p className="text-sm text-gray-400">Restart ServerForge from the server console (Apps → ServerForge → Restart).</p>
                        <div className="mt-3 flex items-center gap-2 text-xs text-warn-300"><AlertTriangle size={13} className="shrink-0" />Running game servers are stopped by a restart. Check nothing is in use first.</div>
                    </Panel>
                </div>
            )}
            {activeTab === 'users' && <UserManager />}
            {activeTab === 'cache' && <CacheManager />}
        </div>
    );
}

function SteamSettings() {
    const [apiKey, setApiKey] = useState('');
    const [keySet, setKeySet] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        axios.get('/api/settings')
            .then(res => {
                // The server never sends the key back, only whether one is saved.
                setKeySet(!!res.data.steamApiKeySet);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSuccess(false);
        try {
            await axios.post('/api/settings', { steamApiKey: apiKey });
            if (apiKey.trim()) setKeySet(true);
            setApiKey('');
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch {
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Panel title="Steam Web API key">
            {loading ? <div className="text-sm text-gray-500">Loading…</div> : (
                <div className="space-y-2">
                    <p className="text-sm text-gray-400">Used for servers that don't have their own key.</p>
                    <div className="flex gap-2">
                        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} aria-label="Steam Web API key"
                            placeholder={keySet ? 'Saved. Type a new key to replace it' : '32-character API key'} className={inputClass} />
                        <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                    </div>
                    {success && <Notice tone="ok">Saved.</Notice>}
                    <p className="text-xs text-gray-500">Get a key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">steamcommunity.com/dev/apikey</a></p>
                </div>
            )}
        </Panel>
    );
}

export default Settings;

function UserManager() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
    const [error, setError] = useState('');

    const fetchUsers = async () => {
        try {
            const res = await axios.get('/api/users');
            setUsers(res.data);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch users:', err);
            setLoading(false);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchUsers();
    }, []);

    const handleAddUser = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await axios.post('/api/users', newUser);
            setShowAddForm(false);
            setNewUser({ username: '', password: '', role: 'user' });
            fetchUsers();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add user');
        }
    };

    const handleDeleteUser = async (id, username) => {
        if (!confirm(`Are you sure you want to delete user ${username}?`)) return;
        try {
            await axios.delete(`/api/users/${id}`);
            fetchUsers();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete user');
        }
    };

    return (
        <Panel title="Users" bodyClassName="" actions={!showAddForm && <Button size="sm" variant="primary" onClick={() => setShowAddForm(true)}><Plus size={13} />Add user</Button>}>
            {showAddForm && (
                <form onSubmit={handleAddUser} className="p-4 border-b border-gray-800 space-y-3">
                    {error && <Notice>{error}</Notice>}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_10rem_auto] gap-3 items-end">
                        <Field label="Username"><input type="text" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className={inputClass} required /></Field>
                        <Field label="Password"><input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className={inputClass} required /></Field>
                        <Field label="Role">
                            <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className={inputClass}>
                                <option value="user">User (shared servers only)</option>
                                <option value="admin">Admin</option>
                            </select>
                        </Field>
                        <div className="flex gap-2">
                            <Button type="submit" variant="primary">Create</Button>
                            <Button type="button" variant="quiet" onClick={() => setShowAddForm(false)} aria-label="Cancel"><X size={14} /></Button>
                        </div>
                    </div>
                </form>
            )}
            {loading ? <div className="p-4 text-sm text-gray-400">Loading…</div> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr><th className="th">User</th><th className="th">Role</th><th className="th hidden sm:table-cell">Created</th><th className="th text-right">Actions</th></tr></thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="hover:bg-gray-800/40">
                                    <td className="td font-medium text-white">{user.username}</td>
                                    <td className="td"><span className={`inline-flex h-5 px-1.5 items-center rounded-sm border text-[12px] capitalize ${user.role === 'admin' ? 'border-accent-500/50 text-accent-300' : 'border-gray-700 text-gray-300'}`}>{user.role}</span></td>
                                    <td className="td hidden sm:table-cell text-gray-400">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</td>
                                    <td className="td text-right">
                                        <Button size="sm" variant="quiet" onClick={() => handleDeleteUser(user.id, user.username)} title="Delete user" aria-label={`Delete user ${user.username}`}><Trash2 size={13} /></Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Panel>
    );
}

function AuthSettings() {
    const [authMode, setAuthMode] = useState('local');
    const [cfConfig, setCfConfig] = useState({ cfAccessTeamDomain: '', cfAccessAud: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        axios.get('/api/settings')
            .then(res => {
                setAuthMode(res.data.authMode || 'local');
                setCfConfig({
                    cfAccessTeamDomain: res.data.cfAccessTeamDomain || '',
                    cfAccessAud: res.data.cfAccessAud || ''
                });
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const handleSave = async (mode) => {
        setSaving(true);
        setSuccess(false);
        try {
            const payload = { authMode: mode };
            if (mode === 'external') {
                payload.cfAccessTeamDomain = cfConfig.cfAccessTeamDomain;
                payload.cfAccessAud = cfConfig.cfAccessAud;
            }
            await axios.post('/api/settings', payload);
            setAuthMode(mode);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            alert('Failed to save settings: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const option = (mode, title, sub, onClick) => (
        <label className={`flex items-start gap-2.5 p-3 rounded border cursor-pointer ${authMode === mode ? 'border-accent-500 bg-accent-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type="radio" name="authMode" className="mt-0.5 accent-accent-500" checked={authMode === mode} onChange={onClick} disabled={saving} />
            <span><span className="block text-sm font-medium text-white">{title}</span><span className="block text-xs text-gray-400">{sub}</span></span>
        </label>
    );

    return (
        <Panel title="Sign-in method">
            {loading ? <div className="text-sm text-gray-500">Loading…</div> : (
                <div className="space-y-3">
                    <div className="grid sm:grid-cols-2 gap-2">
                        {option('local', 'Local accounts', 'Username and password', () => handleSave('local'))}
                        {option('external', 'Cloudflare Access', 'Zero Trust / proxy sign-in', () => setAuthMode('external'))}
                    </div>
                    {authMode === 'external' && (
                        <div className="space-y-3 pt-1">
                            <Field label="Team domain">
                                <input type="text" value={cfConfig.cfAccessTeamDomain} onChange={e => setCfConfig({ ...cfConfig, cfAccessTeamDomain: e.target.value })} placeholder="https://example.cloudflareaccess.com" className={inputClass} />
                            </Field>
                            <Field label="Audience tag (AUD)">
                                <input type="password" value={cfConfig.cfAccessAud} onChange={e => setCfConfig({ ...cfConfig, cfAccessAud: e.target.value })} placeholder="Cloudflare application AUD" className={inputClass} />
                            </Field>
                            <div className="flex justify-end"><Button variant="primary" onClick={() => handleSave('external')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>
                        </div>
                    )}
                    {success && <Notice tone="ok">Saved.</Notice>}
                </div>
            )}
        </Panel>
    );
}

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, AlertTriangle, Terminal, RefreshCw, Download, Trash2, HardDrive, Package, Users, Shield, Plus, X } from 'lucide-react';
import axios from 'axios';
import CacheManager from './CacheManager';



function Settings() {
    const [activeTab, setActiveTab] = useState('general');


    return (
        <div className="space-y-6">
            {/* Tabs */}
            <div className="inline-flex gap-1 p-1 rounded-2xl bg-white/[.03] border border-white/[.06]">
                <button
                    onClick={() => setActiveTab('general')}
                    className={`h-10 px-4 rounded-xl font-semibold transition-all ${activeTab === 'general' ? 'bg-white/[.1] text-white ring-1 ring-white/10' : 'text-gray-400 hover:text-white hover:bg-white/[.04]'}`}
                >
                    General
                </button>
                <button
                    onClick={() => setActiveTab('users')}
                    className={`h-10 px-4 rounded-xl font-semibold transition-all ${activeTab === 'users' ? 'bg-white/[.1] text-white ring-1 ring-white/10' : 'text-gray-400 hover:text-white hover:bg-white/[.04]'}`}
                >
                    Users
                </button>
                <button
                    onClick={() => setActiveTab('cache')}
                    className={`h-10 px-4 rounded-xl font-semibold transition-all ${activeTab === 'cache' ? 'bg-white/[.1] text-white ring-1 ring-white/10' : 'text-gray-400 hover:text-white hover:bg-white/[.04]'}`}
                >
                    Manage Cache
                </button>
            </div>

            {activeTab === 'general' && (
                <div className="glass rounded-2xl p-8 space-y-6">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-2 flex items-center">
                            <SettingsIcon size={20} className="mr-3 text-blue-400" />
                            System Information
                        </h3>
                        <p className="text-gray-400 text-sm mb-6">
                            About this panel
                        </p>
                    </div>

                    <div className="border-t border-gray-700/50 pt-6">
                        <div className="glass rounded-2xl p-6">
                            <div className="flex items-start">
                                <Terminal className="text-blue-400 mr-4 mt-1" size={24} />
                                <div className="flex-1">
                                    <h4 className="text-lg font-semibold text-white mb-2">Restart Backend</h4>
                                    <p className="text-gray-400 text-sm mb-4">
                                        Restart ServerForge from the server console (Apps → ServerForge → Restart).
                                    </p>
                                    <div className="flex items-center text-yellow-400 text-sm bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                                        <AlertTriangle size={16} className="mr-2 flex-shrink-0" />
                                        <span>Active game servers will not be affected during a backend restart.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-700/50 pt-6">
                        <AuthSettings />
                    </div>

                    <div className="border-t border-gray-700/50 pt-6">
                        <SteamSettings />
                    </div>
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

    if (loading) return <div className="text-gray-500">Loading settings...</div>;

    return (
        <div className="glass rounded-2xl p-6">
            <div className="flex items-start">
                <div className="mr-4 mt-1 text-blue-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                </div>
                <div className="flex-1">
                    <h4 className="text-lg font-semibold text-white mb-2">Steam Integration</h4>
                    <p className="text-gray-400 text-sm mb-4">
                        Configure your global Steam Web API Key. This key will be used for all servers that don't have a specific key configured.
                    </p>

                    <div className="max-w-xl">
                        <label className="block text-gray-400 text-sm font-medium mb-2">Steam Web API Key</label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={keySet ? 'Saved. Type a new key to replace it' : 'Enter your 32-character API Key'}
                                className="flex-1 bg-gray-950 text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                            />
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-900 hover:to-accent-700 shadow-glow text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                        {success && <p className="text-green-400 text-sm mt-2">Settings saved successfully!</p>}
                        <p className="text-gray-600 text-xs mt-2">
                            Get your key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">steamcommunity.com/dev/apikey</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
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

    if (loading) return <div className="text-gray-400">Loading users...</div>;

    return (
        <div className="glass rounded-2xl p-8 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center">
                        <Users size={20} className="mr-3 text-blue-400" />
                        User Management
                    </h3>
                    <p className="text-gray-400 text-sm">
                        Manage users who can access the admin panel.
                    </p>
                </div>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-900 hover:to-accent-700 shadow-glow text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                >
                    <Plus size={18} />
                    Add User
                </button>
            </div>

            {showAddForm && (
                <div className="glass rounded-2xl p-6 animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-semibold text-white">Add New User</h4>
                        <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>
                    {error && <div className="text-red-400 text-sm mb-4">{error}</div>}
                    <form onSubmit={handleAddUser} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-gray-400 text-xs font-medium mb-1">Username</label>
                                <input
                                    type="text"
                                    value={newUser.username}
                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                    className="w-full bg-gray-950 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-medium mb-1">Password</label>
                                <input
                                    type="password"
                                    value={newUser.password}
                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                    className="w-full bg-gray-950 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-medium mb-1">Role</label>
                                <select
                                    value={newUser.role}
                                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                    className="w-full bg-gray-950 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-medium">
                                Create User
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-3">
                {users.map(user => (
                    <div key={user.id} className="glass rounded-2xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 font-bold uppercase">
                                {user.username.substring(0, 2)}
                            </div>
                            <div>
                                <h4 className="font-semibold text-white">{user.username}</h4>
                                <div className="text-xs text-gray-400 mt-1 flex gap-2">
                                    <span className="capitalize bg-gray-800 px-2 py-0.5 rounded text-gray-300">{user.role}</span>
                                    <span>Created: {new Date(user.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDeleteUser(user.id, user.username)}
                            className="text-gray-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Delete User"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
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
            // If saving specific config (not just mode switch)
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

    if (loading) return <div className="text-gray-500">Loading auth settings...</div>;

    return (
        <div className="glass rounded-2xl p-6">
            <div className="flex items-start">
                <div className="mr-4 mt-1 text-blue-400">
                    <Shield size={24} />
                </div>
                <div className="flex-1">
                    <h4 className="text-lg font-semibold text-white mb-2">Authentication Mode</h4>
                    <p className="text-gray-400 text-sm mb-4">
                        Choose how users access the panel.
                    </p>

                    <div className="flex gap-4 mb-6">
                        <button
                            onClick={() => handleSave('local')}
                            disabled={saving}
                            className={`flex-1 p-4 rounded-xl border transition-all ${authMode === 'local'
                                ? 'bg-blue-600/20 border-blue-500 text-white'
                                : 'bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-600'
                                }`}
                        >
                            <div className="font-semibold mb-1">Local Authentication</div>
                            <div className="text-xs opacity-70">Username & Password login</div>
                        </button>

                        <button
                            onClick={() => setAuthMode('external')}
                            disabled={saving}
                            className={`flex-1 p-4 rounded-xl border transition-all ${authMode === 'external'
                                ? 'bg-blue-600/20 border-blue-500 text-white'
                                : 'bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-600'
                                }`}
                        >
                            <div className="font-semibold mb-1">External Authentication</div>
                            <div className="text-xs opacity-70">Cloudflare Zero Trust / Proxy</div>
                        </button>
                    </div>

                    {authMode === 'external' && (
                        <div className="bg-gray-950/50 rounded-xl p-6 border border-gray-700/50 animate-in fade-in slide-in-from-top-2">
                            <h5 className="font-semibold text-white mb-4 flex items-center">
                                <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                                Cloudflare Zero Trust Configuration
                            </h5>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-gray-400 text-xs font-medium mb-1">Team Domain</label>
                                    <input
                                        type="text"
                                        value={cfConfig.cfAccessTeamDomain}
                                        onChange={e => setCfConfig({ ...cfConfig, cfAccessTeamDomain: e.target.value })}
                                        placeholder="https://example.cloudflareaccess.com"
                                        className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-400 text-xs font-medium mb-1">Audience Tag (AUD)</label>
                                    <input
                                        type="password"
                                        value={cfConfig.cfAccessAud}
                                        onChange={e => setCfConfig({ ...cfConfig, cfAccessAud: e.target.value })}
                                        placeholder="Enter your Cloudflare Application Token (AUD)"
                                        className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={() => handleSave('external')}
                                        disabled={saving}
                                        className="bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-900 hover:to-accent-700 shadow-glow text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save Configuration'}
                                    </button>
                                </div>
                                {success && <p className="text-green-400 text-sm text-right">Settings saved successfully!</p>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

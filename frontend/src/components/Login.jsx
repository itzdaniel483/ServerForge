import React, { useState } from 'react';
import axios from 'axios';
import { Shield } from 'lucide-react';
import { setToken, errorText } from '../api';
import { Button, Field, Notice, inputClass } from '../ui';
import { Logo } from '../App';

// Login (claude overhaul, 2026-10-30). No default credentials on screen any more, and the user is
// saved alongside the token (it wasn't before, so every reload logged you out).
function Login({ authMode, onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice] = useState(() => {
        const text = sessionStorage.getItem('loginNotice');
        sessionStorage.removeItem('loginNotice');
        return text || '';
    });

    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const { token, user } = (await axios.post('/api/login', { username, password })).data;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            setToken(token);
            onLogin(user);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="min-h-screen grid lg:grid-cols-2">
            <div className="hidden lg:flex flex-col justify-between p-12 bg-gray-900 border-r border-gray-800">
                <div className="flex items-center gap-3"><Logo size={40} /><span className="text-2xl font-extrabold text-white">Server<span className="text-ember-400">Forge</span></span></div>
                <div>
                    <h1 className="text-5xl font-extrabold leading-tight text-white">Run your game servers<br /><span className="text-ember-400">from one place.</span></h1>
                    <p className="mt-5 text-lg text-gray-300">Install. Start. Watch the console. Back up.</p>
                </div>
                <div className="text-sm text-gray-500">ServerForge</div>
            </div>

            <div className="flex items-center justify-center p-6">
                <div className="w-full max-w-sm">
                    <div className="lg:hidden flex items-center gap-3 mb-10"><Logo size={36} /><span className="text-xl font-extrabold text-white">Server<span className="text-ember-400">Forge</span></span></div>
                    {authMode === 'external' ? (
                        <div className="space-y-5">
                            <Shield size={40} className="text-ember-400" />
                            <h2 className="text-3xl font-bold text-white">Sign in with Cloudflare</h2>
                            <p className="text-gray-300">Open ServerForge from its Cloudflare Access address.</p>
                            <Button variant="primary" size="lg" className="w-full" onClick={() => window.location.reload()}>Try again</Button>
                        </div>
                    ) : (
                        <form onSubmit={submit} className="space-y-5">
                            <h2 className="text-3xl font-bold text-white mb-2">Sign in</h2>
                            {notice && !error && <Notice tone="ok">{notice}</Notice>}
                            {error && <Notice>{error}</Notice>}
                            <Field label="Username">
                                <input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required />
                            </Field>
                            <Field label="Password">
                                <input className={inputClass} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
                            </Field>
                            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Login;

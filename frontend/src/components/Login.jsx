import React, { useState } from 'react';
import axios from 'axios';
import { Shield } from 'lucide-react';
import { setToken, errorText } from '../api';
import { Button, Field, Notice, inputClass } from '../ui';
import { Logo } from '../App';

// Login (claude, UI v3 2026-10-30): one plain sign-in panel. No default credentials on screen any more, and the user is
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
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <div className="flex items-center gap-2.5 mb-5"><Logo size={26} /><span className="text-base font-semibold tracking-tight text-white">ServerForge</span></div>
                <div className="bg-gray-900 border border-gray-800 rounded-md">
                    <div className="h-10 px-4 flex items-center border-b border-gray-800 text-sm font-semibold text-gray-100">{authMode === 'external' ? 'Sign in with Cloudflare' : 'Sign in'}</div>
                    <div className="p-4">
                        {authMode === 'external' ? (
                            <div className="space-y-3">
                                <p className="text-sm text-gray-300 flex gap-2"><Shield size={15} className="text-accent-400 shrink-0 mt-0.5" />Open ServerForge from its Cloudflare Access address.</p>
                                <Button variant="primary" className="w-full" onClick={() => window.location.reload()}>Try again</Button>
                            </div>
                        ) : (
                            <form onSubmit={submit} className="space-y-3">
                                {notice && !error && <Notice tone="ok">{notice}</Notice>}
                                {error && <Notice>{error}</Notice>}
                                <Field label="Username">
                                    <input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required />
                                </Field>
                                <Field label="Password">
                                    <input className={inputClass} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
                                </Field>
                                <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
                            </form>
                        )}
                    </div>
                </div>
                <div className="mt-3 text-xs text-gray-500">Self-hosted game server panel · LAN only</div>
            </div>
        </div>
    );
}

export default Login;

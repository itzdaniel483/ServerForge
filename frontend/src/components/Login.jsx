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
            <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 border-r border-white/[.06] bg-gradient-to-br from-accent-900/60 via-gray-950 to-gray-950">
                {/* Decorative grid + glow orbs; purely visual. */}
                <div aria-hidden="true" className="absolute inset-0 opacity-[.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px]" />
                <div aria-hidden="true" className="absolute -top-40 -left-24 w-[520px] h-[520px] rounded-full bg-accent-500/30 blur-[120px]" />
                <div aria-hidden="true" className="absolute -bottom-40 right-0 w-[460px] h-[460px] rounded-full bg-accent2-500/20 blur-[120px]" />
                <div className="relative flex items-center gap-3"><Logo size={44} /><span className="text-2xl font-black tracking-tight text-white">Server<span className="text-gradient">Forge</span></span></div>
                <div className="relative">
                    <h1 className="text-6xl font-black tracking-tight leading-[1.05] text-white">Your game servers.<br /><span className="text-gradient">One control room.</span></h1>
                    <div className="mt-8 flex flex-wrap gap-2">
                        {['Install', 'Start', 'Live console', 'Schedules', 'Backups'].map(t => (
                            <span key={t} className="px-3.5 h-9 inline-flex items-center rounded-full glass text-sm font-semibold text-gray-200">{t}</span>
                        ))}
                    </div>
                </div>
                <div className="relative text-sm text-gray-500">Self-hosted · LAN only</div>
            </div>

            <div className="flex items-center justify-center p-6">
                <div className="w-full max-w-md glass rounded-3xl p-8 sm:p-10">
                    <div className="lg:hidden flex items-center gap-3 mb-10"><Logo size={36} /><span className="text-xl font-black text-white">Server<span className="text-gradient">Forge</span></span></div>
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

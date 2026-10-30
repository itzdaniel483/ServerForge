// Shared UI kit (claude, UI v2 2026-10-30): frosted panels, gradient accent, colours from the theme.
import React from 'react';
import axios from 'axios';

const VARIANTS = {
    primary: 'bg-gradient-to-r from-accent-600 to-accent-500 hover:from-accent-500 hover:to-accent-400 text-white shadow-glow',
    go: 'bg-go-600 hover:bg-go-500 text-white shadow-[0_8px_24px_-10px_rgba(22,163,74,.8)]',
    stop: 'bg-stop-600 hover:bg-stop-500 text-white shadow-[0_8px_24px_-10px_rgba(220,38,38,.8)]',
    ghost: 'bg-white/[.04] hover:bg-white/[.08] text-gray-100 border border-white/10',
    quiet: 'text-gray-300 hover:text-white hover:bg-white/[.06]',
};

export function Button({ variant = 'ghost', size = 'md', className = '', children, ...rest }) {
    const sizes = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-[15px]', lg: 'h-12 px-6 text-base' };
    return (
        <button
            className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
}

export function Card({ className = '', children, ...rest }) {
    return <div className={`glass rounded-2xl ${className}`} {...rest}>{children}</div>;
}

const STATUS = {
    running: ['Online', 'bg-go-500/15 text-go-300 ring-go-500/40', 'bg-go-400 shadow-[0_0_10px_2px_rgba(74,222,128,.7)] animate-pulse'],
    installing: ['Installing', 'bg-accent-500/15 text-accent-200 ring-accent-400/40', 'bg-accent-400 animate-pulse'],
    failed: ['Install failed', 'bg-stop-500/15 text-stop-300 ring-stop-500/40', 'bg-stop-400'],
};

export function Status({ status }) {
    const [label, pill, dot] = STATUS[status] || ['Offline', 'bg-white/[.04] text-gray-300 ring-white/10', 'bg-gray-500'];
    return (
        <span className={`inline-flex items-center gap-2 h-7 px-3 rounded-full text-xs font-bold uppercase tracking-wider ring-1 whitespace-nowrap backdrop-blur ${pill}`}>
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {label}
        </span>
    );
}

// A number tile. Optional icon, and an optional 0-100 `meter` drawn as a bar under the value.
export function Stat({ label, value, tone = '', icon: Icon, meter, sub }) {
    return (
        <Card className="px-5 py-4 min-w-0 relative overflow-hidden">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                {Icon && <Icon size={15} className="text-accent-300" />}{label}
            </div>
            <div className={`mt-1.5 text-2xl font-extrabold tabular-nums truncate ${tone || 'text-white'}`}>{value}</div>
            {sub && <div className="text-xs text-gray-400 truncate mt-0.5">{sub}</div>}
            {meter !== undefined && <Meter value={meter} className="mt-3" />}
        </Card>
    );
}

// 0-100 bar; turns amber past 75 and red past 90 so a full disk or pegged CPU stands out.
export function Meter({ value, className = '' }) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const fill = v > 90 ? 'from-stop-500 to-stop-400' : v > 75 ? 'from-warn-500 to-warn-400' : 'from-accent-500 to-accent2-400';
    return (
        <div className={`h-1.5 rounded-full bg-white/[.06] overflow-hidden ${className}`} role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700`} style={{ width: `${v}%` }} />
        </div>
    );
}

export function PageHeader({ title, sub, actions }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">{title}</h1>
                {sub && <p className="mt-1.5 text-gray-400">{sub}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Field({ label, hint, children }) {
    return (
        <label className="block">
            <span className="block text-sm font-semibold text-gray-200 mb-2">{label}</span>
            {children}
            {hint && <span className="block text-xs text-gray-400 mt-1.5">{hint}</span>}
        </label>
    );
}

export const inputClass = 'w-full h-11 bg-gray-950/80 text-white placeholder-gray-500 px-4 rounded-xl border border-white/10 focus:border-accent-400 focus:outline-none focus:ring-4 focus:ring-accent-500/20 transition';

export function Empty({ icon, title, sub, action }) {
    return (
        <Card className="flex flex-col items-center justify-center text-center py-24 border-dashed">
            <div className="w-20 h-20 rounded-2xl grid place-items-center bg-accent-500/10 text-accent-300 ring-1 ring-accent-400/30 mb-5">{icon}</div>
            <div className="text-2xl font-extrabold text-white">{title}</div>
            {sub && <div className="text-gray-400 mt-2 mb-1">{sub}</div>}
            <div className="mt-5">{action}</div>
        </Card>
    );
}

export function Notice({ tone = 'error', children }) {
    const tones = { error: 'bg-stop-500/10 text-stop-200 ring-stop-500/40', ok: 'bg-go-500/10 text-go-200 ring-go-500/40' };
    return <div role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ring-1 ${tones[tone]}`}>{children}</div>;
}

// Art is behind API auth, so it is fetched with the token and kept as one object URL per game
// for the life of the page (many cards share one download; nothing loads from Steam directly).
const artCache = new Map();   // gameId -> Promise<string|null>
function loadArt(gameId) {
    if (!artCache.has(gameId)) {
        artCache.set(gameId, axios.get(`/api/art/${encodeURIComponent(gameId)}`, { responseType: 'blob' })
            .then(r => URL.createObjectURL(r.data))
            .catch(() => null));
    }
    return artCache.get(gameId);
}

// Game banner: codex's cached Steam header, or a themed gradient with the game's initials.
export function GameArt({ gameId, name = '', className = '', imgClassName = 'object-center', children }) {
    const [src, setSrc] = React.useState(null);
    React.useEffect(() => {
        let alive = true;
        setSrc(null);
        if (gameId) loadArt(gameId).then(url => alive && setSrc(url));
        return () => { alive = false; };
    }, [gameId]);
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return (
        <div className={`relative overflow-hidden bg-gradient-to-br from-accent-700 via-gray-900 to-accent2-500/40 ${className}`}>
            {src ? (
                <img src={src} alt="" className={`absolute inset-0 w-full h-full object-cover ${imgClassName}`} />
            ) : (
                <div className="absolute inset-0 grid place-items-center text-6xl font-black tracking-tighter text-white/15 select-none">{initials}</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />
            {children}
        </div>
    );
}

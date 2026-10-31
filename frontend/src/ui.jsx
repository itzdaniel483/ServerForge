// Shared UI kit (claude, UI v3 2026-10-30): flat control-panel components. Small radii, 1px borders,
// no glows or gradients; the theme accent is used sparingly for the primary action and focus.
import React from 'react';
import axios from 'axios';

const VARIANTS = {
    primary: 'bg-accent-600 hover:bg-accent-500 text-white border border-accent-500/60',
    go: 'bg-go-600 hover:bg-go-500 text-white border border-go-500/60',
    stop: 'bg-stop-600 hover:bg-stop-500 text-white border border-stop-500/60',
    ghost: 'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
    quiet: 'text-gray-300 hover:text-white hover:bg-gray-800 border border-transparent',
};

export function Button({ variant = 'ghost', size = 'md', className = '', children, ...rest }) {
    const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-sm', lg: 'h-9 px-4 text-sm' };
    return (
        <button
            className={`inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-400 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
}

export function Card({ className = '', children, ...rest }) {
    return <div className={`bg-gray-900 border border-gray-800 rounded-md ${className}`} {...rest}>{children}</div>;
}

// Panel with a title bar, the basic building block of a page.
export function Panel({ title, actions, className = '', bodyClassName = 'p-4', children }) {
    return (
        <Card className={className}>
            {(title || actions) && (
                <div className="h-10 px-4 flex items-center gap-3 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-gray-100 truncate">{title}</h2>
                    {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
                </div>
            )}
            <div className={bodyClassName}>{children}</div>
        </Card>
    );
}

const STATUS = {
    running: ['Running', 'text-go-300', 'bg-go-400'],
    installing: ['Installing', 'text-accent-300', 'bg-accent-400 animate-pulse'],
    failed: ['Install failed', 'text-stop-300', 'bg-stop-400'],
    nodeoffline: ['Node offline', 'text-warn-300', 'bg-warn-400'],
};

export function Status({ status }) {
    const [label, text, dot] = STATUS[status] || ['Stopped', 'text-gray-400', 'bg-gray-500'];
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${text}`}>
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {label}
        </span>
    );
}

// A labelled number. Optional icon, and an optional 0-100 `meter` drawn under the value.
export function Stat({ label, value, tone = '', icon: Icon, meter, sub }) {
    return (
        <Card className="px-4 py-3 min-w-0">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                {Icon && <Icon size={13} />}{label}
            </div>
            <div className={`mt-1 text-xl font-semibold tabular-nums truncate ${tone || 'text-white'}`}>{value}</div>
            {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
            {meter !== undefined && <Meter value={meter} label={label} className="mt-2" />}
        </Card>
    );
}

// 0-100 bar; turns amber past 75 and red past 90 so a full disk or pegged CPU stands out.
export function Meter({ value, label, className = '' }) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const fill = v > 90 ? 'bg-stop-500' : v > 75 ? 'bg-warn-500' : 'bg-accent-500';
    return (
        <div className={`h-1 rounded-sm bg-gray-800 overflow-hidden ${className}`} {...(label ? { role: 'meter', 'aria-label': label, 'aria-valuenow': Math.round(v), 'aria-valuemin': 0, 'aria-valuemax': 100 } : { 'aria-hidden': true })}>
            <div className={`h-full ${fill} transition-[width] duration-500`} style={{ width: `${v}%` }} />
        </div>
    );
}

export function PageHeader({ title, sub, actions }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
                <h1 className="text-lg font-semibold text-white">{title}</h1>
                {sub && <p className="text-sm text-gray-400">{sub}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}

// Underline tabs (page sections). items: [{ id, label, icon? }]
export function Tabs({ items, value, onChange, className = '' }) {
    return (
        <div role="tablist" className={`flex gap-1 border-b border-gray-800 overflow-x-auto ${className}`}>
            {items.map(t => {
                const on = value === t.id;
                return (
                    <button key={t.id} role="tab" aria-selected={on} onClick={() => onChange(t.id)}
                        className={`relative flex items-center gap-1.5 h-9 px-3 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors ${on ? 'border-accent-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-100'}`}>
                        {t.icon && <t.icon size={14} />}{t.label}
                    </button>
                );
            })}
        </div>
    );
}

export function Field({ label, hint, children }) {
    return (
        <label className="block">
            <span className="block text-xs font-medium text-gray-300 mb-1">{label}</span>
            {children}
            {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
        </label>
    );
}

export const inputClass = 'w-full h-8 bg-gray-950 text-white text-sm placeholder-gray-500 px-2.5 rounded border border-gray-700 focus:border-accent-500 focus:outline-none transition-colors';

export function Empty({ icon, title, sub, action }) {
    return (
        <Card className="flex flex-col items-center justify-center text-center py-14 border-dashed">
            <div className="text-gray-500 mb-3">{icon}</div>
            <div className="text-base font-semibold text-white">{title}</div>
            {sub && <div className="text-sm text-gray-400 mt-1">{sub}</div>}
            {action && <div className="mt-4">{action}</div>}
        </Card>
    );
}

export function Notice({ tone = 'error', children }) {
    const tones = { error: 'border-stop-500 bg-stop-500/10 text-stop-200', ok: 'border-go-500 bg-go-500/10 text-go-200' };
    return <div role="status" className={`border-l-2 rounded-sm px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

// Art is behind API auth, so it is fetched with the token and kept as one object URL per game
// for the life of the page (many cards share one download; nothing loads from Steam directly).
const artCache = new Map();   // gameId -> Promise<string|null>
function loadArt(gameId) {
    if (!artCache.has(gameId)) {
        artCache.set(gameId, axios.get(`/api/art/${encodeURIComponent(gameId)}`, { responseType: 'blob' })
            .then(r => URL.createObjectURL(r.data))
            .catch(() => {
                // Don't remember a failure for good: retry after a minute (backend restart, offline, re-login).
                setTimeout(() => artCache.delete(gameId), 60000);
                return null;
            }));
    }
    return artCache.get(gameId);
}

// Game art: codex's cached Steam header, or the game's initials on a plain tile.
// v3: used mostly as small thumbnails; `shade` darkens it when text sits on top.
export function GameArt({ gameId, name = '', className = '', imgClassName = 'object-center', shade = false, children }) {
    const [src, setSrc] = React.useState(null);
    React.useEffect(() => {
        let alive = true;
        setSrc(null);
        if (gameId) loadArt(gameId).then(url => alive && setSrc(url));
        return () => { alive = false; };
    }, [gameId]);
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return (
        <div className={`relative overflow-hidden bg-gray-800 ${className}`}>
            {src ? (
                <img src={src} alt="" onError={() => setSrc(null)} className={`absolute inset-0 w-full h-full object-cover ${imgClassName}`} />
            ) : (
                <div className="absolute inset-0 grid place-items-center text-[12px] font-bold tracking-wider text-gray-400 select-none">{initials}</div>
            )}
            {shade && <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />}
            {children}
        </div>
    );
}

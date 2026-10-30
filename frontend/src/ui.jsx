// Small shared UI kit for the overhaul (claude, 2026-10-30): dark, high-contrast, ember accent.
import React from 'react';

const VARIANTS = {
    primary: 'bg-ember-600 hover:bg-ember-500 text-white',
    go: 'bg-go-600 hover:bg-go-500 text-white',
    stop: 'bg-stop-600 hover:bg-stop-500 text-white',
    ghost: 'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
    quiet: 'text-gray-300 hover:text-white hover:bg-gray-800',
};

export function Button({ variant = 'ghost', size = 'md', className = '', children, ...rest }) {
    const sizes = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-[15px]', lg: 'h-12 px-6 text-base' };
    return (
        <button
            className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-400 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
}

export function Card({ className = '', children, ...rest }) {
    return <div className={`bg-gray-900 border border-gray-800 rounded-xl ${className}`} {...rest}>{children}</div>;
}

const STATUS = {
    running: ['Online', 'bg-go-500/15 text-go-300 ring-go-500/40', 'bg-go-400 animate-pulse'],
    installing: ['Installing', 'bg-ember-500/15 text-ember-300 ring-ember-500/40', 'bg-ember-400 animate-pulse'],
    failed: ['Install failed', 'bg-red-500/15 text-red-300 ring-red-500/40', 'bg-red-400'],
};

export function Status({ status }) {
    const [label, pill, dot] = STATUS[status] || ['Offline', 'bg-gray-800 text-gray-300 ring-gray-700', 'bg-gray-500'];
    return (
        <span className={`inline-flex items-center gap-2 h-7 px-3 rounded-full text-xs font-bold uppercase tracking-wider ring-1 ${pill}`}>
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {label}
        </span>
    );
}

export function Stat({ label, value, tone = '' }) {
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums truncate ${tone || 'text-white'}`}>{value}</div>
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

export const inputClass = 'w-full h-11 bg-gray-950 text-white placeholder-gray-500 px-4 rounded-lg border border-gray-700 focus:border-ember-400 focus:outline-none focus:ring-2 focus:ring-ember-500/30';

export function Empty({ icon, title, action }) {
    return (
        <div className="flex flex-col items-center justify-center text-center py-24 border-2 border-dashed border-gray-800 rounded-2xl">
            <div className="text-gray-600 mb-4">{icon}</div>
            <div className="text-xl font-bold text-white mb-5">{title}</div>
            {action}
        </div>
    );
}

export function Notice({ tone = 'error', children }) {
    const tones = { error: 'bg-stop-500/10 text-stop-200 ring-stop-500/40', ok: 'bg-go-500/10 text-go-200 ring-go-500/40' };
    return <div role="status" className={`rounded-lg px-4 py-3 text-sm font-medium ring-1 ${tones[tone]}`}>{children}</div>;
}

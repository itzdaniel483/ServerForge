// Multi-node badges and OS icons (claude, phase 2 2026-10-30). Helpers are in nodeUtils.js.
import React from 'react';
import { Terminal } from 'lucide-react';
import { isRemote, nodeOffline, osLabel } from './nodeUtils';

export function WindowsIcon({ size = 14, className = '' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
            <path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" />
        </svg>
    );
}

export const OsIcon = ({ os, size = 14, className = '' }) =>
    os === 'win32' ? <WindowsIcon size={size} className={className} /> : <Terminal size={size} className={className} aria-hidden="true" />;

// Small "which machine" pill for cards and headers.
export function NodeBadge({ s, className = '' }) {
    const offline = nodeOffline(s);
    const name = isRemote(s) ? (s.nodeName || 'Other machine') : 'This panel';
    return (
        <span title={`${name} · ${osLabel(s.nodeOs)}${offline ? ' · offline' : ''}`}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold ring-1 backdrop-blur max-w-[12rem] ${offline ? 'bg-stop-500/15 text-stop-200 ring-stop-500/40' : 'bg-gray-950/60 text-gray-200 ring-white/15'} ${className}`}>
            <OsIcon os={s.nodeOs} size={13} className="shrink-0" />
            <span className="truncate">{name}</span>
        </span>
    );
}

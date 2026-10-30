import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { errorText } from '../api';
import { Card } from '../ui';

// Activity (claude, 2026-10-30): who did what, newest first. One server, or everything when no serverId.
const WORDS = {
    install: 'Installed', start: 'Started', stop: 'Stopped', delete: 'Deleted', settings: 'Changed settings', 'file-save': 'Saved file',
    backup: 'Backed up', restore: 'Restored backup', command: 'Ran command', access: 'Changed access', 'task-add': 'Added task',
    'task-delete': 'Deleted task', 'task-run': 'Ran task', 'crash-restart': 'Crashed, restarting', 'crash-gave-up': 'Crashed, gave up',
    'task-restart': 'Scheduled restart', 'task-start': 'Scheduled start', 'task-stop': 'Scheduled stop', 'task-update': 'Scheduled update',
    'task-backup': 'Scheduled backup', 'task-command': 'Scheduled command',
    'node-enrol': 'Created node code', 'node-enrol-cancel': 'Cancelled node code', 'node-approve': 'Approved node', 'node-remove': 'Removed node',
};

// "Chrome · Windows" from a user-agent string; the full text stays in the tooltip.
function browserOf(ua = '') {
    const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios|python/i.test(ua) ? 'Script' : '';
    const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return [b, o].filter(Boolean).join(' · ');
}

export default function ActivityLog({ serverId }) {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        axios.get('/api/activity', { params: { server: serverId, limit: 300 } }).then(r => setRows(r.data)).catch(err => setError(errorText(err)));
    }, [serverId]);
    if (!rows) return <div className="text-gray-400">{error || 'Loading…'}</div>;
    if (!rows.length) return <Card className="p-8 text-center text-gray-300">Nothing yet.</Card>;
    // Older entries (and scheduled/automatic ones) have no address; the column appears once any row does.
    const hasFrom = rows.some(r => r.ip || r.userAgent);
    return (
        <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
                    <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th>{hasFrom && <th className="px-4 py-3">From</th>}<th className="px-4 py-3">What</th>{!serverId && <th className="px-4 py-3">Server</th>}<th className="px-4 py-3">Details</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {rows.map((r, i) => (
                        <tr key={i} className={r.action.startsWith('crash') ? 'bg-stop-500/5' : ''}>
                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-300 tabular-nums">{new Date(r.at).toLocaleString()}</td>
                            <td className="px-4 py-2.5 font-semibold text-white">{r.user}</td>
                            {hasFrom && (
                                <td className="px-4 py-2.5 whitespace-nowrap" title={r.userAgent || ''}>
                                    <div className="font-mono text-xs text-gray-200">{r.ip || '—'}</div>
                                    {r.userAgent && <div className="text-xs text-gray-400">{browserOf(r.userAgent)}</div>}
                                </td>
                            )}
                            <td className="px-4 py-2.5 text-gray-100">{WORDS[r.action] || r.action}</td>
                            {!serverId && <td className="px-4 py-2.5 text-gray-300">{r.server || '—'}</td>}
                            <td className="px-4 py-2.5 text-gray-400 font-mono text-xs break-all">{r.detail || ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );
}

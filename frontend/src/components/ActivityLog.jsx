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
};

export default function ActivityLog({ serverId }) {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        axios.get('/api/activity', { params: { server: serverId, limit: 300 } }).then(r => setRows(r.data)).catch(err => setError(errorText(err)));
    }, [serverId]);
    if (!rows) return <div className="text-gray-400">{error || 'Loading…'}</div>;
    if (!rows.length) return <Card className="p-8 text-center text-gray-300">Nothing yet.</Card>;
    return (
        <Card className="overflow-hidden">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
                    <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">What</th>{!serverId && <th className="px-4 py-3">Server</th>}<th className="px-4 py-3">Details</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {rows.map((r, i) => (
                        <tr key={i} className={r.action.startsWith('crash') ? 'bg-stop-500/5' : ''}>
                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-300 tabular-nums">{new Date(r.at).toLocaleString()}</td>
                            <td className="px-4 py-2.5 font-semibold text-white">{r.user}</td>
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

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Plus, Play, Trash2, Power } from 'lucide-react';
import { errorText } from '../api';
import { Button, Card, Field, Notice, inputClass } from '../ui';

// Schedule tab (claude, 2026-10-30): restart / start / stop / update / backup / console command on a timetable.
const TYPES = { restart: 'Restart', start: 'Start', stop: 'Stop', update: 'Update game', backup: 'Back up', command: 'Run command' };
const PRESETS = [
    { label: 'Every day 06:00', cron: '0 6 * * *' },
    { label: 'Every day 04:00', cron: '0 4 * * *' },
    { label: 'Every 6 hours', cron: '0 */6 * * *' },
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Mondays 05:00', cron: '0 5 * * 1' },
];

function describe(cron) {
    return PRESETS.find(p => p.cron === cron)?.label || cron;
}

export default function TaskManager({ server, canEdit }) {
    const [tasks, setTasks] = useState(null);
    const [form, setForm] = useState({ type: 'restart', cron: '0 6 * * *', command: '', label: '' });
    const [custom, setCustom] = useState(false);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(() => axios.get(`/api/server/${server.id}/tasks`).then(r => setTasks(r.data.tasks)).catch(err => setMsg({ ok: false, text: errorText(err) })), [server.id]);
    useEffect(() => { load(); }, [load]);

    async function add() {
        setBusy('add'); setMsg(null);
        try { await axios.post(`/api/server/${server.id}/tasks`, form); setMsg({ ok: true, text: 'Task added.' }); setForm(f => ({ ...f, command: '', label: '' })); load(); }
        catch (err) { setMsg({ ok: false, text: errorText(err) }); }
        finally { setBusy(''); }
    }
    async function act(t, kind) {
        setBusy(t.id + kind); setMsg(null);
        try {
            if (kind === 'run') { const r = await axios.post(`/api/tasks/${t.id}/run`); setMsg({ ok: r.data.ok, text: `${TYPES[t.type]}: ${r.data.text}` }); }
            if (kind === 'toggle') await axios.put(`/api/tasks/${t.id}`, { enabled: !t.enabled });
            if (kind === 'delete' && window.confirm('Delete this task?')) await axios.delete(`/api/tasks/${t.id}`);
            load();
        } catch (err) { setMsg({ ok: false, text: errorText(err) }); }
        finally { setBusy(''); }
    }

    if (!tasks) return <div className="text-gray-400">{msg?.text || 'Loading…'}</div>;

    return (
        <div className="grid xl:grid-cols-[1fr_400px] gap-6 items-start">
            <div className="space-y-3">
                {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
                {tasks.length === 0 && <Card className="p-8 text-center text-gray-300">No scheduled tasks.</Card>}
                {tasks.map(t => (
                    <Card key={t.id} className={`p-4 flex flex-wrap items-center gap-4 ${t.enabled ? '' : 'opacity-60'}`}>
                        <div className="min-w-0 flex-1">
                            <div className="font-bold text-white">{TYPES[t.type]}{t.type === 'command' && <span className="font-mono text-ember-300"> {t.command}</span>}</div>
                            <div className="text-sm text-gray-400">{describe(t.cron)}{t.label ? ` · ${t.label}` : ''}{!t.enabled && ' · Paused'}</div>
                            {t.lastRun && <div className={`text-xs mt-1 ${t.lastRun.ok ? 'text-go-300' : 'text-stop-300'}`}>Last run {new Date(t.lastRun.at).toLocaleString()}: {t.lastRun.text}</div>}
                        </div>
                        {canEdit && (
                            <div className="flex gap-2">
                                <Button size="sm" onClick={() => act(t, 'run')} disabled={!!busy} title="Run now"><Play size={15} />Run now</Button>
                                <Button size="sm" variant="quiet" onClick={() => act(t, 'toggle')} disabled={!!busy} title={t.enabled ? 'Pause' : 'Resume'}><Power size={15} />{t.enabled ? 'Pause' : 'Resume'}</Button>
                                <Button size="sm" variant="quiet" onClick={() => act(t, 'delete')} disabled={!!busy} aria-label="Delete task"><Trash2 size={15} /></Button>
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {canEdit && (
                <Card className="p-4 space-y-4 xl:sticky xl:top-24">
                    <h2 className="text-lg font-bold text-white">New task</h2>
                    <div className="grid grid-cols-3 gap-2">
                        {Object.entries(TYPES).map(([k, v]) => (
                            <button key={k} onClick={() => setForm({ ...form, type: k })} aria-pressed={form.type === k}
                                className={`h-10 rounded-lg text-sm font-semibold ${form.type === k ? 'bg-white text-gray-950' : 'bg-gray-950 text-gray-300 ring-1 ring-gray-700 hover:ring-gray-500'}`}>{v}</button>
                        ))}
                    </div>
                    {form.type === 'command' && (
                        <Field label="Command"><input className={`${inputClass} font-mono`} value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} placeholder="say Restart in 5 minutes" maxLength={200} /></Field>
                    )}
                    <Field label="When">
                        <select className={inputClass} value={custom ? 'custom' : form.cron} onChange={e => { if (e.target.value === 'custom') setCustom(true); else { setCustom(false); setForm({ ...form, cron: e.target.value }); } }}>
                            {PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
                            <option value="custom">Custom (cron)…</option>
                        </select>
                    </Field>
                    {custom && <Field label="Cron" hint="minute hour day month weekday, UK time"><input className={`${inputClass} font-mono`} value={form.cron} onChange={e => setForm({ ...form, cron: e.target.value })} /></Field>}
                    <Field label="Note (optional)"><input className={inputClass} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} maxLength={60} /></Field>
                    <Button variant="primary" className="w-full" onClick={add} disabled={busy === 'add'}><Plus size={17} />Add task</Button>
                </Card>
            )}
        </div>
    );
}

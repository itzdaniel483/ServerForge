import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Save } from 'lucide-react';
import { errorText } from '../api';
import { Button, Card, Notice } from '../ui';
import { VarFields } from './VarFields';
import CommandEditor from './CommandEditor';

// Launch tab (claude, 2026-10-30): the game's settings as fields plus crash auto-restart.
// The raw launch line stays available under "Advanced" for anything the fields don't cover.
export default function ServerSettings({ server, onSaved }) {
    const [data, setData] = useState(null);
    const [vars, setVars] = useState({});
    const [autoRestart, setAutoRestart] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        axios.get(`/api/server/${server.id}/settings`).then(r => {
            setData(r.data);
            setVars({ ...r.data.vars, password: '' });
            setAutoRestart(r.data.autoRestart);
        }).catch(err => setMsg({ ok: false, text: errorText(err) }));
    }, [server.id]);

    async function save() {
        setBusy(true); setMsg(null);
        const out = { ...vars };
        if (!out.password) delete out.password;   // blank = keep the saved password
        try {
            const r = await axios.put(`/api/server/${server.id}/settings`, { vars: out, autoRestart });
            setMsg({ ok: true, text: r.data.restartNeeded ? 'Saved. Restart the server to use the new settings.' : 'Saved.' });
            onSaved?.(r.data.server);
        } catch (err) {
            setMsg({ ok: false, text: errorText(err) });
        } finally {
            setBusy(false);
        }
    }

    if (!data) return <div className="text-gray-400">{msg?.text || 'Loading…'}</div>;

    return (
        <div className="space-y-6">
            {data.fields.length > 0 ? (
                <Card className="p-4 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-xl font-bold text-white">Settings</h2>
                        <Button variant="primary" onClick={save} disabled={busy}><Save size={17} />{busy ? 'Saving…' : 'Save'}</Button>
                    </div>
                    {data.notes && <div className="text-sm text-ember-200">{data.notes}</div>}
                    {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
                    <div className="max-w-3xl"><VarFields fields={data.fields} values={vars} onChange={setVars} disabled={busy} /></div>
                    <label className="flex items-center gap-3 cursor-pointer w-fit">
                        <input type="checkbox" className="w-5 h-5 accent-ember-500" checked={autoRestart} onChange={e => setAutoRestart(e.target.checked)} />
                        <span className="font-semibold text-gray-100">Restart automatically if it crashes</span>
                        <span className="text-sm text-gray-400">(up to 3 times in 10 min)</span>
                    </label>
                    {data.configFile && <div className="text-sm text-gray-400">More options live in <span className="font-mono text-gray-200">{data.configFile}</span> (Files tab).</div>}
                </Card>
            ) : (
                <Notice>This server wasn't installed from the game list, so only the launch line below can be edited.</Notice>
            )}
            <details className="group" open={data.fields.length === 0}>
                <summary className="cursor-pointer font-semibold text-gray-300 hover:text-white w-fit">Advanced: launch line</summary>
                <div className="mt-4"><CommandEditor serverId={server.id} serverData={server} /></div>
            </details>
        </div>
    );
}

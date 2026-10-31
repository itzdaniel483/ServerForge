// Command line editor (claude, Daniel #gamemanager 3576/3579: "edit the command line like in TCAdmin").
// A template with {variables} from the server's settings, plus custom parameters that survive settings saves,
// and a live preview of exactly what will run. Contract: #3581 (GET/PUT /launch, POST /launch/preview).
// Until the backend answers GET /launch, the old CommandEditor is shown instead.
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Save, RotateCcw, Terminal } from 'lucide-react';
import { errorText } from '../api';
import { Button, Panel, Notice } from '../ui';
import CommandEditor from './CommandEditor';

const box = 'w-full bg-gray-950 text-gray-100 font-mono text-sm leading-relaxed px-3 py-2 rounded border border-gray-700 focus:border-accent-500 focus:outline-none resize-y';

export default function LaunchEditor({ server }) {
    const [data, setData] = useState(null);          // GET /launch result
    const [missing, setMissing] = useState(false);   // backend not there yet: old editor
    const [outdated, setOutdated] = useState(false); // a node on an older ServerForge (no launch actions yet)
    const [template, setTemplate] = useState('');
    const [custom, setCustom] = useState('');
    const [preview, setPreview] = useState({ args: [], error: null });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const area = useRef(null);
    const id = encodeURIComponent(server.id);

    useEffect(() => {
        let alive = true;
        axios.get(`/api/server/${id}/launch`).then(r => {
            if (!alive) return;
            setData(r.data); setTemplate(r.data.template ?? r.data.defaultTemplate ?? ''); setCustom(r.data.customArgs || '');
            setPreview({ args: r.data.preview || [], error: null });
        }).catch(err => { if (alive) { if (err?.response?.status === 404) setMissing(true); else if (err?.response?.status === 501) setOutdated(true); else setMsg({ ok: false, text: errorText(err) }); } });
        return () => { alive = false; };
    }, [id]);

    // Live preview, debounced; nothing is saved.
    useEffect(() => {
        if (!data) return undefined;
        const t = setTimeout(() => {
            axios.post(`/api/server/${id}/launch/preview`, { template, customArgs: custom })
                .then(r => setPreview({ args: r.data.preview || [], error: null }))
                .catch(err => setPreview(p => ({ args: p.args, error: errorText(err) })));
        }, 300);
        return () => clearTimeout(t);
    }, [template, custom, data, id]);

    function insertVar(name) {
        const el = area.current, token = `{${name}}`;
        if (!el) { setTemplate(t => `${t} ${token}`); return; }
        const s = el.selectionStart ?? template.length, e = el.selectionEnd ?? s;
        const next = template.slice(0, s) + token + template.slice(e);
        setTemplate(next);
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
    }

    async function save(reset = false) {
        setBusy(true); setMsg(null);
        try {
            const r = await axios.put(`/api/server/${id}/launch`, { template: reset ? null : template, customArgs: custom });
            setData(r.data); setTemplate(r.data.template ?? r.data.defaultTemplate ?? ''); setPreview({ args: r.data.preview || [], error: null });
            setMsg({ ok: true, text: reset ? 'Back to the game’s default command line. Restart the server to use it.' : 'Saved. Restart the server to use the new command line.' });
        } catch (err) { setMsg({ ok: false, text: errorText(err) }); } finally { setBusy(false); }
    }

    if (missing) return <CommandEditor serverId={server.id} serverData={server} />;
    if (outdated) return <Notice>This machine needs a ServerForge update before its command line can be edited here. Update it from the Nodes page (or re-run Setup on it).</Notice>;
    if (!data) return <div className="text-sm text-gray-400">{msg?.text || 'Loading command line…'}</div>;

    const isDefault = (data.template ?? null) === null && template === (data.defaultTemplate ?? '');
    const quote = a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    return (
        <Panel title="Command line" actions={<>
            <Button size="sm" variant="quiet" onClick={() => save(true)} disabled={busy || isDefault} title="Use the game's default command line"><RotateCcw size={13} />Reset to default</Button>
            <Button size="sm" variant="primary" onClick={() => save(false)} disabled={busy || !!preview.error} aria-label="Save command line"><Save size={13} />{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
            <div className="space-y-4">
                {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
                <div className="text-xs text-gray-400">Program: <span className="font-mono text-gray-200">{data.executable || '—'}</span></div>
                <div>
                    <div className="flex items-center justify-between gap-3 mb-1">
                        <label htmlFor="launch-template" className="text-xs font-medium text-gray-300">Template</label>
                        <span className="text-[12px] text-gray-500">Values in {'{braces}'} come from Settings</span>
                    </div>
                    <textarea id="launch-template" ref={area} rows={3} spellCheck={false} value={template} onChange={e => setTemplate(e.target.value)} className={box} />
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Insert a variable">
                        {Object.entries(data.variables || {}).map(([k, v]) => (
                            <button key={k} type="button" onClick={() => insertVar(k)} title={`Current value: ${v}`}
                                className="h-6 px-2 rounded-sm border border-gray-700 bg-gray-900 font-mono text-[12px] text-accent-300 hover:border-accent-500">{`{${k}}`}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <label htmlFor="launch-custom" className="block text-xs font-medium text-gray-300 mb-1">Custom parameters <span className="text-gray-500 font-normal">· added to the end, kept when Settings change</span></label>
                    <textarea id="launch-custom" rows={2} spellCheck={false} value={custom} onChange={e => setCustom(e.target.value)} placeholder="+sv_lan 0 -tickrate 66" className={box} />
                </div>
                <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300 mb-1"><Terminal size={13} />Will run</div>
                    <pre className={`rounded border px-3 py-2 font-mono text-[13px] whitespace-pre-wrap break-all ${preview.error ? 'border-stop-500/60 bg-stop-500/5 text-stop-200' : 'border-gray-800 bg-gray-950 text-go-200'}`} aria-live="polite">
                        {preview.error ? preview.error : [data.executable, ...preview.args].filter(Boolean).map(quote).join(' ')}
                    </pre>
                </div>
            </div>
        </Panel>
    );
}

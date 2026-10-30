// Move a server to another machine (claude, Daniel #gamemanager 3576/3580: fresh install on the target + copy
// configs/saves). Contract #3584: POST /api/server/:id/move {targetNodeId} → {moveId}; GET /api/moves/:id →
// {step, progress, log[], error?}; POST /api/moves/:id/finish {removeSource}. The old copy is only removed after
// the new one has started and the admin confirms.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ArrowRightLeft, X, Check } from 'lucide-react';
import { errorText } from '../api';
import { Button, Card, Meter, Notice } from '../ui';
import { OsIcon } from '../nodes';
import { osLabel } from '../nodeUtils';

const STEPS = [['stopping', 'Stop the server'], ['installing', 'Fresh install on the new machine'], ['copying', 'Copy configs and saves'], ['verifying', 'Start it there and check'], ['done', 'Moved']];

// Off until the move backend ships (item #4); the button would otherwise fail.
const MOVE_ENABLED = false;

export function MoveButton({ server, onMoved }) {
    const [open, setOpen] = useState(false);
    if (!MOVE_ENABLED) return null;
    return (
        <>
            <Button onClick={() => setOpen(true)} title="Move this server to another machine"><ArrowRightLeft size={14} />Move to…</Button>
            {open && <MoveDialog server={server} onClose={() => setOpen(false)} onMoved={onMoved} />}
        </>
    );
}

function MoveDialog({ server, onClose, onMoved }) {
    const [nodes, setNodes] = useState(null);
    const [target, setTarget] = useState('');
    const [move, setMove] = useState(null);      // { id, step, progress, log, error }
    const [error, setError] = useState('');
    const [finishing, setFinishing] = useState(false);
    const from = server.nodeId || 'local';

    useEffect(() => { axios.get('/api/nodes').then(r => setNodes(r.data)).catch(err => setError(errorText(err))); }, []);
    useEffect(() => {
        if (!move?.id || ['done', 'failed'].includes(move.step)) return undefined;
        const t = setInterval(() => axios.get(`/api/moves/${encodeURIComponent(move.id)}`).then(r => setMove(m => ({ ...m, ...r.data }))).catch(() => {}), 1500);
        return () => clearInterval(t);
    }, [move?.id, move?.step]);
    useEffect(() => { const onKey = e => { if (e.key === 'Escape' && !move) onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [move, onClose]);

    const usable = n => n.id !== from && (n.id === 'local' || (n.online && (n.actions || []).includes('install')));
    async function start() {
        setError('');
        try { const r = await axios.post(`/api/server/${encodeURIComponent(server.id)}/move`, { targetNodeId: target }); setMove({ id: r.data.moveId, step: 'stopping', progress: 0, log: [] }); }
        catch (err) { setError(errorText(err)); }
    }
    async function finish(removeSource) {
        setFinishing(true); setError('');
        try { await axios.post(`/api/moves/${encodeURIComponent(move.id)}/finish`, { removeSource }); onMoved?.(); onClose(); }
        catch (err) { setError(errorText(err)); setFinishing(false); }
    }

    const targetNode = nodes?.find(n => n.id === target);
    const stepIndex = move ? STEPS.findIndex(([k]) => k === move.step) : -1;
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Move ${server.name}`}>
            <Card className="w-full max-w-lg">
                <div className="h-10 px-4 flex items-center border-b border-gray-800">
                    <h2 className="text-[13px] font-semibold text-gray-100">Move “{server.name}” to another machine</h2>
                    {!move && <button className="ml-auto h-7 w-7 grid place-items-center rounded text-gray-400 hover:text-white hover:bg-gray-800" onClick={onClose} aria-label="Close"><X size={15} /></button>}
                </div>
                <div className="p-4 space-y-4">
                    {error && <Notice>{error}</Notice>}
                    {!move ? (
                        <>
                            <p className="text-[13px] text-gray-400">The game is installed fresh on the new machine, then your configs and saves are copied over. The old copy stays until the new one has started and you say so.</p>
                            {!nodes ? <div className="text-[13px] text-gray-500">Loading machines…</div> : (
                                <div role="radiogroup" aria-label="Move to" className="space-y-1.5">
                                    {nodes.filter(n => n.id !== from).map(n => (
                                        <label key={n.id} className={`flex items-center gap-2.5 px-3 h-10 rounded border ${usable(n) ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'} ${target === n.id ? 'border-accent-500 bg-accent-500/10' : 'border-gray-700'}`}>
                                            <input type="radio" name="move-target" className="accent-accent-500" disabled={!usable(n)} checked={target === n.id} onChange={() => setTarget(n.id)} />
                                            <OsIcon os={n.os} size={14} /><span className="text-[13px] text-white">{n.id === 'local' ? 'This panel' : n.name}</span>
                                            <span className="text-xs text-gray-500">{osLabel(n.os)}{n.id !== 'local' && !n.online ? ' · offline' : ''}</span>
                                        </label>
                                    ))}
                                    {nodes.filter(n => n.id !== from).length === 0 && <div className="text-[13px] text-gray-500">No other machines yet. Add one on the Nodes page.</div>}
                                </div>
                            )}
                            {targetNode && <p className="text-xs text-warn-300">The server is stopped while it moves. Players will be disconnected.</p>}
                            <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!target} onClick={start}><ArrowRightLeft size={14} />Move</Button></div>
                        </>
                    ) : (
                        <>
                            <ol className="space-y-1.5">
                                {STEPS.map(([k, label], i) => {
                                    const done = move.step === 'done' || i < stepIndex, now = i === stepIndex && move.step !== 'done';
                                    return (
                                        <li key={k} className={`flex items-center gap-2 text-[13px] ${done ? 'text-go-300' : now ? 'text-white' : 'text-gray-500'}`}>
                                            <span className={`w-4 h-4 rounded-full grid place-items-center border ${done ? 'border-go-500 bg-go-500/20' : now ? 'border-accent-500' : 'border-gray-700'}`}>{done && <Check size={10} />}{now && <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />}</span>{label}
                                        </li>
                                    );
                                })}
                            </ol>
                            {move.step !== 'done' && move.step !== 'failed' && <Meter value={move.progress || 0} label="Move progress" />}
                            {move.step === 'failed' && <Notice>{move.error || 'The move failed. The original server is untouched.'}</Notice>}
                            {(move.log || []).length > 0 && <pre className="h-28 overflow-auto rounded bg-gray-950 border border-gray-800 p-2 font-mono text-[11px] text-gray-300 whitespace-pre-wrap">{move.log.slice(-60).join('\n')}</pre>}
                            {move.step === 'done' ? (
                                <div className="space-y-2">
                                    <p className="text-[13px] text-go-200">It's running on {targetNode?.name || 'the new machine'}. Remove the old copy?</p>
                                    <div className="flex justify-end gap-2"><Button disabled={finishing} onClick={() => finish(false)}>Keep both</Button><Button variant="stop" disabled={finishing} onClick={() => finish(true)}>Remove old copy</Button></div>
                                </div>
                            ) : move.step === 'failed' ? <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div> : null}
                        </>
                    )}
                </div>
            </Card>
        </div>
    );
}

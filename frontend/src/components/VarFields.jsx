import React from 'react';
import { Field, inputClass } from '../ui';

// A game's settings as plain fields (claude, 2026-10-30). The field list comes from the server's
// catalogue; the server re-checks every value, this only helps people type the right thing.
export function VarFields({ fields, values, onChange, disabled }) {
    const set = (k, v) => onChange({ ...values, [k]: v });
    return (
        <div className="grid grid-cols-2 gap-4">
            {fields.map(f => {
                const wide = f.type !== 'number';
                return (
                    <div key={f.key} className={wide ? 'col-span-2' : ''}>
                        <Field label={f.label} hint={f.type === 'number' ? `${f.min}–${f.max}` : f.help}>
                            <input
                                className={inputClass}
                                type={f.type === 'secret' ? 'password' : 'text'}
                                inputMode={f.type === 'number' ? 'numeric' : undefined}
                                autoComplete="off"
                                value={values[f.key] ?? ''}
                                placeholder={f.type === 'secret' ? 'Unchanged' : String(f.default ?? '')}
                                onChange={e => set(f.key, f.type === 'number' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                                disabled={disabled}
                            />
                        </Field>
                    </div>
                );
            })}
        </div>
    );
}

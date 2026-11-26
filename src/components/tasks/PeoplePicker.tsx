import React, { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { initials } from './taskView';

/** A person in the picker: the name, the job title and where they work. Built from what the database already lets this user see. */
export interface PickerPerson {
  id: string;
  name: string;
  designation?: string | null;
  team?: string | null;
  department?: string | null;
}

const TINTS = ['bg-blue-100 text-blue-800', 'bg-emerald-100 text-emerald-800', 'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-cyan-100 text-cyan-800'];
const tintOf = (id: string) => TINTS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

/** Initials in a soft circle (the CRM has no profile photos on tasks). */
export const Avatar: React.FC<{ name: string; id?: string; size?: 'sm' | 'md' }> = ({ name, id, size = 'md' }) => (
  <span
    aria-hidden="true"
    className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-[11px]'} ${tintOf(id ?? name)}`}
  >
    {initials(name)}
  </span>
);

const where = (p: PickerPerson) => [p.designation, p.team, p.department].filter(Boolean).join(' · ');

/**
 * Searchable choice of people (one or several): a search box, rows with avatar, name, designation and team, and the chosen people shown as chips
 * before the form is sent. The list is only what the caller passes in; the database checks the hierarchy again when the task is assigned.
 */
export const PeoplePicker: React.FC<{
  label: string;
  people: PickerPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  emptyText?: string;
  required?: boolean;
  id?: string;
}> = ({ label, people, value, onChange, multiple = false, emptyText = 'No one to choose from.', required, id = 'people-picker' }) => {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? people.filter(p => `${p.name} ${p.designation ?? ''} ${p.team ?? ''} ${p.department ?? ''}`.toLowerCase().includes(s)) : people;
  }, [people, q]);
  const chosen = value.map(v => people.find(p => p.id === v)).filter(Boolean) as PickerPerson[];
  const toggle = (pid: string) => {
    if (!multiple) return onChange(value[0] === pid ? [] : [pid]);
    onChange(value.includes(pid) ? value.filter(x => x !== pid) : [...value, pid]);
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-search`} className="text-[12px] font-semibold text-slate-700">{label}{required ? ' *' : ''}</label>
        {multiple && people.length > 1 && (
          <button type="button" className="text-[11px] font-semibold text-blue-700 hover:underline" onClick={() => onChange(value.length === people.length ? [] : people.map(p => p.id))}>
            {value.length === people.length ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>
      {chosen.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Selected">
          {chosen.map(p => (
            <li key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-blue-900">
              <Avatar name={p.name} id={p.id} size="sm" /> {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} className="text-blue-500 hover:text-blue-800" onClick={() => toggle(p.id)}><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input id={`${id}-search`} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, designation or team" autoComplete="off"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <ul role="listbox" aria-label={label} aria-multiselectable={multiple} className="mt-1.5 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {people.length === 0 ? <li className="px-3 py-3 text-xs text-slate-500">{emptyText}</li> : shown.length === 0 ? <li className="px-3 py-3 text-xs text-slate-500">No one matches “{q}”.</li> : shown.map(p => {
          const on = value.includes(p.id);
          return (
            <li key={p.id} role="option" aria-selected={on}>
              <button type="button" onClick={() => toggle(p.id)} className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-slate-50 ${on ? 'bg-blue-50/60' : ''}`}>
                <Avatar name={p.name} id={p.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{p.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{where(p) || 'Team member'}</span>
                </span>
                {on && <Check className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

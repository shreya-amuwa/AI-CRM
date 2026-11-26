import React from 'react';
import { Building2 } from 'lucide-react';

/**
 * The departments ONE Operations Head supervises (a single account, a single dashboard). Any number of departments, whatever their teams, and whether or
 * not they already have a Department Head: the Department Heads stay where they are and report to this person. The first one ticked is where the person is placed.
 */
export const OperationsDepartmentsField: React.FC<{
  departments: { id: string; name: string }[];
  selected: string[];
  onSelected: (ids: string[]) => void;
  /** Other uses of the same picker (the extra departments of a Meta Verifier) change the words; the default is the Operations Head wording. */
  legend?: string;
  hint?: string;
  allowEmpty?: boolean;
}> = ({ departments, selected, onSelected, legend, hint, allowEmpty }) => {
  const toggle = (id: string) => onSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const names = selected.map(id => departments.find(d => d.id === id)?.name).filter(Boolean) as string[];
  return (
    <fieldset className="block" data-testid="operations-departments">
      <legend className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> {legend ?? 'Departments this CEO supervises *'}</legend>
      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto p-2 rounded-xl border border-slate-200 bg-white">
        {departments.map(d => (
          <label key={d.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer border ${selected.includes(d.id) ? 'bg-blue-50 border-blue-200 text-blue-900 font-semibold' : 'border-transparent hover:bg-slate-50 text-slate-700'}`}>
            <input type="checkbox" className="accent-blue-600" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} data-testid={`ops-dept-${d.id}`} />
            <span>{d.name}</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-600" role="status" data-testid="operations-departments-summary">
        {names.length ? <>Selected ({names.length}): <strong>{names.join(', ')}</strong></> : allowEmpty ? 'No extra department: the home department only.' : 'Tick at least one department.'}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint ?? 'One account and one dashboard for all of them. Each department keeps its own Department Head, Team Leads and Team Members. You can add or remove departments later under CEOs.'}</p>
    </fieldset>
  );
};

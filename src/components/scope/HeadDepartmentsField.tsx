import React, { useMemo } from 'react';
import { Home, X } from 'lucide-react';
import { offers, whyNot, type AssignableDepartment, type AssignableTeam, type HeadFunction } from '../../lib/scope/headAssignment';

/**
 * "Add Team Member" for a Department Head (Super Admin): the function and the departments ONE account manages.
 * Not the same as the department list at the top of the modal, which only chooses which department's members are shown.
 * The first chosen department is the head's home department. The database re-checks every pair when the account is created.
 */
const FUNCTIONS: { value: HeadFunction; label: string }[] = [
  { value: 'SALES', label: 'Sales Department Head' },
  { value: 'SUPPORT', label: 'Support Department Head' },
  { value: 'BOTH', label: 'Sales & Support (one person handles both)' }
];

export const HeadDepartmentsField: React.FC<{
  fn: HeadFunction | '';
  onFn: (fn: HeadFunction | '') => void;
  selected: string[];
  onSelected: (ids: string[]) => void;
  departments: AssignableDepartment[];
  teams: AssignableTeam[];
  inputClass: string;
}> = ({ fn, onFn, selected, onSelected, departments, teams, inputClass }) => {
  const offer = useMemo(() => offers(departments, teams), [departments, teams]);
  const byId = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);
  const toggle = (id: string) => onSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const makeHome = (id: string) => onSelected([id, ...selected.filter(x => x !== id)]);

  return (
    <div className="space-y-3" data-testid="head-departments">
      <label className="block text-xs font-semibold text-slate-700">
        Department Head of *
        <select
          id="staff-head-division"
          className={`${inputClass} mt-1 cursor-pointer`}
          value={fn}
          onChange={e => onFn(e.target.value as HeadFunction | '')}
          required
        >
          <option value="">Select Sales, Support or both…</option>
          {FUNCTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>

      <fieldset className="block text-xs font-semibold text-slate-700">
        <legend className="mb-1">Departments this head manages * <span className="font-normal text-slate-500">(one account, one login)</span></legend>
        {selected.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 mb-2" aria-label="Selected departments">
            {selected.map((id, i) => {
              const d = byId.get(id);
              if (!d) return null;
              return (
                <li key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-blue-50 border border-blue-200 text-[11px] font-semibold text-blue-900">
                  {i === 0 ? <Home className="w-3 h-3" aria-label="Home department" /> : null}
                  <span>{d.name}</span>
                  {i !== 0 && selected.length > 1 && (
                    <button type="button" onClick={() => makeHome(id)} className="px-1.5 text-[10px] text-blue-600 hover:text-blue-800 underline" aria-label={`Make ${d.name} the home department`}>
                      make home
                    </button>
                  )}
                  <button type="button" onClick={() => toggle(id)} className="p-0.5 rounded-full hover:bg-blue-100" aria-label={`Remove ${d.name}`}>
                    <X className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-2 font-normal text-rose-600" role="status">No department selected yet - choose at least one below.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-xl border border-slate-200 p-2 max-h-56 overflow-y-auto bg-white">
          {departments.map(d => {
            const problem = whyNot(d, offer.get(d.id), fn);
            const checked = selected.includes(d.id);
            return (
              <label
                key={d.id}
                title={problem || undefined}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 font-normal ${problem && !checked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 cursor-pointer hover:bg-slate-50'}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={!!problem && !checked}
                  onChange={() => toggle(d.id)}
                  data-testid={`head-dept-${d.slug}`}
                />
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{d.name}</span>
                  {problem && !checked && <span className="block text-[10px] leading-snug">{problem}</span>}
                </span>
              </label>
            );
          })}
        </div>
        <span className="block mt-1 font-normal text-slate-500">
          The first department is the home department. The head signs in once and switches between these departments inside the dashboard; the Super Admin can change them later under “Departments &amp; functions”.
        </span>
      </fieldset>
    </div>
  );
};

import React, { useEffect } from 'react';
import { Building2, Repeat } from 'lucide-react';
import type { HeadDivision } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { choosableDivisions, hasSeveralDepartments } from '../../lib/scope/activeScope';
import { confirmLeaveUnsaved, installUnsavedGuard } from '../../lib/scope/unsavedGuard';

const LABEL: Record<HeadDivision, string> = { SALES: 'Sales', SUPPORT: 'Support' };

/**
 * The bar under the top bar of a Department Head's dashboard when they are authorised for more than one department (a department
 * list) or for both functions of their department (a Sales | Support selector). It renders nothing for anyone else, so every
 * dashboard shell can carry it. Switching changes what the dashboard loads; the database applies it only when it was authorised.
 */
export const ScopeBar: React.FC = () => {
  const { scopes, scope, chooseDepartment, chooseDivision } = useAuth();
  useEffect(() => installUnsavedGuard(), []);
  if (!scopes) return null;
  const several = hasSeveralDepartments(scopes);
  const divisions = choosableDivisions(scopes, scope.departmentId);
  if (!several && divisions.length === 0) return null;
  const active = scopes.departments.find(d => d.id === scope.departmentId) ?? scopes.departments[0];

  return (
    <div className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Department and view" data-testid="scope-bar">
      {several && (
        <label className="flex items-center gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">Department</span>
          <select
            aria-label="Department"
            value={active?.id}
            onChange={e => {
              const id = e.target.value;
              if (id !== active?.id) void confirmLeaveUnsaved().then(ok => { if (ok) chooseDepartment(id); });
            }}
            className="h-9 min-w-0 max-w-[60vw] rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="department-select"
          >
            {scopes.departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}
      {divisions.length > 0 && (
        <div className="flex items-center gap-2" data-testid="view-selector">
          <Repeat className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0" id="scope-view-label">Dashboard View</span>
          <div role="radiogroup" aria-labelledby="scope-view-label" className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
            {divisions.map(d => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={scope.division === d}
                onClick={() => {
                  if (scope.division !== d) void confirmLeaveUnsaved().then(ok => { if (ok) chooseDivision(d); });
                }}
                className={`h-8 px-4 rounded-md text-sm font-bold transition ${scope.division === d ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                data-testid={`view-${d.toLowerCase()}`}
              >
                {LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

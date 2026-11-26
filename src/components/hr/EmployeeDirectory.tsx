import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Building2, ChevronRight, Search, Users } from 'lucide-react';
import type { Employee } from '../../types/amuwaHq';
import { MonthlyLeaveFilter } from './MonthlyLeaveFilter';
import type { MonthlyCounts } from '../../hooks/useMonthlyLeave';
import { designationLabel } from '../../../shared/roleNames';

type StatusFilter = 'all' | 'Full-Time' | 'Training / Probation' | 'Intern' | 'Left' | 'pending';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All staff' },
  { value: 'Full-Time', label: 'Employees' },
  { value: 'Training / Probation', label: 'In training' },
  { value: 'Intern', label: 'Interns' },
  { value: 'Left', label: 'Left / inactive' },
  { value: 'pending', label: 'Waiting for approval' }
];

const STATUS_LABEL = (e: Employee): string =>
  e.status === 'Full-Time' ? 'Employee' : e.status === 'Training / Probation' ? 'In training' : e.status === 'Left' ? 'Left' : e.status;

const STATUS_PILL = (e: Employee): string =>
  e.status === 'Full-Time' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : e.status === 'Intern' ? 'bg-purple-50 text-purple-700 border-purple-200'
    : e.status === 'Left' ? 'bg-slate-100 text-slate-500 border-slate-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';

const groupOf = (e: Employee) => ({
  key: e.departmentSlug || e.departmentId || 'none',
  name: e.departmentName || (e.departmentId ? e.departmentId.charAt(0).toUpperCase() + e.departmentId.slice(1) : 'No department')
});

interface Props {
  employees: Employee[];
  /** Members who signed up and wait for the Super Admin's approval (HR dashboard only). */
  pending?: Employee[];
  /** Department heads by department slug, shown on the department cards. */
  headsBySlug?: Record<string, string | null>;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpen: (emp: Employee) => void;
  month: string;
  onMonthChange: (month: string) => void;
  monthLoading?: boolean;
  monthError?: string;
  onMonthRetry?: () => void;
  countsFor: (emp: Employee) => MonthlyCounts;
}

/**
 * A simple staff directory. Nothing is dumped on screen: first the departments (with how many people),
 * then one department's people as a short list (name, designation, status), or the results of a search.
 * Everything else about a person (salary, documents, leave, personal details, actions) is in their profile.
 */
export const EmployeeDirectory: React.FC<Props> = ({
  employees, pending = [], headsBySlug = {}, loading, error, onRetry, onOpen, month, onMonthChange, monthLoading, monthError, onMonthRetry, countsFor
}) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [dept, setDept] = useState<string | null>(null);

  const pool = status === 'pending' ? pending : employees;
  const inStatus = useMemo(() => pool.filter(e => status === 'all' || status === 'pending' || e.status === status), [pool, status]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; people: Employee[] }>();
    for (const e of inStatus) {
      const g = groupOf(e);
      const cur = m.get(g.key) ?? { ...g, people: [] };
      cur.people.push(e);
      m.set(g.key, cur);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inStatus]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const current = dept ? groups.find(g => g.key === dept) : undefined;
  const shown = searching
    ? inStatus.filter(e => [e.name, e.email, e.designation, e.departmentName].some(v => (v || '').toLowerCase().includes(q)))
    : current?.people ?? [];
  const listing = searching || !!current;
  const leaveCount = shown.filter(e => { const c = countsFor(e); return c.halfDays + c.leaveDays > 0; }).length;

  return (
    <section className="space-y-4" aria-label="Staff directory">
      {/* Search and one filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Search staff</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, e-mail or designation"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">Show</span>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value as StatusFilter); setDept(null); }}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm cursor-pointer outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.value === 'pending' ? pending.length : o.value === 'all' ? employees.length : employees.filter(e => e.status === o.value).length})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> Could not load employees: {error}</span>
          {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline cursor-pointer">Try again</button>}
        </div>
      )}

      {!listing ? (
        /* Level 1: departments */
        loading && groups.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading staff…</p>
        ) : groups.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl">
            {status === 'pending' ? 'No members are waiting for approval.' : 'No employees found.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {groups.map(g => (
              <button
                key={g.key}
                type="button"
                onClick={() => setDept(g.key)}
                className="group text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all flex items-center gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900 truncate">{g.name}</span>
                  <span className="block text-xs text-slate-500">
                    {g.people.length} {g.people.length === 1 ? 'person' : 'people'}
                    {headsBySlug[g.key] ? ` · Head: ${headsBySlug[g.key]}` : ''}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )
      ) : (
        /* Level 2: a short list */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            {!searching && (
              <button type="button" onClick={() => setDept(null)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer">
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> All departments
              </button>
            )}
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {searching ? `Search results (${shown.length})` : `${current?.name} (${shown.length})`}
            </h4>
          </div>
          <MonthlyLeaveFilter
            month={month}
            onChange={onMonthChange}
            loading={monthLoading}
            error={monthError}
            onRetry={onMonthRetry}
            withLeave={leaveCount}
          />
          {shown.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">{searching ? 'No one matches your search.' : 'No one here.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map(e => {
                const c = countsFor(e);
                return (
                  <li key={`${e.id}-${e.email}`}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50"
                    >
                      <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center shrink-0" aria-hidden="true">
                        {e.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900 truncate">{e.name}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {designationLabel(e.designation) || e.roleLabel || 'No designation'}{searching && e.departmentName ? ` · ${e.departmentName}` : ''}
                        </span>
                      </span>
                      {(c.halfDays > 0 || c.leaveDays > 0) && (
                        <span className="hidden sm:inline text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                          {[c.leaveDays > 0 ? `${c.leaveDays} leave` : '', c.halfDays > 0 ? `${c.halfDays} half` : ''].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {e.approvalStatus === 'PENDING' ? (
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 shrink-0">Awaiting approval</span>
                      ) : (
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${STATUS_PILL(e)}`}>{STATUS_LABEL(e)}</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import type { AiStudioAssignee, AiStudioAssignees } from '../../../shared/contracts';
import { workloadWarning } from '../../lib/aiStudioWorkload';
import { fieldCls } from '../tasks/head/headParts';

/**
 * Who a task goes to (20270219000100): one searchable list of the people the database offers for the chosen project, grouped by team ("My team" first),
 * with each person's designation, Team Lead and open workload. The server decides who is eligible and whether the task is cross-team; the list only
 * shows it. Searching covers the name, the designation and the team.
 */
export const CrossTeamBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 whitespace-nowrap ${className}`} data-testid="cross-team-badge">Cross-team</span>
);

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');


export const WorkloadSummary: React.FC<{ person: AiStudioAssignee }> = ({ person }) => {
  const w = person.workload;
  const warning = workloadWarning(person);
  return (
    <div className="space-y-2" data-testid="assignee-workload">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-center">
        {([['Active tasks', w.active], ['High priority', w.highPriority], ['Due today', w.dueToday], ['Overdue', w.overdue]] as const).map(([label, n]) => (
          <div key={label} className="bg-white px-2 py-1.5">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className={`text-sm font-bold ${label === 'Overdue' && n ? 'text-rose-700' : 'text-slate-900'}`}>{n}</dd>
          </div>
        ))}
      </dl>
      {person.onLeaveToday ? <p className="text-xs text-amber-800">On approved leave today.</p> : !person.punchedInToday ? <p className="text-xs text-slate-500">Not punched in today.</p> : null}
      {warning ? (
        <p role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900" data-testid="workload-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{warning}
        </p>
      ) : null}
    </div>
  );
};

export const AssigneePicker: React.FC<{ data: AiStudioAssignees; value: string; onChange: (id: string) => void; disabled?: boolean }> = ({ data, value, onChange, disabled }) => {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = data.people.filter(p => words.every(w => [p.fullName, p.designation ?? '', p.team, p.primaryLeadName ?? ''].join(' ').toLowerCase().includes(w)));
    const byTeam = new Map<string, AiStudioAssignee[]>();
    for (const p of shown) {
      const key = p.myTeam ? `My team — ${p.team}` : p.team;
      byTeam.set(key, [...(byTeam.get(key) ?? []), p]);
    }
    return [...byTeam.entries()];
  }, [data.people, q]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input type="search" className={`${fieldCls} pl-8`} placeholder="Search by name, designation or team" value={q} onChange={e => setQ(e.target.value)} disabled={disabled}
          aria-label="Search people" aria-controls="ai-assignee-list" />
      </div>
      <div id="ai-assignee-list" role="radiogroup" aria-label="Assign to" className="max-h-64 overflow-y-auto rounded-lg border border-slate-200" data-testid="assignee-list">
        {groups.length === 0 ? <p className="px-3 py-4 text-center text-sm text-slate-500">Nobody matches.</p> : groups.map(([team, people]) => (
          <div key={team}>
            <div className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{team}</div>
            {people.map(p => (
              <label key={p.id} className={`flex items-center gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 ${p.eligible ? 'cursor-pointer hover:bg-slate-50' : 'opacity-60'} ${value === p.id ? 'bg-blue-50/60' : ''}`}
                data-testid="assignee-option">
                <input type="radio" name="ai-assignee" className="h-4 w-4" value={p.id} checked={value === p.id} disabled={disabled || !p.eligible} onChange={() => onChange(p.id)} />
                {p.avatarUrl
                  ? <img src={p.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" loading="lazy" />
                  : <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{initials(p.fullName)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">{p.fullName}{p.assignmentType === 'CROSS_TEAM' ? <CrossTeamBadge /> : null}</span>
                  <span className="block truncate text-xs text-slate-500">{[p.designation, p.primaryLeadName ? `Team Lead: ${p.primaryLeadName}` : 'No Team Lead', p.eligible ? null : p.reason].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-slate-500">
                  <span className="block font-semibold text-slate-700">{p.workload.active} active</span>
                  {p.onLeaveToday ? <span className="text-amber-700">On leave</span> : p.workload.overdue ? <span className="text-rose-700">{p.workload.overdue} overdue</span> : null}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberApprovalList, WorkReportDetail } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { TaskList } from './ReportContentView';
import { ReviewActions } from './ReviewActions';
import { notifyReportsChanged } from './reportEvents';
import { ApprovalSteps, dateLabel, StatusPill, timeLabel } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const FILTERS: { id: 'PENDING' | 'APPROVED' | 'REVISION_REQUIRED' | 'REJECTED' | 'ALL'; label: string; statuses: string[] }[] = [
  { id: 'PENDING', label: 'Pending approval', statuses: ['PENDING_DEPARTMENT_HEAD'] },
  { id: 'APPROVED', label: 'Fully approved', statuses: ['APPROVED'] },
  { id: 'REVISION_REQUIRED', label: 'Revision required', statuses: ['REVISION_REQUIRED'] },
  { id: 'REJECTED', label: 'Rejected', statuses: ['REJECTED'] },
  { id: 'ALL', label: 'All', statuses: [] }
];
const countOf = (c: MemberApprovalList['counts'], statuses: string[]) => (statuses.length ? statuses.reduce((n, s) => n + ((c as Record<string, number | undefined>)[s] ?? 0), 0) : Object.values(c).reduce((a, b) => a + (b ?? 0), 0));

/** One Team Member report waiting for (or decided by) the Department Head: everything needed to decide, on one card. */
const ApprovalCard: React.FC<{ r: WorkReportDetail; onOpen: (id: string) => void; onDecided: () => void }> = ({ r, onOpen, onDecided }) => {
  const [open, setOpen] = useState(false);
  const assigned = r.content?.assignedTasks ?? [];
  const done = r.content?.completedTasks ?? [];
  const pending = r.status === 'PENDING_DEPARTMENT_HEAD';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" aria-label={`Team member report ${r.title}`} data-testid="member-approval">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">{r.title}</h4>
          <p className="text-[11px] text-slate-500">
            {r.author}{r.designation ? ` (${r.designation})` : ''} - Team Lead {r.teamLead ?? r.tlReviewer ?? '-'} - report date {dateLabel(r.reportDate)}
          </p>
          <p className="text-[11px] text-slate-500">Team Lead approved {timeLabel(r.tlReviewedAt)}{r.revision > 1 ? ` - revision ${r.revision}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill status={r.status} kind={r.kind} />
          <ApprovalSteps tl={r.tlStatus} dh={r.dhStatus} />
        </div>
      </div>
      <p className="text-xs text-slate-600">{assigned.length} assigned task{assigned.length === 1 ? '' : 's'} - {done.length} completed</p>
      {r.tlComment ? <p className="text-xs text-indigo-900 bg-indigo-50/60 rounded-lg px-2.5 py-1.5"><b>Team Lead comment:</b> {r.tlComment}</p> : null}
      {r.dhComment ? <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-2.5 py-1.5"><b>Your comment:</b> {r.dhComment}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide tasks' : pending ? 'Review tasks and decide' : 'Show tasks'}</button>
        <button type="button" className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => onOpen(r.id)}>Open full report</button>
      </div>
      {open ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Assigned tasks</p><TaskList tasks={assigned} empty="No assigned tasks." /></div>
            <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Completed tasks</p><TaskList tasks={done} done empty="No completed tasks." /></div>
          </div>
          {pending ? <ReviewActions id={r.id} stage="DEPARTMENT_HEAD" onDone={onDecided} /> : null}
        </div>
      ) : null}
    </article>
  );
};

/**
 * "Pending Team Member Approvals": the Team Member reports their Team Leads approved, for the Department Head's own (second) approval.
 * The database lists only the reports of this head's department and side that a Team Lead approved; a report still with the Team Lead
 * is not here. Approving makes it fully approved; rejecting or asking for a revision sends it back to the employee (the Team Lead's
 * approval stays on record) and both approvals repeat after the resubmission.
 */
export const MemberApprovals: React.FC<{ reloadKey: number; onOpen: (id: string) => void; period?: { from: string; to: string } }> = ({ reloadKey, onOpen, period }) => {
  const [data, setData] = useState<MemberApprovalList | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('PENDING');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    workReportsApi.memberApprovals({ status: 'ALL', from: period?.from, to: period?.to }).then(d => { setError(''); setData(d); }, e => { setData(prev => prev ?? { items: [], counts: {} }); setError(errText(e)); });
  }, [period?.from, period?.to]);
  useEffect(load, [load, reloadKey]);

  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0];
  const rows = useMemo(() => (data?.items ?? [])
    .filter(r => !active.statuses.length || active.statuses.includes(r.status))
    .filter(r => !search.trim() || r.author.toLowerCase().includes(search.trim().toLowerCase())), [data, active, search]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Pending Team Member Approvals</h2>
          <p className="text-xs text-slate-500">Reports your Team Leads approved. Your approval makes them fully approved.</p>
        </div>
        <input className={`${inputCls} !w-52 !py-1.5`} placeholder="Search by name" aria-label="Search team member reports by name" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${filter === f.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
            {f.label} <span className="tabular-nums opacity-80">{data ? countOf(data.counts, f.statuses) : 0}</span>
          </button>
        ))}
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {data === null ? <Spinner /> : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{filter === 'PENDING' && !search ? 'No Team Member report is waiting for your approval.' : 'No reports match.'}</p>
      ) : (
        <ul className="space-y-2" data-testid="member-approvals">
          {rows.map(r => <li key={r.id}><ApprovalCard r={r} onOpen={onOpen} onDecided={() => { notifyReportsChanged(); load(); }} /></li>)}
        </ul>
      )}
    </Card>
  );
};

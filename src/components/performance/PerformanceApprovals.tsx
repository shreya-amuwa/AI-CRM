import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DepartmentPerformanceOverview, LeadPerformanceMetrics, LeadPerformanceOverview, MemberPerformanceMetrics, MemberPerformanceOverview, PerformanceLead, PerformanceMember,
  PerformanceOverview, PerformancePart, PerformancePerson, PerformanceRecordHistoryEntry, PerformanceRecordState
} from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { performanceApprovalApi } from '../../lib/api/taskReports';
import { PageTitle } from '../layout/shell';
import { ApprovalPill } from '../reports/TaskReports';
import { timeLabel } from '../reports/reportUi';
import { Card, CardHead, fieldCls, LoadingLine, Tabs } from '../tasks/head/headParts';
import { KpiCard } from './KpiCard';
import { defaultPeriod, periodLabel, resolvePeriod, type PeriodChoice } from './periods';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
// no percentage when there is nothing to divide (never 0%)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
const btnPrimary = 'inline-flex items-center justify-center h-8 px-3 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:opacity-50';
const btnGhost = 'inline-flex items-center justify-center h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50';
const btnDanger = 'inline-flex items-center justify-center h-8 px-3 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-50';

/** The approval state of a performance record: Pending, Approved or Returned for correction (a person with no data yet has no record). */
export const RecordStatus: React.FC<{ record: PerformanceRecordState | null }> = ({ record }) =>
  record ? <ApprovalPill status={record.status} /> : <span className="text-[11px] text-slate-400">No data yet</span>;

const ScoreParts: React.FC<{ parts: PerformancePart[]; score: number | null }> = ({ parts, score }) => (
  <div className="px-5 pb-5">
    <table className="w-full text-sm" data-testid="score-parts">
      <caption className="sr-only">How the score is calculated</caption>
      <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60"><th scope="col" className="px-3 py-2 font-semibold">Measure</th><th scope="col" className="px-3 py-2 font-semibold">Weight</th><th scope="col" className="px-3 py-2 font-semibold">Result</th></tr></thead>
      <tbody>
        {parts.map(p => (
          <tr key={p.key} className="border-b border-slate-50"><td className="px-3 py-2 text-slate-700">{p.label}</td><td className="px-3 py-2 text-slate-500">{p.weight}%</td><td className="px-3 py-2 font-semibold text-slate-900">{p.value === null ? <span className="text-slate-400 font-normal">Insufficient data</span> : `${p.value}%`}</td></tr>
        ))}
        <tr><td className="px-3 py-2 font-bold text-slate-900">Score</td><td />
          <td className="px-3 py-2 font-extrabold text-slate-900" data-testid="score-value">{score === null ? <span className="text-slate-400 font-normal">Insufficient data</span> : `${score} / 100`}</td></tr>
      </tbody>
    </table>
    <p className="mt-2 text-[11px] text-slate-500">Calculated from the real task records and the approved daily reports. A measure with nothing to divide is left out and the others are re-weighted; nothing is estimated.</p>
  </div>
);

// ------------------------------------------------------------------------------------------------ approval of a record
const HistoryList: React.FC<{ id: string }> = ({ id }) => {
  const [rows, setRows] = useState<PerformanceRecordHistoryEntry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { performanceApprovalApi.history(id).then(setRows, e => setErr(errText(e))); }, [id]);
  if (err) return <p role="alert" className="text-xs text-rose-700">{err}</p>;
  if (!rows) return <LoadingLine />;
  const word = { GENERATED: 'Generated', REFRESHED: 'Figures refreshed', APPROVED: 'Approved', RETURNED: 'Returned for correction', RESUBMITTED: 'Resubmitted' } as const;
  return (
    <ol className="space-y-1.5 text-xs" data-testid="record-history">
      {rows.map((h, i) => (
        <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-800">{word[h.action]}</span>{h.by ? ` by ${h.by}` : ''} · {timeLabel(h.at)}{h.score !== null ? ` · score ${h.score}` : ''}{h.remarks ? <> · “{h.remarks}”</> : null}
        </li>
      ))}
    </ol>
  );
};

/** Approve or return one record, with remarks; or send a returned one again; or read its history. */
const RecordActions: React.FC<{ person: PerformancePerson; onChanged: () => void; /** open the decision form at once (the reviewer already chose Review) */ autoReview?: boolean }> = ({ person, onChanged, autoReview }) => {
  const rec = person.record;
  const [mode, setMode] = useState<'' | 'review' | 'history'>(autoReview && rec?.canDecide ? 'review' : '');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!rec) return null;
  const decide = async (decision: 'APPROVE' | 'RETURN') => {
    if (decision === 'RETURN' && remarks.trim().length < 5) { setErr('Say what must be corrected (at least 5 characters).'); return; }
    setBusy(true); setErr('');
    try { await performanceApprovalApi.review(rec.id, decision, remarks.trim() || undefined, rec.version); setMode(''); setRemarks(''); onChanged(); } catch (e) { setErr(errText(e)); onChanged(); } finally { setBusy(false); }
  };
  const resubmit = async () => {
    setBusy(true); setErr('');
    try { await performanceApprovalApi.resubmit(rec.id); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {rec.canDecide ? <button type="button" className={btnPrimary} onClick={() => setMode(mode === 'review' ? '' : 'review')} aria-expanded={mode === 'review'}>Review</button> : null}
        {rec.canResubmit ? <button type="button" className={btnPrimary} onClick={() => void resubmit()} disabled={busy}>Send again for approval</button> : null}
        <button type="button" className={btnGhost} onClick={() => setMode(mode === 'history' ? '' : 'history')} aria-expanded={mode === 'history'}>Approval history</button>
      </div>
      {mode === 'review' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" data-testid="record-review">
          <label className="block text-xs font-medium text-slate-600" htmlFor={`rr-${rec.id}`}>Remarks (required when you return it)</label>
          <textarea id={`rr-${rec.id}`} rows={2} className={`${fieldCls} h-auto`} value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={2000} disabled={busy} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void decide('APPROVE')}>Approve</button>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void decide('RETURN')}>Return for correction</button>
          </div>
        </div>
      ) : null}
      {mode === 'history' ? <HistoryList id={rec.id} /> : null}
      {err ? <p role="alert" className="text-xs text-rose-700">{err}</p> : null}
    </div>
  );
};

const RecordNote: React.FC<{ record: PerformanceRecordState | null }> = ({ record }) => {
  if (!record) return null;
  return (
    <p className="text-xs text-slate-600" data-testid="record-note">
      {record.status === 'PENDING' ? 'Waiting for approval.' : null}
      {record.reviewedAt ? <>{record.status === 'APPROVED' ? 'Approved' : 'Returned for correction'} by {record.reviewedBy ?? 'the reviewer'} on {timeLabel(record.reviewedAt)}{record.reviewRemarks ? <> · “{record.reviewRemarks}”</> : null}</> : null}
      {record.status === 'APPROVED' ? ' The approved figures are kept; the live figures above may have moved on.' : null}
    </p>
  );
};

// ------------------------------------------------------------------------------------------------ a person's figures
const MemberCards: React.FC<{ m: MemberPerformanceMetrics }> = ({ m }) => (
  <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch" role="group" aria-label="Performance summary">
    <KpiCard label="Tasks assigned" value={m.tasks.total} tone="blue" testId="pf-tasks" description={`${m.tasks.completed} completed · ${m.tasks.pending} pending · ${m.tasks.overdue} overdue`} />
    <KpiCard label="Task completion" value={m.completionPct === null ? null : `${m.completionPct}%`} tone="blue" testId="pf-completion" description={m.completionPct === null ? 'No tasks in the period' : `${m.tasks.completed} of ${m.tasks.total} tasks`} />
    <KpiCard label="On-time completion" value={m.onTimePct === null ? null : `${m.onTimePct}%`} tone={m.onTimePct !== null && m.onTimePct >= 80 ? 'green' : 'amber'} testId="pf-ontime" description={m.onTimePct === null ? 'No completed task with a deadline' : `${m.tasks.onTime} on time · ${m.tasks.late} late`} />
    <KpiCard label="Daily reports" value={m.reports.submitted} testId="pf-reports" description={`${m.reports.approved} approved · ${m.reports.pending} pending · ${m.reports.returned} returned`} />
    <KpiCard label="Score" value={m.score === null ? null : `${m.score}`} tone="green" testId="pf-score" description={m.score === null ? 'Insufficient data' : 'out of 100, from approved work'} />
  </div>
);

const LeadDetail: React.FC<{ m: LeadPerformanceMetrics }> = ({ m }) => (
  <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch" role="group" aria-label="Team Lead performance summary">
    <KpiCard label="Team task completion" value={m.team.completionPct === null ? null : `${m.team.completionPct}%`} tone="blue" testId="pf-team-completion" description={`${m.team.completed} of ${m.team.total} team tasks · ${m.team.overdue} overdue`} />
    <KpiCard label="Team on-time" value={m.team.onTimePct === null ? null : `${m.team.onTimePct}%`} tone="green" testId="pf-team-ontime" description={m.team.onTimePct === null ? 'No completed task with a deadline' : `${m.team.onTime} on time · ${m.team.late} late`} />
    <KpiCard label="Reports reviewed" value={m.reports.reviewedPct === null ? null : `${m.reports.reviewedPct}%`} tone="blue" testId="pf-reviewed" description={`${m.reports.approved} approved · ${m.reports.returned} returned · ${m.reports.pending} waiting`} />
    <KpiCard label="Tasks given to the team" value={m.management.tasksAssignedToTeam} testId="pf-assigned" description={m.management.delegationPct === null ? 'No task received to hand down' : `${m.management.handledOrDelegated} of ${m.management.tasksReceived} received tasks handled or handed down`} />
    <KpiCard label="Your score" value={m.score === null ? null : `${m.score}`} tone="green" testId="pf-lead-score" description={m.score === null ? 'Insufficient data' : 'out of 100, from team progress and management'} />
  </div>
);

const PeopleTable: React.FC<{ people: PerformanceMember[]; onChanged: () => void; empty: string; label: string }> = ({ people, onChanged, empty, label }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (people.length === 0) return <p className="px-5 pb-5 text-sm text-slate-500">{empty}</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm" data-testid="people-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
            <th scope="col" className="px-5 py-2.5 font-semibold">Name</th><th scope="col" className="px-3 py-2.5 font-semibold">Tasks</th><th scope="col" className="px-3 py-2.5 font-semibold">Completed</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Pending / overdue</th><th scope="col" className="px-3 py-2.5 font-semibold">Completion</th><th scope="col" className="px-3 py-2.5 font-semibold">On time</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Reports (submitted / approved)</th><th scope="col" className="px-3 py-2.5 font-semibold">Score</th><th scope="col" className="px-3 py-2.5 font-semibold">Approval</th>
            <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {people.map(p => (
            <React.Fragment key={p.id}>
              <tr className="border-b border-slate-50 align-top" data-testid="people-row">
                <td className="px-5 py-3 font-semibold text-slate-900">{p.name}{p.team ? <span className="block text-[11px] font-normal text-slate-500">{p.team}</span> : null}</td>
                <td className="px-3 py-3 tabular-nums">{p.metrics.tasks.total}</td>
                <td className="px-3 py-3 tabular-nums">{p.metrics.tasks.completed}</td>
                <td className="px-3 py-3 tabular-nums">{p.metrics.tasks.pending} / <span className={p.metrics.tasks.overdue ? 'text-rose-700 font-semibold' : ''}>{p.metrics.tasks.overdue}</span></td>
                <td className="px-3 py-3 tabular-nums">{pct(p.metrics.completionPct)}</td>
                <td className="px-3 py-3 tabular-nums">{pct(p.metrics.onTimePct)}</td>
                <td className="px-3 py-3 tabular-nums">{p.metrics.reports.submitted} / {p.metrics.reports.approved}</td>
                <td className="px-3 py-3 font-bold tabular-nums">{num(p.metrics.score)}</td>
                <td className="px-3 py-3"><RecordStatus record={p.record} /></td>
                <td className="px-5 py-3 text-right">{p.record ? <button type="button" className={btnGhost} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{p.record.canDecide ? 'Review' : 'Details'}</button> : null}</td>
              </tr>
              {open === p.id ? (
                <tr className="border-b border-slate-100 bg-slate-50/40"><td colSpan={10} className="px-5 py-4 space-y-3">
                  <ScoreParts parts={p.metrics.parts} score={p.metrics.score} />
                  <RecordNote record={p.record} />
                  <RecordActions person={p} onChanged={onChanged} autoReview />
                </td></tr>
              ) : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ the three views
const MemberView: React.FC<{ d: MemberPerformanceOverview; onChanged: () => void }> = ({ d, onChanged }) => (
  <div className="space-y-6">
    <MemberCards m={d.me.metrics} />
    <Card label="My performance record">
      <CardHead title="My performance" hint="Your Team Lead approves it from your tasks and your approved daily reports." right={<RecordStatus record={d.me.record} />} />
      <ScoreParts parts={d.me.metrics.parts} score={d.me.metrics.score} />
      <div className="px-5 pb-5 space-y-3"><RecordNote record={d.me.record} /><RecordActions person={d.me} onChanged={onChanged} /></div>
    </Card>
  </div>
);

const LeadView: React.FC<{ d: LeadPerformanceOverview; onChanged: () => void }> = ({ d, onChanged }) => (
  <div className="space-y-6">
    <LeadDetail m={d.me.metrics} />
    <Card label="Team members">
      <CardHead title="Team members" hint={`${d.pendingReports} task report${d.pendingReports === 1 ? '' : 's'} waiting for your decision · ${d.pendingRecords} performance record${d.pendingRecords === 1 ? '' : 's'} pending`} />
      <PeopleTable people={d.members} onChanged={onChanged} empty="No team member has tasks or reports in this period." label="Team member performance" />
    </Card>
    <Card label="My own performance">
      <CardHead title="Your performance as Team Lead" hint="Your own tasks, your team's progress, the reports you reviewed and the work you handed down. Your Department Head approves it." right={<RecordStatus record={d.me.record} />} />
      <ScoreParts parts={d.me.metrics.parts} score={d.me.metrics.score} />
      <div className="px-5 pb-5 space-y-3"><RecordNote record={d.me.record} /><RecordActions person={d.me} onChanged={onChanged} /></div>
    </Card>
  </div>
);

const LeadRow: React.FC<{ lead: PerformanceLead; onChanged: () => void }> = ({ lead, onChanged }) => {
  const [open, setOpen] = useState(false);
  const m = lead.metrics;
  return (
    <>
      <tr className="border-b border-slate-50 align-top" data-testid="lead-row">
        <td className="px-5 py-3 font-semibold text-slate-900">{lead.name}{lead.team ? <span className="block text-[11px] font-normal text-slate-500">{lead.team}</span> : null}</td>
        <td className="px-3 py-3 tabular-nums">{m.team.members}</td>
        <td className="px-3 py-3 tabular-nums">{m.team.total}</td>
        <td className="px-3 py-3 tabular-nums">{pct(m.team.completionPct)}</td>
        <td className="px-3 py-3 tabular-nums">{m.team.pending} / <span className={m.team.overdue ? 'text-rose-700 font-semibold' : ''}>{m.team.overdue}</span></td>
        <td className="px-3 py-3 tabular-nums">{m.reports.approved} / {m.reports.pending} / {m.reports.returned}</td>
        <td className="px-3 py-3 font-bold tabular-nums">{num(m.score)}</td>
        <td className="px-3 py-3"><RecordStatus record={lead.record} /></td>
        <td className="px-5 py-3 text-right"><button type="button" className={btnGhost} aria-expanded={open} onClick={() => setOpen(o => !o)}>{lead.record?.canDecide ? 'Review' : 'Open'}</button></td>
      </tr>
      {open ? (
        <tr className="border-b border-slate-100 bg-slate-50/40"><td colSpan={9} className="px-5 py-4 space-y-4">
          <LeadDetail m={m} />
          <ScoreParts parts={m.parts} score={m.score} />
          <RecordNote record={lead.record} />
          <RecordActions person={lead} onChanged={onChanged} autoReview />
          <div><h3 className="text-sm font-bold text-slate-900 mb-1">Team members of {lead.name}</h3>
            <PeopleTable people={lead.members} onChanged={onChanged} empty="No team member under this Team Lead." label={`Team members of ${lead.name}`} /></div>
        </td></tr>
      ) : null}
    </>
  );
};

const DepartmentView: React.FC<{ d: DepartmentPerformanceOverview; onChanged: () => void }> = ({ d, onChanged }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch" role="group" aria-label="Department summary">
      <KpiCard label="Department tasks" value={d.tasks.total} tone="blue" testId="pf-dept-tasks" description={`${d.tasks.completed} completed · ${d.tasks.pending} pending`} />
      <KpiCard label="Completion" value={d.tasks.completionPct === null ? null : `${d.tasks.completionPct}%`} tone="blue" testId="pf-dept-completion" description={d.tasks.completionPct === null ? 'No task data available' : `${d.tasks.completed} of ${d.tasks.total}`} />
      <KpiCard label="Overdue" value={d.tasks.overdue} tone={d.tasks.overdue ? 'red' : 'neutral'} testId="pf-dept-overdue" description="not completed, past deadline" />
      <KpiCard label="Daily reports" value={d.reports.submitted} testId="pf-dept-reports" description={`${d.reports.approved} approved · ${d.reports.pending} pending · ${d.reports.returned} returned`} />
      <KpiCard label="Records to approve" value={d.pendingRecords} tone={d.pendingRecords ? 'amber' : 'neutral'} testId="pf-dept-pending" description="Team Lead performance records pending" />
    </div>
    <Card label="Teams and Team Leads">
      <CardHead title={`${d.department.name}: Team Leads and teams`} hint="Compare the teams. Open a Team Lead to read their figures, approve or return their performance and see every member." />
      {d.leads.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">No active Team Lead has people or tasks in this department yet.</p> : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm" data-testid="leads-table">
            <caption className="sr-only">Team Lead performance</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
              <th scope="col" className="px-5 py-2.5 font-semibold">Team Lead</th><th scope="col" className="px-3 py-2.5 font-semibold">Members</th><th scope="col" className="px-3 py-2.5 font-semibold">Team tasks</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Completion</th><th scope="col" className="px-3 py-2.5 font-semibold">Pending / overdue</th><th scope="col" className="px-3 py-2.5 font-semibold">Reports (approved / pending / returned)</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Score</th><th scope="col" className="px-3 py-2.5 font-semibold">Approval</th><th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{d.leads.map(l => <LeadRow key={l.id} lead={l} onChanged={onChanged} />)}</tbody>
          </table>
        </div>
      )}
    </Card>
    {d.unassignedMembers.length ? (
      <Card label="Members without a Team Lead">
        <CardHead title="Team members without a Team Lead" hint="Reviewed by the Department Head." />
        <PeopleTable people={d.unassignedMembers} onChanged={onChanged} empty="" label="Members without a Team Lead" />
      </Card>
    ) : null}
  </div>
);

/**
 * Performance and approvals. One page for every role (the database says who the caller is and what they may see):
 *   Team Member: their own figures and approval status (My Performance).
 *   Team Lead: each member's figures and the approval of their performance, and the Team Lead's own performance.
 *   Department Head: every Team Lead and team of the department, compared, with approval of each Team Lead's performance.
 * The figures come from the task records and the approved daily reports of the chosen period; nothing is typed in.
 */
export const PerformanceApprovals: React.FC<{ departmentId?: string; title?: string; subtitle?: string }> = ({ departmentId, title = 'Performance', subtitle }) => {
  const [period, setPeriod] = useState<PeriodChoice>(defaultPeriod);
  const [data, setData] = useState<PerformanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resolved = useMemo(() => resolvePeriod(period), [period]);
  const periodError = 'error' in resolved ? resolved.error : null;
  const start = 'error' in resolved ? '' : resolved.start;
  const end = 'error' in resolved ? '' : resolved.end;

  const load = useCallback(async () => {
    if (!start) return;
    setLoading(true); setError(null);
    try { setData(await performanceApprovalApi.overview({ start, end, departmentId })); } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [start, end, departmentId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="performance-approvals">
      <PageTitle title={title} subtitle={subtitle ?? 'Calculated from real task records and approved daily reports. Approval: Team Member → Team Lead → Department Head.'} />
      <Card label="Reporting period" className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Period</div>
            <Tabs label="Performance period" value={period.kind} onChange={k => setPeriod(p => ({ ...p, kind: k }))} options={[{ id: 'WEEK', label: 'Weekly' }, { id: 'MONTH', label: 'Monthly' }, { id: 'CUSTOM', label: 'Custom range' }]} />
          </div>
          {period.kind === 'WEEK' && <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">A day in the week</span><input type="date" className={`${fieldCls} w-44`} value={period.weekDate} onChange={e => setPeriod(p => ({ ...p, weekDate: e.target.value }))} /></label>}
          {period.kind === 'MONTH' && <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">Month</span><input type="month" className={`${fieldCls} w-44`} value={period.month} onChange={e => setPeriod(p => ({ ...p, month: e.target.value }))} /></label>}
          {period.kind === 'CUSTOM' && (
            <>
              <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">From</span><input type="date" className={`${fieldCls} w-44`} value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} /></label>
              <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">To</span><input type="date" className={`${fieldCls} w-44`} value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} /></label>
            </>
          )}
          <div className="text-sm text-slate-600 pb-2.5">{periodError ? <span className="text-rose-700" role="alert">{periodError}</span> : <>Showing <b className="text-slate-900">{periodLabel(start, end)}</b></>}</div>
        </div>
      </Card>
      {error ? <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="font-bold underline">Retry</button></div> : null}
      {!data && loading ? <LoadingLine /> : null}
      {data?.role === 'TEAM_MEMBER' ? <MemberView d={data} onChanged={() => void load()} /> : null}
      {data?.role === 'TEAM_HEAD' ? <LeadView d={data} onChanged={() => void load()} /> : null}
      {data && (data.role === 'DEPARTMENT_HEAD' || data.role === 'SUPER_ADMIN') ? <DepartmentView d={data} onChanged={() => void load()} /> : null}
    </div>
  );
};

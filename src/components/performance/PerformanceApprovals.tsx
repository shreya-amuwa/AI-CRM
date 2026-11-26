import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  DepartmentPerformanceOverview, LeadPerformanceMetrics, LeadPerformanceOverview, PerformanceLead, PerformanceMember,
  PerformanceOverview, PerformancePart, PerformancePerson, PerformanceRecordHistoryEntry, PerformanceRecordState, PerformanceSubjectHistory, PerformanceWork
} from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { performanceApprovalApi } from '../../lib/api/taskReports';
import { PageTitle } from '../layout/shell';
import { ReportList as AiStudioReportList } from '../ai-studio/AiStudioReports';
import { ApprovalPill, ChangeList, MemberTaskReports } from '../reports/TaskReports';
import { dateLabel, timeLabel } from '../reports/reportUi';
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

// The rating a reviewer gives when approving (20270210000100; required in every department since 20270213000100)
export const RATING_LABELS: Record<number, string> = { 1: 'Poor', 2: 'Needs improvement', 3: 'Meets expectations', 4: 'Good', 5: 'Excellent' };
const ratingText = (r: number | null | undefined) => (r ? `${r}/5 · ${RATING_LABELS[r] ?? ''}` : null);

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
  const word = { GENERATED: 'Generated', REFRESHED: 'Figures refreshed', APPROVED: 'Approved', RETURNED: 'Returned for correction', RESUBMITTED: 'Resubmitted',
    UPDATED: 'Evaluation updated', REOPENED: 'Reopened for the Team Lead' } as const;
  return (
    <ol className="space-y-1.5 text-xs" data-testid="record-history">
      {rows.map((h, i) => (
        <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-800">{word[h.action]}</span>{h.by ? ` by ${h.by}` : ''} · {timeLabel(h.at)}{h.score !== null ? ` · score ${h.score}` : ''}{h.rating ? ` · rating ${ratingText(h.rating)}` : ''}{h.remarks ? <> · “{h.remarks}”</> : null}
          {h.changes ? <ChangeList changes={h.changes} /> : null}
        </li>
      ))}
    </ol>
  );
};

/** Every evaluation of one person (all periods): the Team Lead keeps their members' history, the Department Head the department's. */
const PersonHistory: React.FC<{ id: string }> = ({ id }) => {
  const [data, setData] = useState<PerformanceSubjectHistory | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { performanceApprovalApi.personHistory(id).then(setData, e => setErr(errText(e))); }, [id]);
  if (err) return <p role="alert" className="text-xs text-rose-700">{err}</p>;
  if (!data) return <LoadingLine />;
  if (data.records.length === 0) return <p className="text-xs text-slate-500">No evaluation yet.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-xs" data-testid="person-history">
        <caption className="sr-only">Evaluation history of {data.name}</caption>
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100"><th scope="col" className="px-3 py-1.5 font-semibold">Period</th><th scope="col" className="px-3 py-1.5 font-semibold">Status</th><th scope="col" className="px-3 py-1.5 font-semibold">Score</th><th scope="col" className="px-3 py-1.5 font-semibold">Rating</th><th scope="col" className="px-3 py-1.5 font-semibold">Decided by</th></tr></thead>
        <tbody>
          {data.records.map(r => (
            <tr key={r.id} className="border-b border-slate-50 align-top">
              <td className="px-3 py-1.5 whitespace-nowrap">{periodLabel(r.periodStart, r.periodEnd)}</td>
              <td className="px-3 py-1.5"><ApprovalPill status={r.status} /></td>
              <td className="px-3 py-1.5 tabular-nums">{num(r.score)}</td>
              <td className="px-3 py-1.5">{ratingText(r.rating) ?? '—'}</td>
              <td className="px-3 py-1.5">{r.reviewedAt ? <>{r.reviewedBy ?? 'the reviewer'} · {timeLabel(r.reviewedAt)}{r.reviewRemarks ? <> · “{r.reviewRemarks}”</> : null}</> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Approve or return one record, with remarks; or send a returned one again; or read its history. */
const RecordActions: React.FC<{ person: PerformancePerson; onChanged: () => void; /** open the decision form at once (the reviewer already chose Review) */ autoReview?: boolean;
  /** offer the person's evaluations of every period (for the reviewer, not on one's own record) */ showEvaluations?: boolean }> = ({ person, onChanged, autoReview, showEvaluations }) => {
  const rec = person.record;
  const [mode, setMode] = useState<'' | 'review' | 'update' | 'history' | 'evaluations'>(autoReview && rec?.canDecide ? 'review' : '');
  const [remarks, setRemarks] = useState('');
  const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!rec) return null;
  // International / Reseller: the rating is required, a member's performance is not returned, and nothing is approved while a report waits
  const canReturn = rec.canReturn !== false;
  const waiting = rec.ratingRequired ? rec.waitingReports ?? 0 : 0;
  const decide = async (decision: 'APPROVE' | 'RETURN') => {
    if (decision === 'RETURN' && remarks.trim().length < 5) { setErr('Say what must be corrected (at least 5 characters).'); return; }
    if (decision === 'APPROVE' && rec.ratingRequired && !rating) { setErr('Give a rating from 1 to 5 before approving.'); return; }
    setBusy(true); setErr('');
    try {
      await performanceApprovalApi.review(rec.id, decision, remarks.trim() || undefined, rec.version, decision === 'APPROVE' && rating ? Number(rating) : undefined);
      setMode(''); setRemarks(''); setRating(''); onChanged();
    } catch (e) { setErr(errText(e)); onChanged(); } finally { setBusy(false); }
  };
  // the reviewer changes the rating / remarks of an approved evaluation (20270213000100)
  const openUpdate = () => {
    if (mode === 'update') { setMode(''); return; }
    setRating(rec.rating ? String(rec.rating) : ''); setRemarks(rec.reviewRemarks ?? ''); setErr(''); setMode('update');
  };
  const update = async () => {
    if (!rating) { setErr('Choose a rating from 1 to 5.'); return; }
    setBusy(true); setErr('');
    try { await performanceApprovalApi.updateEvaluation(rec.id, Number(rating), remarks.trim() || undefined); setMode(''); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const resubmit = async () => {
    setBusy(true); setErr('');
    try { await performanceApprovalApi.resubmit(rec.id); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {rec.canDecide ? <button type="button" className={btnPrimary} onClick={() => setMode(mode === 'review' ? '' : 'review')} aria-expanded={mode === 'review'}>Review</button> : null}
        {rec.canUpdate ? <button type="button" className={btnGhost} onClick={openUpdate} aria-expanded={mode === 'update'}>Update evaluation</button> : null}
        {rec.canResubmit ? <button type="button" className={btnPrimary} onClick={() => void resubmit()} disabled={busy}>Send again for approval</button> : null}
        <button type="button" className={btnGhost} onClick={() => setMode(mode === 'history' ? '' : 'history')} aria-expanded={mode === 'history'}>Approval history</button>
        {showEvaluations ? <button type="button" className={btnGhost} onClick={() => setMode(mode === 'evaluations' ? '' : 'evaluations')} aria-expanded={mode === 'evaluations'}>Evaluation history</button> : null}
      </div>
      {mode === 'review' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" data-testid="record-review">
          {waiting > 0 ? (
            <p role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" data-testid="record-waiting">
              {waiting} daily report{waiting === 1 ? '' : 's'} of this team member {waiting === 1 ? 'is' : 'are'} still waiting for your review in this period. Approve or return {waiting === 1 ? 'it' : 'them'} first (open the member's daily reports below, or Daily Reports): only approved reports count.
            </p>
          ) : null}
          {/* the rating is asked where the department requires it (International / Reseller); other departments' form is unchanged */}
          {rec.ratingRequired ? (
            <>
              <label className="block text-xs font-medium text-slate-600" htmlFor={`rt-${rec.id}`}>Rating (required to approve)</label>
              <select id={`rt-${rec.id}`} className={`${fieldCls} w-full sm:w-64`} value={rating} onChange={e => setRating(e.target.value)} disabled={busy} data-testid="record-rating">
                <option value="">Choose a rating</option>
                {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{n} · {RATING_LABELS[n]}</option>)}
              </select>
            </>
          ) : null}
          <label className="block text-xs font-medium text-slate-600" htmlFor={`rr-${rec.id}`}>{canReturn ? 'Remarks (required when you return it)' : 'Remarks (optional)'}</label>
          <textarea id={`rr-${rec.id}`} rows={2} className={`${fieldCls} h-auto`} value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={2000} disabled={busy} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btnPrimary} disabled={busy || waiting > 0} onClick={() => void decide('APPROVE')}>Approve</button>
            {canReturn ? <button type="button" className={btnDanger} disabled={busy} onClick={() => void decide('RETURN')}>Return for correction</button> : null}
          </div>
          {!canReturn ? <p className="text-[11px] text-slate-500">A team member&apos;s performance is not returned to them: return their daily reports for correction instead.</p> : null}
        </div>
      ) : null}
      {mode === 'update' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" data-testid="record-update">
          <p className="text-[11px] text-slate-500">The approved figures stay as approved; the new rating and remarks are kept in the approval history with the old ones.</p>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`ru-${rec.id}`}>Rating</label>
          <select id={`ru-${rec.id}`} className={`${fieldCls} w-full sm:w-64`} value={rating} onChange={e => setRating(e.target.value)} disabled={busy} data-testid="record-update-rating">
            <option value="">Choose a rating</option>
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{n} · {RATING_LABELS[n]}</option>)}
          </select>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`rm-${rec.id}`}>Remarks</label>
          <textarea id={`rm-${rec.id}`} rows={2} className={`${fieldCls} h-auto`} value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={2000} disabled={busy} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void update()}>Save evaluation</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setMode('')}>Cancel</button>
          </div>
        </div>
      ) : null}
      {mode === 'history' ? <HistoryList id={rec.id} /> : null}
      {mode === 'evaluations' ? <PersonHistory id={person.id} /> : null}
      {err ? <p role="alert" className="text-xs text-rose-700">{err}</p> : null}
    </div>
  );
};

const RecordNote: React.FC<{ record: PerformanceRecordState | null }> = ({ record }) => {
  if (!record) return null;
  return (
    <p className="text-xs text-slate-600" data-testid="record-note">
      {record.status === 'PENDING' ? 'Waiting for approval.' : null}
      {record.reviewedAt ? <>{record.status === 'APPROVED' ? 'Approved' : 'Returned for correction'} by {record.reviewedBy ?? 'the reviewer'} on {timeLabel(record.reviewedAt)}{record.reviewRemarks ? <> · “{record.reviewRemarks}”</> : null}{record.status === 'APPROVED' && record.rating ? <> · rating <b data-testid="record-rating-value">{ratingText(record.rating)}</b></> : null}</> : null}
      {record.status === 'APPROVED' ? ' The approved figures are kept; the live figures above may have moved on.' : null}
    </p>
  );
};

// ------------------------------------------------------------------------------------------------ a person's figures
const LeadDetail: React.FC<{ m: LeadPerformanceMetrics }> = ({ m }) => (
  <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch" role="group" aria-label="Team Lead performance summary">
    <KpiCard label="Team task completion" value={m.team.completionPct === null ? null : `${m.team.completionPct}%`} tone="blue" testId="pf-team-completion" description={`${m.team.completed} of ${m.team.total} team tasks · ${m.team.overdue} overdue`} />
    <KpiCard label="Team on-time" value={m.team.onTimePct === null ? null : `${m.team.onTimePct}%`} tone="green" testId="pf-team-ontime" description={m.team.onTimePct === null ? 'No completed task with a deadline' : `${m.team.onTime} on time · ${m.team.late} late`} />
    <KpiCard label="Reports reviewed" value={m.reports.reviewedPct === null ? null : `${m.reports.reviewedPct}%`} tone="blue" testId="pf-reviewed" description={`${m.reports.approved} approved · ${m.reports.returned} returned · ${m.reports.pending} waiting`} />
    <KpiCard label="Tasks given to the team" value={m.management.tasksAssignedToTeam} testId="pf-assigned" description={`${m.management.delegationPct === null ? 'No task received to hand down' : `${m.management.handledOrDelegated} of ${m.management.tasksReceived} received tasks handled or handed down`}${m.management.crossTeamGiven ? ` · ${m.management.crossTeamGiven} to other teams` : ''}`} />
    <KpiCard label="Your score" value={m.score === null ? null : `${m.score}`} tone="green" testId="pf-lead-score" description={m.score === null ? 'Insufficient data' : 'out of 100, from team progress and management'} />
  </div>
);

const TASK_STATUS: Record<string, string> = { ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', ON_HOLD: 'On hold', COMPLETED: 'Completed', NOT_COMPLETED: 'Not completed' };
/** Who is looking (the overview's role): the AI Studio drill-down opens the Team Lead's or the Department Head's report list. */
const ViewerRole = createContext<PerformanceOverview['role'] | null>(null);
/** The reviewer's drill-down: one person's tasks in the period (with the latest report on each) and their daily reports, reviewed and edited in place. */
const PersonWork: React.FC<{ id: string; name: string; start: string; end: string; reports: boolean; onChanged: () => void }> = ({ id, name, start, end, reports, onChanged }) => {
  const [work, setWork] = useState<PerformanceWork | null>(null);
  const [err, setErr] = useState('');
  const viewer = useContext(ViewerRole);
  const load = useCallback(() => { setErr(''); performanceApprovalApi.work(id, { start, end }).then(setWork, e => setErr(errText(e))); }, [id, start, end]);
  useEffect(load, [load]);
  const changed = () => { load(); onChanged(); };
  return (
    <div className="space-y-3" data-testid="person-work">
      <h3 className="text-sm font-bold text-slate-900">Assigned tasks of {name} <span className="font-normal text-slate-500">· {periodLabel(start, end)}</span></h3>
      {err ? <p role="alert" className="text-xs text-rose-700">{err} <button type="button" className="font-bold underline" onClick={load}>Retry</button></p> : !work ? <LoadingLine /> : work.tasks.length === 0 ? (
        <p className="text-xs text-slate-500">No task in this period.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs" data-testid="person-tasks">
            <caption className="sr-only">Tasks of {name}</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <th scope="col" className="px-3 py-1.5 font-semibold">Task</th><th scope="col" className="px-3 py-1.5 font-semibold">Status</th><th scope="col" className="px-3 py-1.5 font-semibold">Deadline</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">Latest report</th><th scope="col" className="px-3 py-1.5 font-semibold">Reports</th>
            </tr></thead>
            <tbody>
              {work.tasks.map(t => (
                <tr key={t.id} className="border-b border-slate-50 align-top">
                  <td className="px-3 py-1.5 font-semibold text-slate-800 break-words">{t.title}{t.project ? <span className="block text-[11px] font-normal text-slate-500">{t.project}</span> : null}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{TASK_STATUS[t.status] ?? t.status}{t.overdue ? <span className="ml-1 font-semibold text-rose-700">· overdue</span> : t.onTime === false ? <span className="ml-1 text-amber-700">· late</span> : t.onTime ? <span className="ml-1 text-emerald-700">· on time</span> : null}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{t.dueDate ? dateLabel(t.dueDate) : '—'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{t.lastReport ? <>{t.lastReport.progress}% · <ApprovalPill status={t.lastReport.status} /></> : <span className="text-slate-400">No report</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{t.reports}{t.pendingReports ? <span className="text-sky-700"> ({t.pendingReports} waiting)</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* AI Studio keeps its own daily reports (Team Lead, then Department Head): the drill-down opens those, with the same review dialog as Daily Reports */}
      {work?.source === 'AI_STUDIO' && (reports || viewer !== 'TEAM_HEAD') ? <>
        <h3 className="text-sm font-bold text-slate-900">Daily reports of {name}</h3>
        <div data-testid="person-ai-reports">
          <AiStudioReportList view={viewer === 'TEAM_HEAD' ? 'team' : 'department'} projects={[]} initial={{ authorId: id, from: start, to: end }} onChanged={changed} />
        </div>
      </> : reports && work?.source !== 'AI_STUDIO' ? <>
        <h3 className="text-sm font-bold text-slate-900">Daily reports of {name}</h3>
        <MemberTaskReports memberId={id} from={start} to={end} onChanged={changed} />
      </> : null}
    </div>
  );
};

const PeopleTable: React.FC<{ people: PerformanceMember[]; onChanged: () => void; empty: string; label: string; /** the period shown (for the drill-down) */ start: string; end: string }> = ({ people, onChanged, empty, label, start, end }) => {
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
                <td className="px-3 py-3"><RecordStatus record={p.record} />{p.record?.status === 'APPROVED' && p.record.rating ? <span className="block text-[11px] text-slate-600 mt-0.5">Rating {p.record.rating}/5</span> : null}</td>
                <td className="px-5 py-3 text-right"><button type="button" className={btnGhost} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{p.record?.canDecide ? 'Review' : 'Details'}</button></td>
              </tr>
              {open === p.id ? (
                <tr className="border-b border-slate-100 bg-slate-50/40"><td colSpan={10} className="px-5 py-4 space-y-3">
                  <ScoreParts parts={p.metrics.parts} score={p.metrics.score} />
                  {p.metrics.contribution ? (
                    // AI Studio (20270219000100): the work this person did across projects and teams (credited to them once)
                    <p className="text-xs text-slate-600" data-testid="contribution">
                      Projects contributed to: <b>{p.metrics.contribution.projects}</b> · Cross-team tasks: <b>{p.metrics.contribution.crossTeamTasks}</b> ·
                      Reported time: <b>{Math.floor(p.metrics.contribution.reportedMinutes / 60)} h {p.metrics.contribution.reportedMinutes % 60} min</b> · Blockers reported: <b>{p.metrics.contribution.blockers}</b>
                    </p>
                  ) : null}
                  <RecordNote record={p.record} />
                  <RecordActions person={p} onChanged={onChanged} autoReview showEvaluations />
                  <PersonWork id={p.id} name={p.name} start={start} end={end} reports onChanged={onChanged} />
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
const LeadView: React.FC<{ d: LeadPerformanceOverview; onChanged: () => void }> = ({ d, onChanged }) => (
  <div className="space-y-6">
    <LeadDetail m={d.me.metrics} />
    <Card label="Team members">
      <CardHead title="Team members" hint={`You evaluate your members: open one to see their tasks and daily reports, edit and approve or return the reports, then approve their performance with a rating. ${d.pendingReports} task report${d.pendingReports === 1 ? '' : 's'} waiting for your decision · ${d.pendingRecords} performance record${d.pendingRecords === 1 ? '' : 's'} pending`} />
      <PeopleTable people={d.members} onChanged={onChanged} empty="No team member reports to you yet." label="Team member performance" start={d.periodStart} end={d.periodEnd} />
    </Card>
    <Card label="My own performance">
      <CardHead title="Your performance as Team Lead" hint="Your own tasks, your team's progress, the reports you reviewed and the work you handed down. Your Department Head approves it." right={<RecordStatus record={d.me.record} />} />
      <ScoreParts parts={d.me.metrics.parts} score={d.me.metrics.score} />
      <div className="px-5 pb-5 space-y-3"><RecordNote record={d.me.record} /><RecordActions person={d.me} onChanged={onChanged} /></div>
    </Card>
  </div>
);

const LeadRow: React.FC<{ lead: PerformanceLead; onChanged: () => void; start: string; end: string }> = ({ lead, onChanged, start, end }) => {
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
        <td className="px-3 py-3"><RecordStatus record={lead.record} />{lead.record?.status === 'APPROVED' && lead.record.rating ? <span className="block text-[11px] text-slate-600 mt-0.5">Rating {lead.record.rating}/5</span> : null}</td>
        <td className="px-5 py-3 text-right"><button type="button" className={btnGhost} aria-expanded={open} onClick={() => setOpen(o => !o)}>{lead.record?.canDecide ? 'Review' : 'Open'}</button></td>
      </tr>
      {open ? (
        <tr className="border-b border-slate-100 bg-slate-50/40"><td colSpan={9} className="px-5 py-4 space-y-4">
          <LeadDetail m={m} />
          <ScoreParts parts={m.parts} score={m.score} />
          <RecordNote record={lead.record} />
          <RecordActions person={lead} onChanged={onChanged} autoReview showEvaluations />
          <PersonWork id={lead.id} name={lead.name} start={start} end={end} reports={false} onChanged={onChanged} />
          <div><h3 className="text-sm font-bold text-slate-900 mb-1">Team members of {lead.name}</h3>
            <p className="text-[11px] text-slate-500 mb-1">Each member&apos;s daily reports and performance with {lead.name}&apos;s decisions. {lead.name} evaluates the members; you read them.</p>
            <PeopleTable people={lead.members} onChanged={onChanged} empty="No team member under this Team Lead." label={`Team members of ${lead.name}`} start={start} end={end} /></div>
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
      <CardHead title={`${d.department.name}: Team Leads and teams`} hint={d.role === 'SUPER_ADMIN'
        ? 'Compare the teams. Open a Team Lead to read their figures, each approval and every member (read only: the Team Leads and the Department Head decide).'
        : 'Compare the teams. Open a Team Lead to read their figures and tasks, approve (with a rating) or return their performance, and see each member\'s reports and evaluation with the Team Lead\'s decision (read only: the Team Lead evaluates members).'} />
      {d.leads.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">No active Team Lead has people or tasks in this department yet.</p> : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm" data-testid="leads-table">
            <caption className="sr-only">Team Lead performance</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
              <th scope="col" className="px-5 py-2.5 font-semibold">Team Lead</th><th scope="col" className="px-3 py-2.5 font-semibold">Members</th><th scope="col" className="px-3 py-2.5 font-semibold">Team tasks</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Completion</th><th scope="col" className="px-3 py-2.5 font-semibold">Pending / overdue</th><th scope="col" className="px-3 py-2.5 font-semibold">Reports (approved / pending / returned)</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Score</th><th scope="col" className="px-3 py-2.5 font-semibold">Approval</th><th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{d.leads.map(l => <LeadRow key={l.id} lead={l} onChanged={onChanged} start={d.periodStart} end={d.periodEnd} />)}</tbody>
          </table>
        </div>
      )}
    </Card>
    {d.unassignedMembers.length ? (
      <Card label="Members without a Team Lead">
        <CardHead title="Team members without a Team Lead" hint={d.leadDecidesMembers ? 'Name a Team Lead for them: only their Team Lead reviews their daily reports and evaluates their performance. Their waiting reports are kept until then.' : 'Until they have a Team Lead, you review their daily reports and evaluate their performance.'} />
        <PeopleTable people={d.unassignedMembers} onChanged={onChanged} empty="" label="Members without a Team Lead" start={d.periodStart} end={d.periodEnd} />
      </Card>
    ) : null}
  </div>
);

/**
 * Performance and approvals. One page for every role (the database says who the caller is and what they may see):
 *   Team Member: nothing (20270213000100: performance is the Team Lead's and the Department Head's; the database refuses a member).
 *   Team Lead: each member's figures and the approval of their performance, and the Team Lead's own performance.
 *   Department Head: every Team Lead and team of the department, compared, with approval of each Team Lead's performance.
 * The figures come from the task records and the approved daily reports of the chosen period; nothing is typed in.
 */
export const PerformanceApprovals: React.FC<{ departmentId?: string; title?: string; subtitle?: string; /** another filter next to the period (the Super Admin's department) */ filter?: React.ReactNode }> = ({ departmentId, title = 'Performance', subtitle, filter }) => {
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
          {filter}
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
      <ViewerRole.Provider value={data?.role ?? null}>
        {data?.role === 'TEAM_HEAD' ? <LeadView d={data} onChanged={() => void load()} /> : null}
        {data && (data.role === 'DEPARTMENT_HEAD' || data.role === 'SUPER_ADMIN') ? <DepartmentView d={data} onChanged={() => void load()} /> : null}
      </ViewerRole.Provider>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CornerUpLeft, History } from 'lucide-react';
import type { FieldChanges, TaskDailyReport, TaskDailyReportDetail, TaskDailyReportList, TaskReportStatus, TaskReportTaskOption } from '../../../shared/contracts';
import { taskReportReviewerEditSchema, taskReportSubmitSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { taskReportsApi } from '../../lib/api/taskReports';
import { officeToday } from '../../lib/officeTime';
import { btn, Card, ErrorBanner, Field, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';
import { dateLabel, Stat, timeLabel } from './reportUi';
import { Paged } from '../common/Paged';
import { ReportWordFields, reportWordsWithinLimits } from '../common/ReportWordFields';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** The three words every screen uses for a task report (the same words as performance records): Pending, Approved, Returned for correction. */
export const TASK_REPORT_STATUS_LABEL: Record<TaskReportStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', RETURNED: 'Returned for correction' };
const TONE: Record<TaskReportStatus, string> = {
  PENDING: 'bg-sky-50 text-sky-700 ring-sky-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  RETURNED: 'bg-amber-50 text-amber-800 ring-amber-200'
};
export const ApprovalPill: React.FC<{ status: TaskReportStatus }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${TONE[status]}`} data-testid={`approval-${status}`}>
    {TASK_REPORT_STATUS_LABEL[status]}
  </span>
);

const FILTERS: { id: '' | TaskReportStatus; label: string }[] = [
  { id: '', label: 'All' }, { id: 'PENDING', label: 'Pending' }, { id: 'APPROVED', label: 'Approved' }, { id: 'RETURNED', label: 'Returned for correction' }
];

// ------------------------------------------------------------------------------------------------ the Team Member's form
// (20270305000100) the report has three optional fields: Work Completed (150 words), Work Pending (100), Additional Note (50); progress and the reason for delay
// are no longer asked for (the report keeps the task's own progress)
interface Draft { taskId: string; reportDate: string; workCompleted: string; pendingWork: string; remarks: string }
const emptyDraft = (taskId = ''): Draft => ({ taskId, reportDate: officeToday(), workCompleted: '', pendingWork: '', remarks: '' });

const TaskReportForm: React.FC<{ initial: Draft | null; onDone: (r: TaskDailyReport) => void; onCancel?: () => void }> = ({ initial, onDone, onCancel }) => {
  const [tasks, setTasks] = useState<TaskReportTaskOption[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [d, setD] = useState<Draft>(initial ?? emptyDraft());
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => { if (initial) setD(initial); }, [initial]);
  useEffect(() => { taskReportsApi.myTasks().then(setTasks, e => setLoadError(errText(e))); }, []);

  const task = useMemo(() => tasks?.find(t => t.id === d.taskId) ?? null, [tasks, d.taskId]);
  const withinLimits = reportWordsWithinLimits(d);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD(v => ({ ...v, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const body = {
      taskId: d.taskId, reportDate: d.reportDate, workCompleted: d.workCompleted.trim() || undefined,
      pendingWork: d.pendingWork.trim() || undefined, remarks: d.remarks.trim() || undefined
    };
    // the same schema the server uses
    const parsed = taskReportSubmitSchema.safeParse(body);
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] as keyof Draft] = i.message;
    if (!d.taskId) next.taskId = 'Choose the task you are reporting on.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const r = await taskReportsApi.submit(body);
      setD(emptyDraft());
      onDone(r);
    } catch (err) {
      setServerError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!tasks) return <Spinner />;
  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-4" noValidate data-testid="task-report-form">
        <div>
          <h2 className="text-base font-bold text-slate-900">{initial ? 'Correct and resubmit your report' : 'Daily report on an assigned task'}</h2>
          <p className="text-xs text-slate-500">One report for each task and day. Your Team Lead approves it or returns it for correction.</p>
        </div>
        {tasks.length === 0 ? <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">You have no assigned task to report on.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assigned task" htmlFor="tr-task" required error={errors.taskId}>
            <select id="tr-task" className={`${selectCls} w-full`} value={d.taskId} onChange={set('taskId')} disabled={saving || !!initial} aria-invalid={!!errors.taskId}>
              <option value="">Choose a task</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.dueDate ? ` (due ${dateLabel(t.dueDate)})` : ''}{t.reportedToday ? ' · reported today' : ''}</option>)}
            </select>
          </Field>
          <Field label="Date of the report" htmlFor="tr-date" required error={errors.reportDate}>
            <input id="tr-date" type="date" className={inputCls} value={d.reportDate} max={officeToday()} onChange={set('reportDate')} disabled={saving || !!initial} />
          </Field>
        </div>
        {task ? (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="task-report-task">
            <span className="font-semibold text-slate-800">{task.title}</span> · {task.status.replace('_', ' ').toLowerCase()} · {task.priority.toLowerCase()} priority · task progress {task.progress}%
            {task.dueDate ? ` · due ${dateLabel(task.dueDate)}` : ' · no deadline'}
          </div>
        ) : null}
        <ReportWordFields idPrefix="tr" values={d} errors={errors} disabled={saving} inputClassName={inputCls} onChange={(k, v) => setD(x => ({ ...x, [k]: v }))} />
        {serverError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{serverError}</div> : null}
        <div className="flex gap-2">
          <button type="submit" className={btn.primary} disabled={saving || tasks.length === 0 || !withinLimits} data-testid="task-report-submit">{saving ? 'Submitting…' : initial ? 'Resubmit for approval' : 'Submit to Team Lead'}</button>
          {onCancel ? <button type="button" className={btn.secondary} onClick={onCancel} disabled={saving}>Cancel</button> : null}
        </div>
      </form>
    </Card>
  );
};

// ------------------------------------------------------------------------------------------------ a report card
const ReportCard: React.FC<{ r: TaskDailyReport; onReview?: (r: TaskDailyReport) => void; onEdit?: (r: TaskDailyReport) => void; onHistory: (r: TaskDailyReport) => void; showAuthor: boolean }> = ({ r, onReview, onEdit, onHistory, showAuthor }) => (
  <li className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2" data-testid="task-report-row">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-900 break-words">{r.taskTitle}</div>
        <div className="text-xs text-slate-500">
          {showAuthor ? <>{r.author} · </> : null}{dateLabel(r.reportDate)} · task progress {r.progress}%{r.revision > 1 ? ` · revision ${r.revision}` : ''}
        </div>
      </div>
      <ApprovalPill status={r.status} />
    </div>
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {/* the three fields of the report (20270305000100); a reason for delay is shown only on an older report that has one */}
      {r.workCompleted ? <div><dt className="font-semibold text-slate-500">Work Completed</dt><dd className="text-slate-800 whitespace-pre-wrap break-words">{r.workCompleted}</dd></div> : null}
      {r.pendingWork ? <div><dt className="font-semibold text-slate-500">Work Pending</dt><dd className="text-slate-800 whitespace-pre-wrap break-words">{r.pendingWork}</dd></div> : null}
      {r.remarks ? <div><dt className="font-semibold text-slate-500">Additional Note</dt><dd className="text-slate-800 whitespace-pre-wrap break-words">{r.remarks}</dd></div> : null}
      {r.delayReason ? <div><dt className="font-semibold text-slate-500">Reason for delay</dt><dd className="text-slate-800 whitespace-pre-wrap break-words">{r.delayReason}</dd></div> : null}
    </dl>
    {r.editedAt ? (
      <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900" data-testid="task-report-edited">Edited by {r.editedBy ?? 'the Team Lead'} on {timeLabel(r.editedAt)} before the decision (see the approval history for what changed)</div>
    ) : null}
    {r.reviewedAt ? (
      <div className={`rounded-lg px-3 py-2 text-xs ${r.status === 'RETURNED' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>
        {r.status === 'RETURNED' ? 'Returned' : 'Approved'} by {r.reviewedBy ?? 'the Team Lead'} on {timeLabel(r.reviewedAt)}{r.reviewRemarks ? <> · “{r.reviewRemarks}”</> : null}
      </div>
    ) : null}
    <div className="flex flex-wrap gap-2 pt-1">
      {r.canReview && onReview ? <button type="button" className={btn.green} onClick={() => onReview(r)}><CheckCircle2 size={14} aria-hidden="true" />Review</button> : null}
      {r.canEdit && onEdit ? <button type="button" className={btn.primary} onClick={() => onEdit(r)}><CornerUpLeft size={14} aria-hidden="true" />Correct and resubmit</button> : null}
      <button type="button" className={btn.secondary} onClick={() => onHistory(r)}><History size={14} aria-hidden="true" />Approval history</button>
    </div>
  </li>
);

const HistoryPanel: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [d, setD] = useState<TaskDailyReportDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { taskReportsApi.get(id).then(setD, e => setErr(errText(e))); }, [id]);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between" data-testid="task-report-history"><h3 className="text-sm font-bold text-slate-900">Approval history</h3><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
      {err ? <ErrorBanner message={err} /> : !d ? <Spinner /> : (
        <Paged items={d.history} noun="entries">{rows => (
        <ol className="space-y-1.5 text-xs">
          {rows.map((h, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
              <span className="font-semibold text-slate-800">{h.action === 'SUBMITTED' ? 'Submitted' : h.action === 'RESUBMITTED' ? 'Resubmitted' : h.action === 'APPROVED' ? 'Approved' : h.action === 'EDITED' ? 'Edited by the Team Lead' : 'Returned for correction'}</span>
              {h.by ? ` by ${h.by}` : ''} · {timeLabel(h.at)} · revision {h.revision}{h.remarks ? <> · “{h.remarks}”</> : null}
              {h.changes ? <ChangeList changes={h.changes} /> : null}
            </li>
          ))}
        </ol>
        )}</Paged>
      )}
    </Card>
  );
};

const FIELD_LABEL: Record<string, string> = { workCompleted: 'Work Completed', progress: 'Progress (%)', pendingWork: 'Work Pending', delayReason: 'Reason for delay', remarks: 'Additional Note', rating: 'Rating' };
/** What a reviewer changed: each field, before and after. */
export const ChangeList: React.FC<{ changes: FieldChanges }> = ({ changes }) => (
  <ul className="mt-1 space-y-0.5" data-testid="change-list">
    {Object.entries(changes).map(([k, v]) => (
      <li key={k} className="text-slate-600 break-words"><span className="font-semibold">{FIELD_LABEL[k] ?? k}:</span> <s className="text-slate-400">{v.from === null || v.from === '' ? '(empty)' : String(v.from)}</s> → {v.to === null || v.to === '' ? '(empty)' : String(v.to)}</li>
    ))}
  </ul>
);

// ------------------------------------------------------------------------------------------------ the Team Lead edits a waiting report
// (20270305000100) the same three fields as the member's form; progress and the reason for delay stay as the report has them
interface EditDraft { workCompleted: string; pendingWork: string; remarks: string; reason: string }
const ReviewerEditForm: React.FC<{ r: TaskDailyReport; onSaved: (r: TaskDailyReport) => void; onCancel: () => void }> = ({ r, onSaved, onCancel }) => {
  const [d, setD] = useState<EditDraft>({ workCompleted: r.workCompleted ?? '', pendingWork: r.pendingWork ?? '', remarks: r.remarks ?? '', reason: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof EditDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (k: keyof EditDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD(v => ({ ...v, [k]: e.target.value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const body = { workCompleted: d.workCompleted.trim() || undefined, pendingWork: d.pendingWork.trim() || undefined, delayReason: r.delayReason ?? undefined,
      remarks: d.remarks.trim() || undefined, reason: d.reason.trim() };
    // the same schema the server uses (the database checks again, with the task's deadline)
    const parsed = taskReportReviewerEditSchema.safeParse(body);
    const next: Partial<Record<keyof EditDraft, string>> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] as keyof EditDraft] = i.message;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try { onSaved(await taskReportsApi.reviewerEdit(r.id, body)); } catch (err) { setServerError(errText(err)); } finally { setBusy(false); }
  };
  const id = (k: string) => `tre-${k}-${r.id}`;
  return (
    <form onSubmit={save} noValidate className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3" data-testid="task-report-edit">
      <p className="text-xs text-slate-600">Correct the report before you decide it. The team member is told what you changed and why; the change is kept in the approval history.</p>
      <ReportWordFields idPrefix={`tre-${r.id}`} values={d} errors={errors} disabled={busy} inputClassName={inputCls} onChange={(k, v) => setD(x => ({ ...x, [k]: v }))} />
      <Field label="Why you changed it (the team member reads this)" htmlFor={id('reason')} required error={errors.reason}>
        <input id={id('reason')} className={inputCls} value={d.reason} onChange={set('reason')} disabled={busy} maxLength={1000} />
      </Field>
      {serverError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{serverError}</div> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btn.primary} disabled={busy || !reportWordsWithinLimits(d)}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={btn.secondary} disabled={busy} onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
};

// ------------------------------------------------------------------------------------------------ the review dialog (inline panel)
const ReviewPanel: React.FC<{ r: TaskDailyReport; onDone: () => void; onCancel: () => void; /** the report was edited (the list reloads, the panel stays open) */ onEdited?: () => void }> = ({ r: initial, onDone, onCancel, onEdited }) => {
  const [r, setR] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const decide = async (decision: 'APPROVE' | 'RETURN') => {
    if (decision === 'RETURN' && remarks.trim().length < 5) { setErr('Say what must be corrected (at least 5 characters).'); return; }
    setBusy(true); setErr('');
    try { await taskReportsApi.review(r.id, decision, remarks.trim() || undefined); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3 border-indigo-200">
      <div className="text-sm font-bold text-slate-900" data-testid="task-report-review">Review: {r.author} · {r.taskTitle} · {dateLabel(r.reportDate)}</div>
      {saved ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Your changes are saved. Now approve the report or return it for correction.</p> : null}
      {editing ? (
        <ReviewerEditForm r={r} onCancel={() => setEditing(false)} onSaved={next => { setR(next); setEditing(false); setSaved(true); onEdited?.(); }} />
      ) : r.canReviewerEdit ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>Progress {r.progress}%{r.pendingWork ? ` · pending: ${r.pendingWork}` : ''}</span>
          <button type="button" className={btn.secondary} onClick={() => { setEditing(true); setSaved(false); }} disabled={busy}>Edit report</button>
        </div>
      ) : null}
      <Field label="Remarks (required when you return the report)" htmlFor="tr-review-remarks" error={err || undefined}>
        <textarea id="tr-review-remarks" rows={2} className={inputCls} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={busy} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.green} disabled={busy || editing} onClick={() => void decide('APPROVE')}>Approve</button>
        <button type="button" className={btn.danger} disabled={busy || editing} onClick={() => void decide('RETURN')}>Return for correction</button>
        <button type="button" className={btn.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------------------------------------ the list (mine, or the team's)
const ReportList: React.FC<{ scope: 'MINE' | 'TEAM'; reloadKey: number; onChanged: () => void; onEdit?: (r: TaskDailyReport) => void;
  /** one team member's reports (the Performance Management drill-down), from the period shown there, every status */ memberId?: string; initialFrom?: string; initialTo?: string }> = ({ scope, reloadKey, onChanged, onEdit, memberId, initialFrom, initialTo }) => {
  const [status, setStatus] = useState<'' | TaskReportStatus>(scope === 'TEAM' && !memberId ? 'PENDING' : '');
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TaskDailyReportList | null>(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<TaskDailyReport | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const PAGE = 20;

  const load = useCallback(() => {
    setError('');
    taskReportsApi.list({ scope, status: status || undefined, from: from || undefined, to: to || undefined, memberId, page }).then(setData, e => setError(errText(e)));
  }, [scope, status, from, to, page, memberId]);
  useEffect(load, [load, reloadKey]);
  useEffect(() => { setPage(1); }, [status, from, to]);

  const total = data?.total ?? 0;
  return (
    <div className="space-y-3" data-testid={`task-report-list-${scope}`}>
      {data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Reports" value={data.counts.total} />
          <Stat label="Pending" value={data.counts.pending} tone="info" />
          <Stat label="Approved" value={data.counts.approved} tone="good" />
          <Stat label="Returned for correction" value={data.counts.returned} tone="warn" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div role="tablist" aria-label="Report status" className="flex flex-wrap gap-1">
          {FILTERS.map(f => (
            <button key={f.id || 'all'} role="tab" aria-selected={status === f.id} type="button" onClick={() => setStatus(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === f.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{f.label}</button>
          ))}
        </div>
        <label className="text-xs text-slate-500">From <input type="date" className={`${selectCls} ml-1`} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To <input type="date" className={`${selectCls} ml-1`} value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {reviewing ? <ReviewPanel key={reviewing.id} r={reviewing} onCancel={() => setReviewing(null)} onDone={() => { setReviewing(null); load(); onChanged(); }} onEdited={() => { load(); onChanged(); }} /> : null}
      {history ? <HistoryPanel id={history} onClose={() => setHistory(null)} /> : null}
      {error ? <ErrorBanner message={error} onRetry={load} /> : !data ? <Spinner /> : data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {scope === 'MINE' ? 'You have not submitted a task report for this filter yet.' : 'No task report matches this filter.'}
        </p>
      ) : (
        <ul className="space-y-3">{data.items.map(r => <ReportCard key={r.id} r={r} showAuthor={scope === 'TEAM'} onReview={setReviewing} onEdit={onEdit} onHistory={x => setHistory(x.id)} />)}</ul>
      )}
      {total > PAGE ? (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <button type="button" className={btn.secondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(total / PAGE)}</span>
          <button type="button" className={btn.secondary} disabled={page * PAGE >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
};

/** One team member's daily reports for the reviewer (Performance Management): review, edit and decide them in place. */
export const MemberTaskReports: React.FC<{ memberId: string; from: string; to: string; onChanged: () => void }> = ({ memberId, from, to, onChanged }) => (
  <ReportList scope="TEAM" reloadKey={0} onChanged={onChanged} memberId={memberId} initialFrom={from} initialTo={to} />
);

/**
 * Task daily reports. One component for every level; what it shows follows the person's place in the chain (the database refuses the rest):
 *   Team Member: report on an assigned task, and the list of their reports with Pending / Approved / Returned for correction.
 *   Team Lead: the team's reports; approve one or return it with a reason.
 *   Department Head: every report of the department with its approval status (read-only).
 */
export const TaskReports: React.FC<{ level: 'MEMBER' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | 'OTHER' }> = ({ level }) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [banner, setBanner] = useState('');
  const bump = () => setReloadKey(k => k + 1);

  if (level === 'MEMBER') {
    return (
      <div className="space-y-4">
        {banner ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{banner}</div> : null}
        <TaskReportForm
          key={editing?.taskId ?? 'new'}
          initial={editing}
          onCancel={editing ? () => setEditing(null) : undefined}
          onDone={r => { setEditing(null); bump(); setBanner(`Your report on “${r.taskTitle}” for ${dateLabel(r.reportDate)} was sent to your Team Lead (Pending).`); }}
        />
        <h2 className="text-sm font-bold text-slate-900">My task reports</h2>
        <ReportList scope="MINE" reloadKey={reloadKey} onChanged={bump} onEdit={r => setEditing({
          taskId: r.taskId, reportDate: r.reportDate, workCompleted: r.workCompleted ?? '', pendingWork: r.pendingWork ?? '', remarks: r.remarks ?? ''
        })} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        {level === 'TEAM_LEAD' ? 'Daily reports of your team members against their tasks. Edit a report if something needs correcting, then approve it or return it for correction.' : 'Every task daily report of your department and where it is in the approval.'}
      </p>
      <ReportList scope="TEAM" reloadKey={reloadKey} onChanged={bump} />
    </div>
  );
};

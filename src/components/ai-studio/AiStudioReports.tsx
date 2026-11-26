import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { AI_STUDIO_REPORT_STATUS_LABELS, type AiStudioPerson, type AiStudioProject, type AiStudioReportContext, type AiStudioReportDetail, type AiStudioReportPage, type AiStudioReportStatus, type AiStudioRole } from '../../../shared/contracts';
import { aiStudioReportLeadEditSchema, aiStudioReportReviewSchema, aiStudioReportSchema } from '../../../shared/validation';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { Dialog, ErrorBanner, Field, Pager, Spinner } from '../team-member/pipeline/shared';
import { Card, Tabs, fieldCls, ghostBtn, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { CrossTeamBadge } from './AssigneePicker';
import { DailyReportForm, hoursText } from './DailyReportForm';
import { notifyAiStudioChanged, peekPendingAiStudio, usePendingAiStudio, useAiStudioChanged } from './aiStudioEvents';
import { ReportStatusBadge, TableWrap, dateText, dateTimeText, tdCls, thCls, todayIso, useLoad } from './ui';

// The daily report asks three things: what was completed, what is pending, and any challenge. "Work In Progress" (the same as pending work) and "Remarks" were
// dropped from the form to keep it short; they are shown (and kept when the report is edited) only on an older report that already has them.
const PARTS: { key: 'workCompleted' | 'workInProgress' | 'pendingWork' | 'blockers' | 'remarks'; label: string; required?: boolean; legacy?: boolean }[] = [
  { key: 'workCompleted', label: 'Work Completed Today', required: true },
  { key: 'pendingWork', label: 'Pending Work' },
  { key: 'blockers', label: 'Challenges / Blockers' },
  { key: 'workInProgress', label: 'Work In Progress', legacy: true },
  { key: 'remarks', label: 'Remarks or Additional Updates', legacy: true }
];
/** The parts to show: the three of the form, and an older report's extra parts only when they have text. */
const shownParts = (values: Partial<Record<(typeof PARTS)[number]['key'], string | null>>) => PARTS.filter(p => !p.legacy || (values[p.key] ?? '').trim() !== '');
// a day's report with several tasks (20270219000100) keeps its day-level parts in the same columns, under these names
const DAY_PARTS: typeof PARTS = [
  { key: 'workCompleted', label: 'Overall daily summary', required: true },
  { key: 'remarks', label: 'Additional work performed' },
  { key: 'blockers', label: 'Blockers and challenges' },
  { key: 'pendingWork', label: "Tomorrow's planned work" }
];
const partsOf = (r: AiStudioReportDetail) => (r.consolidated ? DAY_PARTS.filter(p => p.required || (r[p.key] ?? '').trim() !== '') : shownParts(r));

/**
 * The daily report form (Team Member and Team Lead): the date, the project, the task, and what was done. "Save draft" keeps it private; "Submit Daily Report" sends it
 * for approval (a Team Member's goes to their Team Lead, a Team Lead's to the Department Head). A returned report opens here again with the reviewer's remarks.
 */
export const ReportForm: React.FC<{ existing?: AiStudioReportDetail; onDone: (r: AiStudioReportDetail) => void; onCancel?: () => void }> = ({ existing, onDone, onCancel }) => {
  const ctx = useLoad<AiStudioReportContext>(() => aiStudioApi.reportContext(), []);
  const [date, setDate] = useState(existing?.reportDate ?? todayIso());
  const [projectId, setProjectId] = useState(existing?.projectId ?? '');
  const [taskId, setTaskId] = useState(existing?.taskId ?? '');
  const [text, setText] = useState({
    workCompleted: existing?.workCompleted ?? '', workInProgress: existing?.workInProgress ?? '', pendingWork: existing?.pendingWork ?? '', blockers: existing?.blockers ?? '', remarks: existing?.remarks ?? ''
  });
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const projects = ctx.data?.projects ?? [];
  useEffect(() => { if (!projectId && projects.length) setProjectId(projects[0].id); }, [projects, projectId]);
  const tasks = useMemo(() => (ctx.data?.tasks ?? []).filter(t => t.projectId === projectId), [ctx.data, projectId]);
  useEffect(() => { if (taskId && !tasks.some(t => t.id === taskId)) setTaskId(''); }, [tasks, taskId]);

  const save = async (submit: boolean) => {
    const parsed = aiStudioReportSchema.safeParse({ projectId, taskId: taskId || null, reportDate: date, ...text, submit });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    setSaving(submit ? 'submit' : 'draft');
    setError('');
    const body = { projectId, taskId: taskId || null, reportDate: date, workCompleted: text.workCompleted, workInProgress: text.workInProgress, pendingWork: text.pendingWork, blockers: text.blockers, remarks: text.remarks, submit };
    try {
      const saved = existing ? await aiStudioApi.updateReport(existing.id, body) : await aiStudioApi.createReport(body);
      notifyAiStudioChanged();
      onDone(saved);
    } catch (err) { setError(errorMessage(err)); setSaving(null); }
  };

  if (ctx.loading && !ctx.data) return <Spinner label="Loading the report form…" />;
  if (ctx.error) return <ErrorBanner message={ctx.error} onRetry={ctx.reload} />;
  if (projects.length === 0) return <Card className="p-8 text-center text-sm text-slate-500">You are not on a project yet, so there is nothing to report on. Ask your {ctx.data?.role === 'LEAD' ? 'Department Head' : 'Team Lead'} to add you to one.</Card>;
  const returnedNote = existing?.status === 'RETURNED_BY_TL' ? existing.tlComment : existing?.status === 'RETURNED_BY_DH' ? existing.dhComment : null;
  return (
    <form onSubmit={e => { e.preventDefault(); void save(true); }} aria-label="Daily report" className="space-y-4">
      {returnedNote && (
        <div role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>{existing?.status === 'RETURNED_BY_TL' ? 'Your Team Lead' : 'The Department Head'} returned this report:</strong> {returnedNote}
        </div>
      )}
      <Card className="p-5 space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Report date" htmlFor="ai-rp-date" required>
            <input id="ai-rp-date" type="date" className={fieldCls} value={date} min={new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)} max={ctx.data?.today ?? todayIso()} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="Project" htmlFor="ai-rp-project" required>
            <select id="ai-rp-project" className={fieldCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Assigned task" htmlFor="ai-rp-task">
            <select id="ai-rp-task" className={fieldCls} value={taskId} onChange={e => setTaskId(e.target.value)}>
              <option value="">No specific task</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </Field>
        </div>
        {shownParts(existing ?? {}).map(p => (
          <Field key={p.key} label={p.label} htmlFor={`ai-rp-${p.key}`} required={p.required}>
            <textarea id={`ai-rp-${p.key}`} className={textareaCls} rows={p.key === 'workCompleted' ? 4 : 3} maxLength={4000} value={text[p.key]} onChange={e => setText(t => ({ ...t, [p.key]: e.target.value }))} />
          </Field>
        ))}
        <p className="text-xs text-slate-500">
          {!ctx.data?.hasReviewer
            ? 'There is nobody to review this report yet. You can save a draft.'
            : ctx.data.route === 'DIRECT' && ctx.data.role === 'MEMBER'
            ? `You have no Team Lead assigned yet, so this report goes straight to ${ctx.data.reviewer} for review and approval. Once a Team Lead is assigned, new reports go to them first.`
            : ctx.data.route === 'DIRECT'
            ? `When you submit, this report goes to ${ctx.data.reviewer} for review and approval.`
            : `When you submit, this report goes to ${ctx.data.reviewer} for approval, then for the final approval.`}
        </p>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={!!saving || !ctx.data?.hasReviewer}>{saving === 'submit' ? 'Submitting…' : 'Submit Daily Report'}</button>
          <button type="button" className={ghostBtn} disabled={!!saving} onClick={() => void save(false)}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>
          {onCancel && <button type="button" className={ghostBtn} disabled={!!saving} onClick={onCancel}>Cancel</button>}
        </div>
      </Card>
    </form>
  );
};

const PART_LABEL: Record<string, string> = Object.fromEntries(PARTS.map(p => [p.key, p.label]));

/** The Team Lead corrects a report waiting for their approval before deciding it (20270214000100): the employee reads the reason and every change is kept. */
const LeadEditForm: React.FC<{ r: AiStudioReportDetail; onSaved: () => void; onCancel: () => void }> = ({ r, onSaved, onCancel }) => {
  const [text, setText] = useState<Record<(typeof PARTS)[number]['key'], string>>({
    workCompleted: r.workCompleted ?? '', workInProgress: r.workInProgress ?? '', pendingWork: r.pendingWork ?? '', blockers: r.blockers ?? '', remarks: r.remarks ?? ''
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = aiStudioReportLeadEditSchema.safeParse({ ...text, reason });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? 'Please check the report.'); return; }
    setBusy(true); setProblem('');
    try { await aiStudioApi.leadEdit(r.id, parsed.data); notifyAiStudioChanged(); onSaved(); } catch (err) { setProblem(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} noValidate className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 space-y-3" aria-label="Edit this report" data-testid="ai-report-lead-edit">
      <p className="text-xs text-slate-600">Correct the report before you approve it. The employee is told what you changed and why; the change stays in the approval history.</p>
      {partsOf(r).map(p => (
        <Field key={p.key} label={p.label} htmlFor={`ai-le-${p.key}`} required={p.required}>
          <textarea id={`ai-le-${p.key}`} className={textareaCls} rows={p.key === 'workCompleted' ? 4 : 2} maxLength={4000} value={text[p.key]} onChange={e => setText(t => ({ ...t, [p.key]: e.target.value }))} disabled={busy} />
        </Field>
      ))}
      <Field label="Why you changed it (the employee reads this)" htmlFor="ai-le-reason" required>
        <input id="ai-le-reason" className={fieldCls} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} />
      </Field>
      {problem && <ErrorBanner message={problem} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
};

/** One report in full, with its approval history, and (when the database says so) the decision form or the edit form. */
export const ReportDialog: React.FC<{ id: string; onClose: () => void; onChanged?: () => void }> = ({ id, onClose, onChanged }) => {
  const { data: r, error, reload } = useLoad<AiStudioReportDetail>(() => aiStudioApi.report(id), [id]);
  const [editing, setEditing] = useState(false);
  const [leadEditing, setLeadEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const decide = async (decision: 'APPROVE' | 'RETURN') => {
    const parsed = aiStudioReportReviewSchema.safeParse({ decision, comment });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? 'Please check the remarks.'); return; }
    setBusy(true);
    setProblem('');
    try {
      await aiStudioApi.review(id, decision, parsed.data.comment ?? undefined);
      setComment('');
      notifyAiStudioChanged();
      onChanged?.();
      reload();
    } catch (err) { setProblem(errorMessage(err)); } finally { setBusy(false); }
  };
  if (editing && r) {
    return (
      <Dialog title="Edit report" onClose={() => setEditing(false)} wide persistent>
        {r.consolidated
          ? <DailyReportForm date={r.reportDate} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged?.(); reload(); }} />
          : <ReportForm existing={r} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged?.(); reload(); }} />}
      </Dialog>
    );
  }
  return (
    <Dialog title={r ? `Daily report · ${dateText(r.reportDate)}` : 'Daily report'} description={r ? `${r.authorName} · ${r.consolidated ? `${r.taskCount ?? r.entries?.length ?? 0} tasks${r.totalMinutes ? ` · ${hoursText(r.totalMinutes)}` : ''}` : r.projectName}${r.taskTitle ? ` · ${r.taskTitle}` : ''}` : undefined} onClose={onClose} wide>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!r && !error && <Spinner label="Loading the report…" />}
      {r && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ReportStatusBadge status={r.status} />
            <span className="text-slate-500">Submitted {dateTimeText(r.submittedAt)}{r.revision > 1 ? ` · version ${r.revision}` : ''}</span>
            {r.leadName && r.authorRole === 'MEMBER' && <span className="text-slate-500">Team Lead: {r.leadName}</span>}
          </div>
          {r.consolidated && r.entries?.length ? (
            <div className="space-y-2" data-testid="report-entries">
              <h3 className="text-sm font-extrabold text-slate-900">Tasks ({r.entries.length}){r.totalMinutes ? <span className="font-normal text-slate-500"> · {hoursText(r.totalMinutes)} reported</span> : null}</h3>
              {r.entries.map((e, i) => (
                <div key={e.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">Task {i + 1} · {e.taskTitle}{e.assignmentType === 'CROSS_TEAM' ? <CrossTeamBadge /> : null}</div>
                  <div className="text-xs text-slate-500">{[e.projectName, e.assignedByName ? `assigned by ${e.assignedByName}` : null,
                    e.previousProgress != null && e.reportedProgress != null ? `${e.previousProgress}% → ${e.reportedProgress}%` : null,
                    e.minutesSpent != null ? hoursText(e.minutesSpent) : null].filter(Boolean).join(' · ')}</div>
                  {e.workCompleted && <p className="mt-1 text-slate-700 whitespace-pre-wrap">{e.workCompleted}</p>}
                  {e.blockers && <p className="mt-1 text-amber-800 whitespace-pre-wrap"><span className="font-semibold">Blockers:</span> {e.blockers}</p>}
                  {e.nextAction && <p className="mt-1 text-slate-600 whitespace-pre-wrap"><span className="font-semibold">Next action:</span> {e.nextAction}</p>}
                </div>
              ))}
            </div>
          ) : null}
          {partsOf(r).map(p => (
            <div key={p.key}>
              <div className="text-xs font-semibold text-slate-500 mb-1">{p.label}</div>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{r[p.key] || <span className="text-slate-400">-</span>}</p>
            </div>
          ))}
          {leadEditing ? <LeadEditForm r={r} onCancel={() => setLeadEditing(false)} onSaved={() => { setLeadEditing(false); onChanged?.(); reload(); }} />
            : r.canLeadEdit ? <div><button type="button" className={ghostBtn} onClick={() => setLeadEditing(true)}>Edit report</button></div> : null}
          {r.canReview && !leadEditing && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3" role="group" aria-label="Review this report">
              <h3 className="text-sm font-extrabold text-slate-900">{r.reviewStage === 'TEAM_LEAD' ? 'Team Lead review' : 'Department Head review'}</h3>
              <Field label="Remarks (needed when you return the report)" htmlFor="ai-rv-comment">
                <textarea id="ai-rv-comment" className={textareaCls} rows={3} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />
              </Field>
              {problem && <ErrorBanner message={problem} />}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => void decide('APPROVE')}>{r.reviewStage === 'TEAM_LEAD' ? 'Approve and send to the Department Head' : 'Approve (final)'}</button>
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => void decide('RETURN')}>Return / request changes</button>
              </div>
            </div>
          )}
          {r.canEdit && <div><button type="button" className={primaryBtn} onClick={() => setEditing(true)}>{r.status === 'DRAFT' ? 'Edit draft' : 'Edit and resubmit'}</button></div>}
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 mb-2">Approval history</h3>
            <ol className="space-y-2">
              {r.history.map(h => (
                <li key={h.id} className="text-sm border-l-2 border-slate-200 pl-3">
                  <div className="font-semibold text-slate-800">
                    {h.action === 'CREATED' ? 'Draft created' : h.action === 'SUBMITTED' ? 'Submitted' : h.action === 'RESUBMITTED' ? 'Resubmitted' : h.action === 'EDITED' ? 'Edited by the Team Lead' : h.action === 'APPROVED' ? `Approved by ${h.stage === 'TEAM_LEAD' ? 'Team Lead' : 'Department Head'}` : `Returned by ${h.stage === 'TEAM_LEAD' ? 'Team Lead' : 'Department Head'}`}
                    <span className="font-normal text-slate-500"> · {h.actorName ?? 'Someone'} · {dateTimeText(h.createdAt)} · {AI_STUDIO_REPORT_STATUS_LABELS[h.toStatus]}</span>
                  </div>
                  {h.comment && <p className="text-slate-600 whitespace-pre-wrap">{h.comment}</p>}
                  {h.changes ? (
                    <ul className="mt-1 space-y-0.5 text-xs" data-testid="ai-report-changes">
                      {Object.entries(h.changes).map(([k, v]) => <li key={k} className="text-slate-600 break-words"><span className="font-semibold">{PART_LABEL[k] ?? k}:</span> <s className="text-slate-400">{v.from || '(empty)'}</s> → {v.to || '(empty)'}</li>)}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex justify-end"><button type="button" className={ghostBtn} onClick={onClose}>Close</button></div>
        </div>
      )}
    </Dialog>
  );
};

interface Filters { projectId: string; status: string; leadId: string; authorId: string; from: string; to: string }
const NO_FILTERS: Filters = { projectId: '', status: '', leadId: '', authorId: '', from: '', to: '' };

/**
 * A list of reports. 'mine' is the author's own (drafts included), 'team' a Team Lead's team, 'department' every submitted report for the Department Head. The database
 * filters and pages; the tabs show how many reports wait at each step.
 */
export const ReportList: React.FC<{
  view: 'mine' | 'team' | 'department';
  projects: AiStudioProject[];
  people?: AiStudioPerson[];
  waitingStatus?: AiStudioReportStatus;
  onNew?: () => void;
  /** one employee's reports of a period (the Performance Management drill-down) */
  initial?: Partial<Filters>;
  /** called after a decision or an edit in the dialog */
  onChanged?: () => void;
}> = ({ view, projects, people = [], waitingStatus, onNew, initial, onChanged }) => {
  const [f, setF] = useState<Filters>({ ...NO_FILTERS, status: waitingStatus ?? '', ...initial });
  const [page, setPage] = useState(1);
  const pendingReport = usePendingAiStudio('report');
  const [openId, setOpenId] = useState<string | null>(pendingReport);
  const { data, error, loading, reload } = useLoad<AiStudioReportPage>(
    () => aiStudioApi.reports({ view, projectId: f.projectId || undefined, status: f.status || undefined, leadId: f.leadId || undefined, authorId: f.authorId || undefined, from: f.from || undefined, to: f.to || undefined, page, pageSize: 10 }),
    [view, f, page]
  );
  useAiStudioChanged(reload);
  const set = (patch: Partial<Filters>) => { setF(prev => ({ ...prev, ...patch })); setPage(1); };
  const counts = data?.counts ?? {};
  const tabs: { id: string; label: string; count?: number }[] =
    view === 'department'
      ? [{ id: 'PENDING_DH_APPROVAL', label: 'Awaiting my approval', count: counts.PENDING_DH_APPROVAL ?? 0 }, { id: 'PENDING_TL_APPROVAL', label: 'With Team Leads', count: counts.PENDING_TL_APPROVAL ?? 0 }, { id: 'APPROVED', label: 'Approved', count: counts.APPROVED ?? 0 }, { id: '', label: 'All' }]
      : view === 'team'
      ? [{ id: 'PENDING_TL_APPROVAL', label: 'Awaiting my approval', count: counts.PENDING_TL_APPROVAL ?? 0 }, { id: 'PENDING_DH_APPROVAL', label: 'With Department Head', count: counts.PENDING_DH_APPROVAL ?? 0 }, { id: 'APPROVED', label: 'Approved', count: counts.APPROVED ?? 0 }, { id: '', label: 'All' }]
      : [{ id: '', label: 'All' }, { id: 'DRAFT', label: 'Drafts', count: counts.DRAFT ?? 0 }, { id: 'PENDING_TL_APPROVAL', label: 'Pending Team Lead', count: counts.PENDING_TL_APPROVAL ?? 0 }, { id: 'PENDING_DH_APPROVAL', label: 'Pending Department Head', count: counts.PENDING_DH_APPROVAL ?? 0 }, { id: 'APPROVED', label: 'Approved', count: counts.APPROVED ?? 0 }];
  const leads = people.filter(p => p.role === 'TEAM_HEAD');
  const members = people.filter(p => p.role === 'TEAM_MEMBER' || (view === 'department' && p.role === 'TEAM_HEAD'));
  return (
    <Card>
      <div className="p-4 border-b border-slate-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs label="Report status" value={f.status} options={tabs} onChange={v => set({ status: v })} />
          {onNew && <button type="button" className={primaryBtn} onClick={onNew}><Plus className="w-4 h-4" aria-hidden="true" /> New report</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Project" className={`${fieldCls} !w-auto min-w-[9rem]`} value={f.projectId} onChange={e => set({ projectId: e.target.value })}>
            <option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {view === 'department' && !initial?.authorId && (
            <select aria-label="Team Lead" className={`${fieldCls} !w-auto min-w-[9rem]`} value={f.leadId} onChange={e => set({ leadId: e.target.value })}>
              <option value="">All Team Leads</option>{leads.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          )}
          {view !== 'mine' && !initial?.authorId && (
            <select aria-label="Employee" className={`${fieldCls} !w-auto min-w-[9rem]`} value={f.authorId} onChange={e => set({ authorId: e.target.value })}>
              <option value="">All employees</option>{members.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-slate-500">From <input type="date" className={`${fieldCls} !w-auto`} value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} /></label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">To <input type="date" className={`${fieldCls} !w-auto`} value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} /></label>
          {!initial && (f.projectId || f.leadId || f.authorId || f.from || f.to) && <button type="button" className={ghostBtn} onClick={() => set({ ...NO_FILTERS, status: f.status })}>Clear filters</button>}
        </div>
      </div>
      {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
      {loading && !data && <Spinner label="Loading reports…" />}
      {data && data.items.length === 0 && !error && <p className="py-12 px-6 text-center text-sm text-slate-500">No reports here.</p>}
      {data && data.items.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[46rem]">
            <thead className="border-b border-slate-100">
              <tr>{view !== 'mine' && <th className={thCls}>Employee</th>}<th className={thCls}>Project</th><th className={thCls}>Report date</th><th className={thCls}>Submitted</th><th className={thCls}>Status</th><th className={thCls}><span className="sr-only">Open</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map(r => (
                // the whole row opens the report; the buttons stay for the keyboard
                <tr key={r.id} onClick={() => setOpenId(r.id)} data-testid="ai-report-row" className="hover:bg-slate-50 cursor-pointer">
                  {view !== 'mine' && <td className={tdCls}><button type="button" onClick={e => { e.stopPropagation(); setOpenId(r.id); }} className="font-bold text-slate-900 hover:text-blue-700 text-left">{r.authorName}</button><div className="text-xs text-slate-500">{r.authorRole === 'LEAD' ? 'Team Lead' : r.leadName ? `Team: ${r.leadName}` : 'Team Member'}</div></td>}
                  <td className={tdCls}>{r.projectName}{r.taskTitle && <div className="text-xs text-slate-500">{r.taskTitle}</div>}{r.consolidated ? <div className="text-xs text-slate-500">{r.taskCount ?? 0} task{r.taskCount === 1 ? '' : 's'}{r.totalMinutes ? ` · ${hoursText(r.totalMinutes)}` : ''}</div> : null}</td>
                  <td className={tdCls}>{dateText(r.reportDate)}</td>
                  <td className={tdCls}>{dateTimeText(r.submittedAt)}</td>
                  <td className={tdCls}><ReportStatusBadge status={r.status} /></td>
                  <td className={tdCls}><button type="button" onClick={e => { e.stopPropagation(); setOpenId(r.id); }} className="text-blue-600 hover:underline text-xs font-bold">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {data && data.total > data.pageSize && <div className="p-4 border-t border-slate-100"><Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="reports" onPage={setPage} /></div>}
      {openId && <ReportDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => { reload(); onChanged?.(); }} />}
    </Card>
  );
};

type ReportTab = 'submit' | 'mine' | 'team';

/**
 * Daily Report: the Team Member writes and follows their reports; the Team Lead does the same and also reviews their team's reports. The Department Head's approval page is
 * `DepartmentReports`.
 */
export const DailyReportsPage: React.FC<{ role: 'LEAD' | 'MEMBER' }> = ({ role }) => {
  const [tab, setTab] = useState<ReportTab>(() => (peekPendingAiStudio('report') ? (role === 'LEAD' ? 'team' : 'mine') : role === 'MEMBER' ? 'submit' : 'mine'));
  const [composing, setComposing] = useState(false);
  const [version, setVersion] = useState(0);
  const projects = useLoad<AiStudioProject[]>(() => aiStudioApi.projects(), []);
  const list = projects.data ?? [];
  const tabs: { id: ReportTab; label: string }[] = role === 'MEMBER'
    ? [{ id: 'submit', label: 'Submit Daily Report' }, { id: 'mine', label: 'My Reports' }]
    : [{ id: 'mine', label: 'My Daily Reports' }, { id: 'team', label: 'Team Member Reports' }];
  return (
    <div className="space-y-6">
      <PageTitle
        title="Daily Report"
        subtitle={role === 'LEAD' ? 'Write your own daily report, and review the reports of your Team Members.' : 'Write your daily report and follow it through your Team Lead and the Department Head.'}
      />
      <Tabs<ReportTab> label="Daily report views" value={tab} options={tabs} onChange={t => { setTab(t); setComposing(false); }} />
      {/* 20270219000100: one report for the day with every task worked on; older single-task reports still open (and are corrected) in their own form */}
      {tab === 'submit' && <DailyReportForm key={version} onDone={() => { setVersion(v => v + 1); setTab('mine'); }} />}
      {tab === 'mine' && (composing
        ? <DailyReportForm onDone={() => setComposing(false)} onCancel={() => setComposing(false)} />
        : <ReportList key={version} view="mine" projects={list} onNew={() => (role === 'MEMBER' ? setTab('submit') : setComposing(true))} />)}
      {tab === 'team' && <ReportList view="team" projects={list} waitingStatus="PENDING_TL_APPROVAL" />}
    </div>
  );
};

/** Super Admin (the Department Head of AI Studio) / Department Head: the reports of the department, filtered by project, Team Lead, employee, date and status; they give the final decision. */
export const DepartmentReports: React.FC<{ role: AiStudioRole }> = ({ role }) => {
  const projects = useLoad<AiStudioProject[]>(() => aiStudioApi.projects(), []);
  const people = useLoad<AiStudioPerson[]>(() => aiStudioApi.people(), []);
  // the Super Admin is the Department Head of AI Studio (and a Department Head, if the department has one, too): both give the final decision
  return (
    <div className="space-y-6">
      <PageTitle
        title="Daily Reports"
        subtitle={role === 'LEAD' || role === 'MEMBER' ? 'Daily reports of AI Studio.' : 'Reports your Team Leads approved wait for your final decision. Team Leads\' own reports come straight to you.'}
      />
      <ReportList view="department" projects={projects.data ?? []} people={people.data ?? []} waitingStatus="PENDING_DH_APPROVAL" />
    </div>
  );
};

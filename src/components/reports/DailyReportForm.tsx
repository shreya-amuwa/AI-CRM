import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Save, Send } from 'lucide-react';
import { REPORT_REMARKS_MAX, type ReportKind } from '../../../shared/reportFields';
import type { ReportTaskOption, WorkReportDetail } from '../../../shared/contracts';
import { reportSaveSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { workReportsApi, type WorkReportForm } from '../../lib/api/workReports';
import { btn, Card, ErrorBanner, Field, inputCls, Spinner } from '../team-member/pipeline/shared';
import { notifyReportsChanged } from './reportEvents';
import { dateLabel, isoOf, todayIso } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

const WHO: Record<ReportKind, (names: string) => React.ReactNode> = {
  MEMBER: n => (n ? <>Your Team Lead <b>{n}</b> approves it first, then your Department Head.</> : 'No Team Lead is assigned to you yet; you can save drafts, but submitting needs one.'),
  TEAM_LEAD: n => (n ? <>It goes straight to your Department Head <b>{n}</b>. You cannot approve your own report.</> : 'No Department Head is set for your department yet; you can save drafts, but submitting needs one.'),
  DEPARTMENT_HEAD: n => (n ? <>It is kept in the department's reporting history and goes to the CEO <b>{n}</b>.</> : 'No CEO manages your department yet; you can save drafts, but submitting needs one.')
};

/**
 * THE standard daily report form, the same for every level (Team Member, Team Lead, Department Head): a title, the report date, the tasks
 * assigned to the author, the ones they completed and one short optional remark. The tasks are the author's own records
 * (work_reports_my_tasks), the completed ones are only those the task records really show as completed, and the database checks both lists
 * again on save and on submit. "Save as draft" keeps the report private; "Submit report" sends it to the next reviewer.
 */
export const DailyReportForm: React.FC<{
  kind: ReportKind;
  reportsTo: string[];
  initial?: WorkReportDetail | null;
  onDone: (r: WorkReportDetail, submitted: boolean) => void;
  onCancel?: () => void;
}> = ({ kind, reportsTo, initial, onDone, onCancel }) => {
  const uid = useId();
  const [title, setTitle] = useState(initial?.title ?? `Daily report - ${dateLabel(todayIso())}`);
  const [remarks, setRemarks] = useState(initial?.content?.remarks ?? '');
  const [reportDate, setReportDate] = useState(initial?.reportDate ?? todayIso());
  const [tasks, setTasks] = useState<ReportTaskOption[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set((initial?.content?.assignedTasks ?? []).map(t => t.id)));
  const [completed, setCompleted] = useState<Set<string>>(() => new Set((initial?.content?.completedTasks ?? []).map(t => t.id)));
  // until the member changes a tick, the lists follow the report date (open tasks and the ones completed that day)
  const [touched, setTouched] = useState(!!initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);

  const loadTasks = useCallback(() => {
    setLoadError('');
    workReportsApi.myTasks().then(setTasks, e => { setTasks(prev => prev ?? []); setLoadError(errText(e)); });
  }, []);
  useEffect(loadTasks, [loadTasks]);
  // the task records may have changed while this page was open (a task finished in My Tasks)
  useEffect(() => {
    window.addEventListener('focus', loadTasks);
    return () => window.removeEventListener('focus', loadTasks);
  }, [loadTasks]);

  // the options: the member's task records, plus the tasks a saved report already holds that the list no longer shows
  const options = useMemo(() => {
    const map = new Map<string, ReportTaskOption>();
    for (const t of tasks ?? []) map.set(t.id, t);
    for (const t of initial?.content?.assignedTasks ?? []) {
      if (!map.has(t.id)) map.set(t.id, { id: t.id, title: t.title, status: t.status, priority: t.priority ?? 'MEDIUM', dueDate: t.dueDate ?? null, progress: 0, completedAt: null, assignedAt: '' });
    }
    return [...map.values()];
  }, [tasks, initial]);

  useEffect(() => {
    if (touched || !tasks) return;
    const a = new Set<string>();
    const c = new Set<string>();
    for (const t of tasks) {
      if (t.status !== 'COMPLETED') a.add(t.id);
      else if (dayOf(t.completedAt) === reportDate) { a.add(t.id); c.add(t.id); }
    }
    setAssigned(a);
    setCompleted(c);
  }, [tasks, reportDate, touched]);

  const toggleAssigned = (id: string) => {
    setTouched(true);
    setAssigned(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setCompleted(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
  };
  const toggleCompleted = (id: string) => {
    setTouched(true);
    setCompleted(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const body = useMemo((): WorkReportForm => ({
    title: title.trim(),
    reportDate,
    periodType: 'DAILY',
    periodStart: reportDate,
    periodEnd: reportDate,
    content: { assignedTasks: [...assigned], completedTasks: [...completed], ...(remarks.trim() ? { remarks: remarks.trim() } : {}) } as unknown as WorkReportForm['content']
  }), [title, reportDate, assigned, completed, remarks]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const parsed = reportSaveSchema.safeParse(body);
    if (!parsed.success) for (const i of parsed.error.issues) e[String(i.path[i.path[0] === 'content' ? 1 : 0])] ??= i.message;
    if (reportDate > todayIso()) e.reportDate = 'The report date cannot be in the future.';
    if (reportDate < daysAgo(60)) e.reportDate = 'Choose a date within the last 60 days.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const run = async (submit: boolean) => {
    setProblem('');
    setNote('');
    if (!validate()) return;
    setBusy(submit ? 'submit' : 'draft');
    try {
      let saved = savedId ? await workReportsApi.update(savedId, body) : await workReportsApi.create(body);
      setSavedId(saved.id);
      if (submit) saved = await workReportsApi.submit(saved.id);
      notifyReportsChanged();
      if (submit) onDone(saved, true);
      else { setNote('Draft saved. Only you can see it until you submit.'); onDone(saved, false); }
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy('');
    }
  };

  const sentBack = initial?.status === 'REVISION_REQUIRED';
  const chosen = options.filter(t => assigned.has(t.id));
  return (
    <Card className="p-5">
      <form onSubmit={e => { e.preventDefault(); void run(true); }} noValidate className="space-y-4" aria-label="Submit report">
        <div>
          <h2 className="text-base font-bold text-slate-900">{initial ? (sentBack ? 'Revise your daily report' : 'Edit your draft') : kind === 'MEMBER' ? 'Submit daily report' : 'My daily report'}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{WHO[kind](reportsTo.join(', '))}</p>
        </div>

        {sentBack && initial?.reviewComment ? (
          <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <b>{initial.reviewedBy ?? 'Your reviewer'}{initial.decisionStage === 'DEPARTMENT_HEAD' ? ' (Department Head)' : initial.decisionStage === 'TEAM_LEAD' ? ' (Team Lead)' : ''} asked for a revision:</b> {initial.reviewComment}
          </div>
        ) : null}
        {problem ? <ErrorBanner message={problem} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Report title" required htmlFor={`${uid}-title`} error={errors.title}>
              <input id={`${uid}-title`} className={inputCls} value={title} maxLength={200} onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: '' })); }} aria-invalid={!!errors.title} />
            </Field>
          </div>
          <Field label="Report date" required htmlFor={`${uid}-date`} error={errors.reportDate}>
            <input id={`${uid}-date`} type="date" className={inputCls} value={reportDate} min={daysAgo(60)} max={todayIso()} onChange={e => { if (e.target.value) { setReportDate(e.target.value); setErrors(x => ({ ...x, reportDate: '' })); } }} />
          </Field>
        </div>

        {loadError ? <ErrorBanner message={loadError} onRetry={loadTasks} /> : null}
        {!tasks && !loadError ? <Spinner label="Loading your tasks..." /> : (
          <div className="grid gap-4 md:grid-cols-2">
            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">Assigned tasks <span className="font-normal text-slate-500">({assigned.size})</span></legend>
              {options.length === 0 ? <p className="text-xs text-slate-500 py-2">No tasks are assigned to you.</p> : (
                <ul className="max-h-64 overflow-y-auto space-y-1" data-testid="assigned-tasks">
                  {options.map(t => (
                    <li key={t.id}>
                      <label className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 text-sm text-slate-800 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={assigned.has(t.id)} onChange={() => toggleAssigned(t.id)} />
                        <span className="min-w-0">
                          <span className="block break-words">{t.title}</span>
                          <span className="block text-[11px] text-slate-500">{t.status === 'COMPLETED' ? `Completed${t.completedAt ? ` ${dateLabel(t.completedAt)}` : ''}` : t.status === 'IN_PROGRESS' ? 'In progress' : t.status === 'NOT_COMPLETED' ? 'Not completed' : 'Assigned'}{t.dueDate ? ` - due ${dateLabel(t.dueDate)}` : ''}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">Completed tasks <span className="font-normal text-slate-500">({completed.size})</span></legend>
              {chosen.length === 0 ? <p className="text-xs text-slate-500 py-2">Pick the assigned tasks first.</p> : (
                <ul className="max-h-64 overflow-y-auto space-y-1" data-testid="completed-tasks">
                  {chosen.map(t => {
                    const done = t.status === 'COMPLETED';
                    return (
                      <li key={t.id}>
                        <label className={`flex items-start gap-2 rounded-lg px-1.5 py-1 text-sm ${done ? 'text-slate-800 hover:bg-slate-50 cursor-pointer' : 'text-slate-400'}`}>
                          <input type="checkbox" className="mt-0.5" checked={completed.has(t.id)} disabled={!done} onChange={() => toggleCompleted(t.id)} />
                          <span className="min-w-0">
                            <span className="block break-words">{t.title}</span>
                            {!done ? <span className="block text-[11px]">Not completed in My Tasks yet</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          </div>
        )}

        <Field label="Remarks / Work Summary" htmlFor={`${uid}-remarks`} error={errors.remarks}>
          <span className="block text-[11px] text-slate-500 mb-1">Optional. A short note about your work or anything the tasks do not show.</span>
          <textarea id={`${uid}-remarks`} className={`${inputCls} min-h-16`} rows={2} value={remarks} maxLength={REPORT_REMARKS_MAX} onChange={e => { setRemarks(e.target.value); setErrors(x => ({ ...x, remarks: '' })); }} aria-invalid={!!errors.remarks} />
          <span className="block text-right text-[11px] text-slate-400 tabular-nums" aria-live="polite">{remarks.length}/{REPORT_REMARKS_MAX}</span>
        </Field>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={() => void run(false)} disabled={!!busy}><Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Saving...' : 'Save as draft'}</button>
          <button type="submit" className={btn.primary} disabled={!!busy}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'submit' ? 'Submitting...' : sentBack ? 'Resubmit report' : 'Submit report'}</button>
          {onCancel ? <button type="button" className={btn.secondary} onClick={onCancel} disabled={!!busy}>Cancel</button> : null}
          {note ? <span role="status" className="text-xs text-emerald-700">{note}</span> : null}
        </div>
      </form>
    </Card>
  );
};

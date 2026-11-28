import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { AiStudioDailyReportOptions, AiStudioDailyReportPreview, AiStudioReportContext, AiStudioReportDetail } from '../../../shared/contracts';
import { aiStudioDailyReportSchema } from '../../../shared/validation';
import { ReportWordFields, reportWordsWithinLimits } from '../common/ReportWordFields';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { ApiError, errorMessage } from '../../lib/api/client';
import { confirmAction, toast } from '../../lib/feedback/feedbackStore';
import { ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { Card, fieldCls, ghostBtn, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { TaskDialog } from './AiStudioTasks';
import { notifyAiStudioChanged } from './aiStudioEvents';
import { ReportWorkView, WorkSummary } from './ReportWork';
import { TaskStatusBadge, dateText, todayIso, useLoad } from './ui';

/**
 * The consolidated daily report (20270219000100): one report for the day, built from the work the person ALREADY recorded on their tasks.
 * They pick the tasks (any of their projects); the completion details, work updates and links of that date are fetched from the task history and
 * shown read-only. They only type what is not in the tasks (additional work, pending work, blockers, tomorrow's plan, remarks). Nothing of the tasks
 * is copied into the report: it keeps references, and on submit exactly the entries shown here.
 */
type Extra = Record<'workCompleted' | 'pendingWork' | 'blockers' | 'tomorrowPlan' | 'remarks', string>;
const NO_EXTRA: Extra = { workCompleted: '', pendingWork: '', blockers: '', tomorrowPlan: '', remarks: '' };
const extraOf = (r?: AiStudioReportDetail): Extra => ({
  workCompleted: r?.workCompleted ?? '', pendingWork: r?.pendingWork ?? '', blockers: r?.blockers ?? '', tomorrowPlan: r?.tomorrowPlan ?? '', remarks: r?.remarks ?? ''
});

export const DailyReportForm: React.FC<{ existing?: AiStudioReportDetail; onDone: (r: AiStudioReportDetail) => void; onCancel?: () => void }> = ({ existing, onDone, onCancel }) => {
  const ctx = useLoad<AiStudioReportContext>(() => aiStudioApi.reportContext(), []);
  const [editing, setEditing] = useState<AiStudioReportDetail | undefined>(existing);
  const [date, setDate] = useState(existing?.reportDate ?? todayIso());
  const [selected, setSelected] = useState<string[]>(() => existing?.work?.map(w => w.taskId) ?? []);
  const [text, setText] = useState<Extra>(() => extraOf(existing));
  // (20270305000100) the form asks three fields only: Work Completed (150 words), Work Pending (100), Additional Note (50, stored as remarks). The Daily Work
  // Description, the challenges and tomorrow's plan of an older report are kept as they are (sent back unchanged), never asked for.
  const withinLimits = reportWordsWithinLimits(text);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);

  const options = useLoad<AiStudioDailyReportOptions>(() => aiStudioApi.dailyReportOptions(date), [date]);
  // a task that is not offered for the new date is dropped from the choice
  useEffect(() => {
    if (!options.data) return;
    const ids = new Set(options.data.tasks.map(t => t.id));
    setSelected(prev => (prev.every(id => ids.has(id)) ? prev : prev.filter(id => ids.has(id))));
  }, [options.data]);

  // the preview follows the choice (debounced; an older answer never replaces a newer one)
  const [preview, setPreview] = useState<AiStudioDailyReportPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const seq = useRef(0);
  const key = `${date}|${selected.join(',')}|${previewVersion}`;
  useEffect(() => {
    const mine = ++seq.current;
    if (selected.length === 0) { setPreview(null); setPreviewError(''); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    const t = window.setTimeout(() => {
      aiStudioApi.dailyReportPreview(date, selected)
        .then(p => { if (mine === seq.current) { setPreview(p); setPreviewError(''); } })
        .catch(err => { if (mine === seq.current) setPreviewError(errorMessage(err)); })
        .finally(() => { if (mine === seq.current) setPreviewLoading(false); });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tasks = options.data?.tasks ?? [];
  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const out: { projectId: string; projectName: string; tasks: typeof tasks }[] = [];
    for (const t of tasks) {
      if (q && !t.title.toLowerCase().includes(q) && !t.projectName.toLowerCase().includes(q)) continue;
      const g = out.find(x => x.projectId === t.projectId);
      if (g) g.tasks.push(t); else out.push({ projectId: t.projectId, projectName: t.projectName, tasks: [t] });
    }
    return out;
  }, [tasks, q]);
  const toggle = (id: string) => { setError(''); setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])); };

  const openExisting = async (id: string) => {
    try {
      const r = await aiStudioApi.report(id);
      setEditing(r);
      setSelected(r.work?.map(w => w.taskId) ?? []);
      setText(extraOf(r));
      setError('');
    } catch (err) { setError(errorMessage(err)); }
  };

  const save = async (submit: boolean) => {
    const body = {
      reportDate: date, taskIds: selected, ...text, workDescription: editing?.workDescription ?? undefined, submit,
      expectedUpdateIds: submit ? (preview?.updateIds ?? []) : undefined
    };
    const parsed = aiStudioDailyReportSchema.safeParse(body);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    if (submit) {
      if (selected.length > 0 && (previewLoading || !preview)) { setError('The report is still being prepared. Try again in a moment.'); return; }
      const s = preview?.summary;
      if (!text.workCompleted.trim() && (!s || s.updates === 0)) {
        setError('Select a task with work recorded on this date, or describe the work you completed.');
        return;
      }
      const ok = await confirmAction({
        title: 'Submit Daily Report?',
        description: `It will be shared with ${ctx.data?.reviewer ?? 'your reviewer'} for review.`,
        details: s
          ? [`${s.projects} project${s.projects === 1 ? '' : 's'}`, `${s.tasks} task${s.tasks === 1 ? '' : 's'}`, `${s.updates} recorded work update${s.updates === 1 ? '' : 's'}`, `${s.links} submitted link${s.links === 1 ? '' : 's'}`]
          : ['No specific task: your description of the work'],
        confirmLabel: 'Confirm submission',
        cancelLabel: 'Review report'
      });
      if (!ok) return;
    }
    setSaving(submit ? 'submit' : 'draft');
    setError('');
    try {
      const saved = editing ? await aiStudioApi.updateDailyReport(editing.id, body) : await aiStudioApi.createDailyReport(body);
      notifyAiStudioChanged();
      toast.success(submit ? 'Daily report submitted.' : 'Draft saved.');
      onDone(saved);
    } catch (err) {
      // the tasks changed while the report was open: show the fresh work and let the person confirm again (what they typed is kept)
      if (err instanceof ApiError && /updated while you were preparing/i.test(err.message)) setPreviewVersion(v => v + 1);
      setError(errorMessage(err));
      setSaving(null);
    }
  };

  if (ctx.loading && !ctx.data) return <Spinner label="Loading the report form…" />;
  if (ctx.error) return <ErrorBanner message={ctx.error} onRetry={ctx.reload} />;
  const returnedNote = editing?.status === 'RETURNED_BY_TL' ? editing.tlComment : editing?.status === 'RETURNED_BY_DH' ? editing.dhComment : null;
  const existingId = !editing ? options.data?.existingReportId : null;
  return (
    <form onSubmit={e => { e.preventDefault(); void save(true); }} aria-label="Daily report" className="space-y-4">
      {returnedNote && (
        <div role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>{editing?.status === 'RETURNED_BY_TL' ? 'Your Team Lead' : 'The Department Head'} returned this report:</strong> {returnedNote}
        </div>
      )}

      {/* 1. Report information */}
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="Report date" htmlFor="ai-dr-date" required>
            <input id="ai-dr-date" type="date" className={fieldCls} value={date} min={new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)} max={ctx.data?.today ?? todayIso()}
              disabled={!!editing && editing.status !== 'DRAFT'} onChange={e => { setError(''); setDate(e.target.value); }} />
          </Field>
          <p className="sm:col-span-2 text-xs text-slate-500">
            {ctx.data?.role === 'LEAD' ? 'Team Lead' : 'Team Member'} · {!ctx.data?.hasReviewer ? 'there is nobody to review this report yet; you can save a draft.' : `reviewed by ${ctx.data.reviewer}${ctx.data.route === 'TEAM_LEAD' ? ', then the Department Head' : ''}.`}
          </p>
        </div>
        {existingId && (
          <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 flex flex-wrap items-center gap-2">
            You already have a daily report for {dateText(date)}.
            <button type="button" className="font-bold underline" onClick={() => void openExisting(existingId)}>Open it</button>
          </div>
        )}
      </Card>

      {/* 2. Select tasks */}
      <Card className="p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-900">Tasks you worked on</h3>
          <span className="text-xs text-slate-500">{selected.length} selected</span>
        </div>
        <label className="relative block">
          <span className="sr-only">Search your tasks</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" className={`${fieldCls} pl-9`} placeholder="Search tasks or projects" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        {options.error && <ErrorBanner message={options.error} onRetry={options.reload} />}
        {options.loading && !options.data && <Spinner label="Loading your tasks…" />}
        {options.data && tasks.length === 0 && <p className="text-sm text-slate-500">You have no task open on {dateText(date)}. Describe your work below (no specific task).</p>}
        <div className="max-h-72 overflow-y-auto space-y-3 pr-1" role="group" aria-label="Your tasks by project">
          {groups.map(g => (
            <fieldset key={g.projectId}>
              <legend className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-slate-500 mb-1">{g.projectName}</legend>
              <ul className="space-y-1">
                {g.tasks.map(t => (
                  <li key={t.id}>
                    <label className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900 break-words">{t.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-slate-500">
                          <TaskStatusBadge status={t.status} /> {t.progress}%
                          {t.crossTeam && <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">Cross-team · {t.assignedByName}</span>}
                          {t.updatesOnDate > 0 && <span className="text-emerald-700 font-semibold">{t.updatesOnDate} update{t.updatesOnDate === 1 ? '' : 's'} on this date</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
        {selected.length === 0 && tasks.length > 0 && <p className="text-xs text-slate-500">No task selected: the report is for work without a specific task (meetings, research). Describe it below.</p>}
      </Card>

      {/* 3. Automatically fetched work */}
      {selected.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-slate-900">Your work on {dateText(date)}</h3>
            <span className="text-xs font-semibold text-slate-500">Automatically fetched from task records</span>
          </div>
          {previewError && <ErrorBanner message={previewError} onRetry={() => setPreviewVersion(v => v + 1)} />}
          {previewLoading && !preview && <Spinner label="Fetching your task updates…" />}
          {preview && (
            <div className={previewLoading ? 'opacity-60' : ''} aria-busy={previewLoading}>
              <ReportWorkView work={preview.work} onOpenTask={setOpenTask} />
            </div>
          )}
        </Card>
      )}

      {/* 4. The report: three optional fields with word limits (20270305000100) */}
      <Card className="p-5 space-y-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Your report</h3>
          <p className="text-xs text-slate-500">{selected.length === 0 ? 'Without a task, write the work you completed.' : 'The work recorded on your tasks is shown above; to correct it, open the task.'}</p>
        </div>
        <ReportWordFields idPrefix="ai-dr" values={text} inputClassName={textareaCls} onChange={(k, v) => { setText(t => ({ ...t, [k]: v })); setError(''); }} />
      </Card>

      {/* 5. Summary and 6. actions */}
      <Card className="p-5 space-y-3">
        {preview && selected.length > 0 && <WorkSummary s={preview.summary} />}
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={!!saving || !ctx.data?.hasReviewer || !withinLimits}
            data-testid="daily-submit">{saving === 'submit' ? 'Submitting…' : 'Submit Daily Report'}</button>
          <button type="button" className={ghostBtn} disabled={!!saving} onClick={() => void save(false)}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>
          {onCancel && <button type="button" className={ghostBtn} disabled={!!saving} onClick={onCancel}>Cancel</button>}
        </div>
      </Card>
      {openTask && <TaskDialog id={openTask} onClose={() => setOpenTask(null)} onChanged={() => setPreviewVersion(v => v + 1)} />}
    </form>
  );
};

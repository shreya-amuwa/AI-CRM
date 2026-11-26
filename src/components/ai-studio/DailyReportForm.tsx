import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import type { AiStudioDailyContext, AiStudioReportDetail, AiStudioReportableTask } from '../../../shared/contracts';
import { aiStudioDailyReportSchema } from '../../../shared/validation';
import { entryMinutes } from '../../lib/aiStudioWorkload';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { Card, fieldCls, ghostBtn, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { CrossTeamBadge } from './AssigneePicker';
import { notifyAiStudioChanged } from './aiStudioEvents';
import { TASK_STATUS_LABELS, todayIso } from './ui';

/**
 * The day's daily report (20270218000100): one report per person and day, one entry per task worked on - from any project, cross-team tasks included.
 * Each task has its own section (work done, time, progress, blockers, next action); the summary keeps the totals in view, and the hours are compared with
 * the attendance hours (a warning only). The database checks every task again and writes the report all or nothing; on an error nothing is lost here.
 */
interface EntryDraft { hours: string; minutes: string; progress: string; work: string; blockers: string; next: string }
const emptyEntry = (t: AiStudioReportableTask): EntryDraft => ({ hours: '', minutes: '', progress: t.status === 'COMPLETED' ? '100' : String(t.progress), work: '', blockers: '', next: '' });
const minutesOf = (d: EntryDraft) => entryMinutes(d.hours, d.minutes);
export const hoursText = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

export const DailyReportForm: React.FC<{ date?: string; onDone: (r: AiStudioReportDetail) => void; onCancel?: () => void }> = ({ date: initialDate, onDone, onCancel }) => {
  const [date, setDate] = useState(initialDate ?? todayIso());
  const [ctx, setCtx] = useState<AiStudioDailyContext | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, EntryDraft>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState('');
  const [additional, setAdditional] = useState('');
  const [blockers, setBlockers] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [saving, setSaving] = useState<'' | 'draft' | 'submit'>('');
  const [error, setError] = useState('');
  const [badEntry, setBadEntry] = useState<number | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  // the day's context: the tasks to choose from, and the report already started for that date (its entries are loaded back into the form)
  useEffect(() => {
    const mine = ++loadSeq.current;
    setCtx(null); setLoadError('');
    aiStudioApi.dailyContext(date).then(c => {
      if (mine !== loadSeq.current) return;
      setCtx(c);
      const r = c.report;
      setReportId(r?.id ?? null);
      setSummary(r?.workCompleted ?? ''); setAdditional(r?.remarks ?? ''); setBlockers(r?.blockers ?? ''); setTomorrow(r?.pendingWork ?? '');
      const ids = (r?.entries ?? []).map(e => e.taskId).filter((x): x is string => !!x && c.tasks.some(t => t.id === x));
      setSelected(ids);
      setEntries(Object.fromEntries((r?.entries ?? []).filter(e => e.taskId && ids.includes(e.taskId)).map(e => [e.taskId as string, {
        hours: e.minutesSpent != null ? String(Math.floor(e.minutesSpent / 60)) : '', minutes: e.minutesSpent != null ? String(e.minutesSpent % 60) : '',
        progress: e.reportedProgress != null ? String(e.reportedProgress) : '', work: e.workCompleted ?? '', blockers: e.blockers ?? '', next: e.nextAction ?? ''
      }])));
      setOpen({});
    }, e => { if (mine === loadSeq.current) setLoadError(errorMessage(e)); });
  }, [date]);

  const tasks = useMemo(() => ctx?.tasks ?? [], [ctx]);
  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const editable = !ctx?.report || ['DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH'].includes(ctx.report.status);
  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = tasks.filter(t => words.every(w => `${t.title} ${t.projectName} ${t.ownerTeam ?? ''}`.toLowerCase().includes(w)));
    const g = new Map<string, AiStudioReportableTask[]>();
    for (const t of shown) g.set(t.projectName, [...(g.get(t.projectName) ?? []), t]);
    return [...g.entries()];
  }, [tasks, query]);

  const add = (t: AiStudioReportableTask) => {
    if (selected.includes(t.id)) return;                       // a task is in the report once
    setSelected(s => [...s, t.id]);
    setEntries(e => ({ ...e, [t.id]: e[t.id] ?? emptyEntry(t) }));
    setOpen(o => ({ ...o, [t.id]: true }));
    setQuery('');
  };
  const remove = (id: string) => { setSelected(s => s.filter(x => x !== id)); setBadEntry(null); };
  const setEntry = (id: string, k: keyof EntryDraft, v: string) => setEntries(e => ({ ...e, [id]: { ...e[id], [k]: v } }));

  const totals = useMemo(() => {
    let minutes = 0; let completed = 0;
    for (const id of selected) { minutes += minutesOf(entries[id]) ?? 0; if (byId.get(id)?.status === 'COMPLETED') completed += 1; }
    return { minutes, completed, inProgress: selected.length - completed };
  }, [selected, entries, byId]);
  const overHours = ctx?.workedMinutes != null && totals.minutes > ctx.workedMinutes;

  const save = async (submit: boolean) => {
    setError(''); setBadEntry(null);
    const body = {
      id: reportId, reportDate: date, summary: summary.trim() || null, additionalWork: additional.trim() || null, blockers: blockers.trim() || null, tomorrowPlan: tomorrow.trim() || null,
      entries: selected.map(id => {
        const d = entries[id]; const t = byId.get(id);
        const p = d.progress.trim() === '' ? null : Number(d.progress);
        return { taskId: id, workCompleted: d.work.trim() || null, minutesSpent: minutesOf(d), reportedProgress: t?.status === 'COMPLETED' ? null : p,
                 blockers: d.blockers.trim() || null, nextAction: d.next.trim() || null };
      }),
      submit
    };
    // the same schema the server uses; the database checks each task again (its owner, its dates, its progress)
    const parsed = aiStudioDailyReportSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? 'Please check the report.');
      if (issue && issue.path[0] === 'entries' && typeof issue.path[1] === 'number') { setBadEntry(issue.path[1]); setOpen(o => ({ ...o, [selected[issue.path[1] as number]]: true })); }
      return;
    }
    if (submit) {
      const missing = selected.findIndex(id => byId.get(id)?.status !== 'COMPLETED' && entries[id].progress.trim() === '');
      if (missing >= 0) { setError(`Task ${missing + 1}: enter its progress.`); setBadEntry(missing); setOpen(o => ({ ...o, [selected[missing]]: true })); return; }
    }
    setSaving(submit ? 'submit' : 'draft');
    try {
      const r = await aiStudioApi.saveDailyReport({ ...parsed.data, id: reportId });
      setReportId(r.id);
      notifyAiStudioChanged();
      onDone(r);
    } catch (e) {
      // keep everything typed; point at the task the server named ("Task 2: ...")
      const msg = errorMessage(e);
      setError(msg);
      const m = /Task (\d+)/.exec(msg);
      if (m) { const i = Number(m[1]) - 1; if (selected[i]) { setBadEntry(i); setOpen(o => ({ ...o, [selected[i]]: true })); } }
    } finally { setSaving(''); }
  };

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!ctx) return <Spinner label="Loading your tasks…" />;
  return (
    <form onSubmit={e => { e.preventDefault(); void save(true); }} noValidate className="space-y-4" aria-label="Daily report" data-testid="daily-report-form">
      <Card className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          <Field label="Report date" htmlFor="ai-dr-date" required>
            <input id="ai-dr-date" type="date" className={fieldCls} value={date} max={ctx.today} onChange={e => e.target.value && setDate(e.target.value)} disabled={!!saving} />
          </Field>
          <div><div className="text-xs font-medium text-slate-600 mb-1">Employee</div><div className="py-2 text-slate-900">{ctx.me.name}</div></div>
          <div><div className="text-xs font-medium text-slate-600 mb-1">Department</div><div className="py-2 text-slate-900">{ctx.me.department ?? 'AI Studio'}</div></div>
          <div><div className="text-xs font-medium text-slate-600 mb-1">Team</div><div className="py-2 text-slate-900">{ctx.me.team}</div></div>
        </div>
        <p className="text-xs text-slate-500">Goes to {ctx.reviewer}{ctx.route === 'TEAM_LEAD' ? ', then the Department Head' : ''}.{ctx.legacyReports ? ` You also have ${ctx.legacyReports} single-task report${ctx.legacyReports === 1 ? '' : 's'} for this date (written earlier).` : ''}</p>
        {ctx.report && !editable ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Your report for this date is already submitted. Open it from My Reports.</p> : null}
      </Card>

      {editable ? <>
        <Card className="p-4 space-y-2">
          <div className="text-sm font-bold text-slate-900">Tasks worked on</div>
          {selected.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Selected tasks" data-testid="selected-tasks">
              {selected.map((id, i) => (
                <li key={id} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${badEntry === i ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <span className="max-w-[14rem] truncate">{byId.get(id)?.title ?? 'Task'}</span>
                  <button type="button" onClick={() => remove(id)} aria-label={`Remove ${byId.get(id)?.title ?? 'task'}`} className="rounded p-0.5 hover:bg-slate-100" disabled={!!saving}><X className="h-3 w-3" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">Choose every task you worked on today, from any project.</p>}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" className={`${fieldCls} pl-8`} placeholder={tasks.length ? 'Search your tasks by title or project' : 'No task to report on for this date'} value={query}
              onChange={e => { setQuery(e.target.value); setListOpen(true); }} onFocus={() => setListOpen(true)} disabled={!tasks.length || !!saving}
              aria-label="Search your tasks" aria-expanded={listOpen} aria-controls="ai-dr-task-list" role="combobox" />
          </div>
          {listOpen && tasks.length ? (
            <div id="ai-dr-task-list" role="listbox" aria-label="Your tasks" className="max-h-60 overflow-y-auto rounded-lg border border-slate-200" data-testid="task-options">
              {groups.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">No task matches.</p> : groups.map(([project, list]) => (
                <div key={project}>
                  <div className="sticky top-0 border-b border-slate-100 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{project}</div>
                  {list.map(t => {
                    const taken = selected.includes(t.id);
                    return (
                      <button key={t.id} type="button" role="option" aria-selected={taken} disabled={taken} onClick={() => add(t)} data-testid="task-option"
                        className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 ${taken ? 'cursor-default text-slate-400' : 'hover:bg-slate-50 text-slate-800'}`}>
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.assignmentType === 'CROSS_TEAM' ? <CrossTeamBadge /> : null}
                        <span className="shrink-0 text-xs text-slate-500">{TASK_STATUS_LABELS[t.status]} · {t.progress}%{taken ? ' · added' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
          {listOpen && tasks.length ? <div className="flex justify-end"><button type="button" className="text-xs font-semibold text-slate-500 hover:text-slate-800" onClick={() => setListOpen(false)}>Close the list</button></div> : null}
        </Card>

        {selected.map((id, i) => {
          const t = byId.get(id); const d = entries[id];
          if (!t || !d) return null;
          const isOpen = open[id] ?? false;
          const done = t.status === 'COMPLETED';
          const min = minutesOf(d);
          return (
            <section key={id} className={`rounded-xl border bg-white ${badEntry === i ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200'}`} data-testid="report-entry" aria-label={`Task ${i + 1}: ${t.title}`}>
              <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [id]: !isOpen }))}>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">Task {i + 1} · {t.title}{t.assignmentType === 'CROSS_TEAM' ? <CrossTeamBadge /> : null}</span>
                  <span className="block truncate text-xs text-slate-500">{t.projectName} · {t.progress}% → {done ? '100' : d.progress || '?'}% · {min != null ? hoursText(min) : 'time not entered'}</span>
                </span>
              </button>
              {/* collapsed sections keep what was typed (the state lives above) */}
              <div hidden={!isOpen} className="space-y-3 border-t border-slate-100 px-4 py-3">
                <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><dt className="text-slate-500">Assignment</dt><dd className="text-slate-800">{t.assignmentType === 'CROSS_TEAM' ? `Cross-team${t.ownerTeam ? ` · ${t.ownerTeam}` : ''}` : 'My team'}</dd></div>
                  <div><dt className="text-slate-500">Assigned by</dt><dd className="text-slate-800">{t.assignedByName ?? '-'}</dd></div>
                  <div><dt className="text-slate-500">Status</dt><dd className="text-slate-800">{TASK_STATUS_LABELS[t.status]}</dd></div>
                  <div><dt className="text-slate-500">Previous progress</dt><dd className="text-slate-800">{t.progress}%</dd></div>
                </dl>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={done ? 'Progress (completed)' : 'Progress now (0 to 99%)'} htmlFor={`ai-dr-p-${id}`} required={!done}>
                    <input id={`ai-dr-p-${id}`} type="number" inputMode="numeric" min={0} max={99} className={fieldCls} value={done ? '100' : d.progress} disabled={done || !!saving}
                      onChange={e => setEntry(id, 'progress', e.target.value)} />
                  </Field>
                  <Field label="Time spent: hours" htmlFor={`ai-dr-h-${id}`} required>
                    <input id={`ai-dr-h-${id}`} type="number" inputMode="numeric" min={0} max={24} className={fieldCls} value={d.hours} onChange={e => setEntry(id, 'hours', e.target.value)} disabled={!!saving} />
                  </Field>
                  <Field label="Minutes" htmlFor={`ai-dr-m-${id}`}>
                    <input id={`ai-dr-m-${id}`} type="number" inputMode="numeric" min={0} max={59} step={5} className={fieldCls} value={d.minutes} onChange={e => setEntry(id, 'minutes', e.target.value)} disabled={!!saving} />
                  </Field>
                </div>
                {!done && d.progress.trim() !== '' && Number(d.progress) < t.progress ? <p className="text-xs text-slate-500">Lower than the task's current {t.progress}%: the task keeps its newer progress.</p> : null}
                <Field label="Work completed today" htmlFor={`ai-dr-w-${id}`} required>
                  <textarea id={`ai-dr-w-${id}`} className={textareaCls} rows={3} maxLength={4000} value={d.work} onChange={e => setEntry(id, 'work', e.target.value)} disabled={!!saving} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Blockers" htmlFor={`ai-dr-b-${id}`}>
                    <textarea id={`ai-dr-b-${id}`} className={textareaCls} rows={2} maxLength={4000} value={d.blockers} onChange={e => setEntry(id, 'blockers', e.target.value)} disabled={!!saving} />
                  </Field>
                  <Field label="Next action" htmlFor={`ai-dr-n-${id}`}>
                    <textarea id={`ai-dr-n-${id}`} className={textareaCls} rows={2} maxLength={4000} value={d.next} onChange={e => setEntry(id, 'next', e.target.value)} disabled={!!saving} />
                  </Field>
                </div>
              </div>
            </section>
          );
        })}

        <Card className="p-4 space-y-3">
          <Field label="Overall daily summary" htmlFor="ai-dr-summary" required>
            <textarea id="ai-dr-summary" className={textareaCls} rows={3} maxLength={4000} value={summary} onChange={e => setSummary(e.target.value)} disabled={!!saving} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Additional work performed" htmlFor="ai-dr-extra"><textarea id="ai-dr-extra" className={textareaCls} rows={2} maxLength={4000} value={additional} onChange={e => setAdditional(e.target.value)} disabled={!!saving} /></Field>
            <Field label="Blockers and challenges" htmlFor="ai-dr-blockers"><textarea id="ai-dr-blockers" className={textareaCls} rows={2} maxLength={4000} value={blockers} onChange={e => setBlockers(e.target.value)} disabled={!!saving} /></Field>
            <Field label="Tomorrow's planned work" htmlFor="ai-dr-tomorrow"><textarea id="ai-dr-tomorrow" className={textareaCls} rows={2} maxLength={4000} value={tomorrow} onChange={e => setTomorrow(e.target.value)} disabled={!!saving} /></Field>
          </div>
        </Card>

        {/* the summary and the actions stay in reach while scrolling */}
        <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur space-y-2" data-testid="report-summary">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-700">
            <span><b className="text-slate-900">{selected.length}</b> task{selected.length === 1 ? '' : 's'}</span>
            <span><b className="text-slate-900">{totals.completed}</b> completed</span>
            <span><b className="text-slate-900">{totals.inProgress}</b> in progress</span>
            <span>Reported time <b className="text-slate-900" data-testid="report-total-hours">{hoursText(totals.minutes)}</b>{ctx.workedMinutes != null ? <span className="text-slate-500"> of {hoursText(ctx.workedMinutes)} worked</span> : null}</span>
          </div>
          {overHours ? (
            <p role="status" className="flex items-start gap-1.5 text-xs text-amber-900" data-testid="hours-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Your total reported task hours exceed your recorded working hours for this date. Please review your entries before submitting.
            </p>
          ) : null}
          {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {onCancel ? <button type="button" className={ghostBtn} onClick={onCancel} disabled={!!saving}>Cancel</button> : null}
            <button type="button" className={ghostBtn} onClick={() => void save(false)} disabled={!!saving}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>
            <button type="submit" className={primaryBtn} disabled={!!saving}>{saving === 'submit' ? 'Submitting…' : 'Submit daily report'}</button>
          </div>
        </div>
      </> : null}
    </form>
  );
};

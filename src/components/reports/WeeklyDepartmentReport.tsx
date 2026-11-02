import React, { useCallback, useEffect, useId, useState } from 'react';
import { Eye, Save, Send } from 'lucide-react';
import type { WeeklyDepartmentReport as WeeklyData } from '../../../shared/contracts';
import { reportWeeklySaveSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { weeklyReportsApi } from '../../lib/api/workReports';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Spinner } from '../team-member/pipeline/shared';
import { StatsGrid, TeamStatsTable } from './DailySummary';
import { notifyReportsChanged } from './reportEvents';
import { dateLabel, pctLabel, WeekPicker, weekOf, todayIso, WeeklyStatusPill } from './reportUi';
import { WeeklyPackageView } from './WeeklyPackageView';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
const dayName = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return DAY.format(new Date(y, m - 1, d)); };

/** The week's day-by-day figures: expected, submitted, approved, pending and the compliance of each day. */
const DaysTable: React.FC<{ days: WeeklyData['days'] }> = ({ days }) => (
  <div className="overflow-x-auto rounded-xl border border-slate-200">
    <table className="min-w-full text-xs">
      <caption className="sr-only">Daily reporting of the week</caption>
      <thead className="bg-slate-50 text-slate-500">
        <tr>{['Day', 'Expected', 'Submitted', 'Fully approved', 'Pending', 'Revision / rejected', 'Tasks done', 'Compliance'].map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {days.map(d => (
          <tr key={d.date} className={d.workingDay ? '' : 'text-slate-400'}>
            <th scope="row" className="px-3 py-2 text-left font-semibold">{dayName(d.date)}{d.workingDay ? '' : ' (day off)'}</th>
            {d.stats ? (
              <>
                <td className="px-3 py-2 tabular-nums">{d.stats.expected}</td>
                <td className="px-3 py-2 tabular-nums">{d.stats.submitted}</td>
                <td className="px-3 py-2 tabular-nums">{d.stats.approved}</td>
                <td className="px-3 py-2 tabular-nums">{d.stats.pendingTl + d.stats.pendingDh + d.stats.pendingOh}</td>
                <td className="px-3 py-2 tabular-nums">{d.stats.revision + d.stats.rejected}</td>
                <td className="px-3 py-2 tabular-nums">{d.stats.completedTasks}/{d.stats.assignedTasks}</td>
                <td className="px-3 py-2 tabular-nums">{pctLabel(d.stats.compliance)}</td>
              </>
            ) : <td colSpan={7} className="px-3 py-2">Not yet</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** What the Operations Head will receive, compiled from the daily records (nothing is copied). */
const CompiledWeek: React.FC<{ data: WeeklyData }> = ({ data }) => (
  <div className="space-y-4">
    <StatsGrid stats={data.stats} />
    <section aria-label="Day by day"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Day by day</h3><DaysTable days={data.days} /></section>
    <section aria-label="Team-wise work progress"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team-wise work progress</h3><TeamStatsTable stats={data.stats} /></section>
  </div>
);

/**
 * The Department Head's weekly department report. The week's figures are compiled from the daily records (Team Leads' and Team Members'
 * reports, their approvals, the task totals and the reporting compliance); the head only writes the title, two short overviews and the
 * department remarks. Preview shows what the Operations Head will receive. Submitting sends it for approval; the daily reports stay as
 * they are.
 */
export const WeeklyDepartmentReport: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const uid = useId();
  const [week, setWeek] = useState(() => weekOf(todayIso()).start);
  const [data, setData] = useState<WeeklyData | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [assigned, setAssigned] = useState('');
  const [completed, setCompleted] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    weeklyReportsApi.weekly(week).then(d => {
      setError('');
      setData(d);
      const p = d.package;
      setTitle(t => (p.title ?? t) || `Weekly department report - ${dateLabel(d.weekStart)} to ${dateLabel(d.weekEnd)}`);
      setAssigned(a => (p.assignedOverview ?? a) || `${d.stats.assignedTasks} tasks were assigned across the department's reports this week.`);
      setCompleted(c => (p.completedOverview ?? c) || `${d.stats.completedTasks} of those tasks were reported completed${d.stats.completionRate === null ? '' : ` (${d.stats.completionRate}%)`}.`);
      setRemarks(r => (p.note ?? r) || '');
    }, e => setError(errText(e)));
  }, [week]);
  useEffect(() => { setData(null); setTitle(''); setAssigned(''); setCompleted(''); setRemarks(''); setNote(''); setErrors({}); }, [week]);
  useEffect(load, [load, reloadKey]);

  const body = (submit: boolean) => ({ weekStart: week, title: title.trim(), assignedOverview: assigned.trim() || undefined, completedOverview: completed.trim() || undefined, remarks: remarks.trim() || undefined, submit });

  const run = async (submit: boolean) => {
    setNote('');
    setError('');
    const parsed = reportWeeklySaveSchema.safeParse(body(submit));
    if (!parsed.success) { const e: Record<string, string> = {}; for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message; setErrors(e); return; }
    setErrors({});
    setBusy(submit ? 'submit' : 'draft');
    try {
      await weeklyReportsApi.saveWeekly(body(submit));
      notifyReportsChanged();
      setNote(submit ? 'The weekly report was submitted to the Operations Head.' : 'Draft saved.');
      setPreview(false);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const locked = !!data && !data.canEdit;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Weekly Department Report</h2>
            <p className="text-xs text-slate-500">{data?.department ?? 'Your department'} - compiled from the daily reports; goes to the Operations Head for approval.</p>
          </div>
          <div className="flex items-end gap-3">
            {data ? <WeeklyStatusPill status={data.package.status} /> : null}
            <WeekPicker value={week} onChange={setWeek} />
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <div className="space-y-5">
            {data.package.status === 'REVISION_REQUIRED' ? (
              <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>{data.package.ohReviewer ?? 'The Operations Head'} asked for a revision:</b> {data.package.ohComment}</div>
            ) : null}
            <CompiledWeek data={data} />
            <form onSubmit={e => { e.preventDefault(); void run(true); }} noValidate className="space-y-4" aria-label="Weekly report">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Weekly report title" required htmlFor={`${uid}-title`} error={errors.title}>
                    <input id={`${uid}-title`} className={inputCls} value={title} maxLength={200} disabled={locked || !!busy} onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: '' })); }} aria-invalid={!!errors.title} />
                  </Field>
                </div>
                <Field label="Reporting week" htmlFor={`${uid}-week`}>
                  <input id={`${uid}-week`} className={inputCls} value={`${dateLabel(data.weekStart)} to ${dateLabel(data.weekEnd)}`} readOnly />
                </Field>
                <div />
                <Field label="Weekly assigned task overview" htmlFor={`${uid}-as`} error={errors.assignedOverview}>
                  <textarea id={`${uid}-as`} className={`${inputCls} min-h-20`} value={assigned} maxLength={2000} disabled={locked || !!busy} onChange={e => setAssigned(e.target.value)} />
                </Field>
                <Field label="Weekly completed task overview" htmlFor={`${uid}-co`} error={errors.completedOverview}>
                  <textarea id={`${uid}-co`} className={`${inputCls} min-h-20`} value={completed} maxLength={2000} disabled={locked || !!busy} onChange={e => setCompleted(e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Remarks / Department summary" htmlFor={`${uid}-re`} error={errors.remarks}>
                    <textarea id={`${uid}-re`} className={`${inputCls} min-h-20`} value={remarks} maxLength={2000} disabled={locked || !!busy} onChange={e => setRemarks(e.target.value)} />
                  </Field>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn.secondary} onClick={() => setPreview(true)}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Preview weekly report</button>
                {locked ? null : (
                  <>
                    <button type="button" className={btn.secondary} onClick={() => void run(false)} disabled={!!busy}><Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Saving...' : 'Save as draft'}</button>
                    <button type="submit" className={btn.primary} disabled={!!busy}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'submit' ? 'Submitting...' : data.package.status === 'REVISION_REQUIRED' ? 'Resubmit to Operations Head' : 'Submit to Operations Head'}</button>
                  </>
                )}
                {locked ? <span className="text-xs text-slate-500">Submitted: it can only be changed if the Operations Head sends it back.</span> : null}
                {note ? <span role="status" className="text-xs text-emerald-700">{note}</span> : null}
              </div>
            </form>
          </div>
        ) : null}
      </Card>

      {data && data.package.status !== 'NOT_SUBMITTED' ? (
        <Card className="p-5"><h3 className="text-sm font-bold text-slate-900 mb-3">Weekly reporting status</h3><WeeklyPackageView pkg={data.package} /></Card>
      ) : null}

      {preview && data ? (
        <Dialog title="Preview weekly report" description={`${data.department ?? ''} - ${dateLabel(data.weekStart)} to ${dateLabel(data.weekEnd)}`} onClose={() => setPreview(false)} wide>
          <div className="space-y-4" data-testid="weekly-preview">
            <h3 className="text-base font-bold text-slate-900">{title || 'Untitled weekly report'}</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50/80 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Weekly assigned task overview</dt><dd className="mt-1 text-sm whitespace-pre-wrap">{assigned || '-'}</dd></div>
              <div className="rounded-xl bg-slate-50/80 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Weekly completed task overview</dt><dd className="mt-1 text-sm whitespace-pre-wrap">{completed || '-'}</dd></div>
              <div className="rounded-xl bg-slate-50/80 px-3 py-2 sm:col-span-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Remarks / Department summary</dt><dd className="mt-1 text-sm whitespace-pre-wrap">{remarks || '-'}</dd></div>
            </dl>
            <CompiledWeek data={data} />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setPreview(false)}>Close</button>
              {locked ? null : <button type="button" className={btn.primary} onClick={() => void run(true)} disabled={!!busy}><Send className="w-3.5 h-3.5" aria-hidden="true" /> Submit to Operations Head</button>}
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
};

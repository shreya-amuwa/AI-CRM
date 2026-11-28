import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Save, Send } from 'lucide-react';
import type { AiStudioWeeklyReport, AiStudioWeeklyStats, AiStudioWeeklyStatus } from '../../../shared/contracts';
import { aiStudioWeeklySaveSchema } from '../../../shared/validation';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { toast } from '../../lib/feedback/feedbackStore';
import { Dialog, ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { Card, ghostBtn, fieldCls, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { TableWrap, dateText, dateTimeText, tdCls, thCls, todayIso, useLoad } from './ui';

/**
 * AI Studio weekly report (20270308000100): a Team Lead writes one report per week about their team for the Super Admin, who receives it as AI Studio's
 * Department Head (Acknowledge, or Return for a revision). The figures (team-wise and project-wise) come from the database: the week's approved daily
 * reports and tasks, fixed when the report is submitted. HR and the Operations Head never receive it; the database refuses them.
 */
export const WEEKLY_STATUS_LABEL: Record<AiStudioWeeklyStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted · with the Super Admin', RETURNED: 'Returned for revision', ACKNOWLEDGED: 'Acknowledged' };
const WEEKLY_STATUS_STYLE: Record<AiStudioWeeklyStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700', SUBMITTED: 'bg-blue-50 text-blue-800', RETURNED: 'bg-amber-50 text-amber-800', ACKNOWLEDGED: 'bg-emerald-50 text-emerald-800'
};
const WeeklyStatusBadge: React.FC<{ status: AiStudioWeeklyStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${WEEKLY_STATUS_STYLE[status]}`} data-testid="weekly-status">{WEEKLY_STATUS_LABEL[status]}</span>
);

/** The Mondays of this week and the eight before it (India time), newest first. */
function recentMondays(): string[] {
  const t = new Date(`${todayIso()}T00:00:00Z`);
  const back = (t.getUTCDay() + 6) % 7;
  const monday = new Date(t.getTime() - back * 86400000);
  return Array.from({ length: 9 }, (_, i) => new Date(monday.getTime() - i * 7 * 86400000).toISOString().slice(0, 10));
}
const weekLabel = (start: string) => `${dateText(start)} to ${dateText(new Date(new Date(`${start}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10))}`;

/** Team-wise and project-wise figures of a week. */
export const WeeklyFigures: React.FC<{ stats: AiStudioWeeklyStats }> = ({ stats }) => (
  <div className="space-y-4" data-testid="weekly-figures">
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
      {([['Team members', stats.totals.members], ['Daily reports submitted', stats.totals.reportsSubmitted], ['Approved daily reports', stats.totals.reportsApproved],
         ['Tasks completed', stats.totals.tasksCompleted], ['Tasks pending', stats.totals.tasksPending]] as const).map(([l, v]) => (
        <div key={l} className="rounded-xl bg-slate-50/80 px-3 py-2"><div className="text-[11px] font-bold uppercase text-slate-500">{l}</div><div className="text-lg font-extrabold text-slate-900">{v}</div></div>
      ))}
    </div>
    <div>
      <h4 className="text-xs font-bold uppercase text-slate-500 mb-1">Team-wise · {stats.team}</h4>
      <TableWrap>
        <table className="w-full min-w-[36rem]" data-testid="weekly-team">
          <thead className="border-b border-slate-100"><tr>{['Person', 'Reports submitted', 'Approved', 'Tasks completed', 'Pending', 'Overdue'].map(h => <th key={h} scope="col" className={thCls}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {stats.members.map(m => (
              <tr key={m.id}><td className={tdCls}><b>{m.name}</b>{m.isLead ? <span className="ml-1 text-xs text-slate-500">(Team Lead)</span> : null}</td>
                <td className={tdCls}>{m.reportsSubmitted}</td><td className={tdCls}>{m.reportsApproved}</td><td className={tdCls}>{m.tasksCompleted}</td><td className={tdCls}>{m.tasksPending}</td><td className={tdCls}>{m.tasksOverdue}</td></tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
    <div>
      <h4 className="text-xs font-bold uppercase text-slate-500 mb-1">Project-wise</h4>
      {stats.projects.length === 0 ? <p className="text-sm text-slate-500">No project work recorded for this week.</p> : (
        <TableWrap>
          <table className="w-full min-w-[30rem]" data-testid="weekly-projects">
            <thead className="border-b border-slate-100"><tr>{['Project', 'Tasks completed', 'Pending', 'People'].map(h => <th key={h} scope="col" className={thCls}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {stats.projects.map(p => <tr key={p.id}><td className={tdCls}><b>{p.name}</b></td><td className={tdCls}>{p.tasksCompleted}</td><td className={tdCls}>{p.tasksPending}</td><td className={tdCls}>{p.people}</td></tr>)}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  </div>
);

const Parts: React.FC<{ r: AiStudioWeeklyReport }> = ({ r }) => (
  <dl className="grid gap-2 sm:grid-cols-2" data-testid="weekly-parts">
    {([['Completed work', r.completedWork], ['Pending work', r.pendingWork], ['Achievements', r.achievements], ['Challenges', r.challenges], ['Remarks', r.remarks]] as const).map(([l, v]) => (
      <div key={l} className="rounded-xl bg-slate-50/80 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">{l}</dt><dd className="mt-1 text-sm whitespace-pre-wrap">{v || '-'}</dd></div>
    ))}
  </dl>
);

const History: React.FC<{ r: AiStudioWeeklyReport }> = ({ r }) => (r.events.length ? (
  <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-600">History ({r.events.length})</summary>
    <ol className="mt-1 space-y-1">{r.events.map((e, i) => <li key={i}>{dateTimeText(e.at)} · {e.action.toLowerCase()} by {e.actor ?? '-'}{e.comment ? `: ${e.comment}` : ''} (revision {e.revision})</li>)}</ol>
  </details>) : null);

// ---------------------------------------------------------------------------------------------------- the Team Lead
export const LeadWeeklyReport: React.FC = () => {
  const weeks = useMemo(recentMondays, []);
  const [week, setWeek] = useState(weeks[0]);
  const { data, error, loading, reload } = useLoad(() => aiStudioApi.weeklyWeek(week), [week]);
  const [form, setForm] = useState({ completedWork: '', pendingWork: '', achievements: '', challenges: '', remarks: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  useEffect(() => {
    const r = data?.report;
    setForm({ completedWork: r?.completedWork ?? '', pendingWork: r?.pendingWork ?? '', achievements: r?.achievements ?? '', challenges: r?.challenges ?? '', remarks: r?.remarks ?? '' });
    setErrors({});
  }, [data]);
  const status = data?.report?.status ?? 'DRAFT';
  const locked = status === 'SUBMITTED' || status === 'ACKNOWLEDGED';
  const run = async (submit: boolean) => {
    if (busy) return;
    const body = { weekStart: week, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined])), submit };
    const parsed = aiStudioWeeklySaveSchema.safeParse(body);
    if (!parsed.success) { const e: Record<string, string> = {}; for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message; setErrors(e); return; }
    setErrors({});
    setBusy(submit ? 'submit' : 'draft');
    try {
      await aiStudioApi.weeklySave(body as Parameters<typeof aiStudioApi.weeklySave>[0]);
      toast.success(submit ? 'Weekly report submitted to the Super Admin.' : 'Weekly report saved as a draft.');
      reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const field = (k: keyof typeof form, label: string, required = false) => (
    <Field label={label} required={required} htmlFor={`weekly-${k}`} error={errors[k]}>
      <textarea id={`weekly-${k}`} className={`${textareaCls} min-h-24`} maxLength={4000} value={form[k]} disabled={locked || !!busy} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
    </Field>
  );
  return (
    <section className="space-y-4" aria-label="Weekly Report" data-testid="ai-weekly-lead">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Weekly Report</h1>
          <p className="text-xs text-slate-500 mt-0.5">Your team&apos;s week, for the Super Admin (AI Studio&apos;s Department Head). The figures come from the week&apos;s approved daily reports and tasks.</p>
        </div>
        <label className="text-xs font-semibold text-slate-600">Week
          <select className={`${fieldCls} !w-auto ml-2`} value={week} onChange={e => setWeek(e.target.value)} data-testid="weekly-week">
            {weeks.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
          </select>
        </label>
      </div>
      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner label="Loading the week…" /> : null}
      {data ? (
        <>
          <Card className="p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2"><WeeklyStatusBadge status={status} />{data.report?.submittedAt ? <span className="text-xs text-slate-500">Submitted {dateTimeText(data.report.submittedAt)}</span> : null}</div>
            {data.report?.reviewComment ? <p className={`rounded-xl px-3 py-2 text-sm ${status === 'RETURNED' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`} data-testid="weekly-review-comment"><b>{data.report.reviewedBy}:</b> {data.report.reviewComment}</p> : null}
            <WeeklyFigures stats={data.report?.stats ?? data.liveStats} />
          </Card>
          <Card className="p-5">
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(true); }} noValidate aria-label="Weekly report">
              <div className="grid gap-3 sm:grid-cols-2">
                {field('completedWork', 'Completed work', true)}
                {field('pendingWork', 'Pending work')}
                {field('achievements', 'Achievements')}
                {field('challenges', 'Challenges')}
              </div>
              {field('remarks', 'Remarks')}
              {locked ? <p className="text-xs text-slate-500">{status === 'ACKNOWLEDGED' ? 'The Super Admin acknowledged this week.' : 'Submitted: it can be changed only if the Super Admin returns it.'}</p> : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => void run(false)}><Save className="w-4 h-4" aria-hidden="true" /> {busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
                  <button type="submit" className={primaryBtn} disabled={!!busy} data-testid="weekly-submit"><Send className="w-4 h-4" aria-hidden="true" /> {busy === 'submit' ? 'Submitting…' : status === 'RETURNED' ? 'Resubmit to the Super Admin' : 'Submit to the Super Admin'}</button>
                </div>
              )}
              {data.report ? <History r={data.report} /> : null}
            </form>
          </Card>
        </>
      ) : null}
    </section>
  );
};

// ---------------------------------------------------------------------------------------------------- the Super Admin (AI Studio's Department Head)
const ReviewDialog: React.FC<{ id: string; onClose: () => void; onDone: () => void }> = ({ id, onClose, onDone }) => {
  const { data: r, error, reload } = useLoad(() => aiStudioApi.weeklyOpen(id), [id]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const decide = async (decision: 'ACKNOWLEDGE' | 'RETURN') => {
    if (busy) return;
    if (decision === 'RETURN' && comment.trim().length < 3) { setProblem('Write what the Team Lead should change.'); return; }
    setBusy(true); setProblem('');
    try {
      await aiStudioApi.weeklyReview(id, decision, comment.trim() || undefined);
      toast.success(decision === 'ACKNOWLEDGE' ? 'Weekly report acknowledged.' : 'Weekly report returned to the Team Lead.');
      onDone();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={r ? `${r.team} · ${weekLabel(r.weekStart)}` : 'Weekly report'} description={r ? `By ${r.leadName ?? '-'}` : undefined} onClose={onClose} wide>
      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {!r && !error ? <Spinner /> : null}
      {r ? (
        <div className="space-y-4" data-testid="weekly-dialog">
          <div className="flex flex-wrap items-center gap-2"><WeeklyStatusBadge status={r.status} /><span className="text-xs text-slate-500">Submitted {dateTimeText(r.submittedAt)} · revision {r.revision}</span></div>
          <Parts r={r} />
          <WeeklyFigures stats={r.stats} />
          {r.reviewComment ? <p className="text-sm"><b>{r.reviewedBy}:</b> {r.reviewComment}</p> : null}
          <History r={r} />
          {r.status === 'SUBMITTED' ? (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Field label="Comment (required to return it)" htmlFor="weekly-review-comment"><textarea id="weekly-review-comment" className={`${textareaCls} min-h-20`} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></Field>
              {problem ? <ErrorBanner message={problem} /> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => void decide('RETURN')} data-testid="weekly-return"><RotateCcw className="w-4 h-4" aria-hidden="true" /> Return for revision</button>
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => void decide('ACKNOWLEDGE')} data-testid="weekly-acknowledge"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Acknowledge</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
};

export const AdminWeeklyReports: React.FC = () => {
  const weeks = useMemo(recentMondays, []);
  const [week, setWeek] = useState('');
  const [status, setStatus] = useState<'' | AiStudioWeeklyStatus>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(() => aiStudioApi.weeklyList({ weekStart: week || undefined, status: status || undefined }), [week, status]);
  return (
    <section className="space-y-4" aria-label="Weekly Reports" data-testid="ai-weekly-admin">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Weekly Reports</h1>
        <p className="text-xs text-slate-500 mt-0.5">The AI Studio Team Leads&apos; weekly team reports, sent to you as AI Studio&apos;s Department Head. They do not go to HR or an Operations Head.</p>
      </div>
      <Card className="p-3 flex flex-wrap gap-2">
        <select aria-label="Week" className={`${fieldCls} !w-auto`} value={week} onChange={e => setWeek(e.target.value)}><option value="">All weeks</option>{weeks.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}</select>
        <select aria-label="Status" className={`${fieldCls} !w-auto`} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
          <option value="">Every status</option>{(['SUBMITTED', 'RETURNED', 'ACKNOWLEDGED'] as const).map(s => <option key={s} value={s}>{WEEKLY_STATUS_LABEL[s]}</option>)}
        </select>
      </Card>
      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner label="Loading the weekly reports…" /> : null}
      {data && data.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">No weekly reports for this filter yet.</Card> : null}
      {data && data.length > 0 ? (
        <Card>
          <TableWrap>
            <table className="w-full min-w-[40rem]">
              <thead className="border-b border-slate-100"><tr>{['Team', 'Week', 'Status', 'Approved daily reports', 'Tasks completed', 'Submitted'].map(h => <th key={h} scope="col" className={thCls}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.map(r => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(r.id)} data-testid="weekly-row">
                    <td className={tdCls}><button type="button" className="text-left font-bold text-slate-900 hover:text-blue-700" onClick={e => { e.stopPropagation(); setOpenId(r.id); }}>{r.team}</button></td>
                    <td className={tdCls}>{weekLabel(r.weekStart)}</td><td className={tdCls}><WeeklyStatusBadge status={r.status} /></td>
                    <td className={tdCls}>{r.stats.totals.reportsApproved}</td><td className={tdCls}>{r.stats.totals.tasksCompleted}</td><td className={tdCls}>{dateTimeText(r.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
      {openId ? <ReviewDialog id={openId} onClose={() => setOpenId(null)} onDone={() => { setOpenId(null); reload(); }} /> : null}
    </section>
  );
};

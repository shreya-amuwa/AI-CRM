import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bot, History, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError } from '../../lib/api/client';
import { performanceApi, type PerformanceReportKey } from '../../lib/api/endpoints';
import { fmtDay } from '../../lib/support';
import type { PerformanceHistoryEntry, PerformanceMetrics, PerformanceReport } from '../../../shared/contracts';
import { Card, CardHead, ghostBtn, LoadingLine, primaryBtn, StatCard, type StatTone } from '../tasks/head/headParts';
import { OutcomeBar, WeeklyChart } from './PerformanceCharts';
import { periodLabel } from './periods';
import { Paged } from '../common/Paged';

export const INSUFFICIENT = 'Insufficient data';
const val = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? INSUFFICIENT : `${v}${suffix}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

const taskBadge = (t: PerformanceMetrics['taskList'][number]) => {
  if (t.overdue) return { text: `Overdue${t.daysLate ? ` ${t.daysLate}d` : ''}`, cls: 'bg-rose-50 text-rose-700' };
  if (t.status === 'COMPLETED') {
    if (t.onTime === true) return { text: 'On time', cls: 'bg-emerald-50 text-emerald-700' };
    if (t.daysLate) return { text: `Late ${t.daysLate}d`, cls: 'bg-amber-50 text-amber-700' };
    return { text: 'Completed', cls: 'bg-slate-100 text-slate-700' };
  }
  if (t.status === 'BLOCKED') return { text: 'Blocked', cls: 'bg-rose-50 text-rose-700' };
  if (t.status === 'NOT_COMPLETED') return { text: 'Not completed', cls: 'bg-amber-50 text-amber-700' };
  return { text: t.status === 'IN_PROGRESS' ? `In progress ${t.progress}%` : 'Assigned', cls: 'bg-blue-50 text-blue-700' };
};

const NarrativeList: React.FC<{ title: string; items: string[]; empty?: string }> = ({ title, items, empty }) => (
  <div>
    <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
    {items.length === 0 ? (
      <p className="mt-1.5 text-sm text-slate-500">{empty ?? INSUFFICIENT}</p>
    ) : (
      <ul className="mt-1.5 space-y-1.5 list-disc pl-5 text-sm text-slate-700 leading-relaxed">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    )}
  </div>
);

const sourceNote = (r: PerformanceReport) => {
  if (!r.narrative) return { icon: <Sparkles className="w-3.5 h-3.5" />, text: 'The written analysis is being prepared.', cls: 'bg-slate-100 text-slate-700' };
  if (r.narrativeSource === 'AI') return { icon: <Bot className="w-3.5 h-3.5" />, text: `AI-generated${r.aiModel ? ` (${r.aiModel})` : ''}, from the figures above`, cls: 'bg-indigo-50 text-indigo-700' };
  if (r.aiStatus === 'FAILED') return { icon: <Sparkles className="w-3.5 h-3.5" />, text: `Rule-based analysis: the AI service was unavailable${r.aiError ? ` (${r.aiError})` : ''}. It is tried again later.`, cls: 'bg-amber-50 text-amber-800' };
  return { icon: <Sparkles className="w-3.5 h-3.5" />, text: 'Rule-based analysis from the figures above (the AI service is not set up on this server).', cls: 'bg-slate-100 text-slate-700' };
};

/** One report: the figures (evidence), the charts, the written analysis, the tasks behind it and the history. */
export const ReportView: React.FC<{ reportKey: PerformanceReportKey; title: string; onBack: () => void }> = ({ reportKey, title, onBack }) => {
  const [report, setReport] = useState<PerformanceReport | null | undefined>(undefined);
  const [history, setHistory] = useState<PerformanceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await performanceApi.report(reportKey);
      setReport(r);
      setHistory(r ? await performanceApi.history(r.id) : null);
    } catch (e) {
      setError(errText(e));
      setReport(prev => (prev === undefined ? null : prev));
    }
  }, [reportKey]);
  useEffect(() => { setReport(undefined); void load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await performanceApi.generate(reportKey);
      setReport(res.report);
      setNotice(res.state === 'UNCHANGED' ? 'Checked against the task records: nothing has changed since the last report.' : res.state === 'CREATED' ? 'The report was created from the task records.' : 'The report was updated: the task figures changed.');
      setHistory(await performanceApi.history(res.report.id));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const m = report?.metrics;
  const tone = (n: number, bad = false): StatTone => (bad && n > 0 ? 'red' : 'neutral');
  return (
    <section className="space-y-5" aria-label={`Performance report: ${title}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={ghostBtn} onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back to the list</button>
        <button type="button" className={primaryBtn} onClick={() => void generate()} disabled={busy}>
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Working…' : report ? 'Refresh report' : 'Generate report'}
        </button>
      </div>
      {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{notice}</div>}
      {report === undefined && <LoadingLine label="Loading the report…" />}
      {report === null && !error && (
        <Card className="p-8 text-center">
          <h2 className="text-base font-extrabold text-slate-900">No report for this period yet</h2>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{title} has no stored report for {periodLabel(reportKey.start, reportKey.end)}. Generate one from the task records.</p>
        </Card>
      )}
      {report && m && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-slate-900">{report.subjectName}</h2>
                <p className="text-sm text-slate-600 mt-0.5">
                  {[report.subjectRole, report.scope === 'MEMBER' ? report.teamName : null, report.departmentName].filter(Boolean).join(' · ')}
                </p>
                <p className="text-sm text-slate-600 mt-0.5">Reporting period: <b>{periodLabel(report.periodStart, report.periodEnd)}</b> ({report.periodKind === 'WEEK' ? 'weekly' : report.periodKind === 'MONTH' ? 'monthly' : 'custom range'})</p>
              </div>
              <dl className="text-xs text-slate-500 text-right space-y-0.5">
                <div>Generated: <b className="text-slate-700">{when(report.generatedAt)}</b> ({report.trigger === 'SCHEDULED' ? 'scheduled' : `by ${report.generatedBy ?? 'a manager'}`})</div>
                <div>Last checked against the tasks: <b className="text-slate-700">{when(report.checkedAt)}</b></div>
                <div>Version {report.version} · {report.sourceTaskCount} task{report.sourceTaskCount === 1 ? '' : 's'} analysed</div>
              </dl>
            </div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Tasks" value={m.tasks.total} foot={`${m.tasks.completed} completed · ${m.tasks.pending} pending`} />
            <StatCard label="Completion" value={val(m.completionPct, '%')} tone={m.completionPct === null ? 'neutral' : 'blue'} foot={m.completionPct === null ? 'no tasks' : `${m.tasks.completed} of ${m.tasks.total}`} />
            <StatCard label="On-time completion" value={val(m.timing.onTimePct, '%')} tone={m.timing.onTimePct === null ? 'neutral' : m.timing.onTimePct >= 80 ? 'green' : 'amber'} foot={m.timing.onTimePct === null ? 'needs a deadline and a completion time' : `${m.timing.onTime} on time · ${m.timing.late} late`} />
            <StatCard label="Overdue" value={m.tasks.overdue} tone={tone(m.tasks.overdue, true)} foot={m.tasks.blocked ? `${m.tasks.blocked} blocked` : 'past their deadline, not completed'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHead title="Tasks per week" hint="Due or assigned in each week (Monday to Sunday)" />
              <div className="px-5 pb-5">{m.weekly.length ? <WeeklyChart weekly={m.weekly} /> : <p className="text-sm text-slate-500">{INSUFFICIENT}</p>}</div>
            </Card>
            <Card>
              <CardHead title="How the tasks ended" hint="Completed on time or late, still open, overdue" />
              <div className="px-5 pb-5"><OutcomeBar m={m} /></div>
            </Card>
          </div>

          <Card>
            <CardHead title="Expected versus actual duration" hint="The CRM records no expected duration: the planned window is the time from assignment to the deadline" />
            <dl className="px-5 pb-5 grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div><dt className="text-slate-500 text-xs">Average time to complete</dt><dd className="font-extrabold text-slate-900">{val(m.duration.avgActualDays, ' days')}</dd></div>
              <div><dt className="text-slate-500 text-xs">Average planned window</dt><dd className="font-extrabold text-slate-900">{val(m.duration.avgPlannedDays, ' days')}</dd></div>
              <div><dt className="text-slate-500 text-xs">Compared on {m.duration.comparedTasks} task(s): actual vs planned</dt><dd className="font-extrabold text-slate-900">{m.duration.comparedTasks ? `${m.duration.comparedActualDays} vs ${m.duration.comparedPlannedDays} days` : INSUFFICIENT}</dd></div>
              <div><dt className="text-slate-500 text-xs">Difference</dt><dd className="font-extrabold text-slate-900">{m.duration.avgDifferenceDays === null ? INSUFFICIENT : `${m.duration.avgDifferenceDays > 0 ? '+' : ''}${m.duration.avgDifferenceDays} days`}</dd></div>
              <div><dt className="text-slate-500 text-xs">Most tasks open at once</dt><dd className="font-extrabold text-slate-900">{val(m.workload.peakOpenTasks)}</dd></div>
              <div><dt className="text-slate-500 text-xs">Priority mix (high / medium / low)</dt><dd className="font-extrabold text-slate-900">{m.workload.byPriority.HIGH} / {m.workload.byPriority.MEDIUM} / {m.workload.byPriority.LOW}</dd></div>
              <div><dt className="text-slate-500 text-xs">Progress updates recorded</dt><dd className="font-extrabold text-slate-900">{m.activity.updates} ({m.activity.tasksWithoutUpdates} task(s) without)</dd></div>
              <div><dt className="text-slate-500 text-xs">Completion trend</dt><dd className="font-extrabold text-slate-900">{m.trend ? `${m.trend.change >= 0 ? '+' : ''}${m.trend.change} points` : INSUFFICIENT}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHead title="Analysis" right={(() => { const n = sourceNote(report); return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${n.cls}`}>{n.icon} {n.text}</span>; })()} />
            <div className="px-5 pb-5 space-y-5">
              {!report.narrative ? (
                <p className="text-sm text-slate-500">The written analysis is not ready yet. Press Refresh report to prepare it.</p>
              ) : (
                <>
                  <p className="text-[15px] text-slate-800 leading-relaxed">{report.narrative.summary}</p>
                  <NarrativeList title="Productivity and workload observations" items={report.narrative.observations} />
                  <NarrativeList title="Areas of improvement" items={report.narrative.improvementAreas} />
                  <NarrativeList title="Recommendations and next steps" items={report.narrative.recommendations} />
                  <NarrativeList title="Data limitations and missing information" items={report.narrative.limitations} empty="None noted." />
                </>
              )}
            </div>
          </Card>

          {m.delayReasons.length > 0 && (
            <Card>
              <CardHead title="Reasons recorded for delays" hint="Written by the person on the task when it was not completed or was blocked" />
              <ul className="px-5 pb-5 space-y-2 text-sm text-slate-700">
                {m.delayReasons.map((r, i) => <li key={i}><b className="text-slate-900">{r.task}</b> ({fmtDay(r.at)}): {r.note}</li>)}
              </ul>
            </Card>
          )}

          <Card>
            <CardHead title="Tasks behind this report" hint={m.taskList.length >= 60 ? 'The latest 60 tasks of the period' : undefined} />
            {m.taskList.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">No tasks in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[44rem]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
                      <th scope="col" className="px-5 py-2.5 font-semibold">Task</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Priority</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Assigned</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Deadline</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Completed</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Took / planned</th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.taskList.map(t => {
                      const b = taskBadge(t);
                      return (
                        <tr key={t.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-5 py-2.5 font-semibold text-slate-900 max-w-[18rem] truncate" title={t.title}>{t.title}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{t.priority}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDay(t.assignedOn)}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{t.dueDate ? fmtDay(t.dueDate) : 'No deadline'}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{t.completedAt ? fmtDay(t.completedAt) : t.status === 'COMPLETED' ? INSUFFICIENT : '–'}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{t.daysToComplete !== null ? `${t.daysToComplete}d` : '–'} / {t.plannedDays !== null ? `${t.plannedDays}d` : '–'}</td>
                          <td className="px-5 py-2.5"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${b.cls}`}>{b.text}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Report history" hint="A new version is kept only when the task figures changed" right={<History className="w-4 h-4 text-slate-400" aria-hidden="true" />} />
            {!history || history.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">No earlier versions.</p> : (
              <Paged items={history} noun="entries">{rows => (
              <ul className="px-5 pb-5 divide-y divide-slate-100">
                {rows.map(h => (
                  <li key={h.version} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">Version {h.version}{h.version === report.version ? ' (current)' : ''}</span>
                      <span className="text-xs text-slate-500">{when(h.generatedAt)} · {h.trigger === 'SCHEDULED' ? 'scheduled' : `by ${h.generatedBy ?? 'a manager'}`}</span>
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">{h.tasks.total} tasks, {h.tasks.completed} completed ({val(h.completionPct, '%')}), on time {val(h.onTimePct, '%')}, {h.tasks.overdue} overdue</div>
                  </li>
                ))}
              </ul>
              )}</Paged>
            )}
          </Card>
        </>
      )}
    </section>
  );
};

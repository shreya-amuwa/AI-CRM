import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AnalysisFact, AnalysisFacts, ReportAnalysisView } from '../../../../shared/contracts';
import { ApiError } from '../../../lib/api/client';
import { reportPerformanceApi } from '../../../lib/api/reportPerformance';
import { btn, Card, ErrorBanner, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { dateLabel, shiftWeek, timeLabel, todayIso, WeekPicker, weekOf } from '../../reports/reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const FACT_KEYS = ['strongCompletion', 'lowCompletion', 'missingReports', 'repeatedRevisions', 'wellPerformingTeams', 'taskGaps', 'performanceChanges', 'departmentDelays'] as const;

const factMap = (facts: AnalysisFacts) => {
  const m = new Map<string, AnalysisFact>();
  for (const k of FACT_KEYS) for (const f of facts[k] ?? []) m.set(f.factId, f);
  return m;
};

/**
 * The AI Performance Analysis: a readable summary written ONLY from the measurable facts of the period (task records, submitted reports,
 * approvals, HR reviews). Every point lists the facts it is based on, with the person / team / department and the numbers. It is kept apart
 * from the reports and from the HR ratings, assumes no reason for a result and changes no rating.
 */
export const AiAnalysis: React.FC<{ reloadKey: number; onOpenEmployee: (id: string, period: { type: string; from?: string; to?: string }) => void }> = ({ reloadKey, onOpenEmployee }) => {
  const [week, setWeek] = useState(() => weekOf(todayIso()).start);
  const [span, setSpan] = useState<'WEEK' | 'FOUR'>('WEEK');
  const [view, setView] = useState<ReportAnalysisView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => ({ from: span === 'WEEK' ? week : shiftWeek(week, -3), to: weekOf(week).end }), [week, span]);

  // start on the latest consolidated week HR sent
  useEffect(() => {
    reportPerformanceApi.consolidatedList().then(l => { if (l[0]) setWeek(l[0].weekStart); }, () => undefined);
  }, []);
  const load = useCallback(() => {
    reportPerformanceApi.analysis(range.from, range.to).then(v => { setError(''); setView(v); }, e => setError(errText(e)));
  }, [range.from, range.to]);
  useEffect(() => { setView(null); }, [range.from, range.to]);
  useEffect(load, [load, reloadKey]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try { setView(await reportPerformanceApi.generateAnalysis(range.from, range.to)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const facts = view?.facts;
  const map = useMemo(() => (facts ? factMap(facts) : new Map<string, AnalysisFact>()), [facts]);
  const a = view?.analysis ?? null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">AI Performance Analysis</h2>
          <p className="text-xs text-slate-500">Written from the measurable facts of the period. It does not change any report or HR rating.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-semibold text-slate-500">Period
            <select className={`${selectCls} mt-1 block`} value={span} onChange={e => setSpan(e.target.value as 'WEEK' | 'FOUR')}>
              <option value="WEEK">One week</option><option value="FOUR">Last 4 weeks</option>
            </select>
          </label>
          <WeekPicker value={week} onChange={setWeek} label={span === 'WEEK' ? 'Reporting week' : 'Ending week'} />
          <button type="button" className={btn.primary} onClick={() => void generate()} disabled={busy}><Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Writing...' : a ? 'Write again' : 'Write the analysis'}</button>
        </div>
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!view && !error ? <Spinner /> : null}
      {view && facts ? (
        <>
          <p className="text-xs text-slate-600">Period {dateLabel(range.from)} to {dateLabel(range.to)} - {facts.counts.people} people, {facts.counts.ranked} scored, {facts.counts.insufficient} with insufficient data (not judged).</p>
          {!a ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">No analysis has been written for this period yet. Use "Write the analysis".</p>
          ) : (
            <div className="space-y-4" data-testid="analysis">
              <div className={`rounded-xl border px-3 py-2 text-xs ${a.source === 'AI' ? 'border-indigo-200 bg-indigo-50/50 text-indigo-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                {a.source === 'AI' ? <>Written by AI ({a.model}) from the facts below, {timeLabel(a.createdAt)}.</> : <>Written by fixed rules from the facts below, {timeLabel(a.createdAt)}. {a.status === 'FAILED' ? `The AI service could not be used (${a.error ?? 'error'}); it is tried again next time.` : view.aiConfigured ? '' : 'AI writing is switched off on this server.'}</>}
              </div>
              <p className="text-sm text-slate-800" data-testid="analysis-summary">{a.narrative.summary}</p>
              {a.narrative.sections.length === 0 ? <p className="text-sm text-slate-500">No finding crossed the thresholds in this period.</p> : a.narrative.sections.map(s => (
                <section key={s.key} aria-label={s.title}>
                  <h3 className="text-sm font-bold text-slate-900 mb-2">{s.title}</h3>
                  <ul className="space-y-2">
                    {s.items.map((i, n) => {
                      const used = i.factIds.map(id => map.get(id)).filter((f): f is AnalysisFact => !!f);
                      return (
                        <li key={n} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800">
                          {used.length === 1 && !i.text.includes(used[0].name) ? <b>{used[0].name}: </b> : null}{i.text}
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            Based on:
                            {used.map(f => f.subjectType === 'PERSON'
                              ? <button key={f.factId} type="button" className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-indigo-700 hover:bg-slate-200" onClick={() => onOpenEmployee(f.subjectId, { type: 'CUSTOM', from: range.from, to: range.to })} title={f.sources.join(', ')}>{f.name} - {f.factId}</button>
                              : <span key={f.factId} className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700" title={f.sources.join(', ')}>{f.name} - {f.factId}</span>)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              <section aria-label="Limits of this analysis"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Limits</h3><ul className="list-disc pl-5 text-xs text-slate-600 space-y-0.5">{a.narrative.limitations.map((l, n) => <li key={n}>{l}</li>)}</ul></section>
            </div>
          )}
          <section aria-label="HR ratings">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">HR ratings in the period (given by HR, shown apart from the calculated measures)</h3>
            {facts.hrRatings.length === 0 ? <p className="text-xs text-slate-500">No submitted HR review in this period.</p> : (
              <ul className="flex flex-wrap gap-2">{facts.hrRatings.map(h => <li key={h.departmentId} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs ring-1 ring-slate-200"><b>{h.department}</b>: average {h.average} from {h.reviews} review{h.reviews === 1 ? '' : 's'}</li>)}</ul>
            )}
          </section>
        </>
      ) : null}
    </Card>
  );
};

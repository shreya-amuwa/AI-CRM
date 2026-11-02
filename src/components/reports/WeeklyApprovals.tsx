import React, { useCallback, useEffect, useId, useState } from 'react';
import type { WeeklyPendingItem } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { weeklyReportsApi } from '../../lib/api/workReports';
import { btn, Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { StatsGrid, TeamStatsTable } from './DailySummary';
import { notifyReportsChanged } from './reportEvents';
import { dateLabel } from './reportUi';
import { WeeklyPackageView } from './WeeklyPackageView';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** The Operations Head's decision on one weekly report: Approve (it goes to HR) or Request revision (back to the Department Head). */
export const WeeklyReviewPanel: React.FC<{ packageId: string; onDone: () => void }> = ({ packageId, onDone }) => {
  const uid = useId();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const decide = async (decision: 'APPROVED' | 'REVISION_REQUIRED') => {
    if (decision === 'REVISION_REQUIRED' && comment.trim().length < 3) { setProblem('Write a comment so the Department Head knows what to correct.'); return; }
    setBusy(true);
    setProblem('');
    try {
      await weeklyReportsApi.review(packageId, decision, comment.trim() || undefined);
      setComment('');
      notifyReportsChanged();
      onDone();
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Your decision on the weekly report" className="rounded-xl border border-slate-200 p-3 space-y-2">
      <label htmlFor={`${uid}-c`} className="block text-xs font-semibold text-slate-700">Comment <span className="font-normal text-slate-500">(needed to request a revision)</span></label>
      <textarea id={`${uid}-c`} className={`${inputCls} min-h-16`} value={comment} maxLength={2000} disabled={busy} onChange={e => { setComment(e.target.value); setProblem(''); }} />
      {problem ? <p role="alert" className="text-xs text-rose-700">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.green} onClick={() => void decide('APPROVED')} disabled={busy}>Approve and send to HR</button>
        <button type="button" className={btn.secondary} onClick={() => void decide('REVISION_REQUIRED')} disabled={busy}>Request revision</button>
      </div>
      <p className="text-[11px] text-slate-500">Only an approved weekly report reaches HR. Your name, comment and the time are kept.</p>
    </section>
  );
};

/** The weekly department reports waiting for the Operations Head: review the summary and the figures, then approve or send back. */
export const WeeklyApprovals: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [items, setItems] = useState<WeeklyPendingItem[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    weeklyReportsApi.pending().then(d => { setError(''); setItems(d); }, e => { setItems(prev => prev ?? []); setError(errText(e)); });
  }, []);
  useEffect(load, [load, reloadKey]);
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-slate-900">Weekly Approvals</h2>
      <p className="text-xs text-slate-500 mb-3">Weekly department reports sent by the Department Heads. Approving forwards the report to HR for the performance reviews.</p>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {items === null ? <Spinner /> : items.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No weekly report is waiting for your approval.</p> : (
        <ul className="space-y-4" data-testid="weekly-pending">
          {items.map(i => (
            <li key={i.package.id}>
              <article className="rounded-2xl border border-slate-200 p-4 space-y-3" aria-label={`Weekly report of ${i.department}`}>
                <header>
                  <h3 className="text-sm font-bold text-slate-900">{i.department}</h3>
                  <p className="text-[11px] text-slate-500">Week {dateLabel(i.package.periodStart)} to {dateLabel(i.package.periodEnd)}</p>
                </header>
                <WeeklyPackageView pkg={i.package} />
                {i.package.stats ? (
                  <div className="space-y-3">
                    <StatsGrid stats={i.package.stats} />
                    <TeamStatsTable stats={i.package.stats} />
                  </div>
                ) : null}
                <WeeklyReviewPanel packageId={i.package.id as string} onDone={load} />
              </article>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

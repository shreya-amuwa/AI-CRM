import React, { useEffect, useState } from 'react';
import type { EmployeeProfile } from '../../../../shared/contracts';
import { ApiError } from '../../../lib/api/client';
import { reportPerformanceApi } from '../../../lib/api/reportPerformance';
import { Dialog, ErrorBanner, Spinner } from '../../team-member/pipeline/shared';
import { ReportRow } from '../../reports/ReportRow';
import { dateLabel, timeLabel } from '../../reports/reportUi';
import { PersonFigures } from '../../hr/ReviewForm';
import { Breakdown, CategoryPill, WeeklyBars, type CATEGORY_TONE } from './parts';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * One employee: the system-calculated score and its breakdown, the weekly history, the underlying daily reports and the HR reviews. The HR
 * ratings are shown apart from the calculated measures and are never changed here.
 */
export const EmployeeProfileDialog: React.FC<{ id: string; period: { type: string; from?: string; to?: string }; onClose: () => void; onOpenReport: (id: string) => void }> = ({ id, period, onClose, onOpenReport }) => {
  const [p, setP] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    reportPerformanceApi.employee(id, { periodType: period.type === 'WEEKLY' || period.type === 'DAILY' || period.type === 'CUSTOM' ? period.type : 'MONTHLY', from: period.from, to: period.to }).then(setP, e => setError(errText(e)));
  }, [id, period.type, period.from, period.to]);
  return (
    <Dialog title={p?.name ?? 'Employee'} description={p ? `${p.designation ?? p.role} - ${p.department}${p.team ? ` / ${p.team}` : ''} - ${p.employeeId}` : undefined} onClose={onClose} wide>
      {error ? <ErrorBanner message={error} /> : null}
      {!p && !error ? <Spinner /> : null}
      {p ? (
        <div className="space-y-5" data-testid="employee-profile">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <CategoryPill category={p.category as keyof typeof CATEGORY_TONE} />
            <span>Period {dateLabel(p.period.from)} to {dateLabel(p.period.to)}</span>
            <span className="text-lg font-bold text-slate-900 tabular-nums">{p.score ?? 'Insufficient data'}</span>
            {p.teamLead ? <span>Team Lead: {p.teamLead}</span> : null}
          </div>
          <section aria-label="System-calculated measures"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">System-calculated score (from records)</h3><Breakdown items={p.breakdown} score={p.score} /></section>
          <section aria-label="Figures"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Figures</h3><PersonFigures stats={p.stats} /></section>
          <section aria-label="Weekly history">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Last 8 weeks</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <WeeklyBars title="Score" points={p.weeks.map(w => ({ label: w.weekStart.slice(5), value: w.score }))} />
              <WeeklyBars title="Task completion %" points={p.weeks.map(w => ({ label: w.weekStart.slice(5), value: w.completionRate }))} />
              <WeeklyBars title="Reporting compliance %" points={p.weeks.map(w => ({ label: w.weekStart.slice(5), value: w.compliance }))} />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">A dashed bar means there was not enough data that week.</p>
          </section>
          <section aria-label="HR reviews">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">HR reviews (given by HR, not calculated)</h3>
            {p.hrReviews.length === 0 ? <p className="text-xs text-slate-500">No submitted HR review.</p> : (
              <ul className="space-y-2">{p.hrReviews.map(r => (
                <li key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <b>{dateLabel(r.periodStart)} - {dateLabel(r.periodEnd)}</b>: rating {r.rating} ({r.ratingLabel}) by {r.reviewer}, {timeLabel(r.submittedAt)}
                  {r.workAssessment ? <p className="text-xs text-slate-700 mt-1"><b>Assessment:</b> {r.workAssessment}</p> : null}
                  {r.comments ? <p className="text-xs text-slate-700 mt-1"><b>Comments:</b> {r.comments}</p> : null}
                  {r.recommendations ? <p className="text-xs text-slate-700 mt-1"><b>Recommendations:</b> {r.recommendations}</p> : null}
                </li>
              ))}</ul>
            )}
          </section>
          <section aria-label="Daily reports">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Daily reports in the period ({p.reports.length})</h3>
            {p.reports.length === 0 ? <p className="text-xs text-slate-500">No submitted report in this period.</p> : <ul className="space-y-2">{p.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpenReport} /></li>)}</ul>}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
};

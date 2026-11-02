import React, { useCallback, useEffect, useState } from 'react';
import type { DailyDepartmentSummary, ReportStats } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { weeklyReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { dateLabel, pctLabel, Stat, todayIso } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** The figures of a period: used by the daily summary, the weekly report and the Operations Head overview. */
export const StatsGrid: React.FC<{ stats: ReportStats }> = ({ stats }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="stats-grid">
    <Stat label="Team Members" value={stats.members} />
    <Stat label="Team Leads" value={stats.teamLeads} />
    <Stat label="Reports expected" value={stats.expected} hint="Working days, leave excluded" />
    <Stat label="Reports submitted" value={stats.submitted} tone="info" />
    <Stat label="Reporting compliance" value={pctLabel(stats.compliance)} tone={typeof stats.compliance === 'number' && stats.compliance < 80 ? 'warn' : 'good'} />
    <Stat label="Pending Team Lead approval" value={stats.pendingTl} tone={stats.pendingTl ? 'warn' : 'neutral'} />
    <Stat label="Pending Department Head approval" value={stats.pendingDh} tone={stats.pendingDh ? 'warn' : 'neutral'} />
    <Stat label="Fully approved" value={stats.approved} tone="good" />
    <Stat label="Revision / rejected" value={stats.revision + stats.rejected} tone={stats.revision + stats.rejected ? 'bad' : 'neutral'} />
    <Stat label="Tasks completed" value={`${stats.completedTasks}/${stats.assignedTasks}`} hint={stats.completionRate === null ? 'No tasks reported' : `${stats.completionRate}% of assigned`} />
  </div>
);

/** Team by team: expected, submitted, approved, pending and task completion. */
export const TeamStatsTable: React.FC<{ stats: ReportStats }> = ({ stats }) => (
  stats.teams.length === 0 ? <p className="text-xs text-slate-500">No teams to show.</p> : (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-xs">
        <caption className="sr-only">Team-wise reporting</caption>
        <thead className="bg-slate-50 text-slate-500">
          <tr>{['Team', 'Team Lead', 'Members', 'Expected', 'Submitted', 'Approved', 'Pending', 'Tasks done', 'Compliance'].map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stats.teams.map(t => (
            <tr key={t.teamId}>
              <th scope="row" className="px-3 py-2 text-left font-semibold text-slate-800">{t.team}</th>
              <td className="px-3 py-2">{t.lead ?? '-'}</td>
              <td className="px-3 py-2 tabular-nums">{t.members}</td>
              <td className="px-3 py-2 tabular-nums">{t.expected}</td>
              <td className="px-3 py-2 tabular-nums">{t.submitted}</td>
              <td className="px-3 py-2 tabular-nums">{t.approved}</td>
              <td className="px-3 py-2 tabular-nums">{t.pendingTl + t.pendingDh}</td>
              <td className="px-3 py-2 tabular-nums">{t.completedTasks}/{t.assignedTasks}</td>
              <td className="px-3 py-2 tabular-nums">{pctLabel(t.compliance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
);

/**
 * The Daily Department Summary: generated from the individual reports of the chosen day (nothing is copied or typed). Expected reports
 * are the working days of the people in the department, without the days they were on approved leave. Previous days are opened with the
 * date filter.
 */
export const DailySummary: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<DailyDepartmentSummary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    weeklyReportsApi.dailySummary({ date }).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [date]);
  useEffect(() => { setData(null); }, [date]);
  useEffect(load, [load, reloadKey]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Daily Department Summary</h2>
          <p className="text-xs text-slate-500">{data?.department ?? 'Your department'} - calculated from the individual reports of the day.</p>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor="daily-summary-date">Date</label>
          <input id="daily-summary-date" type="date" className={`${inputCls} !w-auto !py-1.5`} value={date} max={todayIso()} onChange={e => e.target.value && setDate(e.target.value)} />
        </div>
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-800">{dateLabel(data.date)}</p>
          <StatsGrid stats={data} />
          <section aria-label="Team-wise reporting">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team-wise</h3>
            <TeamStatsTable stats={data} />
          </section>
          <section aria-label="Reports not submitted">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Expected but not submitted ({data.missing.length})</h3>
            {data.missing.length === 0 ? <p className="text-xs text-slate-500">{data.expected === 0 ? 'No reports are expected on this day.' : 'Everyone expected has submitted.'}</p> : (
              <ul className="flex flex-wrap gap-1.5">{data.missing.map(m => <li key={m.id} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-200">{m.name}{m.designation ? ` (${m.designation})` : ''}</li>)}</ul>
            )}
          </section>
        </div>
      ) : null}
    </Card>
  );
};

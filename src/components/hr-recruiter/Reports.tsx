import React, { useState } from 'react';
import type { RecruiterContext, RecruiterReports } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { FilterBar } from './FilterBar';
import { Bar, Kpi, STAGE_LABEL, STAGE_ORDER, VacancyPill, useLoad } from './ui';

/** Recruitment Reports: figures for the recruiter's own vacancies (HR leadership: the company). Counts only; no personal details. */
export const Reports: React.FC<{ ctx: RecruiterContext }> = ({ ctx }) => {
  const [filters, setFilters] = useState<RecruiterQuery>({});
  const { data, error, loading, reload } = useLoad<RecruiterReports>(() => recruiterApi.reports(filters), [JSON.stringify(filters)]);
  const t = data?.totals;
  const max = Math.max(1, ...STAGE_ORDER.map(s => data?.byStage[s] ?? 0));
  return (
    <div className="space-y-5">
      <PageTitle title="Recruitment Reports" subtitle={data?.scope === 'COMPANY' ? 'Recruitment across the company.' : 'Recruitment for your vacancies.'} />
      <FilterBar value={filters} onChange={setFilters} fields={['posting', 'department', 'designation', 'dates', 'recruiter']} leadership={ctx.isLeadership} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && t && (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Kpi label="Vacancies" value={t.vacancies} /><Kpi label="Open vacancies" value={t.openVacancies} /><Kpi label="Closed / filled" value={t.closedVacancies} /><Kpi label="Applications" value={t.applications} />
            <Kpi label="Screened" value={t.screened} /><Kpi label="Calls completed" value={t.callsCompleted} /><Kpi label="Interviews scheduled" value={t.interviewsScheduled} /><Kpi label="Interviews completed" value={t.interviewsCompleted} />
            <Kpi label="Selected" value={t.selected} tone="good" /><Kpi label="Rejected" value={t.rejected} tone="bad" /><Kpi label="On hold" value={t.onHold} tone="warn" />
            <Kpi label="Selection rate" value={t.selected + t.rejected ? `${Math.round((t.selected / (t.selected + t.rejected)) * 100)}%` : '–'} />
          </section>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-3">Candidates by stage</h2><div className="space-y-2">{STAGE_ORDER.map(s => <Bar key={s} label={STAGE_LABEL[s]} value={data.byStage[s] ?? 0} max={max} tone={s === 'SELECTED' ? 'bg-emerald-500' : s === 'REJECTED' ? 'bg-rose-500' : 'bg-indigo-500'} />)}</div></Card>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-3">Vacancy-wise progress</h2>
            {data.vacancyProgress.length === 0 ? <p className="text-xs text-slate-500">No applications for the chosen filters.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><caption className="sr-only">Progress of each vacancy</caption>
                <thead><tr className="text-left text-slate-500 border-b border-slate-100"><th scope="col" className="py-2 pr-3">Vacancy</th><th scope="col" className="pr-3">Department</th><th scope="col" className="pr-3">Status</th><th scope="col" className="pr-3">Openings</th><th scope="col" className="pr-3">Applications</th><th scope="col" className="pr-3">In progress</th><th scope="col" className="pr-3">Selected</th><th scope="col">Rejected</th></tr></thead>
                <tbody>{data.vacancyProgress.map(v => (<tr key={v.postingId} className="border-b border-slate-50"><th scope="row" className="py-2 pr-3 text-left font-semibold">{v.vacancy}</th><td className="pr-3">{v.department ?? '–'}</td><td className="pr-3"><VacancyPill status={v.status} /></td><td className="pr-3 tabular-nums">{v.openings}</td><td className="pr-3 tabular-nums">{v.applications}</td><td className="pr-3 tabular-nums">{v.inProgress}</td><td className="pr-3 tabular-nums text-emerald-700 font-semibold">{v.selected}</td><td className="tabular-nums text-rose-700">{v.rejected}</td></tr>))}</tbody></table></div>
            )}
          </Card>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-3">{data.scope === 'COMPANY' ? 'Recruiter performance' : 'Your performance'}</h2>
            {data.recruiters.length === 0 ? <p className="text-xs text-slate-500">No data yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><caption className="sr-only">Recruiter performance</caption>
                <thead><tr className="text-left text-slate-500 border-b border-slate-100"><th scope="col" className="py-2 pr-3">Recruiter</th><th scope="col" className="pr-3">Applications</th><th scope="col" className="pr-3">Selected</th><th scope="col" className="pr-3">Rejected</th><th scope="col">Avg. days to decision</th></tr></thead>
                <tbody>{data.recruiters.map(r => (<tr key={r.recruiterId ?? 'none'} className="border-b border-slate-50"><th scope="row" className="py-2 pr-3 text-left font-semibold">{r.recruiter ?? 'Unassigned'}</th><td className="pr-3 tabular-nums">{r.applications}</td><td className="pr-3 tabular-nums text-emerald-700">{r.selected}</td><td className="pr-3 tabular-nums text-rose-700">{r.rejected}</td><td className="tabular-nums">{r.avgDaysToDecision ?? '–'}</td></tr>))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import type { RecruiterContext, RecruiterOverview } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { FilterBar } from './FilterBar';
import type { RecruiterGo } from './RecruiterDashboard';
import { Bar, Empty, Kpi, STAGE_LABEL, STAGE_ORDER, StagePill, fmtDate, useLoad } from './ui';

/** Dashboard: the recruiter's own numbers, vacancy by vacancy and stage by stage. Every figure comes from the database and respects the filters. */
export const Overview: React.FC<{ ctx: RecruiterContext; go: RecruiterGo }> = ({ ctx, go }) => {
  const [filters, setFilters] = useState<RecruiterQuery>({});
  const { data, error, loading, reload } = useLoad<RecruiterOverview>(() => recruiterApi.overview(filters), [JSON.stringify(filters)]);
  const k = data?.kpis;
  const maxStage = Math.max(1, ...STAGE_ORDER.map(s => data?.byStage[s] ?? 0));
  const maxVac = Math.max(1, ...(data?.byVacancy ?? []).map(v => v.applications));
  return (
    <div className="space-y-5">
      <PageTitle title={`Welcome, ${ctx.name.split(' ')[0]}`} subtitle={ctx.isLeadership ? 'Recruitment across the company.' : 'Your vacancies, candidates and interviews.'} />
      <FilterBar value={filters} onChange={setFilters} fields={['posting', 'department', 'designation', 'dates', 'recruiter']} leadership={ctx.isLeadership} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && k && (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label="Open vacancies" value={k.vacancies} onClick={() => go('vacancies')} />
            <Kpi label="Applications received" value={k.applied} onClick={() => go('applications')} />
            <Kpi label="New, not yet screened" value={k.newApplications} tone={k.newApplications ? 'warn' : 'neutral'} onClick={() => go('applications', { stage: 'NEW_APPLICATION' })} />
            <Kpi label="Calls pending" value={k.callsPending} tone={k.callsPending ? 'warn' : 'neutral'} onClick={() => go('calls')} />
            <Kpi label="Calls completed" value={k.callsCompleted} onClick={() => go('calls')} />
            <Kpi label="Tests pending" value={k.testsPending} onClick={() => go('assessments')} />
            <Kpi label="Interviews scheduled" value={k.interviewsScheduled} onClick={() => go('interviews')} />
            <Kpi label="Interviews completed" value={k.interviewsCompleted} onClick={() => go('interviews')} />
            <Kpi label="Selected" value={k.selected} tone="good" onClick={() => go('decisions')} />
            <Kpi label="Rejected" value={k.rejected} tone="bad" onClick={() => go('decisions')} />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Candidates by stage</h2>
              <div className="space-y-2">{STAGE_ORDER.map(s => <Bar key={s} label={STAGE_LABEL[s]} value={data.byStage[s] ?? 0} max={maxStage} tone={s === 'SELECTED' ? 'bg-emerald-500' : s === 'REJECTED' ? 'bg-rose-500' : 'bg-indigo-500'} />)}</div>
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Applications by vacancy</h2>
              {data.byVacancy.length === 0 ? <p className="text-xs text-slate-500">No applications yet.</p> : (
                <div className="space-y-2">{data.byVacancy.slice(0, 10).map(v => <Bar key={v.postingId} label={v.vacancy} value={v.applications} max={maxVac} />)}</div>
              )}
            </Card>
          </div>
          <Card className="p-4">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Vacancy progress</h2>
            {data.vacancyProgress.length === 0 ? <p className="text-xs text-slate-500">No vacancy has applications yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Progress of each vacancy</caption>
                  <thead><tr className="text-left text-slate-500 border-b border-slate-100"><th scope="col" className="py-2 pr-3">Vacancy</th><th scope="col" className="pr-3">Openings</th><th scope="col" className="pr-3">Applications</th><th scope="col" className="pr-3">Screening</th><th scope="col" className="pr-3">Interviews</th><th scope="col" className="pr-3">Selected</th><th scope="col">Rejected</th></tr></thead>
                  <tbody>{data.vacancyProgress.map(v => (
                    <tr key={v.postingId} className="border-b border-slate-50"><th scope="row" className="py-2 pr-3 text-left font-semibold text-slate-800"><button type="button" className="hover:underline text-left" onClick={() => go('vacancies', { vacancyId: v.postingId })}>{v.vacancy}</button></th>
                      <td className="pr-3 tabular-nums">{v.openings}</td><td className="pr-3 tabular-nums">{v.applications}</td><td className="pr-3 tabular-nums">{v.screening}</td><td className="pr-3 tabular-nums">{v.interviews}</td>
                      <td className="pr-3 tabular-nums text-emerald-700 font-semibold">{v.selected}</td><td className="tabular-nums text-rose-700">{v.rejected}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Latest applications</h2>
            {data.recent.length === 0 ? <Empty title="No applications yet" hint="Candidates who apply to your vacancies through the career portal appear here." /> : (
              <ul className="divide-y divide-slate-100">{data.recent.map(a => (
                <li key={a.applicationId}>
                  <button type="button" onClick={() => go('applications', { applicationId: a.applicationId })} className="w-full flex flex-wrap items-center justify-between gap-2 py-2.5 text-left hover:bg-slate-50 rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
                    <span><span className="block text-sm font-semibold text-slate-900">{a.name}</span><span className="block text-[11px] text-slate-500">{a.vacancy} · applied {fmtDate(a.appliedAt)}</span></span>
                    <StagePill stage={a.stage} />
                  </button>
                </li>
              ))}</ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

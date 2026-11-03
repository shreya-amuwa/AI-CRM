import React, { useState } from 'react';
import type { RecruiterApplicationPage, RecruiterContext } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { CandidateProfile } from './CandidateProfile';
import { FilterBar } from './FilterBar';
import type { RecruiterGo } from './RecruiterDashboard';
import { Empty, StagePill, fmtDate, fmtDateTime, useLoad } from './ui';

const TEST_LABEL = { NONE: '–', PENDING: 'Pending', PASSED: 'Passed', FAILED: 'Failed' } as const;
const INTERVIEW_LABEL = { NONE: '–', SCHEDULED: 'Scheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled' } as const;

/** Candidate Applications: every application of the recruiter's vacancies, filtered and paged by the database; opening one shows the full profile. */
export const Applications: React.FC<{ ctx: RecruiterContext; go: RecruiterGo; applicationId?: string; initial?: RecruiterQuery; onChanged: () => void }> = ({ ctx, go, applicationId, initial, onChanged }) => {
  const [filters, setFilters] = useState<RecruiterQuery>({ page: 1, pageSize: 25, ...initial });
  const { data, error, loading, reload } = useLoad<RecruiterApplicationPage>(() => recruiterApi.applications(filters), [JSON.stringify(filters)]);
  if (applicationId) return <CandidateProfile id={applicationId} ctx={ctx} onBack={() => go('applications')} onChanged={() => { reload(); onChanged(); }} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <PageTitle title="Candidate Applications" subtitle="Applications submitted through the career portal for your vacancies." />
      <FilterBar value={filters} onChange={setFilters} fields={['search', 'posting', 'department', 'designation', 'stage', 'assessment', 'interview', 'result', 'recruiter', 'dates']} leadership={ctx.isLeadership} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (data.items.length === 0 ? (
        <Empty title="No applications match" hint="Change the filters, or wait for candidates to apply to your vacancies." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Candidate applications</caption>
              <thead><tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50/60">
                <th scope="col" className="px-3 py-2.5">Candidate</th><th scope="col" className="px-3">Vacancy</th><th scope="col" className="px-3">Applied</th><th scope="col" className="px-3">Stage</th>
                <th scope="col" className="px-3">Assessment</th><th scope="col" className="px-3">Interview</th><th scope="col" className="px-3">Next</th>{ctx.isLeadership && <th scope="col" className="px-3">Recruiter</th>}
              </tr></thead>
              <tbody>{data.items.map(a => (
                <tr key={a.applicationId} className="border-b border-slate-50 hover:bg-slate-50/70">
                  <th scope="row" className="px-3 py-2.5 text-left">
                    <button type="button" className="text-left font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded" onClick={() => go('applications', { applicationId: a.applicationId })}>{a.name}</button>
                    <span className="block text-[11px] font-normal text-slate-500">{a.email}</span>
                  </th>
                  <td className="px-3">{a.vacancy}<span className="block text-[11px] text-slate-500">{a.department ?? ''}</span></td>
                  <td className="px-3 whitespace-nowrap">{fmtDate(a.appliedAt)}</td>
                  <td className="px-3"><StagePill stage={a.stage} /></td>
                  <td className="px-3">{TEST_LABEL[a.testStatus]}{a.testScore !== null && a.testStatus !== 'PENDING' ? ` (${a.testScore})` : ''}</td>
                  <td className="px-3">{INTERVIEW_LABEL[a.interviewStatus]}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{a.nextAt ? `${a.nextKind?.toLowerCase()} ${fmtDateTime(a.nextAt)}` : '–'}</td>
                  {ctx.isLeadership && <td className="px-3">{a.recruiter ?? '–'}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-600">
            <span>{data.total} application{data.total === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-2">
              <button type="button" className={btn.secondary} disabled={(filters.page ?? 1) <= 1} onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) - 1 }))}>Previous</button>
              <span aria-live="polite">Page {data.page} of {pages}</span>
              <button type="button" className={btn.secondary} disabled={(filters.page ?? 1) >= pages} onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</button>
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
};

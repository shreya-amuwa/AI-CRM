import React, { useState } from 'react';
import type { RecruiterApplicationPage, RecruiterContext } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { FilterBar } from './FilterBar';
import type { RecruiterGo } from './RecruiterDashboard';
import { Empty, StagePill, fmtDate, useLoad } from './ui';

const VIEWS: { id: 'PENDING' | 'PASSED' | 'FAILED' | 'ALL'; label: string }[] = [{ id: 'PENDING', label: 'Pending' }, { id: 'PASSED', label: 'Passed' }, { id: 'FAILED', label: 'Failed' }, { id: 'ALL', label: 'All invited' }];

/** Assessment & Test Results: who was invited, who is still to take the test, and the scores. Inviting a candidate is done from the candidate's profile. */
export const Assessments: React.FC<{ ctx: RecruiterContext; go: RecruiterGo }> = ({ ctx, go }) => {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('PENDING');
  const [filters, setFilters] = useState<RecruiterQuery>({ pageSize: 100 });
  const query: RecruiterQuery = { ...filters, assessment: view === 'ALL' ? undefined : view };
  const { data, error, loading, reload } = useLoad<RecruiterApplicationPage>(() => recruiterApi.applications(query), [JSON.stringify(query)]);
  // "All invited" hides the candidates who were never invited
  const items = (data?.items ?? []).filter(a => a.testStatus !== 'NONE');
  return (
    <div className="space-y-4">
      <PageTitle title="Assessment & Test Results" subtitle="Test invitations and the results your candidates have submitted." />
      <FilterBar value={filters} onChange={f => setFilters({ ...f, pageSize: 100 })} fields={['search', 'posting', 'department']} leadership={ctx.isLeadership} />
      <div role="tablist" aria-label="Assessment status" className="flex gap-1 border-b border-slate-200">
        {VIEWS.map(v => <button key={v.id} role="tab" type="button" aria-selected={view === v.id} onClick={() => setView(v.id)} className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 ${view === v.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{v.label}</button>)}
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : items.length === 0 ? <Empty title="Nothing here" hint="Invite a candidate to a test from the candidate's profile." /> : (
        <Card><div className="overflow-x-auto"><table className="w-full text-xs"><caption className="sr-only">Assessments</caption>
          <thead><tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50/60"><th scope="col" className="px-3 py-2.5">Candidate</th><th scope="col" className="px-3">Vacancy</th><th scope="col" className="px-3">Applied</th><th scope="col" className="px-3">Result</th><th scope="col" className="px-3">Score</th><th scope="col" className="px-3">Stage</th></tr></thead>
          <tbody>{items.map(a => (
            <tr key={a.applicationId} className="border-b border-slate-50 hover:bg-slate-50/70">
              <th scope="row" className="px-3 py-2.5 text-left"><button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => go('applications', { applicationId: a.applicationId })}>{a.name}</button></th>
              <td className="px-3">{a.vacancy}</td><td className="px-3 whitespace-nowrap">{fmtDate(a.appliedAt)}</td>
              <td className={`px-3 font-semibold ${a.testStatus === 'PASSED' ? 'text-emerald-700' : a.testStatus === 'FAILED' ? 'text-rose-700' : 'text-amber-700'}`}>{a.testStatus === 'PENDING' ? 'Pending' : a.testStatus === 'PASSED' ? 'Passed' : 'Not passed'}</td>
              <td className="px-3 tabular-nums">{a.testScore ?? '–'}</td><td className="px-3"><StagePill stage={a.stage} /></td>
            </tr>))}</tbody></table></div></Card>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import type { RecruiterContext, RecruiterFilterOptions, RecruiterPipeline } from '../../../shared/contracts';
import { recruiterApi } from '../../lib/api/recruiter';
import { Card, ErrorBanner, Spinner, selectCls } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import type { RecruiterGo } from './RecruiterDashboard';
import { STAGE_LABEL, STAGE_ORDER, fmtDate, useLoad } from './ui';

/**
 * Candidate Pipeline: the twelve stages side by side. A card sits in the stage the candidate's real records put it in (calls, tests, interviews,
 * decision), so there is no drag-and-drop that could claim a step happened when it did not. Opening a card opens the profile, where the step is done.
 */
export const Pipeline: React.FC<{ ctx: RecruiterContext; go: RecruiterGo }> = ({ go }) => {
  const [posting, setPosting] = useState('');
  const opts = useLoad<RecruiterFilterOptions>(() => recruiterApi.filterOptions(), []).data;
  const { data, error, loading, reload } = useLoad<RecruiterPipeline>(() => recruiterApi.pipeline(posting || undefined), [posting]);
  return (
    <div className="space-y-4">
      <PageTitle title="Candidate Pipeline" subtitle="Every candidate by stage. Open a card to work on the candidate." actions={
        <div><label htmlFor="pl-vac" className="sr-only">Vacancy</label><select id="pl-vac" className={selectCls} value={posting} onChange={e => setPosting(e.target.value)}><option value="">All vacancies</option>{opts?.vacancies.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select></div>
      } />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline stages">
          {STAGE_ORDER.map(stage => {
            const col = data.stages[stage];
            return (
              <section key={stage} role="listitem" aria-label={`${STAGE_LABEL[stage]}, ${col?.count ?? 0} candidates`} className="w-64 shrink-0">
                <header className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2">
                  <h2 className="text-xs font-bold text-slate-700">{STAGE_LABEL[stage]}</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">{col?.count ?? 0}</span>
                </header>
                <ul className="mt-2 space-y-2">
                  {(col?.cards ?? []).map(c => (
                    <li key={c.applicationId}>
                      <Card>
                        <button type="button" onClick={() => go('applications', { applicationId: c.applicationId })} className="w-full p-3 text-left rounded-2xl hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
                          <span className="block text-sm font-semibold text-slate-900">{c.name}</span>
                          <span className="block text-[11px] text-slate-500">{c.vacancy}</span>
                          <span className="block text-[11px] text-slate-400 mt-1">Applied {fmtDate(c.appliedAt)}</span>
                        </button>
                      </Card>
                    </li>
                  ))}
                  {(col?.count ?? 0) > (col?.cards.length ?? 0) && <li className="text-center text-[11px] text-slate-500">+ {(col?.count ?? 0) - (col?.cards.length ?? 0)} more — use Candidate Applications to filter by this stage</li>}
                  {(col?.count ?? 0) === 0 && <li className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-400">No candidates</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

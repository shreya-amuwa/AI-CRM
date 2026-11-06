import React, { useState } from 'react';
import type { RecruiterContext, RecruiterFilterOptions, RecruiterPerson, RecruiterVacancy, VacancyStatus } from '../../../shared/contracts';
import { VACANCY_STATUSES } from '../../../shared/validation';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner, selectCls } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import type { RecruiterGo } from './RecruiterDashboard';
import { Empty, VACANCY_LABEL, VacancyPill, useLoad } from './ui';
import { VacancyDetail } from './VacancyDetail';
import { AssignDialog, VacancyForm } from './VacancyDialogs';

const VacancyCard: React.FC<{ v: RecruiterVacancy; onOpen: () => void }> = ({ v, onOpen }) => (
  <Card className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900">{v.title}</h3>
        <p className="text-[11px] text-slate-500">{[v.department, v.designation, v.location].filter(Boolean).join(' · ')}</p>
      </div>
      <VacancyPill status={v.status} />
    </div>
    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div><dt className="text-[10px] text-slate-500">Openings</dt><dd className="text-base font-bold tabular-nums">{v.openings}</dd></div>
      <div><dt className="text-[10px] text-slate-500">Filled</dt><dd className="text-base font-bold tabular-nums text-emerald-700">{v.selected}</dd></div>
      <div><dt className="text-[10px] text-slate-500">Remaining</dt><dd className="text-base font-bold tabular-nums">{v.remaining}</dd></div>
    </dl>
    <p className="mt-3 text-[11px] text-slate-600">{v.applications} application{v.applications === 1 ? '' : 's'} · {v.interviewsScheduled} interview{v.interviewsScheduled === 1 ? '' : 's'} scheduled</p>
    <p className="mt-1 text-[11px] text-slate-500">{v.queue ? <span className="font-semibold text-amber-700">Not allocated to a recruiter yet</span> : <>Responsible: <span className="font-semibold text-slate-700">{v.responsible ?? '–'}</span></>}</p>
    <button type="button" onClick={onOpen} className={`${btn.secondary} mt-3 w-full`}>View vacancy</button>
  </Card>
);

export const Vacancies: React.FC<{ ctx: RecruiterContext; go: RecruiterGo; openId?: string; onChanged: () => void }> = ({ ctx, go, openId, onChanged }) => {
  const [status, setStatus] = useState<VacancyStatus | ''>('');
  const [department, setDepartment] = useState('');
  const list = useLoad<RecruiterVacancy[]>(() => recruiterApi.vacancies(status || undefined, department || undefined), [status, department]);
  const options = useLoad<RecruiterFilterOptions>(() => recruiterApi.filterOptions(), []);
  const departments = options.data?.departments ?? [];
  const [adding, setAdding] = useState(false);
  const filtered = !!(status || department);
  const people = useLoad<RecruiterPerson[]>(() => (ctx.isLeadership ? recruiterApi.directory() : Promise.resolve([])), [ctx.isLeadership]);
  const [allocating, setAllocating] = useState<RecruiterVacancy | null>(null);
  if (openId) return <VacancyDetail id={openId} ctx={ctx} people={people.data ?? []} departments={departments} go={go} onBack={() => go('vacancies')} onChanged={() => { list.reload(); onChanged(); }} />;
  const items = list.data ?? [];
  const queue = items.filter(v => v.queue);
  const mine = items.filter(v => !v.queue);
  return (
    <div className="space-y-5">
      <PageTitle title="Vacancies" subtitle="Create and publish vacancies, and follow the ones allocated to you." actions={
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor="vac-dept" className="sr-only">Department</label><select id="vac-dept" className={selectCls} value={department} onChange={e => setDepartment(e.target.value)} data-testid="vacancy-department-filter"><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label htmlFor="vac-status" className="sr-only">Vacancy status</label><select id="vac-status" className={selectCls} value={status} onChange={e => setStatus(e.target.value as VacancyStatus | '')}><option value="">All statuses</option>{VACANCY_STATUSES.map(s => <option key={s} value={s}>{VACANCY_LABEL[s]}</option>)}</select></div>
          <button type="button" className={btn.primary} onClick={() => setAdding(true)} disabled={!options.data}>+ Add Vacancy</button>
        </div>
      } />
      {options.error && <ErrorBanner message={`The departments could not be loaded: ${options.error}`} onRetry={options.reload} />}
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data ? <Spinner /> : (
        <>
          <section aria-label="Your vacancies" className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">{ctx.isLeadership ? 'Allocated vacancies' : 'Your vacancies'}</h2>
            {mine.length === 0 ? (filtered
              ? <Empty title="No vacancies match these filters" hint="Choose All departments / All statuses to see every vacancy." />
              : <Empty title={ctx.isLeadership ? 'No allocated vacancies yet' : 'You have no vacancies yet'} hint="Use Add Vacancy to create one. Vacancies HR allocates to you also appear here." />) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{mine.map(v => <VacancyCard key={v.id} v={v} onOpen={() => go('vacancies', { vacancyId: v.id })} />)}</div>
            )}
          </section>
          <section aria-label="Unassigned vacancies" className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Waiting for a recruiter ({queue.length})</h2>
            {queue.length === 0 ? <p className="text-xs text-slate-500">Every vacancy has a responsible recruiter.</p> : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{queue.map(v => (
                <div key={v.id} className="space-y-2"><VacancyCard v={v} onOpen={() => go('vacancies', { vacancyId: v.id })} />{ctx.isLeadership && <button type="button" className={`${btn.primary} w-full`} onClick={() => setAllocating(v)}>Allocate to a recruiter</button>}</div>
              ))}</div>
            )}
            {!ctx.isLeadership && queue.length > 0 && <p className="text-[11px] text-slate-500">Only the Super Admin or the HR Department Head can allocate a vacancy. You cannot see the candidates of these vacancies until they are allocated to you.</p>}
          </section>
        </>
      )}
      {adding && <VacancyForm departments={departments} onClose={() => setAdding(false)} onSaved={v => { setAdding(false); list.reload(); options.reload(); onChanged(); go('vacancies', { vacancyId: v.id }); }} />}
      {allocating && <AssignDialog vacancy={allocating} people={people.data ?? []} onClose={() => setAllocating(null)} onDone={() => { setAllocating(null); list.reload(); onChanged(); }} />}
    </div>
  );
};

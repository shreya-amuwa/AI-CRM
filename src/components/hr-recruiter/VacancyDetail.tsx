import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, Eye, Pencil, RefreshCw, Search, UserCog, UserSearch } from 'lucide-react';
import type { RecruiterApplicationPage, RecruiterContext, RecruiterFilterOptions, RecruiterPerson, RecruiterVacancyDetail } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { btn, ErrorBanner, Spinner, inputCls, selectCls } from '../team-member/pipeline/shared';
import type { RecruiterGo } from './RecruiterDashboard';
import { STAGE_LABEL, STAGE_ORDER, STEP_LABEL, StagePill, VacancyPill, fmtDate, useLoad } from './ui';
import { AssignDialog, EMPLOYMENT_LABEL, StatusDialog, VacancyForm, WORK_MODE_LABEL } from './VacancyDialogs';

/*
 * The vacancy detail page of the HR Recruiter, one workspace across the full content width:
 *   toolbar (back, breadcrumb | actions) / overview (title, meta, status, five figures in one row) / three information columns
 *   (Job overview | Candidate requirements | Recruitment information) / the candidates of the vacancy.
 *
 * The layout answers to the width of the page itself, not of the browser window: the root is a CSS container (container-type: inline-size) and
 * every column change is a container query, so the 264px sidebar never makes the page think it has more room than it does.
 *   figures      2 columns, 5 in one row from a 40rem-wide page
 *   information  1 column, 2 from 42rem, 3 from 60rem
 *   candidates   cards, a table from 48rem
 */

const TEST_LABEL: Record<string, string> = { NONE: 'Not invited', PENDING: 'Pending', PASSED: 'Passed', FAILED: 'Failed' };
const INTERVIEW_LABEL: Record<string, string> = { NONE: 'None', SCHEDULED: 'Scheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const TEST_TONE: Record<string, string> = { NONE: 'text-slate-500', PENDING: 'text-amber-700', PASSED: 'text-emerald-700', FAILED: 'text-rose-700' };
const CANDIDATES_PAGE = 10;
const NAVY = 'text-[#0f2547]';

/** Lines of a free-text field as list items: one per line, or the parts of a single line separated by ";" (a leading "-", "*" or "•" is dropped). */
export const toItems = (text: string | null | undefined): string[] => {
  const t = (text ?? '').trim();
  if (!t) return [];
  const lines = t.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  return lines.length > 1 ? lines : t.split(';').map(x => x.replace(/^\s*(?:[-*•])\s*/, '').trim()).filter(Boolean);
};
/** Skills as chips: separated by commas, semicolons or new lines. */
export const toChips = (text: string | null | undefined): string[] =>
  Array.from(new Set((text ?? '').split(/[,;\n]/).map(x => x.replace(/^\s*(?:[-*•])\s*/, '').trim()).filter(Boolean)));

/** One figure of the overview row. */
const Figure: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent = NAVY }) => (
  <div className="min-w-0 bg-white px-4 py-3">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`mt-0.5 whitespace-nowrap text-lg font-bold leading-tight tabular-nums ${accent}`}>{value}</dd>
  </div>
);

/** One information column: a short title, then its sub-sections. */
const Column: React.FC<{ title: string; className?: string; children: React.ReactNode }> = ({ title, className = '', children }) => (
  <section className={`min-w-0 space-y-4 bg-white p-4 sm:p-5 ${className}`} aria-label={title}>
    <h3 className={`text-sm font-bold ${NAVY}`}>{title}</h3>
    {children}
  </section>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</h4>
    <div className="break-words text-sm leading-relaxed text-slate-700">{children}</div>
  </div>
);
const NotSpecified: React.FC = () => <p className="italic text-slate-400">Not specified</p>;
const Bullets: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden="true" /><span>{x}</span></li>)}</ul>
);

/** The candidates of one vacancy: search and filters run in the database (the same query as Candidate Applications, limited to this vacancy). */
const VacancyCandidates: React.FC<{ vacancy: RecruiterVacancyDetail; ctx: RecruiterContext; go: RecruiterGo }> = ({ vacancy, ctx, go }) => {
  const [q, setQ] = useState<RecruiterQuery>({ page: 1, pageSize: CANDIDATES_PAGE });
  const [search, setSearch] = useState('');
  React.useEffect(() => {
    if (search === (q.search ?? '')) return;
    const t = setTimeout(() => setQ(x => ({ ...x, search: search.trim() || undefined, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = vacancy.queue && !ctx.isLeadership;
  const list = useLoad<RecruiterApplicationPage | null>(() => (hidden ? Promise.resolve(null) : recruiterApi.applications({ ...q, posting: vacancy.id })), [JSON.stringify(q), vacancy.id, hidden]);
  const filtered = !!(q.search || q.stage || q.assessment || q.interview);
  const set = (patch: RecruiterQuery) => setQ(x => ({ ...x, ...patch, page: 1 }));
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const open = (id: string) => go('applications', { applicationId: id });
  const sel = `${selectCls} w-full min-w-0 [@container(min-width:48rem)]:w-auto`;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Candidates">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className={`flex items-center gap-2 text-base font-bold ${NAVY}`}>
          Candidates
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 tabular-nums" aria-label={`${vacancy.applications} applications`}>{vacancy.applications}</span>
        </h2>
        {!hidden && vacancy.applications > 0 && (
          <form className="grid w-full grid-cols-2 gap-2 [@container(min-width:48rem)]:flex [@container(min-width:48rem)]:w-auto [@container(min-width:48rem)]:items-center" role="search" aria-label="Filter candidates" onSubmit={e => e.preventDefault()}>
            <div className="relative col-span-2 min-w-0 [@container(min-width:48rem)]:w-60">
              <label htmlFor="vc-search" className="sr-only">Search candidates</label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="vc-search" className={`${inputCls} !pl-8`} placeholder="Search name or e-mail" value={search} onChange={e => setSearch(e.target.value)} maxLength={120} />
            </div>
            <label htmlFor="vc-stage" className="sr-only">Application status</label>
            <select id="vc-stage" className={`${sel} col-span-2 [@container(min-width:48rem)]:col-span-1`} value={q.stage ?? ''} onChange={e => set({ stage: (e.target.value || undefined) as RecruiterQuery['stage'] })}>
              <option value="">All stages</option>{STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
            <label htmlFor="vc-assess" className="sr-only">Assessment status</label>
            <select id="vc-assess" className={sel} value={q.assessment ?? ''} onChange={e => set({ assessment: (e.target.value || undefined) as RecruiterQuery['assessment'] })}>
              <option value="">Any assessment</option>{Object.entries(TEST_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label htmlFor="vc-int" className="sr-only">Interview status</label>
            <select id="vc-int" className={sel} value={q.interview ?? ''} onChange={e => set({ interview: (e.target.value || undefined) as RecruiterQuery['interview'] })}>
              <option value="">Any interview</option>{Object.entries(INTERVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </form>
        )}
      </div>

      {hidden ? (
        <p className="px-5 py-5 text-sm text-slate-500">Candidates of an unallocated vacancy are visible once it is allocated to a recruiter.</p>
      ) : list.error ? (
        <div className="p-4"><ErrorBanner message={list.error} onRetry={list.reload} /></div>
      ) : list.loading && !data ? (
        <div className="p-5"><Spinner /></div>
      ) : !data || data.total === 0 ? (
        filtered ? (
          <div className="px-5 py-6 text-center">
            <p className={`text-sm font-semibold ${NAVY}`}>No candidates match these filters</p>
            <button type="button" className="mt-1.5 text-xs font-semibold text-blue-700 hover:underline" onClick={() => { setSearch(''); setQ({ page: 1, pageSize: CANDIDATES_PAGE }); }}>Clear filters</button>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-6 text-center" data-testid="candidates-empty">
            <UserSearch className="h-6 w-6 text-blue-500" aria-hidden="true" />
            <p className={`mt-2 text-sm font-bold ${NAVY}`}>No Candidates Yet</p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-500">
              No applications have been received for this vacancy yet. Applications will appear here automatically when candidates apply through the Candidate Portal.
            </p>
          </div>
        )
      ) : (
        <>
          {/* a table when the page is at least 48rem wide; compact cards below */}
          <div className="hidden overflow-x-auto [@container(min-width:48rem)]:block">
            <table className="w-full text-xs">
              <caption className="sr-only">Candidates of {vacancy.title}</caption>
              <thead><tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-5 py-2.5">Candidate</th><th scope="col" className="px-3">Email</th><th scope="col" className="px-3">Contact</th><th scope="col" className="px-3">Applied</th>
                <th scope="col" className="px-3">Assessment</th><th scope="col" className="px-3">Interview</th><th scope="col" className="px-3">Stage</th>
                <th scope="col" className="px-5 text-right">Actions</th>
              </tr></thead>
              <tbody>{data.items.map(a => (
                <tr key={a.applicationId} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/30">
                  <th scope="row" className={`px-5 py-3 text-left font-semibold ${NAVY}`}>{a.name}</th>
                  <td className="max-w-[16rem] truncate px-3 text-slate-600" title={a.email}>{a.email}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{a.phone || '–'}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{fmtDate(a.appliedAt)}</td>
                  <td className={`px-3 whitespace-nowrap font-medium ${TEST_TONE[a.testStatus]}`}>{TEST_LABEL[a.testStatus]}{a.testScore !== null && a.testStatus !== 'PENDING' ? ` (${a.testScore})` : ''}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{INTERVIEW_LABEL[a.interviewStatus]}</td>
                  <td className="px-3"><StagePill stage={a.stage} /></td>
                  <td className="px-5 text-right"><button type="button" className={btn.secondary} onClick={() => open(a.applicationId)} aria-label={`View profile of ${a.name}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" /> View</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 [@container(min-width:48rem)]:hidden" aria-label={`Candidates of ${vacancy.title}`}>{data.items.map(a => (
            <li key={a.applicationId}>
              <button type="button" onClick={() => open(a.applicationId)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300">
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${NAVY}`}>{a.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{a.email}{a.phone ? ` · ${a.phone}` : ''}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">Applied {fmtDate(a.appliedAt)} · Test: {TEST_LABEL[a.testStatus]} · Interview: {INTERVIEW_LABEL[a.interviewStatus]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1"><StagePill stage={a.stage} /><ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" /></span>
              </button>
            </li>
          ))}</ul>
          {data.total > data.pageSize && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
              <span>{data.total} candidate{data.total === 1 ? '' : 's'}{filtered ? ' match' : ''}</span>
              <span className="flex items-center gap-2">
                <button type="button" className={btn.secondary} disabled={(q.page ?? 1) <= 1} onClick={() => setQ(x => ({ ...x, page: (x.page ?? 1) - 1 }))}>Previous</button>
                <span aria-live="polite">Page {data.page} of {pages}</span>
                <button type="button" className={btn.secondary} disabled={(q.page ?? 1) >= pages} onClick={() => setQ(x => ({ ...x, page: (x.page ?? 1) + 1 }))}>Next</button>
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export const VacancyDetail: React.FC<{ id: string; ctx: RecruiterContext; people: RecruiterPerson[]; departments: RecruiterFilterOptions['departments']; go: RecruiterGo; onBack: () => void; onChanged: () => void }> = ({ id, ctx, people, departments, go, onBack, onChanged }) => {
  const { data: v, error, loading, reload } = useLoad<RecruiterVacancyDetail>(() => recruiterApi.vacancy(id), [id]);
  const [dialog, setDialog] = useState<'assign' | 'status' | 'edit' | null>(null);
  const back = <button type="button" className={btn.secondary} onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All vacancies</button>;
  if (loading && !v) return <Spinner />;
  if (error || !v) return <div className="space-y-3">{back}<ErrorBanner message={error ?? 'Vacancy not found.'} onRetry={reload} /></div>;
  const done = () => { setDialog(null); reload(); onChanged(); };
  const responsibilities = toItems(v.responsibilities);
  const qualifications = toItems(v.qualifications);
  const skills = toChips(v.skills);
  const employment = EMPLOYMENT_LABEL[v.employmentType as keyof typeof EMPLOYMENT_LABEL] ?? v.employmentType.replace('_', ' ').toLowerCase();
  const workMode = v.workMode ? WORK_MODE_LABEL[v.workMode] : null;
  const designation = v.designation && v.designation.toLowerCase() !== v.title.toLowerCase() ? v.designation : null;
  const vacancyInfo = [
    { label: 'Department', value: v.department },
    { label: 'Designation', value: v.designation },
    { label: 'Location', value: v.location },
    { label: 'Employment type', value: employment },
    { label: 'Work mode', value: workMode },
    { label: 'Job code', value: v.code ?? null },
    { label: 'Responsible recruiter', value: v.queue ? 'Not allocated yet' : v.responsible }
  ].filter(f => f.value);

  return (
    // the page is a container: every column change below follows ITS width (the content area beside the sidebar), not the window's
    <div className="w-full space-y-4 [container-type:inline-size]" data-testid="vacancy-detail">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {back}
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <li>HR Department</li><li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li><button type="button" className="hover:text-blue-700 hover:underline" onClick={onBack}>Recruitment</button></li><li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li aria-current="page" className={`font-semibold ${NAVY}`}>Vacancy Details</li>
            </ol>
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.canManage && <button type="button" className={btn.secondary} onClick={() => setDialog('assign')}><UserCog className="h-3.5 w-3.5" aria-hidden="true" /> {v.queue ? 'Allocate to a recruiter' : 'Change recruiter'}</button>}
          {(v.canManage || v.canAct) && v.version !== undefined && <button type="button" className={btn.secondary} onClick={() => setDialog('edit')}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit vacancy</button>}
          {(v.canManage || v.canAct) && <button type="button" className={btn.primary} onClick={() => setDialog('status')}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Change status</button>}
        </div>
      </div>

      {/* overview: title, meta, status, then the five figures in ONE row (2 columns only on a very narrow page) */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Vacancy overview">
        <div className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className={`break-words text-xl font-bold leading-tight ${NAVY}`}>{v.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {[v.department, designation, employment, workMode].filter(Boolean).map((x, i) => (
                <React.Fragment key={i}>{i > 0 && <span className="text-slate-300" aria-hidden="true">|</span>}<span className={i === 0 ? 'font-semibold text-slate-700' : ''}>{x}</span></React.Fragment>
              ))}
            </p>
          </div>
          <div className="shrink-0"><VacancyPill status={v.status} /></div>
        </div>
        {(v.statusNote || v.status === 'FILLED') && (
          <div className="space-y-2 px-4 pb-3 sm:px-5">
            {v.statusNote && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{v.statusNote}</p>}
            {v.status === 'FILLED' && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">All positions are filled. This vacancy is ready for closure.</p>}
          </div>
        )}
        {/* 1px lines between the figures come from the gap over a light background */}
        <dl className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 [@container(min-width:40rem)]:grid-cols-5" aria-label="Vacancy figures">
          <Figure label="Openings" value={v.openings} />
          <Figure label="Selected" value={v.selected} accent="text-emerald-700" />
          <Figure label="Remaining" value={v.remaining} accent="text-blue-700" />
          <Figure label="Posted" value={fmtDate(v.createdAt)} />
          <div className="col-span-2 grid [@container(min-width:40rem)]:col-span-1"><Figure label="Closes" value={v.closesAt ? fmtDate(v.closesAt) : 'No deadline'} /></div>
        </dl>
      </section>

      {/* three balanced information columns in one bordered block (two on a medium page, the third spanning; one on a narrow page) */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 [@container(min-width:42rem)]:grid-cols-2 [@container(min-width:60rem)]:grid-cols-3" data-testid="vacancy-info">
        <Column title="Job overview">
          <Field label="Job description"><p className="whitespace-pre-wrap">{v.description}</p></Field>
          {responsibilities.length > 0 && <Field label="Responsibilities"><Bullets items={responsibilities} /></Field>}
        </Column>
        <Column title="Candidate requirements">
          <Field label="Qualifications">{qualifications.length > 1 ? <Bullets items={qualifications} /> : qualifications.length ? <p>{qualifications[0]}</p> : <NotSpecified />}</Field>
          <Field label="Skills">
            {skills.length ? <ul className="flex flex-wrap gap-1.5">{skills.map(s => <li key={s} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{s}</li>)}</ul> : <NotSpecified />}
          </Field>
          <Field label="Experience">{v.experience ? <p className="whitespace-pre-wrap">{v.experience}</p> : <NotSpecified />}</Field>
        </Column>
        <Column title="Recruitment information" className="[@container(min-width:42rem)]:col-span-2 [@container(min-width:60rem)]:col-span-1">
          <Field label="Requirements before selection">
            {v.requiredSteps.length ? (
              <ul className="flex flex-wrap gap-1.5">{v.requiredSteps.map(s => <li key={s} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{STEP_LABEL[s].replace(/^a /, '').replace(/^./, c => c.toUpperCase())}</li>)}</ul>
            ) : <p className="text-slate-500">No fixed steps: the recruiter decides.</p>}
          </Field>
          <Field label="Vacancy information">
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
              {vacancyInfo.map(f => <React.Fragment key={f.label}><dt className="text-slate-500">{f.label}</dt><dd className={`min-w-0 break-words font-medium ${NAVY}`}>{f.value}</dd></React.Fragment>)}
            </dl>
          </Field>
        </Column>
      </div>

      <VacancyCandidates vacancy={v} ctx={ctx} go={go} />

      {dialog === 'assign' && <AssignDialog vacancy={v} people={people} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'edit' && <VacancyForm vacancy={v} departments={departments} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === 'status' && <StatusDialog vacancy={v} leadership={ctx.isLeadership} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
};

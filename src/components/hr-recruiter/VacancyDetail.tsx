import React, { useState } from 'react';
import {
  ArrowLeft, Briefcase, CalendarClock, CalendarPlus, ChevronRight, ClipboardList, Eye, FileText, GraduationCap, Hourglass, Info, ListChecks, Pencil,
  RefreshCw, Search, Sparkles, UserCheck, UserCog, UserSearch, Users
} from 'lucide-react';
import type { RecruiterApplicationPage, RecruiterContext, RecruiterFilterOptions, RecruiterPerson, RecruiterVacancyDetail } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner, inputCls, selectCls } from '../team-member/pipeline/shared';
import type { RecruiterGo } from './RecruiterDashboard';
import { STAGE_LABEL, STAGE_ORDER, STEP_LABEL, StagePill, VacancyPill, fmtDate, useLoad } from './ui';
import { AssignDialog, EMPLOYMENT_LABEL, StatusDialog, VacancyForm, WORK_MODE_LABEL } from './VacancyDialogs';

/*
 * The vacancy detail page of the HR Recruiter: a toolbar (back, breadcrumb, actions), the overview with five metric cards, the job information in two
 * columns that only show what the vacancy actually has, and the candidates of the vacancy (searched and filtered by the database, opened as a profile).
 */

const TEST_LABEL: Record<string, string> = { NONE: 'Not invited', PENDING: 'Pending', PASSED: 'Passed', FAILED: 'Failed' };
const INTERVIEW_LABEL: Record<string, string> = { NONE: 'None', SCHEDULED: 'Scheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const TEST_TONE: Record<string, string> = { NONE: 'text-slate-500', PENDING: 'text-amber-700', PASSED: 'text-emerald-700', FAILED: 'text-rose-700' };
const CANDIDATES_PAGE = 10;

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

const Metric: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; tone: string; className?: string }> = ({ icon: Icon, label, value, tone, className = '' }) => (
  <div className={`flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-3 sm:px-3.5 min-w-0 ${className}`}>
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`} aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span>
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="whitespace-nowrap text-base font-bold leading-tight text-slate-900 tabular-nums">{value}</dd>
    </div>
  </div>
);

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <section className="space-y-2">
    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />{title}</h3>
    <div className="text-sm leading-relaxed text-slate-700">{children}</div>
  </section>
);
const NotSpecified: React.FC = () => <p className="text-sm italic text-slate-400">Not specified</p>;
const Bullets: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1.5">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden="true" /><span>{x}</span></li>)}</ul>
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
  const lbl = 'sr-only';
  const open = (id: string) => go('applications', { applicationId: id });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          Candidates
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 tabular-nums" aria-label={`${vacancy.applications} applications`}>{vacancy.applications}</span>
        </h2>
        {!hidden && vacancy.applications > 0 && (
          <form className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:w-auto" role="search" aria-label="Filter candidates" onSubmit={e => e.preventDefault()}>
            <div className="relative col-span-2 min-w-0 sm:flex-1 lg:w-56 lg:flex-none">
              <label htmlFor="vc-search" className={lbl}>Search candidates</label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="vc-search" className={`${inputCls} !pl-8`} placeholder="Search name or e-mail" value={search} onChange={e => setSearch(e.target.value)} maxLength={120} />
            </div>
            <label htmlFor="vc-stage" className={lbl}>Recruitment stage</label>
            <select id="vc-stage" className={`${selectCls} col-span-2 w-full min-w-0 sm:col-span-1 sm:w-auto`} value={q.stage ?? ''} onChange={e => set({ stage: (e.target.value || undefined) as RecruiterQuery['stage'] })}>
              <option value="">All stages</option>{STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
            <label htmlFor="vc-assess" className={lbl}>Assessment status</label>
            <select id="vc-assess" className={`${selectCls} w-full min-w-0 sm:w-auto`} value={q.assessment ?? ''} onChange={e => set({ assessment: (e.target.value || undefined) as RecruiterQuery['assessment'] })}>
              <option value="">Any assessment</option>{Object.entries(TEST_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label htmlFor="vc-int" className={lbl}>Interview status</label>
            <select id="vc-int" className={`${selectCls} w-full min-w-0 sm:w-auto`} value={q.interview ?? ''} onChange={e => set({ interview: (e.target.value || undefined) as RecruiterQuery['interview'] })}>
              <option value="">Any interview</option>{Object.entries(INTERVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </form>
        )}
      </div>

      {hidden ? (
        <p className="px-5 py-6 text-sm text-slate-500">Candidates of an unallocated vacancy are visible once it is allocated to a recruiter.</p>
      ) : list.error ? (
        <div className="p-4"><ErrorBanner message={list.error} onRetry={list.reload} /></div>
      ) : list.loading && !data ? (
        <div className="p-6"><Spinner /></div>
      ) : !data || data.total === 0 ? (
        filtered ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-slate-700">No candidates match these filters</p>
            <button type="button" className="mt-2 text-xs font-semibold text-indigo-700 hover:underline" onClick={() => { setSearch(''); setQ({ page: 1, pageSize: CANDIDATES_PAGE }); }}>Clear filters</button>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-10 text-center" data-testid="candidates-empty">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600" aria-hidden="true"><UserSearch className="h-6 w-6" /></span>
            <p className="mt-3 text-sm font-bold text-slate-900">No Candidates Yet</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
              No applications have been received for this vacancy yet. Candidate applications will appear here automatically when applicants apply through the Candidate Portal.
            </p>
          </div>
        )
      ) : (
        <>
          {/* tablet and desktop: a table; phone: compact cards */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-xs">
              <caption className="sr-only">Candidates of {vacancy.title}</caption>
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-4 py-2.5">Candidate</th><th scope="col" className="hidden px-3 lg:table-cell">Contact</th><th scope="col" className="px-3">Applied</th>
                <th scope="col" className="px-3">Assessment</th><th scope="col" className="px-3">Interview</th><th scope="col" className="px-3">Stage</th>
                <th scope="col" className="px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{data.items.map(a => (
                <tr key={a.applicationId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                  <th scope="row" className="px-4 py-3 text-left font-semibold text-slate-900">{a.name}<span className="block max-w-[220px] truncate text-[11px] font-normal text-slate-500">{a.email}</span>{a.phone && <span className="block text-[11px] font-normal text-slate-500 lg:hidden">{a.phone}</span>}</th>
                  <td className="hidden px-3 whitespace-nowrap text-slate-600 lg:table-cell">{a.phone || '–'}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{fmtDate(a.appliedAt)}</td>
                  <td className={`px-3 whitespace-nowrap font-medium ${TEST_TONE[a.testStatus]}`}>{TEST_LABEL[a.testStatus]}{a.testScore !== null && a.testStatus !== 'PENDING' ? ` (${a.testScore})` : ''}</td>
                  <td className="px-3 whitespace-nowrap text-slate-600">{INTERVIEW_LABEL[a.interviewStatus]}</td>
                  <td className="px-3"><StagePill stage={a.stage} /></td>
                  <td className="px-4 text-right"><button type="button" className={btn.secondary} onClick={() => open(a.applicationId)} aria-label={`View profile of ${a.name}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" /> View</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 md:hidden" aria-label={`Candidates of ${vacancy.title}`}>{data.items.map(a => (
            <li key={a.applicationId}>
              <button type="button" onClick={() => open(a.applicationId)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{a.name}</span>
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
    </Card>
  );
};

export const VacancyDetail: React.FC<{ id: string; ctx: RecruiterContext; people: RecruiterPerson[]; departments: RecruiterFilterOptions['departments']; go: RecruiterGo; onBack: () => void; onChanged: () => void }> = ({ id, ctx, people, departments, go, onBack, onChanged }) => {
  const { data: v, error, loading, reload } = useLoad<RecruiterVacancyDetail>(() => recruiterApi.vacancy(id), [id]);
  const [dialog, setDialog] = useState<'assign' | 'status' | 'edit' | null>(null);
  const back = (
    <button type="button" className={btn.secondary} onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All vacancies</button>
  );
  if (loading && !v) return <Spinner />;
  if (error || !v) return <div className="space-y-3">{back}<ErrorBanner message={error ?? 'Vacancy not found.'} onRetry={reload} /></div>;
  const done = () => { setDialog(null); reload(); onChanged(); };
  const responsibilities = toItems(v.responsibilities);
  const qualifications = toItems(v.qualifications);
  const skills = toChips(v.skills);
  const employment = EMPLOYMENT_LABEL[v.employmentType as keyof typeof EMPLOYMENT_LABEL] ?? v.employmentType.replace('_', ' ').toLowerCase();
  const workMode = v.workMode ? WORK_MODE_LABEL[v.workMode] : null;
  const facts = [
    { label: 'Location', value: v.location },
    { label: 'Employment type', value: employment },
    { label: 'Work mode', value: workMode },
    { label: 'Job code', value: v.code ?? null },
    { label: 'Responsible recruiter', value: v.queue ? 'Not allocated yet' : v.responsible }
  ].filter(f => f.value);

  return (
    <div className="space-y-4">
      {/* toolbar: back + breadcrumb on the left, the actions on the right (they wrap below on a narrow screen) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {back}
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <li>HR Department</li><li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li><button type="button" className="hover:text-indigo-700 hover:underline" onClick={onBack}>Recruitment</button></li><li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li aria-current="page" className="font-semibold text-slate-700">Vacancy Details</li>
            </ol>
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.canManage && <button type="button" className={btn.secondary} onClick={() => setDialog('assign')}><UserCog className="h-3.5 w-3.5" aria-hidden="true" /> {v.queue ? 'Allocate to a recruiter' : 'Change recruiter'}</button>}
          {(v.canManage || v.canAct) && v.version !== undefined && <button type="button" className={btn.secondary} onClick={() => setDialog('edit')}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit vacancy</button>}
          {(v.canManage || v.canAct) && <button type="button" className={btn.primary} onClick={() => setDialog('status')}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Change status</button>}
        </div>
      </div>

      {/* overview */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:flex" aria-hidden="true"><Briefcase className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold leading-tight text-slate-900">{v.title}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {[v.department, v.designation && v.designation.toLowerCase() !== v.title.toLowerCase() ? v.designation : null, employment, workMode].filter(Boolean).map((x, i) => (
                  <React.Fragment key={i}>{i > 0 && <span className="text-slate-300" aria-hidden="true">|</span>}<span className={i === 0 ? 'font-semibold text-slate-700' : ''}>{x}</span></React.Fragment>
                ))}
              </p>
            </div>
          </div>
          <div className="shrink-0"><VacancyPill status={v.status} /></div>
        </div>
        {v.statusNote && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{v.statusNote}</p>}
        {v.status === 'FILLED' && <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">All positions are filled. This vacancy is ready for closure.</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="Vacancy figures">
          <Metric icon={Users} label="Openings" value={v.openings} tone="bg-indigo-50 text-indigo-600" />
          <Metric icon={UserCheck} label="Selected" value={v.selected} tone="bg-emerald-50 text-emerald-600" />
          <Metric icon={Hourglass} label="Remaining" value={v.remaining} tone="bg-amber-50 text-amber-600" />
          <Metric icon={CalendarPlus} label="Posted" value={fmtDate(v.createdAt)} tone="bg-sky-50 text-sky-600" />
          <Metric icon={CalendarClock} label="Closes" value={v.closesAt ? fmtDate(v.closesAt) : 'No deadline'} tone="bg-rose-50 text-rose-600" className="col-span-2 sm:col-span-1" />
        </dl>
      </Card>

      {/* job information: what the vacancy has, in two columns; nothing is drawn for an empty optional field */}
      <div className="grid items-start gap-4 lg:grid-cols-5">
        <Card className="space-y-5 p-4 sm:p-5 lg:col-span-3">
          <Section icon={FileText} title="Job description"><p className="whitespace-pre-wrap break-words">{v.description}</p></Section>
          {responsibilities.length > 0 && <Section icon={ClipboardList} title="Responsibilities"><Bullets items={responsibilities} /></Section>}
          <Section icon={ListChecks} title="Requirements before selection">
            {v.requiredSteps.length ? (
              <ul className="flex flex-wrap gap-2">{v.requiredSteps.map(s => <li key={s} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">{STEP_LABEL[s].replace(/^a /, '').replace(/^./, c => c.toUpperCase())}</li>)}</ul>
            ) : <p className="text-sm text-slate-500">No fixed steps: the recruiter decides.</p>}
          </Section>
        </Card>
        <Card className="space-y-5 p-4 sm:p-5 lg:col-span-2">
          <Section icon={GraduationCap} title="Qualifications">{qualifications.length > 1 ? <Bullets items={qualifications} /> : qualifications.length ? <p className="break-words">{qualifications[0]}</p> : <NotSpecified />}</Section>
          <Section icon={Sparkles} title="Required skills">
            {skills.length ? <ul className="flex flex-wrap gap-1.5">{skills.map(s => <li key={s} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{s}</li>)}</ul> : <NotSpecified />}
          </Section>
          <Section icon={Briefcase} title="Experience">{v.experience ? <p className="whitespace-pre-wrap break-words">{v.experience}</p> : <NotSpecified />}</Section>
          {facts.length > 0 && (
            <Section icon={Info} title="Additional information">
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
                {facts.map(f => <React.Fragment key={f.label}><dt className="text-slate-500">{f.label}</dt><dd className="break-words font-medium text-slate-800">{f.value}</dd></React.Fragment>)}
              </dl>
            </Section>
          )}
        </Card>
      </div>

      <VacancyCandidates vacancy={v} ctx={ctx} go={go} />

      {dialog === 'assign' && <AssignDialog vacancy={v} people={people} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'edit' && <VacancyForm vacancy={v} departments={departments} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === 'status' && <StatusDialog vacancy={v} leadership={ctx.isLeadership} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
};

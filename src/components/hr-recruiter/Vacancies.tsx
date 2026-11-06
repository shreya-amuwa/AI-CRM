import React, { useState } from 'react';
import type { RecruiterContext, RecruiterFilterOptions, RecruiterPerson, RecruiterVacancy, RecruiterVacancyDetail, VacancyStatus } from '../../../shared/contracts';
import { VACANCY_EMPLOYMENT_TYPES, VACANCY_STATUSES, VACANCY_WORK_MODES, recruiterVacancySaveSchema, type RecruiterVacancySaveInput } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner, inputCls, selectCls } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import type { RecruiterGo } from './RecruiterDashboard';
import { Empty, Field, Modal, StagePill, STEP_LABEL, VACANCY_LABEL, VacancyPill, fmtDate, useLoad } from './ui';

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

const AssignDialog: React.FC<{ vacancy: RecruiterVacancy; people: RecruiterPerson[]; onClose: () => void; onDone: () => void }> = ({ vacancy, people, onClose, onDone }) => {
  const [who, setWho] = useState(vacancy.responsibleId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await recruiterApi.assignVacancy(vacancy.id, who || null); onDone(); } catch (e) { setError(errorMessage(e)); setSaving(false); }
  };
  return (
    <Modal title={`Allocate: ${vacancy.title}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Responsible recruiter" hint="The recruiter sees this vacancy and its applications, and is told about it.">
          {id => <select id={id} className={selectCls} value={who} onChange={e => setWho(e.target.value)}><option value="">Unassigned (waiting queue)</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </div>
    </Modal>
  );
};

const StatusDialog: React.FC<{ vacancy: RecruiterVacancyDetail; leadership: boolean; onClose: () => void; onDone: () => void }> = ({ vacancy, leadership, onClose, onDone }) => {
  // the responsible recruiter publishes, holds, closes, marks filled and reopens their own vacancy (never back to a draft); leadership: any
  const allowed: VacancyStatus[] = leadership ? [...VACANCY_STATUSES] : ['OPEN', 'ON_HOLD', 'CLOSED', 'FILLED'];
  const choices = allowed.filter(s => s !== vacancy.status);
  const [status, setStatus] = useState<VacancyStatus | ''>(choices[0] ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!status) return;
    setSaving(true); setError(null);
    try { await recruiterApi.vacancyStatus(vacancy.id, status, note); onDone(); } catch (e) { setError(errorMessage(e)); setSaving(false); }
  };
  return (
    <Modal title={`Vacancy status: ${vacancy.title}`} onClose={onClose}>
      {choices.length === 0 ? <p className="text-sm text-slate-600">There is no other status you can choose for this vacancy.</p> : (
        <div className="space-y-3">
          <Field label="New status">{id => <select id={id} className={selectCls} value={status} onChange={e => setStatus(e.target.value as VacancyStatus)}>{choices.map(s => <option key={s} value={s}>{VACANCY_LABEL[s]}</option>)}</select>}</Field>
          <Field label="Note (optional)">{id => <textarea id={id} className={`${selectCls} min-h-20`} value={note} onChange={e => setNote(e.target.value)} maxLength={500} />}</Field>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} onClick={save} disabled={saving || !status}>{saving ? 'Saving…' : 'Update status'}</button></div>
        </div>
      )}
    </Modal>
  );
};

const EMPLOYMENT_LABEL: Record<(typeof VACANCY_EMPLOYMENT_TYPES)[number], string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERNSHIP: 'Internship', CONTRACT: 'Contract' };
const WORK_MODE_LABEL: Record<(typeof VACANCY_WORK_MODES)[number], string> = { ONSITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote' };
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Create or edit a vacancy. The same schema checks the form here and on the server; the database checks the department, the caller and the version. */
const VacancyForm: React.FC<{ vacancy?: RecruiterVacancyDetail; departments: RecruiterFilterOptions['departments']; onClose: () => void; onSaved: (v: RecruiterVacancy) => void }> = ({ vacancy, departments, onClose, onSaved }) => {
  const editing = !!vacancy;
  const [f, setF] = useState({
    title: vacancy?.designation ?? vacancy?.title ?? '', departmentId: vacancy?.departmentId ?? '', openings: String(vacancy?.openings ?? 1),
    employmentType: (vacancy?.employmentType as RecruiterVacancySaveInput['employmentType']) ?? 'FULL_TIME', workMode: vacancy?.workMode ?? '',
    location: vacancy?.location ?? '', closesAt: vacancy?.closesAt ? new Date(vacancy.closesAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '',
    description: vacancy?.description ?? '', responsibilities: vacancy?.responsibilities ?? '', skills: vacancy?.skills ?? '',
    qualifications: vacancy?.qualifications ?? '', experience: vacancy?.experience ?? ''
  });
  const [saving, setSaving] = useState<'DRAFT' | 'OPEN' | 'EDIT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async (mode: 'DRAFT' | 'OPEN' | 'EDIT') => {
    setError(null);
    const parsed = recruiterVacancySaveSchema.safeParse({
      ...f, workMode: f.workMode || undefined, closesAt: f.closesAt || undefined,
      status: editing ? undefined : mode === 'EDIT' ? undefined : mode, version: vacancy?.version
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the form.'); return; }
    if (!editing && parsed.data.closesAt && parsed.data.closesAt < todayIso()) { setError('The application deadline must be today or later.'); return; }
    setSaving(mode);
    try {
      const saved = editing ? await recruiterApi.updateVacancy(vacancy.id, parsed.data) : await recruiterApi.createVacancy(parsed.data);
      onSaved(saved);
    } catch (e) { setError(errorMessage(e)); setSaving(null); }
  };
  const area = `${inputCls} min-h-20`;
  return (
    <Modal title={editing ? `Edit vacancy: ${vacancy.title}` : 'Add vacancy'} onClose={onClose} wide>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(editing ? 'EDIT' : 'OPEN'); }} aria-label={editing ? 'Edit vacancy' : 'Add vacancy'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title / designation *">{id => <input id={id} className={inputCls} value={f.title} onChange={set('title')} maxLength={120} required placeholder="e.g. Sales Executive" />}</Field>
          <Field label="Department *">{id => (
            <select id={id} className={`${selectCls} w-full`} value={f.departmentId} onChange={set('departmentId')} required>
              <option value="">Choose the department…</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}</Field>
          <Field label="Number of openings *">{id => <input id={id} type="number" min={1} max={500} className={inputCls} value={f.openings} onChange={set('openings')} required />}</Field>
          <Field label="Employment type *">{id => (
            <select id={id} className={`${selectCls} w-full`} value={f.employmentType} onChange={set('employmentType')}>{VACANCY_EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{EMPLOYMENT_LABEL[t]}</option>)}</select>
          )}</Field>
          <Field label="Job location *">{id => <input id={id} className={inputCls} value={f.location} onChange={set('location')} maxLength={200} required placeholder="e.g. Pune office" />}</Field>
          <Field label="Work mode">{id => (
            <select id={id} className={`${selectCls} w-full`} value={f.workMode} onChange={set('workMode')}><option value="">Not specified</option>{VACANCY_WORK_MODES.map(m => <option key={m} value={m}>{WORK_MODE_LABEL[m]}</option>)}</select>
          )}</Field>
          <Field label="Created on" hint="Set automatically when the vacancy is saved.">{id => <input id={id} className={`${inputCls} bg-slate-50`} value={fmtDate(vacancy?.createdAt ?? new Date().toISOString())} readOnly aria-readonly="true" />}</Field>
          <Field label="Application deadline" hint="Applications close at the end of this day (India time). Leave empty for no deadline.">{id => <input id={id} type="date" min={editing ? undefined : todayIso()} className={inputCls} value={f.closesAt} onChange={set('closesAt')} />}</Field>
        </div>
        <Field label="Job description *">{id => <textarea id={id} className={area} value={f.description} onChange={set('description')} maxLength={15000} required placeholder="What the role is about (at least 20 characters)." />}</Field>
        <Field label="Responsibilities">{id => <textarea id={id} className={area} value={f.responsibilities} onChange={set('responsibilities')} maxLength={4000} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Required skills">{id => <textarea id={id} className={area} value={f.skills} onChange={set('skills')} maxLength={4000} />}</Field>
          <Field label="Qualifications">{id => <textarea id={id} className={area} value={f.qualifications} onChange={set('qualifications')} maxLength={4000} />}</Field>
        </div>
        <Field label="Experience required">{id => <input id={id} className={inputCls} value={f.experience} onChange={set('experience')} maxLength={2000} placeholder="e.g. 1-3 years in B2B sales" />}</Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={!!saving}>Cancel</button>
          {editing ? (
            <button type="submit" className={btn.primary} disabled={!!saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          ) : (
            <>
              <button type="button" className={btn.secondary} onClick={() => void save('DRAFT')} disabled={!!saving}>{saving === 'DRAFT' ? 'Saving…' : 'Save as draft'}</button>
              <button type="submit" className={btn.primary} disabled={!!saving}>{saving === 'OPEN' ? 'Publishing…' : 'Publish vacancy'}</button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
};

const VacancyDetail: React.FC<{ id: string; ctx: RecruiterContext; people: RecruiterPerson[]; departments: RecruiterFilterOptions['departments']; go: RecruiterGo; onBack: () => void; onChanged: () => void }> = ({ id, ctx, people, departments, go, onBack, onChanged }) => {
  const { data: v, error, loading, reload } = useLoad<RecruiterVacancyDetail>(() => recruiterApi.vacancy(id), [id]);
  const [dialog, setDialog] = useState<'assign' | 'status' | 'edit' | null>(null);
  if (loading && !v) return <Spinner />;
  if (error || !v) return <div className="space-y-3"><button type="button" className={btn.secondary} onClick={onBack}>Back to vacancies</button><ErrorBanner message={error ?? 'Vacancy not found.'} onRetry={reload} /></div>;
  const done = () => { setDialog(null); reload(); onChanged(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={btn.secondary} onClick={onBack}>← All vacancies</button>
        <div className="flex gap-2">
          {v.canManage && <button type="button" className={btn.secondary} onClick={() => setDialog('assign')}>{v.queue ? 'Allocate to a recruiter' : 'Change recruiter'}</button>}
          {(v.canManage || v.canAct) && v.version !== undefined && <button type="button" className={btn.secondary} onClick={() => setDialog('edit')}>Edit vacancy</button>}
          {(v.canManage || v.canAct) && <button type="button" className={btn.primary} onClick={() => setDialog('status')}>Change status</button>}
        </div>
      </div>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-bold text-slate-900">{v.title}</h2><p className="text-xs text-slate-500">{[v.department, v.designation, v.location, v.employmentType.replace('_', ' ').toLowerCase(), v.workMode ? WORK_MODE_LABEL[v.workMode] : null].filter(Boolean).join(' · ')}</p></div><VacancyPill status={v.status} /></div>
        {v.statusNote && <p className="mt-2 text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">{v.statusNote}</p>}
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div><dt className="text-[11px] text-slate-500">Openings</dt><dd className="font-bold">{v.openings}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Selected</dt><dd className="font-bold text-emerald-700">{v.selected}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Remaining</dt><dd className="font-bold">{v.remaining}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Posted</dt><dd className="font-semibold">{fmtDate(v.createdAt)}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Closes</dt><dd className="font-semibold">{fmtDate(v.closesAt)}</dd></div>
        </dl>
        {v.status === 'FILLED' && <p className="mt-3 text-xs font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">All positions are filled. This vacancy is ready for closure.</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-2 text-sm text-slate-700">
          <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Description</h3><p className="whitespace-pre-wrap">{v.description}</p></div>
          <div className="space-y-3">
            {v.responsibilities && <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Responsibilities</h3><p className="whitespace-pre-wrap">{v.responsibilities}</p></div>}
            {v.qualifications && <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Qualifications</h3><p className="whitespace-pre-wrap">{v.qualifications}</p></div>}
            {v.skills && <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Skills</h3><p className="whitespace-pre-wrap">{v.skills}</p></div>}
            {v.experience && <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Experience</h3><p className="whitespace-pre-wrap">{v.experience}</p></div>}
            <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Required before selection</h3><p>{v.requiredSteps.length ? v.requiredSteps.map(s => STEP_LABEL[s]).join(', ') : 'No fixed steps (the recruiter decides).'}</p></div>
          </div>
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Candidates ({v.candidates.length})</h3>
        {v.queue && !ctx.isLeadership ? <p className="text-xs text-slate-500">Candidates of an unallocated vacancy are visible once it is allocated to a recruiter.</p> : v.candidates.length === 0 ? <Empty title="No applications yet" /> : (
          <ul className="divide-y divide-slate-100">{v.candidates.map(c => (
            <li key={c.applicationId}><button type="button" onClick={() => go('applications', { applicationId: c.applicationId })} className="w-full flex flex-wrap items-center justify-between gap-2 py-2.5 px-2 text-left rounded-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
              <span><span className="block text-sm font-semibold">{c.name}</span><span className="block text-[11px] text-slate-500">Applied {fmtDate(c.appliedAt)}</span></span><StagePill stage={c.stage} /></button></li>
          ))}</ul>
        )}
      </Card>
      {dialog === 'assign' && <AssignDialog vacancy={v} people={people} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'edit' && <VacancyForm vacancy={v} departments={departments} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === 'status' && <StatusDialog vacancy={v} leadership={ctx.isLeadership} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
};

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

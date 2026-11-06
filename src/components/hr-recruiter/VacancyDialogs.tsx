import React, { useState } from 'react';
import type { RecruiterFilterOptions, RecruiterPerson, RecruiterVacancy, RecruiterVacancyDetail, VacancyStatus } from '../../../shared/contracts';
import { VACANCY_EMPLOYMENT_TYPES, VACANCY_STATUSES, VACANCY_WORK_MODES, recruiterVacancySaveSchema, type RecruiterVacancySaveInput } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, ErrorBanner, inputCls, selectCls } from '../team-member/pipeline/shared';
import { Field, Modal, VACANCY_LABEL, fmtDate } from './ui';

/** The vacancy dialogs of the recruiter workspace: allocate to a recruiter, change the status, add / edit a vacancy. */
export const AssignDialog: React.FC<{ vacancy: RecruiterVacancy; people: RecruiterPerson[]; onClose: () => void; onDone: () => void }> = ({ vacancy, people, onClose, onDone }) => {
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

export const StatusDialog: React.FC<{ vacancy: RecruiterVacancyDetail; leadership: boolean; onClose: () => void; onDone: () => void }> = ({ vacancy, leadership, onClose, onDone }) => {
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

export const EMPLOYMENT_LABEL: Record<(typeof VACANCY_EMPLOYMENT_TYPES)[number], string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERNSHIP: 'Internship', CONTRACT: 'Contract' };
export const WORK_MODE_LABEL: Record<(typeof VACANCY_WORK_MODES)[number], string> = { ONSITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote' };
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Create or edit a vacancy. The same schema checks the form here and on the server; the database checks the department, the caller and the version. */
export const VacancyForm: React.FC<{ vacancy?: RecruiterVacancyDetail; departments: RecruiterFilterOptions['departments']; onClose: () => void; onSaved: (v: RecruiterVacancy) => void }> = ({ vacancy, departments, onClose, onSaved }) => {
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


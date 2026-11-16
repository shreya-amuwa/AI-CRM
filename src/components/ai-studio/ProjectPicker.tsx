import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { AiStudioPerson, AiStudioProject } from '../../../shared/contracts';
import { aiStudioProjectSchema } from '../../../shared/validation';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { notifyAiStudioChanged } from './aiStudioEvents';

const ADD = '__add_project__';
const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50';

/**
 * The AI Studio part of the Add Team Member form (Team Lead and Team Member of the AI Studio department only).
 *   - Select Project: the projects come from the database (never a fixed list). Pick one or more; each is kept as a removable chip.
 *   - Add Project (Department Head and Super Admin): opens a small form (name, optional description); the project is saved, then it appears in the list and is selected.
 *   - A new Team Member also gets a Team Lead (when the Department Head or the Super Admin adds them); only that lead's projects are offered.
 * The database checks every choice again before the account is made.
 */
export const ProjectPicker: React.FC<{
  role: 'TEAM_HEAD' | 'TEAM_MEMBER';
  /** Who is adding the person: a Team Lead adds their own Team Members and chooses among their own projects. */
  actorRole: 'SUPER_ADMIN' | 'DEPARTMENT_HEAD' | 'TEAM_HEAD';
  projectIds: string[];
  onProjects: (ids: string[]) => void;
  leadId: string;
  onLead: (id: string) => void;
  teamId?: string;
  inputClass?: string;
}> = ({ role, actorRole, projectIds, onProjects, leadId, onLead, inputClass = field }) => {
  const [projects, setProjects] = useState<AiStudioProject[]>([]);
  const [leads, setLeads] = useState<AiStudioPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const canAdd = actorRole !== 'TEAM_HEAD';
  const needsLead = role === 'TEAM_MEMBER' && actorRole !== 'TEAM_HEAD';

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, people] = await Promise.all([aiStudioApi.projects(), needsLead ? aiStudioApi.people() : Promise.resolve([] as AiStudioPerson[])]);
      setProjects(p);
      setLeads(people.filter(x => x.role === 'TEAM_HEAD' && x.status === 'ACTIVE'));
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [needsLead]);
  useEffect(() => { void load(); }, [load]);

  // a Team Member can only join projects their Team Lead is on; a Team Lead sees only their own projects already
  const offered = useMemo(
    () => projects.filter(p => p.status !== 'ARCHIVED' && !projectIds.includes(p.id) && (!needsLead || (leadId && p.leads.some(l => l.id === leadId)))),
    [projects, projectIds, needsLead, leadId]
  );
  // choosing another Team Lead drops the projects that lead is not on
  useEffect(() => {
    if (!needsLead || projects.length === 0) return;
    const keep = projectIds.filter(id => projects.find(p => p.id === id)?.leads.some(l => l.id === leadId));
    if (keep.length !== projectIds.length) onProjects(keep);
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (value: string) => {
    if (value === ADD) { setAdding(true); return; }
    if (value) onProjects([...projectIds, value]);
  };
  const saveProject = async () => {
    const parsed = aiStudioProjectSchema.safeParse({ name, description });
    if (!parsed.success) { setAddError(parsed.error.issues[0]?.message ?? 'Please check the project.'); return; }
    setSaving(true);
    setAddError('');
    try {
      const created = await aiStudioApi.createProject({ name: parsed.data.name, description: parsed.data.description ?? undefined });
      notifyAiStudioChanged();
      await load();
      // the new project is part of the list now and is selected for this person
      if (role === 'TEAM_HEAD' || !needsLead) onProjects([...projectIds, created.id]);
      setAdding(false);
      setName('');
      setDescription('');
    } catch (err) { setAddError(errorMessage(err)); } finally { setSaving(false); }
  };
  const nameOf = (id: string) => projects.find(p => p.id === id)?.name ?? 'Project';

  return (
    <fieldset className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
      <legend className="px-1 text-xs font-bold text-violet-700">AI Studio</legend>
      {error && <p role="alert" className="text-xs text-rose-700">{error} <button type="button" className="underline font-semibold" onClick={() => void load()}>Retry</button></p>}
      {needsLead && (
        <label className="block text-xs font-semibold text-slate-700">
          Team Lead *
          <select className={`${inputClass} mt-1 cursor-pointer`} value={leadId} onChange={e => onLead(e.target.value)} disabled={loading}>
            <option value="">Select Team Lead…</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
          </select>
          {!loading && leads.length === 0 && <span className="block mt-1 text-[11px] text-amber-700 font-normal">There is no Team Lead yet. Add a Team Lead first.</span>}
        </label>
      )}
      <label className="block text-xs font-semibold text-slate-700">
        Select Project *
        <select className={`${inputClass} mt-1 cursor-pointer`} value="" onChange={e => choose(e.target.value)} disabled={loading || (needsLead && !leadId)}>
          <option value="">{loading ? 'Loading projects…' : needsLead && !leadId ? 'Choose the Team Lead first' : offered.length || canAdd ? 'Select a project…' : 'No more projects to add'}</option>
          {offered.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {canAdd && <option value={ADD}>Add Project</option>}
        </select>
      </label>
      {projectIds.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected projects">
          {projectIds.map(id => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-white border border-violet-200 pl-2.5 pr-1 py-0.5 text-xs font-semibold text-violet-800">
              {nameOf(id)}
              <button type="button" aria-label={`Remove ${nameOf(id)}`} className="p-0.5 rounded-full hover:bg-violet-100" onClick={() => onProjects(projectIds.filter(x => x !== id))}><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {adding && canAdd && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" role="group" aria-label="Add project">
          <label className="block text-xs font-semibold text-slate-700">
            Project Name *
            <input className={`${inputClass} mt-1`} value={name} maxLength={120} onChange={e => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Project Description (optional)
            <textarea className={`${inputClass} mt-1`} rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          {addError && <p role="alert" className="text-xs text-rose-700">{addError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void saveProject()} disabled={saving} className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Project'}</button>
            <button type="button" onClick={() => { setAdding(false); setAddError(''); }} disabled={saving} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        {role === 'TEAM_HEAD' ? 'A Team Lead can work on one or more projects.' : 'A Team Member works on projects their Team Lead is on, and sees only their own projects and tasks.'}
      </p>
    </fieldset>
  );
};

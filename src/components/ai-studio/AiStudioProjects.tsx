import React, { useMemo, useState } from 'react';
import { FolderKanban, Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { AI_STUDIO_PROJECT_STATUSES, type AiStudioPerson, type AiStudioProject, type AiStudioRole } from '../../../shared/contracts';
import { aiStudioProjectSchema } from '../../../shared/validation';
import { isoToIstInput, istInputToIso } from '../../lib/aiStudioDeadline';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { Dialog, ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead, Tabs, fieldCls, ghostBtn, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { AssignTaskButton, AssignTaskDialog, TaskList } from './AiStudioTasks';
import { DeadlineChip } from './DeadlineClock';
import { notifyAiStudioChanged, useAiStudioChanged } from './aiStudioEvents';
import { PROJECT_STATUS_LABELS, ProgressBar, ProjectStatusBadge, useLoad } from './ui';

/** The projects the person works on, as cards: the people on each and how many tasks are done. */
export const ProjectCards: React.FC<{ projects: AiStudioProject[] }> = ({ projects }) => (
  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
    {projects.map(p => (
      <Card key={p.id} className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0"><FolderKanban className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" /><h3 className="font-extrabold text-slate-900 truncate">{p.name}</h3></div>
          <ProjectStatusBadge status={p.status} />
        </div>
        {p.description && <p className="mt-2 text-sm text-slate-600 line-clamp-2">{p.description}</p>}
        {p.deadlineAt && <div className="mt-3"><DeadlineChip deadlineAt={p.deadlineAt} status={p.status} /></div>}
        <div className="mt-3"><ProgressBar value={p.tasks.progress} label={`${p.name}: ${p.tasks.progress}% complete`} /></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>{p.tasks.total} tasks</span><span>{p.tasks.ongoing} in progress</span><span>{p.tasks.completed} completed</span>
          {p.leads.length > 0 && <span>Lead: {p.leads.map(l => l.name).join(', ')}</span>}
        </div>
      </Card>
    ))}
  </div>
);

type ProjectTab = 'assigned' | 'ongoing' | 'team';

/**
 * Team Member / Team Lead "Projects": the projects they were given and two branches of their own work, Assigned Tasks and Ongoing Tasks.
 * A Team Lead also sees the tasks of their team and gives tasks to their Team Members.
 */
export const MemberProjects: React.FC<{ role: 'LEAD' | 'MEMBER' }> = ({ role }) => {
  const [tab, setTab] = useState<ProjectTab>('assigned');
  const [assigning, setAssigning] = useState(false);
  const [version, setVersion] = useState(0);
  const projects = useLoad<AiStudioProject[]>(() => aiStudioApi.projects(), [version]);
  const people = useLoad<AiStudioPerson[]>(() => (role === 'LEAD' ? aiStudioApi.people() : Promise.resolve([])), [role, version]);
  useAiStudioChanged(projects.reload);
  const list = projects.data ?? [];
  const tabs: { id: ProjectTab; label: string }[] = [{ id: 'assigned', label: 'Assigned Tasks' }, { id: 'ongoing', label: 'Ongoing Tasks' }, ...(role === 'LEAD' ? [{ id: 'team' as const, label: 'Team Tasks' }] : [])];
  return (
    <div className="space-y-6">
      <PageTitle
        title="Projects"
        subtitle={role === 'LEAD' ? 'Your projects, your own tasks and the tasks of your team.' : 'The projects you work on and the tasks assigned to you.'}
        actions={role === 'LEAD' ? <AssignTaskButton onClick={() => setAssigning(true)} /> : undefined}
      />
      {projects.error && <ErrorBanner message={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data && <Spinner label="Loading your projects…" />}
      {projects.data && (list.length === 0
        ? <Card className="p-8 text-center text-sm text-slate-500">You are not on a project yet. Your {role === 'LEAD' ? 'Department Head' : 'Team Lead'} adds you to one.</Card>
        : <ProjectCards projects={list} />)}
      <Tabs<ProjectTab> label="Project work" value={tab} options={tabs} onChange={setTab} />
      {tab === 'assigned' && <TaskList scope="mine" projects={list} emptyText="No task has been assigned to you yet." />}
      {tab === 'ongoing' && <TaskList scope="ongoing" projects={list} emptyText="You have no ongoing task. Start one from Assigned Tasks." />}
      {tab === 'team' && <TaskList scope="team" projects={list} emptyText="Your team has no task yet. Assign one to a Team Member." />}
      {assigning && <AssignTaskDialog role="LEAD" projects={list} people={people.data ?? []} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); setVersion(v => v + 1); }} />}
    </div>
  );
};

/** Add or edit a project (Department Head / Super Admin). */
export const ProjectDialog: React.FC<{ project?: AiStudioProject; onClose: () => void; onSaved: (p: { id: string; name: string }) => void }> = ({ project, onClose, onSaved }) => {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<string>(project?.status ?? 'ACTIVE');
  // a date and time in Indian time (the deadline of the project); empty = no deadline
  const initialDeadline = isoToIstInput(project?.deadlineAt);
  const [deadline, setDeadline] = useState(initialDeadline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // left alone when it was not touched (the project can still be renamed after its deadline has passed); cleared when emptied
    const deadlineAt = deadline === initialDeadline ? undefined : deadline ? istInputToIso(deadline) : null;
    if (deadline && deadlineAt === null) { setError('Enter the deadline as a date and time.'); return; }
    const parsed = aiStudioProjectSchema.safeParse({ name, description, status: project ? status : undefined, deadlineAt });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { name: parsed.data.name, description: parsed.data.description ?? undefined, status: parsed.data.status, deadlineAt: parsed.data.deadlineAt };
      const saved = project ? await aiStudioApi.updateProject(project.id, body) : await aiStudioApi.createProject(body);
      notifyAiStudioChanged();
      onSaved(saved);
    } catch (err) { setError(errorMessage(err)); setSaving(false); }
  };
  return (
    <Dialog title={project ? 'Edit project' : 'Add project'} onClose={onClose} persistent={saving}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Project name" htmlFor="ai-pr-name" required><input id="ai-pr-name" className={fieldCls} value={name} maxLength={120} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Description (optional)" htmlFor="ai-pr-desc"><textarea id="ai-pr-desc" className={textareaCls} rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        <Field label="Deadline (optional, Indian time)" htmlFor="ai-pr-deadline">
          <div className="flex gap-2">
            <input id="ai-pr-deadline" type="datetime-local" className={fieldCls} value={deadline} onChange={e => setDeadline(e.target.value)} />
            {deadline && <button type="button" className={ghostBtn} onClick={() => setDeadline('')} aria-label="Remove the deadline">Clear</button>}
          </div>
          <p className="mt-1 text-xs text-slate-500">The Team Leads and Team Members on the project see a clock counting down to this time, and are told when it is set or changed.</p>
        </Field>
        {project && (
          <Field label="Status" htmlFor="ai-pr-status">
            <select id="ai-pr-status" className={fieldCls} value={status} onChange={e => setStatus(e.target.value)}>
              {AI_STUDIO_PROJECT_STATUSES.map(s => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save project'}</button>
        </div>
      </form>
    </Dialog>
  );
};

/** Who is on a project: add or remove Team Leads and Team Members (the database keeps the order: a Team Member only joins a project their Team Lead is on). */
const PeopleDialog: React.FC<{ project: AiStudioProject; people: AiStudioPerson[]; onClose: () => void; onChanged: () => void }> = ({ project, people, onClose, onChanged }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const active = people.filter(p => p.status === 'ACTIVE' && p.role !== 'DEPARTMENT_HEAD');
  const act = async (p: AiStudioPerson, assign: boolean) => {
    setBusy(p.id);
    setError('');
    try { await aiStudioApi.assignProject(project.id, p.id, assign); notifyAiStudioChanged(); onChanged(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  };
  const on = (p: AiStudioPerson) => p.projects.some(x => x.id === project.id);
  const section = (title: string, role: AiStudioPerson['role']) => (
    <div>
      <h3 className="text-sm font-extrabold text-slate-900 mb-2">{title}</h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {active.filter(p => p.role === role).map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0"><div className="text-sm font-semibold text-slate-900 truncate">{p.fullName}</div>{p.leadName && <div className="text-xs text-slate-500">Team Lead: {p.leadName}</div>}</div>
            {on(p)
              ? <button type="button" className={ghostBtn} disabled={busy === p.id} onClick={() => act(p, false)}><UserMinus className="w-4 h-4" aria-hidden="true" /> Remove</button>
              : <button type="button" className={primaryBtn} disabled={busy === p.id} onClick={() => act(p, true)}><UserPlus className="w-4 h-4" aria-hidden="true" /> Add</button>}
          </li>
        ))}
        {active.filter(p => p.role === role).length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Nobody yet.</li>}
      </ul>
    </div>
  );
  return (
    <Dialog title={`People on ${project.name}`} description="A Team Member can join a project only after their Team Lead is on it." onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {section('Team Leads', 'TEAM_HEAD')}
        {section('Team Members', 'TEAM_MEMBER')}
        <div className="flex justify-end"><button type="button" className={ghostBtn} onClick={onClose}>Done</button></div>
      </div>
    </Dialog>
  );
};

/** Department Head / Super Admin: every project with its progress and people; add, edit, assign Team Leads and Team Members, assign a task. */
export const ProjectManagement: React.FC<{ role: AiStudioRole }> = ({ role }) => {
  const [version, setVersion] = useState(0);
  const projects = useLoad<AiStudioProject[]>(() => aiStudioApi.projects(), [version]);
  const people = useLoad<AiStudioPerson[]>(() => aiStudioApi.people(), [version]);
  const [editing, setEditing] = useState<AiStudioProject | 'new' | null>(null);
  const [peopleFor, setPeopleFor] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [openProject, setOpenProject] = useState('');
  const refresh = () => setVersion(v => v + 1);
  useAiStudioChanged(() => { projects.reload(); people.reload(); });
  const list = projects.data ?? [];
  const peopleProject = useMemo(() => list.find(p => p.id === peopleFor) ?? null, [list, peopleFor]);
  return (
    <div className="space-y-6">
      <PageTitle
        title="Project Management"
        subtitle="Every AI Studio project: add projects, change their details, put Team Leads and Team Members on them and follow their progress."
        actions={
          <>
            <button type="button" className={ghostBtn} onClick={() => setAssigning(true)}>Assign task</button>
            <button type="button" className={primaryBtn} onClick={() => setEditing('new')}><Plus className="w-4 h-4" aria-hidden="true" /> Add project</button>
          </>
        }
      />
      {projects.error && <ErrorBanner message={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data && <Spinner label="Loading projects…" />}
      {projects.data && list.length === 0 && <Card className="p-8 text-center text-sm text-slate-500">No project yet. Add the first one.</Card>}
      <div className="grid lg:grid-cols-2 gap-4">
        {list.map(p => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-extrabold text-slate-900 truncate">{p.name}</h3>
                {p.description && <p className="text-sm text-slate-600 mt-1 line-clamp-2">{p.description}</p>}
              </div>
              <ProjectStatusBadge status={p.status} />
            </div>
            <div className="mt-3">{p.deadlineAt ? <DeadlineChip deadlineAt={p.deadlineAt} status={p.status} /> : <span className="text-xs text-slate-500">No deadline set</span>}</div>
            <div className="mt-3"><ProgressBar value={p.tasks.progress} label={`${p.name}: ${p.tasks.progress}% complete`} /></div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div><dt className="text-slate-500">Tasks</dt><dd className="font-bold text-slate-900">{p.tasks.total}</dd></div>
              <div><dt className="text-slate-500">In progress</dt><dd className="font-bold text-slate-900">{p.tasks.ongoing}</dd></div>
              <div><dt className="text-slate-500">Completed</dt><dd className="font-bold text-slate-900">{p.tasks.completed}</dd></div>
              <div><dt className="text-slate-500">Team Members</dt><dd className="font-bold text-slate-900">{p.memberCount}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-600">Team Leads: {p.leads.length ? p.leads.map(l => l.name).join(', ') : 'none yet'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={ghostBtn} onClick={() => setPeopleFor(p.id)}><UserPlus className="w-4 h-4" aria-hidden="true" /> People</button>
              <button type="button" className={ghostBtn} onClick={() => setEditing(p)}><Pencil className="w-4 h-4" aria-hidden="true" /> Edit</button>
              <button type="button" className={ghostBtn} onClick={() => setOpenProject(openProject === p.id ? '' : p.id)}>{openProject === p.id ? 'Hide tasks' : 'View tasks'}</button>
            </div>
          </Card>
        ))}
      </div>
      {openProject && (
        <div className="space-y-2">
          <CardHead title={`Tasks · ${list.find(p => p.id === openProject)?.name ?? ''}`} />
          <TaskList key={openProject} scope="team" projects={list.filter(p => p.id === openProject)} emptyText="No task in this project yet." />
        </div>
      )}
      {editing && <ProjectDialog project={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {peopleProject && <PeopleDialog project={peopleProject} people={people.data ?? []} onClose={() => setPeopleFor(null)} onChanged={refresh} />}
      {assigning && <AssignTaskDialog role={role === 'LEAD' ? 'LEAD' : 'HEAD'} projects={list} people={people.data ?? []} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); refresh(); }} />}
    </div>
  );
};

/** Department Head / Super Admin: every task of the department (filter by project and status) and a way to assign a new one. */
export const DepartmentTasks: React.FC<{ role: AiStudioRole }> = ({ role }) => {
  const [version, setVersion] = useState(0);
  const projects = useLoad<AiStudioProject[]>(() => aiStudioApi.projects(), [version]);
  const people = useLoad<AiStudioPerson[]>(() => aiStudioApi.people(), [version]);
  const [assigning, setAssigning] = useState(false);
  return (
    <div className="space-y-6">
      <PageTitle title="Tasks" subtitle="Every task of AI Studio: who has it, its deadline and how far it is." actions={<AssignTaskButton onClick={() => setAssigning(true)} />} />
      {projects.error && <ErrorBanner message={projects.error} onRetry={projects.reload} />}
      <TaskList key={version} scope="team" projects={projects.data ?? []} emptyText="No task has been assigned yet." />
      {assigning && <AssignTaskDialog role={role === 'LEAD' ? 'LEAD' : 'HEAD'} projects={projects.data ?? []} people={people.data ?? []} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); setVersion(v => v + 1); }} />}
    </div>
  );
};

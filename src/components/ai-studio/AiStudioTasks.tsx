import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import {
  AI_STUDIO_PRIORITIES,
  type AiStudioPerson,
  type AiStudioProject,
  type AiStudioRole,
  type AiStudioTask,
  type AiStudioTaskDetail,
  type AiStudioTaskPage
} from '../../../shared/contracts';
import { aiStudioTaskCreateSchema, aiStudioTaskEditSchema, aiStudioTaskUpdateSchema } from '../../../shared/validation';
import { aiStudioApi, type AiStudioTasksFilter } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { Dialog, ErrorBanner, Field, Pager, Spinner } from '../team-member/pipeline/shared';
import { Card, ghostBtn, fieldCls, primaryBtn, textareaCls } from '../tasks/head/headParts';
import { notifyAiStudioChanged, usePendingAiStudio, useAiStudioChanged } from './aiStudioEvents';
import { PRIORITY_LABELS, PriorityBadge, ProgressBar, TASK_STATUS_LABELS, TableWrap, TaskStatusBadge, dateText, dateTimeText, tdCls, thCls, todayIso, useLoad } from './ui';

const linkLines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean);

/** The people a task can go to, for the picker: those on the chosen project (a Team Lead: their own Team Members only). */
export function assignablePeople(people: AiStudioPerson[], projectId: string, role: AiStudioRole): AiStudioPerson[] {
  return people.filter(p => p.status === 'ACTIVE' && p.projects.some(x => x.id === projectId) && (role === 'LEAD' ? p.role === 'TEAM_MEMBER' : p.role !== 'DEPARTMENT_HEAD'));
}

/** One task in full: its details, the progress history, and (when the database says so) the forms to update it or change it. */
export const TaskDialog: React.FC<{ id: string; onClose: () => void; onChanged?: () => void }> = ({ id, onClose, onChanged }) => {
  const { data: task, error, reload } = useLoad<AiStudioTaskDetail>(() => aiStudioApi.task(id), [id]);
  const [mode, setMode] = useState<'view' | 'update' | 'edit'>('view');
  const changed = () => { notifyAiStudioChanged(); onChanged?.(); reload(); setMode('view'); };
  return (
    <Dialog title={task?.title ?? 'Task'} description={task ? `${task.projectName} · assigned to ${task.assigneeName}` : undefined} onClose={onClose} wide>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!task && !error && <Spinner label="Loading the task…" />}
      {task && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <Info label="Status"><TaskStatusBadge status={task.status} /></Info>
            <Info label="Priority"><PriorityBadge priority={task.priority} /></Info>
            <Info label="Assigned on">{dateText(task.assignedAt)} {task.assignedByName ? `by ${task.assignedByName}` : ''}</Info>
            <Info label="Deadline"><span className={task.overdue ? 'text-rose-700 font-bold' : ''}>{dateText(task.dueDate)}{task.overdue ? ' · overdue' : ''}</span></Info>
          </div>
          <div><div className="text-xs font-semibold text-slate-500 mb-1">Progress</div><ProgressBar value={task.progress} /></div>
          {task.description && <div><div className="text-xs font-semibold text-slate-500 mb-1">Description</div><p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description}</p></div>}
          {task.completionNote && <div><div className="text-xs font-semibold text-slate-500 mb-1">Completion details</div><p className="text-sm text-slate-700 whitespace-pre-wrap">{task.completionNote}</p></div>}
          {task.attachments.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">Attachments</div>
              <ul className="space-y-1">
                {task.attachments.map(a => <li key={a}><a href={a} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">{a}</a></li>)}
              </ul>
            </div>
          )}
          {mode === 'view' && (task.canUpdate || task.canEdit) && (
            <div className="flex flex-wrap gap-2">
              {task.canUpdate && <button type="button" className={primaryBtn} onClick={() => setMode('update')}>Update progress</button>}
              {task.canEdit && <button type="button" className={ghostBtn} onClick={() => setMode('edit')}>Edit task / deadline</button>}
            </div>
          )}
          {mode === 'update' && <UpdateForm task={task} onCancel={() => setMode('view')} onDone={changed} />}
          {mode === 'edit' && <EditForm task={task} onCancel={() => setMode('view')} onDone={changed} />}
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 mb-2">History</h3>
            <ol className="space-y-2">
              {task.history.map(h => (
                <li key={h.id} className="text-sm border-l-2 border-slate-200 pl-3">
                  <div className="font-semibold text-slate-800">
                    {h.kind === 'ASSIGNED' ? 'Assigned' : h.kind === 'EDITED' ? 'Task changed' : `${TASK_STATUS_LABELS[h.status]} · ${h.progress}%`}
                    <span className="font-normal text-slate-500"> · {h.authorName ?? 'Someone'} · {dateTimeText(h.createdAt)}</span>
                  </div>
                  {h.note && <p className="text-slate-600 whitespace-pre-wrap">{h.note}</p>}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex justify-end"><button type="button" className={ghostBtn} onClick={onClose}>Close</button></div>
        </div>
      )}
    </Dialog>
  );
};

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><div className="text-xs font-semibold text-slate-500 mb-1">{label}</div><div className="text-slate-800">{children}</div></div>
);

const UpdateForm: React.FC<{ task: AiStudioTaskDetail; onCancel: () => void; onDone: () => void }> = ({ task, onCancel, onDone }) => {
  const [status, setStatus] = useState<'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED'>(task.status === 'ON_HOLD' ? 'ON_HOLD' : 'IN_PROGRESS');
  const [progress, setProgress] = useState(Math.min(task.progress, 99));
  const [note, setNote] = useState('');
  const [links, setLinks] = useState(task.attachments.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = aiStudioTaskUpdateSchema.safeParse({ status, progress: status === 'COMPLETED' ? 100 : progress, note, attachments: linkLines(links) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    setSaving(true);
    setError('');
    try {
      await aiStudioApi.updateTask(task.id, { status: parsed.data.status, progress: parsed.data.progress, note: parsed.data.note ?? undefined, attachments: parsed.data.attachments });
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 p-4 space-y-3" aria-label="Update progress">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Status" htmlFor="ai-up-status" required>
          <select id="ai-up-status" className={fieldCls} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            <option value="IN_PROGRESS">In progress</option>
            <option value="ON_HOLD">On hold</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </Field>
        <Field label={status === 'COMPLETED' ? 'Progress (100% on completion)' : `Progress: ${progress}%`} htmlFor="ai-up-progress">
          <input id="ai-up-progress" type="range" min={0} max={status === 'COMPLETED' ? 100 : 99} step={5} value={status === 'COMPLETED' ? 100 : progress} disabled={status === 'COMPLETED'}
            onChange={e => setProgress(Number(e.target.value))} className="w-full h-11" />
        </Field>
      </div>
      <Field label={status === 'COMPLETED' ? 'Completion details' : status === 'ON_HOLD' ? 'Why is it on hold?' : 'Latest update (optional)'} htmlFor="ai-up-note" required={status !== 'IN_PROGRESS'}>
        <textarea id="ai-up-note" className={textareaCls} rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      <Field label="Attachment links (one per line, up to 5)" htmlFor="ai-up-links">
        <textarea id="ai-up-links" className={textareaCls} rows={2} placeholder="https://..." value={links} onChange={e => setLinks(e.target.value)} />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryBtn} disabled={saving}>{saving ? 'Saving…' : status === 'COMPLETED' ? 'Submit completion' : 'Save update'}</button>
        <button type="button" className={ghostBtn} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
};

const EditForm: React.FC<{ task: AiStudioTaskDetail; onCancel: () => void; onDone: () => void }> = ({ task, onCancel, onDone }) => {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<string>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = aiStudioTaskEditSchema.safeParse({ title, description, priority, dueDate });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    setSaving(true);
    setError('');
    try {
      await aiStudioApi.editTask(task.id, { title: parsed.data.title, description: parsed.data.description ?? undefined, priority: parsed.data.priority, dueDate: parsed.data.dueDate ?? undefined });
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 p-4 space-y-3" aria-label="Edit task">
      <Field label="Title" htmlFor="ai-ed-title" required><input id="ai-ed-title" className={fieldCls} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Description" htmlFor="ai-ed-desc"><textarea id="ai-ed-desc" className={textareaCls} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="ai-ed-priority">
          <select id="ai-ed-priority" className={fieldCls} value={priority} onChange={e => setPriority(e.target.value)}>
            {AI_STUDIO_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </Field>
        <Field label="Deadline" htmlFor="ai-ed-due"><input id="ai-ed-due" type="date" className={fieldCls} min={todayIso()} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={ghostBtn} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
};

/** Give a task to a person on a project. A Team Lead sees their own Team Members; the Department Head sees everybody on the project. */
export const AssignTaskDialog: React.FC<{ role: AiStudioRole; projects: AiStudioProject[]; people: AiStudioPerson[]; onClose: () => void; onDone: () => void }> = ({ role, projects, people, onClose, onDone }) => {
  const usable = projects.filter(p => p.status === 'ACTIVE' && (role !== 'LEAD' || p.mine));
  const [projectId, setProjectId] = useState(usable[0]?.id ?? '');
  const choices = useMemo(() => assignablePeople(people, projectId, role), [people, projectId, role]);
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [links, setLinks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!choices.some(c => c.id === assigneeId)) setAssigneeId(choices[0]?.id ?? ''); }, [choices, assigneeId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = aiStudioTaskCreateSchema.safeParse({ projectId, assigneeId, title, description, priority, dueDate, attachments: linkLines(links) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form.'); return; }
    setSaving(true);
    setError('');
    try {
      await aiStudioApi.assignTask({ projectId, assigneeId, title: parsed.data.title, description: parsed.data.description ?? undefined, priority: parsed.data.priority, dueDate: parsed.data.dueDate ?? undefined, attachments: parsed.data.attachments });
      notifyAiStudioChanged();
      onDone();
    } catch (err) { setError(errorMessage(err)); setSaving(false); }
  };
  return (
    <Dialog title="Assign a task" description="The person is notified at once." onClose={onClose} persistent={saving}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Project" htmlFor="ai-as-project" required>
          <select id="ai-as-project" className={fieldCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
            {usable.length === 0 && <option value="">No active project</option>}
            {usable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={role === 'LEAD' ? 'Team Member' : 'Assign to'} htmlFor="ai-as-who" required>
          <select id="ai-as-who" className={fieldCls} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            {choices.length === 0 && <option value="">Nobody on this project yet</option>}
            {choices.map(c => <option key={c.id} value={c.id}>{c.fullName}{c.role === 'TEAM_HEAD' ? ' (Team Lead)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Task title" htmlFor="ai-as-title" required><input id="ai-as-title" className={fieldCls} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label="Description" htmlFor="ai-as-desc"><textarea id="ai-as-desc" className={textareaCls} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="ai-as-priority">
            <select id="ai-as-priority" className={fieldCls} value={priority} onChange={e => setPriority(e.target.value)}>
              {AI_STUDIO_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </Field>
          <Field label="Deadline" htmlFor="ai-as-due"><input id="ai-as-due" type="date" className={fieldCls} min={todayIso()} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
        </div>
        <Field label="Reference links (one per line, optional)" htmlFor="ai-as-links"><textarea id="ai-as-links" className={textareaCls} rows={2} placeholder="https://..." value={links} onChange={e => setLinks(e.target.value)} /></Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={saving || !projectId || !assigneeId}>{saving ? 'Assigning…' : 'Assign task'}</button>
        </div>
      </form>
    </Dialog>
  );
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Not completed' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' }
];

/**
 * A page of tasks: 'mine' (Assigned Tasks), 'ongoing' (started, not completed) or 'team' (a Team Lead's team, the Department Head's department).
 * Filtered and paged by the database. A notification can open one task straight away.
 */
export const TaskList: React.FC<{ scope: AiStudioTasksFilter['scope']; projects: AiStudioProject[]; emptyText: string }> = ({ scope, projects, emptyText }) => {
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pendingTask = usePendingAiStudio('task');
  const [openId, setOpenId] = useState<string | null>(pendingTask);
  const { data, error, loading, reload } = useLoad<AiStudioTaskPage>(
    () => aiStudioApi.tasks({ scope, projectId: projectId || undefined, status: status || undefined, page, pageSize: 10 }),
    [scope, projectId, status, page]
  );
  useAiStudioChanged(reload);
  const team = scope === 'team';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
        <select aria-label="Filter by project" className={`${fieldCls} !w-auto min-w-[10rem]`} value={projectId} onChange={e => { setProjectId(e.target.value); setPage(1); }}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {scope !== 'ongoing' && (
          <select aria-label="Filter by status" className={`${fieldCls} !w-auto min-w-[10rem]`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </div>
      {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
      {loading && !data && <Spinner label="Loading tasks…" />}
      {data && data.items.length === 0 && !error && <p className="py-12 px-6 text-center text-sm text-slate-500">{emptyText}</p>}
      {data && data.items.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[56rem]">
            <thead className="border-b border-slate-100">
              <tr>
                <th className={thCls}>Task</th><th className={thCls}>Project</th>{team && <th className={thCls}>Assigned to</th>}
                <th className={thCls}>Assigned</th><th className={thCls}>Deadline</th><th className={thCls}>Priority</th><th className={thCls}>Status</th><th className={thCls}>Progress</th><th className={thCls}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((t: AiStudioTask) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className={`${tdCls} max-w-[22rem]`}>
                    <button type="button" onClick={() => setOpenId(t.id)} className="text-left font-bold text-slate-900 hover:text-blue-700">{t.title}</button>
                    {t.description && <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>}
                    {t.lastUpdateNote && <p className="text-xs text-slate-500 mt-0.5">Latest: {t.lastUpdateNote}</p>}
                  </td>
                  <td className={tdCls}>{t.projectName}</td>
                  {team && <td className={tdCls}>{t.assigneeName}</td>}
                  <td className={tdCls}>{dateText(t.assignedAt)}</td>
                  <td className={tdCls}>
                    <span className={t.overdue ? 'text-rose-700 font-bold inline-flex items-center gap-1' : ''}>{t.overdue && <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}{dateText(t.dueDate)}</span>
                  </td>
                  <td className={tdCls}><PriorityBadge priority={t.priority} /></td>
                  <td className={tdCls}><TaskStatusBadge status={t.status} /></td>
                  <td className={tdCls}><ProgressBar value={t.progress} /></td>
                  <td className={tdCls}><button type="button" onClick={() => setOpenId(t.id)} className="text-blue-600 hover:underline text-xs font-bold">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {data && data.total > data.pageSize && <div className="p-4 border-t border-slate-100"><Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="tasks" onPage={setPage} /></div>}
      {openId && <TaskDialog id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </Card>
  );
};

export const AssignTaskButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" className={primaryBtn} onClick={onClick}><Plus className="w-4 h-4" aria-hidden="true" /> Assign task</button>
);

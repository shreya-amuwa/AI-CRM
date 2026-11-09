import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { localDateKey, workTasksApi, type OperationsAssignee, type TaskNode, type TaskPriority, type WorkTask, type WorkTaskData } from '../../../lib/workTasks';
import { EmptyState, fmtDate, fmtDateTime, PriorityPill, ProgressBar, StatusPill, UpdateForm, nameOf } from '../TaskParts';
import { Card, CardHead, fieldCls, LoadingLine, primaryBtn, textareaCls } from './headParts';

const FN: Record<string, string> = { SALES: 'Sales', SUPPORT: 'Support', ALL: 'Whole department' };
const ROLE: Record<string, string> = { OPERATIONS_HEAD: 'Operations Head', DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

/**
 * One task and everything below it: Operations Head -> Department Head -> Team Lead -> Team Member. Each level shows the actual assignee, who
 * delegated it, the instructions, the dates, the progress, the status and the latest update. Read from task_hierarchy (nothing is computed here).
 */
export const TaskTreeNode: React.FC<{ node: TaskNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [open, setOpen] = useState(depth < 1);
  const kids = node.children ?? [];
  return (
    <li className={depth ? 'ml-4 border-l-2 border-slate-100 pl-3' : ''} data-testid="task-node">
      <div className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[13px] font-bold text-slate-900">{node.assignee.name}</span>
            <span className="ml-1.5 text-[11px] text-slate-500">{ROLE[node.assignee.role] ?? node.assignee.role}{node.team ? ` · ${node.team}` : ''}</span>
            {node.handling === 'SELF' ? <span className="ml-2 text-[10px] font-bold uppercase text-emerald-700">Working on it personally</span> : null}
          </div>
          <span className="flex items-center gap-2"><StatusPill status={node.status} /></span>
        </div>
        {depth === 0 ? <p className="text-[13px] font-semibold text-slate-800 mt-0.5">{node.title}</p> : null}
        {node.assignmentNote ? <p className="text-[12px] text-slate-700 mt-0.5">{node.assignmentNote}</p> : depth === 0 && node.description ? <p className="text-[12px] text-slate-600 mt-0.5 whitespace-pre-line">{node.description}</p> : null}
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 max-w-xs"><ProgressBar value={node.progress} label={`Progress of ${node.assignee.name}`} /></div>
          <span className="text-[11px] font-bold text-slate-700">{node.progress}%</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Delegated by {node.assignedBy.name} on {fmtDate(node.assignedAt)}
          {node.dueDate ? ` · due ${fmtDate(node.dueDate)}` : ''}
          {node.completedAt ? ` · completed ${fmtDateTime(node.completedAt)}` : ''}
        </p>
        {node.latestUpdate ? <p className="mt-1 text-[11px] text-slate-600"><strong>Latest:</strong> {node.latestUpdate.note} ({fmtDateTime(node.latestUpdate.at)})</p> : null}
        {kids.length ? (
          <button type="button" className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-blue-700" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
            {open ? 'Hide' : 'Show'} {kids.length} {kids.length === 1 ? 'person' : 'people'} below
          </button>
        ) : null}
      </div>
      {open && kids.length ? <ul>{kids.map(k => <TaskTreeNode key={k.id} node={k} depth={depth + 1} />)}</ul> : null}
    </li>
  );
};

/** The Operations Head's Assign page: a task goes to a Department Head of a department and function they manage; the list shows each task's chain. */
export const OperationsAssign: React.FC = () => {
  const [heads, setHeads] = useState<OperationsAssignee[] | null>(null);
  const [tasks, setTasks] = useState<TaskNode[] | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState(localDateKey());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    workTasksApi.operationsAssignees().then(setHeads, e => setError(e instanceof Error ? e.message : String(e)));
    workTasksApi.operationsTasks().then(setTasks, e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  // one option per Department Head AND department/function (a head may be offered for two departments)
  const key = (h: OperationsAssignee) => `${h.id}|${h.departmentId}|${h.function}`;
  const chosen = heads?.find(h => key(h) === pick);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || !title.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await workTasksApi.assignToDepartmentHead({ assigneeId: chosen.id, departmentId: chosen.departmentId, fn: chosen.function, title: title.trim(), description, priority, dueDate });
      setNotice({ ok: true, text: `Task assigned to ${chosen.name} (${chosen.department}).` });
      setTitle('');
      setDescription('');
      load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not assign the task.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Assign</h1>
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Give a task to a Department Head. They pass it to their Team Leads, who work on it or share it with their Team Members. Every level shows below.</p>
      </div>
      {error ? <p role="alert" className="p-3 rounded-xl bg-rose-50 text-rose-700 text-sm">{error}</p> : null}
      <Card label="Assign a task to a Department Head">
        <form onSubmit={submit} aria-label="Assign a task to a Department Head">
          <CardHead title="New task" hint="The Department Head is notified right away." />
          <div className="px-5 pb-5 space-y-4">
            {notice && <p role={notice.ok ? 'status' : 'alert'} className={`p-3 rounded-xl text-sm font-semibold ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{notice.text}</p>}
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1.4fr_180px] gap-4">
              <label className="block text-[13px] font-bold text-slate-700">
                Department Head *
                <select className={`${fieldCls} mt-1.5 font-medium`} value={pick} onChange={e => setPick(e.target.value)} required data-testid="oh-assignee">
                  <option value="">Choose a Department Head</option>
                  {(heads ?? []).map(h => <option key={key(h)} value={key(h)}>{h.name} - {h.department} ({FN[h.function]})</option>)}
                </select>
                {heads && heads.length === 0 ? <span className="block mt-1 text-xs font-medium text-amber-700">No active Department Head in the departments you manage.</span> : null}
              </label>
              <label className="block text-[13px] font-bold text-slate-700">
                Task *
                <input className={`${fieldCls} mt-1.5 font-medium`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Review all pending customer escalations" />
              </label>
              <label className="block text-[13px] font-bold text-slate-700">
                Due date
                <input type="date" className={`${fieldCls} mt-1.5 font-medium`} value={dueDate} min={localDateKey()} onChange={e => setDueDate(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
              <label className="block text-[13px] font-bold text-slate-700">
                Details (optional)
                <textarea className={`${textareaCls} mt-1.5 font-medium`} rows={2} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} />
              </label>
              <label className="block text-[13px] font-bold text-slate-700">
                Priority
                <select className={`${fieldCls} mt-1.5 font-medium`} value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
                  <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={busy || !chosen || !title.trim()} className={primaryBtn}><Plus className="w-4 h-4" aria-hidden="true" /> {busy ? 'Assigning…' : 'Assign to Department Head'}</button>
            </div>
          </div>
        </form>
      </Card>
      <section aria-label="Tasks you assigned" className="space-y-3">
        <h2 className="text-lg font-extrabold text-slate-900">Tasks you assigned ({tasks?.length ?? 0})</h2>
        {tasks === null ? <LoadingLine /> : tasks.length === 0 ? <EmptyState title="No tasks assigned yet" hint="Tasks you give to Department Heads appear here with everyone they reached." /> : (
          tasks.map(t => (
            <article key={t.id} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-1"><PriorityPill priority={t.priority} /><span className="text-[11px] text-slate-500">{t.department}{t.function !== 'ALL' ? ` · ${FN[t.function]}` : ''}</span></div>
              <ul><TaskTreeNode node={t} /></ul>
            </article>
          ))
        )}
      </section>
    </div>
  );
};

/**
 * A Department Head's tasks from the Operations Head: pass each to one or more of their Team Leads (instructions and a due date), follow the chain,
 * and send their own update up.
 */
export const ReceivedTasks: React.FC<{ data: WorkTaskData; meId: string; leads: { id: string; fullName: string; teamId: string | null }[] }> = ({ data, meId, leads }) => {
  const received = data.tasks.filter(t => t.assigneeId === meId && t.parentId === null && t.assignedBy !== meId);
  if (!received.length) return null;
  return (
    <section aria-label="From the Operations Head" className="space-y-3" data-testid="received-tasks">
      <h2 className="text-lg font-extrabold text-slate-900">From the Operations Head ({received.length})</h2>
      {received.map(t => <ReceivedTask key={t.id} task={t} data={data} leads={leads} />)}
    </section>
  );
};

const ReceivedTask: React.FC<{ task: WorkTask; data: WorkTaskData; leads: { id: string; fullName: string; teamId: string | null }[] }> = ({ task, data, leads }) => {
  const [tree, setTree] = useState<TaskNode | null>(null);
  const [lead, setLead] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState(task.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const children = data.tasks.filter(c => c.parentId === task.id);
  const loadTree = useCallback(() => { workTasksApi.hierarchy(task.id).then(setTree, () => setTree(null)); }, [task.id]);
  useEffect(loadTree, [loadTree, data.tasks.length]);
  const available = leads.filter(l => !children.some(c => c.assigneeId === l.id));

  const pass = async () => {
    if (!lead) return;
    setBusy(true);
    setNotice(null);
    try {
      await workTasksApi.delegateToTeamLead(task.id, lead, note, due || null);
      setNotice({ ok: true, text: `Passed to ${nameOf(data.people, lead)}.` });
      setLead('');
      setNote('');
      await data.reload();
      loadTree();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not pass the task on.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3" aria-label={task.title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-extrabold text-slate-900">{task.title}</h3><PriorityPill priority={task.priority} /></div>
          <p className="text-[13px] text-slate-500 mt-1">From <strong className="text-slate-700">{nameOf(data.people, task.assignedBy)}</strong>{task.dueDate ? ` · due ${fmtDate(task.dueDate)}` : ''}</p>
          {task.description ? <p className="text-[13px] text-slate-600 mt-1 whitespace-pre-line">{task.description}</p> : null}
        </div>
        <StatusPill status={task.status} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-3 rounded-xl border border-slate-200 space-y-2">
          <div className="text-[13px] font-extrabold text-slate-900">Pass to a Team Lead</div>
          {notice && <p role={notice.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${notice.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{notice.text}</p>}
          {available.length === 0 ? <p className="text-xs text-slate-500">{leads.length === 0 ? 'No active Team Lead in your department.' : 'Every Team Lead already has this task.'}</p> : (
            <>
              <select className={fieldCls} value={lead} onChange={e => setLead(e.target.value)} aria-label="Team Lead" data-testid="dh-pass-lead">
                <option value="">Choose a Team Lead</option>
                {available.map(l => <option key={l.id} value={l.id}>{l.fullName}{l.teamId ? ` - ${data.teams.find(x => x.id === l.teamId)?.name ?? 'Team'}` : ''}</option>)}
              </select>
              <textarea className={textareaCls} rows={2} maxLength={500} placeholder="Instructions (optional)" aria-label="Instructions" value={note} onChange={e => setNote(e.target.value)} />
              <label className="block text-xs font-semibold text-slate-600">Due date<input type="date" className={`${fieldCls} mt-1`} value={due} min={localDateKey()} onChange={e => setDue(e.target.value)} /></label>
              <button type="button" className={primaryBtn} disabled={busy || !lead} onClick={() => void pass()}>{busy ? 'Passing…' : 'Pass to Team Lead'}</button>
            </>
          )}
        </div>
        <div className="p-3 rounded-xl border border-slate-200">
          <UpdateForm task={task} sendTo={nameOf(data.people, task.assignedBy)} onSubmit={async input => { await workTasksApi.submitUpdate(task.id, input); await data.reload(); }} />
        </div>
      </div>
      {tree && tree.children.length ? <ul aria-label="Who has it">{tree.children.map(c => <TaskTreeNode key={c.id} node={c} depth={1} />)}</ul> : null}
    </article>
  );
};

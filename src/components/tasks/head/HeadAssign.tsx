import React, { useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { isOverdue, localDateKey, workTasksApi, type TaskPriority, type WorkTask, type WorkTaskData } from '../../../lib/workTasks';
import { DueLabel, EmptyState, fmtDate, fmtDateTime, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateTimeline } from '../TaskParts';
import { Card, CardHead, fieldCls, LoadingLine, primaryBtn, Tabs, textareaCls } from './headParts';
import { isOperationsHead } from '../../../lib/auth/roleMapping';
import { OperationsAssign, ReceivedTasks } from './TaskHierarchy';

type Filter = 'all' | 'progress' | 'completed' | 'overdue';
const PRIORITIES: { id: TaskPriority; label: string; on: string }[] = [
  { id: 'HIGH', label: 'High', on: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'MEDIUM', label: 'Medium', on: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'LOW', label: 'Low', on: 'bg-slate-100 text-slate-700 border-slate-300' }
];

export const HeadAssign: React.FC<{ data: WorkTaskData; query?: string }> = props => {
  const { profile } = useAuth();
  // an Operations Head gives tasks to Department Heads (20261230000300), never straight to Team Leads
  if (profile && isOperationsHead(profile)) return <OperationsAssign />;
  return <DepartmentHeadAssign {...props} />;
};

const DepartmentHeadAssign: React.FC<{ data: WorkTaskData; query?: string }> = ({ data, query = '' }) => {
  const { profile } = useAuth();
  const leads = data.people.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE' && p.departmentId === profile?.departmentId);
  const leadTasks = data.tasks.filter(t => t.parentId === null && t.assignedBy === profile?.id);

  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState(localDateKey());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState(query);
  React.useEffect(() => setFind(query), [query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId || !title.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await workTasksApi.assignToTeamLead({ assigneeId, title: title.trim(), description, priority, dueDate });
      setNotice({ ok: true, text: `Task assigned to ${nameOf(data.people, assigneeId)}.` });
      setTitle('');
      setDescription('');
      await data.reload();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not assign the task.' });
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    all: leadTasks.length,
    progress: leadTasks.filter(t => t.status === 'IN_PROGRESS').length,
    completed: leadTasks.filter(t => t.status === 'COMPLETED').length,
    overdue: leadTasks.filter(isOverdue).length
  };
  const q = find.trim().toLowerCase();
  const shown = leadTasks
    .filter(t => (filter === 'all' ? true : filter === 'progress' ? t.status === 'IN_PROGRESS' : filter === 'completed' ? t.status === 'COMPLETED' : isOverdue(t)))
    .filter(t => !q || t.title.toLowerCase().includes(q) || nameOf(data.people, t.assigneeId).toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Assign</h1>
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Give a task to a team lead. They split it across their team members, and every update comes back here.</p>
      </div>

      {profile ? <ReceivedTasks data={data} meId={profile.id} leads={leads} /> : null}

      <Card label="Assign a task to a team lead">
        <form onSubmit={submit} aria-label="Assign a task to a team lead">
          <CardHead title="New task" hint="The team lead is notified right away." />
          <div className="px-5 pb-5 space-y-4">
            {notice && (
              <p role={notice.ok ? 'status' : 'alert'} className={`p-3 rounded-xl text-sm font-semibold ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {notice.text}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_200px] gap-4">
              <label className="block text-[13px] font-bold text-slate-700">
                Team lead *
                <select className={`${fieldCls} mt-1.5 font-medium`} value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
                  <option value="">Choose a team lead</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.fullName}
                      {l.teamId ? ` - ${data.teams.find(t => t.id === l.teamId)?.name || 'Team'}` : ''}
                    </option>
                  ))}
                </select>
                {leads.length === 0 && <span className="block mt-1 text-xs font-medium text-amber-700">No active team leads in your department yet.</span>}
              </label>
              <label className="block text-[13px] font-bold text-slate-700">
                Task *
                <input className={`${fieldCls} mt-1.5 font-medium`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Call all new WhatsApp leads" />
              </label>
              <label className="block text-[13px] font-bold text-slate-700">
                Due date
                <input type="date" className={`${fieldCls} mt-1.5 font-medium`} value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
              <label className="block text-[13px] font-bold text-slate-700">
                Details (optional)
                <textarea className={`${textareaCls} mt-1.5 font-medium`} rows={2} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} />
              </label>
              <div>
                <div className="text-[13px] font-bold text-slate-700" id="prio-label">Priority</div>
                <div className="mt-1.5 flex gap-2" role="radiogroup" aria-labelledby="prio-label">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={priority === p.id}
                      onClick={() => setPriority(p.id)}
                      className={`h-11 px-4 rounded-xl border text-sm font-bold ${priority === p.id ? p.on : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={busy || !assigneeId || !title.trim()} className={primaryBtn}>
                <Plus className="w-4 h-4" aria-hidden="true" /> {busy ? 'Assigning…' : 'Assign to team lead'}
              </button>
            </div>
          </div>
        </form>
      </Card>

      <section aria-label="Assigned tasks" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-slate-900">Assigned tasks ({leadTasks.length})</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative">
              <span className="sr-only">Search assigned tasks</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="Search tasks or leads" className={`${fieldCls} pl-9 w-56 h-9 text-[13px]`} />
            </label>
            <Tabs
              label="Filter tasks"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All', count: counts.all },
                { id: 'progress', label: 'In progress', count: counts.progress },
                { id: 'completed', label: 'Completed', count: counts.completed },
                { id: 'overdue', label: 'Overdue', count: counts.overdue }
              ]}
            />
          </div>
        </div>
        {data.loading ? (
          <LoadingLine />
        ) : leadTasks.length === 0 ? (
          <EmptyState title="No tasks assigned yet" hint="Tasks you assign to team leads appear here with their team members' progress." />
        ) : shown.length === 0 ? (
          <EmptyState title="No task matches" hint="Try another filter or search." />
        ) : (
          shown.map(t => <LeadTaskCard key={t.id} task={t} data={data} />)
        )}
      </section>
    </div>
  );
};

const LeadTaskCard: React.FC<{ task: WorkTask; data: WorkTaskData }> = ({ task, data }) => {
  const [open, setOpen] = useState(false);
  const children = data.tasks.filter(c => c.parentId === task.id);
  const done = children.filter(c => c.status === 'COMPLETED').length;
  const leadUpdates = data.updates.filter(u => u.taskId === task.id);

  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-extrabold text-slate-900">{task.title}</h3>
            <PriorityPill priority={task.priority} />
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Team lead: <strong className="text-slate-700">{nameOf(data.people, task.assigneeId)}</strong> · <DueLabel task={task} />
          </p>
        </div>
        <StatusPill status={task.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={task.progress} label={`Progress of ${task.title}`} />
        </div>
        <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{task.progress}%</span>
        <span className="text-xs text-slate-500 whitespace-nowrap">{children.length ? `${done}/${children.length} members done` : 'Not yet assigned to Team Members'}</span>
      </div>
      {task.lastUpdateNote && (
        <p className="mt-3 text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <strong>Latest:</strong> {task.lastUpdateNote}
        </p>
      )}
      {/* Department Head -> Team Lead -> Team Members: who got which part, read from the stored member tasks (never generated here) */}
      <section className="mt-4" aria-label={`Assigned to Team Members: ${task.title}`} data-testid="delegated-members">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="text-[13px] font-extrabold text-slate-900">Assigned to Team Members</h4>
          <span className="text-xs font-semibold text-slate-500">{children.length} member{children.length === 1 ? '' : 's'}</span>
        </div>
        {children.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">Not yet assigned to Team Members.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {children.map(c => (
              <li key={c.id} className="p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{nameOf(data.people, c.assigneeId)}</span>
                  <span className="flex items-center gap-2"><PriorityPill priority={c.priority} /><StatusPill status={c.status} /></span>
                </div>
                <p className="mt-1 text-slate-700">{c.assignmentNote || <span className="text-slate-500">The whole task</span>}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1"><ProgressBar value={c.progress} label={`Progress of ${nameOf(data.people, c.assigneeId)}`} /></div>
                  <span className="text-xs font-bold text-slate-700">{c.progress}%</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Assigned by {nameOf(data.people, c.assignedBy)} on {fmtDate(c.createdAt)}
                  {c.dueDate ? ` · due ${fmtDate(c.dueDate)}` : ''}
                  {c.completedAt ? ` · completed ${fmtDate(c.completedAt)}` : ''}
                </p>
                {c.lastUpdateNote && <p className="mt-1 text-xs text-slate-600"><strong>Latest:</strong> {c.lastUpdateNote}{c.lastUpdateAt ? ` (${fmtDateTime(c.lastUpdateAt)})` : ''}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-blue-700 hover:text-blue-800">
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        {open ? 'Hide update history' : 'Show update history'}
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl border border-slate-200">
            <div className="text-[13px] font-extrabold text-slate-900 mb-2">Updates from the team members</div>
            <UpdateTimeline updates={data.updates.filter(u => children.some(c => c.id === u.taskId))} people={data.people} empty="No update from the team members yet." />
          </div>
          <div className="p-4 rounded-xl border border-slate-200">
            <div className="text-[13px] font-extrabold text-slate-900 mb-2">Updates from the team lead</div>
            <UpdateTimeline updates={leadUpdates} people={data.people} empty="No update from the team lead yet." />
          </div>
        </div>
      )}
    </article>
  );
};

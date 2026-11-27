import React, { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { isOverdue, workTasksApi, type DirectAssignee, type WorkTask, type WorkTaskData } from '../../../lib/workTasks';
import { DueLabel, EmptyState, fmtDate, fmtDateTime, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateTimeline } from '../TaskParts';
import { TaskWorkUpdates } from '../WorkUpdates';
import { Card, CardHead, fieldCls, LoadingLine, primaryBtn, Tabs, textareaCls } from './headParts';
import { isOperationsHead } from '../../../lib/auth/roleMapping';
import { DirectOptions, OperationsAssign, ReceivedTasks } from './TaskHierarchy';
import { TaskTracker } from '../TaskTracker';
import { TaskAssignPanel, type AssignValues } from '../TaskAssignPanel';
import type { PickerPerson } from '../PeoplePicker';
import { useTaskWorkspace } from '../useTaskWorkspace';
import { TaskCardDelete } from '../TaskCardDelete';

type Filter = 'all' | 'progress' | 'completed' | 'overdue';
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
  // Team Leads AND Team Members of the teams this head manages, decided by the database (task_direct_assignees). null = the database is older:
  // only Team Leads are offered, as before.
  const [direct, setDirect] = useState<DirectAssignee[] | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    workTasksApi.directAssignees().then(d => live && setDirect(d), () => live && setDirect(null));
    return () => { live = false; };
  }, []);

  const ws = useTaskWorkspace(() => void data.reload());
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState(query);
  React.useEffect(() => setFind(query), [query]);

  // who the panel offers: exactly what the database offered this head (direct) or the department's active team leads
  const people: PickerPerson[] = direct
    ? direct.map(d => ({ id: d.id, name: d.name, designation: d.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member', team: d.team, department: d.department }))
    : leads.map(l => ({ id: l.id, name: l.fullName, designation: l.position || 'Team Lead', team: data.teams.find(t => t.id === l.teamId)?.name ?? null }));
  const groups = [...new Set(people.map(p => p.team).filter(Boolean) as string[])].sort().map(g => ({ id: g, label: g }));
  const assign = async (v: AssignValues) => {
    const assigneeId = v.assigneeIds[0]!;
    const input = { assigneeId, title: v.title, description: v.description, priority: v.priority, dueDate: v.dueDate };
    if (direct) await workTasksApi.assignDirect(input);
    else await workTasksApi.assignToTeamLead(input);
    await data.reload();
    return `Task assigned to ${people.find(p => p.id === assigneeId)?.name ?? nameOf(data.people, assigneeId)}.`;
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
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Give a task to a team lead, who splits it across their team members, or straight to a team member (for example when their team lead is away). Every update comes back here.</p>
      </div>

      {profile ? <ReceivedTasks data={data} meId={profile.id} leads={leads} /> : null}

      <Card label="Assign a task">
        <CardHead title="New task" hint="The person is notified right away. A team member's own team lead is told too." />
        <div className="px-5 pb-5">
          <TaskAssignPanel
            assigneeLabel={direct ? 'Assign to' : 'Team lead'} people={people} groups={groups}
            loadingPeople={direct === undefined} emptyPeople={direct ? 'No active team leads or team members in the teams you manage yet.' : 'No active team leads in your department yet.'}
            onSubmit={assign}
          />
        </div>
      </Card>

      <TaskTracker tasks={data.tasks} people={data.people} meId={profile?.id ?? ''} loading={data.loading} onChanged={() => void data.reload()} deletable={data.deletable}
        title="Task tracker" emptyHint="Tasks you assign appear here with their progress." />

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
          <EmptyState title="No tasks assigned yet" hint="Tasks you assign appear here with their progress." />
        ) : shown.length === 0 ? (
          <EmptyState title="No task matches" hint="Try another filter or search." />
        ) : (
          shown.map(t => <LeadTaskCard key={t.id} task={t} data={data} ws={ws} />)
        )}
      </section>
      {ws.node}
    </div>
  );
};

const LeadTaskCard: React.FC<{ task: WorkTask; data: WorkTaskData; ws: ReturnType<typeof useTaskWorkspace> }> = ({ task, data, ws }) => {
  const [open, setOpen] = useState(false);
  // a task given straight to a Team Member (20270114000100) has no members below it
  const toMember = data.people.find(p => p.id === task.assigneeId)?.role === 'TEAM_MEMBER';
  const children = data.tasks.filter(c => c.parentId === task.id);
  const done = children.filter(c => c.status === 'COMPLETED').length;
  const leadUpdates = data.updates.filter(u => u.taskId === task.id);

  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-5 cursor-pointer transition-colors hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" {...ws.cardProps(task.id)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-extrabold text-slate-900">{task.title}</h3>
            <PriorityPill priority={task.priority} />
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            {toMember ? 'Team member' : 'Team lead'}: <strong className="text-slate-700">{nameOf(data.people, task.assigneeId)}</strong> · <DueLabel task={task} />
          </p>
        </div>
        <span className="flex items-center gap-2">
          {data.deletable.has(task.id) && <TaskCardDelete task={task} assigneeName={nameOf(data.people, task.assigneeId)} />}
          <StatusPill status={task.status} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={task.progress} label={`Progress of ${task.title}`} />
        </div>
        <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{task.progress}%</span>
        <span className="text-xs text-slate-500 whitespace-nowrap">{toMember ? 'Given straight to the team member' : children.length ? `${done}/${children.length} members done` : 'Not yet assigned to Team Members'}</span>
      </div>
      {task.lastUpdateNote && (
        <p className="mt-3 text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <strong>Latest:</strong> {task.lastUpdateNote}
        </p>
      )}
      {/* Work updates: ask the person this task is assigned to how it is going, and read their answers (the database checks the hierarchy) */}
      <TaskWorkUpdates taskId={task.id} assigneeName={nameOf(data.people, task.assigneeId)} />
      {/* Department Head -> Team Lead -> Team Members: who got which part, read from the stored member tasks (never generated here) */}
      {!toMember && <section className="mt-4" aria-label={`Assigned to Team Members: ${task.title}`} data-testid="delegated-members">
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
                  <span className="flex items-center gap-2"><PriorityPill priority={c.priority} /><StatusPill status={c.status} />{data.deletable.has(c.id) && <TaskCardDelete task={c} assigneeName={nameOf(data.people, c.assigneeId)} />}</span>
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
                <TaskWorkUpdates taskId={c.id} assigneeName={nameOf(data.people, c.assigneeId)} />
              </li>
            ))}
          </ul>
        )}
      </section>}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-blue-700 hover:text-blue-800">
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        {open ? 'Hide update history' : 'Show update history'}
      </button>
      {open && toMember && (
        <div className="mt-3 p-4 rounded-xl border border-slate-200">
          <div className="text-[13px] font-extrabold text-slate-900 mb-2">Updates from the team member</div>
          <UpdateTimeline updates={leadUpdates} people={data.people} empty="No update from the team member yet." />
        </div>
      )}
      {open && !toMember && (
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

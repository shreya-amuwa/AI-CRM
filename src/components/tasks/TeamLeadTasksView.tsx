import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { summarize, useMyTeamMembers, useWorkTasks, workTasksApi, type WorkTask, type WorkTaskData } from '../../lib/workTasks';
import { useCustomerOptions } from '../../lib/support';
import { DueLabel, EmptyState, fmtDate, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateTimeline } from './TaskParts';
import { TaskWorkUpdates, WorkUpdatesPanel } from './WorkUpdates';
import { TaskTracker } from './TaskTracker';
import { SubmitWorkUpdate } from './WorkUpdateForm';
import { useTaskWorkspace } from './useTaskWorkspace';
import { TaskCardDelete } from './TaskCardDelete';
import { TaskAssignPanel, type AssignValues } from './TaskAssignPanel';
import type { PickerPerson } from './PeoplePicker';

/**
 * Team Lead: tasks from the Department Head. Assign each one to team members,
 * follow their updates, and send your own update to the Department Head.
 */
export const TeamLeadTasksView: React.FC = () => {
  const { profile } = useAuth();
  const data = useWorkTasks();
  // every task given to me: from my Department Head, including one the Department Head passed down from the Operations Head
  const mine = data.tasks.filter(t => t.assigneeId === profile?.id);
  const direct = data.tasks.filter(t => t.parentId === null && t.assignedBy === profile?.id && t.assigneeId !== profile?.id);
  const s = summarize(mine);
  const ws = useTaskWorkspace(() => void data.reload());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Assigned Tasks</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Tasks from your Department Head. Assign them to your team members; their updates come to you, and you send your update to the
          Department Head.
        </p>
      </div>
      {data.error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">{data.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{s.total} from your Department Head · {s.completed} completed · {s.overdue} overdue</p>
        <AssignDirectForm data={data} />
      </div>
      <TaskTracker tasks={data.tasks} people={data.people} meId={profile?.id ?? ''} loading={data.loading} onChanged={() => void data.reload()} deletable={data.deletable}
        title="Task tracker" emptyHint="Tasks you assign, and tasks from your Department Head, appear here with their progress." />
      <WorkUpdatesPanel hint="Ask your team members how the work is going. Their answers and the reminders you sent are kept here, and in each task below." />
      <DirectTasks tasks={direct} data={data} ws={ws} />
      <h2 className="text-sm font-bold text-slate-900 pt-2">From your Department Head</h2>
      {data.loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : mine.length === 0 ? (
        <EmptyState title="No tasks from your Department Head yet" hint="When the Department Head assigns you a task it appears here." />
      ) : (
        mine.map(t => <LeadTask key={t.id} task={t} data={data} ws={ws} />)
      )}
      {ws.node}
    </div>
  );
};

const LeadTask: React.FC<{ task: WorkTask; data: WorkTaskData; ws: ReturnType<typeof useTaskWorkspace> }> = ({ task, data, ws }) => {
  const children = data.tasks.filter(c => c.parentId === task.id);
  const assigned = new Set(children.map(c => c.assigneeId));
  // the lead's OWN ordinary members from the database (not another lead's, no Technical Consultant, no Meta Verifier); the database checks it again on assign
  const roster = useMyTeamMembers();
  const team = roster.members.filter(p => p.ordinary);
  const available = team.filter(p => !assigned.has(p.id));
  const [picked, setPicked] = useState<string[]>([]);
  // each member's part of the work ("Follow up with 40 customers"), optional
  const [shares, setShares] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const memberUpdates = data.updates.filter(u => children.some(c => c.id === u.taskId));
  const myUpdates = data.updates.filter(u => u.taskId === task.id);

  const assign = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const n = await workTasksApi.delegate(task.id, picked.map(id => ({ memberId: id, work: shares[id] })));
      setNotice({ ok: true, text: `Assigned to ${n} team member${n === 1 ? '' : 's'}.` });
      setPicked([]);
      setShares({});
      await data.reload();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not assign.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 cursor-pointer transition-colors hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" aria-label={task.title} {...ws.cardProps(task.id)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">{task.title}</h2>
            <PriorityPill priority={task.priority} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            From <strong className="text-slate-700">{nameOf(data.people, task.assignedBy)}</strong> · <DueLabel task={task} />
          </p>
          {task.description && <p className="text-xs text-slate-600 mt-1.5 whitespace-pre-line">{task.description}</p>}
          {task.assignmentNote && <p className="text-xs text-slate-800 mt-1.5"><strong>Instructions:</strong> {task.assignmentNote}</p>}
        </div>
        <StatusPill status={task.status} />
      </div>

      {/* Option A: work on it myself (the same task, no copy) - Option B below: give it to my own team members */}
      {task.handling === 'SELF' ? (
        <p className="text-xs font-semibold text-emerald-700" role="status" data-testid="tl-self">You are working on this task yourself. Send your updates below.</p>
      ) : children.length === 0 && task.status !== 'COMPLETED' ? (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/60" data-no-open>
          <span className="text-xs text-slate-700">Do it yourself, or assign it to your team members below.</span>
          <button type="button" data-testid="tl-take-myself" disabled={busy} className="px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            onClick={async () => {
              setBusy(true); setNotice(null);
              try { await workTasksApi.takeMyself(task.id); await data.reload(); setNotice({ ok: true, text: 'You are working on it yourself.' }); }
              catch (err) { setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not update the task.' }); }
              finally { setBusy(false); }
            }}>Assign to myself</button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-slate-200" data-no-open>
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
              <UserPlus className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> Assign to team members
            </div>
            {available.length === 0 ? (
              <p className="text-[11px] text-slate-400" role={roster.error ? 'alert' : undefined}>
                {roster.loading ? 'Loading your team…' : roster.error ? `Your team could not be loaded: ${roster.error}` : team.length === 0 ? 'No team members are assigned to you yet. Ask your Department Head to assign them.' : 'Every team member already has this task.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {available.map(p => {
                    const on = picked.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                          on ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="accent-blue-600"
                          checked={on}
                          onChange={() => setPicked(v => (on ? v.filter(x => x !== p.id) : [...v, p.id]))}
                        />
                        {p.fullName}
                      </label>
                    );
                  })}
                </div>
                {picked.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[11px] text-slate-500">Their part of the work (optional). Leave empty to give the whole task.</p>
                    {picked.map(id => {
                      const name = available.find(p => p.id === id)?.fullName ?? 'Team member';
                      return (
                        <label key={id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs">
                          <span className="font-semibold text-slate-700 sm:w-36 shrink-0">{name}</span>
                          <input
                            type="text"
                            maxLength={500}
                            value={shares[id] ?? ''}
                            onChange={e => setShares(v => ({ ...v, [id]: e.target.value }))}
                            placeholder="e.g. Follow up with 40 customers"
                            aria-label={`Part of the work for ${name}`}
                            className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={assign}
                  disabled={busy || picked.length === 0}
                  className="mt-2.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? 'Assigning…' : `Assign to ${picked.length || ''} member${picked.length === 1 ? '' : 's'}`}
                </button>
              </>
            )}
            {notice && <p className={`mt-2 text-xs ${notice.ok ? 'text-emerald-700' : 'text-rose-700'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
          </div>

          <div className="p-3 rounded-xl border border-slate-200">
            <div className="text-xs font-bold text-slate-800 mb-2">Team progress</div>
            {children.length === 0 ? (
              <p className="text-[11px] text-slate-400">Not assigned to anyone yet.</p>
            ) : (
              <ul className="space-y-2">
                {children.map(c => (
                  <li key={c.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{nameOf(data.people, c.assigneeId)}</span>
                      <span className="flex items-center gap-2">
                        {data.deletable.has(c.id) && <TaskCardDelete task={c} assigneeName={nameOf(data.people, c.assigneeId)} />}
                        <StatusPill status={c.status} />
                      </span>
                    </div>
                    {c.assignmentNote && <p className="text-[11px] text-slate-600 mt-0.5">{c.assignmentNote}</p>}
                    <div className="mt-1">
                      <ProgressBar value={c.progress} label={`Progress of ${nameOf(data.people, c.assigneeId)}`} />
                    </div>
                    <TaskWorkUpdates taskId={c.id} assigneeName={nameOf(data.people, c.assigneeId)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-slate-200">
            <div className="text-xs font-bold text-slate-800 mb-2">Updates from team members</div>
            <UpdateTimeline updates={memberUpdates} people={data.people} empty="No updates from your team yet." />
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5">
            <div className="text-xs font-bold text-slate-800">Your update to the Department Head</div>
            <SubmitWorkUpdate taskId={task.id} status={task.status} progress={task.progress} onSent={() => void data.reload()} />
          </div>
          {myUpdates.length > 0 && (
            <div className="p-3 rounded-xl border border-slate-200">
              <div className="text-xs font-bold text-slate-800 mb-2">Your updates sent</div>
              <UpdateTimeline updates={myUpdates} people={data.people} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

/** Team Lead → Team Members: your own task, optionally about a customer. The panel validates; the database checks the team again. */
const AssignDirectForm: React.FC<{ data: WorkTaskData }> = ({ data }) => {
  const { profile } = useAuth();
  const customers = useCustomerOptions();
  const roster = useMyTeamMembers();
  const teamName = data.teams.find(t => t.id === profile?.teamId)?.name ?? null;
  const people: PickerPerson[] = roster.members.filter(p => p.ordinary).map(p => ({ id: p.id, name: p.fullName, designation: p.position, team: teamName }));
  const submit = async (v: AssignValues) => {
    const n = await workTasksApi.assignTeamTask({ title: v.title, description: v.description, priority: v.priority, dueDate: v.dueDate, customerId: v.customerId, memberIds: v.assigneeIds });
    await data.reload();
    return `Task assigned to ${n} team member${n === 1 ? '' : 's'}.`;
  };
  return (
    <TaskAssignPanel
      multiple assigneeLabel="Assign to team members" people={people} customers={customers} onSubmit={submit}
      loadingPeople={roster.loading} peopleError={roster.error ? `Your team could not be loaded: ${roster.error}` : null}
      emptyPeople="No team members are assigned to you yet. Ask your Department Head to assign them."
    />
  );
};

/** Tasks the lead gave straight to members: who is doing what, and how far they are. */
const DirectTasks: React.FC<{ tasks: WorkTask[]; data: WorkTaskData; ws: ReturnType<typeof useTaskWorkspace> }> = ({ tasks, data, ws }) => {
  if (tasks.length === 0) return null;
  const s = summarize(tasks);
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5" aria-label="Tasks you assigned to team members">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-900">Tasks you assigned ({tasks.length})</h2>
        <span className="text-[11px] text-slate-500">
          {s.completed} completed · {s.open} open{s.blocked ? ` · ${s.blocked} blocked` : ''}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {tasks.map(t => {
          const updates = data.updates.filter(u => u.taskId === t.id);
          return (
            <li key={t.id} className="py-3 space-y-1.5 px-2 -mx-2 rounded-xl cursor-pointer hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" {...ws.cardProps(t.id)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{t.title}</span>
                  <PriorityPill priority={t.priority} />
                  <span className="text-xs text-slate-500">→ {nameOf(data.people, t.assigneeId)}</span>
                </div>
                <span className="flex items-center gap-2">
                  {data.deletable.has(t.id) && <TaskCardDelete task={t} assigneeName={nameOf(data.people, t.assigneeId)} />}
                  <StatusPill status={t.status} />
                </span>
              </div>
              <ProgressBar value={t.progress} label={`Progress of ${t.title}`} />
              <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                <span>Assigned {fmtDate(t.createdAt)}</span>
                <DueLabel task={t} />
                {t.lastUpdateNote && <span className="text-slate-600">“{t.lastUpdateNote}”</span>}
              </div>
              <TaskWorkUpdates taskId={t.id} assigneeName={nameOf(data.people, t.assigneeId)} />
              {updates.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-700 font-semibold">History ({updates.length})</summary>
                  <div className="mt-2">
                    <UpdateTimeline updates={updates} people={data.people} />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

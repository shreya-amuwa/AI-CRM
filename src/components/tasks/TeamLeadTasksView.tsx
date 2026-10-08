import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { summarize, useWorkTasks, workTasksApi, type WorkTask, type WorkTaskData } from '../../lib/workTasks';
import { DueLabel, EmptyState, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateForm, UpdateTimeline } from './TaskParts';

/**
 * Team Lead: tasks from the Department Head. Assign each one to team members,
 * follow their updates, and send your own update to the Department Head.
 */
export const TeamLeadTasksView: React.FC = () => {
  const { profile } = useAuth();
  const data = useWorkTasks();
  const mine = data.tasks.filter(t => t.parentId === null && t.assigneeId === profile?.id);
  const s = summarize(mine);

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Mini label="From Department Head" value={s.total} />
        <Mini label="Completed" value={s.completed} tone="text-emerald-700" />
        <Mini label="In progress" value={s.inProgress + s.notStarted} tone="text-blue-700" />
        <Mini label="Overdue" value={s.overdue} tone="text-rose-700" />
      </div>
      {data.loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : mine.length === 0 ? (
        <EmptyState title="No tasks from your Department Head yet" hint="When the Department Head assigns you a task it appears here." />
      ) : (
        mine.map(t => <LeadTask key={t.id} task={t} data={data} />)
      )}
    </div>
  );
};

const Mini: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className={`text-xl font-bold ${tone || 'text-slate-900'}`}>{value}</div>
  </div>
);

const LeadTask: React.FC<{ task: WorkTask; data: WorkTaskData }> = ({ task, data }) => {
  const { profile } = useAuth();
  const children = data.tasks.filter(c => c.parentId === task.id);
  const assigned = new Set(children.map(c => c.assigneeId));
  const team = data.people.filter(p => p.role === 'TEAM_MEMBER' && p.status === 'ACTIVE' && p.teamId === profile?.teamId);
  const available = team.filter(p => !assigned.has(p.id));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const memberUpdates = data.updates.filter(u => children.some(c => c.id === u.taskId));
  const myUpdates = data.updates.filter(u => u.taskId === task.id);

  const assign = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const n = await workTasksApi.assignToMembers(task.id, picked);
      setNotice({ ok: true, text: `Assigned to ${n} team member${n === 1 ? '' : 's'}.` });
      setPicked([]);
      await data.reload();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not assign.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4" aria-label={task.title}>
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
        </div>
        <StatusPill status={task.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-slate-200">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
              <UserPlus className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> Assign to team members
            </div>
            {available.length === 0 ? (
              <p className="text-[11px] text-slate-400">{team.length === 0 ? 'Your team has no active members yet.' : 'Every team member already has this task.'}</p>
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
                      <StatusPill status={c.status} />
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={c.progress} label={`Progress of ${nameOf(data.people, c.assigneeId)}`} />
                    </div>
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
          <UpdateForm
            task={task}
            sendTo="Department Head"
            onSubmit={async input => {
              await workTasksApi.submitUpdate(task.id, input);
              await data.reload();
            }}
          />
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

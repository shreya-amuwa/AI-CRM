import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { summarize, useWorkTasks } from '../../lib/workTasks';
import { DueLabel, EmptyState, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateTimeline } from './TaskParts';
import { MyUpdateRequests, TaskWorkUpdates } from './WorkUpdates';
import { TaskTracker } from './TaskTracker';
import { SubmitWorkUpdate } from './WorkUpdateForm';

/** Team Member: tasks from the Team Lead; send updates back to the Team Lead. */
export const MemberTasksView: React.FC = () => {
  const { profile } = useAuth();
  const data = useWorkTasks();
  const mine = data.tasks.filter(t => t.assigneeId === profile?.id);
  const s = summarize(mine);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">My Tasks</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Tasks from your Team Lead. Send an update when you make progress or finish.</p>
      </div>
      {data.error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">{data.error}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Assigned to me', value: s.total, tone: 'text-slate-900' },
          { label: 'Completed', value: s.completed, tone: 'text-emerald-700' },
          { label: 'Open', value: s.open, tone: 'text-blue-700' },
          { label: 'Overdue', value: s.overdue, tone: 'text-rose-700' }
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <div className="text-[11px] text-slate-500">{k.label}</div>
            <div className={`text-2xl font-bold ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>
      {/* update requests from the Team Lead / Department Head: the answer form never changes a task */}
      <MyUpdateRequests />
      <TaskTracker tasks={mine} people={data.people} meId={profile?.id ?? ''} loading={data.loading} onChanged={() => void data.reload()}
        filters={['ALL', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'OVERDUE', 'AWAITING']} title="My task tracker" emptyHint="When your Team Lead assigns you a task it appears here." />
      {data.loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : mine.length === 0 ? (
        <EmptyState title="No tasks yet" hint="When your Team Lead assigns you a task it appears here." />
      ) : (
        mine.map(task => (
          <article key={task.id} className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-label={task.title}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{task.title}</h2>
                  <PriorityPill priority={task.priority} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  From <strong className="text-slate-700">{nameOf(data.people, task.assignedBy)}</strong> · <DueLabel task={task} />
                </p>
                {task.assignmentNote && <p className="text-xs font-semibold text-blue-800 mt-1.5" data-testid="member-share">Your part: {task.assignmentNote}</p>}
                {task.description && <p className="text-xs text-slate-600 mt-1.5 whitespace-pre-line">{task.description}</p>}
              </div>
              <StatusPill status={task.status} />
            </div>
            <ProgressBar value={task.progress} label={`Progress of ${task.title}`} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60"><SubmitWorkUpdate taskId={task.id} status={task.status} progress={task.progress} onSent={() => void data.reload()} /></div>
              <div className="p-3 rounded-xl border border-slate-200">
                <div className="text-xs font-bold text-slate-800 mb-2">Updates you sent</div>
                <UpdateTimeline updates={data.updates.filter(u => u.taskId === task.id)} people={data.people} />
              </div>
            </div>
            <TaskWorkUpdates taskId={task.id} />
          </article>
        ))
      )}
    </div>
  );
};

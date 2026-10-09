import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { summarize, workTasksApi, type TaskStatus, type WorkTaskData } from '../../lib/workTasks';
import { fmtDay, useCustomerOptions } from '../../lib/support';
import { DueLabel, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateForm, UpdateTimeline } from '../tasks/TaskParts';
import { Empty, ErrorBanner, KpiCard, Loading, PageHeader } from './SupportParts';

const FILTERS: { id: TaskStatus | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'ASSIGNED', label: 'Pending' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'BLOCKED', label: 'Blocked' },
  { id: 'COMPLETED', label: 'Completed' }
];

/** Tasks the Team Lead assigned to this member. Updates go back to the Team Lead. */
export const TasksPage: React.FC<{ tasks: WorkTaskData; onOpenCustomer?: (id: string) => void }> = ({ tasks, onOpenCustomer }) => {
  const { profile } = useAuth();
  const customers = useCustomerOptions();
  const [filter, setFilter] = useState<TaskStatus | 'ALL'>('ALL');
  const mine = tasks.tasks.filter(t => t.assigneeId === profile?.id);
  const s = summarize(mine);
  const shown = mine.filter(t => filter === 'ALL' || t.status === filter);

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Assigned Tasks" subtitle="Tasks from your Team Lead. Update your progress, mark them completed, or report what is blocking you." />
      {tasks.error && <ErrorBanner message={tasks.error} onRetry={() => void tasks.reload()} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Assigned to me" value={s.total} />
        <KpiCard label="Pending / in progress" value={s.notStarted + s.inProgress} tone="text-blue-700" />
        <KpiCard label="Blocked" value={s.blocked} tone="text-amber-700" />
        <KpiCard label="Completed" value={s.completed} tone="text-emerald-700" hint={s.overdue ? `${s.overdue} overdue` : undefined} />
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${filter === f.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {tasks.loading ? (
        <Loading label="Loading tasks…" />
      ) : shown.length === 0 ? (
        <Empty title={mine.length === 0 ? 'No tasks assigned yet' : 'No tasks in this view'} hint="When your Team Lead assigns you a task it appears here automatically." />
      ) : (
        shown.map(task => {
          const customer = customers.find(c => c.id === task.customerId);
          return (
            <article key={task.id} className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-label={task.title}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900">{task.title}</h2>
                    <PriorityPill priority={task.priority} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      Assigned by <strong className="text-slate-700">{nameOf(tasks.people, task.assignedBy)}</strong>
                    </span>
                    <span>Assigned {fmtDay(task.createdAt)}</span>
                    <DueLabel task={task} />
                  </p>
                  {customer && (
                    <p className="text-xs mt-1 text-slate-500">
                      Customer:{' '}
                      {onOpenCustomer ? (
                        <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => onOpenCustomer(customer.id)}>
                          {customer.name}
                        </button>
                      ) : (
                        <strong className="text-slate-700">{customer.name}</strong>
                      )}{' '}
                      <span className="font-mono text-slate-400">{customer.code}</span>
                    </p>
                  )}
                  {task.description && <p className="text-xs text-slate-600 mt-1.5 whitespace-pre-line">{task.description}</p>}
                  {task.lastUpdateNote && (
                    <p className="text-[11px] text-slate-500 mt-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <strong>Latest note:</strong> {task.lastUpdateNote}
                    </p>
                  )}
                </div>
                <StatusPill status={task.status} />
              </div>
              <ProgressBar value={task.progress} label={`Progress of ${task.title}`} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <UpdateForm
                  task={task}
                  sendTo="Team Lead"
                  onSubmit={async input => {
                    await workTasksApi.submitUpdate(task.id, input);
                    await tasks.reload();
                  }}
                />
                <div className="p-3 rounded-xl border border-slate-200">
                  <div className="text-xs font-bold text-slate-800 mb-2">Update history</div>
                  <UpdateTimeline updates={tasks.updates.filter(u => u.taskId === task.id)} people={tasks.people} />
                </div>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
};

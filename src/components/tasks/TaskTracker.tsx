import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { isOverdue, type Person, type WorkTask } from '../../lib/workTasks';
import { useWorkUpdatesLoader, workUpdatesApi } from '../../lib/workUpdates';
import { DueLabel, EmptyState, nameOf, PriorityPill, ProgressBar, StatusPill } from './TaskParts';
import { Avatar } from './PeoplePicker';
import { TaskCardDelete } from './TaskCardDelete';
import { TaskDetails } from './TaskDetails';
import { peekPendingWorkUpdate, useOpenWorkUpdateTask } from './workUpdateEvents';
import { ago, FILTER_LABEL, matchesFilter, sortTasks, trackerStats, type TrackerFilter } from './taskView';

/**
 * The ids of the tasks somebody is waiting on an update for: an open update request on the task. Only requests the signed-in person may see
 * come back (the database decides), so a Team Lead sees their own and their team's, never another lead's.
 */
export function useAwaitingTaskIds(): Set<string> {
  const { data } = useWorkUpdatesLoader(() => workUpdatesApi.list('PENDING', 200, 0).catch(() => null), []);
  return useMemo(() => new Set((data?.items ?? []).map(r => r.taskId)), [data]);
}

const PAGE = 15;

const Card: React.FC<{ label: string; value: number; tone?: string; active?: boolean; onClick?: () => void }> = ({ label, value, tone = 'text-slate-900', active, onClick }) => (
  <button type="button" onClick={onClick} aria-pressed={active}
    className={`rounded-2xl border bg-white p-3.5 text-left transition-colors hover:border-blue-300 ${active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200'}`}>
    <div className="text-[11px] font-medium text-slate-500">{label}</div>
    <div className={`mt-0.5 text-2xl font-bold ${tone}`}>{value}</div>
  </button>
);

/**
 * Task tracking dashboard: summary cards, filters, search and sorting over the tasks the signed-in person may already see, and a card per task with
 * the assignee, priority, due date, progress and latest update. A task opens in the details panel. Everything shown is calculated from what the database
 * returned: "overdue" from the due date, "blocked" from the status, "awaiting update" from an open update request. Progress is the employee's own report.
 */
export const TaskTracker: React.FC<{
  tasks: WorkTask[];
  people: Person[];
  meId: string;
  /** Filters offered besides the always-present ones (a Team Member has no "Assigned by Me"). */
  filters?: TrackerFilter[];
  title?: string;
  emptyHint?: string;
  loading?: boolean;
  onChanged?: () => void;
  /** the tasks the signed-in person may delete (useWorkTasks().deletable): those cards get a Delete option */
  deletable?: Set<string>;
}> = ({ tasks, people, meId, filters = ['ALL', 'MINE', 'BY_ME', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'OVERDUE', 'AWAITING'], title = 'Task tracker', emptyHint, loading, onChanged, deletable }) => {
  const awaiting = useAwaitingTaskIds();
  const [filter, setFilter] = useState<TrackerFilter>('ALL');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  // a task notification was clicked: open that task (the database decides whether this person may read it)
  useEffect(() => { const p = peekPendingWorkUpdate(); if (p?.taskId && tasks.some(t => t.id === p.taskId)) setOpenId(p.taskId); }, [tasks]);
  useOpenWorkUpdateTask(id => { if (id) setOpenId(id); });

  const stats = useMemo(() => trackerStats(tasks, awaiting), [tasks, awaiting]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sortTasks(tasks.filter(t =>
      matchesFilter(t, filter, meId, awaiting)
      && (!s || `${t.title} ${nameOf(people, t.assigneeId)} ${nameOf(people, t.assignedBy)}`.toLowerCase().includes(s))));
  }, [tasks, filter, q, meId, awaiting, people]);
  const pick = (f: TrackerFilter) => { setFilter(f); setShown(PAGE); };
  const visible = list.slice(0, shown);

  return (
    <section className="space-y-3" aria-label={title} data-testid="task-tracker">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7">
        <Card label="Total tasks" value={stats.total} active={filter === 'ALL'} onClick={() => pick('ALL')} />
        <Card label="Assigned" value={stats.assigned} tone="text-slate-700" />
        <Card label="In progress" value={stats.inProgress} tone="text-blue-700" active={filter === 'IN_PROGRESS'} onClick={() => pick('IN_PROGRESS')} />
        <Card label="Blocked" value={stats.blocked} tone="text-amber-700" active={filter === 'BLOCKED'} onClick={() => pick('BLOCKED')} />
        <Card label="Completed" value={stats.completed} tone="text-emerald-700" active={filter === 'COMPLETED'} onClick={() => pick('COMPLETED')} />
        <Card label="Overdue" value={stats.overdue} tone="text-rose-700" active={filter === 'OVERDUE'} onClick={() => pick('OVERDUE')} />
        <Card label="Awaiting update" value={stats.awaiting} tone="text-violet-700" active={filter === 'AWAITING'} onClick={() => pick('AWAITING')} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Task filters" className="flex gap-1.5 overflow-x-auto pb-1">
          {filters.map(f => (
            <button key={f} role="tab" type="button" aria-selected={filter === f} onClick={() => pick(f)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${filter === f ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search task or employee" aria-label="Search tasks"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
      <p className="text-[11px] text-slate-500" aria-live="polite">{list.length} task{list.length === 1 ? '' : 's'} · overdue first, then by priority and due date</p>

      {loading && tasks.length === 0 ? <p className="text-xs text-slate-500">Loading…</p> : list.length === 0 ? (
        <EmptyState title={tasks.length === 0 ? 'No tasks yet' : 'No tasks match'} hint={tasks.length === 0 ? emptyHint : 'Try another filter or search.'} />
      ) : (
        <ul className="space-y-2">
          {visible.map(t => {
            const overdue = isOverdue(t);
            const name = nameOf(people, t.assigneeId);
            return (
              <li key={t.id} className="relative">
                <button type="button" onClick={() => setOpenId(t.id)} aria-label={`Open ${t.title}`} data-testid="tracker-task"
                  className={`w-full rounded-2xl border bg-white p-3.5 text-left transition-colors hover:border-blue-300 hover:shadow-sm ${deletable?.has(t.id) ? 'pb-11 sm:pb-3.5 sm:pr-24' : ''} ${overdue ? 'border-rose-200' : t.status === 'BLOCKED' ? 'border-amber-300' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={name} id={t.assigneeId} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-bold text-slate-900">{t.title}</span>
                          <PriorityPill priority={t.priority} />
                        </div>
                        <div className="text-[11px] text-slate-500">{name}{t.assignedBy !== meId ? ` · from ${nameOf(people, t.assignedBy)}` : ''}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {overdue && <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Overdue</span>}
                      {awaiting.has(t.id) && t.status !== 'COMPLETED' && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Awaiting update</span>}
                      <StatusPill status={t.status} />
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex-1"><ProgressBar value={t.progress} label={`Progress of ${t.title}`} /></div>
                    <span className="w-9 text-right text-[11px] font-bold text-slate-700">{t.progress}%</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                    <DueLabel task={t} />
                    <span>Last update: {ago(t.lastUpdateAt)}</span>
                    {t.lastUpdateNote && <span className="max-w-full truncate text-slate-600">“{t.lastUpdateNote}”</span>}
                  </div>
                </button>
                {/* a sibling of the card's button (a button cannot hold another): Delete never opens the task */}
                {deletable?.has(t.id) && <TaskCardDelete task={t} assigneeName={name} className="absolute bottom-3 right-3" onDeleted={onChanged} />}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown(n => n + PAGE)} className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Show more ({list.length - shown} left)
        </button>
      )}
      {openId && <TaskDetails taskId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </section>
  );
};

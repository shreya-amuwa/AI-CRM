import { isOverdue, type TaskPriority, type WorkTask } from '../../lib/workTasks';

/**
 * What the task screens derive from a task, in one place. Nothing here is stored: "overdue" is calculated from the due date and the status (an
 * employee can never set it), "blocked" is the status, and "awaiting an update" is an open update request on the task.
 */
export type TrackerFilter = 'ALL' | 'MINE' | 'BY_ME' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'OVERDUE' | 'AWAITING';

export const FILTER_LABEL: Record<TrackerFilter, string> = {
  ALL: 'All Tasks', MINE: 'My Tasks', BY_ME: 'Assigned by Me', IN_PROGRESS: 'In Progress', BLOCKED: 'Blocked', COMPLETED: 'Completed', OVERDUE: 'Overdue', AWAITING: 'Awaiting Update'
};

export const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export interface TrackerStats { total: number; assigned: number; inProgress: number; blocked: number; completed: number; overdue: number; awaiting: number }

export function trackerStats(tasks: WorkTask[], awaiting: Set<string>): TrackerStats {
  return {
    total: tasks.length,
    assigned: tasks.filter(t => t.status === 'ASSIGNED').length,
    inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
    blocked: tasks.filter(t => t.status === 'BLOCKED').length,
    completed: tasks.filter(t => t.status === 'COMPLETED').length,
    overdue: tasks.filter(isOverdue).length,
    awaiting: tasks.filter(t => awaiting.has(t.id) && t.status !== 'COMPLETED').length
  };
}

export function matchesFilter(t: WorkTask, f: TrackerFilter, meId: string, awaiting: Set<string>): boolean {
  switch (f) {
    case 'ALL': return true;
    case 'MINE': return t.assigneeId === meId;
    case 'BY_ME': return t.assignedBy === meId && t.assigneeId !== meId;
    case 'IN_PROGRESS': return t.status === 'IN_PROGRESS';
    case 'BLOCKED': return t.status === 'BLOCKED';
    case 'COMPLETED': return t.status === 'COMPLETED';
    case 'OVERDUE': return isOverdue(t);
    case 'AWAITING': return awaiting.has(t.id) && t.status !== 'COMPLETED';
  }
}

/** Overdue first, then Urgent / High priority, then the closest due date, then the newest. Finished tasks go last. */
export function sortTasks(tasks: WorkTask[]): WorkTask[] {
  const finished = (t: WorkTask) => (t.status === 'COMPLETED' ? 1 : 0);
  return [...tasks].sort((a, b) =>
    finished(a) - finished(b)
    || Number(isOverdue(b)) - Number(isOverdue(a))
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
    || b.createdAt.localeCompare(a.createdAt));
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

/** "3h ago", "2d ago" - the latest update time on a card. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'No update yet';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

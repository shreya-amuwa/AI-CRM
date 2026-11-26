import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';

/**
 * Work update requests (migration 20270116000100_work_update_requests.sql): a Department Head or Team Lead asks the employee a task is
 * assigned to for a progress update; the employee answers; the answer never changes the task. Like the rest of the Task module this talks
 * to Supabase with the signed-in session, and the database functions decide who may ask, answer or read. Nothing here sends a role or a user id:
 * the person asked is the task's assignee, read by the database.
 */

export type WorkUpdateStatus = 'PENDING' | 'RESPONDED';
export type WorkUpdateFilter = 'ALL' | 'PENDING' | 'RESPONDED' | 'OVERDUE';

export interface WorkUpdateResponse {
  id: string;
  progress: string;
  workCompleted: string | null;
  remainingWork: string | null;
  blockers: string | null;
  expectedCompletion: string | null;
  submittedAt: string;
}

export interface WorkUpdateRequest {
  id: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string | null;
  taskStatus: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_COMPLETED' | 'BLOCKED';
  taskProgress: number;
  taskDueDate: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  requestedBy: string | null;
  requestedByName: string | null;
  requestedFrom: string;
  requestedFromName: string;
  employeeRole: string;
  message: string | null;
  dueAt: string | null;
  status: WorkUpdateStatus;
  overdue: boolean;
  followupCount: number;
  lastNotifiedAt: string;
  createdAt: string;
  respondedAt: string | null;
  /** What the viewer may do with it (the database decides again when they do it). */
  canRespond: boolean;
  canFollowUp: boolean;
  followUpAvailableAt: string | null;
  response: WorkUpdateResponse | null;
}

export interface WorkUpdateCounts { all: number; pending: number; responded: number; overdue: number }
export interface WorkUpdateList { filter: WorkUpdateFilter; counts: WorkUpdateCounts; items: WorkUpdateRequest[] }
export interface MyUpdateRequests { pending: number; responded: number; items: WorkUpdateRequest[] }

export interface TaskTimelineEntry {
  kind: 'TASK_ASSIGNED' | 'TASK_UPDATE' | 'WORK_UPDATE_REQUESTED' | 'WORK_UPDATE_FOLLOW_UP' | 'WORK_UPDATE_RESPONDED';
  at: string;
  actorName: string | null;
  note: string | null;
  data: Record<string, unknown>;
}
export interface TaskWorkUpdates {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  /** May the signed-in person ask for an update now (their hierarchy, not completed, none waiting). */
  canRequest: boolean;
  canManage: boolean;
  requests: WorkUpdateRequest[];
  timeline: TaskTimelineEntry[];
}

export interface WorkUpdateAnswer {
  progress: string;
  workCompleted?: string;
  remainingWork?: string;
  blockers?: string;
  expectedCompletion?: string | null;
}

/** Turns "VALIDATION_ERROR: Choose ..." into "Choose ...". */
const cleanError = (message: string) => message.replace(/^[A-Z_]+:\s*/, '');

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}

export const workUpdatesApi = {
  /** Ask for an update on a task (Department Head / Team Lead). The employee is the task's assignee. */
  request: (taskId: string, message?: string, dueAt?: string | null) =>
    rpc<WorkUpdateRequest>('work_update_request', { p_task: taskId, p_message: message?.trim() || null, p_due: dueAt || null }),
  /** A reminder on the open request (not a second request). */
  followUp: (requestId: string, message?: string) => rpc<WorkUpdateRequest>('work_update_follow_up', { p_request: requestId, p_message: message?.trim() || null }),
  /** The employee answers their own request. The task itself is not changed. */
  respond: (requestId: string, a: WorkUpdateAnswer) =>
    rpc<WorkUpdateRequest>('work_update_respond', {
      p_request: requestId, p_progress: a.progress, p_completed: a.workCompleted?.trim() || null, p_remaining: a.remainingWork?.trim() || null,
      p_blockers: a.blockers?.trim() || null, p_expected: a.expectedCompletion || null
    }),
  myRequests: (status?: WorkUpdateStatus) => rpc<MyUpdateRequests>('work_update_my_requests', { p_status: status ?? null }),
  list: (filter: WorkUpdateFilter = 'ALL', limit = 50, offset = 0) => rpc<WorkUpdateList>('work_update_list', { p_filter: filter, p_limit: limit, p_offset: offset }),
  forTask: (taskId: string) => rpc<TaskWorkUpdates>('work_update_for_task', { p_task: taskId })
};

/** Fired when a work update notification arrives (a request, a reminder, a submitted update): open lists reload. */
export const WORK_UPDATES_CHANGED_EVENT = 'crm:work-updates-changed';
export const notifyWorkUpdatesChanged = () => window.dispatchEvent(new CustomEvent(WORK_UPDATES_CHANGED_EVENT));

/** Reloads (and re-runs `load`) whenever a work update notification arrives or the browser tab is shown again. */
export function useWorkUpdatesLoader<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => { setError(null); return load().then(d => setData(d)).catch(e => setError(e instanceof Error ? e.message : 'Something went wrong.')).finally(() => setLoading(false)); }, deps);
  useEffect(() => {
    setLoading(true);
    run();
    const on = () => { run(); };
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener(WORK_UPDATES_CHANGED_EVENT, on);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener(WORK_UPDATES_CHANGED_EVENT, on); document.removeEventListener('visibilitychange', onVisible); };
  }, [run]);
  return { data, error, loading, reload: run };
}

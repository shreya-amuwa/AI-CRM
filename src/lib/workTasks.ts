import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';
import { listenToTables } from './realtimeShared';
import { api } from './api/client';
import type { TaskDeletePreview, TaskDeleteResult } from '../../shared/contracts';

/**
 * Work tasks (migration 20261008000600_work_tasks.sql):
 *   Department Head → Team Lead → Team Member, updates flow back up.
 * Reads and writes go straight to Supabase; RLS limits every user to the
 * tasks they may see, and the database functions enforce the hierarchy.
 */

export type TaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_COMPLETED' | 'BLOCKED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface WorkTask {
  id: string;
  departmentId: string;
  teamId: string | null;
  parentId: string | null;
  customerId: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  assignedBy: string;
  assigneeId: string;
  status: TaskStatus;
  progress: number;
  lastUpdateNote: string | null;
  lastUpdateAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** A Team Member's share of the Team Lead's task (20261224000300), set by the Team Lead; null = the whole task. */
  assignmentNote: string | null;
  /** 20261230000300: the function of an Operations Head's task, and what its owner chose (SELF = works on it, DELEGATED = handed it down). */
  division: 'SALES' | 'SUPPORT' | null;
  handling: 'SELF' | 'DELEGATED' | null;
}

/** A Department Head an Operations Head may give a task to, for one department and function. */
/** A Team Lead or Team Member a Department Head / Operations Head may give a task to directly (task_direct_assignees, 20270114000100). */
export interface DirectAssignee {
  id: string;
  name: string;
  role: 'TEAM_HEAD' | 'TEAM_MEMBER';
  teamId: string | null;
  team: string | null;
  departmentId: string;
  department: string | null;
  teamLeadId: string | null;
  teamLead: string | null;
}

export interface OperationsAssignee { id: string; name: string; departmentId: string; department: string; function: 'SALES' | 'SUPPORT' | 'ALL' }
/** One task with everything below it (task_hierarchy / operations_tasks). */
export interface TaskNode {
  id: string; parentId: string | null; title: string; description: string | null; assignmentNote: string | null;
  priority: TaskPriority; status: TaskStatus; progress: number; function: 'SALES' | 'SUPPORT' | 'ALL'; handling: 'SELF' | 'DELEGATED' | null;
  assignee: { id: string; name: string; role: string }; assignedBy: { id: string; name: string };
  department: string | null; team: string | null; assignedAt: string; dueDate: string | null; completedAt: string | null;
  latestUpdate: { note: string; at: string } | null; children: TaskNode[];
}

export interface WorkTaskUpdate {
  id: string;
  taskId: string;
  authorId: string | null;
  status: TaskStatus;
  progress: number;
  note: string | null;
  createdAt: string;
}

export interface Person {
  id: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER';
  teamId: string | null;
  departmentId: string | null;
  status: string;
  /** The job title shown next to the name (profiles.position), when the person's record has one. */
  position?: string | null;
}

export interface TeamRef {
  id: string;
  name: string;
  division: 'SALES' | 'SUPPORT' | 'GENERAL' | null;
}

const toTask = (r: any): WorkTask => ({
  id: r.id,
  departmentId: r.department_id,
  teamId: r.team_id,
  parentId: r.parent_id,
  customerId: r.customer_id ?? null,
  title: r.title,
  description: r.description,
  priority: r.priority,
  dueDate: r.due_date,
  assignedBy: r.assigned_by,
  assigneeId: r.assignee_id,
  status: r.status,
  progress: r.progress,
  lastUpdateNote: r.last_update_note,
  lastUpdateAt: r.last_update_at,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  assignmentNote: r.assignment_note ?? null,
  division: r.division ?? null,
  handling: r.handling ?? null
});

const toUpdate = (r: any): WorkTaskUpdate => ({
  id: r.id,
  taskId: r.task_id,
  authorId: r.author_id,
  status: r.status,
  progress: r.progress,
  note: r.note,
  createdAt: r.created_at
});

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  return supabase;
}

/** Turns "VALIDATION_ERROR: Choose ..." into "Choose ...". */
function cleanError(message: string): string {
  return message.replace(/^[A-Z_]+:\s*/, '');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}

/** Dispatched after a task is deleted in this tab, so every task list and dashboard count on the page reloads. */
export const WORK_TASKS_CHANGED_EVENT = 'crm:work-tasks-changed';
export const notifyWorkTasksChanged = () => window.dispatchEvent(new Event(WORK_TASKS_CHANGED_EVENT));

export const workTasksApi = {
  assignToTeamLead: (input: { assigneeId: string; title: string; description?: string; priority: TaskPriority; dueDate?: string | null }) =>
    rpc<string>('assign_task_to_team_lead', {
      p_assignee: input.assigneeId,
      p_title: input.title,
      p_description: input.description || null,
      p_priority: input.priority,
      p_due: input.dueDate || null
    }),
  /** The Team Lead's own team members (ordinary ones are the ones a task may be given to). Everyone else's people never arrive: the database decides. */
  myTeamMembers: () => rpc<{ id: string; fullName: string; position: string | null; ordinary: boolean }[]>('my_team_members', {}),
  /** Team lead → team members directly (optionally about a customer). */
  assignTeamTask: (input: { title: string; description?: string; priority: TaskPriority; dueDate?: string | null; customerId?: string | null; memberIds: string[] }) =>
    rpc<number>('assign_team_task', {
      p_title: input.title,
      p_description: input.description || null,
      p_priority: input.priority,
      p_due: input.dueDate || null,
      p_customer: input.customerId || null,
      p_members: input.memberIds
    }),
  assignToMembers: (taskId: string, memberIds: string[]) => rpc<number>('assign_task_to_members', { p_task: taskId, p_members: memberIds }),
  /** The Team Lead hands the task to their own members, each with an optional share of the work. A database without 20261224000300 gets the
   *  plain delegation (no shares) instead, so the button keeps working before the migration is run. */
  delegate: async (taskId: string, assignments: { memberId: string; work?: string }[]): Promise<number> => {
    const clean = assignments.map(a => ({ memberId: a.memberId, ...(a.work?.trim() ? { work: a.work.trim() } : {}) }));
    const { data, error } = await db().rpc('delegate_task_to_members', { p_task: taskId, p_assignments: clean });
    if (!error) return data as number;
    if (/delegate_task_to_members|PGRST202|schema cache/i.test(`${error.code ?? ''} ${error.message}`)) {
      return rpc<number>('assign_task_to_members', { p_task: taskId, p_members: clean.map(a => a.memberId) });
    }
    throw new Error(cleanError(error.message));
  },
  // ---- Skip a level (20270114000100): a Department Head / Operations Head gives a task straight to a Team Lead or a Team Member of their own teams ----
  /** null when the database does not have it yet (before the migration): the screens then keep the one-level-at-a-time choices. */
  directAssignees: async (): Promise<DirectAssignee[] | null> => {
    const { data, error } = await db().rpc('task_direct_assignees', {});
    if (!error) return (data as DirectAssignee[]) ?? [];
    if (/task_direct_assignees|PGRST202|schema cache/i.test(`${error.code ?? ''} ${error.message}`)) return null;
    throw new Error(cleanError(error.message));
  },
  assignDirect: (input: { assigneeId: string; title: string; description?: string; priority: TaskPriority; dueDate?: string | null }) =>
    rpc<string>('assign_task_direct', {
      p_assignee: input.assigneeId, p_title: input.title, p_description: input.description || null, p_priority: input.priority, p_due: input.dueDate || null
    }),
  // ---- Operations Head -> Department Head -> Team Lead -> Team Member (20261230000300) ----
  operationsAssignees: () => rpc<OperationsAssignee[]>('operations_task_assignees', {}),
  assignToDepartmentHead: (input: { assigneeId: string; departmentId: string; fn: 'SALES' | 'SUPPORT' | 'ALL'; title: string; description?: string; priority: TaskPriority; dueDate?: string | null }) =>
    rpc<string>('assign_task_to_department_head', {
      p_assignee: input.assigneeId, p_department: input.departmentId, p_division: input.fn, p_title: input.title,
      p_description: input.description || null, p_priority: input.priority, p_due: input.dueDate || null
    }),
  delegateToTeamLead: (taskId: string, leadId: string, instructions?: string, dueDate?: string | null) =>
    rpc<string>('delegate_task_to_team_lead', { p_task: taskId, p_lead: leadId, p_instructions: instructions?.trim() || null, p_due: dueDate || null }),
  takeMyself: (taskId: string, note?: string) => rpc<void>('take_task_myself', { p_task: taskId, p_note: note?.trim() || null }),
  hierarchy: (taskId: string) => rpc<TaskNode>('task_hierarchy', { p_task: taskId }),
  operationsTasks: () => rpc<TaskNode[]>('operations_tasks', {}),
  submitUpdate: (taskId: string, input: { status: TaskStatus; progress: number; note?: string }) =>
    rpc<void>('submit_task_update', { p_task: taskId, p_status: input.status, p_progress: input.progress, p_note: input.note || null }),
  // ---- Work updates v2 (20270117000100): a structured update kept in the task's history; the database checks who may send it ----
  /** The assignee's work update: status, progress %, what was done, what remains, blockers, next steps, a new expected date; optionally the request it answers. */
  submitWorkUpdate: (taskId: string, u: WorkUpdateInput) =>
    rpc<{ id: string; taskId: string; status: TaskStatus; progress: number; at: string; requestId: string | null }>('submit_work_update', {
      p_task: taskId, p_status: u.status, p_progress: u.progress, p_completed: u.workCompleted?.trim() || null, p_remaining: u.remainingWork?.trim() || null,
      p_blockers: u.blockers?.trim() || null, p_next: u.nextSteps?.trim() || null, p_expected: u.expectedCompletion || null, p_request: u.requestId || null
    }),
  /** One task in full: overview, progress history, update requests, activity timeline. Only for people who may already read the task. */
  details: (taskId: string) => rpc<TaskDetailsData>('work_task_details', { p_task: taskId }),
  // ---- Deleting an assigned task (20270220000100): through the API, which calls the database function that checks the caller's role and scope ----
  /** Whether the signed-in person may delete the task and what goes with it; null when the server cannot say (e.g. before the migration): no button. */
  deletePreview: async (taskId: string): Promise<TaskDeletePreview | null> => {
    try { return await api.get<TaskDeletePreview>(`/work-tasks/${taskId}/delete-preview`); } catch { return null; }
  },
  deleteTask: (taskId: string) => api.delete<TaskDeleteResult>(`/work-tasks/${taskId}`)
};

export interface WorkUpdateInput {
  status: Exclude<TaskStatus, 'ASSIGNED'>;
  progress: number;
  workCompleted?: string;
  remainingWork?: string;
  blockers?: string;
  nextSteps?: string;
  expectedCompletion?: string | null;
  requestId?: string | null;
}

export interface TaskUpdateRecord {
  id: string; at: string; authorId: string | null; authorName: string | null; status: TaskStatus; progress: number;
  workCompleted: string | null; remainingWork: string | null; blockers: string | null; nextSteps: string | null; expectedCompletion: string | null;
  note: string | null; requestId: string | null;
}
export interface TaskTimelineItem {
  kind: 'TASK_CREATED' | 'TASK_ASSIGNED' | 'PROGRESS_UPDATE' | 'WORK_UPDATE_REQUESTED' | 'WORK_UPDATE_FOLLOW_UP' | 'WORK_UPDATE_RESPONDED';
  at: string; actorName: string | null; note: string | null; data: Record<string, any>;
}
export interface TaskDetailsData {
  task: {
    id: string; parentId: string | null; title: string; description: string | null; priority: TaskPriority; status: TaskStatus; progress: number; dueDate: string | null;
    createdAt: string; completedAt: string | null; lastUpdateAt: string | null; lastUpdateNote: string | null; assignmentNote: string | null; handling: 'SELF' | 'DELEGATED' | null;
    overdue: boolean; blocked: boolean;
    assignee: { id: string; name: string; role: string; designation: string | null; team: string | null; department: string | null } | null;
    assignedBy: { id: string; name: string; designation: string | null } | null;
    customer: { id: string; name: string; code: string } | null;
  };
  updates: TaskUpdateRecord[];
  requests: import('./workUpdates').WorkUpdateRequest[];
  canUpdate: boolean;
  canRequest: boolean;
  canManage: boolean;
  timeline: TaskTimelineItem[];
}

export interface WorkTaskData {
  tasks: WorkTask[];
  updates: WorkTaskUpdate[];
  people: Person[];
  teams: TeamRef[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads every task / update / person the signed-in user may see and keeps it live. */
export function useWorkTasks(): WorkTaskData {
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [updates, setUpdates] = useState<WorkTaskUpdate[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<TeamRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setError('The CRM is not connected to its database.');
      setLoading(false);
      return;
    }
    const [t, u, p, tm] = await Promise.all([
      supabase.from('work_tasks').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('work_task_updates').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('profiles').select('id, full_name, role, team_id, department_id, status, position').order('full_name'),
      supabase.from('teams').select('id, name, division')
    ]);
    const firstError = t.error || u.error || p.error || tm.error;
    if (firstError) setError(cleanError(firstError.message));
    else setError(null);
    if (!t.error) setTasks((t.data || []).map(toTask));
    if (!u.error) setUpdates((u.data || []).map(toUpdate));
    if (!p.error)
      setPeople(
        (p.data || []).map((r: any) => ({
          id: r.id,
          fullName: r.full_name,
          role: r.role,
          teamId: r.team_id,
          departmentId: r.department_id,
          status: r.status,
          position: r.position ?? null
        }))
      );
    if (!tm.error) setTeams((tm.data || []).map((r: any) => ({ id: r.id, name: r.name, division: r.division ?? null })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 250);
    };
    // one channel per tab for the task tables, shared with every other task list on the page
    const stop = listenToTables(['work_tasks', 'work_task_updates'], refresh);
    // a task deleted in this tab: every list and count on the page reloads at once, without waiting for realtime
    window.addEventListener(WORK_TASKS_CHANGED_EVENT, refresh);
    return () => {
      clearTimeout(timer);
      stop();
      window.removeEventListener(WORK_TASKS_CHANGED_EVENT, refresh);
    };
  }, [reload]);

  return { tasks, updates, people, teams, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Helpers shared by the dashboards
// ---------------------------------------------------------------------------
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const isOverdue = (t: WorkTask) => !!t.dueDate && t.status !== 'COMPLETED' && t.dueDate < localDateKey();

export function summarize(list: WorkTask[]) {
  const total = list.length;
  const completed = list.filter(t => t.status === 'COMPLETED').length;
  const inProgress = list.filter(t => t.status === 'IN_PROGRESS').length;
  const notStarted = list.filter(t => t.status === 'ASSIGNED').length;
  const notCompleted = list.filter(t => t.status === 'NOT_COMPLETED').length;
  const blocked = list.filter(t => t.status === 'BLOCKED').length;
  const overdue = list.filter(isOverdue).length;
  return { total, completed, inProgress, notStarted, notCompleted, blocked, open: inProgress + notStarted + blocked, overdue, pct: total ? Math.round((completed / total) * 100) : 0 };
}

/** A task a team lead gave straight to a team member (no department-head task above it). */
export const isDirectMemberTask = (t: WorkTask, people: Person[]) =>
  t.parentId === null && people.find(p => p.id === t.assignedBy)?.role === 'TEAM_HEAD';

export interface TeamMember { id: string; fullName: string; position: string | null; ordinary: boolean }

/**
 * The signed-in Team Lead's own team members, from the database (direct reports only, specialists flagged). A failure is returned, never turned into an empty
 * list: a roster that silently comes back empty looks like "I have no team".
 */
export function useMyTeamMembers(): { members: TeamMember[]; loading: boolean; error: string | null; reload: () => void } {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    workTasksApi.myTeamMembers().then(
      rows => { setMembers(rows ?? []); setError(null); setLoading(false); },
      e => { setError(cleanError(e instanceof Error ? e.message : String(e))); setLoading(false); }
    );
  }, []);
  useEffect(reload, [reload]);
  return { members, loading, error, reload };
}

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';

/**
 * Work tasks (migration 20261008000600_work_tasks.sql):
 *   Department Head → Team Lead → Team Member, updates flow back up.
 * Reads and writes go straight to Supabase; RLS limits every user to the
 * tasks they may see, and the database functions enforce the hierarchy.
 */

export type TaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface WorkTask {
  id: string;
  departmentId: string;
  teamId: string | null;
  parentId: string | null;
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
}

export interface TeamRef {
  id: string;
  name: string;
}

const toTask = (r: any): WorkTask => ({
  id: r.id,
  departmentId: r.department_id,
  teamId: r.team_id,
  parentId: r.parent_id,
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
  createdAt: r.created_at
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

export const workTasksApi = {
  assignToTeamLead: (input: { assigneeId: string; title: string; description?: string; priority: TaskPriority; dueDate?: string | null }) =>
    rpc<string>('assign_task_to_team_lead', {
      p_assignee: input.assigneeId,
      p_title: input.title,
      p_description: input.description || null,
      p_priority: input.priority,
      p_due: input.dueDate || null
    }),
  assignToMembers: (taskId: string, memberIds: string[]) => rpc<number>('assign_task_to_members', { p_task: taskId, p_members: memberIds }),
  submitUpdate: (taskId: string, input: { status: TaskStatus; progress: number; note?: string }) =>
    rpc<void>('submit_task_update', { p_task: taskId, p_status: input.status, p_progress: input.progress, p_note: input.note || null })
};

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
      supabase.from('profiles').select('id, full_name, role, team_id, department_id, status').order('full_name'),
      supabase.from('teams').select('id, name')
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
          status: r.status
        }))
      );
    if (!tm.error) setTeams((tm.data || []).map((r: any) => ({ id: r.id, name: r.name })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const supabase = getSupabase();
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 250);
    };
    const channel = supabase
      .channel(`work-tasks-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_tasks' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_task_updates' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
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
  const overdue = list.filter(isOverdue).length;
  return { total, completed, inProgress, notStarted, notCompleted, overdue, pct: total ? Math.round((completed / total) * 100) : 0 };
}

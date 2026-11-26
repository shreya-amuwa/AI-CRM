import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskDeletePreview, TaskDeleteResult } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * Deleting a Task module task (20270220000100). The database function reads the caller from the login and decides whether they may delete it
 * (the Team Lead who gave it; the Department Head / Operations Head whose department and function it is in); nothing here names a role.
 */
export class WorkTaskRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  deletePreview(id: string) { return this.rpc<TaskDeletePreview>('work_task_delete_preview', { p_task: id }); }
  remove(id: string) { return this.rpc<TaskDeleteResult>('work_task_delete', { p_task: id }); }
}

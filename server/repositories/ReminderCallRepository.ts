import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReminderCallList } from '../../shared/contracts.js';
import type { ReminderCallListQuery } from '../../shared/validation.js';
import { unwrap } from './base.js';

/** The BolifyAI recharge reminder calls. The database function checks the caller (Super Admin, HR staff) and masks the numbers. */
export class ReminderCallRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list(q: ReminderCallListQuery): Promise<ReminderCallList> {
    return unwrap(await this.db.rpc('sub_reminder_calls', { p_filter: q.filter, p_limit: q.pageSize, p_offset: (q.page - 1) * q.pageSize })) as ReminderCallList;
  }
}

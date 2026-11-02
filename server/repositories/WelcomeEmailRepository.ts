import type { SupabaseClient } from '@supabase/supabase-js';
import type { WelcomeEmailItem, WelcomeEmailList } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The welcome e-mail status of employees and the resend. Both are database functions that check the caller (HR, Super Admin, the employee's Department Head). */
export class WelcomeEmailRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list(q: { status?: string; employee?: string }): Promise<WelcomeEmailList> {
    return unwrap(await this.db.rpc('welcome_emails_list', { p_status: q.status ?? null, p_employee: q.employee ?? null })) as WelcomeEmailList;
  }
  async resend(employeeId: string): Promise<WelcomeEmailItem> {
    return unwrap(await this.db.rpc('welcome_email_resend', { p_employee: employeeId })) as WelcomeEmailItem;
  }
}

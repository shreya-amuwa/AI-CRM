import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationHealthDetail, NotificationHealthReport } from '../../shared/contracts.js';
import type { NotificationHealthQuery } from '../../shared/validation.js';
import { unwrap } from './base.js';

/**
 * Notification Health (migration 20270126000200), as the caller: the database functions allow HR staff and the Super Admin only and audit
 * every read; this layer only calls them.
 */
export class NotificationHealthRepository {
  constructor(private readonly db: SupabaseClient) {}

  async report(q: NotificationHealthQuery, pushConfigured: boolean): Promise<NotificationHealthReport> {
    return unwrap(await this.db.rpc('notification_health', {
      p_department: q.departmentId ?? null, p_role: q.role ?? null, p_issue: q.issue ?? null, p_push_configured: pushConfigured
    })) as NotificationHealthReport;
  }

  async employee(profileId: string): Promise<NotificationHealthDetail> {
    return unwrap(await this.db.rpc('notification_health_employee', { p_profile: profileId })) as NotificationHealthDetail;
  }

  /** Queues a test for the employee's active devices (permission and rate limits in the database); returns the delivery ids. */
  async queueAdminTest(profileId: string): Promise<{ ids: number[]; devices: number }> {
    return unwrap(await this.db.rpc('notification_admin_test', { p_profile: profileId })) as { ids: number[]; devices: number };
  }
}

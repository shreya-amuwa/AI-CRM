import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyNotice, NoticeAcknowledged, NoticeAudienceOptions, NoticeList, NoticeManagers, NoticePending, NoticeReceipts } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Company Notice Board (20270131000200): every call is a database function that checks the caller (reader or publisher, and the audience). */
export class NoticeRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  list(q: { scope: string; category?: string; priority?: string; from?: string; to?: string; unread?: boolean; includeExpired?: boolean; search?: string; limit: number; offset: number }) {
    return this.rpc<NoticeList>('notice_list', {
      p_scope: q.scope, p_category: q.category ?? null, p_priority: q.priority ?? null, p_from: q.from ?? null, p_to: q.to ?? null,
      p_unread: q.unread ?? false, p_search: q.search || null, p_include_expired: q.includeExpired ?? false, p_limit: q.limit, p_offset: q.offset
    });
  }
  unreadCount() { return this.rpc<number>('notice_unread_count'); }
  open(id: string) { return this.rpc<CompanyNotice>('notice_open', { p_id: id }); }
  receipts(id: string) { return this.rpc<NoticeReceipts>('notice_receipts', { p_id: id }); }
  audienceOptions() { return this.rpc<NoticeAudienceOptions>('notice_audience_options'); }
  publish(p: Record<string, unknown>) { return this.rpc<CompanyNotice & { deliveryIds?: number[] }>('notice_publish', { p }); }
  update(id: string, p: Record<string, unknown>) { return this.rpc<CompanyNotice>('notice_update', { p_id: id, p }); }
  pending() { return this.rpc<NoticePending>('notice_pending'); }
  acknowledge(id: string) { return this.rpc<NoticeAcknowledged>('notice_acknowledge', { p_id: id }); }
  managers() { return this.rpc<NoticeManagers>('notice_managers'); }
  managerSet(profileId: string, enabled: boolean) { return this.rpc<{ profileId: string; manager: boolean }>('notice_manager_set', { p_profile: profileId, p_enabled: enabled }); }
  archive(id: string) { return this.rpc<CompanyNotice>('notice_archive', { p_id: id }); }
}

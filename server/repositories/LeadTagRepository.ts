import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadTag } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Lead tags (20270305000100): every call is a database function that checks the caller (the MD, a CEO, or the lead's own rules). */
export class LeadTagRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  list(departmentId: string | null) { return this.rpc<LeadTag[]>('lead_tags_list', { p_department: departmentId }); }
  save(p: Record<string, unknown>) { return this.rpc<LeadTag>('lead_tag_save', { p }); }
  retire(id: string, retired: boolean) { return this.rpc<LeadTag>('lead_tag_retire', { p_id: id, p_retired: retired }); }
  async setOnLead(leadId: string, tagId: string) { await this.rpc<null>('lead_tag_set', { p_customer: leadId, p_tag: tagId }); }
}

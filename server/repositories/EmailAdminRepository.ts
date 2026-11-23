import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailHistoryDetail, EmailHistoryPage, EmailOverview, EmailRulePreview, EmailSettings, EmailSuppression } from '../../shared/contracts.js';
import type { EmailHistoryQuery } from '../../shared/validation.js';
import { unwrap } from './base.js';

/**
 * Email Management (migration 20270127000100), as the caller: the database functions allow the Super Admin only for settings, senders,
 * rules and suppression (and audit every change), and scope the history to what each person's work allows. This layer only calls them.
 */
export class EmailAdminRepository {
  constructor(private readonly db: SupabaseClient) {}

  async overview(): Promise<Omit<EmailOverview, 'diagnostics'>> {
    return unwrap(await this.db.rpc('email_admin_overview')) as Omit<EmailOverview, 'diagnostics'>;
  }
  async saveSettings(s: EmailSettings): Promise<EmailSettings> {
    return unwrap(await this.db.rpc('email_settings_save', { p: s })) as EmailSettings;
  }
  async saveSender(v: { category: string; fromEmail: string; fromName: string; replyTo?: string | null; enabled: boolean }): Promise<void> {
    unwrap(await this.db.rpc('email_sender_save', { p_category: v.category, p_from_email: v.fromEmail, p_from_name: v.fromName, p_reply_to: v.replyTo ?? null, p_enabled: v.enabled }));
  }
  async deleteSender(category: string): Promise<void> {
    unwrap(await this.db.rpc('email_sender_delete', { p_category: category }));
  }
  async saveRule(rule: Record<string, unknown>): Promise<string> {
    return unwrap(await this.db.rpc('email_rule_save', { p: rule })) as string;
  }
  async deleteRule(id: string): Promise<void> {
    unwrap(await this.db.rpc('email_rule_delete', { p_id: id }));
  }
  async previewRule(id: string, customerId: string | null, applicationId: string | null): Promise<EmailRulePreview> {
    return unwrap(await this.db.rpc('email_rule_preview', { p_rule: id, p_customer: customerId, p_application: applicationId })) as EmailRulePreview;
  }
  async suppressions(search: string | null): Promise<EmailSuppression[]> {
    return unwrap(await this.db.rpc('email_suppressions_list', { p_search: search })) as EmailSuppression[];
  }
  async setSuppression(email: string, active: boolean, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('email_suppression_set', { p_email: email, p_active: active, p_note: note }));
  }
  async history(q: EmailHistoryQuery): Promise<EmailHistoryPage> {
    return unwrap(await this.db.rpc('email_history', { p: q })) as EmailHistoryPage;
  }
  async reviewMessage(id: string, received: boolean): Promise<void> {
    unwrap(await this.db.rpc('email_message_review', { p_id: id, p_received: received }));
  }
  async historyDetail(id: string): Promise<EmailHistoryDetail> {
    return unwrap(await this.db.rpc('email_history_detail', { p_id: id })) as EmailHistoryDetail;
  }
}

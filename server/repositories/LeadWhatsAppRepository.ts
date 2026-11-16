import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadWhatsAppMessage, LeadWhatsAppSettings } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The lead welcome WhatsApp functions of the database, called with the signed-in user's own login (the database decides who may do what). */
export class LeadWhatsAppRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  settings() { return this.rpc<LeadWhatsAppSettings>('lead_whatsapp_settings_get'); }
  setSettings(enabled: boolean, templateName: string | null, templateLanguage: string, templateApproved: boolean, variables: string[]) {
    return this.rpc<LeadWhatsAppSettings>('set_lead_whatsapp_settings', {
      p_enabled: enabled, p_template_name: templateName, p_template_language: templateLanguage, p_template_approved: templateApproved, p_variables: variables
    });
  }
  history(customerId: string) { return this.rpc<LeadWhatsAppMessage[]>('lead_whatsapp_history', { p_customer: customerId }); }
  resend(customerId: string) {
    return this.rpc<{ requested: boolean; replayed: boolean; dispatch: LeadWhatsAppMessage }>('lead_whatsapp_resend', { p_customer: customerId });
  }
}

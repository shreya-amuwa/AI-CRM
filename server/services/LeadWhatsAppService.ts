import type { LeadWhatsAppMessage, LeadWhatsAppSettings } from '../../shared/contracts.js';
import { leadWhatsAppSettingsSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import { leadWhatsAppDelivery, leadWhatsAppQuietly } from '../leads/whatsapp.js';
import type { LeadWhatsAppRepository } from '../repositories/LeadWhatsAppRepository.js';

/**
 * The lead welcome WhatsApp: its settings (Super Admin, Sales Department Head), a lead's message and "Send again". The database decides who
 * may do what; this layer validates the input, adds what the server does with a message right now, and sends a re-queued message at once.
 */
export class LeadWhatsAppService {
  constructor(private readonly repo: LeadWhatsAppRepository) {}

  async settings(): Promise<LeadWhatsAppSettings> {
    return { ...(await this.repo.settings()), delivery: leadWhatsAppDelivery() };
  }

  async setSettings(body: unknown): Promise<LeadWhatsAppSettings> {
    const b = parse(leadWhatsAppSettingsSchema, body);
    const saved = await this.repo.setSettings(b.enabled, b.templateName || null, b.templateLanguage || 'en', b.templateApproved, b.variables);
    return { ...saved, delivery: leadWhatsAppDelivery() };
  }

  history(customerId: string): Promise<LeadWhatsAppMessage[]> {
    return this.repo.history(parse(uuidSchema, customerId));
  }

  async resend(customerId: string): Promise<LeadWhatsAppMessage> {
    const r = await this.repo.resend(parse(uuidSchema, customerId));
    if (!r.replayed) await leadWhatsAppQuietly();
    const [latest] = await this.repo.history(customerId);
    return latest ?? r.dispatch;
  }
}

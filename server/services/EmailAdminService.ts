import type { EmailHistoryDetail, EmailHistoryPage, EmailOverview, EmailProviderCheck, EmailRulePreview, EmailSettings, EmailSuppression } from '../../shared/contracts.js';
import { emailHistoryQuerySchema, emailProviderSchema, emailRulePreviewSchema, emailRuleSchema, emailSenderSchema, emailSettingsSchema,
  emailSuppressionSchema, uuidSchema, EMAIL_CATEGORIES } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { checkProvider, providerDiagnostics } from '../email/providerStatus.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { EmailAdminRepository } from '../repositories/EmailAdminRepository.js';
import { z } from 'zod';

/**
 * Email Management for the Super Admin, and the e-mail history for everyone (scoped by the database). The provider diagnostics and checks
 * read the server's own settings (never returning a key), so they are allowed to the Super Admin here as well as in the database.
 */
export class EmailAdminService {
  constructor(private readonly repo: EmailAdminRepository) {}

  private superAdmin(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin manages e-mail.');
  }

  async overview(): Promise<EmailOverview> {
    return { ...(await this.repo.overview()), diagnostics: providerDiagnostics() };
  }
  saveSettings(body: unknown): Promise<EmailSettings> {
    return this.repo.saveSettings(parse(emailSettingsSchema, body));
  }
  async saveSender(body: unknown): Promise<EmailOverview> {
    await this.repo.saveSender(parse(emailSenderSchema, body));
    return this.overview();
  }
  async deleteSender(category: string): Promise<EmailOverview> {
    await this.repo.deleteSender(parse(z.enum(EMAIL_CATEGORIES), category));
    return this.overview();
  }
  async saveRule(body: unknown): Promise<EmailOverview> {
    await this.repo.saveRule(parse(emailRuleSchema, body));
    return this.overview();
  }
  async deleteRule(id: string): Promise<EmailOverview> {
    await this.repo.deleteRule(parse(uuidSchema, id));
    return this.overview();
  }
  previewRule(id: string, body: unknown): Promise<EmailRulePreview> {
    const v = parse(emailRulePreviewSchema, body);
    return this.repo.previewRule(parse(uuidSchema, id), v.customerId ?? null, v.applicationId ?? null);
  }
  suppressions(query: Record<string, string>): Promise<EmailSuppression[]> {
    return this.repo.suppressions(parse(z.string().trim().max(120).optional(), query.search) || null);
  }
  async setSuppression(body: unknown): Promise<EmailSuppression[]> {
    const v = parse(emailSuppressionSchema, body);
    await this.repo.setSuppression(v.email, v.active, v.note ?? null);
    return this.repo.suppressions(null);
  }
  async checkProvider(actor: Actor, provider: string): Promise<EmailProviderCheck> {
    this.superAdmin(actor);
    return checkProvider(parse(emailProviderSchema, provider));
  }
  history(query: unknown): Promise<EmailHistoryPage> {
    return this.repo.history(parse(emailHistoryQuerySchema, query));
  }
  /** An e-mail whose outcome is unknown: the Super Admin says whether it arrived (the database checks and audits). */
  async reviewMessage(id: string, body: unknown): Promise<{ ok: true }> {
    const v = parse(z.object({ received: z.boolean() }).strict(), body);
    await this.repo.reviewMessage(parse(uuidSchema, id), v.received);
    return { ok: true };
  }
  historyDetail(id: string): Promise<EmailHistoryDetail> {
    return this.repo.historyDetail(parse(uuidSchema, id));
  }
}

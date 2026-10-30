import type { HandoverReconciliation, PanelDetails, TcFollowUp, UsageAlertSettings, VerificationNote, VerificationRouteReviewItem, WorkflowSettings } from '../../shared/contracts.js';
import {
  usageAlertSettingsSchema,
  followUpAssignSchema,
  followUpContactSchema,
  followUpListQuerySchema,
  panelCredentialsSchema,
  panelDetailsSchema,
  panelLinkSendSchema,
  panelUrlSchema,
  rerouteVerificationSchema,
  serviceMetaVerificationSchema,
  tcFollowupDelaySchema,
  uuidSchema,
  verificationNoteSchema
} from '../../shared/validation.js';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { WorkflowRepository } from '../repositories/WorkflowRepository.js';
import { automationSettings } from '../automations/config.js';
import { encryptSecret } from '../automations/secrets.js';
import { AppError } from '../http/errors.js';

const codeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.');

export class WorkflowService {
  constructor(private readonly repo: WorkflowRepository) {}

  verificationNotes(customerId: string): Promise<VerificationNote[]> {
    return this.repo.verificationNotes(parse(uuidSchema, customerId));
  }
  async addVerificationNote(customerId: string, body: unknown): Promise<VerificationNote[]> {
    const id = parse(uuidSchema, customerId);
    const input = parse(verificationNoteSchema, body);
    await this.repo.addVerificationNote(id, input.body, input.outcome);
    return this.repo.verificationNotes(id);
  }
  panelDetails(customerId: string): Promise<PanelDetails> {
    return this.repo.panelDetails(parse(uuidSchema, customerId));
  }
  async setPanelDetails(customerId: string, serviceCode: string, body: unknown): Promise<PanelDetails> {
    const id = parse(uuidSchema, customerId);
    const input = parse(panelDetailsSchema, body);
    await this.repo.setPanelDetails(id, parse(codeSchema, serviceCode), input.platform ?? null, input.account ?? null);
    return this.repo.panelDetails(id);
  }
  /** The Client Panel URL of one service (HTTPS, no credentials in it; the database checks the same rules and who may do this). Sends nothing. */
  async setPanelUrl(customerId: string, serviceCode: string, body: unknown): Promise<PanelDetails> {
    const id = parse(uuidSchema, customerId);
    const input = parse(panelUrlSchema, body);
    await this.repo.setPanelUrl(id, parse(codeSchema, serviceCode), input.url?.trim() || null);
    return this.repo.panelDetails(id);
  }
  /** E-mail the saved panel link to the customer: once per link (a repeat is a no-op), again on purpose with `resend`. */
  async sendPanelLink(customerId: string, serviceCode: string, body: unknown): Promise<PanelDetails & { link: { queued: boolean; replayed: boolean; reason?: string } }> {
    const id = parse(uuidSchema, customerId);
    const input = parse(panelLinkSendSchema, body);
    const link = await this.repo.sendPanelLink(id, parse(codeSchema, serviceCode), input.requestId, input.resend ?? false);
    return { ...(await this.repo.panelDetails(id)), link };
  }
  /**
   * The Meta Verifier set a password on the customer's WhatsApp panel: it is encrypted here, queued on ONE e-mail to the customer's address on
   * the record and erased by the database once that e-mail is done. Nothing about the password is returned, logged or stored in any ordinary
   * column; the response is the refreshed panel details (who set it, when, and the e-mail's state). The database decides who may do this.
   * A repeated `requestId` is a no-op, so a retry or double click sends one e-mail.
   */
  async sendPanelCredentials(customerId: string, serviceCode: string, body: unknown): Promise<PanelDetails> {
    const id = parse(uuidSchema, customerId);
    const input = parse(panelCredentialsSchema, body);
    const key = automationSettings().secretKey;
    if (!key) throw new AppError('SERVICE_UNAVAILABLE', 'Panel passwords need AUTOMATION_SECRET_KEY on the server, so they can be handed over without being stored.');
    await this.repo.sendPanelCredentials(id, parse(codeSchema, serviceCode), encryptSecret(input.password, key), input.requestId);
    return this.repo.panelDetails(id);
  }
  async reroute(customerId: string, body: unknown): Promise<void> {
    const input = parse(rerouteVerificationSchema, body);
    await this.repo.reroute(parse(uuidSchema, customerId), input.route, input.reason);
  }
  handoverReconciliation(): Promise<HandoverReconciliation> {
    return this.repo.handoverReconciliation();
  }
  /** Creates the missing consultation follow-ups (and nothing else). Super Admin only - the database decides. */
  reconcileFollowUps(): Promise<{ customers: number }> {
    return this.repo.reconcileFollowUps();
  }
  routeReview(): Promise<VerificationRouteReviewItem[]> {
    return this.repo.routeReview();
  }
  async setServiceMetaVerification(code: string, body: unknown): Promise<void> {
    await this.repo.setServiceMetaVerification(parse(codeSchema, code), parse(serviceMetaVerificationSchema, body).value);
  }

  followUps(query: unknown): Promise<TcFollowUp[]> {
    return this.repo.followUps(parse(followUpListQuerySchema, query ?? {}).scope);
  }
  async recordContact(id: string, body: unknown): Promise<{ id: string; status: string }> {
    const b = parse(followUpContactSchema, body);
    return this.repo.recordContact(parse(uuidSchema, id), { channel: b.channel, outcome: b.outcome, note: b.note ?? null, nextFollowUpAt: b.nextFollowUpAt ?? null });
  }
  async assign(id: string, body: unknown): Promise<void> {
    await this.repo.assign(parse(uuidSchema, id), parse(followUpAssignSchema, body).profileId);
  }

  settings(): Promise<WorkflowSettings> {
    return this.repo.settings();
  }
  usageAlertSettings(): Promise<UsageAlertSettings> {
    return this.repo.usageAlertSettings();
  }
  setUsageAlertSettings(body: unknown): Promise<UsageAlertSettings> {
    const input = parse(usageAlertSettingsSchema, body);
    return this.repo.setUsageAlertSettings(input.enabled, input.thresholds);
  }
  setFollowUpDelay(body: unknown): Promise<WorkflowSettings> {
    return this.repo.setFollowUpDelay(parse(tcFollowupDelaySchema, body).days);
  }
}

import type { PanelDetails, TcFollowUp, VerificationNote, VerificationRouteReviewItem, WorkflowSettings } from '../../shared/contracts.js';
import {
  followUpAssignSchema,
  followUpContactSchema,
  followUpListQuerySchema,
  panelDetailsSchema,
  rerouteVerificationSchema,
  serviceMetaVerificationSchema,
  tcFollowupDelaySchema,
  uuidSchema,
  verificationNoteSchema
} from '../../shared/validation.js';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { WorkflowRepository } from '../repositories/WorkflowRepository.js';

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
  async reroute(customerId: string, body: unknown): Promise<void> {
    const input = parse(rerouteVerificationSchema, body);
    await this.repo.reroute(parse(uuidSchema, customerId), input.route, input.reason);
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
  setFollowUpDelay(body: unknown): Promise<WorkflowSettings> {
    return this.repo.setFollowUpDelay(parse(tcFollowupDelaySchema, body).days);
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PanelDetails, TcFollowUp, VerificationNote, VerificationRouteReviewItem, WorkflowSettings } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The Meta Verifier workflow: verification notes, re-routing, the Technical Consultant's follow-ups and the delay setting. The database decides who may do what. */
export class WorkflowRepository {
  constructor(private readonly db: SupabaseClient) {}

  async verificationNotes(customerId: string): Promise<VerificationNote[]> {
    return unwrap(await this.db.rpc('verification_notes_list', { p_customer: customerId })) as VerificationNote[];
  }
  async panelDetails(customerId: string): Promise<PanelDetails> {
    return unwrap(await this.db.rpc('panel_details_list', { p_customer: customerId })) as PanelDetails;
  }
  async setPanelDetails(customerId: string, service: string, platform: string | null, account: string | null): Promise<void> {
    unwrap(await this.db.rpc('panel_details_set', { p_customer: customerId, p_service: service, p_platform: platform, p_account: account }));
  }
  async addVerificationNote(customerId: string, body: string, outcome: string): Promise<void> {
    unwrap(await this.db.rpc('verification_note_add', { p_customer: customerId, p_body: body, p_outcome: outcome }));
  }
  async reroute(customerId: string, route: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('reroute_verification', { p_customer: customerId, p_route: route, p_reason: reason }));
  }
  async routeReview(): Promise<VerificationRouteReviewItem[]> {
    return unwrap(await this.db.rpc('verification_route_review')) as VerificationRouteReviewItem[];
  }
  async setServiceMetaVerification(code: string, value: boolean): Promise<void> {
    unwrap(await this.db.rpc('set_service_meta_verification', { p_code: code, p_value: value }));
  }

  async followUps(scope: string): Promise<TcFollowUp[]> {
    return unwrap(await this.db.rpc('tc_followups_list', { p_scope: scope })) as TcFollowUp[];
  }
  async recordContact(id: string, b: { channel: string; outcome: string; note: string | null; nextFollowUpAt: string | null }): Promise<{ id: string; status: string }> {
    return unwrap(await this.db.rpc('tc_followup_record', { p_followup: id, p_channel: b.channel, p_outcome: b.outcome, p_note: b.note, p_next: b.nextFollowUpAt })) as { id: string; status: string };
  }
  async assign(id: string, profileId: string): Promise<void> {
    unwrap(await this.db.rpc('tc_followup_assign', { p_followup: id, p_profile: profileId }));
  }

  async settings(): Promise<WorkflowSettings> {
    return unwrap(await this.db.rpc('workflow_settings_get')) as WorkflowSettings;
  }
  async setFollowUpDelay(days: number | null): Promise<WorkflowSettings> {
    return unwrap(await this.db.rpc('set_tc_followup_delay', { p_days: days })) as WorkflowSettings;
  }
}

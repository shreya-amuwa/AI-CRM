import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CeoPresence, CeoPresenceExit, ClientMeetingResult, MeetingMail, CeoRequestList, Meeting, MeetingBookingLink, MeetingDetail, MeetingDirectoryEntry, MeetingSettings
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** The meetings functions of the database, called with the signed-in employee's own login (the database decides who may do what). */
export class MeetingRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  list(from: string, to: string, hostId?: string | null) { return this.rpc<Meeting[]>('mtg_list', { p_from: from, p_to: to, p_host: hostId ?? null }); }
  detail(id: string) { return this.rpc<MeetingDetail>('mtg_detail', { p_id: id }); }
  create(input: Record<string, unknown>) { return this.rpc<Meeting>('mtg_create', { p: input }); }
  reschedule(id: string, startsAt: string, endsAt: string, note: string | null, version: number | null) {
    return this.rpc<Meeting>('mtg_reschedule', { p_id: id, p_starts_at: startsAt, p_ends_at: endsAt, p_note: note, p_version: version });
  }
  cancel(id: string, reason: string | null, version: number | null) { return this.rpc<Meeting>('mtg_cancel', { p_id: id, p_reason: reason, p_version: version }); }
  complete(id: string, note: string | null) { return this.rpc<Meeting>('mtg_complete', { p_id: id, p_note: note }); }
  decide(id: string, decision: string, note: string | null, startsAt: string | null, endsAt: string | null, version: number | null) {
    return this.rpc<Meeting>('mtg_decide', { p_id: id, p_decision: decision, p_note: note, p_starts_at: startsAt, p_ends_at: endsAt, p_version: version });
  }
  answerProposal(id: string, accept: boolean) { return this.rpc<Meeting>('mtg_answer_proposal', { p_id: id, p_accept: accept }); }
  respond(id: string, response: string) { return this.rpc<Meeting>('mtg_respond', { p_id: id, p_response: response }); }
  ceoRequests(section: string, limit: number, offset: number) {
    return this.rpc<CeoRequestList>('mtg_ceo_requests', { p_section: section, p_limit: limit, p_offset: offset });
  }
  pendingApprovals() { return this.rpc<Meeting[]>('mtg_pending_approvals'); }
  // live availability of the CEO (the database lets only a Super Admin change their own)
  // client meetings (20270122000200)
  clientCreate(i: Record<string, unknown>) { return this.rpc<ClientMeetingResult>('mtg_client_create', { p: i }); }
  clientList(scope: string, status: string | null) { return this.rpc<ClientMeetingResult[]>('mtg_client_meetings', { p_scope: scope, p_status: status }); }
  mailLog(meetingId: string) { return this.rpc<MeetingMail[]>('mtg_mail_log', { p_meeting: meetingId }); }
  mailRetry(id: number) { return this.rpc<{ id: number; status: string }>('mtg_mail_retry', { p_id: id }); }
  presence(ids: string[] | null) { return this.rpc<CeoPresence[]>('mtg_presence', { p_ids: ids }); }
  presenceEnter(meetingId: string | null) { return this.rpc<CeoPresence>('mtg_presence_enter', { p_meeting: meetingId }); }
  presenceExit() { return this.rpc<CeoPresenceExit>('mtg_presence_exit', { p_busy: null }); }
  directory(search: string | null) { return this.rpc<MeetingDirectoryEntry[]>('mtg_directory', { p_search: search }); }
  busy(profileIds: string[], from: string, to: string) {
    return this.rpc<{ profileId: string; start: string; end: string }[]>('mtg_busy', { p_profiles: profileIds, p_from: from, p_to: to });
  }
  settings() { return this.rpc<MeetingSettings>('mtg_my_settings'); }
  setAvailability(input: Record<string, unknown>) { return this.rpc<MeetingSettings>('mtg_set_availability', { p: input }); }
  saveBookingLink(input: Record<string, unknown>) { return this.rpc<MeetingBookingLink>('mtg_booking_type_save', { p: input }); }
  setDelegates(ids: string[]) { return this.rpc<MeetingSettings>('mtg_set_delegates', { p_delegates: ids }); }
  googleStatus() {
    return this.rpc<{ connected: boolean; status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'NOT_CONNECTED'; googleEmail: string | null; connectedAt: string | null; lastError: string | null }>('mtg_google_status');
  }
}

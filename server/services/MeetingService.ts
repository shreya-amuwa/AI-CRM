import type {
  CeoPresence, CeoPresenceExit, CeoRequestList, GoogleCalendarStatus, Meeting, MeetingBookingLink, MeetingBusyBlock, MeetingDetail, MeetingDirectoryEntry, MeetingSettings
} from '../../shared/contracts.js';
import {
  calendarMeetingCancelSchema, ceoRequestsQuerySchema, meetingAvailabilitySchema, meetingBookingLinkSchema, meetingBusySchema, meetingCompleteSchema, meetingCreateSchema,
  meetingDecisionSchema, meetingDelegatesSchema, meetingDirectoryQuerySchema, meetingListQuerySchema, meetingPresenceEnterSchema, meetingProposalAnswerSchema,
  meetingRescheduleSchema, meetingResponseSchema, uuidSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { automationSettings } from '../automations/config.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { authorizeUrl, googleConfig } from '../meetings/google.js';
import { disconnectGoogle } from '../meetings/connect.js';
import { isValidTimeZone } from '../meetings/slots.js';
import { googleBusy, meetingsQuietly } from '../meetings/worker.js';
import type { MeetingRepository } from '../repositories/MeetingRepository.js';

const appUrl = () => automationSettings().appUrl ?? 'https://crm.amuwacorporation.com';

/**
 * Meetings for signed-in employees. The database decides who may see and change what (host, the one who booked, invited colleagues; for the
 * CEO's time ONLY the Super Admin decides, moves or cancels: the role is read from the signed-in account in the database, never from the request); this layer validates the input, adds Google free/busy times, and right after a change runs the meetings worker briefly
 * so Google Calendar and the guests hear about it at once.
 */
export class MeetingService {
  constructor(private readonly repo: MeetingRepository) {}

  /** A change was made: push it to Google and the guests now (best effort; the scheduled run retries). */
  private async after<T>(p: Promise<T>): Promise<T> {
    const r = await p;
    await meetingsQuietly();
    return r;
  }

  list(query: unknown): Promise<Meeting[]> {
    const q = parse(meetingListQuerySchema, query);
    return this.repo.list(q.from, q.to, q.hostId ?? null);
  }
  detail(id: string): Promise<MeetingDetail> { return this.repo.detail(parse(uuidSchema, id)); }
  approvals(): Promise<Meeting[]> { return this.repo.pendingApprovals(); }

  // ---- Live availability of the CEO: Enter / Exit Meeting (the database lets only the Super Admin change their own)
  presence(): Promise<CeoPresence[]> { return this.repo.presence(); }
  presenceEnter(body: unknown): Promise<CeoPresence> {
    return this.repo.presenceEnter(parse(meetingPresenceEnterSchema, body ?? {}).meetingId ?? null);
  }
  /**
   * Exit Meeting: AVAILABLE, and the requests that waited are scheduled by the database (queue order, working hours, held meetings).
   * The CEO's Google busy times for the next 31 days are passed in so no request lands on them; without Google, the CRM calendar alone decides.
   */
  async presenceExit(actor: Actor): Promise<CeoPresenceExit> {
    const from = new Date();
    const to = new Date(from.getTime() + 31 * 86_400_000);
    const busy = actor.role === 'SUPER_ADMIN' ? (await googleBusy([actor.id], from, to).catch(() => ({} as Record<string, { start: string; end: string }[]>)))[actor.id] ?? [] : [];
    return this.after(this.repo.presenceExit(busy.map(b => ({ start: b.start, end: b.end }))));
  }
  /** The meeting requests with the CEO: the Super Admin sees everyone's, an employee only their own. */
  ceoRequests(query: unknown): Promise<CeoRequestList> {
    const q = parse(ceoRequestsQuerySchema, query ?? {});
    return this.repo.ceoRequests(q.section, q.limit, q.offset);
  }
  directory(query: unknown): Promise<MeetingDirectoryEntry[]> { return this.repo.directory(parse(meetingDirectoryQuerySchema, query).search ?? null); }

  create(body: unknown): Promise<Meeting> {
    const i = parse(meetingCreateSchema, body);
    if (i.timezone && !isValidTimeZone(i.timezone)) throw new AppError('VALIDATION_ERROR', 'Unknown time zone.');
    return this.after(this.repo.create({ ...i, startsAt: new Date(i.startsAt).toISOString(), endsAt: new Date(i.endsAt).toISOString() }));
  }
  reschedule(id: string, body: unknown): Promise<Meeting> {
    const i = parse(meetingRescheduleSchema, body);
    return this.after(this.repo.reschedule(parse(uuidSchema, id), new Date(i.startsAt).toISOString(), new Date(i.endsAt).toISOString(), i.note ?? null, i.version ?? null));
  }
  cancel(id: string, body: unknown): Promise<Meeting> {
    const i = parse(calendarMeetingCancelSchema, body ?? {});
    return this.after(this.repo.cancel(parse(uuidSchema, id), i.reason ?? null, i.version ?? null));
  }
  complete(id: string, body: unknown): Promise<Meeting> { return this.repo.complete(parse(uuidSchema, id), parse(meetingCompleteSchema, body ?? {}).note ?? null); }
  decide(id: string, body: unknown): Promise<Meeting> {
    const i = parse(meetingDecisionSchema, body);
    return this.after(this.repo.decide(parse(uuidSchema, id), i.decision, i.note ?? null,
      i.startsAt ? new Date(i.startsAt).toISOString() : null, i.endsAt ? new Date(i.endsAt).toISOString() : null, i.version ?? null));
  }
  answerProposal(id: string, body: unknown): Promise<Meeting> {
    return this.after(this.repo.answerProposal(parse(uuidSchema, id), parse(meetingProposalAnswerSchema, body).accept));
  }
  respond(id: string, body: unknown): Promise<Meeting> { return this.repo.respond(parse(uuidSchema, id), parse(meetingResponseSchema, body).response); }

  /** When colleagues are busy: their CRM meetings and, for those who connected Google, their Google Calendar (times only). */
  async busy(body: unknown): Promise<MeetingBusyBlock[]> {
    const i = parse(meetingBusySchema, body);
    const crm = await this.repo.busy(i.profileIds, i.from, i.to);
    const google = await googleBusy(i.profileIds, new Date(i.from), new Date(i.to));
    return [
      ...crm.map(b => ({ ...b, source: 'CRM' as const })),
      ...Object.entries(google).flatMap(([profileId, blocks]) => blocks.map(b => ({ profileId, start: b.start, end: b.end, source: 'GOOGLE' as const })))
    ].sort((a, b) => a.start.localeCompare(b.start));
  }

  settings(): Promise<MeetingSettings> { return this.repo.settings(); }
  setAvailability(body: unknown): Promise<MeetingSettings> {
    const i = parse(meetingAvailabilitySchema, body);
    if (!isValidTimeZone(i.timezone)) throw new AppError('VALIDATION_ERROR', 'Unknown time zone.');
    return this.repo.setAvailability(i);
  }
  saveBookingLink(body: unknown): Promise<MeetingBookingLink> { return this.repo.saveBookingLink(parse(meetingBookingLinkSchema, body)); }
  setDelegates(body: unknown): Promise<MeetingSettings> { return this.repo.setDelegates(parse(meetingDelegatesSchema, body).delegateIds); }

  // ---- Google Calendar of the signed-in employee
  async googleStatus(): Promise<GoogleCalendarStatus> {
    const s = await this.repo.googleStatus();
    return { configured: !!googleConfig(process.env, appUrl()), ...s };
  }
  /** The Google sign-in address for this employee (the browser goes there; Google comes back to /integrations/google/callback). */
  googleConnect(actor: Actor): { url: string } {
    const cfg = googleConfig(process.env, appUrl());
    if (!cfg) throw new AppError('SERVICE_UNAVAILABLE', 'Google Calendar is not set up on the server yet. Ask the administrator (see the Meetings guide).');
    return { url: authorizeUrl(cfg, actor.id, actor.email) };
  }
  async googleDisconnect(actor: Actor): Promise<GoogleCalendarStatus> {
    await disconnectGoogle(actor.id);
    return this.googleStatus();
  }
}

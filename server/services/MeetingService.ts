import type {
  CeoOfficeStatus, CeoPresence, CeoPresenceExit, ClientMeetingResult, MeetingMail, CeoRequestList, GoogleCalendarStatus, Meeting, MeetingBookingLink, MeetingBusyBlock, MeetingDetail, MeetingDirectoryEntry, MeetingSettings,
  MeetingReportActionList, MeetingReportList, MeetingReportsOverview, MeetingSummaryList, MeetingSummaryView, MyMeetingAction
} from '../../shared/contracts.js';
import {
  calendarMeetingCancelSchema, ceoArrivalSchema, ceoRequestsQuerySchema, meetingAvailabilitySchema, meetingBookingLinkSchema, meetingBusySchema, meetingCompleteSchema, meetingCreateSchema,
  clientMeetingListQuerySchema, clientMeetingSchema, meetingMailIdSchema, meetingDecisionSchema, meetingDelegatesSchema, meetingDirectoryQuerySchema, meetingListQuerySchema, meetingPresenceEnterSchema, meetingPresenceQuerySchema, meetingRoomLinkSchema, meetingProposalAnswerSchema,
  meetingRescheduleSchema, meetingResponseSchema, uuidSchema,
  meetingActionUpdateSchema, meetingAttendanceSchema, meetingReportActionsQuerySchema, meetingReportsOverviewQuerySchema, meetingReportsQuerySchema,
  meetingSummaryClarifySchema, meetingSummaryDraftSchema, meetingSummaryFlagSchema, meetingSummaryListQuerySchema, meetingSummaryOwnerSchema,
  meetingSummaryReplySchema, meetingSummarySubmitSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertSuperAdmin } from '../authz/policies.js';
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

  // ---- Employee availability: Enter / Exit Meeting (migration 20270122000100). Every employee but the Super Admin changes their own;
  // the database refuses the Super Admin and anyone acting for someone else.
  /** Without ids: the caller's own status ([] for the Super Admin). With ids: those colleagues' BUSY / AVAILABLE status. */
  presence(query: unknown): Promise<CeoPresence[]> {
    return this.repo.presence(parse(meetingPresenceQuerySchema, query ?? {}).ids ?? null);
  }
  /** The CEOs' live status (Ask the CEO for time shows it; a request made while BUSY joins the queue). */
  ceoPresence(): Promise<CeoPresence[]> { return this.repo.ceoPresence(); }
  /** CEO office arrival (20270127000300): everyone reads it; HR marks or undoes it (the database checks who) */
  ceoOffice(): Promise<CeoOfficeStatus> { return this.repo.ceoOffice(); }
  ceoArrived(body: unknown): Promise<CeoOfficeStatus> { return this.repo.ceoArrived(parse(ceoArrivalSchema, body ?? {}).ceoId); }
  ceoArrivalUndo(body: unknown): Promise<CeoOfficeStatus> { return this.repo.ceoArrivalUndo(parse(ceoArrivalSchema, body ?? {}).ceoId); }
  roomLink(): Promise<{ roomLink: string | null }> { return this.repo.roomLink(); }
  setRoomLink(body: unknown): Promise<{ roomLink: string | null }> { return this.repo.setRoomLink(parse(meetingRoomLinkSchema, body).roomLink ?? null); }
  presenceEnter(body: unknown): Promise<CeoPresence> {
    return this.repo.presenceEnter(parse(meetingPresenceEnterSchema, body ?? {}).meetingId ?? null);
  }
  /** Exit Meeting; for the Super Admin the next queued request is confirmed in the same database transaction, then its e-mails go out. */
  presenceExit(): Promise<CeoPresenceExit> { return this.after(this.repo.presenceExit()); }
  /** The meeting requests with the CEO: the Super Admin sees everyone's, an employee only their own. */
  ceoRequests(query: unknown): Promise<CeoRequestList> {
    const q = parse(ceoRequestsQuerySchema, query ?? {});
    return this.repo.ceoRequests(q.section, q.limit, q.offset);
  }
  directory(query: unknown): Promise<MeetingDirectoryEntry[]> { return this.repo.directory(parse(meetingDirectoryQuerySchema, query).search ?? null); }

  /** Client Meeting: saved, and the invitation to the client queued; the e-mail worker then runs at once (the scheduled run retries). */
  createClient(body: unknown): Promise<ClientMeetingResult> { return this.after(this.repo.clientCreate(parse(clientMeetingSchema, body))); }
  clientList(query: unknown): Promise<ClientMeetingResult[]> {
    const q = parse(clientMeetingListQuerySchema, query ?? {});
    return this.repo.clientList(q.scope, q.status ?? null);
  }
  mailLog(id: string): Promise<MeetingMail[]> { return this.repo.mailLog(parse(uuidSchema, id)); }
  mailRetry(id: string): Promise<{ id: number; status: string }> { return this.after(this.repo.mailRetry(parse(meetingMailIdSchema, id))); }

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

  // ---- Post-meeting summaries (20270124000200). The database decides who is responsible, who may write, read or confirm attendance;
  // the CEO reports are refused here early for anyone but the Super Admin, and again in the database.
  summary(id: string): Promise<MeetingSummaryView> { return this.repo.summary(parse(uuidSchema, id)); }
  confirmAttendance(id: string, body: unknown): Promise<MeetingSummaryView> {
    const i = parse(meetingAttendanceSchema, body);
    return this.repo.confirmAttendance(parse(uuidSchema, id), [...new Set(i.attendedIds)], i.version ?? null);
  }
  assignSummaryOwner(id: string, body: unknown): Promise<MeetingSummaryView> {
    const i = parse(meetingSummaryOwnerSchema, body);
    return this.repo.assignSummaryOwner(parse(uuidSchema, id), i.ownerId, i.reason ?? null, i.version ?? null);
  }
  saveSummaryDraft(id: string, body: unknown): Promise<MeetingSummaryView> {
    const i = parse(meetingSummaryDraftSchema, body);
    return this.repo.saveSummary(parse(uuidSchema, id), i.summary, false, i.version, null);
  }
  /** Submit (or amend) the summary: the meeting is completed in the same database transaction. */
  submitSummary(id: string, body: unknown): Promise<MeetingSummaryView> {
    const i = parse(meetingSummarySubmitSchema, body);
    return this.repo.saveSummary(parse(uuidSchema, id), i.summary, true, i.version, i.changeNote ?? null);
  }
  clarifySummary(actor: Actor, id: string, body: unknown): Promise<MeetingSummaryView> {
    assertSuperAdmin(actor);
    return this.repo.clarifySummary(parse(uuidSchema, id), parse(meetingSummaryClarifySchema, body).message);
  }
  replySummary(id: string, body: unknown): Promise<MeetingSummaryView> {
    return this.repo.replySummary(parse(uuidSchema, id), parse(meetingSummaryReplySchema, body).message);
  }
  flagSummaryItem(actor: Actor, id: string, body: unknown): Promise<MeetingSummaryView> {
    assertSuperAdmin(actor);
    const i = parse(meetingSummaryFlagSchema, body);
    return this.repo.flagSummaryItem(parse(uuidSchema, id), i.itemType, i.itemId, i.flag, i.note ?? null);
  }
  updateSummaryAction(id: string, body: unknown): Promise<{ id: string; status: string }> {
    const i = parse(meetingActionUpdateSchema, body);
    return this.repo.updateSummaryAction(parse(uuidSchema, id), i.status, i.note ?? null);
  }
  summaries(query: unknown): Promise<MeetingSummaryList> {
    const q = parse(meetingSummaryListQuerySchema, query ?? {});
    return this.repo.summaries(q.scope, q.tab, q.limit, q.offset);
  }
  myActions(): Promise<MyMeetingAction[]> { return this.repo.myActions(); }
  reportsOverview(actor: Actor, query: unknown): Promise<MeetingReportsOverview> {
    assertSuperAdmin(actor);
    return this.repo.reportsOverview(parse(meetingReportsOverviewQuerySchema, query ?? {}));
  }
  reports(actor: Actor, query: unknown): Promise<MeetingReportList> {
    assertSuperAdmin(actor);
    const { limit, offset, ...filters } = parse(meetingReportsQuerySchema, query ?? {});
    return this.repo.reports(filters, limit, offset);
  }
  report(actor: Actor, id: string): Promise<MeetingSummaryView> {
    assertSuperAdmin(actor);
    return this.repo.report(parse(uuidSchema, id));
  }
  reportActions(actor: Actor, query: unknown): Promise<MeetingReportActionList> {
    assertSuperAdmin(actor);
    const { limit, offset, ...filters } = parse(meetingReportActionsQuerySchema, query ?? {});
    return this.repo.reportActions(filters, limit, offset);
  }

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

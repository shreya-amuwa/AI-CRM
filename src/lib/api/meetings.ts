import type {
  CeoOfficeStatus, CeoPresence, CeoPresenceExit, ClientMeetingInput, ClientMeetingResult, MeetingMail, CeoRequestList, CeoRequestSection, GoogleCalendarStatus, Meeting, MeetingAvailabilityWindow, MeetingBookingLink, MeetingBusyBlock, MeetingDetail, MeetingDirectoryEntry,
  MeetingSettings, PublicBookingPage, PublicBookingResult, PublicBookingView,
  MeetingActionStatus, MeetingReportActionList, MeetingReportList, MeetingReportsOverview, MeetingSummaryContent, MeetingSummaryList, MeetingSummaryTab,
  MeetingSummaryView, MyMeetingAction
} from '../../../shared/contracts';
import { api } from './client';

export interface NewMeeting {
  title: string;
  description?: string | null;
  /** Extra message to the CEO with a request for their time. */
  message?: string | null;
  kind: 'APPOINTMENT' | 'DEMO' | 'MEETING' | 'INTERVIEW' | 'CEO_MEETING';
  hostId?: string | null;
  startsAt: string;
  endsAt: string;
  timezone?: string | null;
  mode: 'GOOGLE_MEET' | 'ONLINE_LINK' | 'IN_PERSON' | 'PHONE';
  location?: string | null;
  meetLink?: string | null;
  attendeeIds: string[];
  guests: { name?: string | null; email: string; phone?: string | null }[];
  allowOverlap?: boolean;
}

export type BookingLinkInput = Omit<MeetingBookingLink, 'id' | 'hostId' | 'createdAt' | 'kind'> & { id?: string | null; kind?: MeetingBookingLink['kind'] };

/** The Meetings page: the calendar, requests for the CEO, booking links, working hours and the Google Calendar connection. */
export const meetingsApi = {
  list: (from: string, to: string, hostId?: string) => api.get<Meeting[]>('/meetings', { from, to, hostId }),
  detail: (id: string) => api.get<MeetingDetail>(`/meetings/${id}`),
  create: (b: NewMeeting) => api.post<Meeting>('/meetings', b),
  reschedule: (id: string, startsAt: string, endsAt: string, version?: number, note?: string) =>
    api.post<Meeting>(`/meetings/${id}/reschedule`, { startsAt, endsAt, version, note: note || undefined }),
  cancel: (id: string, reason?: string, version?: number) => api.post<Meeting>(`/meetings/${id}/cancel`, { reason: reason || undefined, version }),
  complete: (id: string, note?: string) => api.post<Meeting>(`/meetings/${id}/complete`, { note: note || undefined }),
  decide: (id: string, b: { decision: 'APPROVE' | 'DECLINE' | 'PROPOSE'; note?: string; startsAt?: string; endsAt?: string; version?: number }) =>
    api.post<Meeting>(`/meetings/${id}/decision`, b),
  answerProposal: (id: string, accept: boolean) => api.post<Meeting>(`/meetings/${id}/proposal`, { accept }),
  respond: (id: string, response: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE') => api.post<Meeting>(`/meetings/${id}/response`, { response }),
  approvals: () => api.get<Meeting[]>('/meetings/approvals'),
  // live availability of the CEO: everyone reads it; only the Super Admin enters / exits their own meeting
  // client meetings (20270122000200)
  clientMeetings: (q: { scope?: 'UPCOMING' | 'PAST' | 'ALL'; status?: string }) => api.get<ClientMeetingResult[]>('/meetings/client', q),
  createClient: (body: ClientMeetingInput) => api.post<ClientMeetingResult>('/meetings/client', body),
  mails: (id: string) => api.get<MeetingMail[]>(`/meetings/${encodeURIComponent(id)}/mails`),
  retryMail: (mailId: number) => api.post<{ id: number; status: string }>(`/meetings/mails/${mailId}/retry`, {}),
  ceoPresence: () => api.get<CeoPresence[]>('/meetings/presence/ceo'),
  ceoOffice: () => api.get<CeoOfficeStatus>('/meetings/ceo-office'),
  ceoArrived: (ceoId?: string) => api.post<CeoOfficeStatus>('/meetings/ceo-office/arrived', ceoId ? { ceoId } : {}),
  ceoNotArrived: (ceoId?: string) => api.post<CeoOfficeStatus>('/meetings/ceo-office/not-arrived', ceoId ? { ceoId } : {}),
  ceoArrivalUndo: (ceoId?: string) => api.post<CeoOfficeStatus>('/meetings/ceo-office/undo', ceoId ? { ceoId } : {}),
  roomLink: () => api.get<{ roomLink: string | null }>('/meetings/settings/room-link'),
  setRoomLink: (roomLink: string | null) => api.post<{ roomLink: string | null }>('/meetings/settings/room-link', { roomLink }),
  presence: (ids?: string[]) => api.get<CeoPresence[]>('/meetings/presence', ids ? { ids: ids.join(',') } : undefined),
  presenceEnter: (meetingId?: string | null) => api.post<CeoPresence>('/meetings/presence/enter', { meetingId: meetingId ?? null }),
  presenceExit: () => api.post<CeoPresenceExit>('/meetings/presence/exit', {}),
  ceoRequests: (section: CeoRequestSection = 'ALL', offset = 0, limit = 50) => api.get<CeoRequestList>('/meetings/ceo-requests', { section, offset, limit }),
  directory: (search?: string) => api.get<MeetingDirectoryEntry[]>('/meetings/directory', { search }),
  busy: (profileIds: string[], from: string, to: string) => api.post<MeetingBusyBlock[]>('/meetings/busy', { profileIds, from, to }),
  settings: () => api.get<MeetingSettings>('/meetings/settings'),
  setAvailability: (timezone: string, availability: MeetingAvailabilityWindow[]) => api.post<MeetingSettings>('/meetings/settings/availability', { timezone, availability }),
  saveBookingLink: (b: BookingLinkInput) => api.post<MeetingBookingLink>('/meetings/settings/booking-links', b),
  setDelegates: (delegateIds: string[]) => api.post<MeetingSettings>('/meetings/settings/delegates', { delegateIds }),
  google: () => api.get<GoogleCalendarStatus>('/meetings/google'),
  googleConnect: () => api.post<{ url: string }>('/meetings/google/connect'),
  googleDisconnect: () => api.delete<GoogleCalendarStatus>('/meetings/google'),

  // post-meeting summaries and the CEO's Meeting Decisions (20270124000200)
  summary: (id: string) => api.get<MeetingSummaryView>(`/meetings/${id}/summary`),
  confirmAttendance: (id: string, attendedIds: string[], version?: number) =>
    api.post<MeetingSummaryView>(`/meetings/${id}/summary/attendance`, { attendedIds, version }),
  assignSummaryOwner: (id: string, ownerId: string, reason?: string, version?: number) =>
    api.post<MeetingSummaryView>(`/meetings/${id}/summary/owner`, { ownerId, reason: reason || undefined, version }),
  saveSummaryDraft: (id: string, summary: SummaryInput, version: number) =>
    api.patch<MeetingSummaryView>(`/meetings/${id}/summary/draft`, { summary, version }),
  submitSummary: (id: string, summary: SummaryInput, version: number, changeNote?: string) =>
    api.post<MeetingSummaryView>(`/meetings/${id}/summary/submit`, { summary, version, changeNote: changeNote || undefined }),
  clarifySummary: (id: string, message: string) => api.post<MeetingSummaryView>(`/meetings/${id}/summary/clarifications`, { message }),
  replySummary: (id: string, message: string) => api.post<MeetingSummaryView>(`/meetings/${id}/summary/replies`, { message }),
  flagSummaryItem: (id: string, itemType: 'DECISION' | 'BLOCKER', itemId: string, flag: boolean, note?: string) =>
    api.post<MeetingSummaryView>(`/meetings/${id}/summary/follow-ups`, { itemType, itemId, flag, note: note || undefined }),
  updateSummaryAction: (actionId: string, status: MeetingActionStatus, note?: string) =>
    api.post<{ id: string; status: string }>(`/meetings/summary-actions/${actionId}`, { status, note: note || undefined }),
  summaries: (scope: 'MINE' | 'TEAM', tab: MeetingSummaryTab, offset = 0, limit = 50) =>
    api.get<MeetingSummaryList>('/meetings/summaries', { scope, tab, offset, limit }),
  myActions: () => api.get<MyMeetingAction[]>('/meetings/summaries/actions'),
  reportsOverview: (f: MeetingReportFilters) => api.get<MeetingReportsOverview>('/meetings/reports/overview', f),
  reports: (f: MeetingReportFilters & { status?: string; attention?: boolean; offset?: number; limit?: number }) =>
    api.get<MeetingReportList>('/meetings/reports', { ...f, attention: f.attention ? 'true' : undefined }),
  report: (id: string) => api.get<MeetingSummaryView>(`/meetings/reports/${id}`),
  reportActions: (f: MeetingReportFilters & { status?: 'OPEN' | 'OVERDUE' | 'DONE' | 'ALL'; offset?: number; limit?: number }) =>
    api.get<MeetingReportActionList>('/meetings/reports/actions', f)
};

/** What the summary form sends (the same shape the server validates). */
export type SummaryInput = Omit<MeetingSummaryContent, 'followUp' | 'decisions' | 'actions' | 'blockers'> & {
  followUp: { required: boolean; date: string | null; outcome: string | null };
  decisions: Omit<MeetingSummaryContent['decisions'][number], 'id' | 'department' | 'team' | 'decidedByName' | 'ceoFollowUp' | 'ceoFollowUpNote'>[];
  actions: Omit<MeetingSummaryContent['actions'][number], 'id' | 'assigneeName' | 'overdue' | 'completedAt' | 'updatedAt'>[];
  blockers: Omit<MeetingSummaryContent['blockers'][number], 'id' | 'ceoFollowUp' | 'ceoFollowUpNote'>[];
};
export type MeetingReportFilters = {
  from?: string;
  to?: string;
  departmentId?: string;
  teamId?: string;
  leaderId?: string;
  leaderRank?: number;
};

// ---------------------------------------------------------------------------
// Public booking pages (no login): plain fetch, no session
// ---------------------------------------------------------------------------
async function publicCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: { success?: boolean; data?: T; error?: { message?: string } } = {};
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok || !json.success) throw new Error(json.error?.message || (res.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Something went wrong. Please try again.'));
  return json.data as T;
}

export const publicBookingApi = {
  page: (slug: string) => publicCall<PublicBookingPage>('GET', `/public/booking/${encodeURIComponent(slug)}`),
  book: (slug: string, b: { startsAt: string; name: string; email: string; phone?: string; notes?: string; website?: string }) =>
    publicCall<PublicBookingResult>('POST', `/public/booking/${encodeURIComponent(slug)}`, b),
  view: (token: string) => publicCall<PublicBookingView>('GET', `/public/booking/manage/${encodeURIComponent(token)}`),
  cancel: (token: string, reason?: string) => publicCall<PublicBookingView>('POST', `/public/booking/manage/${encodeURIComponent(token)}/cancel`, { reason: reason || undefined }),
  answerProposal: (token: string, accept: boolean) => publicCall<PublicBookingView>('POST', `/public/booking/manage/${encodeURIComponent(token)}/proposal`, { accept })
};

import type {
  GoogleCalendarStatus, Meeting, MeetingAvailabilityWindow, MeetingBookingLink, MeetingBusyBlock, MeetingDetail, MeetingDirectoryEntry,
  MeetingSettings, PublicBookingPage, PublicBookingResult, PublicBookingView
} from '../../../shared/contracts';
import { api } from './client';

export interface NewMeeting {
  title: string;
  description?: string | null;
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
  directory: (search?: string) => api.get<MeetingDirectoryEntry[]>('/meetings/directory', { search }),
  busy: (profileIds: string[], from: string, to: string) => api.post<MeetingBusyBlock[]>('/meetings/busy', { profileIds, from, to }),
  settings: () => api.get<MeetingSettings>('/meetings/settings'),
  setAvailability: (timezone: string, availability: MeetingAvailabilityWindow[]) => api.post<MeetingSettings>('/meetings/settings/availability', { timezone, availability }),
  saveBookingLink: (b: BookingLinkInput) => api.post<MeetingBookingLink>('/meetings/settings/booking-links', b),
  setDelegates: (delegateIds: string[]) => api.post<MeetingSettings>('/meetings/settings/delegates', { delegateIds }),
  google: () => api.get<GoogleCalendarStatus>('/meetings/google'),
  googleConnect: () => api.post<{ url: string }>('/meetings/google/connect'),
  googleDisconnect: () => api.delete<GoogleCalendarStatus>('/meetings/google')
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

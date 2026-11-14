import type { PublicBookingPage, PublicBookingResult, PublicBookingView } from '../../shared/contracts.js';
import { bookingSlugSchema, meetingProposalAnswerSchema, publicBookingCancelSchema, publicBookingSchema } from '../../shared/validation.js';
import { automationSettings } from '../automations/config.js';
import { getServiceClient } from '../db/supabase.js';
import { AppError, fromDatabaseError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { linkSecret, manageToken, verifyManageToken } from './mail.js';
import { freeSlots, type AvailabilityWindow } from './slots.js';
import { googleBusy, meetingsQuietly } from './worker.js';

/**
 * Booking links for people outside the company (customers, leads, candidates, investors): no login. Every call goes through the server
 * with the service role (the database functions are not open to the public), after the API's per-address rate limit. The free slots
 * combine the host's working hours, their CRM meetings and, when they connected it, their Google Calendar; the database checks the
 * chosen slot again under a lock, so two guests can never take the same time.
 */

const appUrl = () => automationSettings().appUrl ?? 'https://crm.amuwacorporation.com';

interface PageRow {
  id: string; hostId: string; slug: string; title: string; description: string | null; kind: string; durationMinutes: number; bufferMinutes: number;
  minNoticeMinutes: number; maxDaysAhead: number; mode: 'GOOGLE_MEET' | 'IN_PERSON' | 'PHONE'; location: string | null; requiresApproval: boolean;
  hostName: string; hostPosition: string | null;
  settings: { timezone: string; availability: AvailabilityWindow[] };
  busy: { start: string; end: string }[];
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getServiceClient().rpc(fn, args);
  if (error) throw fromDatabaseError(error);
  return data as T;
}

async function slotsOf(p: PageRow): Promise<string[]> {
  const now = new Date();
  const to = new Date(now.getTime() + (p.maxDaysAhead + 1) * 86_400_000);
  const google = await googleBusy([p.hostId], now, to);
  return freeSlots(
    { timezone: p.settings.timezone, windows: p.settings.availability, durationMinutes: p.durationMinutes, bufferMinutes: p.bufferMinutes,
      minNoticeMinutes: p.minNoticeMinutes, maxDaysAhead: p.maxDaysAhead },
    [...p.busy, ...(google[p.hostId] ?? [])],
    now
  );
}

export async function bookingPage(slugRaw: string): Promise<PublicBookingPage> {
  const p = await rpc<PageRow>('mtg_public_page', { p_slug: parse(bookingSlugSchema, slugRaw) });
  return {
    slug: p.slug, title: p.title, description: p.description, kind: p.kind, durationMinutes: p.durationMinutes, mode: p.mode, location: p.location,
    hostName: p.hostName, hostPosition: p.hostPosition, requiresApproval: p.requiresApproval, timezone: p.settings.timezone, slots: await slotsOf(p)
  };
}

export async function bookSlot(slugRaw: string, body: unknown): Promise<PublicBookingResult> {
  const slug = parse(bookingSlugSchema, slugRaw);
  const i = parse(publicBookingSchema, body);
  if (i.website) throw new AppError('VALIDATION_ERROR', 'Your booking could not be sent.'); // honeypot
  const p = await rpc<PageRow>('mtg_public_page', { p_slug: slug });
  const startsAt = new Date(i.startsAt).toISOString();
  // offered right now? (also checks the host's Google Calendar, which the database cannot see)
  if (!(await slotsOf(p)).includes(startsAt)) throw new AppError('CONFLICT', 'This time is no longer free. Pick another one.');
  const m = await rpc<{ id: string; reference: string; status: PublicBookingResult['status']; startsAt: string; endsAt: string; timezone: string }>(
    'mtg_public_book', { p: { slug, startsAt, name: i.name, email: i.email, phone: i.phone ?? null, notes: i.notes ?? null } });
  await meetingsQuietly();
  const secret = linkSecret();
  return {
    reference: m.reference, status: m.status, startsAt: m.startsAt, endsAt: m.endsAt, timezone: m.timezone,
    manageUrl: secret ? `${appUrl()}/book/manage/${manageToken(m.id, secret)}` : null
  };
}

function meetingOfToken(token: string): string {
  const secret = linkSecret();
  const id = secret ? verifyManageToken(token, secret) : null;
  if (!id) throw new AppError('NOT_FOUND', 'This link is not valid.');
  return id;
}

export async function viewBooking(token: string): Promise<PublicBookingView> {
  return rpc<PublicBookingView>('mtg_public_get', { p_id: meetingOfToken(token) });
}

export async function cancelBooking(token: string, body: unknown): Promise<PublicBookingView> {
  const id = meetingOfToken(token);
  const r = await rpc<PublicBookingView>('mtg_public_cancel', { p_id: id, p_reason: parse(publicBookingCancelSchema, body ?? {}).reason ?? null });
  await meetingsQuietly();
  return r;
}

export async function answerBookingProposal(token: string, body: unknown): Promise<PublicBookingView> {
  const id = meetingOfToken(token);
  const r = await rpc<PublicBookingView>('mtg_public_answer_proposal', { p_id: id, p_accept: parse(meetingProposalAnswerSchema, body).accept });
  await meetingsQuietly();
  return r;
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingsPage } from '../../../src/components/meetings/MeetingsPage';
import { MyAvailabilityBadge } from '../../../src/components/meetings/CeoPresence';
import { CeoArrivalControl } from '../../../src/components/meetings/CeoArrival';
import './withAppFeedback';

/**
 * The real Meetings page (and the header badge every dashboard shows) with the CRM API answered in the page. The stand-in keeps the
 * availability like the database (20270122000100, 20270128000100): everyone, the Super Admin included, can be BUSY / AVAILABLE; asking the
 * CEO while they are BUSY joins their queue, and each Exit of the Super Admin confirms exactly one (the oldest); a meeting starting within
 * 30 minutes with a BUSY colleague is refused. Every request is recorded in window.__calls. The test changes a
 * colleague's state "on the server" with window.__setServerStatus and then fires the Realtime event, as Supabase would.
 */
const w = window as any;
const CEO = '00000000-0000-4000-8000-0000000000c1';
const ME = '00000000-0000-4000-8000-0000000000a1';
const COL = '00000000-0000-4000-8000-0000000000b1';
const NAMES: Record<string, string> = { [CEO]: 'Asha CEO', [ME]: 'Team Member A', [COL]: 'Ravi Colleague' };
w.__calls = [];
const state: Record<string, { status: 'AVAILABLE' | 'BUSY'; since: string }> = {};
const get = (id: string) => state[id] ?? { status: 'AVAILABLE' as const, since: new Date().toISOString() };
w.__setServerStatus = (id: string, s: 'AVAILABLE' | 'BUSY') => { state[id] = { status: s, since: new Date().toISOString() }; };
const isCeo = () => w.__profile?.id === CEO;
const clients: { requestId: string; m: any }[] = [];
const mails: any[] = [];
const full = (x: any) => ({ reference: `MTG-${clients.length + 1}`, createdBy: ME, createdByName: NAMES[ME], timezone: 'Asia/Kolkata', status: 'SCHEDULED',
  requiresApproval: false, decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null, proposedStartsAt: null, proposedEndsAt: null, cancelReason: null,
  bookedVia: 'STAFF', sourceType: null, sourceId: null, customerId: null, googleSyncStatus: 'NOT_CONNECTED', googleSyncError: null, googleEventId: null, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), canManage: true, canDecide: false, canAnswerProposal: false, canWithdraw: false,
  canRequestChange: false, myResponse: null, requestMessage: null, createdByDepartment: null, createdByDesignation: null, rejectionReason: null,
  previousStartsAt: null, previousEndsAt: null, rescheduledAt: null, rescheduledBy: null, rescheduledByName: null, rescheduleReason: null, rescheduleCount: 0,
  hostEmail: 'a@x.example', ...x });
// the Super Admin's queue: requests made while they are BUSY, oldest first
const queue: { id: string; title: string; startsAt: string; endsAt: string; createdAt: string; requestedBy: string }[] = [];
// the week's meetings the calendar lists (the test fills it)
const week: any[] = [];
let roomLink: string | null = null;
const hrRequests: any[] = [];
// the CEO's office arrival today (20270128000300): HR marks it; it never changes what a request does
const office = { arrived: false, arrivedAt: null as string | null, markedBy: null as string | null };
w.__setArrived = (v: boolean) => { office.arrived = v; office.arrivedAt = v ? new Date().toISOString() : null; office.markedBy = v ? 'Hema HR' : null; };
const officeJson = (dup?: boolean) => ({ day: new Date().toISOString().slice(0, 10), canMark: !!w.__profile?.hr, ...(dup === undefined ? {} : { duplicate: dup }),
  ceos: [{ ceoId: CEO, name: 'Asha CEO', position: 'CEO', arrived: office.arrived, arrivedAt: office.arrivedAt, markedBy: office.markedBy, presence: get(CEO).status }] });
const row = (id: string) => ({ hostId: id, hostName: NAMES[id], position: null, status: get(id).status, since: get(id).since, updatedAt: get(id).since, meeting: null,
  isCeo: id === CEO, pending: id === CEO && isCeo() ? queue.slice() : null, pendingCount: id === CEO ? queue.length : 0 });
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });
  const p = url.pathname.replace('/api/v1', '');
  const self = isCeo() ? CEO : ME;
  if (p === '/meetings/presence') {
    const ids = url.searchParams.get('ids');
    if (ids) return json(ids.split(',').map(row));
    return json([row(self)]);
  }
  if (p === '/meetings/presence/ceo') return json([row(CEO)]);
  if (p === '/meetings/ceo-office') return json(officeJson());
  if (p === '/meetings/ceo-office/arrived' || p === '/meetings/ceo-office/undo') {
    if (!w.__profile?.hr) return json({ code: 'FORBIDDEN', message: 'Only HR marks the CEO\'s arrival.' }, 403);
    const undo = p.endsWith('/undo');
    const dup = !undo && office.arrived;
    if (undo) w.__setArrived(false); else if (!dup) { w.__setArrived(true); office.markedBy = w.__profile.fullName; }
    return json(officeJson(undo ? undefined : dup));
  }
  if (p === '/meetings/presence/enter') { if (get(self).status !== 'BUSY') w.__setServerStatus(self, 'BUSY'); return json(row(self)); }
  if (p === '/meetings/presence/exit') {
    // like mtg_presence_exit: only BUSY -> AVAILABLE confirms, and then exactly one (the oldest waiting)
    const wasBusy = get(self).status === 'BUSY';
    w.__setServerStatus(self, 'AVAILABLE');
    const next = wasBusy && self === CEO ? queue.shift() : undefined;
    return json({ ...row(self), scheduled: next ? [{ ...next, startsAt: new Date().toISOString(), moved: true, stillWaiting: queue.length }] : [] });
  }
  if (p === '/meetings/settings/room-link' && method === 'GET') return json({ roomLink });
  if (p === '/meetings/settings/room-link' && method === 'POST') {
    if (body.roomLink && !/^https:\/\//.test(body.roomLink)) return json({ code: 'VALIDATION_ERROR', message: 'Give the meeting room link (https://...).' }, 400);
    roomLink = body.roomLink ?? null;
    return json({ roomLink });
  }
  if (p === '/meetings/google') return json({ configured: false, connected: false, status: 'NOT_CONNECTED', googleEmail: null, lastError: null, connectedAt: null });
  if (p === '/meetings/approvals') return json([]);
  if (p === '/meetings/settings') return json({ timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: [], isCeo: isCeo() });
  if (p === '/meetings/directory') return json([
    { id: CEO, name: 'Asha CEO', email: 'ceo@x.example', position: 'CEO', role: 'SUPER_ADMIN', department: null, isCeo: true, googleConnected: false },
    { id: COL, name: 'Ravi Colleague', email: 'ravi@x.example', position: null, role: 'TEAM_MEMBER', department: 'Wabastore', isCeo: false, googleConnected: false }]);
  if (p === '/meetings/busy') return json([]);
  if (p === '/meetings/ceo-requests') return json({ isSuperAdmin: isCeo(), counts: { pending: 0, approved: 0, rejected: 0, rescheduled: 0, all: 0 }, items: [], total: 0 });
  // ---- client meetings (20270122000200): stored like the database, one per clientRequestId, with an e-mail outbox per meeting
  if (p === '/meetings/client' && method === 'POST') {
    const dup = clients.find(c => c.requestId === body.clientRequestId);
    if (dup) return json({ ...dup.m, duplicate: true }, 201);
    const m = full({ id: `00000000-0000-4000-8000-${String(900 + clients.length).padStart(12, '0')}`, kind: 'CLIENT_MEETING', kindLabel: 'Client meeting', title: body.title,
      description: body.agenda, startsAt: body.startsAt, endsAt: body.endsAt, mode: body.mode === 'ONLINE' ? 'ONLINE_LINK' : 'IN_PERSON', meetLink: body.meetLink ?? null,
      location: body.location ?? null, hostId: body.hostId ?? ME, hostName: NAMES[body.hostId ?? ME], clientCompany: body.companyName,
      attendees: [{ id: 'a1', profileId: null, name: body.clientName, email: body.clientEmail.toLowerCase(), phone: null, role: 'EXTERNAL', response: 'NEEDS_ACTION' }],
      client: { name: body.clientName, email: body.clientEmail.toLowerCase() } });
    clients.push({ requestId: body.clientRequestId, m });
    mails.push({ id: 100 + mails.length, meetingId: m.id, toEmail: m.client.email, toName: body.clientName, kind: 'CONFIRMED', external: true,
      status: w.__mailOutcome ?? 'SENT', attempts: 1, lastError: w.__mailOutcome === 'FAILED' ? 'SMTP 550: mailbox unavailable' : null,
      sentAt: (w.__mailOutcome ?? 'SENT') === 'SENT' ? new Date().toISOString() : null, createdAt: new Date().toISOString(), meetingVersion: 1 });
    return json({ ...m, duplicate: false }, 201);
  }
  if (p === '/meetings/client' && method === 'GET') return json(clients.map(c => c.m).filter(m => !url.searchParams.get('status') || (url.searchParams.get('status') === 'CANCELLED') === (m.status === 'CANCELLED')));
  const mailRetry = p.match(/^\/meetings\/mails\/(\d+)\/retry$/);
  if (mailRetry) { const x = mails.find(o => o.id === Number(mailRetry[1])); if (x) { x.status = 'SENT'; x.sentAt = new Date().toISOString(); x.lastError = null; } return json({ id: x?.id, status: 'PENDING' }); }
  const mailLog = p.match(/^\/meetings\/([^/]+)\/mails$/);
  if (mailLog) return json(mails.filter(o => o.meetingId === mailLog[1]));
  const detail = p.match(/^\/meetings\/([0-9a-f-]{36})$/);
  if (detail && method === 'GET') { const c = clients.find(x => x.m.id === detail[1]); return c ? json({ ...c.m, history: [] }) : json({ code: 'NOT_FOUND', message: 'Meeting not found.' }, 404); }
  const cancel = p.match(/^\/meetings\/([0-9a-f-]{36})\/cancel$/);
  if (cancel) {
    const c = clients.find(x => x.m.id === cancel[1]);
    if (c) { c.m.status = 'CANCELLED'; c.m.version += 1; mails.push({ id: 100 + mails.length, meetingId: c.m.id, toEmail: c.m.client.email, toName: c.m.client.name, kind: 'CANCELLED', external: true,
      status: 'SENT', attempts: 1, lastError: null, sentAt: new Date().toISOString(), createdAt: new Date().toISOString(), meetingVersion: c.m.version }); }
    return json(c?.m);
  }
  // the meeting request to HR (Meetings > HR meeting requests; 20261210000100), stored like the database: one per form
  if (p === '/employee/meetings' && method === 'GET') return json({ items: hrRequests, total: hrRequests.length, limit: 10, offset: 0 });
  if (p === '/employee/meetings' && method === 'POST') {
    const dup = hrRequests.find(r => r.requestId === body.clientRequestId);
    if (dup) return json({ ...dup, duplicate: true }, 201);
    const r = { id: `hr${hrRequests.length + 1}`, reference: `MTG-2026-${String(hrRequests.length + 1).padStart(5, '0')}`, subject: body.subject, category: body.category, status: 'PENDING',
      preferredDate: body.preferredDate, preferredTime: body.preferredTime, mode: body.mode, confirmedDate: null, confirmedTime: null, requestId: body.clientRequestId, createdAt: new Date().toISOString() };
    hrRequests.unshift(r);
    return json({ ...r, duplicate: false }, 201);
  }
  if (p === '/meetings' && method === 'GET') return json(week);
  if (p === '/meetings' && method === 'POST' && body.hostId === CEO) {
    const m = { id: `00000000-0000-4000-8000-${String(700 + queue.length).padStart(12, '0')}`, kind: 'CEO_MEETING', kindLabel: 'CEO meeting', title: body.title,
      startsAt: body.startsAt, endsAt: body.endsAt, hostName: NAMES[CEO], googleSyncStatus: 'NOT_CONNECTED',
      status: get(CEO).status === 'BUSY' ? 'PENDING_AVAILABILITY' : 'REQUESTED' };
    if (m.status === 'PENDING_AVAILABILITY') queue.push({ id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, createdAt: new Date().toISOString(), requestedBy: NAMES[ME] });
    return json(m, 201);
  }
  if (p === '/meetings' && method === 'POST') {
    const soon = new Date(body.startsAt).getTime() < Date.now() + 30 * 60_000;
    const busy = (body.attendeeIds ?? []).find((id: string) => get(id).status === 'BUSY');
    if (soon && busy) return json({ code: 'CONFLICT', message: `${NAMES[busy]} is in a meeting right now (Busy). Pick a later time, or wait until they exit their meeting.` }, 409);
    return json({ id: 'm1', kind: 'MEETING', kindLabel: 'Meeting', title: body.title, status: 'SCHEDULED', startsAt: body.startsAt, endsAt: body.endsAt, hostName: NAMES[ME], googleSyncStatus: 'NOT_CONNECTED' }, 201);
  }
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

w.__ids = { CEO, ME, COL };
w.__clients = clients;
w.__mails = mails;
w.__queue = queue;
w.__week = week;
w.__full = full;
w.mount = (who: 'ceo' | 'member' | 'hr') => {
  w.__profile = who === 'ceo'
    ? { id: CEO, fullName: 'Asha CEO', role: 'SUPER_ADMIN', status: 'ACTIVE' }
    : who === 'hr' ? { id: '00000000-0000-4000-8000-0000000000d1', fullName: 'Hema HR', role: 'TEAM_MEMBER', status: 'ACTIVE', hr: true }
    : { id: ME, fullName: 'Team Member A', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  createRoot(document.getElementById('root')!).render(
    <div className="p-3 space-y-3">
      <div data-testid="header">Header: <MyAvailabilityBadge /></div>
      <CeoArrivalControl />
      <MeetingsPage />
    </div>
  );
};

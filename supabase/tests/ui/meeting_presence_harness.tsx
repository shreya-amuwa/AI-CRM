import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingsPage } from '../../../src/components/meetings/MeetingsPage';
import { MyAvailabilityBadge } from '../../../src/components/meetings/CeoPresence';

/**
 * The real Meetings page (and the header badge every dashboard shows) with the CRM API answered in the page. The stand-in keeps the
 * availability like the database (20270122000100): every employee but the Super Admin can be BUSY / AVAILABLE; the Super Admin is refused;
 * a meeting starting within 30 minutes with a BUSY colleague is refused. Every request is recorded in window.__calls. The test changes a
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
const row = (id: string) => ({ hostId: id, hostName: NAMES[id], position: null, status: get(id).status, since: get(id).since, updatedAt: get(id).since, meeting: null, pending: null, pendingCount: 0 });
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });
  const p = url.pathname.replace('/api/v1', '');
  const forbidden = () => json({ code: 'FORBIDDEN', message: 'Enter Meeting and Exit Meeting are for employees. The Super Admin\'s availability is not tracked.' }, 403);
  if (p === '/meetings/presence') {
    const ids = url.searchParams.get('ids');
    if (ids) return json(ids.split(',').filter(id => id !== CEO).map(row));
    return json(isCeo() ? [] : [row(ME)]);
  }
  if (p === '/meetings/presence/enter') { if (isCeo()) return forbidden(); w.__setServerStatus(ME, 'BUSY'); return json(row(ME)); }
  if (p === '/meetings/presence/exit') { if (isCeo()) return forbidden(); w.__setServerStatus(ME, 'AVAILABLE'); return json({ ...row(ME), scheduled: [] }); }
  if (p === '/meetings/google') return json({ configured: false, connected: false, status: 'NOT_CONNECTED', googleEmail: null, lastError: null, connectedAt: null });
  if (p === '/meetings/approvals') return json([]);
  if (p === '/meetings/settings') return json({ timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: [], isCeo: isCeo() });
  if (p === '/meetings/directory') return json([
    { id: CEO, name: 'Asha CEO', email: 'ceo@x.example', position: 'CEO', role: 'SUPER_ADMIN', department: null, isCeo: true, googleConnected: false },
    { id: COL, name: 'Ravi Colleague', email: 'ravi@x.example', position: null, role: 'TEAM_MEMBER', department: 'Wabastore', isCeo: false, googleConnected: false }]);
  if (p === '/meetings/busy') return json([]);
  if (p === '/meetings/ceo-requests') return json({ sections: { pending: 0 }, items: [], total: 0 });
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
  if (p === '/meetings' && method === 'GET') return json([]);
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
w.mount = (who: 'ceo' | 'member') => {
  w.__profile = who === 'ceo'
    ? { id: CEO, fullName: 'Asha CEO', role: 'SUPER_ADMIN', status: 'ACTIVE' }
    : { id: ME, fullName: 'Team Member A', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  createRoot(document.getElementById('root')!).render(
    <div className="p-3 space-y-3">
      <div data-testid="header">Header: <MyAvailabilityBadge /></div>
      <MeetingsPage />
    </div>
  );
};

import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingsPage } from '../../../src/components/meetings/MeetingsPage';
import { CeoAvailabilityBadge } from '../../../src/components/meetings/CeoPresence';

/**
 * The real Meetings page (and the header badge every dashboard shows) with the CRM API answered in the page. The stand-in keeps the CEO's
 * availability like the database: BUSY / AVAILABLE, requests made while BUSY wait as PENDING_AVAILABILITY and are scheduled on Exit.
 * Every request is recorded in window.__calls. The test changes the state "on the server" with window.__setServerStatus and then fires the
 * Realtime event, as Supabase would.
 */
const w = window as any;
const CEO = '00000000-0000-4000-8000-0000000000c1';
const ME = '00000000-0000-4000-8000-0000000000a1';
w.__calls = [];
let status: 'AVAILABLE' | 'BUSY' = 'AVAILABLE';
let since = new Date().toISOString();
const pending: any[] = [];
const scheduled: any[] = [];
w.__setServerStatus = (s: 'AVAILABLE' | 'BUSY') => { status = s; since = new Date().toISOString(); };
const isCeo = () => w.__profile?.id === CEO;
let seq = 0;
const meeting = (extra: any) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, reference: 'MTG-1', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', title: 'x', description: null, hostId: CEO, hostName: 'Asha CEO',
  hostEmail: 'ceo@x.example', createdBy: ME, createdByName: 'Team Member A', startsAt: '', endsAt: '', timezone: 'Asia/Kolkata', mode: 'GOOGLE_MEET', location: null,
  meetLink: null, status: 'SCHEDULED', requiresApproval: true, decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null, proposedStartsAt: null,
  proposedEndsAt: null, cancelReason: null, bookedVia: 'STAFF', sourceType: null, sourceId: null, customerId: null, googleSyncStatus: 'NOT_CONNECTED',
  googleSyncError: null, googleEventId: null, version: 1, createdAt: new Date().toISOString(), updatedAt: '', canManage: true, canDecide: false,
  canAnswerProposal: false, myResponse: 'ACCEPTED', attendees: [], ...extra
});
const presence = () => [{
  hostId: CEO, hostName: 'Asha CEO', position: 'CEO', status, since, updatedAt: since,
  meeting: null, pending: isCeo() ? pending.map(p => ({ id: p.id, title: p.title, startsAt: p.startsAt, endsAt: p.endsAt, requestedBy: 'Team Member A', createdAt: p.createdAt })) : null,
  pendingCount: pending.length
}];
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/meetings/presence') return json(presence());
  if (p === '/meetings/presence/enter') { if (!isCeo()) return json({ code: 'FORBIDDEN', message: 'Only the Super Admin can change their meeting availability.' }, 403); status = 'BUSY'; since = new Date().toISOString(); return json(presence()[0]); }
  if (p === '/meetings/presence/exit') {
    if (!isCeo()) return json({ code: 'FORBIDDEN', message: 'Only the Super Admin can change their meeting availability.' }, 403);
    status = 'AVAILABLE';
    const done = pending.splice(0).map(m => { const s = { ...m, status: 'SCHEDULED' }; scheduled.push(s); return { id: s.id, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, requestedStartsAt: s.startsAt, moved: false, requestedBy: ME }; });
    return json({ ...presence()[0], scheduled: done });
  }
  if (p === '/meetings/google') return json({ configured: false, connected: false, status: 'NOT_CONNECTED', googleEmail: null, lastError: null, connectedAt: null });
  if (p === '/meetings/approvals') return json([]);
  if (p === '/meetings/settings') return json({ timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: [], isCeo: isCeo() });
  if (p === '/meetings/directory') return json([{ id: CEO, name: 'Asha CEO', email: 'ceo@x.example', position: 'CEO', role: 'SUPER_ADMIN', department: null, isCeo: true, googleConnected: false }]);
  if (p === '/meetings/busy') return json([]);
  if (p === '/meetings' && method === 'GET') return json([...pending, ...scheduled]);
  if (p === '/meetings' && method === 'POST') {
    const m = meeting({ title: body.title, description: body.description, startsAt: body.startsAt, endsAt: body.endsAt, status: status === 'BUSY' ? 'PENDING_AVAILABILITY' : 'REQUESTED' });
    if (m.status === 'PENDING_AVAILABILITY') pending.push(m);
    return json(m, 201);
  }
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

w.__ids = { CEO, ME };
w.mount = (who: 'ceo' | 'member') => {
  w.__profile = who === 'ceo'
    ? { id: CEO, fullName: 'Asha CEO', role: 'SUPER_ADMIN', status: 'ACTIVE' }
    : { id: ME, fullName: 'Team Member A', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  createRoot(document.getElementById('root')!).render(
    <div className="p-3 space-y-3">
      <div data-testid="header">Header: <CeoAvailabilityBadge /></div>
      <MeetingsPage />
    </div>
  );
};

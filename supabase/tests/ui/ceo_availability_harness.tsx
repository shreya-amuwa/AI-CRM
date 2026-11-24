import React from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../../../src/components/layout/Sidebar';
import { DashboardShell } from '../../../src/components/layout/shell';
import { CeoAvailabilityPage } from '../../../src/components/meetings/CeoAvailabilityPage';
import { MeetingsPage } from '../../../src/components/meetings/MeetingsPage';
import { Inbox } from 'lucide-react';

/**
 * CEO Availability (migration 20270201000100) with the CRM API answered in the page, stored like the database: ONE status for the CEO, set by HR
 * staff only (an HR Recruiter, an employee and a visitor are refused), with the time and person of the latest update, read by every screen.
 * Real components: the HR department's sidebar, the HR Recruiter's shell, the CEO Availability page, and the Meetings page with Ask the CEO for time.
 * Every request is recorded in window.__calls; window.__requests holds the meeting requests saved ("the database").
 */
const w = window as any;
const CEO = '00000000-0000-4000-8000-0000000000c1';
w.__calls = [];
w.__requests = [] as any[];
const office = { arrived: false, arrivedAt: null as string | null, markedBy: null as string | null, updatedAt: null as string | null, updatedStatus: null as string | null, updatedBy: null as string | null };
const officeJson = (dup?: boolean) => ({
  day: new Date().toISOString().slice(0, 10), canMark: !!w.__profile?.hr, ...(dup === undefined ? {} : { duplicate: dup }),
  ceos: [{ ceoId: CEO, name: 'Asha CEO', position: 'CEO', arrived: office.arrived, arrivedAt: office.arrivedAt, markedBy: office.markedBy, presence: 'AVAILABLE',
    status: office.arrived ? 'ARRIVED' : 'NOT_ARRIVED', updatedAt: office.updatedAt, updatedStatus: office.updatedStatus, updatedBy: office.updatedBy, updatedToday: !!office.updatedAt }]
});
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/meetings/ceo-office') return json(officeJson());
  if (p === '/meetings/ceo-office/arrived' || p === '/meetings/ceo-office/not-arrived') {
    if (!w.__profile?.hr) return json({ code: 'FORBIDDEN', message: 'Only HR marks the CEO\'s arrival.' }, 403);
    const arrive = p.endsWith('/arrived');
    const dup = arrive ? office.arrived : !office.arrived && office.updatedStatus === 'NOT_ARRIVED';
    if (!dup) {
      office.arrived = arrive; office.arrivedAt = arrive ? new Date().toISOString() : null; office.markedBy = arrive ? w.__profile.fullName : null;
      office.updatedAt = new Date().toISOString(); office.updatedStatus = arrive ? 'ARRIVED' : 'NOT_ARRIVED'; office.updatedBy = w.__profile.fullName;
      w.__fireRealtime?.('ceo_office_arrivals');
    }
    return json(officeJson(dup));
  }
  if (p === '/meetings/presence/ceo') return json([{ hostId: CEO, hostName: 'Asha CEO', position: null, status: 'AVAILABLE', since: new Date().toISOString(), updatedAt: new Date().toISOString(), meeting: null, isCeo: true, pending: null, pendingCount: 0 }]);
  if (p === '/meetings/presence') return json([]);
  if (p === '/meetings/google') return json({ configured: false, connected: false, status: 'NOT_CONNECTED', googleEmail: null, lastError: null, connectedAt: null });
  if (p === '/meetings/approvals') return json([]);
  if (p === '/meetings/settings') return json({ timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: [], isCeo: false });
  if (p === '/meetings/directory') return json([{ id: CEO, name: 'Asha CEO', email: 'ceo@x.example', position: 'CEO', role: 'SUPER_ADMIN', department: null, isCeo: true, googleConnected: false }]);
  if (p === '/meetings/busy') return json([]);
  if (p === '/meetings/ceo-requests') return json({ section: 'ALL', isSuperAdmin: false, counts: { pending: w.__requests.length, approved: 0, rejected: 0, rescheduled: 0, all: w.__requests.length }, items: w.__requests, limit: 50, offset: 0 });
  if (p === '/meetings' && method === 'GET') return json([]);
  if (p === '/meetings' && method === 'POST') {
    // saved whatever the CEO's status is (the database does not read it)
    const m = { id: `00000000-0000-4000-8000-${String(700 + w.__requests.length).padStart(12, '0')}`, reference: `MTG-${w.__requests.length + 1}`, kind: 'CEO_MEETING', kindLabel: 'CEO meeting', title: body.title,
      description: body.description, startsAt: body.startsAt, endsAt: body.endsAt, requestedStartsAt: body.startsAt, hostId: CEO, hostName: 'Asha CEO', status: 'REQUESTED', createdBy: 'me',
      createdByName: 'Team Member A', createdByDepartment: 'Wabastore', createdByDesignation: 'Team Member', mode: body.mode, location: null, meetLink: null, googleSyncStatus: 'NOT_CONNECTED',
      createdAt: new Date().toISOString(), rescheduleCount: 0, attendees: [], canManage: false, canDecide: false, canWithdraw: true };
    w.__requests.unshift(m);
    return json(m, 201);
  }
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="p-3 space-y-3">{children}</div>;
w.mount = (who: 'hr' | 'recruiter' | 'member', view: 'page' | 'meetings' | 'sidebar' | 'shell', slot = 'root', dept = 'hr') => {
  w.__profile = who === 'hr' ? { id: 'hr1', fullName: 'Hema HR', role: 'TEAM_MEMBER', status: 'ACTIVE', hr: true, hrSubRole: 'HR_ASSISTANT' }
    : who === 'recruiter' ? { id: 'rec1', fullName: 'Rita Recruiter', role: 'TEAM_MEMBER', status: 'ACTIVE', hrSubRole: 'HR_RECRUITER' }
    : { id: 'me', fullName: 'Team Member A', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  w.__user = { id: w.__profile.id, name: w.__profile.fullName, role: who === 'member' ? 'team-member' : 'hr', profile: w.__profile };
  let el = document.getElementById(slot);
  if (!el) { el = document.createElement('div'); el.id = slot; document.body.appendChild(el); }
  createRoot(el).render(
    view === 'sidebar' ? <Sidebar activeTab="dashboard" onSelectTab={t => { w.__tab = t; }} departmentId={dept as any} />
    : view === 'shell' ? (
      <DashboardShell title="Amuwa HR" subtitle="Recruiter" ariaLabel="HR Recruiter navigation" groups={[{ items: [{ id: 'dashboard', label: 'Overview', icon: Inbox }] }]} active="dashboard"
        onSelect={() => undefined} user={{ name: 'Rita Recruiter', role: 'HR Recruiter' }} onSignOut={() => undefined} ceoAvailability={who !== 'member'}>
        <div data-testid="shell-home">Recruiter home</div>
      </DashboardShell>)
    : view === 'meetings' ? <Page><MeetingsPage /></Page>
    : <Page><CeoAvailabilityPage /></Page>
  );
};

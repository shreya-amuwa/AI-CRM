import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from 'lucide-react';
import { DashboardShell } from '../../../src/components/layout/shell';
import { openFromNotification } from '../../../src/components/issues/issueEvents';

/**
 * The real dashboard shell (its menu adds Attendance, Meetings and the Notice Board to every dashboard) with the CRM API answered in the page
 * like the database (20270131000100, 20270131000200): notices addressed to the signed-in person, read receipts, publishing only for the
 * publishers (the Super Admin, HR, ...), and Today's Attendance Overview. window.openFromNotification is the bell's click.
 */
const w = window as any;
w.__calls = [];
w.openFromNotification = openFromNotification;
const PEOPLE = [
  { id: '00000000-0000-4000-8000-0000000000e1', name: 'Priya Member', role: 'TEAM_MEMBER', department: 'Wabastore', departmentId: '00000000-0000-4000-8000-00000000d001' },
  { id: '00000000-0000-4000-8000-0000000000e2', name: 'Ravi Member', role: 'TEAM_MEMBER', department: 'Wabastore', departmentId: '00000000-0000-4000-8000-00000000d001' },
  { id: '00000000-0000-4000-8000-0000000000e3', name: 'Anita Accounts', role: 'TEAM_MEMBER', department: 'Accounts', departmentId: '00000000-0000-4000-8000-00000000d002' }
];
const DEPTS = [{ id: '00000000-0000-4000-8000-00000000d001', name: 'Wabastore' }, { id: '00000000-0000-4000-8000-00000000d002', name: 'Accounts' }];
const notices: any[] = [];
const reads: Record<string, Record<string, string>> = {};
let seq = 0;
const make = (x: any) => {
  const n = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, reference: `NTC-2026-${String(seq).padStart(5, '0')}`, status: 'PUBLISHED', expired: false,
    publishAt: new Date().toISOString(), expiresAt: null, releasedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, attachments: [],
    audience: { type: 'COMPANY', departments: [], roles: [], employees: [], departmentNames: [] }, ...x };
  notices.unshift(n);
  reads[n.id] = {};
  return n;
};
// the recipients of a notice: everyone in its audience but its publisher
const recipients = (n: any) => PEOPLE.filter(p => p.id !== n.publisherId && (n.audience.type === 'COMPANY' || (n.audience.type === 'DEPARTMENT' && n.audience.departments.includes(p.departmentId))
  || (n.audience.type === 'EMPLOYEES' && n.audience.employees.includes(p.id))));
const view = (n: any, full = false) => {
  const me = w.__profile.id;
  const mine = recipients(n).some(p => p.id === me);
  return { ...n, body: full ? n.body : n.body.slice(0, 280), isRecipient: mine, read: mine ? !!reads[n.id][me] : true, readAt: reads[n.id][me] ?? null,
    canManage: n.publisherId === me || w.__profile.role === 'SUPER_ADMIN', recipientCount: recipients(n).length, readCount: Object.keys(reads[n.id]).length };
};
const inbox = () => notices.filter(n => n.status === 'PUBLISHED' && recipients(n).some(p => p.id === w.__profile.id));
const unread = () => inbox().filter(n => !reads[n.id][w.__profile.id]).length;
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });
  const p = url.pathname.replace('/api/v1', '');
  const me = w.__profile;
  if (p === '/bugs/access') return json({ isDeveloper: false, isLead: false, developers: [] });
  if (p === '/notices/unread-count') return json({ unread: unread() });
  if (p === '/notices/audience') return json(me.publisher ? { canPublish: true, role: me.publisher, audiences: ['COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES'], departments: DEPTS,
    roles: [{ id: 'TEAM_HEAD', label: 'Team Leads' }, { id: 'TEAM_MEMBER', label: 'Team Members' }], employees: PEOPLE }
    : { canPublish: false, role: null, audiences: [], departments: [], roles: [], employees: [] });
  if (p === '/notices' && method === 'GET') {
    const scope = url.searchParams.get('scope') ?? 'INBOX';
    if (scope === 'MINE' && !me.publisher) return json({ code: 'FORBIDDEN', message: 'Only publishers have published notices.' }, 403);
    let items = scope === 'MINE' ? notices.filter(n => n.status !== 'DELETED' && (n.publisherId === me.id || me.role === 'SUPER_ADMIN')) : scope === 'ALL' ? notices.filter(n => n.status === 'PUBLISHED') : inbox();
    if (url.searchParams.get('unread') === 'true') items = items.filter(n => !reads[n.id][me.id]);
    if (url.searchParams.get('priority')) items = items.filter(n => n.priority === url.searchParams.get('priority'));
    return json({ items: items.map(n => view(n)), total: items.length, unread: unread(), publisherRole: me.publisher ?? null });
  }
  if (p === '/notices' && method === 'POST') {
    // like notice_publish: publishers only
    if (!me.publisher) return json({ code: 'FORBIDDEN', message: 'Only the Super Admin, an Operations Head, HR and the Developers team publish notices.' }, 403);
    const n = make({ title: body.title, body: body.body, category: body.category, priority: body.priority, publisherId: me.id, publisherName: me.fullName, publisherRole: me.publisher,
      audience: { type: body.audienceType, departments: body.departmentIds, roles: body.roles, employees: body.employeeIds, departmentNames: DEPTS.filter(d => body.departmentIds.includes(d.id)).map(d => d.name) } });
    return json({ ...view(n, true), duplicate: false }, 201);
  }
  const one = p.match(/^\/notices\/([0-9a-f-]{36})(?:\/(receipts|update|archive))?$/);
  if (one) {
    const n = notices.find(x => x.id === one[1]);
    // like the database: a deleted notice does not exist for anybody
    if (!n || (n.status === 'DELETED' && method !== 'DELETE')) return json({ code: 'NOT_FOUND', message: 'Notice not found.' }, 404);
    if (method === 'DELETE') {
      // like notice_delete: only the publisher of the notice or the Super Admin, and only while they manage notices; anybody else is told it does not exist
      if (!(n.publisherId === me.id || me.role === 'SUPER_ADMIN')) return json({ code: 'NOT_FOUND', message: 'Notice not found.' }, 404);
      if (!me.publisher) return json({ code: 'FORBIDDEN', message: 'Only the people who manage notices can delete them.' }, 403);
      if (w.__deleteDelay) await new Promise(r => setTimeout(r, w.__deleteDelay));
      if (w.__deleteFails) return json({ code: 'INTERNAL', message: 'Something went wrong. Please try again.' }, 500);
      const again = n.status === 'DELETED';
      n.status = 'DELETED';
      return json({ id: n.id, deleted: true, alreadyDeleted: again });
    }
    if (one[2] === 'receipts') return json({ noticeId: n.id, status: n.status, total: recipients(n).length, read: Object.keys(reads[n.id]).length, unread: recipients(n).length - Object.keys(reads[n.id]).length,
      push: { devices: 2, accepted: 2, pending: 0, failed: 0, cancelled: 0 }, rows: recipients(n).map(x => ({ profileId: x.id, name: x.name, department: x.department, notifiedAt: n.releasedAt, readAt: reads[n.id][x.id] ?? null })) });
    if (one[2] === 'archive') { n.status = 'ARCHIVED'; return json(view(n, true)); }
    if (recipients(n).some(x => x.id === me.id)) reads[n.id][me.id] = reads[n.id][me.id] ?? new Date().toISOString();
    return json({ ...view(n, true), history: [] });
  }
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

w.__notices = notices;
w.__make = make;
w.__people = PEOPLE;
w.__reads = reads;
const Dash: React.FC = () => {
  const [page, setPage] = useState('home');
  return (
    <DashboardShell title="Amuwa" ariaLabel="Test dashboard" groups={[{ items: [{ id: 'home', label: 'Home', icon: Home }] }]} active={page} onSelect={setPage}
      user={{ name: w.__profile.fullName, role: 'Employee' }} onSignOut={() => undefined} reminders={false}>
      <p data-testid="home-page">Home page</p>
    </DashboardShell>
  );
};
let root: ReturnType<typeof createRoot> | null = null;
w.mount = (who: 'member' | 'sa' | 'hr') => {
  w.__profile = who === 'sa' ? { id: '00000000-0000-4000-8000-0000000000a1', fullName: 'Asha CEO', role: 'SUPER_ADMIN', publisher: 'SUPER_ADMIN' }
    : who === 'hr' ? { id: '00000000-0000-4000-8000-0000000000b1', fullName: 'Hema HR', role: 'DEPARTMENT_HEAD', publisher: 'HR', department: { slug: 'hr' } }
    : { id: PEOPLE[0].id, fullName: PEOPLE[0].name, role: 'TEAM_MEMBER' };
  root = createRoot(document.getElementById('root')!);
  root.render(<Dash />);
};
w.signOut = () => { root?.unmount(); root = null; document.body.innerHTML = '<div id="root"></div>'; w.__calls = []; };

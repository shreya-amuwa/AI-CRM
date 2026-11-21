import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardShell } from '../../../src/components/layout/shell';
import RaiseIssuePage from '../../../src/components/issues/RaiseIssuePage';

/**
 * The real dashboard shell (its menu adds Attendance, Meetings and, for developers only, Bugs) with the real Raise an Issue page, and the
 * CRM API answered in the page like the database (20270122000300): who is a developer, bugs, the reporter's list, assign / status /
 * comments, internal comments hidden from the reporter, and FORBIDDEN for anyone else. Every request is recorded in window.__calls.
 */
const w = window as any;
const DEVS = [{ id: 'd1', name: 'Shreya Mande', lead: true }, { id: 'd2', name: 'Ashish Sinha', lead: false }, { id: 'd3', name: 'Siddhesh Shinde', lead: false }];
w.__calls = [];
const bugs: any[] = [];
const isDev = () => DEVS.some(d => d.id === w.__profile?.id);
const isLead = () => DEVS.some(d => d.id === w.__profile?.id && d.lead);
// the rule of 20270122000400: the lead every bug; a developer the unassigned ones and their own
const sees = (b: any) => isLead() || (isDev() && (!b.assigneeId || b.assigneeId === w.__profile?.id));
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const forbidden = () => json({ code: 'FORBIDDEN', message: 'The Bugs section is for the Developers team only.' }, 403);
const row = (b: any) => ({ id: b.id, reference: b.reference, title: b.title, status: b.status, reporterName: b.reporterName, department: b.department, designation: b.designation,
  assigneeId: b.assigneeId, assigneeName: DEVS.find(d => d.id === b.assigneeId)?.name ?? null, attachmentCount: 0, createdAt: b.createdAt, updatedAt: b.createdAt,
  resolvedAt: null, resolutionNote: b.resolutionNote, assignmentStatus: b.assigneeId ? 'ASSIGNED' : 'UNASSIGNED', assignedByName: b.assignedBy ?? null, assignedAt: b.assignedAt ?? null });
const full = (b: any, dev: boolean) => ({ ...row(b), description: b.description, steps: b.steps, reporterId: b.reporterId, attachments: [],
  assignedById: null, assignments: dev ? b.assignments : [], history: b.history.filter((h: any) => dev || !h.internal) });
const counts = () => {
  const v = bugs.filter(sees);
  return { PENDING: v.filter(b => b.status === 'PENDING').length, IN_PROGRESS: v.filter(b => b.status === 'IN_PROGRESS').length,
    RESOLVED: v.filter(b => b.status === 'RESOLVED').length, REJECTED: v.filter(b => b.status === 'REJECTED').length,
    MINE: v.filter(b => b.assigneeId === w.__profile?.id && ['PENDING', 'IN_PROGRESS'].includes(b.status)).length,
    UNASSIGNED: v.filter(b => !b.assigneeId && ['PENDING', 'IN_PROGRESS'].includes(b.status)).length };
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });
  const p = url.pathname.replace('/api/v1', '');
  const me = w.__profile;
  if (p === '/bugs/access') return json({ isDeveloper: isDev(), isLead: isLead(), meId: me.id, developers: isLead() ? DEVS.filter(d => !d.lead).map(({ id, name }) => ({ id, name })) : [] });
  if (p === '/employee/case-details') return json({ name: me.fullName, department: me.department, designation: me.designation, employeeCode: 'EMP-1' });
  if (p === '/bugs' && method === 'POST') {
    const dup = bugs.find(b => b.requestId === body.clientRequestId && b.reporterId === me.id);
    if (dup) return json({ ...full(dup, false), duplicate: true }, 201);
    const b = { id: `b${bugs.length + 1}`, reference: `BUG-2026-${String(bugs.length + 1).padStart(5, '0')}`, title: body.title, description: body.description, steps: body.steps,
      status: 'PENDING', reporterId: me.id, reporterName: me.fullName, department: me.department, designation: me.designation, assigneeId: null, resolutionNote: null,
      createdAt: new Date().toISOString(), requestId: body.clientRequestId, assignments: [], history: [{ id: 1, kind: 'SUBMITTED', internal: false, note: null, data: {}, by: me.fullName, at: new Date().toISOString() }] };
    bugs.unshift(b);
    return json({ ...full(b, false), duplicate: false }, 201);
  }
  if (p === '/bugs/mine') return json(bugs.filter(b => b.reporterId === me.id).map(row));
  const mine = p.match(/^\/bugs\/mine\/(\w+)$/);
  if (mine) { const b = bugs.find(x => x.id === mine[1] && x.reporterId === me.id); return b ? json(full(b, false)) : json({ code: 'NOT_FOUND', message: 'Bug not found.' }, 404); }
  if (p === '/bugs' && method === 'GET') {
    if (!isDev()) return forbidden();
    const st = url.searchParams.get('status'), as = url.searchParams.get('assignee');
    const items = bugs.filter(sees).filter(b => (!st || (st === 'OPEN' ? ['PENDING', 'IN_PROGRESS'].includes(b.status) : b.status === st))
      && (!as || (as === 'ME' ? b.assigneeId === me.id : as === 'UNASSIGNED' ? !b.assigneeId : b.assigneeId === as)));
    return json({ total: items.length, counts: counts(), isLead: isLead(), items: items.map(row),
      byDeveloper: isLead() ? DEVS.filter(d => !d.lead).map(d => ({ id: d.id, name: d.name, open: bugs.filter(b => b.assigneeId === d.id && ['PENDING', 'IN_PROGRESS'].includes(b.status)).length, closed: 0 })) : [] });
  }
  const one = p.match(/^\/bugs\/(\w+)(?:\/(assign|status|comment))?$/);
  if (one) {
    if (!isDev()) return forbidden();
    const b = bugs.find(x => x.id === one[1]);
    if (!b || !sees(b)) return json({ code: 'NOT_FOUND', message: 'Bug not found.' }, 404);
    const ev = (kind: string, internal: boolean, note: string | null, data: any = {}) => b.history.push({ id: b.history.length + 1, kind, internal, note, data, by: me.fullName, at: new Date().toISOString() });
    if (one[2] === 'assign') {
      if (!isLead()) return json({ code: 'FORBIDDEN', message: 'Only the Team Lead of the Developers team assigns bugs.' }, 403);
      b.assigneeId = body.developerId; b.assignedBy = me.fullName; b.assignedAt = new Date().toISOString();
      b.assignments.push({ to: DEVS.find(d => d.id === body.developerId)?.name ?? null, by: me.fullName, at: b.assignedAt });
      ev('ASSIGNED', false, null, { toName: DEVS.find(d => d.id === body.developerId)?.name });
    }
    if (one[2] === 'status') {
      if (!isLead() && b.assigneeId !== me.id) return json({ code: 'FORBIDDEN', message: 'Only the developer the bug is assigned to, or the Team Lead, changes its status.' }, 403);
      if (['RESOLVED', 'REJECTED'].includes(body.status) && (body.note ?? '').length < 5) return json({ code: 'VALIDATION_ERROR', message: 'Write the resolution note.' }, 422);
      b.status = body.status; if (body.note && ['RESOLVED', 'REJECTED'].includes(body.status)) b.resolutionNote = body.note; ev('STATUS', false, body.note, { to: body.status });
    }
    if (one[2] === 'comment') ev('COMMENT', true, body.note);
    return json(full(b, true), one[2] === 'comment' ? 201 : 200);
  }
  if (p === '/employee/issues' || p === '/employee/meetings') return json({ items: [], total: 0 });
  return json([], 200);
};

const Dash: React.FC = () => {
  const [page, setPage] = useState('issues');
  return (
    <DashboardShell title="Amuwa" ariaLabel="Test dashboard" groups={[{ items: [{ id: 'issues', label: 'Raise an Issue', icon: () => null }] }]} active={page} onSelect={setPage}
      user={{ name: w.__profile.fullName, role: 'Employee' }} onSignOut={() => undefined} reminders={false}>
      {page === 'issues' && <RaiseIssuePage />}
    </DashboardShell>
  );
};
w.__devs = DEVS;
w.mount = (who: 'employee' | 'dev' | 'ashish' | 'siddhesh' | 'other') => {
  w.__profile = who === 'dev' ? { id: 'd1', fullName: 'Shreya Mande', department: 'AI Studio', designation: 'Team Lead' }
    : who === 'ashish' ? { id: 'd2', fullName: 'Ashish Sinha', department: 'AI Studio', designation: 'Developer' }
    : who === 'siddhesh' ? { id: 'd3', fullName: 'Siddhesh Shinde', department: 'AI Studio', designation: 'Developer' }
    : who === 'other' ? { id: 'o1', fullName: 'AI Other', department: 'AI Studio', designation: 'Designer' }
    : { id: 'e1', fullName: 'Priya Sales', department: 'Wabastore', designation: 'Team Member' };
  root = createRoot(document.getElementById('root')!);
  root.render(<Dash />);
};
// signing out before the next person signs in: React unmounts everything (drawers included), then the page is empty again
let root: ReturnType<typeof createRoot> | null = null;
w.signOut = () => { root?.unmount(); root = null; document.body.innerHTML = '<div id="root"></div>'; w.__calls = []; };

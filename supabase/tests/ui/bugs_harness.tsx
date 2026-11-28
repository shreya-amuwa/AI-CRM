import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardShell } from '../../../src/components/layout/shell';
import RaiseIssuePage from '../../../src/components/issues/RaiseIssuePage';
import { HrRaiseIssuePage } from '../../../src/components/hr/HrRaiseIssuePage';
import './withAppFeedback';

/**
 * The real dashboard shell (its menu adds Attendance, Meetings and, for developers only, Bugs) with the real Raise an Issue page, and the
 * CRM API answered in the page like the database (20270122000300): who is a developer, bugs, the reporter's list, assign / status /
 * comments, internal comments hidden from the reporter, and FORBIDDEN for anyone else. Every request is recorded in window.__calls.
 * Issue routing (20270128000200): category / priority / affected department and employee, the conversation (a developer replies or asks for
 * information, the reporter follows up), and HR's Raise an Issue page with an employee issue HR escalates (once) to the Developer Team.
 */
const w = window as any;
const DEVS = [{ id: 'd1', name: 'Shreya Mande', lead: true }, { id: 'd2', name: 'Ashish Sinha', lead: false }, { id: 'd3', name: 'Siddhesh Shinde', lead: false }];
w.__calls = [];
const bugs: any[] = [];
const isDev = () => DEVS.some(d => d.id === w.__profile?.id);
const isLead = () => DEVS.some(d => d.id === w.__profile?.id && d.lead);
// the rule of 20270312000100: every developer sees every bug (the optional primary contact hides nothing)
const sees = (_b: any) => isDev();
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const forbidden = () => json({ code: 'FORBIDDEN', message: 'The Bugs section is for the Developers team only.' }, 403);
const OPEN = ['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO'];
// the team members who worked on a bug, from its history (20270312000100)
const contributors = (b: any) => { const m = new Map<string, { id: string; name: string; updates: number; lastAt: string }>();
  for (const h of b.history) if (h.by && (h.kind === 'PROGRESS' || h.kind === 'COMMENT' || (h.kind === 'STATUS' && !h.data.byReporter) || (h.kind === 'MESSAGE' && h.data.from === 'DEVELOPER'))) {
    const c = m.get(h.by) ?? { id: h.by, name: h.by, updates: 0, lastAt: h.at }; c.updates++; c.lastAt = h.at; m.set(h.by, c); }
  return [...m.values()]; };
const lastMessage = (b: any) => { const m = [...b.history].reverse().find((h: any) => h.kind === 'MESSAGE'); return m ? { from: m.data.from, note: m.note, by: m.by, at: m.at } : null; };
const row = (b: any) => ({ id: b.id, reference: b.reference, title: b.title, status: b.status, reporterName: b.reporterName, department: b.department, designation: b.designation,
  category: b.category, priority: b.priority, source: b.source, sourceIssueReference: b.sourceIssueReference ?? null, affectedDepartment: b.affectedDepartment ?? null,
  affectedEmployee: b.affectedEmployee ?? null, lastMessage: lastMessage(b),
  assigneeId: b.assigneeId, assigneeName: DEVS.find(d => d.id === b.assigneeId)?.name ?? null, attachmentCount: 0, createdAt: b.createdAt, updatedAt: b.createdAt,
  progress: b.progress ?? 0, contributors: contributors(b).map(c => c.name), lastUpdateAt: b.lastUpdateAt ?? null, lastUpdateBy: b.lastUpdateBy ?? null,
  resolvedAt: null, resolutionNote: b.resolutionNote, assignmentStatus: b.assigneeId ? 'ASSIGNED' : 'UNASSIGNED', assignedByName: b.assignedBy ?? null, assignedAt: b.assignedAt ?? null });
const latest = (b: any) => { const h = [...b.history].reverse().find((x: any) => x.kind === 'PROGRESS'); return h ? { by: h.by, at: h.at, work: h.note, statusTo: h.data.statusTo, progressTo: h.data.progressTo } : null; };
const full = (b: any, dev: boolean) => ({ ...row(b), description: b.description, steps: b.steps, reporterId: b.reporterId, attachments: [],
  progress: b.progress ?? 0, version: b.version ?? 1, contributors: dev ? contributors(b) : [], latestUpdate: dev ? latest(b) : null,
  assignedById: null, assignments: dev ? b.assignments : [], history: b.history.filter((h: any) => dev || !h.internal) });
const counts = () => {
  const v = bugs.filter(sees);
  return { PENDING: v.filter(b => b.status === 'PENDING').length, IN_PROGRESS: v.filter(b => b.status === 'IN_PROGRESS').length,
    RESOLVED: v.filter(b => b.status === 'RESOLVED').length, REJECTED: v.filter(b => b.status === 'REJECTED').length,
    MINE: v.filter(b => b.assigneeId === w.__profile?.id && OPEN.includes(b.status)).length,
    UNASSIGNED: v.filter(b => !b.assigneeId && OPEN.includes(b.status)).length, OPEN: v.filter(b => OPEN.includes(b.status)).length,
    UNDER_REVIEW: v.filter(b => b.status === 'UNDER_REVIEW').length, TESTING: v.filter(b => b.status === 'TESTING').length, NEEDS_INFO: v.filter(b => b.status === 'NEEDS_INFO').length, CLOSED: v.filter(b => b.status === 'CLOSED').length };
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
  if (p === '/bugs/access') return json({ isDeveloper: isDev(), isLead: isLead(), meId: me.id, developers: isLead() ? DEVS.filter(d => !d.lead).map(({ id, name }) => ({ id, name })) : [],
    team: isDev() ? DEVS.map(({ id, name, lead }) => ({ id, name, isLead: lead })) : [] });
  if (p === '/employee/case-details') return json({ name: me.fullName, department: me.department, designation: me.designation, employeeCode: 'EMP-1' });
  if (p === '/bugs' && method === 'POST') {
    const dup = bugs.find(b => b.requestId === body.clientRequestId && b.reporterId === me.id);
    if (dup) return json({ ...full(dup, false), duplicate: true }, 201);
    const b = { id: `b${bugs.length + 1}`, reference: `BUG-2026-${String(bugs.length + 1).padStart(5, '0')}`, title: body.title, description: body.description, steps: body.steps,
      status: 'PENDING', reporterId: me.id, reporterName: me.fullName, department: me.department, designation: me.designation, assigneeId: null, resolutionNote: null, progress: 0, version: 1,
      createdAt: new Date().toISOString(), requestId: body.clientRequestId, assignments: [], history: [{ id: 1, kind: 'SUBMITTED', internal: false, note: null, data: {}, by: me.fullName, at: new Date().toISOString() }],
      category: body.category ?? 'BUG', priority: body.priority ?? 'MEDIUM', source: me.hr ? 'HR_REPORT' : 'EMPLOYEE',
      affectedDepartment: DEPTS.find(d => d.id === body.affectedDepartmentId)?.name ?? null, affectedEmployee: PEOPLE.find(x => x.id === body.affectedEmployeeId)?.name ?? null };
    bugs.unshift(b);
    return json({ ...full(b, false), duplicate: false }, 201);
  }
  if (p === '/bugs/mine') {
    const st = url.searchParams.get('status'), term = (url.searchParams.get('search') ?? '').toLowerCase();
    return json(bugs.filter(b => b.reporterId === me.id && (!st || (st === 'OPEN' ? OPEN.includes(b.status) : st === 'DONE' ? !OPEN.includes(b.status) : b.status === st))
      && (!term || b.title.toLowerCase().includes(term))).map(row));
  }
  const mine = p.match(/^\/bugs\/mine\/(\w+)(\/follow-up)?$/);
  if (mine) {
    const b = bugs.find(x => x.id === mine[1] && x.reporterId === me.id);
    if (!b) return json({ code: 'NOT_FOUND', message: 'Bug not found.' }, 404);
    if (mine[2]) {
      // like bug_my_follow_up: the information asked for goes back to the team
      if (b.status === 'CLOSED') return json({ code: 'CONFLICT', message: 'This issue is closed.' }, 409);
      b.history.push({ id: b.history.length + 1, kind: 'MESSAGE', internal: false, note: body.message, data: { from: 'REPORTER' }, by: me.fullName, at: new Date().toISOString() });
      if (['NEEDS_INFO', 'RESOLVED'].includes(b.status)) b.status = b.assigneeId ? 'IN_PROGRESS' : 'PENDING';
      return json(full(b, false), 201);
    }
    return json(full(b, false));
  }
  if (p === '/bugs' && method === 'GET') {
    if (!isDev()) return forbidden();
    const st = url.searchParams.get('status'), as = url.searchParams.get('assignee');
    const items = bugs.filter(sees).filter(b => (!st || (st === 'OPEN' ? OPEN.includes(b.status) : st === 'DONE' ? !OPEN.includes(b.status) : b.status === st))
      && (!as || (as === 'ME' ? b.assigneeId === me.id : as === 'UNASSIGNED' ? !b.assigneeId : as === 'CONTRIBUTED' ? contributors(b).some(c => c.name === me.fullName) : b.assigneeId === as)));
    return json({ total: items.length, counts: counts(), isLead: isLead(), items: items.map(row),
      byDeveloper: DEVS.map(d => ({ id: d.id, name: d.name, open: bugs.filter(b => b.assigneeId === d.id && OPEN.includes(b.status)).length, closed: 0,
        updates: bugs.reduce((n, b) => n + b.history.filter((h: any) => h.kind === 'PROGRESS' && h.by === d.name).length, 0) })) });
  }
  const one = p.match(/^\/bugs\/(\w+)(?:\/(assign|status|comment|reply|updates))?$/);
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
      if (['RESOLVED', 'REJECTED'].includes(body.status) && (body.note ?? '').length < 5) return json({ code: 'VALIDATION_ERROR', message: 'Write the resolution note.' }, 422);
      b.status = body.status; if (body.note && ['RESOLVED', 'REJECTED'].includes(body.status)) b.resolutionNote = body.note; b.version++; ev('STATUS', false, body.note, { to: body.status });
    }
    // "Add Progress Update" (20270312000100): any developer; appended to the history with the person; refused when the screen is out of date
    if (one[2] === 'updates') {
      w.__updateCalls = (w.__updateCalls ?? 0) + 1;
      if (body.clientRequestId && b.history.some((h: any) => h.kind === 'PROGRESS' && h.data.clientRequestId === body.clientRequestId && h.by === me.fullName)) return json({ ...full(b, true), duplicate: true }, 201);
      if (!body.work || body.work.trim().length < 3) return json({ code: 'VALIDATION_ERROR', message: 'Write what you worked on (at least 3 characters).' }, 422);
      const to = body.status ?? b.status, prog = body.progress ?? (['RESOLVED', 'CLOSED'].includes(to) ? 100 : b.progress);
      if (to === 'RESOLVED' && prog !== 100) return json({ code: 'VALIDATION_ERROR', message: 'A resolved bug is 100% done.' }, 422);
      if ((to !== b.status || prog !== b.progress) && body.expectedVersion && body.expectedVersion !== b.version)
        return json({ code: 'CONFLICT', message: 'Another developer updated this bug while you were writing. Reload to read their update, then save yours again.' }, 409);
      const was = b.status, pwas = b.progress;
      if (['RESOLVED', 'REJECTED'].includes(to) && to !== was) { if ((body.notes ?? body.work).length < 5) return json({ code: 'VALIDATION_ERROR', message: 'Write the resolution note.' }, 422); b.resolutionNote = body.notes ?? body.work; }
      b.status = to; b.progress = prog; b.version++; b.lastUpdateAt = new Date().toISOString(); b.lastUpdateBy = me.fullName;
      ev('PROGRESS', true, body.work, { notes: body.notes ?? null, statusFrom: was, statusTo: to, progressFrom: pwas, progressTo: prog, clientRequestId: body.clientRequestId });
      if (to !== was) ev('STATUS', false, null, { from: was, to });
      return json({ ...full(b, true), duplicate: false }, 201);
    }
    if (one[2] === 'comment') ev('COMMENT', true, body.note);
    if (one[2] === 'reply') {
      ev('MESSAGE', false, body.message, { from: 'DEVELOPER', requestInfo: !!body.requestInfo });
      if (body.requestInfo) b.status = 'NEEDS_INFO';
    }
    return json(full(b, true), one[2] === 'comment' || one[2] === 'reply' ? 201 : 200);
  }
  // ---- issues to HR (the employee's own list, with one HR escalated) and HR's Employee Issues
  if (p === '/employee/issues') return json({ items: issues.filter(i => i.employee.id === me.id).map(i => ({ ...i, description: null })), total: issues.filter(i => i.employee.id === me.id).length, limit: 10, offset: 0 });
  if (p === '/employee/meetings') return json({ items: [], total: 0 });
  if (p === '/departments') return json(DEPTS);
  if (p === '/meetings/directory') return json(PEOPLE);
  if (p === '/hr/case-assignees') return json([{ id: 'h1', name: 'Hema HR', designation: 'Department Head' }]);
  if (p === '/hr/case-departments') return json([{ id: '00000000-0000-4000-8000-00000000dea1', name: 'Wabastore' }]);
  if (p === '/hr/issues/overview') return json({ total: issues.length, new: issues.filter(i => i.status === 'NEW').length, inProgress: 0, awaiting: 0, resolved: 0, closed: 0, urgent: 0, escalated: issues.filter(i => i.escalation).length });
  if (p === '/hr/issues') return json({ items: issues, total: issues.length, limit: 20, offset: 0 });
  const hrIssue = p.match(/^\/hr\/issues\/(\w+)(\/escalate)?$/);
  if (hrIssue) {
    const i = issues.find(x => x.id === hrIssue[1]);
    if (!i) return json({ code: 'NOT_FOUND', message: 'Issue not found.' }, 404);
    let duplicate = false;
    if (hrIssue[2]) {
      // like issue_hr_escalate: once; a second call returns the same Developer Team issue
      if (i.escalation) duplicate = true;
      else {
        const b = { id: `b${bugs.length + 1}`, reference: `BUG-2026-${String(bugs.length + 1).padStart(5, '0')}`, title: i.title, description: `${i.description}\n\nNote from HR: ${body.note ?? ''}`, steps: null,
          status: 'PENDING', reporterId: me.id, reporterName: me.fullName, department: 'HR', designation: 'HR', assigneeId: null, resolutionNote: null, createdAt: new Date().toISOString(),
          requestId: `esc-${i.id}`, assignments: [], history: [{ id: 1, kind: 'SUBMITTED', internal: false, note: `Escalated by HR from ${i.reference}.`, data: {}, by: me.fullName, at: new Date().toISOString() }],
          category: body.category ?? 'BUG', priority: i.priority, source: 'HR_ESCALATION', sourceIssueReference: i.reference, affectedEmployee: i.employee.name };
        bugs.unshift(b);
        i.escalation = { bugId: b.id, reference: b.reference, status: 'PENDING', assigneeName: null, resolutionNote: null, updatedAt: b.createdAt, escalatedAt: b.createdAt, escalatedBy: me.fullName };
        i.routing = 'ESCALATED_TO_DEVELOPERS';
        if (i.status === 'NEW') i.status = 'IN_PROGRESS';
        i.events.push({ id: i.events.length + 1, kind: 'ESCALATED', visibility: 'EMPLOYEE', side: 'HR', actorName: me.fullName, body: `HR escalated this issue to the Developer Team (${b.reference}).`, fromStatus: 'NEW', toStatus: i.status, createdAt: b.createdAt });
      }
      w.__escalations = (w.__escalations ?? 0) + (duplicate ? 0 : 1);
    }
    const b = i.escalation ? bugs.find(x => x.id === i.escalation.bugId) : null;
    return json({ issue: i, events: i.events, attachments: [], escalationHistory: b ? full(b, false).history : [], ...(hrIssue[2] ? { duplicate } : {}) });
  }
  return json([], 200);
};

// an employee issue to HR, about the CRM (for HR to escalate), and one HR already escalated (the employee sees where it went)
const DEPTS = [{ id: '00000000-0000-4000-8000-00000000dea1', name: 'Wabastore', slug: 'wabastore' }, { id: '00000000-0000-4000-8000-00000000dea2', name: 'Accounts', slug: 'accounts' }];
const PEOPLE = [{ id: 'e1', name: 'Priya Sales', email: 'p@x.example', role: 'TEAM_MEMBER', department: 'Wabastore' }, { id: '00000000-0000-4000-8000-0000000000e2', name: 'Ravi Accounts', email: 'r@x.example', role: 'TEAM_MEMBER', department: 'Accounts' }];
const emp = { id: 'e1', name: 'Priya Sales', employeeCode: 'EMP-1', departmentId: '00000000-0000-4000-8000-00000000dea1', department: 'Wabastore', designation: 'Team Member' };
const issue = (id: string, ref: string, title: string, extra: any = {}) => ({ id, reference: ref, title, category: 'TECHNICAL_SYSTEM', priority: 'HIGH', status: 'NEW', description: `${title}: it happens every day.`,
  preferredResolution: null, hrResponse: null, hrResponseAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null, closedAt: null,
  assignedHr: null, employee: emp, recipient: 'HR', routing: 'WITH_HR', escalation: null, events: [{ id: 1, kind: 'SUBMITTED', visibility: 'EMPLOYEE', side: 'EMPLOYEE', actorName: 'Priya Sales', body: null, fromStatus: null, toStatus: 'NEW', createdAt: new Date().toISOString() }], ...extra });
const issues: any[] = [
  issue('i1', 'ISS-2026-00001', 'The CRM logs me out'),
  issue('i2', 'ISS-2026-00002', 'Leave balance looks wrong', { category: 'ATTENDANCE_LEAVE', priority: 'MEDIUM', status: 'IN_PROGRESS', routing: 'ESCALATED_TO_DEVELOPERS',
    escalation: { bugId: 'old', reference: 'BUG-2026-00900', status: 'IN_PROGRESS', assigneeName: 'Ashish Sinha', resolutionNote: null, updatedAt: new Date().toISOString(), escalatedAt: new Date().toISOString(), escalatedBy: 'Hema HR' } })
];
w.__issues = issues;

const Dash: React.FC = () => {
  const [page, setPage] = useState('issues');
  if (w.__profile.hr) return <HrRaiseIssuePage canReport />;
  return (
    <DashboardShell title="Amuwa" ariaLabel="Test dashboard" groups={[{ items: [{ id: 'issues', label: 'Raise an Issue', icon: () => null }] }]} active={page} onSelect={setPage}
      user={{ name: w.__profile.fullName, role: 'Employee' }} onSignOut={() => undefined} reminders={false}>
      {page === 'issues' && <RaiseIssuePage />}
    </DashboardShell>
  );
};
w.__devs = DEVS;
w.mount = (who: 'employee' | 'dev' | 'ashish' | 'siddhesh' | 'other' | 'hr') => {
  w.__profile = who === 'hr' ? { id: 'h1', fullName: 'Hema HR', department: 'HR', designation: 'Department Head', hr: true }
    : who === 'dev' ? { id: 'd1', fullName: 'Shreya Mande', department: 'AI Studio', designation: 'Team Lead' }
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

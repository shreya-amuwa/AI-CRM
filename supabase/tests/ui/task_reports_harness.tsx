import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskReports } from '../../../src/components/reports/TaskReports';
import { PerformanceApprovals } from '../../../src/components/performance/PerformanceApprovals';

/**
 * The real task daily report screens and the real performance approval page, for each role. The CRM API is a small stateful fake in the page that
 * applies the same rules as the database functions (one report per task and day, a return needs a reason, only the lead decides ...), so the test
 * follows the workflow on screen. Every request is recorded in window.__calls.
 */
const w = window as any;
w.__calls = [];
const TODAY = new Date().toISOString().slice(0, 10);
const tasks = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Update the account list', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: '2099-01-01', progress: 10, description: null, assignedAt: TODAY, lastReportDate: null, reportedToday: false },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Overdue paperwork', status: 'ASSIGNED', priority: 'MEDIUM', dueDate: '2020-01-01', progress: 0, description: null, assignedAt: '2019-12-01', lastReportDate: null, reportedToday: false }
];
let reports: any[] = [];
const history: Record<string, any[]> = {};
let role: 'MEMBER' | 'TEAM_HEAD' | 'DEPARTMENT_HEAD' = 'MEMBER';
const rec = (status: string, extra: any = {}) => ({ id: 'rec1', status, version: 1, score: 61.5, generatedAt: TODAY, refreshedAt: TODAY, reviewedBy: null, reviewedAt: null, reviewRemarks: null, canDecide: false, canResubmit: false, ...extra });
const parts = (a: number | null) => [
  { key: 'completion', label: 'Task completion', weight: 35, value: a }, { key: 'progress', label: 'Progress (approved reports)', weight: 15, value: 40 },
  { key: 'onTime', label: 'On-time completion', weight: 20, value: null }, { key: 'reportApproval', label: 'Reports approved', weight: 15, value: 100 }, { key: 'consistency', label: 'Reporting consistency', weight: 15, value: 50 }];
const memberMetrics = (score: number | null) => ({ tasks: { total: 4, completed: 1, pending: 2, overdue: 1, onTime: 0, late: 0 }, completionPct: 25, onTimePct: null, progressPct: 40,
  reports: { submitted: 3, approved: 2, returned: 1, pending: 0, approvalPct: 66.7, expectedDays: 5, approvedDays: 2, consistencyPct: 40 }, parts: parts(25), score });
const leadMetrics = { own: { total: 2, completed: 1, overdue: 0, completionPct: 50 },
  team: { members: 2, total: 4, completed: 1, pending: 2, overdue: 1, onTime: 0, late: 0, completionPct: 25, onTimePct: null, progressPct: 40 },
  reports: { submitted: 3, approved: 2, returned: 1, pending: 0, waitingOverOneDay: 0, reviewedPct: 100, avgReviewHours: 3.5 },
  management: { tasksAssignedToTeam: 4, tasksReceived: 2, handedDown: 1, handledOrDelegated: 2, delegationPct: 100 }, parts: [{ key: 'ownCompletion', label: 'Own task completion', weight: 20, value: 50 }], score: 58 };
// International / Reseller (20270210000100): the Team Lead rates and approves a member (never returns them), not while a report waits; the head rates the lead
let strict = false;
let waiting = 0;
const strictFlags = (r: any, subject: 'member' | 'lead') => (strict ? { ...r, ratingRequired: true, waitingReports: subject === 'member' ? waiting : 0, canReturn: subject === 'member' ? false : r.canDecide && r.status === 'PENDING' } : r);
let memberRec = rec('PENDING', { canDecide: true });
let leadRec = rec('PENDING', { id: 'rec2' });
const person = (id: string, name: string, role2: 'TEAM_MEMBER' | 'TEAM_HEAD', metrics: any, record: any) => ({ id, name, designation: null, role: role2, teamId: 'tm', team: 'Team', metrics, liveScore: metrics.score, record });
const overview = () => {
  const base = { periodStart: TODAY, periodEnd: TODAY, today: TODAY };
  if (role === 'MEMBER') return { role: 'TEAM_MEMBER', ...base, me: person('m1', 'Mohan Member', 'TEAM_MEMBER', memberMetrics(61.5), { ...memberRec, canDecide: false, canResubmit: memberRec.status === 'RETURNED' }) };
  if (role === 'TEAM_HEAD') return { role, ...base, me: person('l1', 'Leena Lead', 'TEAM_HEAD', leadMetrics, { ...leadRec, canDecide: false, canResubmit: leadRec.status === 'RETURNED' }),
    members: [person('m1', 'Mohan Member', 'TEAM_MEMBER', memberMetrics(61.5), strictFlags(memberRec, 'member'))], pendingReports: 1, pendingRecords: 1, ...(strict ? { leadDecidesMembers: true } : {}) };
  return { role, ...base, department: { id: 'd1', name: 'International' }, tasks: { total: 9, completed: 4, pending: 3, overdue: 2, completionPct: 44.4 },
    reports: { submitted: 7, approved: 4, returned: 1, pending: 2, approvedPct: 57.1 },
    leads: [{ ...person('l1', 'Leena Lead', 'TEAM_HEAD', leadMetrics, strictFlags({ ...leadRec, canDecide: leadRec.status === 'PENDING' }, 'lead')), members: [person('m1', 'Mohan Member', 'TEAM_MEMBER', memberMetrics(61.5), strictFlags({ ...memberRec, canDecide: false }, 'member'))] }],
    unassignedMembers: [], pendingRecords: 1, ...(strict ? { leadDecidesMembers: true } : {}) };
};
const asReport = (r: any) => ({ ...r, canReview: role === 'TEAM_HEAD' && r.status === 'PENDING', canEdit: role === 'MEMBER' && r.status === 'RETURNED' });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const p = url.pathname.replace('/api/v1', '');
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  w.__calls.push({ method, path: p, query: Object.fromEntries(url.searchParams), body });
  const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ success: false, error: { code, message } }), { status, headers: { 'Content-Type': 'application/json' } });
  if (p === '/task-reports/my-tasks') return ok(tasks);
  if (p === '/task-reports' && method === 'POST') {
    const t = tasks.find(x => x.id === body.taskId)!;
    const date = body.reportDate || TODAY;
    const old = reports.find(r => r.taskId === body.taskId && r.reportDate === date);
    if (old && old.status !== 'RETURNED') return fail(409, 'CONFLICT', old.status === 'APPROVED' ? 'The report for this task and date was already approved.' : 'A report for this task and date is already waiting for approval.');
    if (old) { Object.assign(old, { workCompleted: body.workCompleted, progress: body.progress, pendingWork: body.pendingWork ?? null, delayReason: body.delayReason ?? null, remarks: body.remarks ?? null, status: 'PENDING', revision: old.revision + 1, reviewedAt: null, reviewRemarks: null });
      history[old.id].push({ action: 'RESUBMITTED', by: 'Mohan Member', at: new Date().toISOString(), from: 'RETURNED', to: 'PENDING', remarks: null, revision: old.revision }); return ok(asReport(old)); }
    const r = { id: `r${reports.length + 1}`, taskId: t.id, taskTitle: t.title, taskStatus: t.status, taskPriority: t.priority, taskDueDate: t.dueDate, authorId: 'm1', author: 'Mohan Member', designation: null, departmentId: 'd1', teamId: 'tm',
      reviewerId: 'l1', reportDate: date, workCompleted: body.workCompleted, progress: body.progress, pendingWork: body.pendingWork ?? null, delayReason: body.delayReason ?? null, remarks: body.remarks ?? null,
      status: 'PENDING', revision: 1, submittedAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, reviewRemarks: null };
    reports.push(r); history[r.id] = [{ action: 'SUBMITTED', by: 'Mohan Member', at: r.submittedAt, from: null, to: 'PENDING', remarks: null, revision: 1 }];
    return ok(asReport(r));
  }
  if (p === '/task-reports' && method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const scoped = reports;
    const items = scoped.filter(r => !q.status || r.status === q.status).map(asReport);
    return ok({ counts: { pending: scoped.filter(r => r.status === 'PENDING').length, approved: scoped.filter(r => r.status === 'APPROVED').length, returned: scoped.filter(r => r.status === 'RETURNED').length, total: scoped.length }, total: items.length, items });
  }
  let m = p.match(/^\/task-reports\/([^/]+)\/review$/);
  if (m) {
    const r = reports.find(x => x.id === m![1])!;
    if (role !== 'TEAM_HEAD') return fail(403, 'FORBIDDEN', 'Only the Team Lead of this team member can decide on this report.');
    if (body.decision === 'RETURN' && (body.remarks || '').length < 5) return fail(400, 'VALIDATION_ERROR', 'Say what must be corrected (at least 5 characters).');
    r.status = body.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED'; r.reviewedBy = 'Leena Lead'; r.reviewedAt = new Date().toISOString(); r.reviewRemarks = body.remarks ?? null;
    history[r.id].push({ action: r.status, by: 'Leena Lead', at: r.reviewedAt, from: 'PENDING', to: r.status, remarks: r.reviewRemarks, revision: r.revision });
    return ok(asReport(r));
  }
  m = p.match(/^\/task-reports\/([^/]+)$/);
  if (m) return ok({ ...asReport(reports.find(x => x.id === m![1])!), history: history[m[1]] });
  if (p === '/performance-approval/overview') return ok(overview());
  m = p.match(/^\/performance-approval\/records\/([^/]+)\/review$/);
  if (m) {
    const target = m[1] === 'rec1' ? 'member' : 'lead';
    if (strict && target === 'member' && body.decision === 'RETURN') return fail(400, 'VALIDATION_ERROR', 'A team member\'s performance is not returned to them. Return their daily reports for correction, then approve the performance.');
    if (body.decision === 'RETURN' && (body.remarks || '').length < 5) return fail(400, 'VALIDATION_ERROR', 'Say what must be corrected (at least 5 characters).');
    if (strict && body.decision === 'APPROVE' && !body.rating) return fail(400, 'VALIDATION_ERROR', 'Give a rating from 1 to 5 before approving.');
    if (strict && target === 'member' && body.decision === 'APPROVE' && waiting > 0) return fail(409, 'CONFLICT', '1 daily report of this team member is still waiting for your review in this period. Approve or return it first.');
    const next = rec(body.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED', { id: m[1], reviewedBy: role === 'DEPARTMENT_HEAD' ? 'Ira Head' : 'Leena Lead', reviewedAt: new Date().toISOString(), reviewRemarks: body.remarks ?? null,
      rating: body.decision === 'APPROVE' ? body.rating ?? null : null });
    if (target === 'member') memberRec = next; else leadRec = next;
    return ok(next);
  }
  m = p.match(/^\/performance-approval\/records\/([^/]+)\/resubmit$/);
  if (m) { if (m[1] === 'rec1') memberRec = rec('PENDING', { id: 'rec1', version: 2 }); else leadRec = rec('PENDING', { id: 'rec2', version: 2 }); return ok(rec('PENDING')); }
  m = p.match(/^\/performance-approval\/people\/([^/]+)\/history$/);
  if (m) return ok({ id: m[1], name: m[1] === 'm1' ? 'Mohan Member' : 'Leena Lead', role: m[1] === 'm1' ? 'TEAM_MEMBER' : 'TEAM_HEAD', records: [
    { id: 'old1', periodStart: '2027-01-01', periodEnd: '2027-01-31', status: 'APPROVED', score: 72, rating: 4, reviewedBy: 'Leena Lead', reviewedAt: '2027-02-02T10:00:00Z', reviewRemarks: 'Steady month' }] });
  m = p.match(/^\/performance-approval\/records\/([^/]+)\/history$/);
  if (m) return ok([{ action: 'GENERATED', by: 'Mohan Member', at: new Date().toISOString(), from: null, to: 'PENDING', score: 61.5, remarks: null }, ...(memberRec.status === 'APPROVED' ? [{ action: 'APPROVED', by: 'Leena Lead', at: new Date().toISOString(), from: 'PENDING', to: 'APPROVED', score: 61.5, remarks: memberRec.reviewRemarks }] : [])]);
  return ok([]);
};

let root: ReturnType<typeof createRoot> | null = null;
w.mount = (what: 'reports-member' | 'reports-lead' | 'reports-head' | 'perf-member' | 'perf-lead' | 'perf-head') => {
  role = what.endsWith('member') ? 'MEMBER' : what.endsWith('lead') ? 'TEAM_HEAD' : 'DEPARTMENT_HEAD';
  root?.unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  root.render(what.startsWith('reports')
    ? <TaskReports level={role === 'MEMBER' ? 'MEMBER' : role === 'TEAM_HEAD' ? 'TEAM_LEAD' : 'DEPARTMENT_HEAD'} />
    : <PerformanceApprovals title={role === 'MEMBER' ? 'My Performance' : 'Performance Management'} />);
};
w.reset = () => { reports = []; memberRec = rec('PENDING', { canDecide: true }); leadRec = rec('PENDING', { id: 'rec2' }); w.__calls = []; strict = false; waiting = 0; };
/** International / Reseller rules on (and how many of the member's reports are still waiting). */
w.setStrict = (on: boolean, waitingReports = 0) => { strict = on; waiting = waitingReports; };

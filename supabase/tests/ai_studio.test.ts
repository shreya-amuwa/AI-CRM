// AI Studio without a database: which dashboard each person opens, the route guard, the shared forms' rules (the same schemas the server uses) and the
// notification deep links. Every other department's routing is unchanged.
import { AI_STUDIO_REPORT_STATUSES, AI_STUDIO_REPORT_STATUS_LABELS } from '../../shared/contracts.js';
import {
  aiStudioAssignLeadSchema, aiStudioProjectSchema, aiStudioReportReviewSchema, aiStudioReportSchema, aiStudioTaskCreateSchema, aiStudioTaskUpdateSchema, userCreateSchema
} from '../../shared/validation.js';
import { defaultDashboardLabel, toAuthUser } from '../../src/lib/auth/roleMapping.js';
import { getRedirectForRole, parseCurrentRoute, validateRouteAccess, type ParsedRoute } from '../../src/utils/router.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const ai = { id: 'd1', name: 'AI Studio', slug: 'ai-studio' };
const profile = (over: Record<string, unknown>) => ({
  id: 'u1', fullName: 'Test User', email: 'u@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE', salesSubRole: null, department: ai, team: { id: 't1', name: 'AI Studio Team', division: 'GENERAL' }, ...over
}) as any;
const route = (type: ParsedRoute['type'], paramId?: string): ParsedRoute => ({ path: '/x', type, paramId });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---- routing
for (const [role, label] of [['TEAM_MEMBER', 'Team Member'], ['TEAM_HEAD', 'Team Lead'], ['DEPARTMENT_HEAD', 'Department Head']] as const) {
  const u = toAuthUser(profile({ role, team: role === 'DEPARTMENT_HEAD' ? null : undefined }));
  check(u.role === 'ai-studio', `an AI Studio ${label} opens the AI Studio dashboard`);
  check(getRedirectForRole(u) === '/ai-studio/dashboard/u1', `${label} signs in at their own AI Studio address`);
  check(validateRouteAccess(u, route('ai-studio', 'u1')).allowed === true, `${label}: their own dashboard opens`);
  check(validateRouteAccess(u, route('ai-studio', 'other')).redirectTo === '/ai-studio/dashboard/u1', `${label}: another person's address does not`);
  check(validateRouteAccess(u, route('team-member', 'u1')).allowed === false && validateRouteAccess(u, route('sales-head', 'u1')).allowed === false && validateRouteAccess(u, route('admin', 'wabastore')).allowed === false, `${label}: no other dashboard opens`);
  check(defaultDashboardLabel(role, 'GENERAL', 'AI Studio', false, 'ai-studio').startsWith(`AI Studio ${label}`), `${label}: the Add Team Member form names the dashboard`);
}
check(toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null })).role === 'superadmin', 'the Super Admin is not an AI Studio employee');
const parsed = (path: string) => { (globalThis as any).window = { location: { pathname: path } }; return parseCurrentRoute(); };
check(parsed('/ai-studio/dashboard/u1').type === 'ai-studio' && parsed('/ai-studio/dashboard/u1/daily-report').paramId === 'u1', 'the AI Studio addresses are recognised, with their pages');
check(parsed('/ai-studio/dashboard/u1/a/b').type === 'unknown', 'a longer address is not');

// ... other departments keep theirs
const sales = toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' } }));
check(sales.role === 'business-associate' && validateRouteAccess(sales, route('ai-studio', 'u1')).allowed === false, 'a Sales member keeps their dashboard and cannot open AI Studio');
check(toAuthUser(profile({ role: 'DEPARTMENT_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: null })).role === 'admin', 'another Department Head keeps the Department Head dashboard');
check(validateRouteAccess(toAuthUser(profile({ role: 'DEPARTMENT_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: null })), route('ai-studio', 'u1')).allowed === false, 'and cannot open AI Studio');
check(toAuthUser(profile({ department: { id: 'h', name: 'HR', slug: 'hr' }, team: null })).role === 'hr', 'HR keeps theirs');

// ---- the dashboard follows the DEPARTMENT (never the role name alone)
const salesTl = toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' }, defaultDashboard: 'sales-lead' }));
const supportTl = toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't2', name: 'Support', division: 'SUPPORT' }, defaultDashboard: 'support-lead' }));
const aiTl = toAuthUser(profile({ role: 'TEAM_HEAD', defaultDashboard: 'ai-studio-lead' }));
check(salesTl.role === 'team-lead' && supportTl.role === 'support-lead' && aiTl.role === 'ai-studio', 'Sales, Support and AI Studio Team Leads (all "Team Lead") open three different dashboards');
check(toAuthUser(profile({ role: 'TEAM_HEAD', team: { id: 't3', name: 'Pod', division: 'SALES' } })).role === 'ai-studio', 'an AI Studio Team Lead is not a Sales Team Lead even when their team\'s division is Sales');
check(toAuthUser(profile({ role: 'TEAM_HEAD', team: { id: 't3', name: 'Pod', division: 'SUPPORT' } })).role === 'ai-studio', 'nor a Support Team Lead when it is Support');
check(toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'd1', name: 'AI Studio', slug: 'made-by-hand' } })).role === 'ai-studio', 'a department made by hand under the name AI Studio is AI Studio');
check(toAuthUser(profile({ role: 'TEAM_HEAD', department: null, defaultDashboard: 'ai-studio-lead' })).role === 'ai-studio', 'a profile that arrives without its department still follows the dashboard the database computed from it');
check(toAuthUser(profile({ role: 'TEAM_MEMBER', department: null, defaultDashboard: 'ai-studio-member' })).role === 'ai-studio', 'the same for a Team Member');
check(toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' }, defaultDashboard: 'ai-studio-lead' })).role === 'team-lead', 'a stale AI Studio dashboard value never overrides the department the person really is in');
check(toAuthUser(profile({ role: 'TEAM_HEAD', department: null, team: null, defaultDashboard: 'sales-lead' })).role === 'team-lead', 'and a person with no department and no AI Studio value keeps the old routing');
check(validateRouteAccess(aiTl, route('team-lead', 'u1')).redirectTo === '/ai-studio/dashboard/u1' && validateRouteAccess(aiTl, route('support-lead', 'u1')).allowed === false, 'an AI Studio Team Lead who opens a Sales or Support address is sent back to AI Studio');
check(validateRouteAccess(salesTl, route('ai-studio', 'u1')).allowed === false && validateRouteAccess(supportTl, route('ai-studio', 'u1')).allowed === false, 'and a Sales or Support Team Lead cannot open the AI Studio address');
check(getRedirectForRole(aiTl) === '/ai-studio/dashboard/u1' && getRedirectForRole(salesTl) === '/team-lead/dashboard/u1' && getRedirectForRole(supportTl) === '/support-lead/dashboard/u1', 'each signs in at their own address');

// ---- the report statuses the department uses
check(AI_STUDIO_REPORT_STATUSES.length === 7 && Object.values(AI_STUDIO_REPORT_STATUS_LABELS).join('|') ===
  'Draft|Submitted|Pending Team Lead Approval|Returned by Team Lead|Pending Department Head Approval|Returned by Department Head|Approved', 'the seven report statuses and their wording');

// ---- project: name and description
check(aiStudioProjectSchema.safeParse({ name: '  AI Chatbot  ', description: '' }).success, 'a project needs a name; the description is optional');
check(!aiStudioProjectSchema.safeParse({ name: 'A' }).success && !aiStudioProjectSchema.safeParse({ name: 'x'.repeat(121) }).success, 'a project name is 2 to 120 characters');
check(!aiStudioProjectSchema.safeParse({ name: 'Ok', owner: 'x' }).success, 'unknown fields are refused');

// ---- tasks
const task = { projectId: uuid(1), assigneeId: uuid(2), title: 'Build login', priority: 'HIGH', dueDate: '2030-01-31' };
check(aiStudioTaskCreateSchema.safeParse(task).success && aiStudioTaskCreateSchema.parse({ ...task, priority: undefined }).priority === 'MEDIUM', 'a task needs a project, a person and a title; the priority defaults to Medium');
check(!aiStudioTaskCreateSchema.safeParse({ ...task, title: '  ' }).success && !aiStudioTaskCreateSchema.safeParse({ ...task, dueDate: '31/01/2030' }).success, 'an empty title and a wrong date are refused');
check(!aiStudioTaskCreateSchema.safeParse({ ...task, attachments: ['javascript:alert(1)'] }).success && aiStudioTaskCreateSchema.safeParse({ ...task, attachments: ['https://example.com/a'] }).success, 'attachments are http(s) links only');
check(!aiStudioTaskCreateSchema.safeParse({ ...task, attachments: Array(6).fill('https://example.com/a') }).success, 'at most five attachments');
check(aiStudioTaskUpdateSchema.safeParse({ status: 'IN_PROGRESS', progress: 40 }).success, 'progress can be updated');
check(!aiStudioTaskUpdateSchema.safeParse({ status: 'IN_PROGRESS', progress: 100 }).success, '100% only by completing');
check(!aiStudioTaskUpdateSchema.safeParse({ status: 'COMPLETED', progress: 100 }).success && aiStudioTaskUpdateSchema.safeParse({ status: 'COMPLETED', progress: 100, note: 'Merged and deployed' }).success, 'completing needs the completion details');
check(!aiStudioTaskUpdateSchema.safeParse({ status: 'ON_HOLD', progress: 20 }).success, 'on hold needs a reason');
check(!aiStudioTaskUpdateSchema.safeParse({ status: 'ASSIGNED', progress: 0 }).success, 'a task cannot be set back to Assigned');

// ---- reports
const report = { projectId: uuid(1), reportDate: '2030-01-31', workCompleted: 'Login screen', submit: true };
check(aiStudioReportSchema.safeParse(report).success, 'a daily report has a date, a project and the work completed');
check(!aiStudioReportSchema.safeParse({ ...report, workCompleted: '' }).success, 'submitting needs the work completed');
check(aiStudioReportSchema.safeParse({ ...report, workCompleted: '', submit: false }).success, 'a draft can be saved without it');
check(!aiStudioReportSchema.safeParse({ ...report, status: 'APPROVED' }).success && !aiStudioReportSchema.safeParse({ ...report, authorId: uuid(3) }).success, 'a report cannot carry a status, an author or a reviewer from the browser');
check(!aiStudioReportSchema.safeParse({ ...report, blockers: 'x'.repeat(4001) }).success, 'each part of the report is at most 4000 characters');
check(aiStudioReportReviewSchema.safeParse({ decision: 'APPROVE' }).success && !aiStudioReportReviewSchema.safeParse({ decision: 'RETURN' }).success && aiStudioReportReviewSchema.safeParse({ decision: 'RETURN', comment: 'Add the test results' }).success, 'a return needs remarks; an approval does not');
check(!aiStudioReportReviewSchema.safeParse({ decision: 'REJECT', comment: 'no' }).success, 'only Approve or Return');

// ---- adding an AI Studio employee (the Add Team Member form)
const account = { email: 'new@example.com', fullName: 'New Person', role: 'TEAM_HEAD', teamId: uuid(5), aiStudioProjectIds: [uuid(1), uuid(2)] };
check(userCreateSchema.safeParse(account).success, 'a Team Lead can be created with one or more projects');
check(userCreateSchema.safeParse({ ...account, role: 'TEAM_MEMBER', aiStudioLeadId: uuid(6) }).success, 'a Team Member can be created with a Team Lead and projects');
check(!userCreateSchema.safeParse({ ...account, role: 'TEAM_HEAD', aiStudioLeadId: uuid(6) }).success, 'only a Team Member has a Team Lead to choose');
check(!userCreateSchema.safeParse({ ...account, role: 'DEPARTMENT_HEAD', teamId: undefined, departmentId: uuid(7) }).success, 'a Department Head gets no projects');
check(userCreateSchema.safeParse({ email: 'x@example.com', fullName: 'X', role: 'TEAM_MEMBER', teamId: uuid(5) }).success, 'creating anybody else is unchanged (no AI Studio fields)');
check(!userCreateSchema.safeParse({ ...account, aiStudioProjectIds: ['not-a-uuid'] }).success, 'a project must be an identifier from the list');

// ---- Team Members without a Team Lead, assigned later
check(userCreateSchema.safeParse({ email: 'nolead@example.com', fullName: 'No Lead', role: 'TEAM_MEMBER', teamId: uuid(5), aiStudioProjectIds: [uuid(1)] }).success, 'a Team Member can be created with a project and no Team Lead');
check(aiStudioAssignLeadSchema.safeParse({ memberIds: [uuid(1), uuid(2)], leadId: uuid(3) }).success, 'one or many Team Members can be assigned to a Team Lead');
check(!aiStudioAssignLeadSchema.safeParse({ memberIds: [], leadId: uuid(3) }).success, 'at least one Team Member must be selected');
check(!aiStudioAssignLeadSchema.safeParse({ memberIds: ['x'], leadId: uuid(3) }).success && !aiStudioAssignLeadSchema.safeParse({ memberIds: [uuid(1)] }).success, 'identifiers and a Team Lead are required');
check(!aiStudioAssignLeadSchema.safeParse({ memberIds: Array.from({ length: 201 }, (_, i) => uuid(i + 1)), leadId: uuid(3) }).success, 'at most 200 at a time');
check(!aiStudioAssignLeadSchema.safeParse({ memberIds: [uuid(1)], leadId: uuid(3), role: 'TEAM_HEAD' }).success, 'nothing else can be sent with it');

console.log(`=== AI STUDIO TESTS PASSED (${passed}) ===`);

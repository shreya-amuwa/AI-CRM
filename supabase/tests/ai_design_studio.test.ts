// AI Design Studio: dashboard routing (department AND role decide), route guards, the Super Admin keeps no workspace in it, and the form schemas.
import { toAuthUser, defaultDashboardLabel } from '../../src/lib/auth/roleMapping.js';
import { getRedirectForRole, parseCurrentRoute, validateRouteAccess, type ParsedRoute } from '../../src/utils/router.js';
import {
  adsAssignmentCreateSchema, adsAssignmentStatusSchema, adsClientCreateSchema, adsClientUpdateSchema, adsIssueCreateSchema, adsIssueUpdateSchema,
  adsNoticeCreateSchema, adsReportReviewSchema, adsReportSchema
} from '../../shared/validation.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const ADS = { id: 'd-ads', name: 'AI Design Studio', slug: 'ai-design-studio' };
const AI_STUDIO = { id: 'd-ai', name: 'AI Studio', slug: 'ai-studio' };
const profile = (over: Record<string, unknown>) => ({
  id: 'u1', fullName: 'Test User', email: 'u@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE', salesSubRole: null,
  department: ADS, team: { id: 't1', name: 'General', division: 'GENERAL' }, ...over
}) as any;
const route = (type: ParsedRoute['type'], paramId?: string): ParsedRoute => ({ path: '/x', type, paramId });

// ---- routing: department AND role
const member = toAuthUser(profile({}));
const lead = toAuthUser(profile({ id: 'u2', role: 'TEAM_HEAD' }));
const head = toAuthUser(profile({ id: 'u3', role: 'DEPARTMENT_HEAD', team: null }));
check(member.role === 'design-studio' && lead.role === 'design-studio' && head.role === 'design-studio', 'AI Design Studio Team Member, Team Lead and Department Head open the AI Design Studio dashboard');
check(getRedirectForRole(member) === '/ai-design-studio/dashboard/u1', 'and sign in at their own address');
// AI Studio (a different department) keeps the original dashboards, whatever its role names
const aiMember = toAuthUser(profile({ department: AI_STUDIO }));
const aiLead = toAuthUser(profile({ department: AI_STUDIO, role: 'TEAM_HEAD' }));
check(aiMember.role === 'ai-studio' && aiLead.role === 'ai-studio' && aiMember.role !== member.role, 'AI Studio Team Member / Team Lead keep the AI Studio dashboard, never the AI Design Studio one (routed by department, not role name)');
check(toAuthUser(profile({ department: { id: 'x', name: 'Amuwa Design Studio', slug: 'designstudio' } })).role === 'team-member', 'Amuwa Design Studio is not AI Design Studio');
check(toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' } })).role === 'business-associate', 'Sales is unchanged');
check(toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Support', division: 'SUPPORT' } })).role === 'support-member', 'Support is unchanged');
check(toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Support', division: 'SUPPORT' } })).role === 'support-lead', 'a Support Team Lead is unchanged');
check(toAuthUser(profile({ department: { id: 'h', name: 'HR', slug: 'hr' }, team: null })).role === 'hr', 'HR is unchanged');
check(toAuthUser(profile({ department: { id: 'a', name: 'Accounts', slug: 'accounts' }, team: null })).role === 'accounts-staff', 'Accounts is unchanged');
check(toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null })).role === 'superadmin', 'the Super Admin keeps the Super Admin dashboard');
check(toAuthUser(profile({ role: 'SUPER_ADMIN', department: ADS, team: null })).role === 'superadmin', 'even a Super Admin profile placed in the department');
check(defaultDashboardLabel('TEAM_MEMBER', 'GENERAL', 'Amuwa Design Studio', false, 'ai-design-studio').startsWith('Amuwa Design Studio Team Member Dashboard'), 'the Add Team Member form says which dashboard opens');

// ---- route guards
(globalThis as unknown as { window: unknown }).window = { location: { pathname: '/ai-design-studio/dashboard/u1/assign' } };
check(parseCurrentRoute().type === 'design-studio' && parseCurrentRoute().paramId === 'u1', 'the /ai-design-studio/dashboard/:id/:page address is recognised');
check(validateRouteAccess(member, route('design-studio', 'u1')).allowed, 'their own dashboard opens');
check(validateRouteAccess(member, route('design-studio', 'someone-else')).redirectTo === '/ai-design-studio/dashboard/u1', 'someone else\'s does not');
check(validateRouteAccess(member, route('team-member', 'u1')).redirectTo === '/ai-design-studio/dashboard/u1' && validateRouteAccess(lead, route('team-lead', 'u2')).allowed === false, 'they cannot open the Sales / generic Team Member or Team Lead dashboards');
check(validateRouteAccess(aiMember, route('design-studio', 'u1')).allowed === false, 'AI Studio staff cannot open the AI Design Studio dashboard');
check(validateRouteAccess(toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' } })), route('design-studio', 'u1')).allowed === false, 'nor Sales staff');
const sa = toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null }));
check(validateRouteAccess(sa, route('admin', 'ai-design-studio')).redirectTo === '/department-hub', 'the Super Admin has no AI Design Studio workspace');
check(validateRouteAccess(sa, route('admin', 'ai-studio')).allowed === true && validateRouteAccess(sa, route('admin', 'wabastore')).allowed === true, 'AI Studio and the other departments still open for the Super Admin');

// ---- schemas
check(adsClientCreateSchema.safeParse({ clientName: 'Acme', email: 'A@B.com', contactNumber: '+91 98765 43210' }).success, 'a client with a name is valid');
check(!adsClientCreateSchema.safeParse({ clientName: '' }).success && !adsClientCreateSchema.safeParse({ clientName: 'A', email: 'nope' }).success, 'a client needs a name and a valid e-mail');
check(adsClientCreateSchema.safeParse({ clientName: 'A', email: '' }).success, 'blank optional fields are accepted');
check(!adsClientCreateSchema.safeParse({ clientName: 'A', createdBy: 'x' }).success, 'a client request that names the creator is refused (strict)');
check(adsClientUpdateSchema.safeParse({ remarks: 'VIP' }).success && !adsClientUpdateSchema.safeParse({ status: 'GONE' }).success, 'a client update is partial');
check(!adsClientCreateSchema.safeParse({ clientName: 'A', attachments: [{ url: 'javascript:alert(1)' }] }).success, 'a javascript: attachment link is refused');
check(!adsClientCreateSchema.safeParse({ clientName: 'A', attachments: Array.from({ length: 6 }, () => ({ url: 'https://x.io/a' })) }).success, 'at most 5 attachment links');
const uuid = '5b8c1d16-0b8d-4a3a-9f3e-0a7e0b6c1a11';
check(adsAssignmentCreateSchema.safeParse({ clientId: uuid, assigneeId: uuid, title: 'Brand kit', priority: 'HIGH', dueDate: '2030-01-31' }).success, 'a Department Head assignment is valid');
check(adsAssignmentCreateSchema.safeParse({ parentId: uuid, assigneeId: uuid, clientId: '', title: '', dueDate: '' }).success, 'a Team Lead assignment needs only the parent and the member');
check(!adsAssignmentCreateSchema.safeParse({ assigneeId: uuid, assignedBy: uuid }).success && !adsAssignmentCreateSchema.safeParse({ assigneeId: 'x' }).success, 'an assignment cannot name who assigns it, and the assignee must be an id');
check(!adsAssignmentCreateSchema.safeParse({ assigneeId: uuid, priority: 'NOW' }).success && !adsAssignmentCreateSchema.safeParse({ assigneeId: uuid, dueDate: '31/01/2030' }).success, 'unknown priorities and bad dates are refused');
check(adsAssignmentStatusSchema.safeParse({ status: 'IN_PROGRESS', progress: 40 }).success && !adsAssignmentStatusSchema.safeParse({ status: 'DONE' }).success && !adsAssignmentStatusSchema.safeParse({ status: 'IN_PROGRESS', progress: 140 }).success, 'status updates use the listed statuses and 0-100 progress');
check(adsReportSchema.safeParse({ workCompleted: 'Logo drafted', reportDate: '2030-01-01' }).success && !adsReportSchema.safeParse({ workCompleted: ' ' }).success, 'a daily report needs the work completed today');
check(!adsReportSchema.safeParse({ workCompleted: 'x', status: 'APPROVED' }).success && !adsReportSchema.safeParse({ workCompleted: 'x', authorId: uuid }).success, 'a report cannot set its own status or author');
check(adsReportReviewSchema.safeParse({ decision: 'APPROVE' }).success && !adsReportReviewSchema.safeParse({ decision: 'MAYBE' }).success, 'a review is Approve or Return');
check(adsIssueCreateSchema.safeParse({ title: 'Blocked', category: 'DESIGN_BLOCKER', description: 'No licence' }).success && !adsIssueCreateSchema.safeParse({ title: 'x', category: 'OTHER' }).success, 'an issue needs a title, a category and a description');
check(adsIssueUpdateSchema.safeParse({ status: 'RESOLVED' }).success && adsIssueUpdateSchema.safeParse({ note: 'ok' }).success && !adsIssueUpdateSchema.safeParse({}).success, 'an issue update needs a status or a response');
check(adsNoticeCreateSchema.safeParse({ clientId: uuid, title: 'Revise', category: 'REVISION_REQUEST', description: 'Bolder' }).success && !adsNoticeCreateSchema.safeParse({ clientId: uuid, title: 'x', category: 'GOSSIP', description: 'x' }).success, 'a notice has a client, a title, a known category and a description');

console.log(`=== AI DESIGN STUDIO UNIT TESTS PASSED (${passed}) ===`);

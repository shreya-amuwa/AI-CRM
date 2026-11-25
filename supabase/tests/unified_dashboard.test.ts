// International / Reseller unified dashboard (PR 2) without a database or a browser: the sidebar of each role (Sales and Support in the SAME sidebar), the
// addresses, which pages a role may open, which dashboard each person opens, the route guard and the Add Team Member form rules. Every other department's
// routing is unchanged.
import { UNIFIED_DEPARTMENT_SLUGS } from '../../shared/contracts.js';
import { defaultDashboardLabel, isUnifiedStaff, toAuthUser } from '../../src/lib/auth/roleMapping.js';
import { designationsForDepartment, hasPlainRolesOnly, isUnifiedDepartment, registerUnifiedDepartments, requestSidesForDepartment, staffChoicesForDepartment, staffTeamsForDepartment } from '../../src/lib/auth/departmentRoles.js';
import { getRedirectForRole, parseCurrentRoute, validateRouteAccess, type ParsedRoute } from '../../src/utils/router.js';
import { UNIFIED_PATHS, canOpen, parseUnifiedPage, unifiedMenu, type UnifiedPage, type UnifiedWho } from '../../src/components/unified/unifiedNav.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const intl = { id: 'd1', name: 'International', slug: 'international' };
const resl = { id: 'd2', name: 'Reseller', slug: 'reseller' };
const profile = (over: Record<string, unknown>) => ({
  id: 'u1', fullName: 'Test User', email: 'u@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE', salesSubRole: null, department: intl,
  team: { id: 't1', name: 'International Team', division: 'GENERAL' }, defaultDashboard: 'unified-member', ...over
}) as any;
const route = (type: ParsedRoute['type'], paramId?: string): ParsedRoute => ({ path: '/x', type, paramId });
const WHO: UnifiedWho[] = ['HEAD', 'LEAD', 'MEMBER'];
const labelsOf = (who: UnifiedWho, group: string) => unifiedMenu(who).find(g => g.label === group)?.items.map(i => i.label) ?? [];
const pagesOf = (who: UnifiedWho): UnifiedPage[] => unifiedMenu(who).flatMap(g => g.items.flatMap(i => (i.children ? i.children.map(c => c.id) : [i.id as UnifiedPage])));

// ---- one sidebar with a Sales section and a Support section, for every role
for (const who of WHO) {
  const groups = unifiedMenu(who).map(g => g.label);
  check(groups.includes('Sales') && groups.includes('Support') && groups.indexOf('Sales') < groups.indexOf('Support'), `${who}: ONE sidebar with a Sales section and then a Support section`);
  check(unifiedMenu(who)[0].items[0].id === 'overview', `${who}: the sidebar starts with the Overview`);
  const all = unifiedMenu(who).flatMap(g => g.items.map(i => i.label));
  const taskEntry = { HEAD: 'Task Management', LEAD: 'Assign Task', MEMBER: 'My Assigned Tasks' }[who];
  for (const must of [taskEntry, 'Daily Reports', 'Chat', 'Notification Center', 'Profile', 'Raise an Issue']) check(all.includes(must), `${who}: ${must} is in the same sidebar`);
  check(labelsOf(who, 'Sales').includes('Add Lead') && labelsOf(who, 'Sales').includes('My Leads'), `${who}: Sales has Add Lead and My Leads`);
  check(labelsOf(who, 'Sales').length > 0 && labelsOf(who, 'Support').length >= 2, `${who}: Sales and Support each have their pages`);
}
check(JSON.stringify(unifiedMenu('MEMBER').find(g => g.label === 'Sales')!.items.find(i => i.id === 'sales-my-leads')!.children!.map(c => c.label)) === JSON.stringify(['Leads', 'Potential', 'Customer onboarding', 'Part payments']), 'My Leads opens Leads, Potential, Customer onboarding and Part payments (the lead status steps)');
check(labelsOf('HEAD', 'Sales').join('|') === 'Add Lead|My Leads|Department Leads|Lead Assignment|Sales Performance|Sales Reports', 'Department Head, Sales: department leads, lead assignment, performance and reports');
check(labelsOf('HEAD', 'Support').join('|') === 'Customers|Support Tickets|Customer Issues|Team Activity', 'Department Head, Support: customers, tickets, customer issues, team activity');
check(labelsOf('LEAD', 'Sales').join('|') === 'Add Lead|My Leads|Team Leads|Lead Follow-ups|Sales Performance', 'Team Lead, Sales: own leads, the team\'s leads, follow-ups, performance');
check(labelsOf('LEAD', 'Support').join('|') === 'Customers|Support Tickets|Team Activity', 'Team Lead, Support: the team\'s customers, tickets and activity');
check(labelsOf('MEMBER', 'Sales').join('|') === 'Add Lead|My Leads|Lead Follow-ups', 'Team Member, Sales: add lead, my leads, follow-ups only');
check(labelsOf('MEMBER', 'Support').join('|') === 'My Customers|My Support Tickets', 'Team Member, Support: my customers and my tickets only');
check(!labelsOf('MEMBER', 'Team').includes('Team Members') && labelsOf('LEAD', 'Team').includes('Team Members') && labelsOf('HEAD', 'Team').includes('Team Attendance'), 'only the Team Lead and the Department Head manage team members; only the head has Team Attendance');
const headTasks = unifiedMenu('HEAD').find(g => g.label === 'Work')!.items[0];
check(headTasks.children?.length === 4 && headTasks.children[0].label === 'Assign Task' && unifiedMenu('MEMBER').find(g => g.label === 'Work')!.items[0].id === 'tasks', 'the head\'s Task Management has assign, updates, reports and daily; the others one page');

check(labelsOf('HEAD', 'Work').join('|') === 'Task Management|Daily Reports|Performance Management' && labelsOf('LEAD', 'Work').join('|') === 'Assign Task|Daily Reports|Performance Management'
  && labelsOf('MEMBER', 'Work').join('|') === 'My Assigned Tasks|Daily Reports', 'Work: Assign Task, Daily Reports and Performance Management for the head and the lead; only My Assigned Tasks and Daily Reports for the member');
check(canOpen('HEAD', 'performance') && canOpen('LEAD', 'performance') && !canOpen('MEMBER', 'performance'), 'Performance Management is for the head and the lead only');
// 20270210000100: the Team Member has no performance page at all (no "My Performance"; an old address opens the Overview, which the member may open)
check(!unifiedMenu('MEMBER').some(g => g.items.some(i => /performance/i.test(i.label) || (i.children ?? []).some(c => /performance/i.test(c.label)))), 'the Team Member\'s sidebar has no performance entry of any kind');
check(!('my-performance' in UNIFIED_PATHS) && parseUnifiedPage('/unified/dashboard/u1/my-performance') === 'overview', 'there is no My Performance page; its old address opens the Overview');

// ---- every sidebar entry is a real page that the role may open; addresses are unique, short and round-trip
for (const who of WHO) check(pagesOf(who).every(p => canOpen(who, p)), `${who}: every sidebar page is one the role may open`);
check(!canOpen('MEMBER', 'team') && !canOpen('MEMBER', 'sales-dept-leads') && !canOpen('MEMBER', 'sales-assign') && !canOpen('MEMBER', 'task-updates') && !canOpen('LEAD', 'sales-assign') && !canOpen('LEAD', 'support-desk') && !canOpen('LEAD', 'team-attendance'),
  'a role cannot open another role\'s page by address');
const pages = Object.keys(UNIFIED_PATHS) as UnifiedPage[];
check(new Set(Object.values(UNIFIED_PATHS)).size === pages.length && pages.every(p => UNIFIED_PATHS[p].split('/').length <= 2), 'page addresses are unique and at most two segments');
check(pages.every(p => parseUnifiedPage(`/unified/dashboard/u1${UNIFIED_PATHS[p] ? '/' + UNIFIED_PATHS[p] : ''}`) === p), 'every page address parses back to its page');
check(parseUnifiedPage('/unified/dashboard/u1') === 'overview' && parseUnifiedPage('/unified/dashboard/u1/nonsense') === 'overview' && parseUnifiedPage('/unified/dashboard/u1/support/tickets/') === 'support-tickets', 'the overview for no or an unknown page; a trailing slash is fine');

// ---- which dashboard each person opens
for (const [role, who, dash] of [['TEAM_MEMBER', 'Team Member', 'unified-member'], ['TEAM_HEAD', 'Team Lead', 'unified-lead'], ['DEPARTMENT_HEAD', 'Department Head', 'unified-head']] as const) {
  for (const d of [intl, resl]) {
    const u = toAuthUser(profile({ role, department: d, defaultDashboard: dash, team: role === 'DEPARTMENT_HEAD' ? null : undefined }));
    check(u.role === 'unified', `${d.name} ${who} opens the unified dashboard`);
    check(getRedirectForRole(u) === '/unified/dashboard/u1', `${d.name} ${who} signs in at their own unified address`);
    check(validateRouteAccess(u, route('unified', 'u1')).allowed === true, `${d.name} ${who}: their own dashboard opens`);
    check(validateRouteAccess(u, route('unified', 'other')).redirectTo === '/unified/dashboard/u1', `${d.name} ${who}: another person's address does not`);
    check(['team-member', 'support-member', 'team-lead', 'support-lead', 'sales-head', 'business-associate', 'ai-studio', 'admin', 'telecaller'].every(t => validateRouteAccess(u, route(t as ParsedRoute['type'], 'u1')).allowed === false),
      `${d.name} ${who}: no other dashboard opens`);
  }
}
check(!isUnifiedStaff({ role: 'SUPER_ADMIN', defaultDashboard: 'unified-head' } as any) && toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null, defaultDashboard: 'super-admin' })).role === 'superadmin', 'the Super Admin is never a unified employee');
check(toAuthUser(profile({ defaultDashboard: 'team-member' })).role !== 'unified', 'the dashboard value the database computed decides: a member without it is not unified');

// ---- other people keep their own dashboards and cannot open the unified one
const sales = toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't', name: 'Sales', division: 'SALES' }, defaultDashboard: 'sales-member' }));
const support = toAuthUser(profile({ department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't2', name: 'Support', division: 'SUPPORT' }, defaultDashboard: 'support-member' }));
const supportLead = toAuthUser(profile({ role: 'TEAM_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't2', name: 'Support', division: 'SUPPORT' }, defaultDashboard: 'support-lead' }));
const head = toAuthUser(profile({ role: 'DEPARTMENT_HEAD', department: { id: 'w', name: 'Wabastore', slug: 'wabastore' }, team: null, defaultDashboard: 'department-head' }));
check(sales.role === 'business-associate' && support.role === 'support-member' && supportLead.role === 'support-lead' && head.role === 'admin', 'Sales, Support and the Department Head of another department keep their dashboards');
check([sales, support, supportLead, head].every(u => validateRouteAccess(u, route('unified', 'u1')).allowed === false), 'and none of them can open the unified dashboard');
check(getRedirectForRole(sales) !== '/unified/dashboard/u1' && getRedirectForRole(supportLead) === '/support-lead/dashboard/u1', 'each signs in at their own address');
const admin = toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null, defaultDashboard: 'super-admin' }));
check(admin.role === 'superadmin' && getRedirectForRole(admin) === getRedirectForRole(toAuthUser(profile({ role: 'SUPER_ADMIN', department: null, team: null, defaultDashboard: 'super-admin' }))), 'the Super Admin keeps their own dashboard (their routing is unchanged)');

// ---- addresses
const parsed = (path: string) => { (globalThis as any).window = { location: { pathname: path } }; return parseCurrentRoute(); };
check(parsed('/unified/dashboard/u1').type === 'unified' && parsed('/unified/dashboard/u1/sales/leads').paramId === 'u1' && parsed('/unified/dashboard/u1/tasks').type === 'unified', 'the unified addresses are recognised, with their pages');
check(parsed('/unified/dashboard/u1/a/b/c').type === 'unknown', 'a longer address is not');

// ---- the Add Team Member form
const roles = ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER', 'TELECALLER', 'BUSINESS_ASSOCIATE', 'META_VERIFIER', 'TECHNICAL_CONSULTANT', 'OPERATIONS_HEAD'] as const;
check(UNIFIED_DEPARTMENT_SLUGS.join() === 'international,reseller', 'the two departments');
for (const slug of UNIFIED_DEPARTMENT_SLUGS) {
  check(staffChoicesForDepartment(slug, roles).join() === 'DEPARTMENT_HEAD,TEAM_HEAD,TEAM_MEMBER', `${slug}: only Department Head, Team Lead and Team Member are offered`);
  const teams = [{ id: 'a', division: 'GENERAL' }, { id: 'b', division: 'SALES' }, { id: 'c', division: 'SUPPORT' }];
  check(staffTeamsForDepartment(slug, teams).map(t => t.id).join() === 'a', `${slug}: only the department's one team`);
  check(requestSidesForDepartment(slug).join() === 'GENERAL', `${slug}: no Sales-only or Support-only side`);
  check(designationsForDepartment(slug, ['Department Head', 'Team Lead', 'Team Member', 'Telecaller']).join() === 'Department Head,Team Lead,Team Member', `${slug}: the plain designations`);
  check(defaultDashboardLabel('TEAM_HEAD', 'GENERAL', 'International', false, slug).startsWith('Sales & Support Team Lead Dashboard'), `${slug}: the form names the dashboard`);
}
check(staffChoicesForDepartment('wabastore', roles).length === roles.length && requestSidesForDepartment('wabastore').length === 3, 'another department keeps every role and side');
check(defaultDashboardLabel('TEAM_HEAD', 'SUPPORT', 'Wabastore', false, 'wabastore') === 'Support Team Lead Dashboard · Wabastore', 'and its dashboard names');

// ---- departments the owner created under their own names: the DATABASE flag decides, not the slug (migration 20270202000300)
{
  const OWNER = ['amuwa-international-department', 'amuwa-reseller-department'];
  check(OWNER.every(s => !isUnifiedDepartment(s) && !hasPlainRolesOnly(s)), 'before the department list is loaded the owner-created slugs are not recognised (the reported error)');
  check(staffChoicesForDepartment(OWNER[0], roles).length === roles.length, 'so the form offered every Sales / Support role and the head function chooser ("has no Sales or Support team")');
  registerUnifiedDepartments([
    { slug: OWNER[0], unifiedSalesSupport: true }, { slug: OWNER[1], unifiedSalesSupport: true },
    { slug: 'wabastore', unifiedSalesSupport: false }, { slug: 'intl-sales-hub' }
  ]);
  for (const slug of OWNER) {
    check(isUnifiedDepartment(slug) && hasPlainRolesOnly(slug), `${slug}: recognised from the database flag`);
    check(staffChoicesForDepartment(slug, roles).join() === 'DEPARTMENT_HEAD,TEAM_HEAD,TEAM_MEMBER', `${slug}: only Department Head, Team Lead and Team Member are offered`);
    check(staffTeamsForDepartment(slug, [{ id: 'a', division: 'GENERAL' }, { id: 'b', division: 'SALES' }]).map(t => t.id).join() === 'a', `${slug}: only the department's one team`);
    check(requestSidesForDepartment(slug).join() === 'GENERAL', `${slug}: no Sales-only or Support-only side`);
    for (const [role, label] of [['DEPARTMENT_HEAD', 'Department Head'], ['TEAM_HEAD', 'Team Lead'], ['TEAM_MEMBER', 'Team Member']] as const) {
      check(defaultDashboardLabel(role, 'GENERAL', 'Amuwa International Department', false, slug).startsWith(`Sales & Support ${label} Dashboard`), `${slug}: ${label}: "Will open" names the unified dashboard`);
    }
  }
  check(!isUnifiedDepartment('wabastore') && !isUnifiedDepartment('intl-sales-hub') && staffChoicesForDepartment('wabastore', roles).length === roles.length, 'an existing department, or one that merely says International, is not recognised');
  check(isUnifiedDepartment('international') && isUnifiedDepartment('reseller'), 'the two seeded slugs stay recognised');
  registerUnifiedDepartments([{ slug: 'wabastore' }]);
  check(!isUnifiedDepartment(OWNER[0]), 'a department list that no longer flags a slug forgets it');
}

console.log(`=== UNIFIED DASHBOARD TESTS PASSED (${passed}) ===`);

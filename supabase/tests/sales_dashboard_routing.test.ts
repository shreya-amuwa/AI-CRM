// Which dashboard each employee opens: a Sales Team Member (no other Sales role) works in the unified Sales dashboard (the Business Associate
// dashboard); every other dashboard is unchanged, and the old Sales Team Member address redirects safely.
import { toAuthUser } from '../../src/lib/auth/roleMapping.js';
import { getRedirectForRole, validateRouteAccess, type ParsedRoute } from '../../src/utils/router.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const profile = (over: Record<string, unknown>) => ({
  id: 'u1', fullName: 'Test User', email: 'u@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE', salesSubRole: null,
  department: { id: 'd1', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't1', name: 'Sales A', division: 'SALES' }, ...over
}) as any;
const route = (type: ParsedRoute['type'], paramId?: string): ParsedRoute => ({ path: '/x', type, paramId });

const salesMember = toAuthUser(profile({}));
check(salesMember.role === 'business-associate', 'a Sales Team Member with no Sales role works in the unified Sales (Business Associate) dashboard');
check(getRedirectForRole(salesMember) === '/business-associate/dashboard/u1', 'and signs in there');
check(toAuthUser(profile({ salesSubRole: 'BUSINESS_ASSOCIATE' })).role === 'business-associate', 'a Business Associate does too');
check(toAuthUser(profile({ salesSubRole: 'TELECALLER' })).role === 'telecaller', 'a Telecaller keeps the Telecaller dashboard');
check(toAuthUser(profile({ salesSubRole: 'SOMETHING_ELSE' })).role === 'sales-role', 'a Sales role without a dashboard keeps the notice page');
check(toAuthUser(profile({ team: { id: 't2', name: 'Support', division: 'SUPPORT' } })).role === 'support-member', 'a Support member keeps the Support dashboard');
check(toAuthUser(profile({ team: null, department: { id: 'd9', name: 'Delivery', slug: 'delivery' } })).role === 'team-member', 'a team member outside Sales keeps the Team Member dashboard');
check(toAuthUser(profile({ role: 'TEAM_HEAD' })).role === 'team-lead', 'a Sales Team Lead keeps the Team Lead dashboard');
check(toAuthUser(profile({ role: 'DEPARTMENT_HEAD', headDivision: 'SALES' })).role === 'sales-head', 'the Sales Department Head keeps theirs');
check(toAuthUser(profile({ department: { id: 'a', name: 'Accounts', slug: 'accounts' }, team: null })).role === 'accounts-staff', 'Accounts staff keep theirs');
check(toAuthUser(profile({ department: { id: 'h', name: 'HR', slug: 'hr' }, team: null })).role === 'hr', 'and HR');

// the old Sales Team Member address
check(validateRouteAccess(salesMember, route('team-member', 'u1')).redirectTo === '/business-associate/dashboard/u1', 'the old /team-member/dashboard address redirects to the unified dashboard');
check(validateRouteAccess(salesMember, route('business-associate', 'u1')).allowed === true, 'their own unified dashboard opens');
check(validateRouteAccess(salesMember, route('business-associate', 'someone-else')).redirectTo === '/business-associate/dashboard/u1', 'someone else\'s does not');
check(validateRouteAccess(salesMember, route('telecaller', 'u1')).allowed === false && validateRouteAccess(salesMember, route('sales-head', 'u1')).allowed === false, 'nor any other dashboard');

// everyone else is unchanged
const outside = toAuthUser(profile({ team: null, department: { id: 'd9', name: 'Delivery', slug: 'delivery' } }));
check(validateRouteAccess(outside, route('team-member', 'u1')).allowed === true, 'a team member outside Sales still opens the Team Member dashboard');
check(validateRouteAccess(outside, route('business-associate', 'u1')).allowed === false, 'and cannot open the Sales dashboard');
const tl = toAuthUser(profile({ role: 'TEAM_HEAD' }));
check(validateRouteAccess(tl, route('business-associate', 'u1')).allowed === false, 'a Team Lead cannot open it either');
const tc = toAuthUser(profile({ salesSubRole: 'TELECALLER' }));
check(validateRouteAccess(tc, route('business-associate', 'u1')).allowed === false, 'nor a Telecaller');

console.log(`=== SALES DASHBOARD ROUTING TESTS PASSED (${passed}) ===`);

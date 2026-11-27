/**
 * Department HR ("HR (Digitree)", migration 20270223000100), no database: the shared designation rule, the dashboard the profile opens and the route
 * guard that keeps the person on their own department HR dashboard. Every permission is enforced by the database (supabase/tests/department_hr_test.sql);
 * this checks the navigation and the form rules agree with it. Run: npm run test:unit
 */
import type { Profile } from '../../shared/contracts.js';
import { DEPARTMENT_HR_DESIGNATION, DEPARTMENT_HR_OPTIONS, HR_DESIGNATIONS, designationProblem, employeeRequestSchema } from '../../shared/validation.js';
import { isDepartmentHr, isHrStaff, toAuthUser } from '../../src/lib/auth/roleMapping.js';
import { getRedirectForRole, validateRouteAccess, type ParsedRoute } from '../../src/utils/router.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// the designation rule
check(designationProblem({ departmentSlug: 'digitree', role: 'TEAM_MEMBER', designation: DEPARTMENT_HR_DESIGNATION }) === null, 'Department HR is a Team Member of a business department (Digitree)');
check(designationProblem({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: DEPARTMENT_HR_DESIGNATION }) !== null, 'never inside the HR department');
check(designationProblem({ departmentSlug: 'accounts', role: 'TEAM_MEMBER', designation: DEPARTMENT_HR_DESIGNATION }) !== null, 'nor in Accounts');
check(designationProblem({ departmentSlug: 'digitree', role: 'DEPARTMENT_HEAD', designation: DEPARTMENT_HR_DESIGNATION }) !== null, 'and only as a Team Member');
check(!(HR_DESIGNATIONS as readonly string[]).includes(DEPARTMENT_HR_DESIGNATION), 'it is not one of the HR department\'s own designations');
check(DEPARTMENT_HR_OPTIONS.some(o => o.departmentSlug === 'digitree' && o.label === 'HR (Digitree)' && o.teamName === 'Digitree HR'), 'the form offers HR (Digitree), placed in the Digitree HR team');
const request = { email: 'x@example.com', fullName: 'X', role: 'TEAM_MEMBER', departmentId: '11111111-1111-4111-8111-111111111111',
  details: { designation: DEPARTMENT_HR_DESIGNATION, joiningDate: '2026-01-05', dateOfBirth: '1990-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56789', emergencyContact: '+91 98765 43210' } };
check(!employeeRequestSchema.safeParse(request).success, 'an employee request (HR\'s approval route) cannot ask for a Department HR: only the Super Admin creates one directly');

// navigation
const profile = (over: Partial<Profile>): Profile => ({
  id: 'p1', email: 'p@x.example', fullName: 'Digi HR', avatarUrl: null, phone: null, position: 'HR', role: 'TEAM_MEMBER', status: 'ACTIVE',
  departmentId: 'd1', teamId: 't1', department: { id: 'd1', slug: 'digitree', name: 'Digitree Infotech' }, team: { id: 't1', name: 'Digitree HR', division: 'GENERAL' },
  hrSubRole: 'HR_DEPARTMENT', defaultDashboard: 'hr-department', ...over
} as unknown as Profile);
const dhr = profile({});
check(isDepartmentHr(dhr) && !isHrStaff(dhr), 'a Digitree HR member is department HR, not company-wide HR staff');
const user = toAuthUser(dhr);
check(user.role === 'hr-department' && user.departmentId === 'digitree', 'they open the department HR dashboard of Digitree', user);
check(getRedirectForRole(user) === '/hr-department/dashboard/p1', 'their home is their own department HR dashboard');
const route = (path: string, type: ParsedRoute['type'], paramId?: string): ParsedRoute => ({ path, type, paramId } as ParsedRoute);
check(validateRouteAccess(user, route('/hr-department/dashboard/p1/probation', 'hr-department', 'p1')).allowed, 'their own dashboard is allowed');
for (const [path, type, id] of [['/admin/dashboard/hr', 'admin', 'hr'], ['/admin/dashboard/wabastore', 'admin', 'wabastore'], ['/hr-department/dashboard/someone-else', 'hr-department', 'someone-else'],
  ['/team-member/dashboard/p1', 'team-member', 'p1'], ['/department-hub', 'department-hub', undefined]] as const) {
  const v = validateRouteAccess(user, route(path, type, id));
  check(!v.allowed && v.redirectTo === '/hr-department/dashboard/p1', `typing ${path} sends them back to their own dashboard`, v);
}
check(toAuthUser(profile({ hrSubRole: null, defaultDashboard: 'team-member' })).role !== 'hr-department', 'without the sub-role the same person is an ordinary member (nothing is decided by the team name)');
check(toAuthUser(profile({ department: { id: 'h', slug: 'hr', name: 'HR' } as Profile['department'], hrSubRole: 'HR_ASSISTANT' })).role === 'hr', 'an HR Assistant still opens the HR dashboard');

console.log(`=== ${passed} DEPARTMENT HR UNIT CHECKS PASSED ===`);

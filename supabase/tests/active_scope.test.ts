/**
 * Department scope (shared / combined Department Heads), the parts that need no database: which scope is valid, what the browser
 * sends with a request, and which profile the dashboards see for the active scope.
 */
import type { MyDepartmentScopes, Profile } from '../../shared/contracts.js';
import { NO_SCOPE, applyScope, choosableDivisions, hasSeveralDepartments, normaliseScope, requestScopeFor, scopeHeaders, setRequestScope } from '../../src/lib/scope/activeScope.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const dep = (id: string, divisions: ('SALES' | 'SUPPORT')[], wholeDepartment = false) => ({ id, slug: id, name: id.toUpperCase(), divisions, wholeDepartment });
const profile = { id: 'p1', role: 'DEPARTMENT_HEAD', departmentId: 'a', headDivision: 'SALES', defaultDashboard: 'sales-department-head' } as unknown as Profile;

// Group A: a shared Sales head (three departments, one function)
const shared = { homeDepartmentId: 'a', activeDepartmentId: 'a', activeDivision: 'SALES', departments: [dep('a', ['SALES']), dep('b', ['SALES']), dep('c', ['SALES'])] } as unknown as MyDepartmentScopes;
check(hasSeveralDepartments(shared), 'shared head: department choice is offered');
check(choosableDivisions(shared, 'b').length === 0, 'shared head: no Sales/Support selector');
check(normaliseScope(shared, { departmentId: 'b', division: null }).departmentId === 'b', 'shared head: chosen department kept');
check(normaliseScope(shared, { departmentId: 'zzz', division: 'SUPPORT' }).departmentId === 'a', 'shared head: unauthorised department falls back to home');
check(normaliseScope(shared, { departmentId: 'b', division: 'SUPPORT' }).division === 'SALES', 'shared head: function stays the authorised one');
const asB = applyScope(profile, shared, normaliseScope(shared, { departmentId: 'b', division: null }))!;
check(asB.departmentId === 'b' && asB.department?.slug === 'b' && asB.defaultDashboard === 'sales-department-head', 'shared head: dashboard sees the active department', asB);
check(applyScope(profile, shared, normaliseScope(shared, null)) === profile, 'shared head: home scope returns the same profile object');

// Group B: one head, both functions of one department
const both = { homeDepartmentId: 'm', activeDepartmentId: 'm', activeDivision: null, departments: [dep('m', ['SALES', 'SUPPORT'])] } as unknown as MyDepartmentScopes;
check(!hasSeveralDepartments(both), 'combined head: one department, no picker');
check(choosableDivisions(both, 'm').join() === 'SALES,SUPPORT', 'combined head: Sales | Support selector');
check(normaliseScope(both, null).division === 'SALES', 'combined head: starts in Sales');
check(normaliseScope(both, { departmentId: 'm', division: 'SUPPORT' }).division === 'SUPPORT', 'combined head: Support remembered');
const support = applyScope(profile, both, { departmentId: 'm', division: 'SUPPORT' })!;
check(support.defaultDashboard === 'department-head' && support.headDivision === 'SUPPORT' && support.departmentId === 'm', 'combined head: Support view keeps the department', support);
check(requestScopeFor(both, { departmentId: 'm', division: 'SUPPORT' }).division === 'SUPPORT', 'combined head: function is sent with requests');

// A head with a single scope behaves exactly as before: nothing is sent, nothing changes
const single = { homeDepartmentId: 'a', activeDepartmentId: 'a', activeDivision: 'SALES', departments: [dep('a', ['SALES'])] } as unknown as MyDepartmentScopes;
check(requestScopeFor(single, normaliseScope(single, null)) === NO_SCOPE, 'single scope: no scope headers');
check(applyScope(profile, single, normaliseScope(single, null)) === profile, 'single scope: profile untouched');
check(applyScope(profile, null, NO_SCOPE) === profile, 'no scopes loaded: profile untouched');
const other = { ...profile, role: 'TEAM_MEMBER' } as unknown as Profile;
check(applyScope(other, shared, { departmentId: 'b', division: null }) === other, 'other roles are never rescoped');

// the headers
setRequestScope({ departmentId: 'b', division: 'SALES' });
check(scopeHeaders()['X-Active-Department'] === 'b' && scopeHeaders()['X-Active-Division'] === 'SALES', 'headers carry the active scope');
setRequestScope(NO_SCOPE);
check(Object.keys(scopeHeaders()).length === 0, 'no headers without a scope');

console.log(`\n${passed} checks passed`);

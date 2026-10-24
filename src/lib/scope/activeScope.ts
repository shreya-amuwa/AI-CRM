import type { HeadDivision, MyDepartmentScopes, Profile } from '../../../shared/contracts';

/**
 * The department and function a Department Head works in right now ("scope").
 *
 * A head may be authorised by the Super Admin for several departments (a shared Sales or Support head) and for both functions of a
 * department (the head who handles Sales and Support). The browser only REMEMBERS the choice and sends it with every request
 * (X-Active-Department / X-Active-Division); the database accepts it only when it matches what was authorised and otherwise
 * falls back to the head's own department, so the choice never grants anything.
 */
export interface ActiveScope {
  departmentId: string | null;
  division: HeadDivision | null;
}

export const NO_SCOPE: ActiveScope = { departmentId: null, division: null };

// ---- the value the API client and the Supabase client attach to every request --------------------------------------------------
let current: ActiveScope = NO_SCOPE;
export const setRequestScope = (scope: ActiveScope) => {
  current = scope;
};
export const requestScope = () => current;
export function scopeHeaders(): Record<string, string> {
  return {
    ...(current.departmentId ? { 'X-Active-Department': current.departmentId } : {}),
    ...(current.division ? { 'X-Active-Division': current.division } : {})
  };
}

// ---- reading the offered scopes ----------------------------------------------------------------------------------------------------
export function departmentOf(scopes: MyDepartmentScopes | null, id: string | null) {
  return scopes?.departments.find(d => d.id === id) ?? null;
}

/** Does the head need to choose a department (more than one is authorised)? */
export const hasSeveralDepartments = (scopes: MyDepartmentScopes | null) => (scopes?.departments.length ?? 0) > 1;

/** The functions the head may choose between inside a department (Group B: both Sales and Support). */
export function choosableDivisions(scopes: MyDepartmentScopes | null, departmentId: string | null): HeadDivision[] {
  const d = departmentOf(scopes, departmentId);
  if (!d) return [];
  const all = (['SALES', 'SUPPORT'] as HeadDivision[]).filter(x => d.divisions.includes(x));
  // one function and nothing else: nothing to choose
  return all.length > 1 ? all : [];
}

/** Make a stored or requested choice valid: the department must be authorised, the function one of that department's. */
export function normaliseScope(scopes: MyDepartmentScopes | null, wanted: ActiveScope | null): ActiveScope {
  if (!scopes || scopes.departments.length === 0) return NO_SCOPE;
  const dept = departmentOf(scopes, wanted?.departmentId ?? null) ?? departmentOf(scopes, scopes.homeDepartmentId) ?? scopes.departments[0];
  const options = choosableDivisions(scopes, dept.id);
  let division: HeadDivision | null = null;
  if (options.length > 0) division = wanted?.division && options.includes(wanted.division) ? wanted.division : options[0];
  else if (dept.divisions.length === 1 && !dept.wholeDepartment) division = dept.divisions[0];
  return { departmentId: dept.id, division };
}

/** What the browser sends: nothing at all for a head with a single scope (they behave exactly as before). */
export function requestScopeFor(scopes: MyDepartmentScopes | null, scope: ActiveScope): ActiveScope {
  if (!scopes) return NO_SCOPE;
  const multi = hasSeveralDepartments(scopes) || choosableDivisions(scopes, scope.departmentId).length > 0;
  return multi ? scope : NO_SCOPE;
}

/**
 * The profile the dashboards see for this scope: the department (and the Sales / Support side) of the active scope in place of the
 * head's own. Everything that routes on the profile (which dashboard opens, which department's name is shown, which department the
 * staff panel lists) follows the active scope without knowing about it. Navigation only: the database enforces the scope.
 */
export function applyScope(profile: Profile | null, scopes: MyDepartmentScopes | null, scope: ActiveScope): Profile | null {
  if (!profile || profile.role !== 'DEPARTMENT_HEAD' || !scopes || scopes.departments.length === 0) return profile;
  const dept = departmentOf(scopes, scope.departmentId) ?? departmentOf(scopes, scopes.homeDepartmentId);
  if (!dept) return profile;
  const division = scope.division ?? (dept.divisions.length === 1 && !dept.wholeDepartment ? dept.divisions[0] : null);
  // a department that is the Sales / Support side of another (Wabatalk) works on the data of that other department
  const dataId = dept.dataDepartmentId ?? dept.id;
  const same = dataId === profile.departmentId && (division ?? null) === (profile.headDivision ?? null) && dataId === dept.id;   // an entry whose id differs from its data department is a side department (Wabatalk): shown under its own name
  if (same) return profile;
  return {
    ...profile,
    departmentId: dataId,
    department: { id: dataId, slug: dept.dataSlug ?? dept.slug, name: dept.name },
    headDivision: division,
    defaultDashboard: division === 'SALES' ? 'sales-department-head' : 'department-head'
  };
}

// ---- remembering the choice ------------------------------------------------------------------------------------------------------------
const key = (userId: string) => `crm.scope.${userId}`;
const chosenKey = (userId: string) => `crm.scope.chosen.${userId}`;

export function readStoredScope(userId: string): ActiveScope | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) || 'null');
    return v && typeof v === 'object' ? { departmentId: typeof v.departmentId === 'string' ? v.departmentId : null, division: v.division === 'SALES' || v.division === 'SUPPORT' ? v.division : null } : null;
  } catch {
    return null;
  }
}
export function storeScope(userId: string, scope: ActiveScope) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(scope));
  } catch {
    /* private mode: the choice lasts until the page is closed */
  }
}
/** The department picker is shown once per browser tab session (and again after signing out and in). */
export function readChosen(userId: string): boolean {
  try {
    return sessionStorage.getItem(chosenKey(userId)) === '1';
  } catch {
    return false;
  }
}
export function storeChosen(userId: string, chosen: boolean) {
  try {
    if (chosen) sessionStorage.setItem(chosenKey(userId), '1');
    else sessionStorage.removeItem(chosenKey(userId));
  } catch {
    /* ignore */
  }
}

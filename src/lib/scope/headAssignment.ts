import type { HeadDivision } from '../../../shared/contracts';

/**
 * Which departments and functions one Department Head account is created for (Super Admin, "Add Team Member").
 *   SALES / SUPPORT  a Sales (Support) head: their own department plus any others they share
 *   BOTH             one person who handles Sales AND Support of the chosen department(s): the account has both functions
 * The first chosen department is the head's HOME department (the one they are placed in); the rest become authorised
 * (department, function) pairs. The database re-checks every pair and refuses the ones that do not exist.
 */
export type HeadFunction = 'SALES' | 'SUPPORT' | 'BOTH';

export interface AssignableDepartment {
  id: string;
  name: string;
  slug: string;
  /** Set for a department that is the Sales / Support side of another one (Wabatalk = D Talk's Support). */
  facetOf: string | null;
  facetDivision: HeadDivision | null;
}
export interface AssignableTeam {
  departmentId: string;
  division: string;
}
export interface Offer {
  sales: boolean;
  support: boolean;
}

/** What each department can be given: a function needs a team of that function, and a function that has its own department (D Talk's Support = Wabatalk) is given under that name. */
export function offers(departments: AssignableDepartment[], teams: AssignableTeam[]): Map<string, Offer> {
  const has = (departmentId: string, division: HeadDivision) => teams.some(t => t.departmentId === departmentId && t.division === division);
  const out = new Map<string, Offer>();
  for (const d of departments) {
    const base = d.facetOf ?? d.id;
    if (d.facetDivision) {
      out.set(d.id, { sales: d.facetDivision === 'SALES' && has(base, 'SALES'), support: d.facetDivision === 'SUPPORT' && has(base, 'SUPPORT') });
    } else {
      const sides = new Set(departments.filter(f => f.facetOf === d.id).map(f => f.facetDivision));
      out.set(d.id, { sales: has(base, 'SALES') && !sides.has('SALES'), support: has(base, 'SUPPORT') && !sides.has('SUPPORT') });
    }
  }
  return out;
}

/** Why a department cannot be chosen for this function (null = it can). */
export function whyNot(dep: AssignableDepartment, offer: Offer | undefined, fn: HeadFunction | ''): string | null {
  if (!fn || !offer) return null;
  const sideOf = (d: HeadDivision) => (d === 'SALES' ? offer.sales : offer.support);
  if (fn === 'BOTH' ? offer.sales || offer.support : sideOf(fn)) return null;
  if (fn === 'BOTH') return `${dep.name} has no Sales or Support team to manage.`;
  if (dep.facetDivision && dep.facetDivision !== fn) return `${dep.name} is the ${dep.facetDivision === 'SUPPORT' ? 'Support' : 'Sales'} department.`;
  return `${dep.name} has no ${fn === 'SALES' ? 'Sales' : 'Support'} team (or that function is its own department).`;
}

export type HeadAssignment =
  | { ok: true; departmentId: string; headDivision?: HeadDivision; additionalAccess: { departmentId: string; division: HeadDivision }[] }
  | { ok: false; error: string };

export function buildHeadAssignment(input: { fn: HeadFunction | ''; selectedIds: string[]; departments: AssignableDepartment[]; teams: AssignableTeam[] }): HeadAssignment {
  const { fn, selectedIds, departments, teams } = input;
  if (!fn) return { ok: false, error: 'Choose whether this is a Sales head, a Support head, or one person for both.' };
  const chosen = selectedIds.map(id => departments.find(d => d.id === id)).filter((d): d is AssignableDepartment => !!d);
  if (chosen.length === 0) return { ok: false, error: 'Select at least one department.' };
  const offer = offers(departments, teams);
  for (const d of chosen) {
    const problem = whyNot(d, offer.get(d.id), fn);
    if (problem) return { ok: false, error: problem };
  }
  const home = chosen[0];
  const homeBase = home.facetOf ?? home.id;
  const pairs = new Map<string, { departmentId: string; division: HeadDivision }>();
  const add = (departmentId: string, division: HeadDivision) => pairs.set(`${departmentId}:${division}`, { departmentId, division });
  if (fn === 'BOTH') {
    // no side: the whole department of the home; the grants give the Sales | Support selector in every chosen department
    for (const d of chosen) {
      const o = offer.get(d.id)!;
      if (o.sales) add(d.id, 'SALES');
      if (o.support) add(d.id, 'SUPPORT');
    }
    return { ok: true, departmentId: homeBase, additionalAccess: [...pairs.values()] };
  }
  for (const d of chosen.slice(1)) add(d.id, fn);
  // the home pair is implicit (department + side), so it is never listed twice
  const extras = [...pairs.values()].filter(p => (departments.find(d => d.id === p.departmentId)?.facetOf ?? p.departmentId) !== homeBase || p.division !== fn);
  return { ok: true, departmentId: homeBase, headDivision: fn, additionalAccess: extras };
}

import type { DepartmentAccessInfo, HeadDivision } from '../../../shared/contracts';

/**
 * The Access Control tab's matrix (department x Sales / Support) as plain data: which cells exist, which one is the head's own placement
 * (always on, cannot be unticked), what is ticked now, and what Save sends. The database is the authority: it re-validates every pair.
 */
export const DIVISIONS: HeadDivision[] = ['SALES', 'SUPPORT'];
export const cellKey = (departmentId: string, division: HeadDivision) => `${departmentId}:${division}`;

type Dept = DepartmentAccessInfo['departments'][number];

/** The head's own placement: their home department and side. A head with no side has no locked cell (the whole department is theirs; ticks add the selector). */
export function lockedCell(info: DepartmentAccessInfo): string | null {
  return info.homeDepartmentId && info.headDivision ? cellKey(info.homeDepartmentId, info.headDivision) : null;
}

/** What is ticked when the head is opened: the saved grants plus the locked home cell. */
export function savedSet(info: DepartmentAccessInfo): Set<string> {
  const s = new Set(info.grants.map(g => cellKey(g.departmentId, g.division)));
  const locked = lockedCell(info);
  if (locked) s.add(locked);
  return s;
}

export function cellAvailable(dep: Dept, division: HeadDivision): boolean {
  return division === 'SALES' ? dep.hasSales : dep.hasSupport;
}

/** Why a cell cannot be ticked (null = it can). */
export function cellReason(dep: Dept, division: HeadDivision): string | null {
  if (cellAvailable(dep, division)) return null;
  const other = division === 'SUPPORT' ? dep.supportDepartment : dep.salesDepartment;
  if (other) return `${division === 'SUPPORT' ? 'Support' : 'Sales'} of ${dep.name} is ${other} - tick it there`;
  return `${dep.name} has no ${division === 'SUPPORT' ? 'Support' : 'Sales'} team`;
}

/**
 * Is this department another department than the head's own? The other function of the head's own department (Sales / Support, with a Support
 * side such as Wabatalk counting as part of D Talk) is not. Another DEPARTMENT is for an Operations Head only (the database enforces it too).
 */
export function isOtherDepartment(info: DepartmentAccessInfo, dep: Dept): boolean {
  const home = info.departments.find(d => d.id === info.homeDepartmentId);
  if (!home || dep.id === home.id) return false;
  const same = [home.supportDepartment, home.salesDepartment].includes(dep.name) || [dep.supportDepartment, dep.salesDepartment].includes(home.name);
  return !same;
}

export const SEVERAL_DEPARTMENTS_REASON = 'A Department Head works in one department. Make this person an Operations Head to give other departments.';

/** What Save sends: every ticked cell except the locked home cell (the database keeps the placement itself). */
export function pairsToSave(draft: Set<string>, info: DepartmentAccessInfo): { departmentId: string; division: HeadDivision }[] {
  const locked = lockedCell(info);
  return [...draft]
    .filter(k => k !== locked)
    .map(k => {
      const [departmentId, division] = k.split(':');
      return { departmentId, division: division as HeadDivision };
    });
}

export function isDirty(draft: Set<string>, saved: Set<string>): boolean {
  if (draft.size !== saved.size) return true;
  for (const k of draft) if (!saved.has(k)) return true;
  return false;
}

/** A readable summary of what is ticked: "Whatsbox (Sales, home), Wabatalk (Support)". */
export function summary(draft: Set<string>, info: DepartmentAccessInfo): string[] {
  return info.departments
    .map(d => {
      const fns = DIVISIONS.filter(f => draft.has(cellKey(d.id, f))).map(f => (f === 'SALES' ? 'Sales' : 'Support'));
      return fns.length ? `${d.name} (${fns.join(' + ')}${d.id === info.homeDepartmentId ? ', home' : ''})` : null;
    })
    .filter((x): x is string => !!x);
}

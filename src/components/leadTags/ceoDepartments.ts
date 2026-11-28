import type { DepartmentScopeDepartment } from '../../../shared/contracts';

/**
 * The departments a CEO may give a lead tag to: the scopes where they run Sales (the whole department, or the Sales function). A Support-only scope
 * is left out (the database would refuse it). The tags' departmentIds are base department ids, so the picker uses the scope's dataDepartmentId
 * (for the Wabatalk facet that is D Talk), once per department.
 */
export function ceoLeadTagDepartments(scopes: DepartmentScopeDepartment[] | null | undefined): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const s of scopes ?? []) {
    if (!(s.wholeDepartment || s.divisions.includes('SALES')) || seen.has(s.dataDepartmentId)) continue;
    seen.add(s.dataDepartmentId);
    out.push({ id: s.dataDepartmentId, name: s.name });
  }
  return out;
}

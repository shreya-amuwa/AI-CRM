import { PREVIEW_DEPARTMENTS } from '../../../shared/dashboardExplorer';
import type { Department, Role, Team, TeamDivision } from '../../../shared/contracts';
import { DEMO_ME_ID, demoDepartmentId, demoTeamId, type PreviewIdentity } from '../runtime/previewIdentity';

/**
 * The demonstration organisation: departments, teams and SYNTHETIC people. No name, phone, e-mail or figure here belongs to a real employee
 * or customer; e-mail addresses use the reserved example.invalid domain. The same seed always gives the same people (deterministic).
 */
export interface DemoPerson {
  id: string;
  fullName: string;
  role: Exclude<Role, 'SUPER_ADMIN'>;
  departmentSlug: string;
  division: TeamDivision | null;
  teamId: string | null;
  position: string;
  email: string;
  phone: string;
  managerId: string | null;
}

const FIRST = ['Riya', 'Arjun', 'Neha', 'Kabir', 'Isha', 'Vikram', 'Ananya', 'Rohan', 'Meera', 'Aditya', 'Sana', 'Dev', 'Priya', 'Nikhil', 'Tara', 'Yash', 'Kavya', 'Imran', 'Pooja', 'Siddharth'];
const LAST = ['Sharma', 'Iyer', 'Menon', 'Kulkarni', 'Reddy', 'Bose', 'Nair', 'Gupta', 'Joshi', 'Pillai', 'Khan', 'Das', 'Rao', 'Mehta', 'Verma'];
export const pick = <T,>(list: readonly T[], i: number): T => list[((i % list.length) + list.length) % list.length];
export const personName = (i: number) => `${pick(FIRST, i)} ${pick(LAST, i * 7 + 3)}`;
const pid = (n: number) => `d3000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export function demoDepartments(): Department[] {
  return PREVIEW_DEPARTMENTS.map((d, i) => ({
    id: demoDepartmentId(d.slug), slug: d.slug, name: d.name, description: `${d.name} (demonstration)`, category: null, iconName: 'Building2',
    accentColor: ['#2563eb', '#0f766e', '#7c3aed', '#b45309', '#be123c'][i % 5], logoUrl: null, isLocked: false, facetOf: null, facetDivision: null,
    unifiedSalesSupport: !!d.unified, createdAt: '2026-01-01T04:30:00.000Z'
  }));
}

export function demoTeams(): Team[] {
  const out: Team[] = [];
  for (const d of PREVIEW_DEPARTMENTS) {
    const divisions: TeamDivision[] = d.unified || ['hr', 'accounts', 'ai-studio', 'ai-design-studio'].includes(d.slug) ? ['GENERAL'] : ['SALES', 'SUPPORT', 'GENERAL'];
    for (const division of divisions) {
      out.push({ id: demoTeamId(d.slug, division), name: division === 'GENERAL' ? d.name : `${d.name} ${division === 'SALES' ? 'Sales' : 'Support'}`,
                 division, departmentId: demoDepartmentId(d.slug), createdAt: '2026-01-01T04:30:00.000Z' });
    }
  }
  return out;
}

/**
 * The people of the previewed department: its Department Head, a Team Lead and four Team Members per team. The preview identity takes the
 * place of the matching position (the synthetic "me"), so the team around it is consistent.
 */
export function demoPeople(identity: PreviewIdentity): DemoPerson[] {
  const slug = identity.department.slug;
  const me = identity.profile;
  const teams = demoTeams().filter(t => t.departmentId === demoDepartmentId(slug));
  const people: DemoPerson[] = [];
  let n = 1;
  const add = (p: Omit<DemoPerson, 'id' | 'email' | 'phone'> & { id?: string }) => {
    const i = n++;
    const id = p.id ?? pid(i);
    people.push({ ...p, id, email: `${p.fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.invalid`, phone: `+91 90000 ${String(10000 + i).slice(-5)}` });
    return id;
  };
  const headId = me.role === 'DEPARTMENT_HEAD'
    ? add({ id: DEMO_ME_ID, fullName: me.fullName, role: 'DEPARTMENT_HEAD', departmentSlug: slug, division: null, teamId: null, position: me.position ?? 'Department Head', managerId: null })
    : add({ fullName: personName(0), role: 'DEPARTMENT_HEAD', departmentSlug: slug, division: null, teamId: null, position: 'Department Head', managerId: null });
  teams.forEach((t, ti) => {
    const mine = me.teamId === t.id;
    const leadId = mine && me.role === 'TEAM_HEAD'
      ? add({ id: DEMO_ME_ID, fullName: me.fullName, role: 'TEAM_HEAD', departmentSlug: slug, division: t.division, teamId: t.id, position: me.position ?? 'Team Lead', managerId: headId })
      : add({ fullName: personName(ti * 5 + 1), role: 'TEAM_HEAD', departmentSlug: slug, division: t.division, teamId: t.id, position: 'Team Lead', managerId: headId });
    for (let k = 0; k < 4; k++) {
      if (mine && me.role === 'TEAM_MEMBER' && k === 0) {
        add({ id: DEMO_ME_ID, fullName: me.fullName, role: 'TEAM_MEMBER', departmentSlug: slug, division: t.division, teamId: t.id, position: me.position ?? 'Team Member', managerId: leadId });
      } else {
        add({ fullName: personName(ti * 5 + k + 2), role: 'TEAM_MEMBER', departmentSlug: slug, division: t.division, teamId: t.id, position: 'Team Member', managerId: leadId });
      }
    }
  });
  return people;
}

/** A row as the `profiles` table returns it (snake_case), for the pages that read it directly. */
export function profileRow(p: DemoPerson) {
  return {
    id: p.id, full_name: p.fullName, email: p.email, phone: p.phone, role: p.role, status: 'ACTIVE', position: p.position, avatar_url: null,
    department_id: demoDepartmentId(p.departmentSlug), team_id: p.teamId, manager_id: p.managerId, created_at: '2026-01-05T04:30:00.000Z'
  };
}

/** Dates relative to today, so the demonstration always looks current (yesterday's follow-up, next week's renewal ...). */
export const daysFromNow = (d: number, hour = 10) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(hour, 0, 0, 0);
  return t.toISOString();
};
export const dateOnly = (d: number) => daysFromNow(d).slice(0, 10);

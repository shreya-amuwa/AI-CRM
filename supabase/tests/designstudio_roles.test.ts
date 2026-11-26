/**
 * Amuwa Design Studio roles (no database): what the Add Team Member form and the HR employee request form offer for each department.
 * The database refuses the same combinations (private.designstudio_role_problem, migration 20270112000100). Run: npm run test:unit
 */
import { AI_DESIGN_STUDIO_SLUG, AMUWA_DESIGN_STUDIO_SLUG } from '../../shared/contracts.js';
import { DESIGNATIONS, EMPLOYEE_REQUEST_ROLES } from '../../shared/validation.js';
import { designationsForDepartment, hasNoSalesSupport, requestSidesForDepartment, staffChoicesForDepartment, staffTeamsForDepartment } from '../../src/lib/auth/departmentRoles.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// every choice the Super Admin's form can hold (the generic roles plus the Support / cross-department ones)
const all = ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER', 'META_VERIFIER', 'TECHNICAL_CONSULTANT', 'OPERATIONS_HEAD'] as const;
const teams = [
  { id: 'g', division: 'GENERAL' as const }, { id: 's', division: 'SALES' as const }, { id: 'p', division: 'SUPPORT' as const }
];

check(AI_DESIGN_STUDIO_SLUG === 'ai-design-studio' && hasNoSalesSupport(AI_DESIGN_STUDIO_SLUG), 'AI Design Studio (slug ai-design-studio) has no Sales or Support');
check(AMUWA_DESIGN_STUDIO_SLUG === 'designstudio' && hasNoSalesSupport('designstudio'),
  'Amuwa Design Studio (slug designstudio) has none either, and is an active department (nothing in the helpers marks any department retired)');
check(!hasNoSalesSupport('wabastore') && !hasNoSalesSupport('ai-studio') && !hasNoSalesSupport('') && !hasNoSalesSupport(null) && !hasNoSalesSupport(undefined),
  'other departments (AI Studio included) are unchanged');
check(staffChoicesForDepartment(AI_DESIGN_STUDIO_SLUG, all).join() === 'DEPARTMENT_HEAD,TEAM_HEAD,TEAM_MEMBER', 'AI Design Studio (ai-design-studio): only Department Head, Team Lead, Team Member');
check(requestSidesForDepartment(AI_DESIGN_STUDIO_SLUG).join() === 'GENERAL', 'AI Design Studio (ai-design-studio): General side only');

check(staffChoicesForDepartment('designstudio', all).join() === 'DEPARTMENT_HEAD,TEAM_HEAD,TEAM_MEMBER', 'Amuwa Design Studio: only Department Head, Team Lead, Team Member', staffChoicesForDepartment('designstudio', all));
check(staffChoicesForDepartment('wabastore', all).join() === all.join(), 'Wabastore keeps every choice, in the same order');
check(staffChoicesForDepartment('designstudio', ['TEAM_MEMBER'] as const).join() === 'TEAM_MEMBER', 'a Team Lead creating there still has Team Member only');
check(staffChoicesForDepartment('designstudio', EMPLOYEE_REQUEST_ROLES).join() === 'DEPARTMENT_HEAD,TEAM_HEAD,TEAM_MEMBER', 'an HR request for Amuwa Design Studio: the same three roles');

check(staffTeamsForDepartment('designstudio', teams).map(t => t.id).join() === 'g', 'Amuwa Design Studio: its General team only (no Sales / Support team)');
check(staffTeamsForDepartment('wabastore', teams).map(t => t.id).join() === 'g,s,p', 'another department keeps its Sales and Support teams');
check(staffTeamsForDepartment('designstudio', teams.filter(t => t.division !== 'GENERAL')).length === 0, 'Sales / Support teams alone leave nothing to choose');

check(requestSidesForDepartment('designstudio').join() === 'GENERAL', 'an HR request for Amuwa Design Studio offers the General side only');
check(requestSidesForDepartment('whatsbox').join() === 'SALES,SUPPORT,GENERAL', 'another department offers Sales, Support and General');

const plain = DESIGNATIONS.filter(d => !d.startsWith('HR '));
check(designationsForDepartment('designstudio', plain).join() === 'Department Head,Team Lead,Team Member', 'Amuwa Design Studio designations: Department Head, Team Lead, Team Member');
check(designationsForDepartment('dtalk', plain).join() === plain.join(), 'another department keeps every designation');

console.log(`=== ${passed} AMUWA DESIGN STUDIO ROLE CHECKS PASSED ===`);

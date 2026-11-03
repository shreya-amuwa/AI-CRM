/**
 * HR designations (no database): the shared rule the forms and the server use (the database holds the same rule in private.designation_problem), and the
 * employee request schema. Run: npm run test:unit
 */
import { HR_DESIGNATIONS, HR_DESIGNATION_ROLE, designationProblem, employeeRequestSchema, userCreateSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

check(HR_DESIGNATIONS.join('|') === 'HR Assistant|HR Recruiter|HR Admin Head', 'the HR department has exactly the three designations, in this order');
check(HR_DESIGNATION_ROLE['HR Assistant'] === 'TEAM_MEMBER' && HR_DESIGNATION_ROLE['HR Recruiter'] === 'TEAM_MEMBER' && HR_DESIGNATION_ROLE['HR Admin Head'] === 'DEPARTMENT_HEAD', 'they map to the existing roles: two Team Members and the Department Head (no new role)');

const ok = (a: Parameters<typeof designationProblem>[0], label: string) => check(designationProblem(a) === null, label, designationProblem(a));
const bad = (a: Parameters<typeof designationProblem>[0], label: string) => check(designationProblem(a) !== null, label);
ok({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: 'HR Assistant' }, 'HR Assistant is a Team Member of HR');
ok({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: 'HR Recruiter' }, 'HR Recruiter is a Team Member of HR');
ok({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'HR Admin Head' }, 'HR Admin Head is the Department Head of HR');
bad({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: 'Team Member' }, 'a generic Team Member is refused in HR');
bad({ departmentSlug: 'hr', role: 'TEAM_HEAD', designation: 'Team Lead' }, 'a Team Lead is refused in HR');
bad({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'Department Head' }, 'a generic Department Head is refused in HR');
bad({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'Operations Head' }, 'an Operations Head designation is refused in HR');
bad({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: undefined }, 'an HR employee needs a designation');
bad({ departmentSlug: 'hr', role: 'TEAM_HEAD', designation: 'HR Assistant' }, 'HR Assistant does not fit a Team Lead');
bad({ departmentSlug: 'hr', role: 'TEAM_MEMBER', designation: 'HR Admin Head' }, 'HR Admin Head does not fit a Team Member');
bad({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'HR Recruiter' }, 'HR Recruiter does not fit a Department Head');
bad({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'HR Admin Head', operationsHead: true }, 'an Operations Head is never the HR Admin Head');
bad({ departmentSlug: 'wabastore', role: 'TEAM_MEMBER', designation: 'HR Recruiter' }, 'an HR designation is refused in another department');
bad({ departmentSlug: undefined, role: 'DEPARTMENT_HEAD', designation: 'HR Admin Head' }, 'and when the department is not HR');
ok({ departmentSlug: 'wabastore', role: 'TEAM_MEMBER', designation: 'Team Member' }, 'other departments keep Team Member');
ok({ departmentSlug: 'wabastore', role: 'TEAM_HEAD', designation: 'Team Lead' }, 'and Team Lead');
ok({ departmentSlug: 'wabastore', role: 'DEPARTMENT_HEAD', designation: 'Department Head' }, 'and Department Head');
ok({ departmentSlug: 'hr', role: 'DEPARTMENT_HEAD', designation: 'Operations Head', operationsHead: true }, 'an Operations Head homed in HR keeps its own designation');

const base = { email: 'new@example.com', fullName: 'New Person', departmentId: '11111111-1111-4111-8111-111111111111', details: { joiningDate: '2026-11-03', dateOfBirth: '1995-05-05', bloodGroup: 'O+', contactNumber: '+91 98765 43210', emergencyContact: '+91 98765 43211' } };
const withDesignation = (role: string, designation: string) => ({ ...base, role, details: { ...base.details, designation } });
check(employeeRequestSchema.safeParse(withDesignation('TEAM_MEMBER', 'HR Recruiter')).success, 'a request: HR Recruiter with the Team Member role');
check(employeeRequestSchema.safeParse(withDesignation('DEPARTMENT_HEAD', 'HR Admin Head')).success, 'a request: HR Admin Head with the Department Head role');
check(!employeeRequestSchema.safeParse(withDesignation('TEAM_MEMBER', 'HR Admin Head')).success, 'a request: HR Admin Head with the Team Member role is refused');
check(!employeeRequestSchema.safeParse(withDesignation('TEAM_HEAD', 'HR Assistant')).success, 'a request: HR Assistant with the Team Lead role is refused');
check(!employeeRequestSchema.safeParse(withDesignation('DEPARTMENT_HEAD', 'HR Recruiter')).success, 'a request: HR Recruiter with the Department Head role is refused');
check(employeeRequestSchema.safeParse(withDesignation('TEAM_HEAD', 'Team Lead')).success && employeeRequestSchema.safeParse(withDesignation('DEPARTMENT_HEAD', 'Department Head')).success, 'a request: the generic pairs still validate (the database checks them against the department)');
check(userCreateSchema.safeParse({ email: 'a@example.com', fullName: 'A', role: 'DEPARTMENT_HEAD', departmentId: base.departmentId, details: { ...base.details, designation: 'HR Admin Head' } }).success, 'Add Member: HR Admin Head is a valid designation value');
check(!userCreateSchema.safeParse({ email: 'a@example.com', fullName: 'A', role: 'TEAM_MEMBER', teamId: base.departmentId, details: { ...base.details, designation: 'HR Boss' } }).success, 'Add Member: an unknown designation is refused');

console.log(`=== ${passed} checks passed ===`);

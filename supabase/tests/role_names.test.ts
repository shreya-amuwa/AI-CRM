// The new designations (shared/roleNames.ts): Super Admin -> Managing Director, Operations Head -> CEO. The internal "CEO" wording of the
// database (the CEO-meeting features) is the Super Admin, so it becomes Managing Director; one pass, so nothing is renamed twice.
import { designationLabel, relabelRoles, ROLE_DISPLAY_NAMES } from '../../shared/roleNames';
let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++; console.log('ok -', name);
};
const eq = (a: string | null | undefined, b: string, name: string) => check(a === b, name, a);

check(ROLE_DISPLAY_NAMES.SUPER_ADMIN === 'Managing Director' && ROLE_DISPLAY_NAMES.OPERATIONS_HEAD === 'CEO', 'the two designations');
eq(relabelRoles('Only the Super Admin can do this.'), 'Only the Managing Director can do this.', 'Super Admin -> Managing Director');
eq(relabelRoles('Waiting for the Operations Head'), 'Waiting for the CEO', 'Operations Head -> CEO');
eq(relabelRoles('Two Operations Heads and the Super Admins'), 'Two CEOs and the Managing Directors', 'plurals');
eq(relabelRoles('Request for the CEO\'s time'), "Request for the Managing Director's time", 'the internal CEO (the Super Admin) -> Managing Director');
eq(relabelRoles('Only the CEO (Super Admin) decides.'), 'Only the Managing Director decides.', 'no "Managing Director (Managing Director)"');
eq(relabelRoles('The Operations Head asked the CEO'), 'The CEO asked the Managing Director', 'one pass: the new CEO is never renamed again');
eq(relabelRoles('CEO_MEETING and SUPER_ADMIN stay'), 'CEO_MEETING and SUPER_ADMIN stay', 'keys and identifiers are untouched');
eq(relabelRoles('Submitted to Superadmin'), 'Submitted to Managing Director', 'the one-word spelling');
check(relabelRoles(null) === null && relabelRoles('') === '' && relabelRoles(undefined) === undefined, 'empty values pass through');
eq(designationLabel('Operations Head'), 'CEO', 'a stored designation is shown with the new name');
eq(designationLabel('Chief Executive (CEO)'), 'Chief Executive (CEO)', 'a typed designation is shown as written');
console.log(`=== ${passed} ROLE NAME CHECKS PASSED ===`);

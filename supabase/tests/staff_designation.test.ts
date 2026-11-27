/**
 * The designation of a new team member (no database). The validation is unchanged and still enforced: nothing chosen, or a value no option has
 * (the on-screen label "CEO" instead of the stored 'Operations Head'), gets "Choose a designation."; every stored designation is accepted. The Add
 * Team Member form keeps the stored value for the CEO role and only ever holds a value its dropdown offers (the browser check is
 * supabase/tests/e2e/staff-designation.e2e.mjs).
 */
import { readFileSync } from 'node:fs';
import { DESIGNATIONS, memberDetailsSchema } from '../../shared/validation.js';
import { designationLabel } from '../../shared/roleNames.js';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log('ok -', name);
};
const base = { joiningDate: '2025-01-10', dateOfBirth: '1990-05-05', bloodGroup: 'A+', contactNumber: '+91 98111 22222', emergencyContact: '+91 98765 43210' };
const message = (designation: unknown) => {
  const r = memberDetailsSchema.safeParse({ ...base, designation });
  return r.success ? null : r.error.issues.find(i => i.path[0] === 'designation')?.message ?? null;
};

for (const d of DESIGNATIONS) check(message(d) === null, `the designation "${d}" (shown as "${designationLabel(d)}") is accepted`);
check(designationLabel('Operations Head') === 'CEO', 'the stored Operations Head designation is shown as CEO');
check(message('') === 'Choose a designation.', 'nothing chosen: "Choose a designation."');
check(message(undefined) === 'Choose a designation.', 'no designation sent: "Choose a designation."');
check(message('CEO') === 'Choose a designation.', 'the label "CEO" is not a stored value and is still refused (the validation is not bypassed)');

const form = readFileSync('src/components/common/StaffManagementPanel.tsx', 'utf8');
check(/operationsHead \? 'Operations Head'/.test(form) && !/operationsHead \? OPERATIONS_HEAD_LABEL : role === 'DEPARTMENT_HEAD'/.test(form),
  'the CEO role starts with the stored designation, not its on-screen label');
check(/!designationOptions\.includes\(designation\)\) setDesignation\(roleDesignation\)/.test(form) && /designationOptions\.map\(d => <option key=\{d\} value=\{d\}>/.test(form),
  'the form never holds a designation its dropdown does not offer (what is shown is what is sent)');

console.log(`\n${passed} checks passed`);

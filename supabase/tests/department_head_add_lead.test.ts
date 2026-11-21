/** Add lead (Team Lead and Department Head share one endpoint): what the browser may send. Department, team, role and user ids are never part of it (no database). */
import { leadCreateRequestSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const owner = '00000000-0000-4000-8000-0000000000a1';
const base = { name: 'Dhruv Mehta', company: 'Dhruv Traders', phone: '9876501234', leadSource: 'Referral', services: ['AI_CALLING'] };

check(leadCreateRequestSchema.safeParse(base).success, 'the Team Lead\'s request (no owner) is valid');
check(leadCreateRequestSchema.safeParse({ ...base, ownerId: owner }).success, 'the Department Head\'s request names an owner and is valid');
check(leadCreateRequestSchema.safeParse({ ...base, ownerId: owner, clientRequestId: '5e5e5e5e-0000-4000-8000-000000000001' }).success, 'a request id (one per form, so a retry makes no second lead) is accepted');
for (const k of ['departmentId', 'department_id', 'department', 'teamId', 'role', 'userId', 'createdBy', 'lifecycleStage']) {
  check(!leadCreateRequestSchema.safeParse({ ...base, ownerId: owner, [k]: '00000000-0000-4000-8000-0000000000b1' }).success, `a "${k}" in the request is refused (the schema is strict)`);
}
check(!leadCreateRequestSchema.safeParse({ ...base, ownerId: 'not-a-uuid' }).success, 'the owner must be an id');
check(!leadCreateRequestSchema.safeParse({ ...base, services: [] }).success, 'at least one service is required (the existing rule)');
check(!leadCreateRequestSchema.safeParse({ ...base, name: '' }).success && !leadCreateRequestSchema.safeParse({ ...base, phone: '123' }).success, 'the existing name and mobile rules still apply');
console.log(`=== ${passed} ADD LEAD REQUEST CHECKS PASSED ===`);

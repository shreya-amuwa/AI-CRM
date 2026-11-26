// HR Awards (migration 20270203000100): the shared schemas the Add Nominee / Declare Winner forms and the server both use. The database checks
// who may (HR staff and the Super Admin), the award's nominee type, duplicates and the month range again; these only check the shape.
import {
  HR_AWARD_CODES, awardCodeSchema, awardDeclareWinnersSchema, awardMonthQuerySchema, awardNominateSchema, awardNomineeRemoveSchema,
  awardNomineeUpdateSchema, awardWinnerRevokeSchema, awardWinnerUpdateSchema
} from '../../shared/validation.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const id = '11111111-1111-4111-8111-111111111111';
const base = { month: '2026-11', nomineeType: 'INDIVIDUAL', entityId: id, reason: 'Closed the most tickets' };

check(HR_AWARD_CODES.length === 7 && awardCodeSchema.safeParse('RISING_STAR').success && !awardCodeSchema.safeParse('rising_star').success
  && !awardCodeSchema.safeParse('NOPE').success, 'the seven award codes, nothing else');
const ok = awardNominateSchema.safeParse(base);
check(ok.success && ok.data.remarks === null, 'a nomination: month, type, who, reason (remarks optional, empty becomes null)');
check(awardNominateSchema.safeParse({ ...base, remarks: '  Great attitude ' }).success
  && awardNominateSchema.parse({ ...base, remarks: '  Great attitude ' }).remarks === 'Great attitude', 'remarks are trimmed');
check(!awardNominateSchema.safeParse({ ...base, month: '2026-13' }).success && !awardNominateSchema.safeParse({ ...base, month: 'November 2026' }).success
  && !awardNominateSchema.safeParse({ ...base, month: '2019-12' }).success, 'the month is YYYY-MM from 2020');
check(!awardNominateSchema.safeParse({ ...base, nomineeType: 'PERSON' }).success && awardNominateSchema.safeParse({ ...base, nomineeType: 'TEAM' }).success
  && awardNominateSchema.safeParse({ ...base, nomineeType: 'DEPARTMENT' }).success, 'Individual / Team / Department');
const noWho = awardNominateSchema.safeParse({ ...base, entityId: '' });
check(!noWho.success && noWho.error.issues[0].message === 'Choose who is nominated.', 'the nominee is chosen from the CRM (an id), never typed');
check(!awardNominateSchema.safeParse({ ...base, reason: 'ok' }).success && !awardNominateSchema.safeParse({ ...base, reason: 'x'.repeat(2001) }).success,
  'the reason: 3 to 2000 characters');
check(!awardNominateSchema.safeParse({ ...base, name: 'Typed Name' }).success && !awardNominateSchema.safeParse({ ...base, createdBy: id }).success,
  'the browser cannot send a name or who nominated');
check(awardNomineeUpdateSchema.safeParse({ reason: 'New reason' }).success && !awardNomineeUpdateSchema.safeParse({ reason: 'New reason', entityId: id }).success,
  'an edit changes the reason and remarks only');
check(awardNomineeRemoveSchema.safeParse({}).success && awardNomineeRemoveSchema.safeParse({ reason: 'Duplicate' }).success, 'removing: the reason is optional');
check(awardDeclareWinnersSchema.safeParse({ nomineeIds: [id] }).success && awardDeclareWinnersSchema.safeParse({ nomineeIds: [id, '22222222-2222-4222-8222-222222222222'] }).success,
  'one winner or several');
check(!awardDeclareWinnersSchema.safeParse({ nomineeIds: [] }).success && !awardDeclareWinnersSchema.safeParse({ nomineeIds: ['x'] }).success
  && !awardDeclareWinnersSchema.safeParse({ nomineeIds: Array(201).fill(id) }).success, 'at least one valid nominee, at most 200');
check(awardWinnerUpdateSchema.safeParse({ remarks: '' }).success && awardWinnerUpdateSchema.parse({ remarks: '' }).remarks === null, 'winner remarks can be cleared');
check(!awardWinnerRevokeSchema.safeParse({ reason: '' }).success && awardWinnerRevokeSchema.safeParse({ reason: 'Declared by mistake' }).success, 'revoking needs a reason');
check(awardMonthQuerySchema.safeParse({ month: '2026-10' }).success && !awardMonthQuerySchema.safeParse({}).success, 'reading needs the month');
console.log(`=== ${passed} HR AWARDS SCHEMA CHECKS PASSED ===`);

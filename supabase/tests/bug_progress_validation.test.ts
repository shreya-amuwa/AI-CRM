// The rules of "Add Progress Update" on a bug (20270312000100) as the screen and the API check them before the database checks them again:
// what was worked on is required, status and progress are optional, progress is 0-100, a resolved bug is 100% done and needs the resolution
// text, and the person who made the update is never part of the request (the database takes it from the login).
import { DEV_BUG_STATUSES, bugListQuerySchema, bugProgressUpdateSchema } from '../../shared/validation.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
const ID = '11111111-1111-4111-8111-111111111111';
const upd = (o: Record<string, unknown> = {}) => bugProgressUpdateSchema.safeParse({ work: 'Re-attached the click handler', ...o });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? '' : r.error!.issues.map(i => i.message).join(' | '));

check(upd().success, 'what was worked on alone is a valid update (status and progress stay as they are)');
check(upd({ status: 'IN_PROGRESS', progress: 40, notes: 'Needs a second look', expectedVersion: 3, clientRequestId: 'form-0001-abcd' }).success, 'a complete update is valid');
check(!bugProgressUpdateSchema.safeParse({}).success && /what you worked on/i.test(msg(upd({ work: '' }))), 'what was worked on is required');
check(!upd({ work: 'ab' }).success, 'and has at least 3 characters');
check(!upd({ work: 'x'.repeat(3001) }).success && upd({ work: 'x'.repeat(3000) }).success, 'at most 3000 characters');
check(upd({ progress: 0 }).success && upd({ progress: 100 }).success && upd({ progress: '55' }).data?.progress === 55, 'progress 0 to 100 (a number typed in a form arrives as text)');
check(!upd({ progress: 101 }).success && !upd({ progress: -1 }).success && !upd({ progress: 12.5 }).success, 'progress over 100, below 0 or with decimals is refused');
check(/percentage from 0 to 100/.test(msg(upd({ progress: 150 }))), 'with a clear message');
check(['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED'].every(s => (DEV_BUG_STATUSES as readonly string[]).includes(s)), 'the status list has the existing statuses and Testing');
check(DEV_BUG_STATUSES.every(s => s === 'RESOLVED' || s === 'REJECTED' || upd({ status: s }).success), 'every status but resolved / rejected is valid on its own');
check(!upd({ status: 'DONE' }).success && !upd({ status: 'open' }).success, 'a status that does not exist is refused');
check(upd({ status: 'RESOLVED', progress: 100, notes: 'Added the missing index.' }).success, 'a resolved bug at 100% with a resolution note is valid');
check(/100% done/.test(msg(upd({ status: 'RESOLVED', progress: 60, notes: 'Added the missing index.' }))), 'a resolved bug cannot be 60% done');
check(!upd({ status: 'RESOLVED', work: 'Fixed', notes: 'ok' }).success && /resolution note/.test(msg(upd({ status: 'RESOLVED', work: 'Fixed', notes: 'ok' }))), 'resolving needs at least 5 characters of resolution text');
check(upd({ status: 'RESOLVED', work: 'Added the missing index' }).success, 'what was worked on counts as the resolution text when there are no notes');
check(!upd({ status: 'REJECTED', work: 'Nope' }).success && upd({ status: 'REJECTED', work: 'Works as designed' }).success, 'rejecting needs the reason too');
check(!upd({ expectedVersion: 0 }).success && !upd({ expectedVersion: 1.5 }).success && upd({ expectedVersion: 7 }).success, 'the expected version is a whole number from 1');
check(!upd({ clientRequestId: 'short' }).success && !upd({ clientRequestId: 'x'.repeat(81) }).success, 'the request id has 8 to 80 characters');
check(!upd({ userId: ID }).success && !upd({ by: 'someone' }).success && !upd({ actorId: ID }).success && !upd({ assigneeId: ID }).success, 'the person making the update is never taken from the request');
check(bugListQuerySchema.safeParse({ assignee: 'CONTRIBUTED' }).success && bugListQuerySchema.safeParse({ status: 'TESTING' }).success && !bugListQuerySchema.safeParse({ assignee: 'EVERYONE' }).success,
  'the list can be filtered by "I worked on" and by Testing');

console.log(`${passed} bug progress validation checks passed`);

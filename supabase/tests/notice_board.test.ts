// Company Notice Board (migration 20270131000200): the shared schemas the Send Notice form and the server both use. The database checks who
// may publish and to whom; these only check the shape (an audience needs its departments / designations / employees, the expiry after the
// publish date, never more than 5 files, the browser never names the publisher's role).
import { NOTICE_CATEGORIES, NOTICE_CATEGORY_LABELS, noticeListQuerySchema, noticePublishSchema, noticeUpdateSchema } from '../../shared/validation.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const id = '11111111-1111-4111-8111-111111111111';
const base = { title: 'Office closed Friday', body: 'The office is closed on Friday.', category: 'HOLIDAY', audienceType: 'COMPANY', clientRequestId: 'nb-key-0001' };

const ok = noticePublishSchema.safeParse(base);
check(ok.success && ok.data.priority === 'NORMAL' && ok.data.departmentIds.length === 0, 'the entire company: no lists needed; priority Normal by default');
check(!noticePublishSchema.safeParse({ ...base, audienceType: 'DEPARTMENT' }).success && noticePublishSchema.safeParse({ ...base, audienceType: 'DEPARTMENT', departmentIds: [id] }).success,
  'specific departments: at least one');
check(!noticePublishSchema.safeParse({ ...base, audienceType: 'ROLE' }).success && noticePublishSchema.safeParse({ ...base, audienceType: 'ROLE', roles: ['TEAM_HEAD'] }).success,
  'designations: at least one');
check(!noticePublishSchema.safeParse({ ...base, audienceType: 'ROLE', roles: ['CEO'] }).success, 'only the known designations');
check(!noticePublishSchema.safeParse({ ...base, audienceType: 'EMPLOYEES' }).success && noticePublishSchema.safeParse({ ...base, audienceType: 'EMPLOYEES', employeeIds: [id] }).success,
  'selected employees: at least one');
// Sales / Support (20270223000100): exactly one department; the ticked team members are optional (none = the whole function)
const id2 = '22222222-2222-4222-8222-222222222222';
for (const t of ['SALES', 'SUPPORT']) {
  check(!noticePublishSchema.safeParse({ ...base, audienceType: t }).success && !noticePublishSchema.safeParse({ ...base, audienceType: t, departmentIds: [id, id2] }).success
    && noticePublishSchema.safeParse({ ...base, audienceType: t, departmentIds: [id] }).success
    && noticePublishSchema.safeParse({ ...base, audienceType: t, departmentIds: [id], employeeIds: [id2] }).success, `${t.toLowerCase()}: one department, team members optional`);
}
check(!noticePublishSchema.safeParse({ ...base, priority: 'CRITICAL' }).success && noticePublishSchema.safeParse({ ...base, priority: 'URGENT' }).success, 'Normal / Important / Urgent');
check(!noticePublishSchema.safeParse({ ...base, title: 'Hi' }).success && !noticePublishSchema.safeParse({ ...base, body: '' }).success, 'a title and a description');
check(!noticePublishSchema.safeParse({ ...base, publishAt: '2026-12-01T10:00:00+05:30', expiresAt: '2026-11-30T10:00:00+05:30' }).success
  && noticePublishSchema.safeParse({ ...base, publishAt: '2026-12-01T10:00:00+05:30', expiresAt: '2026-12-02T10:00:00+05:30' }).success, 'the expiry is after the publish date');
check(!noticePublishSchema.safeParse({ ...base, attachmentIds: Array(6).fill(id) }).success, 'at most 5 files');
check(!noticePublishSchema.safeParse({ ...base, publisherRole: 'SUPER_ADMIN' }).success && !noticePublishSchema.safeParse({ ...base, publisherId: id }).success,
  'the browser never says who publishes or with which right');
check(noticeUpdateSchema.safeParse({ body: 'New text', version: 2 }).success && !noticeUpdateSchema.safeParse({ audienceType: 'COMPANY' }).success, 'an edit never changes the audience');
check(noticeListQuerySchema.safeParse({ scope: 'MINE', unread: 'true', category: 'HR' }).success && !noticeListQuerySchema.safeParse({ scope: 'EVERYTHING' }).success, 'the list: scopes and filters');
check(NOTICE_CATEGORIES.every(c => NOTICE_CATEGORY_LABELS[c]), 'every category has a label');
console.log(`=== NOTICE BOARD TESTS PASSED (${passed}) ===`);

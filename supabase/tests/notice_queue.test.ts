/**
 * The company-notice popup queue (src/components/notices/noticeQueue.ts, migration 20270202000100): the order (Urgent, Important, Normal; the oldest first inside a
 * priority), what can be put off, what is shown after the list changes, and the shared schemas of the new calls. The database rules are in notice_board_restricted_test.sql.
 */
import type { CompanyNotice, NoticePriority } from '../../shared/contracts.js';
import { noticeManagerSetSchema, noticeUpdateSchema } from '../../shared/validation.js';
import { canPostpone, indexAfterChange, sortQueue, visibleQueue } from '../../src/components/notices/noticeQueue.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
let n = 0;
const notice = (priority: NoticePriority, minutesAgo: number, id = `n${++n}`): CompanyNotice => ({
  id, reference: id, title: `T ${id}`, body: 'x', category: 'GENERAL', priority, status: 'PUBLISHED', expired: false,
  publishAt: new Date(Date.UTC(2030, 0, 1, 12, 0) - minutesAgo * 60000).toISOString(), expiresAt: null, releasedAt: null, updatedAt: '', version: 1, publisherId: 'p', publisherName: 'P', publisherRole: 'CRM_TEAM',
  audience: { type: 'COMPANY', departments: [], roles: [], employees: [], departmentNames: [] }, isRecipient: true, read: false, readAt: null, canManage: false, recipientCount: 0, readCount: 0,
  acknowledged: false, acknowledgedAt: null, acknowledgedCount: 0, attachments: []
});

const nOld = notice('NORMAL', 300, 'normal-old'), nNew = notice('NORMAL', 10, 'normal-new'), impOld = notice('IMPORTANT', 200, 'imp-old'), impNew = notice('IMPORTANT', 20, 'imp-new');
const urgOld = notice('URGENT', 100, 'urg-old'), urgNew = notice('URGENT', 5, 'urg-new');
const mixed = [nNew, impNew, urgNew, nOld, impOld, urgOld];
check(sortQueue(mixed).map(x => x.id).join() === ['urg-old', 'urg-new', 'imp-old', 'imp-new', 'normal-old', 'normal-new'].join(), 'Urgent first, then Important, then Normal; the oldest first inside a priority');
check(mixed[0].id === 'normal-new', 'sorting does not change the list it was given');
check(canPostpone(nOld) && canPostpone(impOld) && !canPostpone(urgOld), 'Normal and Important can be put off; Urgent cannot');
const later = new Set(['normal-old', 'urg-old']);
check(visibleQueue(mixed, later).map(x => x.id).join() === ['urg-old', 'urg-new', 'imp-old', 'imp-new', 'normal-new'].join(), 'a notice put off is not shown again this session, an Urgent one is');

const q1 = sortQueue(mixed);
const afterAck = q1.filter(x => x.id !== 'imp-old');
check(indexAfterChange(q1, 3, afterAck) === 2, 'after one is acknowledged the viewer moves on to the next one in line');
const arrived = sortQueue([...q1, notice('URGENT', 50, 'urg-mid')]);
check(arrived[indexAfterChange(q1, 3, arrived)].id === 'imp-new', 'a notice arriving while one is being read does not take the reader away from it');
check(indexAfterChange(q1, 5, q1.slice(0, 2)) === 1 && indexAfterChange([], 0, []) === 0, 'the index always stays inside the list');

check(noticeManagerSetSchema.safeParse({ enabled: true }).success && !noticeManagerSetSchema.safeParse({ enabled: 'yes' }).success && !noticeManagerSetSchema.safeParse({ enabled: true, profileId: 'x' }).success,
  'the manager call takes only enabled, true or false');
check(noticeUpdateSchema.safeParse({ body: 'New text', acknowledgeAgain: true, version: 2 }).success && !noticeUpdateSchema.safeParse({ audienceType: 'COMPANY' }).success,
  'an edit may ask for a new acknowledgement and still cannot change the audience');
console.log(`=== NOTICE QUEUE TESTS PASSED (${passed}) ===`);

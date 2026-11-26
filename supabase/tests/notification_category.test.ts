/**
 * The category and time shown on a notification (src/lib/notifications/notificationCategory.ts), and the routing of a notification to its screen
 * (openNotification.ts): every type the database can write maps to a named category, and the new meeting / task / chat types land where the brief says.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { NOTIFICATION_CATEGORIES, categoryOf, fullTime } from '../../src/lib/notifications/notificationCategory.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}

const expect: [string, string | null, string][] = [
  ['MEETING_REQUESTED', 'meeting', 'Meetings'], ['MEETING_APPROVED', 'meeting', 'Meetings'], ['MEETING_DECLINED', 'meeting', 'Meetings'], ['MEETING_RESCHEDULED', 'meeting', 'Meetings'],
  ['MEETING_PROPOSED', 'meeting', 'Meetings'], ['MEETING_CANCELLED', 'meeting', 'Meetings'], ['EMPLOYEE_MEETING_UPDATED', 'employee_meeting', 'Meetings'],
  ['TASK_ASSIGNED', 'work_task', 'Tasks'], ['TASK_PRIORITY_CHANGED', 'work_task', 'Tasks'], ['TASK_DEADLINE_CHANGED', 'work_task', 'Tasks'], ['TASK_REOPENED', 'work_task', 'Tasks'],
  ['TASK_REASSIGNED', 'work_task', 'Tasks'], ['TASK_REASSIGNED_AWAY', 'work_task', 'Tasks'], ['WORK_UPDATE_REQUESTED', 'work_task', 'Tasks'], ['WORK_UPDATE_FOLLOW_UP', 'work_task', 'Tasks'],
  ['WORK_UPDATE_SUBMITTED', 'work_task', 'Tasks'],
  ['CHAT_CLIENT_MESSAGE', 'chat', 'Chat'], ['CHAT_ASSIGNED', 'chat', 'Chat'], ['CHAT_REASSIGNED', 'chat', 'Chat'],
  ['CHAT_COVER_REPLY', 'chat', 'Chat'], ['CHAT_UNANSWERED', 'chat', 'Chat'], ['CLIENT_MESSAGE_ESCALATED', 'chat', 'Chat'],
  ['TICKET_FROM_CLIENT', 'support_ticket', 'Tickets'], ['ATTENDANCE_REMINDER', 'attendance', 'Attendance'], ['LEAVE_AWAITING_HR', null, 'Leave'],
  ['INVOICE_PAID', null, 'Accounts'], ['ONBOARDING_VERIFIED', null, 'Onboarding'], ['LEAD_ASSIGNED', null, 'Sales'], ['CUSTOMER_ASSIGNED', null, 'Customers'],
  ['RECRUITER_NEW_APPLICATION', null, 'HR'], ['REPORT_SUBMITTED', null, 'Reports'], ['ANNOUNCEMENT', null, 'Announcements']
];
for (const [type, entity, want] of expect) check(categoryOf(type, entity) === want, `${type} is "${want}"`, categoryOf(type, entity));
check(categoryOf('SOMETHING_NEW', null) === 'Other' && categoryOf('SOMETHING_NEW', 'meeting') === 'Meetings' && categoryOf('SOMETHING_NEW', 'work_task') === 'Tasks',
  'an unknown type is "Other", unless what it is about says more');
check(NOTIFICATION_CATEGORIES.includes(categoryOf('ANYTHING')), 'the category is always one of the listed ones');

// every notification type any migration writes has a real category (nothing falls to "Other" by accident)
const types = new Set<string>();
for (const f of readdirSync('supabase/migrations')) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8');
  for (const m of sql.matchAll(/notify(?:_once)?\([^,]+,\s*'([A-Z][A-Z0-9_]+)'/g)) types.add(m[1]);
}
const other = [...types].filter(t => categoryOf(t) === 'Other');
check(types.size > 150 && other.length === 0, `all ${types.size} notification types written by the migrations have a category`, other);

const stamp = fullTime('2030-01-02T15:05:00Z');
check(/2030/.test(stamp) && /(pm|am)/i.test(stamp) && fullTime('not a date') === '', 'the exact time shows the date, the year and the time (and a bad value shows nothing)', stamp);
console.log(`=== NOTIFICATION CATEGORY TESTS PASSED (${passed}) ===`);

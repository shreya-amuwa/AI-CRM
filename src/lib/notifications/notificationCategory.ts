/**
 * The category shown on a notification in the bell and in the Notification Center ("Meetings", "Tasks", "Chat"...). It is worked out from the notification's own
 * type (and what it is about), so every module, old and new, gets one without the database storing it twice. Unknown types are "Other", never an error.
 */
export type NotificationCategory =
  | 'Meetings' | 'Tasks' | 'Chat' | 'Tickets' | 'Customers' | 'Sales' | 'HR' | 'Attendance' | 'Leave' | 'Accounts' | 'Onboarding' | 'Reports' | 'Issues' | 'Announcements' | 'System' | 'Other';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['Meetings', 'Tasks', 'Chat', 'Tickets', 'Customers', 'Sales', 'HR', 'Attendance', 'Leave', 'Accounts', 'Onboarding', 'Reports', 'Issues', 'Announcements', 'System', 'Other'];

const RULES: [RegExp, NotificationCategory][] = [
  [/^(MEETING_|EMPLOYEE_MEETING_|CEO_)/, 'Meetings'],
  [/^(TASK_|WORK_UPDATE_|AI_STUDIO_TASK|AI_STUDIO_CROSS_TEAM|AI_STUDIO_PROJECT|AI_STUDIO_LEAD|ADS_ASSIGNMENT|MEETING_ACTION)/, 'Tasks'],
  [/^(CHAT_|CLIENT_MESSAGE_ESCALATED|CLIENT_GROUP_)/, 'Chat'],
  [/^TICKET_/, 'Tickets'],
  [/^ATTENDANCE_/, 'Attendance'],
  [/^(LEAVE_|PAID_LEAVE_)/, 'Leave'],
  [/^(INVOICE_|PAYMENT_|ACCOUNTS_|ADDON|SENT_TO_ACCOUNTS|RETURNED_FROM_ACCOUNTS|PAYOUT_|WALLET_|ORDER_TOTAL_)/, 'Accounts'],
  [/^(ONBOARDING_|PROGRESS_|META_|SERVICE_|HANDOVER_|SUBSCRIPTION_|PLAN_|NEW_SERVICE|SENT_TO_ADDONS)/, 'Onboarding'],
  [/^(LEAD_|LEADS_|BA_CONTACT_|CONTACT_SHEET_|FIELD_VISIT_|TC_FOLLOWUP_|CUSTOMERS_REASSIGNED)/, 'Sales'],
  [/^(CUSTOMER_|REASSIGN)/, 'Customers'],
  [/^(RECRUIT|EMPLOYEE_|USER_|ROLE_CHANGED|TRAINING_|DEPARTMENT_|TEAM_|RECOGNITION_)/, 'HR'],
  [/^(REPORT_|TOP_PERFORMERS_|AI_STUDIO_REPORT_|ADS_REPORT_)/, 'Reports'],
  [/^(DEV_BUG_|ADS_ISSUE|ADS_CLIENT_|ADS_NOTICE)/, 'Issues'],
  [/^ANNOUNCEMENT/, 'Announcements'],
  [/^(AUTOMATION_|GOOGLE_CALENDAR_|NOTIFICATION_|FINANCE_MAIL_|EMAIL_|USAGE_ALERT|ACTIVITY_LOGGED|OPERATIONS_SCOPE_)/, 'System']
];

export function categoryOf(type: string, entityType?: string | null): NotificationCategory {
  for (const [re, category] of RULES) if (re.test(type)) return category;
  if (entityType === 'meeting' || entityType === 'meeting_summary') return 'Meetings';
  if (entityType === 'work_task') return 'Tasks';
  if (entityType === 'chat' || entityType === 'chat_mention') return 'Chat';
  if (entityType === 'support_ticket') return 'Tickets';
  if (entityType === 'attendance') return 'Attendance';
  return 'Other';
}

/** "Mon 12 Jan 2026, 3:05 pm": the exact time of a notification (the list shows a short form; this is its tooltip and the page's second line). */
export function fullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

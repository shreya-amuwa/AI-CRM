/**
 * The unified dashboard of International and Reseller (migration 20270127000100): ONE dashboard for the Department Head, the Team Lead and the Team Member,
 * with a Sales section and a Support section in the same sidebar. This file is pure (no React): the sidebar of each role, the address of each page and which
 * pages a role may open. It is navigation only; every permission is enforced by the API and the database from the signed-in profile.
 */
export type UnifiedWho = 'HEAD' | 'LEAD' | 'MEMBER';

export type UnifiedPage =
  | 'overview'
  // Sales
  | 'sales-add-lead' | 'sales-leads' | 'sales-potential' | 'sales-onboarding' | 'sales-part-payments'
  | 'sales-dept-leads' | 'sales-team-leads' | 'sales-assign' | 'sales-follow-ups' | 'sales-performance' | 'sales-reports'
  // Support
  | 'support-customers' | 'support-tickets' | 'support-desk' | 'support-activity'
  // Work
  | 'tasks' | 'task-updates' | 'task-reports' | 'task-daily' | 'daily-reports' | 'performance' | 'my-performance'
  // Team and shared
  | 'team' | 'team-attendance' | 'raise-issue' | 'chat' | 'notifications' | 'profile';

export const UNIFIED_BASE = (userId: string) => `/unified/dashboard/${userId}`;

/** The part of the address after /unified/dashboard/:id (at most two segments: the section, then the page). */
export const UNIFIED_PATHS: Record<UnifiedPage, string> = {
  overview: '',
  'sales-add-lead': 'sales/add-lead',
  'sales-leads': 'sales/leads',
  'sales-potential': 'sales/potential',
  'sales-onboarding': 'sales/onboarding',
  'sales-part-payments': 'sales/part-payments',
  'sales-dept-leads': 'sales/department-leads',
  'sales-team-leads': 'sales/team-leads',
  'sales-assign': 'sales/lead-assignment',
  'sales-follow-ups': 'sales/follow-ups',
  'sales-performance': 'sales/performance',
  'sales-reports': 'sales/reports',
  'support-customers': 'support/customers',
  'support-tickets': 'support/tickets',
  'support-desk': 'support/customer-issues',
  'support-activity': 'support/team-activity',
  tasks: 'tasks',
  'task-updates': 'tasks/work-updates',
  'task-reports': 'tasks/reports',
  'task-daily': 'tasks/daily',
  'daily-reports': 'daily-reports',
  performance: 'performance',
  'my-performance': 'my-performance',
  team: 'team',
  'team-attendance': 'team-attendance',
  'raise-issue': 'raise-issue',
  chat: 'chat',
  notifications: 'notifications',
  profile: 'profile'
};

const BY_PATH = new Map<string, UnifiedPage>(Object.entries(UNIFIED_PATHS).map(([page, p]) => [p, page as UnifiedPage]));

/** The page an address names; the overview for anything unknown (or for a page the role does not have, see {@link canOpen}). */
export function parseUnifiedPage(pathname: string): UnifiedPage {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(4).filter(Boolean);
  return BY_PATH.get(parts.join('/')) ?? 'overview';
}

const ALL: UnifiedWho[] = ['HEAD', 'LEAD', 'MEMBER'];
/** Which roles have each page. */
const ROLES: Record<UnifiedPage, UnifiedWho[]> = {
  overview: ALL,
  'sales-add-lead': ALL, 'sales-leads': ALL, 'sales-potential': ALL, 'sales-onboarding': ALL, 'sales-part-payments': ALL,
  'sales-dept-leads': ['HEAD'], 'sales-team-leads': ['LEAD'], 'sales-assign': ['HEAD'], 'sales-follow-ups': ['LEAD', 'MEMBER'],
  'sales-performance': ['HEAD', 'LEAD'], 'sales-reports': ['HEAD'],
  'support-customers': ALL, 'support-tickets': ALL, 'support-desk': ['HEAD'], 'support-activity': ['HEAD', 'LEAD'],
  tasks: ALL, 'task-updates': ['HEAD'], 'task-reports': ['HEAD'], 'task-daily': ['HEAD'], 'daily-reports': ALL, performance: ['HEAD', 'LEAD'], 'my-performance': ['MEMBER'],
  team: ['HEAD', 'LEAD'], 'team-attendance': ['HEAD'], 'raise-issue': ALL, chat: ALL, notifications: ALL, profile: ALL
};
export const canOpen = (who: UnifiedWho, page: UnifiedPage): boolean => ROLES[page].includes(who);

export interface UnifiedMenuItem { id: string; label: string; children?: { id: UnifiedPage; label: string }[] }
export interface UnifiedMenuGroup { label?: string; items: UnifiedMenuItem[] }

const leaf = (id: UnifiedPage, label: string): UnifiedMenuItem => ({ id, label });

/**
 * The sidebar of a role: Overview, then **Sales** and **Support** (two separate, labelled sections of the same sidebar), then Work and the shared pages.
 * Attendance and Meeting Request are added in front by the dashboard shell; Leave is the Leave button of the top bar.
 */
export function unifiedMenu(who: UnifiedWho): UnifiedMenuGroup[] {
  const myLeads: UnifiedMenuItem = {
    id: 'sales-my-leads', label: 'My Leads',
    children: [
      { id: 'sales-leads', label: 'Leads' }, { id: 'sales-potential', label: 'Potential' },
      { id: 'sales-onboarding', label: 'Customer onboarding' }, { id: 'sales-part-payments', label: 'Part payments' }
    ]
  };
  const sales: UnifiedMenuItem[] = [
    leaf('sales-add-lead', 'Add Lead'),
    myLeads,
    ...(who === 'HEAD' ? [leaf('sales-dept-leads', 'Department Leads'), leaf('sales-assign', 'Lead Assignment')] : []),
    ...(who === 'LEAD' ? [leaf('sales-team-leads', 'Team Leads')] : []),
    ...(who !== 'HEAD' ? [leaf('sales-follow-ups', 'Lead Follow-ups')] : []),
    ...(who !== 'MEMBER' ? [leaf('sales-performance', 'Sales Performance')] : []),
    ...(who === 'HEAD' ? [leaf('sales-reports', 'Sales Reports')] : [])
  ];
  const support: UnifiedMenuItem[] = [
    leaf('support-customers', who === 'MEMBER' ? 'My Customers' : 'Customers'),
    leaf('support-tickets', who === 'MEMBER' ? 'My Support Tickets' : 'Support Tickets'),
    ...(who === 'HEAD' ? [leaf('support-desk', 'Customer Issues')] : []),
    ...(who !== 'MEMBER' ? [leaf('support-activity', 'Team Activity')] : [])
  ];
  const tasks: UnifiedMenuItem = who === 'HEAD'
    ? { id: 'tasks-group', label: 'Task Management', children: [
        { id: 'tasks', label: 'Assign Task' }, { id: 'task-updates', label: 'Work updates' },
        { id: 'task-reports', label: 'Task reports' }, { id: 'task-daily', label: 'Daily tasks' }
      ] }
    : leaf('tasks', who === 'LEAD' ? 'Assign Task' : 'My Assigned Tasks');
  return [
    { items: [leaf('overview', 'Overview')] },
    { label: 'Sales', items: sales },
    { label: 'Support', items: support },
    { label: 'Work', items: [tasks, leaf('daily-reports', 'Daily Reports'), who === 'MEMBER' ? leaf('my-performance', 'My Performance') : leaf('performance', 'Performance Management')] },
    {
      label: 'Team',
      items: [
        ...(who !== 'MEMBER' ? [leaf('team', 'Team Members')] : []),
        ...(who === 'HEAD' ? [leaf('team-attendance', 'Team Attendance')] : []),
        leaf('raise-issue', 'Raise an Issue'), leaf('chat', 'Chat'), leaf('notifications', 'Notification Center'), leaf('profile', 'Profile')
      ]
    }
  ];
}

export const UNIFIED_WHO_LABEL: Record<UnifiedWho, string> = { HEAD: 'Department Head', LEAD: 'Team Lead', MEMBER: 'Team Member' };

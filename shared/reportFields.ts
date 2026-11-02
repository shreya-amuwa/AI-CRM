// The sections of each kind of work report. One list used by the form (labels, order, hints) and by the server schema (allowed keys), so they
// cannot drift apart. The database keeps the same keys (private.clean_report_content) and drops anything else.
export type ReportKind = 'MEMBER' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD';

export interface ReportFieldDef {
  key: string;
  label: string;
  hint?: string;
  /** Needed before the report can be submitted (a draft may leave it empty). */
  required?: boolean;
}

/**
 * Sections of Team Member reports written before the report was simplified. New Team Member reports only have a title, a date, assigned
 * tasks and completed tasks (see MEMBER_REPORT_TASK_KEYS); these labels are only used to show the older reports.
 */
export const MEMBER_REPORT_FIELDS = [
  { key: 'tasksAssigned', label: 'Assigned tasks', hint: 'What you were given to do in this period.' },
  { key: 'tasksCompleted', label: 'Completed tasks', hint: 'The tasks you finished.' },
  { key: 'workCompleted', label: 'Work completed', hint: 'A summary of the work you completed.' },
  { key: 'todayActivities', label: "Today's activities", hint: 'What you did during the day.' },
  { key: 'pendingTasks', label: 'Pending tasks', hint: 'What is still open and why.' },
  { key: 'challenges', label: 'Challenges', hint: 'Anything that slowed you down or needs help.' },
  { key: 'achievements', label: 'Achievements', hint: 'Wins and results worth noting.' },
  { key: 'remarks', label: 'Remarks', hint: 'Anything else your Team Lead should know.' }
] as const satisfies readonly ReportFieldDef[];

/** The two task lists of a Team Member report: ids of the member's own task records (the database checks them). */
export const MEMBER_REPORT_TASK_KEYS = ['assignedTasks', 'completedTasks'] as const;

export const TEAM_LEAD_REPORT_FIELDS = [
  { key: 'workCompleted', label: 'Work completed personally', hint: 'What you completed yourself in this period.', required: true },
  { key: 'tasksHandled', label: 'Tasks and responsibilities handled' },
  { key: 'teamCoordination', label: 'Team coordination summary', hint: 'How you guided and supported the team.' },
  { key: 'targetProgress', label: 'Target progress', hint: 'Progress against the team targets.' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'pendingActivities', label: 'Pending activities' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'nextPlans', label: 'Next plans' },
  { key: 'remarks', label: 'Remarks' }
] as const satisfies readonly ReportFieldDef[];

export const DEPARTMENT_HEAD_REPORT_FIELDS = [
  { key: 'departmentOverview', label: 'Department overview', hint: 'The state of the department in this period.' },
  { key: 'workCompleted', label: 'Work completed', required: true },
  { key: 'achievements', label: 'Achievements' },
  { key: 'teamLeadPerformance', label: 'Team Lead performance', hint: 'How the Team Leads performed.' },
  { key: 'targets', label: 'Targets', hint: 'Targets set and how they are going.' },
  { key: 'pendingActivities', label: 'Pending activities' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'resourceRequirements', label: 'Resource requirements', hint: 'People, tools or budget you need.' },
  { key: 'nextPlans', label: 'Next plans' },
  { key: 'remarks', label: 'Remarks' }
] as const satisfies readonly ReportFieldDef[];

export const REPORT_FIELDS: Record<ReportKind, readonly ReportFieldDef[]> = {
  MEMBER: MEMBER_REPORT_FIELDS,
  TEAM_LEAD: TEAM_LEAD_REPORT_FIELDS,
  DEPARTMENT_HEAD: DEPARTMENT_HEAD_REPORT_FIELDS
};

export type ReportFieldKey =
  | (typeof MEMBER_REPORT_FIELDS)[number]['key']
  | (typeof TEAM_LEAD_REPORT_FIELDS)[number]['key']
  | (typeof DEPARTMENT_HEAD_REPORT_FIELDS)[number]['key'];

export const ALL_REPORT_FIELD_KEYS: readonly ReportFieldKey[] = [
  ...new Set([...MEMBER_REPORT_FIELDS, ...TEAM_LEAD_REPORT_FIELDS, ...DEPARTMENT_HEAD_REPORT_FIELDS].map(f => f.key))
];

export const REPORT_PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];

export const REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  PENDING_DEPARTMENT_HEAD: 'Pending Department Head Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUIRED: 'Revision required'
};

/**
 * The status as people read it. A Team Member report goes through two approvals, so its labels name the stage; a Team Lead or Department
 * Head report has one reviewer and keeps the plain labels. Only a report both approvals passed is "Fully Approved".
 */
export function reportStatusLabel(status: ReportStatus, kind?: ReportKind | null): string {
  if (kind === 'MEMBER') {
    switch (status) {
      case 'SUBMITTED':
      case 'UNDER_REVIEW': return 'Pending Team Lead Approval';
      case 'PENDING_DEPARTMENT_HEAD': return 'Pending Department Head Approval';
      case 'APPROVED': return 'Fully Approved';
      case 'REVISION_REQUIRED': return 'Revision Required';
    }
  }
  return REPORT_STATUS_LABEL[status];
}

// ---------------------------------------------------------------------------
// Company reporting: the standard form, the weekly cycle and the HR review stages
// ---------------------------------------------------------------------------
/** The one standard report form of every level: title, date, assigned tasks, completed tasks and a short remark. */
export const REPORT_REMARKS_MAX = 500;

/** The statuses of a weekly department report (kept apart from the daily statuses and from the HR review statuses). */
export const WEEKLY_REPORT_STATUSES = [
  'DRAFT', 'COMPILING', 'PENDING_OPERATIONS_HEAD', 'REVISION_REQUIRED', 'APPROVED_BY_OPERATIONS_HEAD', 'SENT_TO_HR',
  'HR_REVIEW_IN_PROGRESS', 'HR_REVIEW_COMPLETED', 'SUBMITTED_TO_SUPERADMIN'
] as const;
export type WeeklyReportStatus = (typeof WEEKLY_REPORT_STATUSES)[number];

export const WEEKLY_STATUS_LABEL: Record<WeeklyReportStatus | 'NOT_SUBMITTED', string> = {
  NOT_SUBMITTED: 'Not started',
  DRAFT: 'Draft',
  COMPILING: 'Compiling',
  PENDING_OPERATIONS_HEAD: 'Pending Operations Head Approval',
  REVISION_REQUIRED: 'Revision Required',
  APPROVED_BY_OPERATIONS_HEAD: 'Approved by Operations Head',
  SENT_TO_HR: 'Sent to HR',
  HR_REVIEW_IN_PROGRESS: 'HR Review In Progress',
  HR_REVIEW_COMPLETED: 'HR Review Completed',
  SUBMITTED_TO_SUPERADMIN: 'Submitted to Superadmin'
};

/** The final performance reporting stage of a week (HR reviews, then the Super Admin). */
export const PERFORMANCE_STAGE_LABEL = {
  PENDING_HR_REVIEW: 'Pending HR Review',
  PARTIALLY_REVIEWED: 'Partially Reviewed',
  HR_REVIEW_COMPLETED: 'HR Review Completed',
  SUBMITTED_TO_SUPERADMIN: 'Submitted to Superadmin',
  AI_ANALYSIS_COMPLETED: 'AI Analysis Completed'
} as const;
export type PerformanceStage = keyof typeof PERFORMANCE_STAGE_LABEL;

export const HR_REVIEW_STATUS_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted' } as const;

export const LEADERBOARD_CATEGORIES = [
  'TOP10', 'BOTTOM10', 'TOP_MEMBERS', 'LOWEST_MEMBERS', 'TOP_LEADS', 'LOWEST_LEADS', 'TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS', 'ALL'
] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];
export const LEADERBOARD_CATEGORY_LABEL: Record<LeaderboardCategory, string> = {
  TOP10: 'Top 10 Performers',
  BOTTOM10: 'Bottom 10 Performers',
  TOP_MEMBERS: 'Top Performing Team Members',
  LOWEST_MEMBERS: 'Lowest Performing Team Members',
  TOP_LEADS: 'Top Performing Team Leads',
  LOWEST_LEADS: 'Lowest Performing Team Leads',
  TOP_DEPARTMENTS: 'Top Performing Departments',
  LOWEST_DEPARTMENTS: 'Lowest Performing Departments',
  ALL: 'Full ranking'
};

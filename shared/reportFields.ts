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

export const MEMBER_REPORT_FIELDS = [
  { key: 'tasksAssigned', label: 'Assigned tasks', hint: 'What you were given to do in this period.' },
  { key: 'tasksCompleted', label: 'Completed tasks', hint: 'The tasks you finished.' },
  { key: 'workCompleted', label: 'Work completed', hint: 'A summary of the work you completed.', required: true },
  { key: 'todayActivities', label: "Today's activities", hint: 'What you did during the day.' },
  { key: 'pendingTasks', label: 'Pending tasks', hint: 'What is still open and why.' },
  { key: 'challenges', label: 'Challenges', hint: 'Anything that slowed you down or needs help.' },
  { key: 'achievements', label: 'Achievements', hint: 'Wins and results worth noting.' },
  { key: 'remarks', label: 'Remarks', hint: 'Anything else your Team Lead should know.' }
] as const satisfies readonly ReportFieldDef[];

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

export const REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUIRED: 'Revision required'
};

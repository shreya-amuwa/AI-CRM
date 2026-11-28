import { z } from 'zod';

/**
 * HR dashboard upgrade (docs/hr-dashboard-upgrade.md): review forms, request validation and the shapes the database returns.
 * The database is the authority (who may do what, the status rules); these schemas only reject malformed input early.
 */

// ---------------------------------------------------------------------------
// Review forms (Phase 1 confirmation, Phase 4 internship)
// ---------------------------------------------------------------------------
export type ReviewCycleType = 'PROBATION' | 'INTERNSHIP';
export type ReviewerRole = 'DH' | 'CEO' | 'HR';
export interface ReviewCriterion { key: string; label: string }

/** The rating scale (1-5; "Not applicable" is null). */
export const RATING_SCALE = [
  { value: 1, label: 'Unsatisfactory' }, { value: 2, label: 'Needs improvement' }, { value: 3, label: 'Meets expectations' },
  { value: 4, label: 'Very good' }, { value: 5, label: 'Excellent' }
] as const;

const DH_PROBATION: ReviewCriterion[] = [
  { key: 'job_knowledge', label: 'Job knowledge and understanding' }, { key: 'work_quality', label: 'Work quality' },
  { key: 'productivity', label: 'Productivity' }, { key: 'task_completion', label: 'Task completion' },
  { key: 'targets', label: 'Achievement of assigned targets' }, { key: 'attendance', label: 'Attendance and punctuality' },
  { key: 'communication', label: 'Communication skills' }, { key: 'behaviour', label: 'Professional behaviour' },
  { key: 'collaboration', label: 'Team collaboration' }, { key: 'learning', label: 'Learning ability' },
  { key: 'ownership', label: 'Ownership and responsibility' }, { key: 'independence', label: 'Ability to work independently' },
  { key: 'improvement', label: 'Overall improvement during probation' }
];
const DH_INTERNSHIP: ReviewCriterion[] = [
  { key: 'learning', label: 'Learning ability' }, { key: 'adaptability', label: 'Adaptability' },
  { key: 'practical_knowledge', label: 'Technical or practical knowledge' }, { key: 'work_quality', label: 'Quality of assigned work' },
  { key: 'task_completion', label: 'Completion of assigned tasks' }, { key: 'attendance', label: 'Attendance' },
  { key: 'punctuality', label: 'Punctuality' }, { key: 'communication', label: 'Communication skills' },
  { key: 'behaviour', label: 'Professional behaviour' }, { key: 'collaboration', label: 'Team collaboration' },
  { key: 'initiative', label: 'Initiative' }, { key: 'feedback', label: 'Ability to accept and apply feedback' },
  { key: 'improvement', label: 'Improvement throughout the internship' }, { key: 'fulltime_fit', label: 'Suitability for a full-time role' }
];
const CEO_PROBATION: ReviewCriterion[] = [
  { key: 'overall', label: 'Overall employee performance' }, { key: 'goals', label: 'Contribution to organisational goals' },
  { key: 'conduct', label: 'Professional conduct' }, { key: 'consistency', label: 'Consistency' },
  { key: 'growth', label: 'Learning and growth' }, { key: 'potential', label: 'Future potential' }
];
const CEO_INTERNSHIP: ReviewCriterion[] = [
  { key: 'overall', label: 'Overall performance' }, { key: 'growth', label: 'Learning and growth' },
  { key: 'contribution', label: 'Organisational contribution' }, { key: 'potential', label: 'Future potential' },
  { key: 'continuation', label: 'Suitability for continued employment' }
];
const HR_CRITERIA: ReviewCriterion[] = [
  { key: 'attendance', label: 'Attendance record' }, { key: 'conduct', label: 'Conduct and discipline' }, { key: 'records', label: 'HR records complete' }
];

/** Role-specific extras, chosen from the employee's designation / sub-role (only where they apply; nothing irrelevant is forced). */
export function roleFamily(designation: string | null | undefined, salesSubRole?: string | null): 'TELECALLER' | 'DESIGN' | 'SUPPORT' | 'ACCOUNTS' | null {
  const d = (designation ?? '').toLowerCase();
  if (salesSubRole === 'TELECALLER' || d.includes('telecall')) return 'TELECALLER';
  if (/design|creative|video|graphic/.test(d)) return 'DESIGN';
  if (/support|consultant|verifier|service/.test(d)) return 'SUPPORT';
  if (/account|finance|billing/.test(d)) return 'ACCOUNTS';
  return null;
}
const FAMILY_EXTRAS: Record<string, ReviewCriterion[]> = {
  TELECALLER: [{ key: 'calling', label: 'Calling performance (calls, connects, follow-ups)' }, { key: 'lead_quality', label: 'Quality of leads generated' }],
  DESIGN: [{ key: 'design_quality', label: 'Design quality' }, { key: 'turnaround', label: 'Task turnaround' }],
  SUPPORT: [{ key: 'customer_handling', label: 'Customer handling' }, { key: 'resolution', label: 'Issue resolution' }],
  ACCOUNTS: [{ key: 'accuracy', label: 'Accuracy' }, { key: 'timeliness', label: 'Timely processing' }]
};

export function reviewCriteria(type: ReviewCycleType, role: ReviewerRole, family: string | null = null): ReviewCriterion[] {
  if (role === 'HR') return HR_CRITERIA;
  const base = role === 'DH' ? (type === 'INTERNSHIP' ? DH_INTERNSHIP : DH_PROBATION) : (type === 'INTERNSHIP' ? CEO_INTERNSHIP : CEO_PROBATION);
  return role === 'DH' && family ? [...base, ...(FAMILY_EXTRAS[family] ?? [])] : base;
}

/** The free-text fields of each form (keys stored in the evaluation's answers). */
export const REVIEW_TEXT_FIELDS: Record<ReviewerRole, Record<ReviewCycleType, { key: string; label: string }[]>> = {
  DH: {
    PROBATION: [{ key: 'strengths', label: 'Employee strengths' }, { key: 'improvements', label: 'Areas requiring improvement' },
      { key: 'achievements', label: 'Key achievements' }, { key: 'concerns', label: 'Performance-related concerns' }, { key: 'remarks', label: 'Additional remarks' },
      { key: 'evidence', label: 'Supporting evidence (links or references)' }],
    INTERNSHIP: [{ key: 'strengths', label: "Intern's strengths" }, { key: 'improvements', label: 'Areas requiring improvement' },
      { key: 'workCompleted', label: 'Work completed' }, { key: 'trainingProvided', label: 'Training provided' },
      { key: 'contribution', label: 'Overall contribution' }, { key: 'remarks', label: 'Additional remarks' }]
  },
  CEO: {
    PROBATION: [{ key: 'departmentFeedback', label: 'Department-specific feedback' }, { key: 'observations', label: 'Additional observations' }],
    INTERNSHIP: [{ key: 'observations', label: 'Additional observations' }]
  },
  HR: {
    PROBATION: [{ key: 'observations', label: 'HR observations' }, { key: 'attendanceFeedback', label: 'Attendance-related feedback' },
      { key: 'conductFeedback', label: 'Employee conduct feedback' }, { key: 'hrRecords', label: 'Relevant HR records' },
      { key: 'discussionNotes', label: 'Discussion notes' }, { key: 'finalAssessment', label: 'Final assessment' }],
    INTERNSHIP: [{ key: 'observations', label: 'HR observations' }, { key: 'attendanceFeedback', label: 'Attendance and duration' },
      { key: 'conductFeedback', label: 'Professional conduct' }, { key: 'requirements', label: 'Employment requirements' },
      { key: 'discussionNotes', label: 'Discussion notes' }, { key: 'finalAssessment', label: 'Final assessment' }]
  }
};

export const RECOMMENDATIONS: Record<ReviewCycleType, { value: string; label: string }[]> = {
  PROBATION: [{ value: 'CONFIRM', label: 'Recommend confirmation' }, { value: 'EXTEND', label: 'Recommend probation extension' },
    { value: 'NOT_CONFIRM', label: 'Do not recommend confirmation' }, { value: 'DISCUSS', label: 'Further discussion required' }],
  INTERNSHIP: [{ value: 'COMPLETE', label: 'Successfully complete internship' }, { value: 'CONVERT', label: 'Recommend conversion to full-time employment' },
    { value: 'EXTEND', label: 'Recommend internship extension' }, { value: 'NOT_CONTINUE', label: 'Do not recommend continuation' },
    { value: 'DISCUSS', label: 'Further discussion required' }]
};
export const DECISIONS: Record<ReviewCycleType, { value: string; label: string }[]> = {
  PROBATION: [{ value: 'CONFIRM', label: 'Confirm employee' }, { value: 'EXTEND', label: 'Extend probation' },
    { value: 'NOT_CONFIRM', label: 'Do not confirm employee' }, { value: 'HOLD', label: 'Keep decision on hold' }],
  INTERNSHIP: [{ value: 'COMPLETE', label: 'Successfully complete internship' }, { value: 'CONVERT', label: 'Convert to full-time employee' },
    { value: 'EXTEND', label: 'Extend internship' }, { value: 'NOT_CONTINUE', label: 'Do not continue' }, { value: 'HOLD', label: 'Keep decision on hold' }]
};

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const text = (max: number) => z.string().trim().max(max);

export const reviewListQuerySchema = z.object({
  type: z.enum(['PROBATION', 'INTERNSHIP']).optional(),
  departmentId: z.string().uuid().optional(),
  employee: text(80).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['UPCOMING', 'IN_REVIEW', 'AWAITING_HR_DECISION', 'OVERDUE', 'ON_HOLD', 'CONFIRMING', 'APPROVED', 'NOT_CONFIRMED', 'DISMISSED',
    'COMPLETED', 'CONVERTED', 'NOT_CONTINUED']).optional(),
  pendingRole: z.enum(['DH', 'CEO', 'HR']).optional(),
  window: z.enum(['UPCOMING', 'DUE_10', 'DUE_4', 'OVERDUE', 'COMPLETED', 'PENDING_DECISION', 'EXTENDED', 'CONFIRMED']).optional()
}).strict();

const ratings = z.record(z.string().max(60), z.union([z.number().int().min(1).max(5), z.null()])).refine(r => Object.keys(r).length <= 40, 'Too many ratings.');
const answers = z.record(z.string().max(60), z.string().max(4000)).refine(r => Object.keys(r).length <= 40, 'Too many answers.');

export const reviewEvaluationSchema = z.object({
  role: z.enum(['DH', 'CEO', 'HR']),
  ratings: ratings.default({}),
  answers: answers.default({}),
  recommendation: z.enum(['CONFIRM', 'EXTEND', 'NOT_CONFIRM', 'DISCUSS', 'COMPLETE', 'CONVERT', 'NOT_CONTINUE']).nullable().optional(),
  submit: z.boolean().default(false)
}).strict();

export const reviewReturnSchema = z.object({ role: z.enum(['DH', 'CEO']), reason: text(1000).min(5, 'Say what should be revised.') }).strict();
export const reviewReassignSchema = z.object({ role: z.enum(['DH', 'CEO', 'HR']), profileId: z.string().uuid(), reason: text(500).min(3, 'Say why the reviewer changes.') }).strict();

export const reviewDecisionSchema = z.object({
  decision: z.enum(['CONFIRM', 'EXTEND', 'NOT_CONFIRM', 'HOLD', 'COMPLETE', 'CONVERT', 'NOT_CONTINUE']),
  reason: text(4000).min(10, 'Give the reasons for the decision.'),
  effectiveDate: isoDate.optional(),
  extensionMonths: z.union([z.number().int().min(1).max(12), z.string().regex(/^([1-9]|1[0-2])$/)]).optional(),
  newDate: isoDate.optional(),
  expectations: text(4000).optional(),
  nextReviewDate: isoDate.optional(),
  ownerId: z.string().uuid().optional(),
  exceptional: z.boolean().optional(),
  // internship conversion (Phase 4)
  fullTimeEffectiveDate: isoDate.optional(),
  probationMonths: z.number().int().min(1).max(12).optional(),
  hrEvaluation: z.object({ ratings: ratings.default({}), answers: answers.default({}) }).strict().optional()
}).strict();

// Attendance statement (Phase 2)
const uuidList = z.array(z.string().uuid()).max(500).default([]);
export const ATTENDANCE_STATUS_FILTERS = ['PRESENT_ANY', 'PRESENT', 'LATE', 'LATE_ARRIVAL', 'HALF_DAY', 'ABSENT', 'APPROVED_LEAVE', 'WEEKLY_OFF', 'HOLIDAY',
  'MISSING_PUNCH_OUT', 'EARLY_DEPARTURE', 'DISCREPANCY', 'IN_PROGRESS', 'NOT_STARTED'] as const;
export const attendanceStatementSchema = z.object({
  from: isoDate, to: isoDate,
  departmentIds: uuidList, teamIds: uuidList, profileIds: uuidList,
  designation: text(80).optional(), employmentType: z.enum(['Full-Time', 'Training / Probation', 'Intern', 'Left']).optional(),
  employeeStatus: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'), shift: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  statuses: z.array(z.enum(ATTENDANCE_STATUS_FILTERS)).max(14).default([]),
  view: z.enum(['DAILY', 'SUMMARY', 'REGISTER']).default('DAILY'),
  sort: z.enum(['date', 'name', 'department', 'punch_in', 'hours', 'status']).default('date'), dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(10).max(200).default(50)
}).strict().refine(f => f.from <= f.to, { message: 'From Date must not be later than To Date.', path: ['from'] });
export const attendanceExportSchema = z.object({
  filters: z.record(z.string(), z.unknown()),
  type: z.enum(['DETAILED', 'SUMMARY', 'REGISTER', 'RAW_PUNCHES', 'RECONCILIATION']),
  format: z.enum(['XLSX', 'CSV']),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(100).max(10000).default(5000)
}).strict();
export const biometricIdSchema = z.object({ profileId: z.string().uuid(), biometricId: z.string().trim().regex(/^[A-Za-z0-9._-]{0,40}$/, 'Use letters, digits, dot, dash or underscore.') }).strict();

export const holidaySchema = z.object({ day: isoDate, name: text(120).optional(), remove: z.boolean().default(false) }).strict();
export const holidayQuerySchema = z.object({ year: z.coerce.number().int().min(2020).max(2100).optional() }).strict();

// ---------------------------------------------------------------------------
// Shapes (as the database returns them)
// ---------------------------------------------------------------------------
export interface ReviewPerson { id: string; name: string; active: boolean }
export interface ReviewRoleStatus { reviewer: ReviewPerson | null; status: string }
export interface ReviewRow {
  id: string; cycleType: ReviewCycleType; profileId: string | null; employeeName: string; employeeCode: string; departmentId: string | null;
  department: string | null; designation: string | null; employmentType: string | null; joiningDate: string; periodMonths: number;
  originalEnd: string; dueDate: string; daysLeft: number; round: number; status: string; overall: string; reviewStarted: boolean;
  configIssue: string | null; dh: ReviewRoleStatus; ceo: ReviewRoleStatus; hr: ReviewRoleStatus; decision: string | null;
  decidedAt: string | null; holdNextReview: string | null; extensionCount: number;
  myRole?: ReviewerRole | null; myStatus?: string; attendance?: AttendanceSummary | null;
}
export interface AttendanceSummary {
  from: string; to: string; workingDays: number; presentDays: number; halfDays: number; absentDays: number; approvedLeaveDays: number;
  lateArrivals: number; earlyDepartures: number; missingPunchOut: number; discrepancies: number; netMinutes: number; breakMinutes: number;
}
export interface ReviewEvaluation {
  id: string; round: number; role: ReviewerRole; reviewer: ReviewPerson | null; status: 'DRAFT' | 'SUBMITTED' | 'RETURNED';
  ratings: Record<string, number | null>; answers: Record<string, string>; recommendation: string | null; submittedAt: string | null;
  version: number; returnedReason: string | null; returnedAt: string | null; returnedBy: ReviewPerson | null; updatedAt: string; versions: number;
}
export interface ReviewDetail extends ReviewRow {
  myRole: ReviewerRole | null; isHr: boolean; canDecide: boolean; canDecideException: boolean; canReassign: boolean;
  employee: { name: string; code: string; email: string | null; department: string | null; designation: string | null; employmentType: string | null;
    joiningDate: string; periodMonths: number; originalEnd: string; currentEnd: string; team: string | null; salesSubRole: string | null };
  attendance: AttendanceSummary | null;
  work: { assigned: number; completed: number; pending: number; notCompleted: number; overdue: number } | null;
  evaluations: ReviewEvaluation[];
  extensions: { fromRound: number; oldEnd: string; newEnd: string; reason: string; expectations: string | null; by: ReviewPerson | null; at: string }[];
  decisions: { round: number; decision: string; reason: string | null; details: Record<string, unknown>; exceptional: boolean; by: ReviewPerson | null; at: string }[];
  assignments: { round: number; role: ReviewerRole; from: ReviewPerson | null; to: ReviewPerson | null; reason: string | null; by: ReviewPerson | null; at: string }[];
  reminders: { kind: string; to: string | null; role: string | null; status: string; error: string | null; sentAt: string | null; sendAfter: string }[];
  meetings: { id: string; title: string; startsAt: string; status: string }[];
  confirmationEmail: { status: string; error: string | null; sentAt: string | null } | null;
  hrPeople: { id: string; name: string; role: string }[] | null;
  notice?: string;
}
export interface ReviewCards {
  upcoming: number; due10: number; due4: number; pendingDh: number; pendingCeo: number; pendingHr: number; overdue: number;
  confirmed: number; extended: number; internshipsUpcoming: number; configIssues: number;
}
export interface ReviewList { today: string; cards: ReviewCards; rows: ReviewRow[]; canManage: boolean; departments: { id: string; name: string }[] }
export interface ReviewQueue { today: string; rows: ReviewRow[] }
export interface OfficeHoliday { day: string; name: string }

export interface AttendanceStatementSummary {
  employees: number; employeeDays: number; scheduledDays: number; presentDays: number; absentDays: number; approvedLeaveDays: number; halfDays: number;
  lateArrivals: number; earlyDepartures: number; missingPunches: number; netMinutes: number; breakMinutes: number; averageNetMinutes: number;
}
export interface AttendanceStatement {
  from: string; to: string; view: 'DAILY' | 'SUMMARY' | 'REGISTER'; timeZone: string; today: string; summary: AttendanceStatementSummary;
  total: number; page: number; pageSize: number; rows: Record<string, unknown>[];
}
export interface AttendanceStatementOptions {
  departments: { id: string; name: string }[]; teams: { id: string; name: string; departmentId: string }[];
  employees: { id: string; name: string; departmentId: string; teamId: string | null; active: boolean; designation: string | null }[];
  designations: string[]; shifts: string[]; organization: string; timeZone: string; canExport: boolean;
}
export interface AttendanceExportPage { type: string; total: number; offset: number; rows: Record<string, unknown>[]; generatedAt: string; generatedBy: string; organization: string; timeZone: string }

// ---------------------------------------------------------------------------
// Phase 3: Telecaller performance, targets, review meetings, meeting reports, improvement plans (20270312000300)
// ---------------------------------------------------------------------------
export const TC_CATEGORIES = ['TARGET_ACHIEVED', 'ON_TRACK', 'NEEDS_IMPROVEMENT', 'LOW_PERFORMANCE', 'INSUFFICIENT_DATA', 'SYNC_PENDING', 'NOT_EVALUATED', 'DATA_PENDING'] as const;
export const TC_REVIEW_STATUSES = ['NONE', 'PENDING_SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NOT_REQUIRED'] as const;
export const TC_OUTCOMES = [
  { value: 'PERFORMANCE_REVIEWED', label: 'Performance reviewed' }, { value: 'TRAINING_REQUIRED', label: 'Training required' },
  { value: 'TECHNICAL_ISSUE', label: 'Technical issue identified' }, { value: 'TARGET_ADJUSTMENT_RECOMMENDED', label: 'Target adjustment recommended' },
  { value: 'COACHING_REQUIRED', label: 'Coaching required' }, { value: 'IMPROVEMENT_PLAN', label: 'Improvement plan agreed' },
  { value: 'FOLLOW_UP_MEETING', label: 'Follow-up meeting needed' }, { value: 'CONCERN_RESOLVED', label: 'Concern resolved' },
  { value: 'MANAGEMENT_DISCUSSION', label: 'Management discussion required' }
] as const;
export const TC_REPORT_FIELDS = [
  { key: 'performanceGap', label: 'Performance gap discussed', required: true }, { key: 'reasons', label: 'Reasons given by the Telecaller' },
  { key: 'hrObservations', label: 'HR observations', required: true }, { key: 'supportNeeded', label: 'Support or training needed' },
  { key: 'agreedActions', label: 'Agreed actions' }
] as const;

const uuid = z.string().uuid();
export const tcListQuerySchema = z.object({
  weekStart: isoDate.optional(), departmentId: uuid.optional(), teamId: uuid.optional(), profileId: uuid.optional(),
  category: z.enum(TC_CATEGORIES).optional(), reviewStatus: z.enum(TC_REVIEW_STATUSES).optional()
}).strict();
export const tcProfileQuerySchema = z.object({ weeks: z.coerce.number().int().min(1).max(52).optional() }).strict();
export const tcTargetSchema = z.object({
  scopeType: z.enum(['DEPARTMENT', 'TEAM', 'DESIGNATION', 'EMPLOYEE']),
  departmentId: uuid.optional(), teamId: uuid.optional(), profileId: uuid.optional(), designation: text(80).optional(),
  dailyCalls: z.number().int().min(1, 'The daily target is at least 1 call.').max(2000, 'The daily target is at most 2000 calls.'),
  weeklyCalls: z.number().int().min(1).max(14000).optional(),
  effectiveFrom: isoDate, note: text(500).optional()
}).strict().superRefine((t, ctx) => {
  const need = { DEPARTMENT: 'departmentId', TEAM: 'teamId', EMPLOYEE: 'profileId', DESIGNATION: 'designation' } as const;
  const key = need[t.scopeType];
  if (!t[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Choose where the target applies.' });
  if (t.scopeType === 'DESIGNATION' && !t.departmentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['departmentId'], message: 'Choose the department of the designation.' });
});
const pct = z.number().min(1).max(500);
export const tcPolicySchema = z.object({
  enabled: z.boolean(),
  achievedPct: pct.optional(), onTrackPct: pct.optional(), needsImprovementPct: pct.optional(), reviewBelowPct: pct.optional(),
  minWorkingDays: z.number().min(0).max(7).optional(), consecutiveWeeks: z.number().int().min(1).max(8).optional(),
  minDaysBetweenReviews: z.number().int().min(0).max(180).optional(), maxAutoReviews: z.number().int().min(0).max(52).optional(),
  meetingMinutes: z.number().int().min(15).max(120).optional(),
  inviteDepartmentHead: z.boolean().optional(), inviteTeamLead: z.boolean().optional(), inviteOperationsHead: z.boolean().optional(),
  hrReviewerId: z.union([uuid, z.literal('')]).optional(), excludedProfiles: z.array(uuid).max(500).optional()
}).strict().refine(p => p.achievedPct === undefined || p.onTrackPct === undefined || p.achievedPct >= p.onTrackPct, { message: 'Achieved must be at least On track.', path: ['onTrackPct'] })
  .refine(p => p.onTrackPct === undefined || p.needsImprovementPct === undefined || p.onTrackPct >= p.needsImprovementPct, { message: 'On track must be at least Needs improvement.', path: ['needsImprovementPct'] });
export const tcRecalcSchema = z.object({ reason: text(1000).min(5, 'Say why the week is recalculated.') }).strict();
export const tcScheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(), cancel: z.boolean().default(false), note: text(300).optional()
}).strict().refine(s => s.cancel || !!s.startsAt, { message: 'Choose the meeting time.', path: ['startsAt'] });
export const tcReportSchema = z.object({
  outcome: z.enum(TC_OUTCOMES.map(o => o.value) as [string, ...string[]]),
  fields: z.record(z.enum(TC_REPORT_FIELDS.map(f => f.key) as [string, ...string[]]), z.string().max(4000))
    .refine(f => (f.performanceGap ?? '').trim().length >= 5 && (f.hrObservations ?? '').trim().length >= 5, 'Record the performance gap and your observations.'),
  actionItems: z.array(z.object({ action: text(300).min(2), owner: text(120).optional(), due: isoDate.optional() }).strict()).max(20).default([]),
  followUpDate: isoDate.optional(),
  plan: z.object({ targets: text(4000).min(5, 'Write the agreed targets.'), support: text(4000).optional(), startDate: isoDate.optional(), deadline: isoDate }).strict().optional()
}).strict().refine(r => r.outcome !== 'IMPROVEMENT_PLAN' || !!r.plan, { message: 'An improvement plan needs the agreed targets and the review deadline.', path: ['plan'] })
  .refine(r => !r.plan || !r.plan.startDate || r.plan.startDate <= r.plan.deadline, { message: 'The review deadline cannot be before the start date.', path: ['plan', 'deadline'] });
export const tcPlanCloseSchema = z.object({ remarks: text(4000).min(5, 'Add closing remarks.') }).strict();

export type TcCategory = (typeof TC_CATEGORIES)[number];
export interface TcWeekRow {
  id: string; profileId: string; name: string; employeeCode: string; department: string | null; team: string | null; weekStart: string; weekEnd: string;
  status: 'PRELIMINARY' | 'FINAL'; category: TcCategory; reason: string | null; scheduledDays: number; leaveDays: number; eligibleDays: number;
  dailyTarget: number | null; weeklyTarget: number | null; adjustedTarget: number | null; actualCalls: number; connectedCalls: number; notConnectedCalls: number;
  incomingCalls: number; missedCalls: number; uniqueContacts: number; talkSeconds: number; averageConnectedSeconds: number | null; connectionRate: number | null;
  achievement: number | null; mappingOk: boolean; dataComplete: boolean; breakdown: Record<string, unknown>; computedAt: string; finalizedAt: string | null;
  recalcCount: number; reviewStatus: (typeof TC_REVIEW_STATUSES)[number]; reviewReason: string | null; meetingId: string | null;
  meeting: { id: string; startsAt: string; status: string } | null; previousAchievement: number | null; unavailable: string[];
}
export interface TcCards {
  telecallers: number; evaluated: number; achieved: number; onTrack: number; needsImprovement: number; low: number; insufficient: number;
  average: number | null; pendingMeetings: number; completedMeetings: number;
}
export interface TcPolicySummary { enabled: boolean; approvedAt: string | null; achievedPct: number; onTrackPct: number; needsImprovementPct: number; reviewBelowPct: number }
export interface TcPerformanceList {
  weekStart: string; weekEnd: string; rows: TcWeekRow[]; cards: TcCards; sync: { connection: string; lastOkAt: string | null; error: string | null }[];
  policy: TcPolicySummary; canManage: boolean; isHr: boolean; lastRun: unknown;
  options: { telecallers: { id: string; name: string; departmentId: string | null; teamId: string | null }[]; teams: { id: string; name: string; departmentId: string }[];
    departments: { id: string; name: string }[]; designations: string[] };
}
export interface TcReport { id: string; meetingId: string | null; outcome: string; fields: Record<string, string>; actionItems: { action: string; owner?: string; due?: string }[];
  followUpDate: string | null; by: string | null; at: string }
export interface TcPlan { id: string; targets: string; support: string | null; startDate: string; deadline: string; status: 'OPEN' | 'CLOSED'; closedRemarks: string | null; closedAt: string | null }
export interface TcProfile {
  profileId: string; name: string; isSelf: boolean; isHr: boolean; today: string; dailyTarget: number | null; weeklyTarget: number | null; todayCalls: number;
  thisWeek: TcWeekRow | null; days: { day: string; calls: number; connected: number; talkSeconds: number }[]; weeks: TcWeekRow[];
  reports: TcReport[]; plans: TcPlan[]; meetings: { id: string; title: string; startsAt: string; status: string }[]; actionItems: { action: string; owner?: string; due?: string }[];
}
export interface TcTarget {
  id: string; scopeType: 'DEPARTMENT' | 'TEAM' | 'DESIGNATION' | 'EMPLOYEE'; department: string | null; team: string | null; designation: string | null; employee: string | null;
  dailyCalls: number; weeklyCalls: number | null; effectiveFrom: string; effectiveTo: string | null; note: string | null; by: string | null; at: string; canManage: boolean;
}
export interface TcPolicy {
  enabled: boolean; achieved_pct: number; on_track_pct: number; needs_improvement_pct: number; review_below_pct: number; min_working_days: number;
  consecutive_weeks: number; min_days_between_reviews: number; max_auto_reviews: number; meeting_minutes: number; invite_department_head: boolean;
  invite_team_lead: boolean; invite_operations_head: boolean; hr_reviewer_id: string | null; excluded_profiles: string[]; approved_at: string | null;
  approvedByName: string | null; canEdit: boolean;
}

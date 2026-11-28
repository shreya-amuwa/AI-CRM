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

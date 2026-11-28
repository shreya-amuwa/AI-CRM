/**
 * Validation schemas shared by the API (authoritative) and the UI (early
 * feedback). The database enforces the same rules again with constraints.
 */
import { z } from 'zod';
import { OFFER_FIELD_KEY, offerTemplateProblems, type OfferTemplateContent } from './offerTemplates.js';
import { mobileProblem, normalizeWebsite } from './contactValidation.js';
import { businessProfileSchema, quotationContentSchema, scopeContentSchema, SCOPE_SECTIONS } from './baContent.js';
import { isValidGstinFormat, normalizeGstin } from './gst.js';
import { checkPanelUrl } from './panelUrl.js';
import { unknownPlaceholders, type HrExperienceContent, type HrLetterType, type HrOfferContent } from './hrLetters.js';
import { ALL_REPORT_FIELD_KEYS, REPORT_PERIOD_TYPES, REPORT_REMARKS_MAX, REPORT_STATUSES, type ReportFieldKey } from './reportFields.js';
import { MAX_LINES, paiseToDecimal, toPaise, toRateBp } from './invoiceCalc.js';
import {
  ACCOUNT_STATUSES,
  ADDON_REQUEST_STATUSES,
  AI_STUDIO_PRIORITIES,
  AI_STUDIO_PROJECT_STATUSES,
  AI_STUDIO_REPORT_STATUSES,
  AI_STUDIO_TASK_STATUSES,
  CUSTOMER_DOCUMENT_MAX_BYTES,
  HR_EMPLOYEE_FILE_KINDS,
  HR_EMPLOYEE_FILE_MAX_BYTES,
  HR_EMPLOYEE_FILE_MAX_LABEL,
  HR_EMPLOYEE_FILE_MIME_TYPES,
  type HrEmployeeFileMimeType,
  SUBSCRIPTION_DURATIONS,
  CUSTOMER_DOCUMENT_MAX_LABEL,
  INVOICE_PDF_MAX_BYTES,
  INVOICE_PDF_MAX_LABEL,
  INVOICE_PURPOSES,
  INVOICE_STAGES,
  TAX_TREATMENTS,
  LEAD_STATUSES,
  LEAD_TAG_COLOURS,
  LEAD_SCOPES,
  FIELD_VISIT_FILTERS,
  LEAD_VISIT_STATUSES,
  VISIT_PRIORITIES,
  ONBOARDING_FILTERS,
  HANDOVER_STAGES,
  REVIEW_FILTERS,
  PAYMENT_FILTERS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  FOLLOWUP_OUTCOMES,
  PIPELINE_STAGES,
  APPROVAL_STATUSES,
  CUSTOMER_SEGMENTS,
  CUSTOMER_STATUSES,
  NOTIFICATION_PRIORITIES,
  ROLES,
  SALES_SUB_ROLES,
  HEAD_DIVISIONS,
  SALES_LEAD_FILTERS,
  SALES_TASK_FILTERS,
  BA_STAGES,
  DEMO_MODES,
  DEMO_STATUSES,
  CALL_STATUSES,
  LEAD_TEMPERATURES,
  TEAM_DIVISIONS,
  ISSUE_CATEGORIES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  MEETING_ACTIONS,
  MEETING_CATEGORIES,
  MEETING_MODES,
  MEETING_STATUSES,
  TC_WORKFLOW_STATUSES,
  META_WORKFLOW_STATUSES,
  ADS_PRIORITIES,
  ADS_NOTICE_CATEGORIES,
  ADS_NOTICE_STATUSES,
  ADS_ASSIGNMENT_STATUSES,
  ADS_REPORT_STATUSES,
  ADS_ISSUE_CATEGORIES,
  ADS_ISSUE_STATUSES
} from './contracts.js';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), trimmed(max).nullable().optional());

export const uuidSchema = z.string().uuid('Must be a valid identifier.');
export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254);
const phoneSchema = z.string().trim().regex(/^[0-9+()\-\s.]{5,25}$/, 'Enter a valid phone number.');
/** A real Indian mobile number: what the WhatsApp automation can send to. */
const mobileSchema = z.string().trim().superRefine((v, ctx) => {
  const problem = mobileProblem(v);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const pageParams = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
};
const booleanParam = z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean());

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
const customerFields = {
  name: trimmed(200).min(1, 'Customer name is required.'),
  email: z.preprocess(v => (v === '' ? null : v), emailSchema.nullable().optional()),
  phone: z.preprocess(v => (v === '' ? null : v), phoneSchema.nullable().optional()),
  company: optionalText(200),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  notes: optionalText(5000),
  lastOrderDate: isoDate.nullable().optional(),
  lastOrderAmount: z.coerce.number().min(0).max(1e12).nullable().optional(),
  totalSpent: z.coerce.number().min(0).max(1e12).optional(),
  orderCount: z.coerce.number().int().min(0).optional(),
  ownerId: uuidSchema.optional()
};

export const customerCreateSchema = z
  .object(customerFields)
  .strict()
  .refine(c => !!c.email || !!c.phone, { message: 'Provide an e-mail address or a phone number.', path: ['email'] });
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = z
  .object(customerFields)
  .partial()
  .strict()
  .refine(c => Object.keys(c).length > 0, { message: 'Nothing to update.' });
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerListQuerySchema = z.object({
  ...pageParams,
  search: trimmed(100).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  ownerId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  sort: z.enum(['createdAt', 'name', 'lastOrderAmount']).default('createdAt'),
  /** Comma-separated lifecycle stages, e.g. "ONBOARDING,CUSTOMER" for My Customers. */
  lifecycle: z
    .string()
    .regex(/^(LEAD|POTENTIAL|ONBOARDING|CUSTOMER|LOST)(,(LEAD|POTENTIAL|ONBOARDING|CUSTOMER|LOST))*$/)
    .optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerImportSchema = z.object({
  customers: z.array(z.unknown()).min(1).max(500)
});

/** One cell of the Excel import: text, number or empty. The database checks what each cell means. */
const importCell = z.union([z.string().max(2000), z.number().finite(), z.null()]).optional();
const importRow = z.object({ row: z.number().int().min(1).max(100000) }).catchall(importCell);
const importSheet = (max: number) => z.array(importRow).max(max).optional();
export const customerDataImportSchema = z
  .object({
    commit: z.boolean().default(false),
    data: z
      .object({
        customers: importSheet(500),
        services: importSheet(3000),
        whatsapp: importSheet(500),
        campaigns: importSheet(3000),
        aiCalling: importSheet(500),
        rcsVoice: importSheet(1000),
        monthly: importSheet(3000)
      })
      .strict()
  })
  .strict();

export const clientForgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254) }).strict();
/** Staff "Forgot password?" on the CRM sign-in page: the same rules as the client one. */
export const staffForgotPasswordSchema = clientForgotPasswordSchema;

// ---- Support: "Create login" on the customer's Client login card (20270218000100) ----
/** The e-mail the client will sign in with; empty = the customer's own e-mail. */
export const supportClientLoginSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254).optional() }).strict();

export const customerActivityCreateSchema = z
  .object({
    type: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Invalid activity type.'),
    note: optionalText(5000),
    occurredAt: z.string().datetime().optional()
  })
  .strict();

// ---------------------------------------------------------------------------
// Users / profiles
// ---------------------------------------------------------------------------
export const assignableRoleSchema = z.enum(['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER']);

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const DESIGNATIONS = ['Operations Head', 'Department Head', 'Team Lead', 'Team Member', 'HR Assistant', 'HR Recruiter', 'HR Admin Head', 'Department HR'] as const;
/**
 * Department HR ("HR (Digitree)", migration 20270223000100): the HR of ONE business department. Stored as a Team Member placed in that department's
 * General HR team; their HR scope is that department only (the database filters every HR function it opens for them). Only the Super Admin creates one.
 */
export const DEPARTMENT_HR_DESIGNATION = 'Department HR' as const;
/** The departments the Super Admin's form offers a Department HR for, with the team the member is placed in (created by the migration). */
export const DEPARTMENT_HR_OPTIONS = [{ departmentSlug: 'digitree', label: 'HR (Digitree)', teamName: 'Digitree HR' }] as const;
/**
 * The three designations of the HR department, and the existing role each one is (no new role system): HR Assistant and HR Recruiter are Team Members of HR,
 * HR Admin Head is the Department Head of HR. The database enforces the same rule (private.designation_problem); this copy lets the forms and the server say it first.
 */
export const HR_DESIGNATIONS = ['HR Assistant', 'HR Recruiter', 'HR Admin Head'] as const;
export type HrDesignation = (typeof HR_DESIGNATIONS)[number];
export const HR_DESIGNATION_ROLE: Record<HrDesignation, 'TEAM_MEMBER' | 'DEPARTMENT_HEAD'> = {
  'HR Assistant': 'TEAM_MEMBER', 'HR Recruiter': 'TEAM_MEMBER', 'HR Admin Head': 'DEPARTMENT_HEAD'
};
/**
 * Whether a designation fits a department and role. Mirrors private.designation_problem in the database (which is the authority): an HR employee is an HR Assistant,
 * an HR Recruiter or an HR Admin Head (the Department Head of HR) and nothing else, and those three exist in no other department. Returns the message, or null.
 */
export function designationProblem(a: { departmentSlug?: string | null; role: string; designation?: string | null; operationsHead?: boolean }): string | null {
  const { departmentSlug, role, designation, operationsHead } = a;
  if (designation === DEPARTMENT_HR_DESIGNATION) {
    if (!departmentSlug || departmentSlug === 'hr' || departmentSlug === 'accounts') return 'HR (department) is for an HR employee placed in one business department (for example Digitree), not in HR or Accounts.';
    return role === 'TEAM_MEMBER' && !operationsHead ? null : 'HR (department) is a designation of a Team Member.';
  }
  if (!designation) return departmentSlug === 'hr' && !operationsHead ? 'Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.' : null;
  if (isHrDesignation(designation)) {
    if (departmentSlug !== 'hr') return 'HR Assistant, HR Recruiter and HR Admin Head are designations of the HR department only.';
    if (designation === 'HR Admin Head') return role === 'DEPARTMENT_HEAD' && !operationsHead ? null : 'HR Admin Head is the designation of the Department Head of the HR department.';
    return role === 'TEAM_MEMBER' ? null : `${designation} is a designation of a Team Member of the HR department.`;
  }
  return departmentSlug === 'hr' && !operationsHead ? 'Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.' : null;
}
export const isHrDesignation = (d: string | null | undefined): d is HrDesignation => !!d && (HR_DESIGNATIONS as readonly string[]).includes(d);

/** A real calendar date (YYYY-MM-DD) as days since 1970, or null. */
function dayNumber(v: string): number | null {
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : Math.floor(t / 86_400_000);
}
const today = () => Math.floor(Date.now() / 86_400_000);

/**
 * A person's own phone number, as one international number: '+' and the country code and the number ('+919876543210').
 *  - '+' followed by 8 to 15 digits (E.164), whatever the country; an Indian number (+91) must have a 10 digit mobile number starting 6-9
 *  - without a '+': an Indian mobile number of 10 digits (optionally with a leading 0, or 91) is taken as +91
 *  - spaces, dashes and brackets are allowed for typing and removed. Returns null when it is not a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!/^\+?[0-9 ()-]{7,24}$/.test(s) || (s.includes('+') && !s.startsWith('+'))) return null;
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+') || digits.startsWith('00')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `91${digits}`;
  } else if (!(digits.length === 12 && digits.startsWith('91'))) {
    return null;
  }
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  if (digits.startsWith('91') && !/^91[6-9][0-9]{9}$/.test(digits)) return null;
  return `+${digits}`;
}
const sameNumber = (a: string, b: string) => a.replace(/\D/g, '').slice(-10) === b.replace(/\D/g, '').slice(-10);

/** The team member's own contact number (country code allowed, +91 by default), stored normalised. */
export const contactNumberSchema = z
  .string()
  .trim()
  .min(1, 'Enter the team member\'s contact number.')
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid contact number with its country code (for example +91 98765 43210).' });
      return z.NEVER;
    }
    return n;
  });

/** Employee details collected when a member is added (all required once sent). */
export const memberDetailsSchema = z
  .object({
    designation: z.enum(DESIGNATIONS, { errorMap: () => ({ message: 'Choose a designation.' }) }),
    joiningDate: isoDate.refine(v => {
      const d = dayNumber(v);
      return d !== null && d <= today() + 366 && d >= today() - 365 * 60;
    }, 'Enter a valid joining date.'),
    dateOfBirth: isoDate.refine(v => {
      const d = dayNumber(v);
      return d !== null && d <= today() - 365 * 14 && d >= today() - 365 * 100;
    }, 'Enter a valid date of birth (age 14 to 100).'),
    bloodGroup: z.enum(BLOOD_GROUPS, { errorMap: () => ({ message: 'Choose a blood group.' }) }),
    emergencyContact: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid emergency contact number.')
      .refine(v => v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15, 'Enter a valid emergency contact number (10 to 15 digits).'),
    /** The member's own number: a different person's number from the emergency contact. */
    contactNumber: contactNumberSchema
  })
  .strict()
  .refine(d => typeof d.contactNumber !== 'string' || typeof d.emergencyContact !== 'string' || !sameNumber(d.contactNumber, d.emergencyContact), {
    message: 'The emergency contact must be a different number from the team member\'s own number.',
    path: ['emergencyContact']
  });
export type MemberDetailsInput = z.infer<typeof memberDetailsSchema>;

export const userCreateSchema = z
  .object({
    email: emailSchema,
    fullName: trimmed(160).min(1, 'Full name is required.'),
    /** Not asked for by the screens: the server makes a random password nobody knows and the employee chooses their own from the e-mailed link. */
    password: z.string().min(10, 'Temporary password must be at least 10 characters.').max(72).optional(),
    role: assignableRoleSchema,
    departmentId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    position: optionalText(120),
    /** Team member of a support team who opens the Technical Consultant dashboard. */
    technicalConsultant: z.boolean().optional(),
    /** Team member of a support team who does the first verification of WhatsApp customers (not also a Technical Consultant). */
    metaVerifier: z.boolean().optional(),
    /** Sales role of a Sales team member (Telecaller, ...). Only a Team Member of a Sales team has one. */
    salesSubRole: z.enum(SALES_SUB_ROLES).optional(),
    /** Sales or Support side of a Department Head (a department has one head for each). */
    headDivision: z.enum(HEAD_DIVISIONS).optional(),
    /** An Operations Head oversees several departments (the Super Admin makes one; a plain Department Head works in one department). */
    operationsHead: z.boolean().optional(),
    /** The departments a NEW Operations Head supervises (one account, several departments; the first is where the person is placed). Operations Head only. */
    departmentIds: z.array(uuidSchema).min(1, 'Choose at least one department.').max(40).optional(),
    /** A Meta Verifier: the OTHER departments they verify for, besides the department they are placed in (Super Admin or the owning Operations Head). */
    verifierDepartmentIds: z.array(uuidSchema).max(40, 'Choose at most 40 departments.').optional(),
    /** More (department, function) pairs the head works in, besides their own department and side. Another DEPARTMENT is for an Operations Head only. Super Admin only. */
    additionalAccess: z.array(z.object({ departmentId: uuidSchema, division: z.enum(HEAD_DIVISIONS) }).strict()).max(40).optional(),
    /** AI Studio only: the project(s) of a new Team Lead / Team Member, and (when a Department Head or the Super Admin adds a Team Member) their Team Lead. */
    aiStudioProjectIds: z.array(uuidSchema).max(30).optional(),
    aiStudioLeadId: uuidSchema.optional(),
    /** Joining date, date of birth, blood group, emergency contact, designation. */
    details: memberDetailsSchema.optional()
  })
  .strict()
  .refine(u => !u.departmentIds?.length || u.operationsHead === true, {
    message: 'Only an Operations Head is given several departments in one step.',
    path: ['departmentIds']
  })
  .refine(u => (u.role === 'DEPARTMENT_HEAD' ? (!!u.departmentId || (u.operationsHead === true && !!u.departmentIds?.length)) && !u.teamId : !!u.teamId), {
    message: 'Department heads need a department; team heads and members need a team.',
    path: ['teamId']
  })
  .refine(u => !u.technicalConsultant || u.role === 'TEAM_MEMBER', {
    message: 'A Technical Consultant is created as a team member of a support team.',
    path: ['role']
  })
  .refine(u => !u.additionalAccess?.length || u.role === 'DEPARTMENT_HEAD', {
    message: 'Only a Department Head can work in more than one department or function.',
    path: ['additionalAccess']
  })
  .refine(u => !u.metaVerifier || u.role === 'TEAM_MEMBER', {
    message: 'A Meta Verifier is created as a team member of a support team.',
    path: ['role']
  })
  .refine(u => !u.verifierDepartmentIds?.length || u.metaVerifier === true, {
    message: 'Only a Meta Verifier verifies for other departments.',
    path: ['verifierDepartmentIds']
  })
  .refine(u => !(u.metaVerifier && u.technicalConsultant), {
    message: 'A person is either a Meta Verifier or a Technical Consultant.',
    path: ['metaVerifier']
  })
  .refine(u => !u.operationsHead || u.role === 'DEPARTMENT_HEAD', {
    message: 'Only a Department Head can be an Operations Head.',
    path: ['operationsHead']
  })
  .refine(u => !u.headDivision || u.role === 'DEPARTMENT_HEAD', {
    message: 'Only a Department Head is a Sales or Support head.',
    path: ['headDivision']
  })
  .refine(u => !u.salesSubRole || u.role === 'TEAM_MEMBER', {
    message: 'A Sales role is given to a team member of a Sales team.',
    path: ['salesSubRole']
  })
  .refine(u => !(u.salesSubRole && u.technicalConsultant), {
    message: 'A person is either a Technical Consultant or has a Sales role.',
    path: ['salesSubRole']
  })
  .refine(u => !u.aiStudioLeadId || u.role === 'TEAM_MEMBER', {
    message: 'Only a Team Member has a Team Lead to choose.',
    path: ['aiStudioLeadId']
  })
  .refine(u => !u.aiStudioProjectIds?.length || u.role === 'TEAM_HEAD' || u.role === 'TEAM_MEMBER', {
    message: 'Projects are given to Team Leads and Team Members.',
    path: ['aiStudioProjectIds']
  });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userListQuerySchema = z.object({
  ...pageParams,
  search: trimmed(100).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  departmentId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  /** With departmentId: every team of that division (e.g. all Sales teams of Wabastore). */
  division: z.enum(TEAM_DIVISIONS).optional()
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const userStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
    reason: optionalText(500)
  })
  .strict();

export const userAssignSchema = z
  .object({
    role: assignableRoleSchema,
    departmentId: uuidSchema.optional(),
    teamId: uuidSchema.optional()
  })
  .strict();

export const technicalConsultantSchema = z.object({ value: z.boolean() }).strict();
export const metaVerifierSchema = z.object({ value: z.boolean() }).strict();
export const operationsHeadSchema = z.object({ value: z.boolean(), note: optionalText(500) }).strict();

export const profileSelfUpdateSchema = z
  .object({
    fullName: trimmed(160).min(1).optional(),
    phone: z.preprocess(v => (v === '' ? null : v), phoneSchema.nullable().optional()),
    position: optionalText(120),
    avatarUrl: z.string().url().max(1000).nullable().optional()
  })
  .strict()
  .refine(p => Object.keys(p).length > 0, { message: 'Nothing to update.' });

/** Client-side sign-up form (Supabase Auth performs the actual sign-up). */
export const registrationSchema = z
  .object({
    fullName: trimmed(160).min(1, 'Please enter your full name.'),
    email: emailSchema,
    password: z.string().min(10, 'Password must be at least 10 characters.').max(72),
    confirmPassword: z.string(),
    departmentId: uuidSchema,
    teamId: uuidSchema.optional()
  })
  .refine(r => r.password === r.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });

// ---------------------------------------------------------------------------
// Approvals, notifications, organisation, audit
// ---------------------------------------------------------------------------
export const approvalListQuerySchema = z.object({
  ...pageParams,
  status: z.enum(APPROVAL_STATUSES).default('PENDING')
});

export const approvalDecisionSchema = z
  .object({
    teamId: uuidSchema.optional(),
    note: optionalText(500)
  })
  .strict();

export const notificationListQuerySchema = z.object({
  ...pageParams,
  unreadOnly: booleanParam.default(false)
});

export const announcementSchema = z
  .object({
    title: trimmed(200).min(1, 'Title is required.'),
    body: trimmed(2000).default(''),
    priority: z.enum(NOTIFICATION_PRIORITIES).default('announcement'),
    departmentId: uuidSchema.optional(),
    division: z.enum(TEAM_DIVISIONS).optional()
  })
  .strict();

const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes.');
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #3B82F6.');

export const departmentCreateSchema = z
  .object({
    name: trimmed(120).min(2, 'Department name is required.'),
    slug: slugSchema.optional(),
    description: trimmed(1000).default(''),
    category: optionalText(120),
    iconName: trimmed(40).optional(),
    accentColor: colorSchema.optional(),
    logoUrl: optionalText(1000)
  })
  .strict();

/** A refused sign-in reported by the sign-in page: only what was typed in the e-mail box (it is never trusted as who someone is). */
export const loginFailureReportSchema = z
  .object({ identifier: z.string().max(254).optional() })
  .strict();

export const departmentUpdateSchema = z
  .object({
    name: trimmed(120).min(2).optional(),
    description: trimmed(1000).optional(),
    category: optionalText(120),
    iconName: trimmed(40).optional(),
    accentColor: colorSchema.optional(),
    logoUrl: optionalText(1000)
  })
  .strict()
  .refine(d => Object.keys(d).length > 0, { message: 'Nothing to update.' });

export const teamCreateSchema = z
  .object({
    departmentId: uuidSchema,
    name: trimmed(120).min(2, 'Team name is required.'),
    division: z.enum(TEAM_DIVISIONS).default('GENERAL')
  })
  .strict();

export const teamUpdateSchema = z
  .object({
    name: trimmed(120).min(2).optional(),
    division: z.enum(TEAM_DIVISIONS).optional()
  })
  .strict()
  .refine(t => Object.keys(t).length > 0, { message: 'Nothing to update.' });

export const teamListQuerySchema = z.object({ departmentId: uuidSchema.optional() });

/** The security and audit log viewer: search, filters and pages (read-only). */
export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export const auditSearchQuerySchema = z.object({
  ...pageParams,
  q: z.string().trim().max(100).optional(),
  action: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  entityType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});

/** A scoped dashboard overview: only the Super Admin may name a department (everyone else gets their own scope). */
export const dashboardScopeQuerySchema = z.object({ departmentId: uuidSchema.optional() });

// --- Super Admin Overview by department: attendance today (or a chosen day) and each department's business in a period ---
export const overviewDepartmentsQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional(), attendanceDate: isoDate.optional() })
  .refine(q => !q.from || !q.to || q.from <= q.to, { message: 'Choose a period that ends on or after its start.', path: ['to'] });
export type OverviewDepartmentsQuery = z.infer<typeof overviewDepartmentsQuerySchema>;

/** A browser-side export (CSV and the like) is recorded: what it was and how many rows. */
export const dataExportSchema = z
  .object({
    dataset: z.string().trim().regex(/^[a-z_]{1,40}$/, 'Unknown dataset.'),
    rows: z.coerce.number().int().min(0).max(10_000_000),
    note: z.string().trim().max(200).optional()
  })
  .strict();

export const auditListQuerySchema = z.object({
  ...pageParams,
  action: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
  entityType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  entityId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  teamId: uuidSchema.optional()
});

// ---------------------------------------------------------------------------
// Sales pipeline
// ---------------------------------------------------------------------------
const serviceCodes = z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/)).max(40);
const datetime = z.string().datetime({ offset: true });

// ---- Subscription terms: Sales names the plan, the duration, the amount and the credits. There is no field for a start or an expiry date. ----
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const subscriptionTermsBase = z
  .object({
    plan: trimmed(120).min(1, 'Enter the subscription plan.'),
    durationCode: z.enum(SUBSCRIPTION_DURATIONS, { errorMap: () => ({ message: 'Choose the subscription duration.' }) }),
    customMonths: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Enter a whole number of months.' }).int('Enter a whole number of months.').min(1, 'At least 1 month.').max(120, 'At most 120 months.').optional()),
    customDays: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Enter a whole number of days.' }).int('Enter a whole number of days.').min(1, 'At least 1 day.').max(3650, 'At most 3650 days.').optional()),
    amount: z.preprocess(blankToUndefined, z.coerce.number({ required_error: 'Enter the subscription amount.', invalid_type_error: 'Enter the subscription amount.' }).min(0, 'The amount cannot be negative.').max(99999999, 'That amount is too large.')),
    messageCredits: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Enter the message credits as a whole number.' }).int('Enter the message credits as a whole number.').min(0, 'The credits cannot be negative.').max(2000000000, 'That is too many credits.').optional()),
    panel: optionalText(120)
  })
  .strict();
const refineTerms = (v: { durationCode: string; customMonths?: number; customDays?: number }, ctx: z.RefinementCtx) => {
  if (v.durationCode === 'CUSTOM') {
    if ((v.customMonths === undefined) === (v.customDays === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['customMonths'], message: 'Enter the custom duration in months or in days (one of them).' });
    }
  } else if (v.customMonths !== undefined || v.customDays !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['customMonths'], message: 'Custom months or days are for the Custom duration only.' });
  }
};
export const subscriptionTermsSchema = subscriptionTermsBase.superRefine(refineTerms);
export type SubscriptionTermsInput = z.infer<typeof subscriptionTermsSchema>;
const serviceCodeOne = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.');
export const leadSubscriptionsSchema = z
  .array(subscriptionTermsBase.extend({ service: serviceCodeOne }).superRefine(refineTerms))
  .max(40)
  .refine(a => new Set(a.map(x => x.service)).size === a.length, { message: 'Each service can have only one subscription.' });

const leadFields = {
  name: trimmed(200).min(1, 'Customer name is required.'),
  company: trimmed(200).min(1, 'Business name is required.'),
  phone: mobileSchema,
  whatsapp: z.preprocess(v => (v === '' ? null : v), mobileSchema.nullable().optional()),
  email: z.preprocess(v => (v === '' ? null : v), emailSchema.nullable().optional()),
  city: optionalText(120),
  address: optionalText(500),
  businessCategory: optionalText(120),
  leadSource: trimmed(60).min(1, 'Lead source is required.'),
  leadStatus: z.enum(LEAD_STATUSES).optional(),
  nextFollowUpAt: z.preprocess(v => (v === '' ? null : v), datetime.nullable().optional()),
  expectedBudget: z.preprocess(v => (v === '' || v === null ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional()),
  notes: optionalText(5000)
};

// ---- AI Website client onboarding (migration 20270113000200) ----------------------------------------------------------------------------
/** The service whose leads carry the AI Website onboarding details. */
export const AI_WEBSITE_SERVICE = 'AI_WEBSITE';
/** The types of business offered (the CRM's business categories; the database holds the same list: private.ai_website_business_types). */
export const AI_WEBSITE_BUSINESS_TYPES = [
  'Jewellery / Gold', 'Retail', 'Restaurant / Food', 'Healthcare', 'Education', 'Real Estate',
  'Beauty / Salon', 'Fitness', 'Manufacturing', 'Services', 'Other'
] as const;
/** A 10-digit Indian mobile number; spaces and dashes, and a leading +91 / 91 / 0, are removed. */
const aiWebsiteMobile = z.preprocess(
  v => (typeof v === 'string' ? v.replace(/[\s\-()]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '') : v),
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.')
);
export const aiWebsiteOnboardingSchema = z
  .object({
    clientName: trimmed(160).min(1, 'Client name is required.'),
    mobile: aiWebsiteMobile,
    email: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), emailSchema.optional()).refine(v => !!v, 'Email is required.'),
    businessName: trimmed(200).min(1, 'Business name is required.'),
    onGoogleMaps: z.boolean({ required_error: 'Choose whether the business is on Google Maps.', invalid_type_error: 'Choose whether the business is on Google Maps.' }),
    googleMapsLink: z.preprocess(
      v => (typeof v === 'string' && v.trim() === '' ? null : v),
      trimmed(500).regex(/^https?:\/\/\S+$/i, 'Enter the Google Maps link as a web address (https://...).').nullable().optional()
    ),
    city: trimmed(80).min(1, 'City is required.'),
    businessType: z.enum(AI_WEBSITE_BUSINESS_TYPES, { errorMap: () => ({ message: 'Choose the type of business.' }) }),
    businessTypeOther: optionalText(120)
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.businessType === 'Other' && !v.businessTypeOther) ctx.addIssue({ code: 'custom', path: ['businessTypeOther'], message: 'Type the type of business.' });
  })
  // a link belongs to a business that is on Google Maps; another type than "Other" needs no typed type
  .transform(v => ({ ...v, googleMapsLink: v.onGoogleMaps ? v.googleMapsLink ?? null : null, businessTypeOther: v.businessType === 'Other' ? v.businessTypeOther ?? null : null }));
export type AiWebsiteOnboardingInput = z.infer<typeof aiWebsiteOnboardingSchema>;
/** What a form sends (before the schema trims and normalises it). */
export type AiWebsiteOnboardingBody = z.input<typeof aiWebsiteOnboardingSchema>;

export const leadCreateSchema = z
  .object({ ...leadFields, services: serviceCodes.min(1, 'Select at least one service.'), ownerId: uuidSchema.optional(), subscriptions: leadSubscriptionsSchema.optional(), aiWebsiteOnboarding: aiWebsiteOnboardingSchema.optional() })
  .strict();
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z
  .object(leadFields)
  .partial()
  .extend({
    services: serviceCodes.min(1, 'Select at least one service.').optional(),
    subscriptions: leadSubscriptionsSchema.optional(),
    activityNote: optionalText(500),
    aiWebsiteOnboarding: aiWebsiteOnboardingSchema.optional()
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const pipelineListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  stage: z.enum(PIPELINE_STAGES),
  search: trimmed(100).optional(),
  service: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
  source: trimmed(60).optional(),
  leadStatus: z.enum(LEAD_STATUSES).optional(),
  /** Leads with this tag (migration 20270308000100). */
  leadTagId: uuidSchema.optional(),
  /** Follow-up window computed by the client in the user's timezone. */
  followUpFrom: datetime.optional(),
  followUpTo: datetime.optional(),
  noFollowUp: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  payment: z.enum(PAYMENT_FILTERS).optional(),
  /** Leads tabs: with Accounts for payment confirmation / returned by Accounts. */
  accounts: z.enum(['WITH_ACCOUNTS', 'RETURNED']).optional(),
  onboarding: z.enum(ONBOARDING_FILTERS).optional(),
  /** Technical Consultant queue: customers sent to support (or sent back and waiting for sales). */
  review: z.enum(REVIEW_FILTERS).optional(),
  /** Hand-over stage (Department Head / Team Lead / Team Member inboxes). */
  handover: z.enum(HANDOVER_STAGES).optional(),
  /** Only customers handed to the caller as Team Lead / as Team Member. */
  handoverMine: z.enum(['TEAM_LEAD', 'TEAM_MEMBER']).optional(),
  forwarded: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  /** Technical Consultant Customers panel: sent to them, not yet sent for onboarding or to Add-ons. */
  intake: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  /** Technical Consultant Add-ons Services section: customers sent to Add-ons. */
  addons: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  /** Super Admin / Department Head: every team of this division in the department (the sub-department), and optionally one owner. */
  departmentId: uuidSchema.optional(),
  division: z.enum(TEAM_DIVISIONS).optional(),
  ownerId: uuidSchema.optional(),
  /** Only records owned by the caller (e.g. a support member's own pipeline). */
  mine: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  sort: z.enum(['newest', 'oldest', 'followUp', 'dueDate', 'amount', 'name']).default('newest')
});
export type PipelineListQuery = z.infer<typeof pipelineListQuerySchema>;

export const divisionOverviewQuerySchema = z.object({
  departmentId: uuidSchema,
  division: z.enum(TEAM_DIVISIONS)
});
export type DivisionOverviewQuery = z.infer<typeof divisionOverviewQuerySchema>;

export const moveToPotentialSchema = z
  .object({
    dealAmount: z.coerce.number().positive('Enter the deal amount.').int('Enter the deal amount in whole rupees (no paise).').max(1e12),
    paymentDueDate: isoDate
  })
  .strict();

export const recordPaymentSchema = z
  .object({
    amount: z.coerce.number().positive('Enter the amount received.').int('Enter the amount received in whole rupees (no paise).').max(1e12),
    method: z.enum(PAYMENT_METHODS).optional()
  })
  .strict();

export const startOnboardingSchema = z
  .object({
    amountReceived: z.coerce.number().min(0).int('Enter the amount received in whole rupees (no paise).').max(1e12).default(0),
    paymentMethod: z.enum(PAYMENT_METHODS),
    targetHandoverDate: isoDate.nullable().optional()
  })
  .strict();

export const onboardingUpdateSchema = z.object({ targetHandoverDate: isoDate.nullable() }).strict();

/** File types the private document bucket accepts (checked again by content on the server). */
export const UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4'
] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

export const checklistSaveSchema = z.object({ value: z.string().trim().min(1, 'Enter a value.').max(4000) }).strict();
export const checklistReviewSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    note: z.string().trim().max(1000).optional().nullable()
  })
  .strict()
  .refine(v => v.decision === 'VERIFIED' || !!v.note, { message: 'Tell the sales team what needs fixing.', path: ['note'] });
export const backOutSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() }).strict();
export const returnToSalesSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() }).strict();
export const checklistItemCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown item.');

export const documentUploadSchema = z
  .object({
    documentType: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown document type.'),
    fileName: trimmed(255).min(1),
    mimeType: z.enum(UPLOAD_MIME_TYPES, { errorMap: () => ({ message: 'This file type is not accepted.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(CUSTOMER_DOCUMENT_MAX_BYTES, `File size exceeds the ${CUSTOMER_DOCUMENT_MAX_LABEL} limit.`)
  })
  .strict();

export const consultantWebsiteSchema = z
  .object({
    url: z.string().superRefine((v, ctx) => {
      const r = normalizeWebsite(v);
      if (r.error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
    })
  })
  .strict()
  .transform(b => ({ url: normalizeWebsite(b.url).url as string }));

export const clientAccountSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254),
    password: z.string().min(10, 'The password must be at least 10 characters.').max(72)
  })
  .strict();

export const accountsQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  });
export const consultantContractSchema = z.object({ signed: z.boolean() }).strict();
export const consultantAddonsRequiredSchema = z.object({ required: z.boolean() }).strict();
export const consultantNoteSchema = z
  .object({ body: z.string().trim().min(1, 'Write the note first.').max(4000, 'Keep the note under 4000 characters.'), serviceCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).nullish() })
  .strict();
export const consultantNoteUpdateSchema = z.object({ body: z.string().trim().min(1, 'Write the note first.').max(4000, 'Keep the note under 4000 characters.') }).strict();
export const consultantDetailsSchema = z
  .object({
    name: trimmed(200).min(2, 'Enter the customer\'s name.'),
    company: trimmed(200).optional().nullable(),
    phone: z.preprocess(v => (v === '' ? null : v), mobileSchema.nullable().optional()),
    email: trimmed(254).optional().nullable(),
    /** updated_at the form was loaded with: a save from a stale form is refused. */
    expectedUpdatedAt: z.string().max(40).optional().nullable()
  })
  .strict();
export const handoverNoteSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() }).strict();
export const passToTeamLeadSchema = z.object({ teamLeadId: uuidSchema, note: z.string().trim().max(1000).optional().nullable() }).strict();
export const assignToMemberSchema = z.object({ memberId: uuidSchema, note: z.string().trim().max(1000).optional().nullable() }).strict();


// ---------------------------------------------------------------------------
// Conversations, Sales → Accounts payments, Part Payments
// ---------------------------------------------------------------------------
export const conversationSchema = z.object({ note: trimmed(5000).min(1, 'Write what was discussed.') }).strict();

const wholeRupees = (message: string) => z.coerce.number().positive(message).int('Enter the amount in whole rupees (no paise).').max(1e12);

/**
 * Creating the login takes no e-mail: it is the one on the customer record. The only choice is HOW the client gets in:
 * LINK (an e-mailed one-time set-password link, the default) or TEMPORARY (a server-made temporary password in the e-mail; the client
 * must choose their own at the first sign-in). The password itself is never part of a request.
 */
export const accountsClientLoginSchema = z.object({ method: z.enum(['LINK', 'TEMPORARY']).default('LINK') }).strict();
/** The client's own new password (forced change after a temporary one, or after the recovery link). The same rules as the set-password page. */
export const clientNewPasswordSchema = z
  .object({ password: z.string().min(10, 'Use at least 10 characters.').max(72, 'Use at most 72 characters.') })
  .strict();
/**
 * Meta Verifier: the password they set on the customer's WhatsApp panel, to be e-mailed to the customer. `requestId` is made by the screen
 * once per click-intent, so a retried request is not sent twice. The password is encrypted by the API before it reaches the database.
 */
export const panelCredentialsSchema = z
  .object({ password: z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.'), requestId: uuidSchema })
  .strict();
/** Accounts' client-login queue. The login's e-mail is never part of a request: it is the one on the customer record. */
export const provisioningQuerySchema = z.object({
  status: z.enum(['ALL', 'NOT_STARTED', 'PENDING', 'FAILED', 'CREATED']).default('ALL'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
/** Accounts corrects a wrong or missing e-mail on the customer record before a login is made (audited). */
export const customerEmailCorrectionSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254),
    reason: z.string().trim().min(3, 'Give the reason for changing the e-mail.').max(300)
  })
  .strict();
export const sendToDeliverySchema = z.object({ note: optionalText(1000) }).strict();
export const deliveryQueueQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
export const serviceJourneySchema = z
  .object({ requiresTechnicalConsultant: z.boolean(), deliveryDepartmentId: uuidSchema.nullable().optional() })
  .strict()
  .refine(v => v.requiresTechnicalConsultant || !!v.deliveryDepartmentId, { path: ['deliveryDepartmentId'], message: 'Choose the department that delivers this service.' });

export const AGREEMENT_TAX_BASES = ['INCLUSIVE', 'EXCLUSIVE'] as const;
export const sendToAccountsSchema = z
  .object({
    amount: wholeRupees('Enter the agreed amount.'),
    note: optionalText(1000),
    /** Ignored: Sales no longer decides about GST (Accounts adds it, line by line, on the invoice). Kept so older callers still work. */
    taxBasis: z.enum(AGREEMENT_TAX_BASES, { errorMap: () => ({ message: 'Say whether the agreed amount includes or excludes GST.' }) }).default('EXCLUSIVE')
  })
  .strict();
export const agreementBasisSchema = z
  .object({
    basis: z.enum(AGREEMENT_TAX_BASES, { errorMap: () => ({ message: 'Say whether the agreed amount includes or excludes GST.' }) }),
    reason: z.string().trim().min(5, 'Say why the agreement is being changed (at least 5 characters).').max(500)
  })
  .strict();

const paymentFields = {
  type: z.enum(PAYMENT_TYPES, { errorMap: () => ({ message: 'Choose part payment or full payment.' }) }),
  /** The money actually received, in whole rupees. It is checked against the total payable including GST; GST is chosen for the order, never on a payment. */
  amount: wholeRupees('Enter the amount received.'),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Select the payment method.' }) }),
  reference: optionalText(120),
  paidAt: z.preprocess(v => (v === '' ? null : v), datetime.nullable().optional()),
  note: optionalText(1000)
};
export const accountsRecordPaymentSchema = z
  .object({ ...paymentFields, verify: z.boolean().default(false), invoice: z.boolean().default(true) })
  .strict()
  .refine(v => ['CASH', 'OTHER'].includes(v.method) || !!v.reference, { message: 'Enter the transaction / reference number.', path: ['reference'] });
export const accountsUpdatePaymentSchema = z.object(paymentFields).strict();
/** The GST rate of the order (one of the configured rates; the database checks the list). */
export const orderGstSchema = z.object({ rate: z.coerce.number({ invalid_type_error: 'Choose the GST rate.' }).min(0, 'Choose the GST rate.').max(28, 'Choose the GST rate.') }).strict();
/** `invoice`: also make and send the paid invoice of the payment (the default). */
export const paymentDecisionSchema = z.object({ note: optionalText(500), invoice: z.boolean().default(true) }).strict();
export const paymentReasonSchema = z.object({ reason: trimmed(500).min(1, 'Give the reason.') }).strict();
export const accountsConfirmReturnSchema = z.object({ note: optionalText(1000) }).strict();
export const accountsBackOffSchema = z.object({ reason: optionalText(1000) }).strict();
export const assignPaymentOwnerSchema = z.object({ ownerId: uuidSchema.nullable() }).strict();
export const paymentFollowUpSchema = z
  .object({
    outcome: z.enum(FOLLOWUP_OUTCOMES, { errorMap: () => ({ message: 'Choose the outcome of the follow-up.' }) }),
    note: trimmed(2000).min(1, 'Write a note about the follow-up.'),
    nextFollowUpAt: z.preprocess(v => (v === '' ? null : v), datetime.nullable().optional())
  })
  .strict();

export const paymentRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'RETURNED']).default('PENDING'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const partPaymentsQuerySchema = z.object({
  status: z.enum(['PARTIAL', 'PAID', 'RETURNED', 'ALL']).default('PARTIAL'),
  search: z.string().trim().max(100).optional(),
  salesperson: uuidSchema.optional(),
  accountsOwner: uuidSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  followUp: z.enum(['FOLLOW_UP_REQUIRED', 'CONTACTED', 'AWAITING_PAYMENT', 'FULLY_PAID']).optional(),
  sort: z.enum(['recent', 'balance', 'name', 'followUp']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Super Admin / Department Head: one sub-department (department + team division). */
  departmentId: uuidSchema.optional(),
  division: z.enum(TEAM_DIVISIONS).optional()
});
export type PartPaymentsQuery = z.infer<typeof partPaymentsQuerySchema>;

// ---------------------------------------------------------------------------
// Accounts finance
// ---------------------------------------------------------------------------
const money2 = z.coerce.number().positive('Enter the amount.').max(1e12).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places.');

export const expenseAllocationSchema = z.object({ departmentId: uuidSchema, amount: money2 }).strict();
export const expenseSchema = z
  .object({
    date: isoDate,
    description: trimmed(300).min(1, 'Describe the expense.'),
    /** The older way: one department (or none = company-wide). Not together with `allocations`. */
    departmentId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional()),
    category: trimmed(80).min(1, 'Enter the category.'),
    amount: money2,
    status: z.enum(['PAID', 'PENDING']).default('PAID'),
    notes: optionalText(1000),
    /** One expense, several departments: who bears how much. The parts must add up to `amount` (checked here and again by the database). No rows = company-wide. */
    allocations: z.array(expenseAllocationSchema).max(30, 'At most 30 department rows.').optional(),
    /** One per click of "Add expense": a retry with the same id returns the same expense. */
    requestId: uuidSchema.optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.allocations || v.allocations.length === 0) return;
    if (v.departmentId) ctx.addIssue({ code: 'custom', path: ['departmentId'], message: 'Send one department or a list of department amounts, not both.' });
    if (new Set(v.allocations.map(a => a.departmentId)).size !== v.allocations.length) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Each department can appear only once.' });
    }
    // exact: in paise, so 33.33 + 33.33 + 33.34 is 100.00 and nothing is lost to floating point
    const sum = v.allocations.reduce((a, r) => a + Math.round(r.amount * 100), 0);
    if (sum !== Math.round(v.amount * 100)) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'The department amounts must add up to the expense amount.' });
    }
  });
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const financeSummaryQuerySchema = z.object({ departmentId: uuidSchema.optional(), from: isoDate.optional(), to: isoDate.optional() });
export const incomeQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  departmentId: uuidSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
export const expensesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  departmentId: uuidSchema.optional(),
  companyWide: booleanParam.optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(['PAID', 'PENDING']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
export const customerRevenueQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  serviceCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.').optional(),
  departmentId: uuidSchema.optional(),
  sort: z.enum(['PURCHASED', 'INVOICED', 'COLLECTED', 'PENDING', 'OUTSTANDING', 'ORDERS', 'NAME']).default('PURCHASED'),
  dir: z.enum(['ASC', 'DESC']).default('DESC'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export const financeMailQuerySchema = z.object({
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'NO_RECIPIENT', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
export const trendQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) });
export const expenseImportSchema = z
  .object({
    source: z.enum(['GOOGLE_SHEET', 'IMPORT']).default('IMPORT'),
    rows: z
      .array(
        z
          .object({
            externalId: trimmed(200).min(1),
            date: isoDate,
            description: trimmed(300).min(1),
            departmentSlug: trimmed(80).optional().nullable(),
            category: trimmed(80).min(1),
            amount: money2,
            status: z.enum(['PAID', 'PENDING']).optional(),
            notes: optionalText(1000)
          })
          .strict()
      )
      .min(1)
      .max(1000)
  })
  .strict();


// ---------------------------------------------------------------------------
// Add-on requests and invoices
// ---------------------------------------------------------------------------
const amount2 = (msg: string) =>
  z.coerce.number().min(0, msg).max(1e8, msg).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places.');
export const pricedLineSchema = z
  .object({
    serviceCode: z.preprocess(v => (v === '' ? null : v), z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).nullable().optional()),
    name: trimmed(120).optional(),
    quantity: z.coerce.number().int('Use a whole number.').min(1, 'At least 1.').max(1000).default(1),
    unitPrice: amount2('Enter the agreed price.'),
    discount: amount2('Enter the discount.').default(0),
    taxPercent: z.coerce.number().min(0, 'Tax is 0 to 100 %.').max(100, 'Tax is 0 to 100 %.').default(0)
  })
  .strict()
  .refine(l => !!l.serviceCode || (l.name ?? '').length >= 2, { message: 'Choose a service or type its name.', path: ['name'] });
export type PricedLineInput = z.infer<typeof pricedLineSchema>;
const pricedLines = z.array(pricedLineSchema).min(1, 'Add at least one service.').max(30, 'Add at most 30 lines.');

export const addonRequestSaveSchema = z
  .object({
    items: pricedLines,
    notes: optionalText(2000),
    submit: z.boolean().optional(),
    expectedVersion: z.number().int().positive().optional()
  })
  .strict();
export type AddonRequestSaveInput = z.infer<typeof addonRequestSaveSchema>;

export const addonDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'CHANGES']),
    note: optionalText(1000),
    expectedVersion: z.number().int().positive().optional()
  })
  .strict()
  .refine(d => d.decision === 'APPROVE' || !!(d.note && d.note.trim()), { message: 'Give the reason, so the consultant knows what to do.', path: ['note'] });

export const addonPaymentSchema = z
  .object({
    amount: money2,
    method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Select the payment method.' }) }),
    reference: optionalText(120),
    paidAt: z.string().datetime({ offset: true }).optional().nullable(),
    note: optionalText(1000),
    verify: z.boolean().optional()
  })
  .strict();

export const addonPaymentDecisionSchema = z
  .object({ decision: z.enum(['VERIFY', 'REJECT']), reason: optionalText(500) })
  .strict()
  .refine(d => d.decision === 'VERIFY' || !!(d.reason && d.reason.trim()), { message: 'Give the reason for rejecting this payment.', path: ['reason'] });

export const noteBodySchema = z.object({ note: optionalText(1000) }).strict();

/** The PDF of an uploaded invoice: PDF only, at most 500 KB (the database and the bucket check it again). */
const invoicePdfFields = {
  fileName: trimmed(255).min(1, 'Choose the invoice PDF.'),
  mimeType: z.literal('application/pdf', { errorMap: () => ({ message: 'Only PDF files are accepted for invoices.' }) }),
  sizeBytes: z.coerce
    .number({ invalid_type_error: 'The file size is missing.' })
    .int()
    .positive('This file is empty.')
    .max(INVOICE_PDF_MAX_BYTES, `File size exceeds the ${INVOICE_PDF_MAX_LABEL} limit. Please upload a smaller PDF.`)
};
/** Optional: the accountant only chooses the PDF, a blank number is numbered by the database. */
const invoiceNumber = z
  .string()
  .trim()
  .max(60, 'The invoice number is too long.')
  .regex(/^([A-Za-z0-9][A-Za-z0-9 ./#_-]*)?$/, 'The invoice number can use letters, numbers, spaces and - / . # _')
  .optional()
  .nullable();
export const invoiceUploadSchema = z
  .object({
    customerId: uuidSchema,
    invoiceNumber,
    issueDate: isoDate.optional().nullable(),
    dueDate: isoDate.optional().nullable(),
    amount: z.coerce.number().min(0).max(9999999999.99).refine(n => Math.round(n * 100) / 100 === n, 'Use at most 2 decimals.').optional().nullable(),
    reference: optionalText(120),
    note: optionalText(1000),
    ...invoicePdfFields
  })
  .strict();
export const addonInvoiceUploadSchema = z
  .object({
    invoiceNumber,
    issueDate: isoDate.optional().nullable(),
    dueDate: isoDate.optional().nullable(),
    reference: optionalText(120),
    note: optionalText(1000),
    ...invoicePdfFields
  })
  .strict();
export const invoiceReplaceSchema = z.object({ ...invoicePdfFields }).strict();
export const invoiceDetailsSchema = z
  .object({
    issueDate: isoDate.optional().nullable(),
    dueDate: isoDate.optional().nullable(),
    amount: z.coerce.number().min(0).max(9999999999.99).refine(n => Math.round(n * 100) / 100 === n, 'Use at most 2 decimals.').optional().nullable(),
    reference: optionalText(120),
    note: optionalText(1000)
  })
  .strict();
export const invoiceStatusSchema = z.object({ status: z.enum(['Paid', 'Pending']) }).strict();

// ---------------------------------------------------------------------------
// Generated invoices (the Accounts invoice builder). Only what the person types is accepted: no total, GST amount or
// amount in words - the database recalculates every figure. Unknown fields are refused, not ignored.
// ---------------------------------------------------------------------------
/** Rupees typed as a number or text; kept as an exact decimal string for the database (up to 2 decimals, more than zero). */
const moneyField = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const p = toPaise(v);
      if (p === null || p <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Enter ${label} in rupees (more than zero, up to 2 decimals).` });
        return z.NEVER;
      }
      return paiseToDecimal(p);
    });
const taxRateField = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const bp = toRateBp(v);
  if (bp === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the GST rate for the line (a percentage from 0 to 100; 0 when there is no GST).' });
    return z.NEVER;
  }
  return bp / 100;
});
export const invoiceLineSchema = z
  .object({
    serviceCode: z.preprocess(v => (v === '' ? null : v), z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.').nullable().optional()),
    particulars: z.string().trim().min(2, 'Enter the particulars (the service description).').max(500, 'Keep the particulars under 500 characters.'),
    hsnSac: z.string().trim().regex(/^[0-9]{4,8}$/, 'The HSN/SAC code is 4 to 8 digits.').default('998313'),
    taxRate: taxRateField,
    quantity: z.string().trim().min(1, 'Enter the quantity (for example 1 Nos, 1 Year or 30K Msg).').max(30, 'Keep the quantity under 30 characters.'),
    baseAmount: moneyField('the invoice amount')
  })
  .strict();
export const generatedInvoiceIssueSchema = z
  .object({
    /** One per click of "Generate & Send Invoice": a retry with the same id returns the same invoice. */
    requestId: uuidSchema,
    customerId: uuidSchema,
    purpose: z.enum(INVOICE_PURPOSES),
    addonRequestId: uuidSchema.nullable().optional(),
    /** Always empty: the number is assigned by the database when the invoice is issued (GST/26-27/001 or Amuwa/26-27/001). A typed number is refused there. */
    invoiceNumber: z.preprocess(
      v => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(60).nullable().optional()
    ),
    invoiceDate: isoDate,
    orderNumber: z.string().trim().min(1).max(60).default('Verbal'),
    customer: z
      .object({
        name: z.string().trim().max(200).default(''),
        businessName: optionalText(200),
        address: z.string().trim().min(1, 'Enter the business address.').max(500, 'Keep the address under 500 characters.'),
        contactPerson: optionalText(200),
        contactNumber: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), phoneSchema.nullable().optional()),
        gstin: z.preprocess(
          v => (typeof v === 'string' ? normalizeGstin(v) || null : v),
          z.string().nullable().optional().refine(v => !v || isValidGstinFormat(v), 'The GSTIN is not valid. Check it against the customer\'s GST certificate.')
        ),
        stateCode: z.string().trim().regex(/^[0-9]{2}$/, 'Choose the customer\'s state.')
      })
      .strict(),
    taxTreatment: z.enum(TAX_TREATMENTS),
    taxOverrideReason: optionalText(300),
    acknowledgeStateMismatch: z.boolean().default(false),
    reverseCharge: z.boolean().default(false),
    terms: z.string().trim().max(2000).default('100% Payment Against supply.'),
    lines: z.array(invoiceLineSchema).min(1, 'Add at least one service line.').max(MAX_LINES, `An invoice can have at most ${MAX_LINES} lines.`)
  })
  .strict()
  .refine(v => !!(v.customer.name || v.customer.businessName), { path: ['customer', 'name'], message: 'Enter the customer or business name.' })
  .refine(v => v.purpose !== 'ADDON' || !!v.addonRequestId, { path: ['addonRequestId'], message: 'Choose the add-on request.' });
export type GeneratedInvoiceIssueInput = z.infer<typeof generatedInvoiceIssueSchema>;
export const invoicePrefillQuerySchema = z.object({ purpose: z.enum(INVOICE_PURPOSES).default('SERVICES'), addonRequestId: uuidSchema.optional() });
export const invoiceConfirmPaymentSchema = z
  .object({
    /** Needed only when a payment is recorded on the invoice itself; otherwise the verified payments on record decide. */
    method: z.preprocess(v => (v === '' ? null : v), z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Choose how the payment was received.' }) }).nullable().optional()),
    reference: optionalText(120),
    note: optionalText(1000),
    paidOn: isoDate.nullable().optional(),
    /** Rupees received now (up to 2 decimals); blank: the whole remaining balance. */
    amount: z.preprocess(
      v => (v === '' || v === null ? undefined : v),
      z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
        if (v === undefined) return undefined;
        const paise = toPaise(v);
        if (paise === null || paise <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the amount received in rupees (more than zero, up to 2 decimals).' });
          return z.NEVER;
        }
        return paiseToDecimal(paise);
      })
    ),
    /** One per click: a retry with the same id records the payment once. */
    requestId: uuidSchema.optional()
  })
  .strict();
export const invoiceDeliverSchema = z.object({ stage: z.enum(INVOICE_STAGES) }).strict();
/** "Generate invoice" on a payment: the billing details the customer record lacks (address, state ...) typed by Accounts with the click. Nothing else rides along. */
export const paymentInvoiceInputSchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().max(200).optional(),
        businessName: z.string().trim().max(200).optional(),
        address: z.string().trim().max(500, 'Keep the address under 500 characters.').optional(),
        contactPerson: z.string().trim().max(200).optional(),
        contactNumber: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), phoneSchema.optional()),
        gstin: z.preprocess(
          v => (typeof v === 'string' ? normalizeGstin(v) || undefined : v),
          z.string().optional().refine(v => !v || isValidGstinFormat(v), 'The GSTIN is not valid. Check it against the customer\'s GST certificate.')
        ),
        stateCode: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().regex(/^[0-9]{2}$/, 'Choose the customer\'s state.').optional())
      })
      .strict()
      .optional()
  })
  .strict();
/** Cancelling a wrongly made invoice of the agreed services: a reason is always given (the database checks it again). */
export const invoiceCancelSchema = z.object({ reason: trimmed(500).min(5, 'Give the reason for cancelling this invoice (at least 5 characters).') }).strict();
export const invoiceWhatsAppRequestSchema = z.object({ resend: z.boolean().default(false) }).strict();
export const invoiceWhatsAppSettingsSchema = z
  .object({
    enabled: z.boolean(),
    autoSend: z.boolean(),
    templateName: z.string().trim().max(255).nullable().optional(),
    templateLanguage: z.string().trim().max(10).optional(),
    templateApproved: z.boolean()
  })
  .strict();
/** The lead welcome WhatsApp (docs/LEAD_WHATSAPP.md): which CRM value fills each of the template's variables, in order. */
export const LEAD_WHATSAPP_VARIABLES = ['LEAD_NAME', 'LEAD_COMPANY', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE'] as const;
export const leadWhatsAppSettingsSchema = z
  .object({
    enabled: z.boolean(),
    templateName: z.string().trim().max(255).nullable().optional(),
    templateLanguage: z.string().trim().max(10).optional(),
    templateApproved: z.boolean(),
    variables: z.array(z.enum(LEAD_WHATSAPP_VARIABLES)).max(10, 'At most 10 template variables.')
  })
  .strict();
export const invoiceFileQuerySchema = z.object({ stage: z.enum(INVOICE_STAGES), action: z.enum(['view', 'download']).default('view') });

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
};
export const addonRequestsQuerySchema = z.object({
  status: z.enum(ADDON_REQUEST_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  consultant: uuidSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pageQuery
});
export const invoicesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  kind: z.enum(['MANUAL', 'SERVICE', 'ADDON', 'UPLOADED', 'GENERATED']).optional(),
  status: z.enum(['Paid', 'Pending', 'Overdue']).optional(),
  ...pageQuery
});
export const invoiceCustomersQuerySchema = z.object({ search: z.string().trim().max(100).optional() });

// ---------------------------------------------------------------------------
// Client dashboard
// ---------------------------------------------------------------------------
const serviceCodeSchema = z.string().trim().regex(/^[A-Z0-9_]{2,60}$/, 'Choose a service.');
const clientNote = z.string().trim().max(1000, 'Keep the note under 1000 characters.').optional().nullable().transform(v => v || null);

export const clientServiceRequestSchema = z.object({ serviceCode: serviceCodeSchema, note: clientNote }).strict();
export const clientPlanRequestSchema = z.object({ planId: uuidSchema, note: clientNote }).strict();
/** Files already uploaded for this message (see ticketUploadSchema); the database re-checks every one. */
export const ticketAttachmentIdsSchema = z.array(uuidSchema).max(5, 'You can attach up to 5 files at a time.').default([]);
export const clientTicketCreateSchema = z
  .object({
    subject: z.string().trim().min(3, 'Enter a subject (at least 3 characters).').max(200, 'The subject is too long.'),
    description: z.string().trim().min(5, 'Describe the problem (at least 5 characters).').max(4000, 'The description is too long.'),
    category: z.enum(['GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER']).default('GENERAL'),
    serviceCode: serviceCodeSchema.optional().nullable().transform(v => v || null),
    attachmentIds: ticketAttachmentIdsSchema
  })
  .strict();
export const clientTicketReplySchema = z.object({ message: z.string().trim().min(1, 'Write your reply.').max(4000, 'The reply is too long.') }).strict();
/** A chat message in a ticket. clientMsgId makes a retry / double click store the message once. */
export const clientTicketMessageSchema = z
  .object({
    message: z.string().trim().min(1, 'Write your message.').max(4000, 'The message is too long.'),
    clientMsgId: uuidSchema.optional().nullable().transform(v => v || null),
    attachmentIds: ticketAttachmentIdsSchema
  })
  .strict();
export const clientNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
});
export const clientMarkReadSchema = z.object({ ids: z.array(uuidSchema).min(1).max(100).optional() }).strict();
export const clientDismissSchema = z.object({ occurrence: z.string().trim().max(20).optional() }).strict();
export const clientFileQuerySchema = z.object({ action: z.enum(['view', 'download']).default('view') });

export const serviceRequestDecisionSchema = z
  .object({ decision: z.enum(['IN_REVIEW', 'REJECTED']), note: z.string().trim().max(1000).optional().nullable().transform(v => v || null) })
  .strict();
export const planSaveSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, 'The code can use letters, numbers and _ (2 to 40 characters).').optional(),
    name: z.string().trim().min(2, 'Enter the plan name.').max(120),
    description: z.string().trim().max(1000).optional().nullable().transform(v => v || null),
    monthlyPrice: z.number().min(0, 'Enter the monthly price.').max(10_000_000),
    features: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    services: z.array(serviceCodeSchema).max(30).default([]),
    isActive: z.boolean().default(true)
  })
  .strict();
export const planRequestDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'ACTIVATE']),
    note: z.string().trim().max(1000).optional().nullable().transform(v => v || null),
    paymentConfirmed: z.boolean().default(false),
    renewsOn: isoDate.optional().nullable().transform(v => v || null)
  })
  .strict();

// ---------------------------------------------------------------------------
// HR: attendance and leave
// ---------------------------------------------------------------------------
export const attendanceQuerySchema = z.object({ date: isoDate.optional() }).strict();
export const manualPunchSchema = z
  .object({ profileId: uuidSchema, kind: z.enum(['RM', 'BIOMETRIC']), at: z.string().datetime({ offset: true, message: 'Enter a valid time.' }) })
  .strict();
/** A punch from the biometric device gateway. */
export const biometricPunchSchema = z
  .object({ email: emailSchema, punchedAt: z.string().datetime({ offset: true, message: 'punchedAt must be an ISO date-time with an offset.' }) })
  .strict();

export const leaveSubmitSchema = z
  .object({
    leaveType: z.enum(['FULL_DAY', 'HALF_DAY']),
    startDate: isoDate,
    endDate: isoDate.optional(),
    halfDayShift: z.enum(['MORNING', 'AFTERNOON']).optional(),
    reason: trimmed(1000).min(3, 'Enter the reason for the leave.')
  })
  .strict()
  .refine(v => dayNumber(v.startDate) !== null && (!v.endDate || dayNumber(v.endDate) !== null), { message: 'Enter valid dates.', path: ['startDate'] })
  .refine(v => v.leaveType !== 'HALF_DAY' || !!v.halfDayShift, { message: 'Choose the morning or the afternoon for a half day.', path: ['halfDayShift'] })
  .refine(v => !v.endDate || v.endDate >= v.startDate, { message: 'The end date cannot be before the start date.', path: ['endDate'] });
export type LeaveSubmitInput = z.infer<typeof leaveSubmitSchema>;

export const leaveDecisionSchema = z
  .object({ approve: z.boolean(), note: optionalText(1000) })
  .strict()
  .refine(v => v.approve || (!!v.note && v.note.length >= 3), { message: 'Give a reason for rejecting the request.', path: ['note'] });
export const leaveMonthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.').optional() }).strict();

// ---- HR e-mail automation ----
export const hrEmailHistoryQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN']).optional(),
    kind: z.enum(['BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR', 'PROBATION_OVERDUE_HR', 'CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0)
  })
  .strict();
export const hrConfirmProbationSchema = z.object({ effectiveDate: isoDate.optional(), note: optionalText(500) }).strict();
export const hrDismissProbationSchema = z.object({ note: z.string().trim().min(3, 'Say why the confirmation is closed.').max(500) }).strict();
export const hrEmployeeDatesSchema = z
  .object({ employeeKey: z.string().trim().min(3).max(80), dateOfBirth: isoDate.optional(), joiningDate: isoDate.optional() })
  .strict()
  .refine(v => !!v.dateOfBirth || !!v.joiningDate, { message: 'Enter a date of birth or a joining date.', path: ['dateOfBirth'] });

// ---- Performance Management ----
const perfPeriod = {
  kind: z.enum(['WEEK', 'MONTH', 'CUSTOM']),
  start: isoDate,
  end: isoDate
};
export const performancePeopleQuerySchema = z.object({ ...perfPeriod, departmentId: uuidSchema.optional() }).strict();
export const performanceReportQuerySchema = z
  .object({
    scope: z.enum(['MEMBER', 'TEAM', 'DEPARTMENT']),
    subjectId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
    ...perfPeriod
  })
  .strict()
  .refine(v => (v.scope === 'MEMBER' ? !!v.subjectId : v.scope === 'TEAM' ? !!v.teamId : !!v.departmentId), { message: 'Choose who the report is about.', path: ['scope'] });
export const performanceReportBodySchema = performanceReportQuerySchema;

// ---- HR Recruitment ----
const CONFIRMATIONS = ['NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD'] as const;
export const recruitmentListQuerySchema = z
  .object({
    search: trimmed(120).optional(),
    positionId: uuidSchema.optional(),
    confirmation: z.enum(CONFIRMATIONS).optional(),
    pending: z.enum(['OPEN', 'OVERDUE', 'NONE']).optional(),
    call: z.enum(['SCHEDULED', 'FOLLOW_UP_OVERDUE', 'NONE']).optional(),
    ownerKey: trimmed(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100000).default(0)
  })
  .strict();
export const recruitmentCandidateSchema = z
  .object({
    name: trimmed(160).min(2, 'Enter the candidate\'s name.'),
    email: emailSchema,
    phone: optionalText(40),
    positionId: uuidSchema.nullable().optional(),
    /** A designation from the employee records that is not a position yet: it becomes one. */
    positionTitle: optionalText(120),
    ownerKey: optionalText(80),
    source: optionalText(80),
    notes: optionalText(2000)
  })
  .strict()
  .refine(v => !!v.positionId || !!v.positionTitle, { message: 'Choose the position the candidate applied for.', path: ['positionId'] });
export const recruitmentPositionSchema = z
  .object({ id: uuidSchema.optional(), title: trimmed(120).min(2, 'Enter the position title.'), departmentId: uuidSchema.nullable().optional(), isOpen: z.boolean().default(true) })
  .strict();
export const recruitmentActionSchema = z
  .object({
    kind: z.enum(['INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER']),
    title: trimmed(200).min(2, 'Describe what is pending.'),
    dueDate: isoDate.nullable().optional(),
    assigneeKey: optionalText(80)
  })
  .strict();
export const recruitmentActionCloseSchema = z.object({ done: z.boolean(), note: optionalText(500) }).strict();
export const recruitmentCallScheduleSchema = z.object({ at: z.string().datetime({ offset: true }) }).strict();
export const recruitmentCallRecordSchema = z
  .object({
    callId: uuidSchema.nullable().optional(),
    outcome: z.enum(['ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER']),
    note: optionalText(1000),
    followUpDate: isoDate.nullable().optional()
  })
  .strict();
export const recruitmentConfirmationSchema = z
  .object({ status: z.enum(CONFIRMATIONS), date: isoDate.nullable().optional(), note: optionalText(500) })
  .strict();

// ---- HR Training ----
export const trainingProgramSchema = z
  .object({ id: uuidSchema.optional(), name: trimmed(160).min(2, 'Enter the program name.'), description: optionalText(2000), startDate: isoDate, ownerId: uuidSchema.nullable().optional() })
  .strict();
export const trainingDaySchema = z
  .object({
    title: trimmed(160).min(2, 'Enter the title of the day.'),
    topics: z.array(trimmed(200).min(1)).max(30).default([]),
    trainerName: optionalText(160),
    trainerId: uuidSchema.nullable().optional(),
    criteria: z.array(z.object({ name: trimmed(120).min(1, 'Name the criterion.'), max: z.number().positive().max(1000) }).strict()).max(20).default([]),
    passPercent: z.number().int().min(1).max(100).nullable().optional()
  })
  .strict();
export const trainingEnrollSchema = z.object({ employeeKeys: z.array(trimmed(80).min(3)).min(1, 'Choose at least one employee.').max(200) }).strict();
export const trainingReportSchema = z
  .object({
    attendance: z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']).nullable().optional(),
    topicsCompleted: z.array(trimmed(200).min(1)).max(30).default([]),
    tasks: z.array(z.object({ title: trimmed(200).min(1), done: z.boolean() }).strict()).max(30).default([]),
    scores: z.array(z.object({ criterion: trimmed(120).min(1), score: z.number().min(0).max(1000) }).strict()).max(20).default([]),
    feedback: optionalText(2000),
    trainerRemarks: optionalText(2000),
    report: optionalText(4000)
  })
  .strict();
export const trainingReviewSchema = z.object({ strengths: optionalText(2000), improvements: optionalText(2000), trainerRemarks: optionalText(2000) }).strict();
export const trainingRecordsQuerySchema = z
  .object({
    search: trimmed(120).optional(),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0)
  })
  .strict();
export const trainingCancelSchema = z.object({ cancel: z.boolean().default(true) }).strict();

// ---- Client calendar and documents ----
export const clientCalendarQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine(v => v.to >= v.from, { message: 'The end date must be on or after the start date.', path: ['to'] });

export const clientDocumentUploadSchema = z
  .object({
    itemCode: checklistItemCodeSchema,
    fileName: trimmed(255).min(1),
    mimeType: z.enum(UPLOAD_MIME_TYPES, { errorMap: () => ({ message: 'This file type is not accepted.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(CUSTOMER_DOCUMENT_MAX_BYTES, `File size exceeds the ${CUSTOMER_DOCUMENT_MAX_LABEL} limit.`)
  })
  .strict();

export const clientDetailSchema = z.object({ itemCode: checklistItemCodeSchema, value: trimmed(4000).min(1, 'Enter a value.') }).strict();

export const clientActivitySchema = z
  .object({
    serviceCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Unknown service.').nullable().optional(),
    date: isoDate,
    kind: z.enum(['CAMPAIGN', 'CALL_CAMPAIGN', 'POST', 'AD', 'SETUP', 'REPORT', 'MEETING', 'OTHER']),
    title: trimmed(160).min(3, 'Enter a title (at least 3 characters).'),
    summary: trimmed(2000).nullable().optional(),
    metrics: z
      .array(z.object({ label: z.string().trim().max(60), value: z.string().trim().max(60) }).strict())
      .max(12, 'Add at most 12 insights.')
      .default([])
  })
  .strict();

export const clientDocumentReviewSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    note: trimmed(1000).nullable().optional()
  })
  .strict();

export const clientDocumentQueueQuerySchema = z.object({ status: z.enum(['PENDING', 'REVIEWED']).default('PENDING') });

export const clientActivityCustomersQuerySchema = z.object({ search: trimmed(100).optional() });


// ---------------------------------------------------------------------------
// Business reports (HR / Super Admin)
// ---------------------------------------------------------------------------
const businessFilters = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  departmentId: uuidSchema.optional(),
  division: z.enum(['SALES', 'SUPPORT']).optional(),
  employeeId: uuidSchema.optional(),
  type: z.enum(['INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED']).optional(),
  status: z.enum(['COLLECTED', 'PENDING', 'REFUNDED']).optional()
};
const businessRange = (v: { from?: string; to?: string }) => !v.from || !v.to || v.to >= v.from;
export const businessReportQuerySchema = z.object(businessFilters).refine(businessRange, { message: 'The end date is before the start date.', path: ['to'] });
export type BusinessReportQuery = z.infer<typeof businessReportQuerySchema>;
export const businessTransactionsQuerySchema = z
  .object({
    ...businessFilters,
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .refine(businessRange, { message: 'The end date is before the start date.', path: ['to'] });
export type BusinessTransactionsQuery = z.infer<typeof businessTransactionsQuerySchema>;

export const invoiceBusinessTagSchema = z
  .object({
    kind: z.enum(['RENEWAL', 'ADDON', 'OTHER']),
    serviceCode: z.preprocess(v => (v === '' ? null : v), z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).nullable().optional()),
    invoiceRequestId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional()),
    note: optionalText(500)
  })
  .strict();
export type InvoiceBusinessTagInput = z.infer<typeof invoiceBusinessTagSchema>;

export const businessOrdersQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    departmentId: uuidSchema.optional(),
    division: z.enum(['SALES', 'SUPPORT']).optional(),
    employeeId: uuidSchema.optional(),
    type: z.enum(['INITIAL_SALE', 'ADDON', 'RENEWAL']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .refine(v => !v.from || !v.to || v.to >= v.from, { message: 'The end date is before the start date.', path: ['to'] });
export type BusinessOrdersQuery = z.infer<typeof businessOrdersQuerySchema>;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export const CHAT_MAX_BODY = 4000;
export const CHAT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CHAT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
] as const;

export const chatSendSchema = z
  .object({
    body: z.string().max(CHAT_MAX_BODY, `A message can have at most ${CHAT_MAX_BODY} characters.`).default(''),
    clientMsgId: uuidSchema,
    replyTo: uuidSchema.optional(),
    attachmentIds: z.array(uuidSchema).max(5, 'You can attach up to 5 files to one message.').default([]),
    /** @mentions in a group (migration 20270116000300): the members tagged; the database refuses anyone outside the group. */
    mentions: z.array(uuidSchema).max(50, 'Tag at most 50 people in one message.').default([])
  })
  .strict()
  .refine(v => v.body.trim().length > 0 || v.attachmentIds.length > 0, { message: 'Write a message first.', path: ['body'] });

const base64 = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Not valid base64.');
/** The envelope of an end-to-end encrypted message. The server checks its SHAPE; it cannot read it. */
export const chatE2eeSchema = z
  .object({
    v: z.literal(1),
    sv: z.number().int().min(1).max(1_000_000),
    iv: base64(16, 16),
    ct: base64(8, 90_000),
    wraps: z
      .array(z.object({ to: uuidSchema, kv: z.number().int().min(1).max(1_000_000), enc: base64(88, 88), w: base64(16, 400) }).strict())
      .min(1)
      .max(200)
  })
  .strict();
export const chatSendEncryptedSchema = z
  .object({
    clientMsgId: uuidSchema,
    replyTo: uuidSchema.optional(),
    attachmentIds: z.array(uuidSchema).max(5, 'You can attach up to 5 files to one message.').default([]),
    e2ee: chatE2eeSchema,
    mentions: z.array(uuidSchema).max(50, 'Tag at most 50 people in one message.').default([])
  })
  .strict();

// ---- Chat: Delete Inbox, reactions (migration 20270116000300) ----
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTIONS)[number];
/** Add / change (another emoji) / remove (null) my reaction to a message: one per person and message. */
export const chatReactSchema = z.object({ emoji: z.enum(CHAT_REACTIONS, { errorMap: () => ({ message: 'Choose one of the offered reactions.' }) }).nullable() }).strict();
export const chatReactionsQuerySchema = z.object({
  ids: z.string().max(12000).transform(v => v.split(',').map(x => x.trim()).filter(Boolean)).pipe(z.array(uuidSchema).max(300))
}).strict();
/** The Super Admin types this to delete every internal chat (the database checks it again). */
export const CHAT_PURGE_CONFIRMATION = 'DELETE ALL CHATS';
export const chatPurgeSchema = z.object({ confirm: z.literal(CHAT_PURGE_CONFIRMATION, { errorMap: () => ({ message: `Type ${CHAT_PURGE_CONFIRMATION} to confirm.` }) }) }).strict();
const chatKeyBackupBlobSchema = z
  .object({
    v: z.literal(1),
    kdf: z.literal('PBKDF2-SHA256'),
    iter: z.number().int().min(100_000).max(10_000_000),
    salt: base64(16, 64),
    iv: base64(16, 16),
    ct: base64(32, 50_000)
  })
  .strict();
export const chatKeySetupSchema = z.object({ publicKey: base64(88, 88), backup: chatKeyBackupBlobSchema }).strict();
/** The automatic first key (and a new key on a device without the old one): the public key only, no backup and no passphrase. */
export const chatKeyRegisterSchema = z.object({ publicKey: base64(88, 88) }).strict();
export const chatKeyBackupSetSchema = z.object({ backup: chatKeyBackupBlobSchema, version: z.number().int().min(1).max(1_000_000) }).strict();
export const chatKeyLookupQuerySchema = z.object({ profileId: uuidSchema, version: z.coerce.number().int().min(1).max(1_000_000) }).strict();

export const chatMessagesQuerySchema = z
  .object({
    before: z.coerce.number().int().min(0).optional(),
    after: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30)
  })
  .refine(v => v.before === undefined || v.after === undefined, { message: 'Use either "before" or "after", not both.' });
export const chatReadSchema = z.object({ seq: z.coerce.number().int().min(0).optional() }).strict();
/** Offboarding: the colleague who takes the work (optional: without one the items wait in the Reassignment Required queue) and how the account is closed. */
export const offboardSchema = z
  .object({
    replacementId: uuidSchema.nullish(),
    status: z.enum(['SUSPENDED', 'REVOKED']).default('REVOKED'),
    reason: z.string().trim().max(500, 'The reason can have at most 500 characters.').nullish()
  })
  .strict();
export const reassignResolveSchema = z.object({ toId: uuidSchema.nullish() }).strict();
/** The EXTRA departments a Meta Verifier verifies for (the home department is implicit). The database checks who may and that the person is a Meta Verifier. */
export const verifierDepartmentsSchema = z.object({ departmentIds: z.array(uuidSchema).max(40, 'Choose at most 40 departments.') }).strict();
/** Share a client message with the client's own Team Member, Team Lead or Meta Verifier (the database decides who is allowed). */
export const chatEscalateSchema = z
  .object({ messageId: uuidSchema.nullish(), targetId: uuidSchema, note: z.string().trim().max(500, 'The note can have at most 500 characters.').nullish() })
  .strict();
/** Take over or release "currently handling" on a client conversation (information only; the database checks who may). */
export const chatHandlingSchema = z.object({ action: z.enum(['TAKE', 'RELEASE']) }).strict();
export const chatSearchQuerySchema = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
export const chatReviewQuerySchema = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
export const chatDirectSchema = z.object({ profileId: uuidSchema }).strict();
export const chatGroupCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the group a name.').max(80, 'The group name can have at most 80 characters.'),
    memberIds: z.array(uuidSchema).min(1, 'Add at least one other person.').max(99, 'A group can have at most 100 people.')
  })
  .strict();
export const chatGroupRenameSchema = z.object({ title: z.string().trim().min(1, 'Give the group a name.').max(80, 'The group name can have at most 80 characters.') }).strict();
export const chatMembersSchema = z.object({ profileIds: z.array(uuidSchema).min(1, 'Pick at least one person.').max(99) }).strict();
export const chatAdminSchema = z.object({ profileId: uuidSchema, admin: z.boolean() }).strict();
export const chatUploadSchema = z
  .object({
    fileName: z.string().trim().min(1, 'The file needs a name.').max(200),
    // 'application/x-amuwa-e2ee' is a file encrypted in the browser (internal chats): the server only ever sees the envelope
    mimeType: z.enum([...CHAT_MIME_TYPES, 'application/x-amuwa-e2ee'], { errorMap: () => ({ message: 'This file type cannot be sent. Use an image, PDF, text, CSV, Word or Excel file.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(CHAT_MAX_FILE_BYTES + 64, 'Files can be at most 5 MB.')
  })
  .strict();

// ---------------------------------------------------------------------------
// Ticket attachments (same limits as chat: 5 files per message, 5 MB each, the same file types)
// ---------------------------------------------------------------------------
/** A ticket (an existing one) or, for staff starting a new ticket, the customer it is for. A client never names a customer. */
export const ticketUploadSchema = z
  .object({
    ticketId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    fileName: z.string().trim().min(1, 'The file needs a name.').max(200),
    mimeType: z.enum(CHAT_MIME_TYPES, { errorMap: () => ({ message: 'This file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(CHAT_MAX_FILE_BYTES, 'Files can be at most 5 MB.')
  })
  .strict();

// ---------------------------------------------------------------------------
// Department income attribution (Super Admin, Accounts, Department Heads: the database decides who may do what)
// ---------------------------------------------------------------------------
export const departmentIncomeQuerySchema = z
  .object({ departmentId: uuidSchema.optional(), from: isoDate.optional(), to: isoDate.optional() })
  .refine(businessRange, { message: 'The end date is before the start date.', path: ['to'] });
export type DepartmentIncomeQuery = z.infer<typeof departmentIncomeQuerySchema>;
const attributionReason = z.string().trim().min(3, 'Say why (at least 3 characters).').max(500, 'Keep the reason under 500 characters.');
export const orderAttributionSchema = z
  .object({
    orderKey: z.string().trim().regex(/^(SALE|ADDON|INV|PLAN):[0-9a-fA-F-]{36}$/, 'Choose an order from the list.'),
    division: z.enum(['SALES', 'SUPPORT']),
    departmentId: uuidSchema.optional().nullable().transform(v => v || null),
    reason: attributionReason
  })
  .strict();
export type OrderAttributionInput = z.infer<typeof orderAttributionSchema>;
export const customerAcquisitionSchema = z.object({ division: z.enum(['SALES', 'SUPPORT']), reason: attributionReason }).strict();
export const revenueSettingsSchema = z.object({ clientPurchaseAttribution: z.enum(['SUPPORT', 'ACQUISITION', 'SALES']) }).strict();


// ---- Telecaller ----
export const headDivisionSchema = z.object({ division: z.enum(HEAD_DIVISIONS).nullable() }).strict();
/** The Super Admin authorises (or withdraws) one department and function for a Department Head. */
export const departmentAccessSchema = z.object({ departmentId: uuidSchema, division: z.enum(HEAD_DIVISIONS), granted: z.boolean() }).strict();
/** The Access Control tab's Save: the WHOLE set of extra (department, function) pairs the head should hold. */
export const departmentAccessApplySchema = z
  .object({ pairs: z.array(z.object({ departmentId: uuidSchema, division: z.enum(HEAD_DIVISIONS) }).strict()).max(60) })
  .strict();
export const salesSubRoleSchema = z.object({ role: z.enum(SALES_SUB_ROLES).nullable() }).strict();

/** One row of a contact sheet, read in the browser: the database checks every value again. */
export const telecallerSheetRowSchema = z
  .object({
    row: z.coerce.number().int().min(1).max(100000),
    name: z.string().max(400).default(''),
    company: z.string().max(400).nullish(),
    phone: z.string().max(60).default(''),
    email: z.string().max(400).nullish(),
    remarks: z.string().max(2000).nullish()
  })
  .strict();
export const telecallerSheetSchema = z
  .object({
    assigneeId: uuidSchema,
    fileName: trimmed(200).min(1, 'The file name is missing.'),
    note: optionalText(500),
    /** SHA-256 of the file (hex): the same file is not assigned twice to one person. */
    hash: z.string().regex(/^[a-f0-9]{64}$/, 'The sheet could not be identified.'),
    rows: z.array(telecallerSheetRowSchema).min(1, 'The sheet has no contact rows.').max(2000, 'A sheet can have at most 2,000 contacts.'),
    commit: z.boolean().default(false)
  })
  .strict();
export const TELECALLER_SHEET_MAX_BYTES = 700 * 1024;
export const telecallerSheetSourceSchema = z.object({ data: z.string().min(8).max(1_000_000) }).strict();
export const telecallerAssignableQuerySchema = z.object({ departmentId: uuidSchema.optional() });

export const telecallerContactsQuerySchema = z
  .object({
    listId: uuidSchema.optional(),
    search: trimmed(120).optional(),
    status: z.enum(CALL_STATUSES).optional(),
    ...pageParams
  })
  .strict();
export const telecallerContactUpdateSchema = z
  .object({
    callStatus: z.enum(CALL_STATUSES),
    remarks: optionalText(1000),
    followUpDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    /** false: only the remarks / follow-up changed, no call took place */
    called: z.boolean().optional()
  })
  .strict()
  .refine(v => v.callStatus !== 'FOLLOW_UP_REQUIRED' || !!v.followUpDate, { message: 'Enter the follow-up date.', path: ['followUpDate'] });

// ---------------------------------------------------------------------------
// Field Visit
// ---------------------------------------------------------------------------
const visitTime = z.preprocess(v => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.').nullable().optional());
const visitDate = isoDate;
export const fieldVisitLeadsQuerySchema = z
  .object({
    filter: z.enum(FIELD_VISIT_FILTERS).default('ALL'),
    search: trimmed(120).optional(),
    sort: z.enum(['visitDate', 'name', 'newest', 'followUp']).default('visitDate'),
    ...pageParams
  })
  .strict();
export const fieldVisitAssignedQuerySchema = z.object({ search: trimmed(120).optional(), ...pageParams }).strict();
export const fieldVisitListQuerySchema = z
  .object({
    scope: z.enum(['OPEN', 'HISTORY', 'ALL']).default('OPEN'),
    status: z.enum(LEAD_VISIT_STATUSES).optional(),
    leadId: uuidSchema.optional(),
    search: trimmed(120).optional(),
    ...pageParams
  })
  .strict();
export const fieldVisitScheduleSchema = z
  .object({
    leadId: uuidSchema,
    visitDate,
    plannedTime: visitTime,
    address: optionalText(500),
    purpose: trimmed(300).min(1, 'Enter the purpose of the visit.'),
    notes: optionalText(2000),
    clientRequestId: uuidSchema.optional(),
    taskId: uuidSchema.optional()
  })
  .strict();
export const fieldVisitUpdateSchema = z
  .object({ visitDate, plannedTime: visitTime, address: optionalText(500), purpose: trimmed(300).min(1, 'Enter the purpose of the visit.'), notes: optionalText(2000) })
  .strict();
export const fieldVisitStartSchema = z
  .object({
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    accuracyMeters: z.number().int().min(0).max(1_000_000).nullable().optional(),
    locationNote: optionalText(200)
  })
  .strict();
export const fieldVisitCompleteSchema = z
  .object({
    status: z.enum(['COMPLETED', 'FOLLOW_UP_REQUIRED']),
    outcome: trimmed(2000).min(1, 'Enter the outcome of the visit.'),
    notes: optionalText(2000),
    requirements: optionalText(2000),
    nextSteps: optionalText(1000),
    followUpDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional())
  })
  .strict()
  .refine(v => v.status !== 'FOLLOW_UP_REQUIRED' || !!v.followUpDate, { message: 'Enter the next follow-up date.', path: ['followUpDate'] });
export const fieldVisitCancelSchema = z.object({ reason: optionalText(500) }).strict();
export const salesVisitAssignSchema = z
  .object({ leadId: uuidSchema, assigneeId: uuidSchema, priority: z.enum(VISIT_PRIORITIES).default('NORMAL'), instructions: optionalText(1000) })
  .strict();

export const leadScopeQuerySchema = z
  .object({
    scope: z.enum(LEAD_SCOPES),
    search: trimmed(120).optional(),
    source: trimmed(60).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    temperature: z.enum(LEAD_TEMPERATURES).optional(),
    callStatus: z.enum(CALL_STATUSES).optional(),
    service: trimmed(60).optional(),
    followUpFrom: z.string().datetime({ offset: true }).optional(),
    followUpTo: z.string().datetime({ offset: true }).optional(),
    noFollowUp: booleanParam.optional(),
    sort: z.enum(['newest', 'followUp']).default('newest'),
    ...pageParams
  })
  .strict();

export const telecallerLeadsQuerySchema = z
  .object({
    search: trimmed(120).optional(),
    temperature: z.enum(LEAD_TEMPERATURES).optional(),
    callStatus: z.enum(CALL_STATUSES).optional(),
    source: trimmed(60).optional(),
    ...pageParams
  })
  .strict();
/** Add / edit a lead: the Sales lead fields plus the temperature and the call status. The follow-up is a date. */
export const telecallerLeadSchema = z
  .object({
    name: leadCreateSchema.shape.name,
    company: leadCreateSchema.shape.company,
    phone: leadCreateSchema.shape.phone,
    email: leadCreateSchema.shape.email,
    address: leadCreateSchema.shape.address,
    leadSource: leadCreateSchema.shape.leadSource,
    notes: leadCreateSchema.shape.notes,
    services: serviceCodes.min(1, 'Select the service the customer is interested in.'),
    leadTemperature: z.enum(LEAD_TEMPERATURES, { errorMap: () => ({ message: 'Choose Hot, Warm or Cold.' }) }),
    callStatus: z.enum(CALL_STATUSES, { errorMap: () => ({ message: 'Choose the call status.' }) }),
    followUpDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional())
  })
  .strict();
export type TelecallerLeadInput = z.infer<typeof telecallerLeadSchema>;
export const telecallerLeadUpdateSchema = telecallerLeadSchema.partial().extend({
  leadTemperature: telecallerLeadSchema.shape.leadTemperature,
  callStatus: telecallerLeadSchema.shape.callStatus
}).strict();


// ---- Business Associate ----
export const baContactsQuerySchema = z.object({ search: trimmed(120).optional(), stage: z.enum(BA_STAGES).optional(), ...pageParams }).strict();
export const baContactUpdateSchema = z
  .object({
    requirements: optionalText(5000),
    profile: businessProfileSchema.optional(),
    nextFollowUp: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    stage: z.enum(BA_STAGES).optional()
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export const baNoteSchema = z.object({ note: trimmed(2000).min(1, 'Write the note.') }).strict();
export const baConvertSchema = z.object({ assigneeId: uuidSchema.nullish(), note: optionalText(1000) }).strict();
export const baReassignSchema = z.object({ assigneeId: uuidSchema }).strict();

const money = (max: number) => z.coerce.number().min(0).max(max);
export const baQuotationLineSchema = z
  .object({
    serviceCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Choose a service.'),
    description: optionalText(1500),
    quantity: z.coerce.number().gt(0, 'Enter a quantity above 0.').max(100000),
    unitPrice: money(1_000_000_000),
    discountPct: money(100).default(0),
    gstRate: money(100).default(0)
  })
  .strict();
export const baQuotationSchema = z
  .object({
    items: z.array(baQuotationLineSchema).min(1, 'Add at least one service.').max(30),
    gstApplicable: z.boolean().optional(),
    validityDays: z.preprocess(v => (v === '' ? null : v), z.coerce.number().int().min(1).max(365).nullable().optional()),
    paymentTerms: optionalText(2000),
    timeline: optionalText(1000),
    notes: optionalText(3000),
    content: quotationContentSchema.partial().optional(),
    reviewed: z.boolean().optional()
  })
  .partial()
  .strict();
export const baQuotationCreateSchema = baQuotationSchema.extend({ contactId: uuidSchema });
export const baAiExtraSchema = z.object({ instructions: optionalText(600) }).strict();
export const baQuotationAiSchema = baAiExtraSchema;
export const baScopeAiSchema = baAiExtraSchema.extend({ section: z.enum(SCOPE_SECTIONS).optional() });
// Business Associate: client research (web). force = search again even when a result of the last 30 days is stored.
export const baResearchSchema = z.object({ force: z.boolean().optional() }).strict();

const instant = z.string().datetime({ offset: true, message: 'Enter a valid date and time.' });
const baDemoFields = z.object({
  title: trimmed(200).min(1, 'Enter the demo title.'),
  description: optionalText(3000),
  startsAt: instant,
  endsAt: instant,
  mode: z.enum(DEMO_MODES),
  location: optionalText(300),
  meetingLink: z.preprocess(v => (v === '' ? null : v), z.string().trim().url('Enter a valid link.').max(500).nullable().optional()),
  internalNotes: optionalText(3000)
});
const endAfterStart = { message: 'The end time must be after the start time.', path: ['endsAt'] };
export const baDemoSchema = baDemoFields.strict().refine(v => new Date(v.endsAt) > new Date(v.startsAt), endAfterStart);
export const baDemoCreateSchema = baDemoFields.extend({ contactId: uuidSchema }).strict().refine(v => new Date(v.endsAt) > new Date(v.startsAt), endAfterStart);
export const baDemoUpdateSchema = z.object({
  title: trimmed(200).min(1).optional(), description: optionalText(3000), startsAt: instant.optional(), endsAt: instant.optional(), mode: z.enum(DEMO_MODES).optional(),
  location: optionalText(300), meetingLink: z.preprocess(v => (v === '' ? null : v), z.string().trim().url().max(500).nullable().optional()), internalNotes: optionalText(3000)
}).strict().refine(v => !(v.startsAt && v.endsAt) || new Date(v.endsAt) > new Date(v.startsAt), { message: 'The end time must be after the start time.', path: ['endsAt'] });
export const baDemoStatusSchema = z.object({ status: z.enum(['COMPLETED', 'CANCELLED']), feedback: optionalText(3000), followUpNotes: optionalText(3000) }).strict();
export const baDemosQuerySchema = z.object({ from: instant.optional(), to: instant.optional(), status: z.enum(DEMO_STATUSES).optional(), contactId: uuidSchema.optional() }).strict();

export const baScopeSchema = z
  .object({ title: trimmed(200).min(1).optional(), inputs: businessProfileSchema.optional(), content: scopeContentSchema.optional(), reviewed: z.boolean().optional() })
  .strict();
export const baScopeCreateSchema = baScopeSchema.extend({ contactId: uuidSchema });
export const servicePriceSchema = z
  .object({
    unitLabel: trimmed(40).min(1).default('one time'),
    unitPrice: z.coerce.number().min(0).max(1_000_000_000),
    gstRate: z.coerce.number().min(0).max(100),
    maxDiscountPct: z.coerce.number().min(0).max(100),
    isActive: z.boolean().default(true)
  })
  .strict();
export const baDocumentFileQuerySchema = z.object({ action: z.enum(['view', 'download']).default('view') });

// ---- Sales Department Head ----
/** One row of a lead sheet (name, company, phone, e-mail, remarks), read in the browser: the database checks every value again. */
export const salesLeadRowSchema = z
  .object({
    row: z.coerce.number().int().min(1).max(100000),
    name: z.string().max(400).default(''),
    company: z.string().max(400).nullish(),
    phone: z.string().max(60).default(''),
    email: z.string().max(400).nullish(),
    remarks: z.string().max(2000).nullish()
  })
  .strict();
export const salesLeadSheetSchema = z
  .object({
    assigneeId: uuidSchema,
    fileName: trimmed(200).min(1, 'The file name is missing.'),
    note: optionalText(500),
    /** SHA-256 of the file (hex): the same file is not uploaded twice. */
    hash: z.string().regex(/^[a-f0-9]{64}$/, 'The sheet could not be identified.'),
    rows: z.array(salesLeadRowSchema).min(1, 'The sheet has no lead rows.').max(2000, 'A sheet can have at most 2,000 leads.'),
    commit: z.boolean().default(false)
  })
  .strict();
// Sales CEO -> Department Head (20270303000100): forward the open leads of a received sheet (count: the oldest first; none = all)
export const salesSheetForwardSchema = z
  .object({ assigneeId: uuidSchema, count: z.number().int().min(1, 'Choose at least one lead.').max(2000).optional() })
  .strict();
export const salesLeadsQuerySchema = z
  .object({
    search: trimmed(120).optional(),
    filter: z.enum(SALES_LEAD_FILTERS).default('ALL'),
    assigneeId: uuidSchema.optional(),
    sort: z.enum(['assignedAt', 'name', 'company', 'temperature', 'callStatus', 'lastContacted', 'followUp', 'assignee']).default('assignedAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    ...pageParams
  })
  .strict();
export const salesInboundAssignSchema = z.object({ assigneeId: uuidSchema }).strict();
export const salesTasksQuerySchema = z
  .object({ filter: z.enum(SALES_TASK_FILTERS).default('ALL'), search: trimmed(120).optional(), assigneeId: uuidSchema.optional(), ...pageParams })
  .strict();
export const salesTaskCreateSchema = z
  .object({
    assigneeId: uuidSchema,
    title: trimmed(200).min(1, 'Enter a task title.'),
    description: optionalText(4000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    dueDate: isoDate.nullish()
  })
  .strict();
export const salesReportsQuerySchema = z
  .object({
    who: z.enum(['TEAM_LEAD', 'TEAM_MEMBER']).default('TEAM_MEMBER'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    taskStatus: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']).optional()
  })
  .strict();
export const salesIncomeQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();

// ---------------------------------------------------------------------------
// Onboarding journey
// ---------------------------------------------------------------------------
/** The Meta verification status the Meta Verifier (or the Technical Consultant on the other route) sets (PENDING is only the starting state). */
export const metaVerificationSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED']),
    feedback: z.string().trim().max(1000, 'The feedback can have at most 1000 characters.').nullish()
  })
  .strict();
/** No verifier given: the signed-in verifier takes the verification. */
export const journeyVerifierSchema = z.object({ verifierId: uuidSchema.nullish() }).strict();
export const serviceSetupSchema = z
  .object({ status: z.enum(['IN_PROGRESS', 'READY']), note: z.string().trim().max(500, 'The note can have at most 500 characters.').nullish() })
  .strict();
export const chatChannelSchema = z.enum(['META', 'RM']);

// ---- Service-specific journeys: existing Blue Tick, the authoritative Meta decision --------------------------------------------------
export const EXISTING_BLUE_TICK_STATUSES = ['NOT_PROVIDED', 'CUSTOMER_REPORTED', 'CONFIRMED', 'COULD_NOT_CONFIRM'] as const;
export const existingBlueTickSchema = z
  .object({
    status: z.enum(EXISTING_BLUE_TICK_STATUSES),
    reference: z.string().trim().max(300, 'The reference can have at most 300 characters.').nullish(),
    note: z.string().trim().max(500, 'The note can have at most 500 characters.').nullish()
  })
  .strict();
/** The Meta decision. The event key makes a retry (or a replayed message) change nothing; Approved needs the Meta reference. */
export const metaOutcomeSchema = z
  .object({
    outcome: z.enum(['APPROVED', 'REJECTED', 'NEEDS_INFO']),
    eventKey: z.string().trim().min(8, 'The event key must be 8 to 100 characters.').max(100, 'The event key must be 8 to 100 characters.'),
    reference: z.string().trim().max(300, 'The reference can have at most 300 characters.').nullish(),
    note: z.string().trim().max(1000, 'The note can have at most 1000 characters.').nullish()
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.outcome === 'APPROVED' && !v.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the Meta reference that shows the approval.' });
    if (v.outcome !== 'APPROVED' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tell the client what is needed or why it was rejected.' });
  });

// ---- Meta Verifier workflow -----------------------------------------------------------------------------------------------------------
export const verificationNoteSchema = z
  .object({ body: trimmed(2000).min(1, 'Write the note.'), outcome: z.enum(['NOTE', 'PENDING', 'NEEDS_CORRECTION', 'VERIFIED']).default('NOTE') })
  .strict();
// The account / user ID of a customer's WhatsApp panel. The database enforces the exact format and refuses anything that looks like a password.
export const panelDetailsSchema = z.object({ platform: trimmed(120).nullish(), account: trimmed(200).nullish() }).strict();
// The Client Panel URL of one service: HTTPS, a public host, no credentials in the link (the database applies the same rules). Empty clears it.
export const panelUrlSchema = z
  .object({ url: z.string().max(600).nullish() })
  .strict()
  .superRefine((b, ctx) => {
    const r = checkPanelUrl(b.url);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.message, path: ['url'] });
  });
export const panelLinkSendSchema = z.object({ requestId: uuidSchema, resend: z.boolean().optional() }).strict();
export const rerouteVerificationSchema = z.object({ route: z.enum(['META', 'TECHNICAL']), reason: trimmed(500).min(1, 'Give the reason.') }).strict();
export const serviceMetaVerificationSchema = z.object({ value: z.boolean() }).strict();
export const followUpListQuerySchema = z.object({ scope: z.enum(['OPEN', 'DONE', 'ALL']).default('OPEN') }).strict();
export const followUpContactSchema = z
  .object({
    channel: z.enum(['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER'], { errorMap: () => ({ message: 'Choose how you contacted the customer.' }) }),
    outcome: z.enum(['NO_ANSWER', 'CALL_BACK', 'CONTACTED', 'ADDON_INTERESTED', 'NOT_INTERESTED', 'COMPLETED'], { errorMap: () => ({ message: 'Choose the outcome.' }) }),
    note: optionalText(2000),
    nextFollowUpAt: z.preprocess(v => (v === '' ? null : v), z.string().datetime({ offset: true }).nullable().optional())
  })
  .strict()
  .refine(b => !['NO_ANSWER', 'CALL_BACK'].includes(b.outcome) || !!b.nextFollowUpAt, { message: 'Give the date of the next follow-up.', path: ['nextFollowUpAt'] });
export const followUpAssignSchema = z.object({ profileId: uuidSchema }).strict();
export const tcFollowupDelaySchema = z.object({ days: z.number().int().min(1, 'Enter 1 to 365 days.').max(365, 'Enter 1 to 365 days.').nullable() }).strict();

// ---------------------------------------------------------------------------
// Employee issues and HR meeting requests
// ---------------------------------------------------------------------------
const caseAttachmentIds = z.array(uuidSchema).max(5, 'You can attach up to 5 files at a time.').default([]);
const caseTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Choose a time (HH:MM).');
const casePaging = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
};
/** The employee's own form: nothing about the employee is sent, it is read from their profile. */
export const issueSubmitSchema = z
  .object({
    clientRequestId: uuidSchema,
    title: trimmed(200).min(3, 'Enter an issue title (at least 3 characters).'),
    category: z.enum(ISSUE_CATEGORIES, { errorMap: () => ({ message: 'Choose an issue category.' }) }),
    description: trimmed(5000).min(10, 'Describe the issue (at least 10 characters).'),
    priority: z.enum(ISSUE_PRIORITIES, { errorMap: () => ({ message: 'Choose a priority.' }) }),
    preferredResolution: optionalText(2000),
    attachmentIds: caseAttachmentIds
  })
  .strict();
export const issueReplySchema = z
  .object({ message: trimmed(4000).min(2, 'Write your reply.'), attachmentIds: caseAttachmentIds })
  .strict();
export const caseMyListQuerySchema = z
  .object({ status: z.enum(['ALL', ...ISSUE_STATUSES, ...MEETING_STATUSES]).optional(), ...casePaging })
  .strict();
const caseDateTime = z.string().datetime({ offset: true });
export const issueHrListQuerySchema = z
  .object({
    status: z.enum(['ALL', ...ISSUE_STATUSES]).optional(),
    departmentId: uuidSchema.optional(),
    priority: z.enum(['ALL', ...ISSUE_PRIORITIES]).optional(),
    category: z.enum(['ALL', ...ISSUE_CATEGORIES]).optional(),
    assigneeId: uuidSchema.optional(),
    unassigned: booleanParam.optional(),
    from: caseDateTime.optional(),
    to: caseDateTime.optional(),
    search: trimmed(120).optional(),
    // issue routing (20270128000200): the order, and whether HR escalated it to the Developer Team
    sort: z.enum(['NEWEST', 'OLDEST', 'PRIORITY', 'STATUS', 'DEPARTMENT', 'EMPLOYEE']).optional(),
    routing: z.enum(['ALL', 'WITH_HR', 'ESCALATED_TO_DEVELOPERS']).optional(),
    ...casePaging
  })
  .strict();
export const issueAssignSchema = z.object({ hrId: uuidSchema.nullable() }).strict();
export const issueStatusSchema = z
  .object({
    status: z.enum(ISSUE_STATUSES, { errorMap: () => ({ message: 'Choose a status.' }) }),
    message: optionalText(4000)
  })
  .strict();
export const issueRespondSchema = z
  .object({ message: trimmed(4000).min(2, 'Write the response.'), requestInfo: z.boolean().default(false) })
  .strict();
export const caseNoteSchema = z.object({ note: trimmed(4000).min(2, 'Write the note.') }).strict();
export const issueUploadSchema = z
  .object({
    fileName: trimmed(200).min(1, 'The file needs a name.'),
    mimeType: z.enum(CHAT_MIME_TYPES, { errorMap: () => ({ message: 'This file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(CHAT_MAX_FILE_BYTES, 'Files can be at most 5 MB.')
  })
  .strict();

export const meetingSubmitSchema = z
  .object({
    clientRequestId: uuidSchema,
    subject: trimmed(200).min(3, 'Enter a meeting subject (at least 3 characters).'),
    category: z.enum(MEETING_CATEGORIES, { errorMap: () => ({ message: 'Choose a meeting category.' }) }),
    description: trimmed(5000).min(10, 'Describe the purpose of the meeting (at least 10 characters).'),
    preferredDate: isoDate,
    preferredTime: caseTime,
    mode: z.enum(MEETING_MODES, { errorMap: () => ({ message: 'Choose In Person or Online.' }) }),
    notes: optionalText(2000)
  })
  .strict();
export const meetingHrListQuerySchema = z
  .object({
    status: z.enum(['ALL', ...MEETING_STATUSES]).optional(),
    departmentId: uuidSchema.optional(),
    category: z.enum(['ALL', ...MEETING_CATEGORIES]).optional(),
    assigneeId: uuidSchema.optional(),
    unassigned: booleanParam.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: trimmed(120).optional(),
    ...casePaging
  })
  .strict();
const httpsLink = z.preprocess(
  v => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'The meeting link must start with https://').nullable().optional()
);
/** HR's decision on a meeting request. The database checks the request's current status for each action. */
export const meetingDecideSchema = z
  .object({
    action: z.enum(MEETING_ACTIONS, { errorMap: () => ({ message: 'Choose what to do with this request.' }) }),
    date: isoDate.nullable().optional(),
    time: caseTime.nullable().optional(),
    mode: z.enum(MEETING_MODES).nullable().optional(),
    location: optionalText(300),
    link: httpsLink,
    instructions: optionalText(2000),
    message: optionalText(4000),
    reason: optionalText(2000),
    outcome: optionalText(4000),
    followUp: optionalText(4000)
  })
  .strict()
  .superRefine((b, ctx) => {
    if (['APPROVE', 'PROPOSE', 'RESCHEDULE'].includes(b.action) && (!b.date || !b.time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the meeting date and time.', path: ['date'] });
    }
    if (['DECLINE', 'CANCEL', 'RESCHEDULE'].includes(b.action) && (!b.reason || b.reason.length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Give a reason (the employee will read it).', path: ['reason'] });
    }
  });
export const meetingCancelSchema = z.object({ reason: optionalText(2000) }).strict();
export const meetingAlternativeSchema = z.object({ accept: z.boolean(), message: optionalText(2000) }).strict();

// Subscription activation, correction and renewal (the team; never Sales)
// ---------------------------------------------------------------------------
export const subscriptionActivationSchema = z
  .object({ activationDate: isoDate, panelCreatedOn: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()), note: optionalText(500) })
  .strict();
export const subscriptionCorrectionSchema = z
  .object({
    activationDate: isoDate,
    panelCreatedOn: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    reason: trimmed(500).min(5, 'Give the reason for the correction.')
  })
  .strict();
export const subscriptionRenewalSchema = z
  .object({
    paymentId: uuidSchema,
    startDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    terms: subscriptionTermsBase.partial().nullish(),
    note: optionalText(500)
  })
  .strict();
export const usageAlertSettingsSchema = z
  .object({ enabled: z.boolean(), thresholds: z.array(z.number().int().min(1).max(100)).min(1).max(8) })
  .strict();
// Accounts profile corrections deliberately exclude all financial and assignment fields.
export const accountsCustomerDetailsSchema = z.object({
  name: leadFields.name, company: leadFields.company, phone: leadFields.phone,
  whatsapp: leadFields.whatsapp, email: leadFields.email, city: leadFields.city,
  address: leadFields.address, businessCategory: leadFields.businessCategory
}).strict();

// ---- Employee approval hierarchy ---------------------------------------------------------------------------------------------------------
export const EMPLOYEE_REQUEST_ROLES = ['OPERATIONS_HEAD', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'] as const;
export type EmployeeRequestRole = (typeof EMPLOYEE_REQUEST_ROLES)[number];
const DESIGNATION_OF_ROLE: Record<EmployeeRequestRole, (typeof DESIGNATIONS)[number]> = {
  OPERATIONS_HEAD: 'Operations Head', DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member'
};
/** HR (or a Team Lead, for a Team Member) asks for an employee. The approver is decided by the database from the role and department, never sent. */
export const employeeRequestSchema = z
  .object({
    email: emailSchema,
    fullName: trimmed(160).min(1, 'Full name is required.'),
    /** Not asked for by the screens (see userCreateSchema): HR never knows an employee's password. */
    password: z.string().min(10, 'Temporary password must be at least 10 characters.').max(72).optional(),
    role: z.enum(EMPLOYEE_REQUEST_ROLES, { errorMap: () => ({ message: 'Choose the designation.' }) }),
    departmentId: uuidSchema,
    /** Sales or Support side (a Department Head's side; the side of a Team Lead's team and of a Team Member). */
    division: z.enum(['SALES', 'SUPPORT', 'GENERAL']).optional(),
    employeeCode: optionalText(40),
    details: memberDetailsSchema
  })
  .strict()
  .refine(
    r => (isHrDesignation(r.details.designation)
      ? HR_DESIGNATION_ROLE[r.details.designation] === r.role
      : r.details.designation === DESIGNATION_OF_ROLE[r.role]),
    { message: 'The designation must match the role.', path: ['details', 'designation'] }
  );
export type EmployeeRequestInput = z.infer<typeof employeeRequestSchema>;

// ---- Welcome e-mail of a new employee (status list for HR / administrators, resend) and the employee's own first password ----
export const WELCOME_EMAIL_STATUSES = ['PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN'] as const;
export const welcomeEmailListQuerySchema = z.object({ status: z.enum(WELCOME_EMAIL_STATUSES).optional(), employee: uuidSchema.optional() }).strict();
/** The employee chooses their own password (from the e-mailed link). The same rules as the client's set-password page. */
export const ownPasswordSchema = z
  .object({ password: z.string().min(10, 'Use at least 10 characters.').max(72, 'Use at most 72 characters.') })
  .strict();

export const employeeRequestListQuerySchema = z
  .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), toDecide: z.enum(['true', 'false']).optional() })
  .strict();

export const employeeDecisionSchema = z
  .object({
    approve: z.boolean(),
    note: optionalText(500),
    /** Operations Head approval only: the departments they manage, and the ones they approve Department Heads for. */
    departmentIds: z.array(uuidSchema).max(40).optional(),
    primaryDepartmentIds: z.array(uuidSchema).max(40).optional()
  })
  .strict()
  .refine(d => d.approve || (typeof d.note === 'string' && d.note.trim().length >= 3), { message: 'Give the reason for rejecting.', path: ['note'] });

export const employeeResubmitSchema = z
  .object({
    role: z.enum(EMPLOYEE_REQUEST_ROLES),
    departmentId: uuidSchema,
    division: z.enum(['SALES', 'SUPPORT', 'GENERAL']).optional(),
    position: optionalText(120),
    employeeCode: optionalText(40)
  })
  .strict();

export const operationsScopeSchema = z
  .object({ departmentIds: z.array(uuidSchema).max(40), primaryDepartmentIds: z.array(uuidSchema).max(40).optional() })
  .strict()
  .refine(s => (s.primaryDepartmentIds ?? []).every(id => s.departmentIds.includes(id)), {
    message: 'A department you approve for must be one of the departments they manage.', path: ['primaryDepartmentIds']
  });

export const assignLeadSchema = z.object({ leadId: uuidSchema, note: optionalText(500) }).strict();

// ---- Subscriptions list (Sales / Business Associate dashboard) ----
export const subscriptionListQuerySchema = z
  .object({
    search: trimmed(100).optional(),
    status: z.enum(['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'PAUSED', 'CANCELLED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();

// ---- Work reports (Team Member -> Team Lead -> Department Head -> Operations Head) ----
const reportText = z.string().trim().max(5000, 'Keep each section under 5000 characters.');
const reportAttachmentSchema = z.object({
  name: z.string().trim().max(120).optional(),
  url: z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, 'An attachment link must be a web address starting with http:// or https://.')
});
const reportContentShape = Object.fromEntries(ALL_REPORT_FIELD_KEYS.map(k => [k, reportText.optional()])) as Record<ReportFieldKey, z.ZodOptional<typeof reportText>>;
const reportPeriodRefine = <T extends { periodStart: string; periodEnd: string }>(d: T) => d.periodEnd >= d.periodStart;

export const reportSaveSchema = z
  .object({
    title: z.string().trim().min(3, 'Enter a report title.').max(200),
    reportDate: isoDate,
    periodType: z.enum(REPORT_PERIOD_TYPES).default('DAILY'),
    periodStart: isoDate,
    periodEnd: isoDate,
    content: z
      .object({
        ...reportContentShape,
        // the one short remark of the standard report form
        remarks: z.string().trim().max(REPORT_REMARKS_MAX, `Keep the remarks under ${REPORT_REMARKS_MAX} characters.`).optional(),
        attachments: z.array(reportAttachmentSchema).max(5, 'Add at most 5 attachment links.').optional(),
        // Team Member report: ids of the member's own tasks (the database checks they were assigned to the author and are really completed)
        assignedTasks: z.array(uuidSchema).max(100, 'Choose at most 100 tasks.').optional(),
        completedTasks: z.array(uuidSchema).max(100, 'Choose at most 100 tasks.').optional(),
        // (20270312000100) the daily report's Work Pending (Work Completed and the Additional Note (remarks) are keys above)
        pendingWork: z.string().trim().max(4000).optional()
      })
      .default({})
  })
  .strict()
  .refine(reportPeriodRefine, { message: 'The reporting period must end on or after its start.', path: ['periodEnd'] })
  // (20270312000100) the three fields' maximums on every save; Work Completed's minimum (10 words) is checked on submission (reportSubmitReady, and the database)
  .superRefine((d, ctx) => addReportWordMaxIssues(ctx, { workCompleted: d.content.workCompleted, pendingWork: d.content.pendingWork, remarks: d.content.remarks }, ['content']));
/** (20270312000100) A work report can be submitted when its three fields are within their limits (Work Completed: 10 to 150 words). */
export const reportSubmitProblems = (content: { workCompleted?: string; pendingWork?: string; remarks?: string } | null | undefined) =>
  dailyReportProblems({ workCompleted: content?.workCompleted, pendingWork: content?.pendingWork, remarks: content?.remarks });

export const reportReviewSchema = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED', 'REVISION_REQUIRED']), comment: optionalText(2000) })
  .strict()
  .refine(d => d.decision === 'APPROVED' || (d.comment ?? '').trim().length >= 3, { message: 'Write a comment so the author knows what to do.', path: ['comment'] });

export const reportListQuerySchema = z
  .object({ status: z.enum([...REPORT_STATUSES, 'PENDING']).optional(), from: isoDate.optional(), to: isoDate.optional(), author: uuidSchema.optional() })
  .strict();

// Team Member reports waiting for (or decided by) the Department Head
export const reportMemberApprovalsQuerySchema = z
  .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'ALL']).optional(), from: isoDate.optional(), to: isoDate.optional() })
  .strict();

export const reportRangeQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine(d => d.to >= d.from, { message: 'The period must end on or after its start.', path: ['to'] });

export const reportPackageSchema = z
  .object({ from: isoDate, to: isoDate, periodType: z.enum(REPORT_PERIOD_TYPES).default('WEEKLY'), note: optionalText(4000) })
  .strict()
  .refine(d => d.to >= d.from, { message: 'The period must end on or after its start.', path: ['to'] });

// ---------------------------------------------------------------------------
// Technical Consultant / Meta Verifier workflow statuses
// ---------------------------------------------------------------------------
export const tcWorkflowStatusSchema = z.object({ status: z.enum(TC_WORKFLOW_STATUSES), note: optionalText(500) }).strict();
export const metaWorkflowStatusSchema = z.object({ status: z.enum(META_WORKFLOW_STATUSES), note: optionalText(500) }).strict();
export const workflowStatusesQuerySchema = z.object({
  ids: z.string().regex(/^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,199}$/, 'Give up to 200 customer ids, separated by commas.')
}).strict();

// Top Performers & Rankings
// ---------------------------------------------------------------------------
/** A month as YYYY-MM or YYYY-MM-01, always handed on as the first day of the month. */
const performerMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, 'Choose a month.')
  .transform(v => (v.length === 7 ? `${v}-01` : v));
export const performersQuerySchema = z.object({ month: performerMonth.optional(), departmentId: uuidSchema.optional() }).strict();
export const performersEvaluateSchema = performersQuerySchema;
export const performerDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional() })
  .strict()
  .refine(v => v.decision === 'APPROVE' || (v.note?.length ?? 0) >= 3, { message: 'Give the reason for rejecting.', path: ['note'] });

// Candidate careers portal. No staff role, ownership or workflow fields are accepted here.
export const careerProfileSchema = z.object({
  name: trimmed(160).min(2), phone: mobileSchema, city: trimmed(120), state: trimmed(120),
  education: trimmed(2000), experience: trimmed(2000), skills: trimmed(2000), bio: trimmed(2000), version: z.number().int().positive()
}).strict();
export const careerJobQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), search: trimmed(120).default(''),
  // catalogue filters (public list); empty = no filter
  team: trimmed(80).default(''), mode: z.enum(['', 'REMOTE', 'HYBRID', 'ONSITE']).default(''), location: trimmed(200).default('')
});
export const careerPostingSchema = z.object({
  id: uuidSchema.optional(), position_id: uuidSchema, title: trimmed(160).min(2), description: trimmed(15000).min(20),
  location: trimmed(200).min(1), employment_type: z.enum(['FULL_TIME','PART_TIME','INTERNSHIP','CONTRACT']),
  published: z.boolean(), closes_at: z.string().datetime({ offset: true }).nullable(), version: z.number().int().positive().optional(),
  // vacancy fields of the HR Recruiter workspace (all optional: an older form still saves)
  openings: z.number().int().min(1).max(500).optional(),
  vacancy_status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED']).optional(),
  responsible_id: uuidSchema.nullable().optional(),
  qualifications: trimmed(4000).nullable().optional(), skills: trimmed(4000).nullable().optional(), experience: trimmed(2000).nullable().optional(),
  required_steps: z.array(z.enum(['CALL', 'ASSESSMENT', 'INTERVIEW'])).max(3).optional(),
  // catalogue fields (all optional: an older form still saves; an empty value clears the field)
  team: trimmed(80).nullable().optional(), work_mode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).nullable().optional(),
  salary_text: trimmed(120).nullable().optional(), responsibilities: trimmed(4000).nullable().optional(), benefits: trimmed(4000).nullable().optional()
}).strict();
export const careerUploadSchema = z.object({ file_name: trimmed(180).regex(/\.pdf$/i, 'Upload a PDF resume.'), size_bytes: z.number().int().min(1).max(10485760) }).strict();
export const careerApplySchema = z.object({ posting_id: uuidSchema, resume_id: uuidSchema }).strict();
export const careerTestSchema = z.object({ title:trimmed(160).min(2),duration_minutes:z.number().int().min(1).max(180),pass_percent:z.number().int().min(1).max(100),
 questions:z.array(z.object({prompt:trimmed(2000).min(1),options:z.array(trimmed(500).min(1)).min(2).max(8),correct:z.number().int().min(0).max(7)}).strict().refine(q=>q.correct<q.options.length,'Choose a valid answer.')).min(1).max(100)
}).strict();
export const careerInviteSchema=z.object({application_id:uuidSchema,test_id:uuidSchema,available_until:z.string().datetime({offset:true})}).strict();
export const careerAttemptSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('START')}).strict(),
 z.object({action:z.enum(['SAVE','SUBMIT']),version:z.number().int().positive(),answers:z.record(z.string().regex(/^(0|[1-9][0-9]{0,2})$/),z.number().int().min(0).max(7))}).strict()
]);
export const careerStageSchema=z.object({application_id:uuidSchema,stage:z.enum(['SCREENING','INTERVIEW','SELECTED','ON_HOLD','REJECTED']),version:z.number().int().positive(),message:trimmed(1000).nullable()}).strict();
export const careerInterviewSchema=z.union([
 z.object({application_id:uuidSchema,round:z.enum(['HR','DEPARTMENT_HEAD','MANAGEMENT']),scheduled_at:z.string().datetime({offset:true}),location:trimmed(1000).min(1)}).strict(),
 z.object({application_id:uuidSchema,id:uuidSchema,version:z.number().int().positive(),status:z.enum(['COMPLETED','CANCELLED']),recommendation:z.enum(['PROCEED','REJECT','HOLD']).nullable(),internal_feedback:trimmed(3000)}).strict()
]);
export const careerOfferSchema=z.union([
 z.object({application_id:uuidSchema,title:trimmed(160).min(2),terms:trimmed(15000).min(20),expires_at:z.string().datetime({offset:true}),joining_date:isoDate}).strict(),
 z.object({application_id:uuidSchema,id:uuidSchema,version:z.number().int().positive(),action:z.enum(['RELEASE','WITHDRAW'])}).strict()
]);
export const careerOfferReplySchema=z.object({response:z.enum(['ACCEPTED','DECLINED']),version:z.number().int().positive()}).strict();
export const careerDocumentRequestSchema=z.union([
 z.object({application_id:uuidSchema,title:trimmed(160).min(2),message:trimmed(1000)}).strict(),
 z.object({application_id:uuidSchema,id:uuidSchema,version:z.number().int().positive(),status:z.enum(['APPROVED','REJECTED']),message:trimmed(1000)}).strict()
]);
export const careerDocumentLinkSchema=z.object({file_id:uuidSchema}).strict();
export const careerTrainingSchema=z.object({application_id:uuidSchema,program_id:uuidSchema.nullable(),complete:z.boolean()}).strict();
export const careerTrainingInviteSchema=z.object({application_id:uuidSchema,test_id:uuidSchema,available_until:z.string().datetime({offset:true}),day:z.number().int().min(1).max(3)}).strict();

// ---------------------------------------------------------------------------
// Company reporting: daily summary, weekly cycle, HR reviews, leaderboard, analysis
// ---------------------------------------------------------------------------
const reportMonday = isoDate.refine(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, { message: 'Choose a week that starts on a Monday.' });

// The weekly report's function: a Department Head of both functions in a department with separate Sales / Support Operations Heads chooses.
export const reportWeeklyFunctionSchema = z.enum(['SALES', 'SUPPORT', 'ALL']);
export const reportWeekQuerySchema = z.object({ weekStart: reportMonday, function: reportWeeklyFunctionSchema.optional() }).strict();
export const reportDailySummaryQuerySchema = z.object({ date: isoDate.optional(), department: uuidSchema.optional() }).strict();
export const reportWeeklySaveSchema = z
  .object({
    weekStart: reportMonday,
    title: z.string().trim().max(200, 'Keep the title under 200 characters.').default(''),
    assignedOverview: optionalText(2000),
    completedOverview: optionalText(2000),
    remarks: optionalText(2000),
    // (20270308000100) the weekly report also says what is pending, what was achieved and what got in the way
    pendingOverview: optionalText(2000),
    achievements: optionalText(2000),
    challenges: optionalText(2000),
    submit: z.boolean().default(false),
    function: reportWeeklyFunctionSchema.optional()
  })
  .strict()
  .refine(d => !d.submit || d.title.trim().length >= 3, { message: 'Enter the weekly report title before submitting.', path: ['title'] });
export const reportWeeklyReviewSchema = z
  .object({ decision: z.enum(['APPROVED', 'REVISION_REQUIRED']), comment: optionalText(2000) })
  .strict()
  .refine(d => d.decision === 'APPROVED' || (d.comment ?? '').trim().length >= 3, { message: 'Write a comment so the Department Head knows what to correct.', path: ['comment'] });

export const hrReviewsQuerySchema = z.object({ weekStart: reportMonday.optional() }).strict();
export const hrReviewSaveSchema = z
  .object({
    packageId: uuidSchema,
    subjectId: uuidSchema,
    rating: z.number().int().min(1).max(10).nullable().default(null),
    consistencyNote: optionalText(1000),
    workAssessment: optionalText(2000),
    comments: optionalText(2000),
    recommendations: optionalText(2000),
    submit: z.boolean().default(false)
  })
  .strict()
  .refine(d => !d.submit || (d.rating !== null && ((d.workAssessment ?? '').trim() !== '' || (d.comments ?? '').trim() !== '')), {
    message: 'Give a rating and write the work assessment or your comments before submitting the review.',
    path: ['rating']
  });
export const hrConsolidatedSaveSchema = z.object({ weekStart: reportMonday, note: optionalText(4000), submit: z.boolean().default(false) }).strict();
export const hrReviewLogQuerySchema = z
  .object({ department: uuidSchema.optional(), search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1) })
  .strict();

const numberFilter = (max: number) => z.coerce.number().min(0).max(max).optional();
export const reportLeaderboardQuerySchema = z
  .object({
    periodType: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']).default('WEEKLY'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    category: z.enum(['TOP10', 'BOTTOM10', 'TOP_MEMBERS', 'LOWEST_MEMBERS', 'TOP_LEADS', 'LOWEST_LEADS', 'TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS', 'ALL']).default('TOP10'),
    department: uuidSchema.optional(),
    team: uuidSchema.optional(),
    designation: z.string().trim().max(120).optional(),
    role: z.enum(['TEAM_MEMBER', 'TEAM_LEAD', 'DEPARTMENT_HEAD']).optional(),
    person: uuidSchema.optional(),
    teamLead: uuidSchema.optional(),
    departmentHead: uuidSchema.optional(),
    operationsHead: uuidSchema.optional(),
    performance: z.enum(['STRONG', 'AVERAGE', 'NEEDS_ATTENTION', 'INSUFFICIENT_DATA']).optional(),
    ratingMin: numberFilter(10),
    ratingMax: numberFilter(10),
    complianceMin: numberFilter(100),
    complianceMax: numberFilter(100),
    completionMin: numberFilter(100),
    completionMax: numberFilter(100),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional()
  })
  .strict();
export const reportEmployeeProfileQuerySchema = z
  .object({ periodType: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']).default('MONTHLY'), from: isoDate.optional(), to: isoDate.optional() })
  .strict();
export const reportAnalysisQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine(d => d.to >= d.from, { message: 'The period must end on or after its start.', path: ['to'] });
export const reportSettingsSchema = z
  .object({
    weights: z.object({
      taskCompletion: z.number().min(0).max(100), compliance: z.number().min(0).max(100), onTime: z.number().min(0).max(100),
      approvalQuality: z.number().min(0).max(100), hrRating: z.number().min(0).max(100)
    }).strict().refine(w => Object.values(w).some(v => v > 0), { message: 'At least one measure needs a weight above 0.' }),
    minTasks: z.number().int().min(1).max(100),
    minExpectedReports: z.number().int().min(1).max(100),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
  })
  .strict();


// ---- HR Recruiter workspace ----------------------------------------------------------------------------------------------------------
export const RECRUITER_STAGES = [
  'NEW_APPLICATION', 'INITIAL_SCREENING', 'CALL_SCHEDULED', 'CALL_COMPLETED', 'TEST_PENDING', 'TEST_COMPLETED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED',
  'SELECTION_REVIEW', 'SELECTED', 'REJECTED', 'ON_HOLD'
] as const;
export const VACANCY_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED'] as const;
export const CALL_OUTCOMES = ['ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER', 'INTERESTED', 'UNREACHABLE'] as const;
export const INTERVIEW_ROUNDS = ['HR', 'DEPARTMENT_HEAD', 'MANAGEMENT'] as const;
export const INTERVIEW_MODES = ['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER'] as const;
export const INTERVIEW_RESULTS = ['PROCEED', 'SHORTLIST', 'REJECT', 'HOLD', 'FURTHER_EVALUATION'] as const;
export const REJECTION_CATEGORIES = ['SKILLS_MISMATCH', 'EXPERIENCE', 'ASSESSMENT', 'INTERVIEW', 'NOT_INTERESTED', 'POSITION_FILLED', 'OTHER'] as const;

const recruiterText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
/** The filters every recruiter list shares; the database applies them (and the caller's own scope). */
export const recruiterFiltersSchema = z
  .object({
    posting: uuidSchema.optional(),
    department: uuidSchema.optional(),
    designation: recruiterText(120).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: recruiterText(120).optional(),
    stage: z.enum(RECRUITER_STAGES).optional(),
    status: z.enum(['SUBMITTED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'ON_HOLD', 'SELECTED', 'REJECTED', 'WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED']).optional(),
    assessment: z.enum(['NONE', 'PENDING', 'PASSED', 'FAILED']).optional(),
    interview: z.enum(['NONE', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
    recruiter: uuidSchema.optional(),
    result: z.enum(['SELECTED', 'REJECTED', 'ON_HOLD', 'PENDING']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict();
export type RecruiterFilters = z.infer<typeof recruiterFiltersSchema>;
export const recruiterVacanciesQuerySchema = z.object({ status: z.enum(VACANCY_STATUSES).optional(), department: uuidSchema.optional() }).strict();
export const recruiterPipelineQuerySchema = z.object({ posting: uuidSchema.optional() }).strict();
export const recruiterDecisionsQuerySchema = z.object({ view: z.enum(['READY', 'DECIDED']).default('READY') }).strict();
export const recruiterVacancyAssignSchema = z.object({ recruiter: uuidSchema.nullable() }).strict();
export const recruiterVacancyStatusSchema = z.object({ status: z.enum(VACANCY_STATUSES), note: recruiterText(500).optional() }).strict();
export const recruiterNoteSchema = z
  .object({ kind: z.enum(['NOTE', 'EVALUATION']).default('NOTE'), body: recruiterText(2000).min(1, 'Write the note.') })
  .strict();
export const recruiterStageSchema = z
  .object({ action: z.enum(['SCREEN', 'HOLD', 'RESUME', 'REQUEST_REVIEW', 'CLEAR_REVIEW']), comment: recruiterText(1000).optional() })
  .strict()
  .refine(v => v.action !== 'HOLD' || (v.comment ?? '').length >= 3, { message: 'Write the reason for putting the application on hold.', path: ['comment'] });
export const recruiterCallSchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('SCHEDULE'), scheduledAt: z.string().datetime({ offset: true }), note: recruiterText(1000).optional() }).strict(),
    z
      .object({
        action: z.literal('RECORD'),
        callId: uuidSchema.optional(),
        outcome: z.enum(CALL_OUTCOMES, { errorMap: () => ({ message: 'A call is completed only with its outcome. Choose one.' }) }),
        note: recruiterText(1000).optional(),
        followUpDate: isoDate.optional()
      })
      .strict()
  ])
  .superRefine((v, ctx) => {
    if (v.action === 'RECORD' && v.outcome === 'CALL_BACK' && !v.followUpDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the follow-up date for a call-back.', path: ['followUpDate'] });
    }
  });
export const recruiterInterviewSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.enum(['SCHEDULE', 'RESCHEDULE']),
        id: uuidSchema.optional(),
        round: z.enum(INTERVIEW_ROUNDS),
        scheduledAt: z.string().datetime({ offset: true }),
        location: recruiterText(1000).min(1, 'Enter where or how the interview takes place.'),
        mode: z.enum(INTERVIEW_MODES).optional(),
        interviewer: recruiterText(120).optional(),
        interviewerId: uuidSchema.optional()
      })
      .strict(),
    z.object({ action: z.enum(['CONFIRM', 'CANCEL']), id: uuidSchema, version: z.number().int().min(1) }).strict(),
    z
      .object({
        action: z.literal('COMPLETE'),
        id: uuidSchema,
        version: z.number().int().min(1),
        result: z.enum(INTERVIEW_RESULTS, { errorMap: () => ({ message: 'Record the interview result.' }) }),
        feedback: recruiterText(3000).optional()
      })
      .strict()
  ])
  .superRefine((v, ctx) => {
    if (v.action === 'RESCHEDULE' && !v.id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the interview to reschedule.', path: ['id'] });
  });
export const recruiterInviteSchema = z.object({ testId: uuidSchema, until: z.string().datetime({ offset: true }) }).strict();
export const recruiterDecisionSchema = z
  .object({ decision: z.enum(['SELECTED', 'REJECTED']), category: z.enum(REJECTION_CATEGORIES).optional(), reason: recruiterText(1000).optional() })
  .strict()
  .refine(v => v.decision !== 'REJECTED' || !!v.category || !!v.reason, { message: 'Choose a rejection category or write the reason.', path: ['category'] });
export const recruiterDecisionCorrectionSchema = z
  .object({ decision: z.enum(['SELECTED', 'REJECTED']), reason: recruiterText(1000).min(5, 'Write why the decision is corrected (at least 5 characters).') })
  .strict();
export const recruitmentEmailAdminQuerySchema = z
  .object({ status: z.enum(['PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'DRY_RUN']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();

// --- Department x function scopes, company-readable internal chat, delegated task detail (migrations 20261224000100-300) ---------------
/** How new internal (direct / group) chat messages are stored. Super Admin only. */
export const chatInternalModeSchema = z.object({ mode: z.enum(['STANDARD', 'E2EE'], { errorMap: () => ({ message: 'Choose STANDARD or E2EE.' }) }) }).strict();
const opsDivision = z.enum(['SALES', 'SUPPORT']).nullable();
/** An Operations Head's whole scope in one save: the operations function, the departments, a narrower function per department, who approves. */
export const operationsScopeApplySchema = z
  .object({
    function: opsDivision,
    departments: z
      .array(z.object({ departmentId: z.string().uuid(), division: opsDivision.default(null), primary: z.boolean().default(false) }).strict())
      .min(1, 'An Operations Head needs at least one department.')
      .max(40, 'Too many departments.')
  })
  .strict();
/** A Team Lead hands a Department Head's task to their own Team Members, each with their own share of the work (optional). */
export const taskDelegateSchema = z
  .object({
    assignments: z
      .array(z.object({ memberId: z.string().uuid(), work: z.string().trim().max(500, 'Keep each member’s share under 500 characters.').optional() }).strict())
      .min(1, 'Choose at least one team member.')
      .max(50, 'Too many team members at once.')
  })
  .strict();

// --- Team Lead direct scope and the multi-level leave chain (migrations 20261225000100-200) -----------------------------------
/** One step of a leave request: approve, reject (a reason is required) or send back for changes (a reason is required). */
export const leaveStageDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT', 'REVISE']), note: optionalText(1000) })
  .strict()
  .refine(v => v.decision === 'APPROVE' || (!!v.note && v.note.length >= 3), { message: 'Give a reason.', path: ['note'] });
export const leaveResubmitSchema = z.object({ reason: trimmed(1000).min(3, 'Enter the reason for the leave.') }).strict();
/** Super Admin only: new requests follow the multi-level chain or the earlier two-step flow. */
export const leaveWorkflowSchema = z.object({ workflow: z.enum(['MULTI_LEVEL', 'TWO_STEP']) }).strict();
/** Super Admin only: the department-wide Support desk read of post-sale customers (off by default). */
export const supportDeskSchema = z.object({ departmentWide: z.boolean() }).strict();

// --- HR Recruiter: create / edit a vacancy (migration 20261227000200) ----------------------------------------------------------------
export const VACANCY_EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT'] as const;
export const VACANCY_WORK_MODES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
const vacancyOptional = (max: number) => recruiterText(max).optional().transform(v => (v ? v : undefined));
/** The vacancy form of the HR Recruiter page; the database checks the same rules again (and the department, the caller and the version). */
export const recruiterVacancySaveSchema = z
  .object({
    title: recruiterText(120).min(2, 'Enter the job title / designation.'),
    departmentId: uuidSchema,
    openings: z.coerce.number().int('Enter a whole number of openings.').min(1, 'At least one opening.').max(500, 'At most 500 openings.'),
    description: recruiterText(15000).min(20, 'Describe the job in at least 20 characters.'),
    responsibilities: vacancyOptional(4000),
    skills: vacancyOptional(4000),
    qualifications: vacancyOptional(4000),
    experience: vacancyOptional(2000),
    employmentType: z.enum(VACANCY_EMPLOYMENT_TYPES, { message: 'Choose the employment type.' }),
    workMode: z.enum(VACANCY_WORK_MODES).optional(),
    location: recruiterText(200).min(1, 'Enter the job location.'),
    closesAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the application deadline as a date.').optional(),
    status: z.enum(['DRAFT', 'OPEN']).optional(),
    responsibleId: uuidSchema.optional(),
    version: z.coerce.number().int().min(1).optional()
  })
  .strict();
export type RecruiterVacancySaveInput = z.infer<typeof recruiterVacancySaveSchema>;

// --- Field Visit: live location, Field Visit leads -> Department Head -> Telecaller, retry-safe lead create (migration 20261228000100) ------
/** The existing lead create, with an optional id the browser makes once per form: sending the same id again returns the first lead. */
export const leadCreateRequestSchema = leadCreateSchema.extend({ clientRequestId: uuidSchema.optional() }).strict();
export type LeadCreateRequestInput = z.infer<typeof leadCreateRequestSchema>;
const trackPoint = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().int().min(0).max(100_000),
    recordedAt: z.string().datetime({ offset: true })
  })
  .strict();
export const fieldVisitTrackingStartSchema = trackPoint;
export const fieldVisitTrackingPointsSchema = z.object({ points: z.array(trackPoint).min(1).max(50) }).strict();
export const fieldVisitTrackingIssueSchema = z.object({ issue: z.enum(['PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT']) }).strict();
export const fieldVisitTrackingBoardQuerySchema = z.object({ date: isoDate.optional() }).strict();
export const fieldVisitLeadQueueQuerySchema = z
  .object({ status: z.enum(['PENDING', 'ASSIGNED', 'ALL']).default('PENDING'), search: trimmed(120).optional(), ...pageParams })
  .strict();
export const fieldVisitLeadAssignSchema = z.object({ telecallerId: uuidSchema, note: optionalText(500) }).strict();

// --- Company chat directory: department filter (migration 20261228000300) ----------------------------------------------------------------
export const chatDirectoryQuerySchema = chatSearchQuerySchema.extend({ department: uuidSchema.optional() });

// ---------------------------------------------------------------------------
// Candidate portal: direct registration (no e-mail verification) - POST /candidate-auth/register
// ---------------------------------------------------------------------------
/** The same rules as the portal's sign-up form: the password is 10-72 characters, the mobile number a real Indian mobile. */
export const candidateRegisterSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(160, 'Use at most 160 characters.'),
    email: emailSchema,
    phone: mobileSchema,
    password: z.string().min(10, 'Use at least 10 characters.').max(72, 'Use at most 72 characters.')
  })
  .strict();
export type CandidateRegisterInput = z.infer<typeof candidateRegisterSchema>;

// --- HR documents: NDA and Experience Letter (migration 20261229000200) -------------------------------------------------------------------
// The letters are drawn on the official templates by the server (server/hrDocuments). The browser sends only the values HR may edit; the
// employee, the joining date and the employee code always come from the HR record in the database.
export const HR_DOC_TYPES = ['NDA', 'EXPERIENCE', 'OFFER'] as const;
export const HR_DOC_TITLES = ['Mr.', 'Miss', 'Mrs.', 'Ms.'] as const;
const hrDocDate = (label: string) =>
  isoDate.refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, `Enter a real date for ${label}.`);
/** Letters only (the documents are printed in a standard Latin font), so a name that cannot be printed is refused here, not silently changed. */
const hrDocName = (label: string) =>
  z.string().trim().min(2, `Enter ${label}.`).max(100, `${label} is too long.`)
    .transform(v => v.replace(/\s+/g, ' '))
    .refine(v => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'\-]*$/.test(v), `${label} may contain letters, spaces, full stops, apostrophes and hyphens only.`);
const hrDocLine = (label: string, max: number) =>
  z.string().trim().min(2, `Enter ${label}.`).max(max, `${label} is too long.`)
    .transform(v => v.replace(/\s+/g, ' '))
    .refine(v => /^[A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ .,'&()/\-]*$/.test(v), `${label} contains a character that cannot be printed.`);
export const hrDocTypeSchema = z.enum(HR_DOC_TYPES);
export const hrDocEmployeeKeySchema = z.string().trim().min(3).max(80).regex(/^(HR:[A-Za-z0-9_.\-]+|[0-9a-fA-F-]{36})$/, 'Choose an employee from the list.');
export const hrDocPrefillQuerySchema = z.object({ employeeKey: hrDocEmployeeKeySchema, type: hrDocTypeSchema }).strict();
export const hrNdaFieldsSchema = z.object({ letterDate: hrDocDate('the agreement date'), employeeName: hrDocName('the employee name') }).strict();
export const hrExperienceFieldsSchema = z
  .object({
    letterDate: hrDocDate('the letter date'),
    title: z.enum(HR_DOC_TITLES, { errorMap: () => ({ message: 'Choose Mr., Miss, Mrs. or Ms.' }) }),
    employeeName: hrDocName('the employee name'),
    designation: hrDocLine('the designation', 80),
    lastWorkingDate: hrDocDate('the last working date'),
    signatoryName: hrDocName('the signatory name'),
    signatoryTitle: hrDocLine('the signatory title', 60)
  })
  .strict();
export const hrDocRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NDA'), employeeKey: hrDocEmployeeKeySchema, fields: hrNdaFieldsSchema }).strict(),
  // the Experience Letter may carry its edited wording and the Offer Letter always does (block "HR letters" below, migration 20261231000700)
  z.object({ type: z.literal('EXPERIENCE'), employeeKey: hrDocEmployeeKeySchema, fields: z.lazy(() => hrExperienceLetterFieldsSchema) }).strict(),
  // the Offer Letter: a role-based template (20270206000100: the template, its version and the values) or the earlier master template
  z.object({ type: z.literal('OFFER'), employeeKey: hrDocEmployeeKeySchema, fields: z.lazy(() => z.union([hrRoleOfferFieldsSchema, hrOfferFieldsSchema])) }).strict()
]);
export const hrDocListQuerySchema = z.object({ employeeKey: hrDocEmployeeKeySchema.optional(), type: hrDocTypeSchema.optional() }).strict();

// ---- The Operations Head's daily drill-down by person (20261230000300): a department and a period of up to three months ----
export const operationsPeopleQuerySchema = z.object({ department: uuidSchema, from: isoDate, to: isoDate }).strict()
  .refine(q => q.to >= q.from, { message: 'The end date cannot be before the start date.', path: ['to'] });

// ---- Client support groups and message status (20261230000500) ----
export const chatReceiptsQuerySchema = z.object({ after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict();
export const clientSupportGroupSaveSchema = z.object({
  name: z.string().trim().max(80, 'Keep the group name under 80 characters.').optional().nullable(),
  add: z.array(uuidSchema).max(25, 'Add at most 25 people at once.').optional(),
  remove: z.array(uuidSchema).max(25, 'Remove at most 25 people at once.').optional()
}).strict();

// --- Paid leave after probation: balance, HR corrections, policy (migration 20261231000200) --------------------------------------------------
const halfDays = (min: number, max: number) => z.coerce.number().min(min).max(max).refine(n => Number.isInteger(n * 2), 'Use whole or half days.');
export const paidLeaveAdjustSchema = z
  .object({ kind: z.enum(['OPENING_BALANCE', 'CORRECTION']), days: halfDays(-400, 400).refine(n => n !== 0, 'Not zero.'), note: trimmed(500).min(5, 'Give the reason.') })
  .strict();
export const paidLeavePolicySchema = z
  .object({
    enabled: z.boolean(),
    monthlyDays: halfDays(0.5, 10),
    creditDay: z.coerce.number().int().min(1).max(28),
    partialMonthRule: z.enum(['NEXT_FULL_MONTH', 'EFFECTIVE_MONTH']),
    startMonth: isoDate.nullable().optional()
  })
  .strict()
  .refine(v => !v.enabled || !!v.startMonth, { message: 'Choose the first month to credit.', path: ['startMonth'] });
export const confirmationDateSchema = z.object({ effectiveDate: isoDate, note: trimmed(500).min(5, 'Give the reason for the change.') }).strict();
export const paidLeaveListQuerySchema = z.object({ search: trimmed(120).optional() }).strict();

// --- HR letters: the Offer Letter, editable wording, versioned master templates (migration 20261231000700) ----------------------------------
// The wording is the official letters' (shared/hrLetters.ts). HR may edit it per letter, and HR leadership may save new master versions; the
// placeholders must be ones the letter knows, and everything must be printable (the renderer refuses what the PDF font cannot print).
const letterText = (label: string, max: number, min = 1) =>
  z.string().transform(v => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(min, `Enter ${label}.`).max(max, `${label} is too long (at most ${max} characters).`));
const letterList = (label: string, max: number, maxItems: number, minItems = 0) =>
  z.array(letterText(label, max)).min(minItems, `Add at least ${minItems} ${label}.`).max(maxItems, `At most ${maxItems} ${label}.`);
const withKnownPlaceholders = <T extends HrOfferContent | HrExperienceContent>(type: HrLetterType) => (c: T, ctx: z.RefinementCtx) => {
  const bad = unknownPlaceholders(type, c);
  if (bad.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown placeholder${bad.length > 1 ? 's' : ''}: ${bad.map(b => `{${b}}`).join(', ')}.` });
};
export const hrOfferContentSchema = z
  .object({
    subject: letterText('the subject', 200),
    salutation: letterText('the salutation', 120),
    paragraphs: letterList('paragraphs', 1500, 6, 1),
    responsibilitiesHeading: letterText('the responsibilities heading', 60),
    responsibilities: letterList('responsibilities', 300, 15),
    termsHeading: letterText('the terms heading', 60),
    terms: z.array(z.object({ label: letterText('the term name', 60), value: letterText('the term value', 200) }).strict()).min(1, 'Add at least one employment term.').max(15, 'At most 15 employment terms.'),
    closing: letterList('closing paragraphs', 600, 4),
    signOff: letterText('the sign-off', 80),
    acceptanceHeading: letterText('the acceptance heading', 60),
    acceptance: letterText('the acceptance text', 800)
  })
  .strict()
  .superRefine(withKnownPlaceholders<HrOfferContent>('OFFER'));
export const hrExperienceContentSchema = z
  .object({
    greeting: letterText('the greeting', 120),
    paragraphs: letterList('paragraphs', 1500, 6, 1),
    signOff: letterText('the closing word', 60)
  })
  .strict()
  .superRefine(withKnownPlaceholders<HrExperienceContent>('EXPERIENCE'));
const hrDocMoney = (label: string) =>
  z.string().trim().min(1, `Enter ${label}.`).max(80, `${label} is too long.`).transform(v => v.replace(/\s+/g, ' '))
    .refine(v => /^[A-Za-z0-9₹ .,'&()/\-+]+$/.test(v), `${label} may contain letters, digits, ₹ and . , / - ( ) only.`);
export const hrOfferFieldsSchema = z
  .object({
    letterDate: hrDocDate('the letter date'),
    employeeName: hrDocName('the employee name'),
    designation: hrDocLine('the designation', 80),
    department: hrDocLine('the department', 80),
    employmentType: hrDocLine('the employment type', 40),
    joiningDate: hrDocDate('the date of joining'),
    salary: hrDocMoney('the salary'),
    probation: hrDocLine('the probation period', 40),
    reportingTo: hrDocLine('the reporting manager', 80),
    signatoryName: hrDocName('the signatory name'),
    content: hrOfferContentSchema,
    templateVersion: z.number().int().min(1)
  })
  .strict();
export const hrExperienceLetterFieldsSchema = hrExperienceFieldsSchema.extend({
  content: hrExperienceContentSchema.optional(),
  templateVersion: z.number().int().min(1).optional()
}).strict();
export const hrLetterTypeSchema = z.enum(['OFFER', 'EXPERIENCE']);
export const hrLetterTemplateSaveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('OFFER'), content: hrOfferContentSchema, baseVersion: z.number().int().min(1), note: z.string().trim().max(200).optional() }).strict(),
  z.object({ type: z.literal('EXPERIENCE'), content: hrExperienceContentSchema, baseVersion: z.number().int().min(1), note: z.string().trim().max(200).optional() }).strict()
]);
export const hrLetterTemplateVersionParamSchema = z.coerce.number().int().min(1).max(100000);

// --- HR employee files (migration 20261231000800_hr_employee_files.sql); the database enforces the same rules again ------------------------
export const hrEmployeeFileKindSchema = z.enum(HR_EMPLOYEE_FILE_KINDS, { errorMap: () => ({ message: 'Choose what kind of document this is.' }) });
export const hrEmployeeFileUploadSchema = z
  .object({
    employeeKey: hrDocEmployeeKeySchema,
    kind: hrEmployeeFileKindSchema,
    fileName: z.string().trim().min(1, 'The file needs a name.').max(200, 'The file name is too long (up to 200 characters).'),
    mimeType: z.enum(HR_EMPLOYEE_FILE_MIME_TYPES, { errorMap: () => ({ message: 'Upload a PDF, JPG, PNG, Word (.docx) or e-mail (.eml) file.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(HR_EMPLOYEE_FILE_MAX_BYTES, `Files can be at most ${HR_EMPLOYEE_FILE_MAX_LABEL}.`),
    leaveRef: z.string().trim().max(100).optional().nullable().transform(v => v || null),
    note: z.string().trim().max(500, 'The note can be at most 500 characters.').optional().nullable().transform(v => v || null)
  })
  .strict()
  .refine(v => !(v.kind === 'LEAVE_MAIL' || v.kind === 'LEAVE_CANCELLATION_MAIL') || !!v.leaveRef, {
    message: 'A leave mail must name the leave it belongs to.',
    path: ['leaveRef']
  });
export const hrEmployeeFileListQuerySchema = z.object({ employeeKey: hrDocEmployeeKeySchema }).strict();

/** The type to declare for a file the browser picked: its own type, or (empty / generic, common for .eml and .docx) from the extension. */
export function hrEmployeeFileMimeOf(fileName: string, browserType: string): HrEmployeeFileMimeType | null {
  const t = (browserType || '').toLowerCase();
  if ((HR_EMPLOYEE_FILE_MIME_TYPES as readonly string[]).includes(t)) return t as HrEmployeeFileMimeType;
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, HrEmployeeFileMimeType> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', eml: 'message/rfc822'
  };
  return byExt[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Meetings (Google Calendar, booking links, CEO approval)
// ---------------------------------------------------------------------------
const isoInstant = z.string().trim().max(40).refine(v => !Number.isNaN(Date.parse(v)) && /T/.test(v), 'Use a date and time (ISO 8601).');
export const CALENDAR_MEETING_KINDS = ['APPOINTMENT', 'DEMO', 'MEETING', 'INTERVIEW', 'CEO_MEETING'] as const;
export const CALENDAR_MEETING_MODES = ['GOOGLE_MEET', 'ONLINE_LINK', 'IN_PERSON', 'PHONE'] as const;
const meetingGuestSchema = z.object({
  name: optionalText(200),
  email: emailSchema,
  phone: z.preprocess(v => (v === '' ? null : v), phoneSchema.nullable().optional())
}).strict();

export const meetingCreateSchema = z.object({
  title: trimmed(200).min(2, 'Give the meeting a title.'),
  description: optionalText(4000),
  /** Extra message to the CEO with a request for their time (the agenda is the description). */
  message: optionalText(2000),
  kind: z.enum(CALENDAR_MEETING_KINDS).default('MEETING'),
  hostId: uuidSchema.optional().nullable(),
  startsAt: isoInstant,
  endsAt: isoInstant,
  timezone: optionalText(64),
  mode: z.enum(CALENDAR_MEETING_MODES).default('GOOGLE_MEET'),
  location: optionalText(500),
  meetLink: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use an https:// link.').nullable().optional()),
  customerId: uuidSchema.optional().nullable(),
  attendeeIds: z.array(uuidSchema).max(30, 'Invite at most 30 colleagues.').default([]),
  guests: z.array(meetingGuestSchema).max(30, 'Invite at most 30 guests.').default([]),
  allowOverlap: z.boolean().default(false)
}).strict()
  .refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'The meeting must end after it starts.', path: ['endsAt'] })
  .refine(v => v.mode !== 'ONLINE_LINK' || !!v.meetLink, { message: 'Give the meeting link.', path: ['meetLink'] });

export const meetingListQuerySchema = z.object({
  from: isoInstant,
  to: isoInstant,
  hostId: uuidSchema.optional()
}).strict().refine(v => Date.parse(v.to) > Date.parse(v.from), { message: '"to" must be after "from".', path: ['to'] });

export const meetingRescheduleSchema = z.object({
  startsAt: isoInstant,
  endsAt: isoInstant,
  note: optionalText(1000),
  version: z.number().int().min(1).optional()
}).strict().refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'The meeting must end after it starts.', path: ['endsAt'] });

export const calendarMeetingCancelSchema = z.object({ reason: optionalText(1000), version: z.number().int().min(1).optional() }).strict();
export const meetingCompleteSchema = z.object({ note: optionalText(1000) }).strict();
export const meetingDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'DECLINE', 'PROPOSE']),
  note: optionalText(1000),
  startsAt: isoInstant.optional().nullable(),
  endsAt: isoInstant.optional().nullable(),
  version: z.number().int().min(1).optional()
}).strict().refine(v => v.decision !== 'PROPOSE' || (!!v.startsAt && !!v.endsAt && Date.parse(v.endsAt) > Date.parse(v.startsAt)),
  { message: 'Propose a start and an end time.', path: ['startsAt'] });
export const meetingProposalAnswerSchema = z.object({ accept: z.boolean() }).strict();
export const meetingResponseSchema = z.object({ response: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']) }).strict();
/** The dashboard sections of the meeting requests with the CEO. */
export const ceoRequestsQuerySchema = z.object({
  section: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RESCHEDULED', 'ALL']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();
export const meetingDirectoryQuerySchema = z.object({ search: optionalText(100) }).strict();
// ---- Live meeting availability (migration 20270116000400): Enter Meeting may name the meeting being entered ----
export const meetingPresenceEnterSchema = z.object({ meetingId: uuidSchema.nullable().optional() }).strict();
/** The Super Admin's fixed meeting-room link (20270128000100): https, or empty to remove it. */
/** HR marks (or undoes) the CEO's office arrival; ceoId only when there is more than one CEO (20270128000300) */
export const ceoArrivalSchema = z.object({ ceoId: uuidSchema.optional() }).strict();
export const meetingRoomLinkSchema = z.object({ roomLink: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use an https:// link.').nullable()) }).strict();
/** GET /meetings/presence?ids=a,b,c: the live status of up to 100 colleagues (20270122000100); without ids, one's own. */
export const meetingPresenceQuerySchema = z.object({
  ids: z.preprocess(v => (typeof v === 'string' ? v.split(',').map(x => x.trim()).filter(Boolean) : v), z.array(uuidSchema).min(1).max(100)).optional()
}).strict();
export const meetingBusySchema = z.object({
  profileIds: z.array(uuidSchema).min(1).max(30),
  from: isoInstant,
  to: isoInstant
}).strict().refine(v => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000,
  { message: 'Ask for at most 62 days.', path: ['to'] });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');
export const meetingAvailabilitySchema = z.object({
  timezone: trimmed(64).min(1),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm }).strict()
    .refine(w => w.end > w.start, { message: 'Each window must end after it starts.' })).max(50)
}).strict();

export const meetingBookingLinkSchema = z.object({
  id: uuidSchema.optional().nullable(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/, 'Use 4-64 lowercase letters, digits or dashes.'),
  title: trimmed(120).min(2, 'Give the link a title.'),
  description: optionalText(2000),
  kind: z.enum(CALENDAR_MEETING_KINDS).optional(),
  durationMinutes: z.number().int().min(10).max(480).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeMinutes: z.number().int().min(0).max(20160).default(120),
  maxDaysAhead: z.number().int().min(1).max(180).default(30),
  mode: z.enum(['GOOGLE_MEET', 'IN_PERSON', 'PHONE']).default('GOOGLE_MEET'),
  location: optionalText(300),
  requiresApproval: z.boolean().default(false),
  isActive: z.boolean().default(true)
}).strict();

export const meetingDelegatesSchema = z.object({ delegateIds: z.array(uuidSchema).max(10, 'Name at most 10 delegates.') }).strict();

/** A guest booking through a public link. `website` is a honeypot: people never fill it in, bots do. */
export const publicBookingSchema = z.object({
  startsAt: isoInstant,
  name: trimmed(200).min(2, 'Give your name.'),
  email: emailSchema,
  phone: z.preprocess(v => (v === '' ? null : v), phoneSchema.nullable().optional()),
  notes: optionalText(2000),
  website: z.string().max(200).optional()
}).strict();
export const publicBookingCancelSchema = z.object({ reason: optionalText(1000) }).strict();
export const bookingSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/, 'Unknown booking link.');
// --- Candidate Portal abuse protection (docs/ABUSE_PROTECTION.md) ------------------------------------------------------------------------
// POST /api/v1/candidate-auth/guard: the portal asks before a sign-in, a reset link or an application. The Turnstile token travels in the
// x-turnstile-token header, the visitor's address in the signed x-portal-client-* headers.
export const CANDIDATE_GUARD_ACTIONS = ['sign_in', 'reset', 'apply'] as const;
export const candidateGuardSchema = z
  .object({
    action: z.enum(CANDIDATE_GUARD_ACTIONS),
    email: z.string().trim().max(254).optional()
  })
  .strict();
export type CandidateGuardInput = z.infer<typeof candidateGuardSchema>;

// ---------------------------------------------------------------------------
// Upload Leads (docs/LEAD_UPLOAD.md). Each row is checked with the Add Lead rules (leadUploadLeadSchema reuses leadCreateSchema's fields);
// a row that fails is reported with its row number, it never fails the whole request.
// ---------------------------------------------------------------------------
export const LEAD_UPLOAD_MAX_ROWS = 5000;
/** rows imported per request (each request is one database transaction) */
export const LEAD_UPLOAD_CHUNK_ROWS = 100;
const leadUploadCell = z.preprocess(
  v => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : v),
  z.string().max(5000, 'A value in this row is too long.')
);
export const leadUploadRawRowSchema = z
  .object({
    row: z.number().int().min(1).max(1_000_000),
    name: leadUploadCell, contactPerson: leadUploadCell, phone: leadUploadCell, email: leadUploadCell, company: leadUploadCell,
    businessType: leadUploadCell, location: leadUploadCell, services: leadUploadCell, leadSource: leadUploadCell,
    description: leadUploadCell, followUpDate: leadUploadCell, assignee: leadUploadCell
  })
  .strict();
const uniqueRowNumbers = (rows: { row: number }[]) => new Set(rows.map(r => r.row)).size === rows.length;
export const leadUploadCheckSchema = z
  .object({ rows: z.array(leadUploadRawRowSchema).min(1, 'The file has no lead rows.').max(LEAD_UPLOAD_MAX_ROWS, `A file can have at most ${LEAD_UPLOAD_MAX_ROWS} leads. Split it into smaller files.`) })
  .strict()
  .refine(v => uniqueRowNumbers(v.rows), { message: 'Each row number can appear once.' });
export const leadUploadStartSchema = z
  .object({
    clientRequestId: uuidSchema,
    fileName: trimmed(200).min(1, 'The file name is missing.'),
    fileType: z.enum(['XLSX', 'CSV'], { errorMap: () => ({ message: 'Upload an Excel (.xlsx) or CSV (.csv) file.' }) }),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/, 'The file could not be identified.'),
    totalRows: z.number().int().min(1).max(LEAD_UPLOAD_MAX_ROWS)
  })
  .strict();
export const leadUploadRowsSchema = z
  .object({ rows: z.array(leadUploadRawRowSchema).min(1).max(LEAD_UPLOAD_CHUNK_ROWS * 2) })
  .strict()
  .refine(v => uniqueRowNumbers(v.rows), { message: 'Each row number can appear once.' });
/** The lead values of one row, with the same rules as the Add Lead form. */
export const leadUploadLeadSchema = z
  .object({
    name: leadCreateSchema.shape.name,
    company: leadCreateSchema.shape.company,
    phone: leadCreateSchema.shape.phone,
    email: leadCreateSchema.shape.email,
    city: leadCreateSchema.shape.city,
    businessCategory: leadCreateSchema.shape.businessCategory,
    leadSource: leadCreateSchema.shape.leadSource,
    nextFollowUpAt: leadCreateSchema.shape.nextFollowUpAt,
    notes: leadCreateSchema.shape.notes
  })
  .strict();
export type LeadUploadLeadInput = z.infer<typeof leadUploadLeadSchema>;

// ---- BolifyAI panel recharge reminder calls (monitoring list for the Super Admin and HR staff) -------------------------------------------
export const REMINDER_CALL_FILTERS = ['ALL', 'STAGE_7', 'STAGE_5', 'STAGE_1', 'PENDING', 'SUBMITTED', 'FAILED', 'COMPLETED', 'SKIPPED'] as const;
export const reminderCallListQuerySchema = z
  .object({
    filter: z.enum(REMINDER_CALL_FILTERS).default('ALL'),
    page: z.coerce.number().int().min(1).max(5000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(50)
  })
  .strict();
export type ReminderCallListQuery = z.infer<typeof reminderCallListQuerySchema>;

// ---- AI Design Studio (migration 20270110000100) -------------------------------------------------------------------------------------------
// The browser sends no role, team or reviewer: the ads_* database functions read those from the login. The database checks every value again.
const adsLinkSchema = z
  .object({ name: trimmed(120).optional(), url: z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, 'An attachment link must start with http:// or https://.') })
  .strict();
const adsLinks = z.array(adsLinkSchema).max(5, 'Add up to 5 attachment links.');
const adsOptionalId = z.preprocess(v => (v === '' || v === null ? undefined : v), uuidSchema.optional());
const adsPriority = z.enum(ADS_PRIORITIES);
const adsRequiredText = (max: number, what: string) => z.string().trim().min(1, `Enter the ${what}.`).max(max);

const adsClientFields = {
  clientName: adsRequiredText(150, 'client name'),
  companyName: optionalText(150),
  contactPerson: optionalText(150),
  contactNumber: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), phoneSchema.nullable().optional()),
  email: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), emailSchema.nullable().optional()),
  businessAddress: optionalText(500),
  requirements: optionalText(4000),
  designService: optionalText(200),
  workDescription: optionalText(4000),
  remarks: optionalText(2000),
  attachments: adsLinks.optional()
};
export const adsClientCreateSchema = z.object(adsClientFields).strict();
export type AdsClientCreateInput = z.infer<typeof adsClientCreateSchema>;
export const adsClientUpdateSchema = z.object({ ...adsClientFields, status: z.enum(['ACTIVE', 'INACTIVE']) }).partial().strict();
export type AdsClientUpdateInput = z.infer<typeof adsClientUpdateSchema>;
export const adsClientListQuerySchema = z.object({ search: trimmed(100).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();

export const adsNoticeCreateSchema = z
  .object({
    clientId: uuidSchema,
    title: adsRequiredText(200, 'notice title'),
    category: z.enum(ADS_NOTICE_CATEGORIES),
    description: adsRequiredText(4000, 'notice description'),
    priority: adsPriority.default('MEDIUM'),
    assignedTo: adsOptionalId
  })
  .strict();
export type AdsNoticeCreateInput = z.infer<typeof adsNoticeCreateSchema>;
export const adsNoticeStatusSchema = z.object({ status: z.enum(ADS_NOTICE_STATUSES) }).strict();
export const adsNoticeListQuerySchema = z.object({ clientId: adsOptionalId, status: z.enum(ADS_NOTICE_STATUSES).optional() }).strict();

export const adsAssignmentCreateSchema = z
  .object({
    clientId: adsOptionalId,
    parentId: adsOptionalId,
    assigneeId: uuidSchema,
    title: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), trimmed(200).optional()),
    description: optionalText(4000),
    instructions: optionalText(2000),
    priority: adsPriority.optional(),
    dueDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    attachments: adsLinks.optional()
  })
  .strict();
export type AdsAssignmentCreateInput = z.infer<typeof adsAssignmentCreateSchema>;
export const adsAssignmentListQuerySchema = z
  .object({ view: z.enum(['mine', 'team', 'all']).default('all'), status: z.enum(ADS_ASSIGNMENT_STATUSES).optional(), clientId: adsOptionalId })
  .strict();
export const adsAssignmentStatusSchema = z
  .object({ status: z.enum(ADS_ASSIGNMENT_STATUSES), progress: z.coerce.number().int().min(0).max(100).optional(), note: optionalText(2000) })
  .strict();
export const adsAssignmentUpdateSchema = z
  .object({ dueDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable()).optional(), priority: adsPriority.optional(), instructions: optionalText(2000) })
  .strict();
export const adsAssignmentReassignSchema = z.object({ assigneeId: uuidSchema, note: optionalText(500) }).strict();

export const adsReportSchema = z
  .object({
    id: adsOptionalId,
    reportDate: z.preprocess(v => (v === '' ? undefined : v), isoDate.optional()),
    clientId: adsOptionalId,
    assignmentId: adsOptionalId,
    // (20270308000100) Work Completed / Work Pending / Additional Note (remarks): optional, at least one, with word limits
    workCompleted: optionalText(4000),
    workInProgress: optionalText(4000),
    pendingWork: optionalText(4000),
    challenges: optionalText(4000),
    remarks: optionalText(2000),
    attachments: adsLinks.optional(),
    clientRequestId: trimmed(80).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    // (20270312000100) Work Completed is required (10 to 150 words); the minimum replaces the "at least one field" rule
    addReportWordIssues(ctx, { workCompleted: v.workCompleted ?? undefined, pendingWork: v.pendingWork ?? undefined, remarks: v.remarks ?? undefined });
  });
export type AdsReportInput = z.infer<typeof adsReportSchema>;
export const adsReportListQuerySchema = z
  .object({
    view: z.enum(['mine', 'team', 'all']).default('mine'),
    status: z.enum(ADS_REPORT_STATUSES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    clientId: adsOptionalId,
    authorId: adsOptionalId,
    leadId: adsOptionalId
  })
  .strict();
export const adsReportReviewSchema = z.object({ decision: z.enum(['APPROVE', 'RETURN']), remarks: optionalText(2000) }).strict();

export const adsIssueCreateSchema = z
  .object({
    title: adsRequiredText(200, 'issue title'),
    category: z.enum(ADS_ISSUE_CATEGORIES),
    description: adsRequiredText(4000, 'description'),
    clientId: adsOptionalId,
    assignmentId: adsOptionalId,
    priority: adsPriority.default('MEDIUM'),
    attachments: adsLinks.optional(),
    clientRequestId: trimmed(80).optional()
  })
  .strict();
export type AdsIssueCreateInput = z.infer<typeof adsIssueCreateSchema>;
export const adsIssueListQuerySchema = z.object({ view: z.enum(['mine', 'team', 'all']).default('mine'), status: z.enum(ADS_ISSUE_STATUSES).optional() }).strict();
export const adsIssueUpdateSchema = z
  .object({ status: z.enum(ADS_ISSUE_STATUSES).optional(), note: optionalText(2000) })
  .strict()
  .refine(v => v.status !== undefined || (v.note !== undefined && v.note !== null), { message: 'Write a response or choose a status.' });
export const adsIssueEscalateSchema = z.object({ note: optionalText(2000) }).strict();


// ---- AI Studio (migration 20270105000100) -------------------------------------------------------------------------------------------------
export const aiStudioProjectSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the project name (at least 2 characters).').max(120, 'The project name can have at most 120 characters.'),
    description: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(2000, 'The description can have at most 2000 characters.').nullable().optional()),
    status: z.enum(AI_STUDIO_PROJECT_STATUSES).optional(),
    /** Left out = the deadline stays as it is; null (or an empty string) = no deadline; a time with its offset (+05:30) = due then. Only the Super Admin / Department Head. */
    deadlineAt: z.preprocess(v => (v === '' ? null : v), z.string().datetime({ offset: true, message: 'Enter the deadline as a date and time.' }).nullable().optional())
  })
  .strict();
export type AiStudioProjectInput = z.infer<typeof aiStudioProjectSchema>;

/** One or many Team Members to one Team Lead (the Super Admin / Department Head). */
export const aiStudioAssignLeadSchema = z.object({ memberIds: z.array(uuidSchema).min(1, 'Select at least one Team Member.').max(200, 'Select at most 200 Team Members at a time.'), leadId: uuidSchema }).strict();
export const aiStudioSetLeadSchema = z.object({ leadId: uuidSchema }).strict();
export const aiStudioProjectAssignSchema = z.object({ profileId: uuidSchema, assign: z.boolean().default(true) }).strict();

const aiStudioLinks = z.array(z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, 'An attachment must be a link that starts with http:// or https://.')).max(5, 'Add at most 5 links.');

export const aiStudioTaskCreateSchema = z
  .object({
    projectId: uuidSchema,
    assigneeId: uuidSchema,
    title: z.string().trim().min(1, 'Enter the task title.').max(200, 'The title can have at most 200 characters.'),
    description: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'The description can have at most 4000 characters.').nullable().optional()),
    priority: z.enum(AI_STUDIO_PRIORITIES).default('MEDIUM'),
    dueDate: z.preprocess(v => (v === '' ? null : v), isoDate.nullable().optional()),
    attachments: aiStudioLinks.optional()
  })
  .strict();
export type AiStudioTaskCreateInput = z.infer<typeof aiStudioTaskCreateSchema>;

export const aiStudioTaskEditSchema = aiStudioTaskCreateSchema.omit({ projectId: true, assigneeId: true, attachments: true });

/** The assignee's progress: complete needs details (the note); the percentage matters until then. */
export const aiStudioTaskUpdateSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'ON_HOLD', 'COMPLETED']),
    progress: z.coerce.number().int().min(0, 'Progress is between 0 and 100.').max(100, 'Progress is between 0 and 100.').default(0),
    note: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(2000, 'The note can have at most 2000 characters.').nullable().optional()),
    attachments: aiStudioLinks.optional()
  })
  .strict()
  .refine(v => v.status === 'COMPLETED' || v.progress <= 99, { message: 'Progress below 100: complete the task to reach 100.', path: ['progress'] })
  .refine(v => v.status !== 'COMPLETED' || (v.note ?? '').length >= 3, { message: 'Describe what was completed before you complete the task.', path: ['note'] })
  .refine(v => v.status !== 'ON_HOLD' || (v.note ?? '').length >= 1, { message: 'Say why the task is on hold.', path: ['note'] });

export const aiStudioTasksQuerySchema = z
  .object({
    scope: z.enum(['mine', 'ongoing', 'team']).default('mine'),
    projectId: uuidSchema.optional(),
    status: z.enum([...AI_STUDIO_TASK_STATUSES, 'OPEN', 'OVERDUE']).optional(),
    // 20270221000100: my team's tasks or cross-team ones
    kind: z.enum(['STANDARD', 'CROSS_TEAM']).optional(),
    assigneeId: uuidSchema.optional(),
    page: z.coerce.number().int().min(1).max(5000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict();

export const aiStudioReportSchema = z
  .object({
    projectId: uuidSchema,
    taskId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional()),
    reportDate: isoDate,
    workCompleted: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional()),
    workInProgress: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional()),
    pendingWork: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional()),
    blockers: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional()),
    remarks: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional()),
    /** true: send it for approval now; false: keep it as a draft. */
    submit: z.boolean().default(false)
  })
  .strict()
  .refine(v => !v.submit || (v.workCompleted ?? '').length > 0, { message: 'Describe the work completed today before you submit.', path: ['workCompleted'] })
  // (20270308000100) the same word limits as every daily report (this older one-task form is only used to correct reports made with it)
  .superRefine((v, ctx) => { if (v.submit) addReportWordIssues(ctx, { workCompleted: v.workCompleted ?? undefined, pendingWork: v.pendingWork ?? undefined, remarks: v.remarks ?? undefined }); });
export type AiStudioReportInput = z.infer<typeof aiStudioReportSchema>;

export const aiStudioReportReviewSchema = z
  .object({
    // REJECT (20270302000100): the Team Lead's final "no", with a reason
    decision: z.enum(['APPROVE', 'RETURN', 'REJECT']),
    comment: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(2000, 'The remarks can have at most 2000 characters.').nullable().optional())
  })
  .strict()
  .refine(v => v.decision !== 'RETURN' || (v.comment ?? '').length >= 3, { message: 'Write the remarks the employee should act on.', path: ['comment'] });
// ---- AI Studio Performance Management (20270214000100): the Team Lead corrects a report waiting for their approval ----
const aiReportPart = z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional());
export const aiStudioReportLeadEditSchema = z
  .object({
    /** Empty is allowed for a consolidated report whose tasks carry the work (20270219000100); the database refuses it otherwise. */
    workCompleted: aiReportPart,
    workInProgress: aiReportPart, pendingWork: aiReportPart, blockers: aiReportPart, remarks: aiReportPart,
    reason: z.string().trim().min(5, 'Say why you changed the report (at least 5 characters); the team member reads it.').max(1000, 'The reason can have at most 1000 characters.')
  })
  .strict();

export const aiStudioReportsQuerySchema = z
  .object({
    view: z.enum(['mine', 'team', 'department']).default('mine'),
    projectId: uuidSchema.optional(),
    status: z.enum(AI_STUDIO_REPORT_STATUSES).optional(),
    leadId: uuidSchema.optional(),
    authorId: uuidSchema.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).max(5000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    /** 20270219000100: reports with blockers / with a task given by another Team Lead ('true' / 'false'). */
    blockers: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    crossTeam: z.enum(['true', 'false']).transform(v => v === 'true').optional()
  })
  .strict();

// ---- AI Studio consolidated daily report (20270219000100): built from the work recorded on the tasks ----
const aiTaskIds = z.array(uuidSchema).max(30, 'A daily report can have at most 30 tasks.').default([]);
const aiDailyPart = z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Each part of the report can have at most 4000 characters.').nullable().optional());
export const aiStudioDailyReportOptionsQuerySchema = z.object({ date: isoDate }).strict();
export const aiStudioDailyReportPreviewSchema = z.object({ reportDate: isoDate, taskIds: aiTaskIds }).strict();
export const aiStudioDailyReportSchema = z
  .object({
    reportDate: isoDate,
    taskIds: aiTaskIds,
    /** Only what is NOT already in the tasks: additional work, pending work, blockers, tomorrow's plan, remarks. */
    workCompleted: aiDailyPart, pendingWork: aiDailyPart, blockers: aiDailyPart, tomorrowPlan: aiDailyPart, remarks: aiDailyPart,
    /** 20270302000100: the Daily Work Description, 10-150 words to submit (a draft may hold less). */
    workDescription: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(2000, 'The daily work description can have at most 150 words.').nullable().optional()),
    submit: z.boolean().default(false),
    /** The history entries the person saw in the preview when they submitted: if the tasks changed since, the database refuses and the form refreshes. */
    expectedUpdateIds: z.array(uuidSchema).max(1000).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.submit) return;
    // (20270308000100) the three fields' word limits; the Daily Work Description is no longer asked for
    addReportWordIssues(ctx, { workCompleted: v.workCompleted, pendingWork: v.pendingWork, remarks: v.remarks });
  });
export type AiStudioDailyReportInput = z.infer<typeof aiStudioDailyReportSchema>;

// ---- Daily report fields, every department (20270308000100): Work Completed / Work Pending / Additional Note, each with a word limit ----
// (20270312000100) Work Completed is required, with at least 10 words; Work Pending and the Additional Note stay optional.
export const DAILY_REPORT_FIELDS = [
  { key: 'workCompleted', label: 'Work Completed', minWords: 10, maxWords: 150 },
  { key: 'pendingWork', label: 'Work Pending', minWords: 0, maxWords: 100 },
  { key: 'remarks', label: 'Additional Note', minWords: 0, maxWords: 50 }
] as const;
export type DailyReportFieldKey = (typeof DAILY_REPORT_FIELDS)[number]['key'];
/** The message for a field over its word limit, or null (the database's private.report_word_max says the same). */
export function dailyReportWordProblem(key: DailyReportFieldKey, text: string | null | undefined): string | null {
  const f = DAILY_REPORT_FIELDS.find(x => x.key === key)!;
  const n = countWords(text);
  return n > f.maxWords ? `${f.label} can have at most ${f.maxWords} words (now ${n}).` : null;
}
/** (20270312000100) The message for a field below its minimum on submission, or null (the database's private.report_word_limits says the same). */
export function dailyReportMinProblem(key: DailyReportFieldKey, text: string | null | undefined): string | null {
  const f = DAILY_REPORT_FIELDS.find(x => x.key === key)!;
  const n = countWords(text);
  return n < f.minWords ? `Write at least ${f.minWords} words in ${f.label} (now ${n}).` : null;
}
/** Every problem of a submitted daily report, by field: the minimum (Work Completed) and the maximums. */
export function dailyReportProblems(v: Partial<Record<DailyReportFieldKey, string | null | undefined>>): Partial<Record<DailyReportFieldKey, string>> {
  const out: Partial<Record<DailyReportFieldKey, string>> = {};
  for (const f of DAILY_REPORT_FIELDS) {
    const problem = dailyReportWordProblem(f.key, v[f.key]) ?? dailyReportMinProblem(f.key, v[f.key]);
    if (problem) out[f.key] = problem;
  }
  return out;
}
function addReportWordIssues(ctx: z.RefinementCtx, v: Partial<Record<DailyReportFieldKey, string | null | undefined>>, path: (string | number)[] = []) {
  for (const [key, message] of Object.entries(dailyReportProblems(v))) ctx.addIssue({ code: 'custom', message, path: [...path, key] });
}
/** The maximums only (a draft may still be short). */
function addReportWordMaxIssues(ctx: z.RefinementCtx, v: Partial<Record<DailyReportFieldKey, string | null | undefined>>, path: (string | number)[] = []) {
  for (const f of DAILY_REPORT_FIELDS) {
    const problem = dailyReportWordProblem(f.key, v[f.key]);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: [...path, f.key] });
  }
}

// ---- AI Studio Daily Work Description and HR's AI Studio Performance (20270302000100) ----
export const DAILY_DESCRIPTION_MIN_WORDS = 10;
export const DAILY_DESCRIPTION_MAX_WORDS = 150;
/** Words, not characters: whitespace-separated pieces with at least one letter or digit (the database's private.word_count is the same rule). */
export function countWords(text: string | null | undefined): number {
  return (text ?? '').trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}
export function dailyDescriptionProblem(text: string | null | undefined): string | null {
  const n = countWords(text);
  if (n < DAILY_DESCRIPTION_MIN_WORDS) return `Write at least ${DAILY_DESCRIPTION_MIN_WORDS} words in the daily work description (now ${n}).`;
  if (n > DAILY_DESCRIPTION_MAX_WORDS) return `The daily work description can have at most ${DAILY_DESCRIPTION_MAX_WORDS} words (now ${n}).`;
  return null;
}
export const aiStudioHrPerformanceQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, { message: 'The start date is after the end date.', path: ['from'] });
export const aiStudioHrViewerSchema = z.object({ profileId: uuidSchema, allowed: z.boolean() }).strict();

// ---- AI Studio weekly report: Team Lead -> the Super Admin, AI Studio's Department Head (migration 20270308000100) ----------------------------------------
const aiStudioMonday = isoDate.refine(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, { message: 'Choose a week that starts on a Monday.' });
const weeklyPart = z.preprocess(v => (v === '' ? null : v), z.string().trim().max(4000, 'Keep each part under 4000 characters.').nullable().optional());
export const aiStudioWeeklyQuerySchema = z.object({ weekStart: aiStudioMonday }).strict();
export const aiStudioWeeklyListQuerySchema = z.object({ weekStart: aiStudioMonday.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'ACKNOWLEDGED']).optional() }).strict();
export const aiStudioWeeklySaveSchema = z
  .object({
    weekStart: aiStudioMonday,
    completedWork: weeklyPart,
    pendingWork: weeklyPart,
    achievements: weeklyPart,
    challenges: weeklyPart,
    remarks: weeklyPart,
    submit: z.boolean().default(false)
  })
  .strict()
  .refine(v => !v.submit || (v.completedWork ?? '').trim().length >= 10, {
    message: 'Describe the work your team completed this week (at least 10 characters) before submitting.', path: ['completedWork']
  });
export const aiStudioWeeklyReviewSchema = z
  .object({
    decision: z.enum(['ACKNOWLEDGE', 'RETURN']),
    comment: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(2000, 'Keep the comment under 2000 characters.').nullable().optional())
  })
  .strict()
  .refine(v => v.decision !== 'RETURN' || (v.comment ?? '').length >= 3, { message: 'Write what the Team Lead should change.', path: ['comment'] });

// ---- Crocodial integration (migration 20270115000100) -----------------------------------------------------------------------------
/** The NAME of the server setting that holds a connection's Crocodial token (never the token itself). */
export const crocodialCredentialRefSchema = z
  .string()
  .trim()
  .transform(v => v.toUpperCase())
  .pipe(z.string().regex(/^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$/, 'Enter the NAME of the server setting that holds the token, like CROCODIAL_TOKEN_MPILLAR (never the token itself).'));
export const crocodialConnectionSaveSchema = z
  .object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(2, 'Give the connection a name.').max(120),
    externalAccountLabel: z.string().trim().max(200).optional().nullable(),
    // optional (Task 8): a CEO's connection has no server setting (its key is stored by the CRM); only the MD may name one (the database checks)
    credentialRef: crocodialCredentialRefSchema.optional().nullable(),
    enabled: z.boolean().optional(),
    // a CEO creating a connection: the departments they run that it serves (at least one; the database checks each)
    departmentIds: z.array(uuidSchema).min(1, 'Choose at least one department you run.').max(20).optional()
  })
  .strict();
// A Crocodial key pasted by its manager (Task 8): only its size here; the server normalises it and checks its shape and a live read
export const crocodialKeySchema = z.object({ key: z.string({ required_error: 'Paste the Crocodial key.' }).max(5000, 'That is too long to be a Crocodial key.') }).strict();
export const crocodialRolloutSchema = z
  .object({ departmentId: uuidSchema, division: z.literal('SALES'), allowed: z.boolean(), note: z.string().trim().max(300).optional().nullable() })
  .strict();
export const crocodialDepartmentLinkSchema = z
  .object({
    connectionId: uuidSchema,
    departmentId: uuidSchema,
    division: z.literal('SALES'),
    enabled: z.boolean(),
    stage: z.enum(['PILOT', 'PRODUCTION']).default('PILOT')
  })
  .strict();
// (20270307000100) GET /crocodial/connections/:id/mapping-candidates
export const crocodialMappingCandidatesQuerySchema = z.object({ departmentId: uuidSchema }).strict();
export const crocodialMappingSchema = z
  .object({
    connectionId: uuidSchema,
    externalEmployeeId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    profileId: uuidSchema,
    departmentId: uuidSchema
  })
  .strict();
export const crocodialRevokeSchema = z.object({ reason: z.string().trim().max(300).optional().nullable() }).strict();
/** The date an approved mapping counts activity from: a day (YYYY-MM-DD), or null for "from the first stored activity". */
export const crocodialCountFromSchema = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19.').nullable().optional() })
  .strict();
export const crocodialActivityQuerySchema = z
  .object({
    profileId: uuidSchema.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19.').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19.').optional()
  })
  .strict();
/** A person's Crocodial leads: search, filter and a page (the database decides whose leads the caller may see). */
export const crocodialRefreshSchema = z
  .object({ scope: z.enum(['SELF', 'TEAM', 'DEPARTMENT', 'ALL']), departmentId: uuidSchema.optional() })
  .strict();
// ---- Crocodial -> CRM lead pipeline (20270304000100)
export const CROCODIAL_DISPOSITIONS = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'DEMO_SCHEDULED', 'NOT_INTERESTED', 'LOST', 'CONVERTED', 'IGNORE'] as const;
export const crocodialLeadImportSchema = z.object({ departmentId: uuidSchema, mode: z.enum(['OFF', 'PREVIEW', 'IMPORT']) }).strict();
/**
 * A Crocodial status mapped to a lead tag (tagId), to Ignore (ignore), or removed (neither) (20270306000100). The old body
 * ({ status, disposition }) is still accepted; the database translates it to the seed tag of the disposition's stage.
 */
export const crocodialStatusMappingSchema = z
  .object({
    status: z.string().trim().min(1, 'Enter the Crocodial status.').max(80),
    tagId: uuidSchema.nullable().optional(),
    ignore: z.boolean().optional(),
    disposition: z.enum(CROCODIAL_DISPOSITIONS).nullable().optional()
  })
  .strict()
  .refine(b => b.disposition === undefined || (b.tagId === undefined && b.ignore === undefined), { message: 'Send a tag or a disposition, not both.', path: ['disposition'] })
  .refine(b => !(b.ignore && b.tagId), { message: 'Choose a tag or Ignore, not both.', path: ['ignore'] });
export const crocodialLinksQuerySchema = z
  .object({
    status: z.enum(['LINKED', 'PENDING_CREATE', 'PENDING_LINK', 'UNMAPPED_ASSIGNEE', 'OUT_OF_SCOPE', 'NOT_ENABLED', 'AMBIGUOUS', 'OWNER_CONFLICT', 'PROTECTED', 'IGNORED', 'FAILED']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();
export const crocodialTeamLeadsQuerySchema = z.object({ departmentId: uuidSchema.optional(), teamId: uuidSchema.optional() }).strict();
export const crocodialLinkResolveSchema = z
  .object({ action: z.enum(['LINK', 'IGNORE', 'RETRY', 'RELEASE_OVERRIDE']), customerId: uuidSchema.optional() })
  .strict()
  .refine(v => v.action !== 'LINK' || !!v.customerId, { message: 'Choose the CRM record to link.', path: ['customerId'] });
export const crocodialLeadsQuerySchema = z
  .object({
    profileId: uuidSchema.optional(),
    search: z.string().trim().max(100).optional(),
    filter: z.enum(['ALL', 'NEVER_CALLED', 'FOLLOW_UP_DUE']).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict();
export const crocodialTeamActivityQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19.').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19.').optional(),
    departmentId: uuidSchema.optional(),
    teamId: uuidSchema.optional()
  })
  .strict();

// ---------------------------------------------------------------------------
// Sales Department Head: role-wise sections (migration 20270117000300)
// ---------------------------------------------------------------------------
export const SALES_ROLES = ['TELECALLER', 'BUSINESS_ASSOCIATE'] as const;
export const SALES_ROLE_SORTS = [
  'name', 'teamLead', 'status',
  // Crocodial
  'calls', 'connected', 'notConnected', 'uniqueNumbers', 'talkSeconds',
  // CRM
  'leadsCreated', 'convertedLeads', 'leadsAssigned', 'demosScheduled', 'demosCompleted', 'quotations', 'dealsClosed', 'dealValue'
] as const;
export const salesRoleSchema = z.enum(SALES_ROLES, { message: 'Choose Telecaller or Business Associate.' });
const salesRolePeriod = {
  from: isoDate.optional(),
  to: isoDate.optional()
};
export const salesRoleListQuerySchema = z
  .object({
    ...salesRolePeriod,
    search: trimmed(120).optional(),
    teamLeadId: uuidSchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']).optional(),
    sort: z.enum(SALES_ROLE_SORTS).default('name'),
    page: z.coerce.number().int().min(1).default(1),
    // the export asks for up to 500 rows at once
    pageSize: z.coerce.number().int().min(1).max(500).default(25)
  })
  .strict()
  .refine(q => !q.from || !q.to || q.from <= q.to, { message: 'The start date is after the end date.', path: ['from'] });
export const salesRolePersonQuerySchema = z.object(salesRolePeriod).strict()
  .refine(q => !q.from || !q.to || q.from <= q.to, { message: 'The start date is after the end date.', path: ['from'] });

// ---------------------------------------------------------------------------
// Client meetings (migration 20270122000200)
// ---------------------------------------------------------------------------
export const clientMeetingSchema = z.object({
  clientName: trimmed(200).min(1, 'Enter the client\'s name.'),
  clientEmail: z.string().trim().toLowerCase().max(320).email('Enter a valid client e-mail address.'),
  companyName: trimmed(200).min(1, 'Enter the company name.'),
  title: trimmed(200).min(2, 'Give the meeting a title.'),
  agenda: trimmed(4000).min(5, 'Describe the agenda (at least 5 characters).'),
  startsAt: isoInstant,
  endsAt: isoInstant,
  timezone: optionalText(64),
  mode: z.enum(['ONLINE', 'OFFLINE'], { message: 'Choose Online or Offline.' }),
  meetLink: z.preprocess(v => (v === '' ? null : v), z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use an https:// link.').nullable().optional()),
  location: optionalText(500),
  hostId: uuidSchema.optional().nullable(),
  clientRequestId: z.string().trim().min(8).max(80)
}).strict()
  .refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'The meeting must end after it starts.', path: ['endsAt'] })
  .refine(v => v.mode !== 'ONLINE' || !!v.meetLink, { message: 'Give the meeting link for an online meeting.', path: ['meetLink'] })
  .refine(v => v.mode !== 'OFFLINE' || (v.location ?? '').trim().length >= 3, { message: 'Give the meeting place for an offline meeting.', path: ['location'] });
export const meetingMailIdSchema = z.coerce.number().int().positive();
export const clientMeetingListQuerySchema = z.object({
  scope: z.enum(['UPCOMING', 'PAST', 'ALL']).default('UPCOMING'),
  status: z.enum(['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED']).optional()
}).strict();

// ---------------------------------------------------------------------------
// Bugs for the Developers team (migration 20270122000300)
// ---------------------------------------------------------------------------
export const DEV_BUG_STATUSES = ['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED'] as const;
// Issue routing (migration 20270128000200): what an issue to the Developer Team is about, and how urgent
export const DEV_ISSUE_CATEGORIES = ['BUG', 'FEATURE_REQUEST', 'ACCESS_LOGIN', 'DATA_ISSUE', 'PERFORMANCE', 'OTHER'] as const;
export const DEV_ISSUE_CATEGORY_LABELS: Record<(typeof DEV_ISSUE_CATEGORIES)[number], string> = {
  BUG: 'Bug / error', FEATURE_REQUEST: 'Feature request', ACCESS_LOGIN: 'Access / login', DATA_ISSUE: 'Wrong or missing data', PERFORMANCE: 'Slow / performance', OTHER: 'Other'
};
export const DEV_ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const bugSubmitSchema = z.object({
  title: trimmed(200).min(3, 'Give the issue a title (at least 3 characters).'),
  description: trimmed(5000).min(10, 'Describe the issue (at least 10 characters).'),
  steps: optionalText(5000),
  attachmentIds: z.array(uuidSchema).max(5, 'Attach at most 5 files.').default([]),
  clientRequestId: z.string().trim().min(8).max(80),
  category: z.enum(DEV_ISSUE_CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }).default('BUG'),
  priority: z.enum(DEV_ISSUE_PRIORITIES, { errorMap: () => ({ message: 'Choose a priority.' }) }).default('MEDIUM'),
  /** optional context (HR's reports): which department / employee the problem affects */
  affectedDepartmentId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional()),
  affectedEmployeeId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional())
}).strict();
export const bugListQuerySchema = z.object({
  status: z.enum([...DEV_BUG_STATUSES, 'OPEN', 'DONE']).optional(),
  assignee: z.union([z.enum(['ME', 'UNASSIGNED', 'CONTRIBUTED']), uuidSchema]).optional(),
  search: trimmed(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
/** GET /bugs/mine: the reporter's own issues to the Developer Team (OPEN: still being worked on, DONE: resolved, rejected or closed) */
export const bugMyListQuerySchema = z.object({ status: z.enum([...DEV_BUG_STATUSES, 'OPEN', 'DONE']).optional(), search: trimmed(120).optional() }).strict();
/** the reporter answers the developers */
export const bugFollowUpSchema = z.object({
  message: trimmed(3000).min(2, 'Write your message.'),
  attachmentIds: z.array(uuidSchema).max(5, 'Attach at most 5 files.').default([])
}).strict();
/** a developer replies to the reporter; requestInfo: the issue waits for the reporter (Pending information) */
export const bugReplySchema = z.object({ message: trimmed(3000).min(2, 'Write the reply.'), requestInfo: z.boolean().default(false) }).strict();
/** HR escalates an employee issue to the Developer Team (once; the priority defaults to the issue's) */
export const issueEscalateSchema = z.object({
  note: optionalText(2000),
  category: z.enum(DEV_ISSUE_CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }).optional(),
  priority: z.enum(DEV_ISSUE_PRIORITIES, { errorMap: () => ({ message: 'Choose a priority.' }) }).optional()
}).strict();
export const bugAssignSchema = z.object({ developerId: uuidSchema.nullable() }).strict();
export const bugStatusSchema = z.object({ status: z.enum(DEV_BUG_STATUSES), note: optionalText(3000) }).strict()
  .refine(v => !['RESOLVED', 'REJECTED'].includes(v.status) || (v.note ?? '').trim().length >= 5,
    { message: 'Write the resolution note or the reason (at least 5 characters). The employee will read it.', path: ['note'] });
export const bugCommentSchema = z.object({ note: trimmed(3000).min(1, 'Write a comment.') }).strict();
/** "Add Progress Update" (20270312000400): what was worked on, optionally the new status / progress and notes. expectedVersion: the version the screen was loaded with */
export const bugProgressUpdateSchema = z.object({
  work: trimmed(3000).min(3, 'Write what you worked on (at least 3 characters).'),
  status: z.enum(DEV_BUG_STATUSES).optional(),
  progress: z.coerce.number().int().min(0, 'The progress is a percentage from 0 to 100.').max(100, 'The progress is a percentage from 0 to 100.').optional(),
  notes: optionalText(3000),
  expectedVersion: z.coerce.number().int().min(1).optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional()
}).strict()
  .refine(v => v.status !== 'RESOLVED' || v.progress === undefined || v.progress === 100, { message: 'A resolved bug is 100% done.', path: ['progress'] })
  .refine(v => !['RESOLVED', 'REJECTED'].includes(v.status ?? '') || ((v.notes ?? v.work).trim().length >= 5),
    { message: 'Write the resolution note or the reason (at least 5 characters). The employee will read it.', path: ['notes'] });
export const devTeamSetSchema = z.object({ profileId: uuidSchema, member: z.boolean(), lead: z.boolean().optional() }).strict();

// ---------------------------------------------------------------------------
// Post-meeting summaries and the CEO's Meeting Decisions (migration 20270124000200). The database checks every rule again.
// ---------------------------------------------------------------------------
const meetingSummaryItemKey = z.string().uuid('Every entry needs its key.');
export const meetingSummaryDecisionSchema = z.object({
  key: meetingSummaryItemKey,
  title: z.string().trim().min(2, 'Give the decision a title.').max(200),
  description: optionalText(2000),
  departmentId: uuidSchema.nullable().optional(),
  teamId: uuidSchema.nullable().optional(),
  decidedBy: uuidSchema.nullable().optional(),
  status: z.enum(['PROPOSED', 'APPROVED', 'IN_PROGRESS', 'IMPLEMENTED', 'ON_HOLD']).default('APPROVED')
}).strict();
export const meetingSummaryActionSchema = z.object({
  key: meetingSummaryItemKey,
  title: z.string().trim().min(2, 'Give the action item a title.').max(200),
  description: optionalText(2000),
  assigneeId: uuidSchema,
  dueDate: isoDate.nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED']).default('PENDING'),
  decisionKey: uuidSchema.nullable().optional()
}).strict();
export const meetingSummaryBlockerSchema = z.object({
  key: meetingSummaryItemKey,
  category: z.enum(['PENDING_APPROVAL', 'RESOURCE', 'OPERATIONAL', 'CUSTOMER_ESCALATION', 'DEPENDENCY', 'CEO_DECISION', 'OTHER']).default('OTHER'),
  description: z.string().trim().min(2, 'Describe the blocker.').max(2000),
  needsCeoAttention: z.boolean().default(false)
}).strict();
export const meetingSummaryContentSchema = z.object({
  purposeNote: optionalText(1000),
  executiveSummary: optionalText(8000),
  discussionPoints: z.array(z.string().trim().max(500, 'Keep each discussion point under 500 characters.')).max(50).default([]),
  noDecisions: z.boolean().default(false),
  decisions: z.array(meetingSummaryDecisionSchema).max(50).default([]),
  actions: z.array(meetingSummaryActionSchema).max(100).default([]),
  noBlockers: z.boolean().default(false),
  blockers: z.array(meetingSummaryBlockerSchema).max(50).default([]),
  nextSteps: optionalText(4000),
  followUp: z.object({ required: z.boolean().default(false), date: isoDate.nullable().optional(), outcome: optionalText(1000) }).strict().optional()
}).strict()
  .refine(v => !(v.noDecisions && v.decisions.length), { message: 'Remove the decisions or untick "No decisions were made".', path: ['decisions'] })
  .refine(v => !(v.noBlockers && v.blockers.length), { message: 'Remove the blockers or untick "No blockers".', path: ['blockers'] });
export const meetingSummaryDraftSchema = z.object({ summary: meetingSummaryContentSchema, version: z.number().int().min(1) }).strict();
/** Submitting also needs the executive summary, the decisions (or "no decisions") and the blockers (or "no blockers"). */
export const meetingSummarySubmitSchema = z.object({
  summary: meetingSummaryContentSchema,
  version: z.number().int().min(1),
  changeNote: optionalText(1000)
}).strict().superRefine((v, ctx) => {
  const s = v.summary;
  if (!s.executiveSummary || s.executiveSummary.length < 20) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary', 'executiveSummary'], message: 'Write the executive summary: what happened in the meeting (at least 20 characters).' });
  }
  if (!s.decisions.length && !s.noDecisions) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary', 'decisions'], message: 'Record the decisions taken, or tick "No decisions were made".' });
  }
  if (!s.blockers.length && !s.noBlockers) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary', 'blockers'], message: 'Record the issues or blockers, or tick "No blockers".' });
  }
  if (s.followUp?.required && !s.followUp.date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary', 'followUp', 'date'], message: 'Give the target date of the follow-up.' });
  }
});
export const meetingAttendanceSchema = z.object({
  attendedIds: z.array(uuidSchema).min(1, 'Mark at least one colleague who attended.').max(200),
  version: z.number().int().min(1).optional()
}).strict();
export const meetingSummaryOwnerSchema = z.object({ ownerId: uuidSchema, reason: optionalText(500), version: z.number().int().min(1).optional() }).strict();
export const meetingSummaryClarifySchema = z.object({ message: z.string().trim().min(5, 'Write the question.').max(2000) }).strict();
export const meetingSummaryReplySchema = z.object({ message: z.string().trim().min(2, 'Write the answer.').max(2000) }).strict();
export const meetingSummaryFlagSchema = z.object({
  itemType: z.enum(['DECISION', 'BLOCKER']),
  itemId: uuidSchema,
  flag: z.boolean(),
  note: optionalText(1000)
}).strict();
export const meetingActionUpdateSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED']),
  note: optionalText(1000)
}).strict();
export const meetingSummaryListQuerySchema = z.object({
  scope: z.enum(['MINE', 'TEAM']).default('MINE'),
  tab: z.enum(['PENDING', 'DRAFT', 'SUBMITTED', 'OVERDUE', 'ALL']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();
const meetingReportFilters = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  departmentId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  leaderId: uuidSchema.optional(),
  leaderRank: z.coerce.number().int().min(1).max(4).optional()
};
export const meetingReportsOverviewQuerySchema = z.object(meetingReportFilters).strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, { message: 'Choose a period that ends on or after its start.', path: ['to'] });
export const meetingReportsQuerySchema = z.object({
  ...meetingReportFilters,
  status: z.enum(['SUBMITTED', 'PENDING', 'OVERDUE', 'REVISION_REQUESTED', 'DRAFT']).optional(),
  attention: booleanParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, { message: 'Choose a period that ends on or after its start.', path: ['to'] });
export const meetingReportActionsQuerySchema = z.object({
  ...meetingReportFilters,
  status: z.enum(['OPEN', 'OVERDUE', 'DONE', 'ALL']).default('OPEN'),
  assigneeId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, { message: 'Choose a period that ends on or after its start.', path: ['to'] });
export type MeetingSummaryContentInput = z.infer<typeof meetingSummaryContentSchema>;

// ---------------------------------------------------------------------------
// Notification Health (migration 20270126000200): Super Admin and HR staff; the database checks the caller again.
// ---------------------------------------------------------------------------
export const NOTIFICATION_HEALTH_STATUSES = ['READY', 'SETUP_REQUIRED', 'NOTIFICATIONS_BLOCKED', 'DEVICE_NOT_REGISTERED', 'PUSH_UNAVAILABLE',
  'DELIVERY_FAILED', 'RETRY_PENDING', 'REMINDERS_DISABLED', 'COMPANY_PAUSED'] as const;
export const NOTIFICATION_HEALTH_ISSUES = [...NOTIFICATION_HEALTH_STATUSES, 'REMINDER_MISSING', 'SOUND_UNKNOWN'] as const;
export const notificationHealthQuerySchema = z.object({
  departmentId: uuidSchema.optional(),
  role: z.enum(['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER']).optional(),
  issue: z.enum(NOTIFICATION_HEALTH_ISSUES).optional()
}).strip();
export type NotificationHealthQuery = z.infer<typeof notificationHealthQuerySchema>;

// ---------------------------------------------------------------------------
// Email Management (migration 20270201000100): Super Admin settings, senders, CC / BCC rules, suppression; the history for everyone
// (scoped by the database). The database checks every value and the caller again.
// ---------------------------------------------------------------------------
export const EMAIL_CATEGORIES = ['AUTH', 'CREDENTIALS', 'RECRUITMENT', 'INTERVIEW', 'HR', 'CLIENT_ONBOARDING', 'META_VERIFICATION', 'TECHNICAL', 'ACCOUNTS',
  'INVOICE', 'PAYMENT', 'RENEWAL', 'MEETING', 'SUPPORT', 'SALES', 'GENERAL'] as const;
/** Never copied to anyone (one-time links, codes, passwords). */
export const EMAIL_SENSITIVE_CATEGORIES = ['AUTH', 'CREDENTIALS'] as const;
export const EMAIL_RULE_TARGETS = ['CUSTOMER_OWNER', 'RELATIONSHIP_MANAGER', 'META_VERIFIER', 'ACCOUNTS_OWNER', 'TECHNICAL_CONSULTANT', 'RECRUITER', 'PROFILE', 'ADDRESS'] as const;
export const EMAIL_APPLICATIONS = ['CRM', 'CANDIDATE_PORTAL', 'CLIENT_PORTAL'] as const;
export const EMAIL_STATUSES = ['QUEUED', 'PROCESSING', 'ACCEPTED', 'DELIVERY_CONFIRMED', 'DEFERRED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'RETRY_PENDING',
  'UNKNOWN_ACCEPTANCE', 'CANCELLED', 'EXPIRED', 'SUPPRESSED'] as const;
const emailAddress = z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(320);
export const emailSettingsSchema = z.object({
  providerOrder: z.array(z.enum(['resend', 'ses', 'smtp'])).min(1).max(3).refine(a => new Set(a).size === a.length, 'Each provider once.').nullable(),
  quotaThresholds: z.array(z.number().int().min(1).max(100)).min(1).max(6),
  resendDailyLimit: z.number().int().min(0).max(10_000_000),
  resendMonthlyLimit: z.number().int().min(0).max(100_000_000),
  sesDailyLimit: z.number().int().min(0).max(100_000_000).nullable(),
  criticalReserve: z.number().int().min(0).max(10_000),
  maxAutoRecipients: z.number().int().min(0).max(20),
  allowedSenderDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a domain such as amuwa.com.')).min(1).max(5)
}).strict();
export const emailSenderSchema = z.object({
  category: z.enum(EMAIL_CATEGORIES),
  fromEmail: emailAddress,
  fromName: z.string().trim().min(1).max(80).refine(v => !/[<>"\r\n]/.test(v), 'No < > or quotes in the sender name.'),
  replyTo: emailAddress.nullable().optional(),
  enabled: z.boolean().default(true)
}).strict();
export const emailRuleSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  category: z.enum(EMAIL_CATEGORIES).refine(c => !(EMAIL_SENSITIVE_CATEGORIES as readonly string[]).includes(c), 'Authentication and credential e-mails can never be copied.'),
  application: z.enum(EMAIL_APPLICATIONS).nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  workflow: z.string().trim().max(60).nullable().optional(),
  mode: z.enum(['CC', 'BCC']),
  target: z.enum(EMAIL_RULE_TARGETS),
  profileIds: z.array(uuidSchema).max(20).default([]),
  addresses: z.array(emailAddress).max(20).default([]),
  excludeProfileIds: z.array(uuidSchema).max(50).default([]),
  priority: z.number().int().min(1).max(1000).default(100),
  enabled: z.boolean().default(false),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
}).strict()
  .refine(r => r.target !== 'PROFILE' || r.profileIds.length > 0, { message: 'Choose at least one employee.', path: ['profileIds'] })
  .refine(r => r.target !== 'ADDRESS' || r.addresses.length > 0, { message: 'Enter at least one company address.', path: ['addresses'] });
export const emailRulePreviewSchema = z.object({ customerId: uuidSchema.optional(), applicationId: uuidSchema.optional() }).strict()
  .refine(v => !!v.customerId || !!v.applicationId, 'Choose a customer or a job application to preview with.');
export const emailSuppressionSchema = z.object({ email: emailAddress, active: z.boolean(), note: z.string().trim().max(300).optional() }).strict();
export const emailProviderSchema = z.enum(['resend', 'ses', 'smtp']);
export const emailHistoryQuerySchema = z.object({
  application: z.enum(EMAIL_APPLICATIONS).optional(),
  category: z.enum(EMAIL_CATEGORIES).optional(),
  status: z.union([z.enum(EMAIL_STATUSES), z.literal('PROBLEMS')]).optional(),
  provider: z.enum(['resend', 'ses', 'smtp', 'brevo']).optional(),
  departmentId: uuidSchema.optional(),
  recipient: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strip();
export type EmailHistoryQuery = z.infer<typeof emailHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Company Notice Board (migration 20270131000200). The database checks who may publish, to whom, and every rule again.
// ---------------------------------------------------------------------------
export const NOTICE_CATEGORIES = ['GENERAL', 'HR', 'POLICY', 'EVENT', 'HOLIDAY', 'IT_SYSTEM', 'OPERATIONS', 'OTHER'] as const;
export const NOTICE_CATEGORY_LABELS: Record<(typeof NOTICE_CATEGORIES)[number], string> = {
  GENERAL: 'General', HR: 'HR', POLICY: 'Policy', EVENT: 'Event', HOLIDAY: 'Holiday / office closure', IT_SYSTEM: 'IT / CRM', OPERATIONS: 'Operations', OTHER: 'Other'
};
export const NOTICE_PRIORITIES = ['NORMAL', 'IMPORTANT', 'URGENT'] as const;
// SALES / SUPPORT (20270224000100): one department's Sales or Support function, optionally only the ticked employees of it
export const NOTICE_AUDIENCES = ['COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES', 'SALES', 'SUPPORT'] as const;
export const NOTICE_ROLES = ['DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER', 'HR', 'SUPER_ADMIN'] as const;
const noticeTime = z.preprocess(v => (v === '' ? null : v), z.string().datetime({ offset: true, message: 'Enter a date and time.' }).nullable().optional());
export const noticePublishSchema = z.object({
  title: trimmed(200).min(3, 'Give the notice a title (at least 3 characters).'),
  body: trimmed(10000).min(1, 'Write the notice.'),
  category: z.enum(NOTICE_CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }),
  priority: z.enum(NOTICE_PRIORITIES, { errorMap: () => ({ message: 'Choose Normal, Important or Urgent.' }) }).default('NORMAL'),
  audienceType: z.enum(NOTICE_AUDIENCES, { errorMap: () => ({ message: 'Choose who receives the notice.' }) }),
  departmentIds: z.array(uuidSchema).max(100).default([]),
  roles: z.array(z.enum(NOTICE_ROLES)).max(6).default([]),
  employeeIds: z.array(uuidSchema).max(1000).default([]),
  attachmentIds: z.array(uuidSchema).max(5, 'Attach at most 5 files.').default([]),
  publishAt: noticeTime,
  expiresAt: noticeTime,
  clientRequestId: z.string().trim().min(8).max(80)
}).strict()
  .refine(v => v.audienceType !== 'DEPARTMENT' || v.departmentIds.length > 0, { message: 'Choose at least one department.', path: ['departmentIds'] })
  .refine(v => v.audienceType !== 'ROLE' || v.roles.length > 0, { message: 'Choose at least one designation.', path: ['roles'] })
  .refine(v => v.audienceType !== 'EMPLOYEES' || v.employeeIds.length > 0, { message: 'Choose at least one employee.', path: ['employeeIds'] })
  .refine(v => v.audienceType !== 'SALES' || v.departmentIds.length === 1, { message: 'Choose one Sales department.', path: ['departmentIds'] })
  .refine(v => v.audienceType !== 'SUPPORT' || v.departmentIds.length === 1, { message: 'Choose one Support department.', path: ['departmentIds'] })
  .refine(v => !v.expiresAt || new Date(v.expiresAt).getTime() > new Date(v.publishAt ?? Date.now()).getTime(), { message: 'The expiry is after the publish date.', path: ['expiresAt'] });
export const noticeUpdateSchema = z.object({
  title: trimmed(200).min(3, 'Give the notice a title (at least 3 characters).').optional(),
  body: trimmed(10000).min(1, 'Write the notice.').optional(),
  category: z.enum(NOTICE_CATEGORIES).optional(),
  priority: z.enum(NOTICE_PRIORITIES).optional(),
  expiresAt: noticeTime,
  /** a material change: everyone acknowledges this version again (a minor edit leaves every acknowledgement as it was) */
  acknowledgeAgain: z.boolean().optional(),
  version: z.number().int().min(1).optional()
}).strict();
/** The Super Admin adds or removes a person from the CRM team that runs the Notice Board (20270202000100). */
export const noticeManagerSetSchema = z.object({ enabled: z.boolean() }).strict();
export const noticeListQuerySchema = z.object({
  scope: z.enum(['INBOX', 'ALL', 'MINE']).default('INBOX'),
  category: z.enum(NOTICE_CATEGORIES).optional(),
  priority: z.enum(NOTICE_PRIORITIES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  unread: booleanParam.optional(),
  includeExpired: booleanParam.optional(),
  search: trimmed(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

// ---------------------------------------------------------------------------
// HR Awards (20270203000100): Award Management > Awards. The same schemas check the forms and the API; the database checks again.
// ---------------------------------------------------------------------------
export const HR_AWARD_CODES = ['PROFESSIONALISM_EXCELLENCE', 'RISING_STAR', 'PLAYER', 'EMERGING_LEADER', 'DEPARTMENT', 'TEAM', 'BUSINESS_ICON'] as const;
export const HR_AWARD_NOMINEE_TYPES = ['INDIVIDUAL', 'TEAM', 'DEPARTMENT'] as const;
/** The award month as YYYY-MM (handed to the database as the first day of that month). */
export const awardMonthSchema = z.string().trim().regex(/^(20[2-9]\d)-(0[1-9]|1[0-2])$/, 'Choose the award month and year.');
export const awardCodeSchema = z.enum(HR_AWARD_CODES, { errorMap: () => ({ message: 'That award does not exist.' }) });
export const awardMonthQuerySchema = z.object({ month: awardMonthSchema }).strict();
const awardReason = z.string().trim().min(3, 'Enter the reason for the nomination (at least 3 characters).').max(2000, 'Keep the reason under 2000 characters.');
const awardRemarks = z.string().trim().max(2000, 'Keep the remarks under 2000 characters.').optional().nullable()
  .transform(v => (v ? v : null));
export const awardNominateSchema = z.object({
  month: awardMonthSchema,
  nomineeType: z.enum(HR_AWARD_NOMINEE_TYPES, { errorMap: () => ({ message: 'Choose the nominee type: Individual, Team or Department.' }) }),
  entityId: z.string({ required_error: 'Choose who is nominated.' }).uuid('Choose who is nominated.'),
  reason: awardReason,
  remarks: awardRemarks
}).strict();
export const awardNomineeUpdateSchema = z.object({ reason: awardReason, remarks: awardRemarks }).strict();
export const awardNomineeRemoveSchema = z.object({ reason: z.string().trim().max(500, 'Keep the reason under 500 characters.').optional().nullable() }).strict();
export const awardDeclareWinnersSchema = z.object({
  nomineeIds: z.array(uuidSchema).min(1, 'Choose at least one nominee to declare a winner.').max(200, 'Declare at most 200 winners at a time.'),
  remarks: awardRemarks
}).strict();
export const awardWinnerUpdateSchema = z.object({ remarks: awardRemarks }).strict();
export const awardWinnerRevokeSchema = z.object({
  reason: z.string().trim().min(3, 'Enter the reason for revoking the winner (at least 3 characters).').max(500, 'Keep the reason under 500 characters.')
}).strict();
export type AwardNominateInput = z.input<typeof awardNominateSchema>;

// ---------------------------------------------------------------------------
// Role-based Offer Letter templates (20270206000100): HR > Offer Letter Generation. The shapes are in shared/offerTemplates.ts.
// ---------------------------------------------------------------------------
const offerText = (max: number) => z.string().max(max, `Keep each text under ${max} characters.`);
const offerBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), text: offerText(300).min(1) }).strict(),
  z.object({ type: z.literal('paragraph'), text: offerText(4000).min(1), align: z.literal('center').optional(), tight: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('heading'), text: offerText(300).min(1), plain: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('bullets'), items: z.array(offerText(2000).min(1)).min(1).max(60) }).strict(),
  z.object({ type: z.literal('signature'), label: offerText(120).min(1) }).strict(),
  z.object({ type: z.literal('pageBreak') }).strict()
]);
const offerFieldSchema = z.object({
  key: z.string().regex(OFFER_FIELD_KEY, 'A field key is letters and digits starting with a small letter (for example joiningDate).'),
  label: z.string().trim().min(1, 'Give each field a label.').max(80),
  type: z.enum(['text', 'textarea', 'date', 'money', 'select']),
  required: z.boolean(),
  default: z.string().max(300).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  source: z.enum(['employeeName', 'designation', 'department', 'joiningDate', 'monthlySalary', 'today']).optional(),
  help: z.string().max(200).optional()
}).strict();
export const offerTemplateContentSchema = z.object({
  dateLine: z.object({ left: offerText(200).optional(), right: offerText(200) }).strict(),
  blocks: z.array(offerBlockSchema).min(1, 'The letter has no wording.').max(400, 'The letter has too many parts.'),
  fields: z.array(offerFieldSchema).min(1, 'Add at least one field.').max(40, 'Use at most 40 fields.')
}).strict().superRefine((c, ctx) => {
  for (const message of offerTemplateProblems(c as OfferTemplateContent)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});
export const offerLetterheadSchema = z.union([
  z.object({ builtin: z.enum(['technical-support', 'customer-support', 'business-development', 'sales-executive', 'ai-developer']) }).strict(),
  z.object({ fileId: uuidSchema }).strict()
]);
export const offerTemplateSaveSchema = z.object({
  designation: z.string().trim().min(2, 'Enter the designation.').max(80, 'Keep the designation under 80 characters.'),
  description: z.string().trim().max(300).optional().nullable(),
  content: offerTemplateContentSchema,
  letterhead: offerLetterheadSchema,
  sampleFileId: uuidSchema.optional().nullable(),
  baseVersion: z.number().int().min(0),
  note: z.string().trim().max(200).optional().nullable()
}).strict();
export const OFFER_UPLOAD_MAX_BYTES = 2_500_000;
export const OFFER_UPLOAD_MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as const;
export const offerTemplateFileUploadSchema = z.object({
  kind: z.enum(['SAMPLE', 'LETTERHEAD']),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum([OFFER_UPLOAD_MIME.pdf, OFFER_UPLOAD_MIME.docx], { errorMap: () => ({ message: 'Upload a PDF or a Word (.docx) file.' }) }),
  dataBase64: z.string().min(8).max(Math.ceil(OFFER_UPLOAD_MAX_BYTES / 3) * 4 + 8, 'The file must be at most 2.5 MB.').regex(/^[A-Za-z0-9+/]+=*$/, 'The file could not be read.')
}).strict().refine(v => v.kind !== 'LETTERHEAD' || v.mimeType === OFFER_UPLOAD_MIME.pdf, { message: 'A letterhead must be a PDF.', path: ['mimeType'] });
export const hrRoleOfferFieldsSchema = z.object({
  offerTemplateId: uuidSchema,
  templateVersion: z.number().int().min(1),
  values: z.record(z.string().regex(OFFER_FIELD_KEY), z.string().max(2000)).refine(v => Object.keys(v).length <= 40, 'Too many values.')
}).strict();
export const offerTemplateVersionParamSchema = z.coerce.number().int().min(1).max(100000);

// ---- Task daily reports and performance approval ----
// (20270308000100) three optional fields with word limits (at least one written); progress and the reason for delay are no longer asked for (the report
// keeps the task's own progress) but an older client may still send them
export const taskReportSubmitSchema = z
  .object({
    taskId: uuidSchema,
    reportDate: isoDate.optional(),
    workCompleted: trimmed(4000).optional(),
    progress: z.number().int().min(0, 'Progress is between 0 and 100.').max(100, 'Progress is between 0 and 100.').optional(),
    pendingWork: trimmed(2000).optional(),
    delayReason: trimmed(2000).optional(),
    remarks: trimmed(2000).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    // (20270312000100) Work Completed is required (10 to 150 words); the minimum replaces the "at least one field" rule
    addReportWordIssues(ctx, v);
  });
export const taskReportReviewSchema = z
  .object({ decision: z.enum(['APPROVE', 'RETURN']), remarks: trimmed(2000).optional() })
  .strict()
  .refine(v => v.decision === 'APPROVE' || (v.remarks ?? '').length >= 5, { message: 'Say what must be corrected (at least 5 characters).', path: ['remarks'] });
// ---- Performance Management for Team Leads and Department Heads, every department (20270213000100) ----
/** The Team Lead edits a member's waiting report: the member's own rules apply, plus a reason the member reads. */
export const taskReportReviewerEditSchema = z
  .object({
    workCompleted: trimmed(4000).optional(),
    progress: z.number().int().min(0, 'Progress is between 0 and 100.').max(100, 'Progress is between 0 and 100.').optional(),
    pendingWork: trimmed(2000).optional(),
    delayReason: trimmed(2000).optional(),
    remarks: trimmed(2000).optional(),
    reason: trimmed(1000).min(5, 'Say why you changed the report (at least 5 characters); the team member reads it.')
  })
  .strict()
  .superRefine((v, ctx) => {
    // (20270312000100) Work Completed is required (10 to 150 words); the minimum replaces the "at least one field" rule
    addReportWordIssues(ctx, v);
  });
/** The reviewer updates the rating and remarks of an approved evaluation. */
export const performanceEvaluationUpdateSchema = z
  .object({ rating: z.number().int().min(1, 'The rating is from 1 to 5.').max(5, 'The rating is from 1 to 5.'), remarks: trimmed(2000).optional() })
  .strict();
/** One person's tasks and reports in a period (the reviewer's drill-down). */
export const performanceWorkQuerySchema = z
  .object({ start: isoDate, end: isoDate })
  .strict()
  .refine(v => v.end >= v.start, { message: 'The end date cannot be before the start date.', path: ['end'] });
export const taskReportListQuerySchema = z
  .object({
    scope: z.enum(['MINE', 'TEAM']).default('MINE'),
    status: z.enum(['PENDING', 'APPROVED', 'RETURNED']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    memberId: uuidSchema.optional(),
    taskId: uuidSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50)
  })
  .strict();
export const performanceOverviewQuerySchema = z
  .object({ start: isoDate, end: isoDate, departmentId: uuidSchema.optional() })
  .strict()
  .refine(v => v.end >= v.start, { message: 'The end date cannot be before the start date.', path: ['end'] });
export const performanceRecordReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']), remarks: trimmed(2000).optional(), version: z.number().int().min(1).optional(),
    // 20270210000100: the rating given when approving (required by the database for International / Reseller)
    rating: z.number().int().min(1, 'The rating is from 1 to 5.').max(5, 'The rating is from 1 to 5.').optional()
  })
  .strict()
  .refine(v => v.decision === 'APPROVE' || (v.remarks ?? '').length >= 5, { message: 'Say what must be corrected (at least 5 characters).', path: ['remarks'] });

// ---------------------------------------------------------------------------------------------------------------------------------
// Google Sheet sync of existing customers (docs/CUSTOMER_SHEET_SYNC.md, migration 20270216000100): what the Apps Script sends.
// "header" = the sheet's first rows (up to 6, the headings are among them); "rows" = the rows that changed, each with its sheet row number.
// Every cell is a string, a number or empty (the script sends dates as yyyy-mm-dd). The import's own limits apply after parsing.
// ---------------------------------------------------------------------------------------------------------------------------------
const sheetCellSchema = z.union([z.string().max(2000), z.number().finite(), z.null()]);
export const SHEET_SYNC_MAX_ROWS = 2000;
export const sheetSyncSchema = z
  .object({
    sheetName: z.string().max(120).optional(),
    scriptVersion: z.number().int().min(1).max(1000).optional(),
    header: z.array(z.array(sheetCellSchema).max(250)).min(1).max(6),
    rows: z
      .array(z.object({ r: z.number().int().min(2).max(20000), c: z.array(sheetCellSchema).max(250) }).strict())
      .max(SHEET_SYNC_MAX_ROWS, `Send at most ${SHEET_SYNC_MAX_ROWS} rows at a time (the script does this by itself).`)
  })
  .strict();
export type SheetSyncInput = z.infer<typeof sheetSyncSchema>;
/** POST /search: the query travels in the body (not the address), so it is not written to access logs. */
export const globalSearchSchema = z
  .object({ q: z.string().max(200), limit: z.number().int().min(1).max(20).optional() })
  .strict();
export const searchRecordParamsSchema = z.object({ type: z.enum(['employee', 'customer', 'lead', 'ticket', 'department']), id: uuidSchema }).strict();

// ---------------------------------------------------------------------------
// Wallet PIN (migration 20270228000100): exactly 4 digits. The database checks and hashes it; these are the same rules for the screen and the tests.
// ---------------------------------------------------------------------------
export const WALLET_PIN_LENGTH = 4;
export const WALLET_LEGACY_PIN_LENGTH = 6;
export const walletPinSchema = z.string().regex(/^[0-9]{4}$/, 'The PIN must be exactly 4 digits.')
  .refine(v => !/^(.)\1{3}$/.test(v) && !['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876'].includes(v),
    { message: 'Choose a PIN that is harder to guess (not the same digit four times or a simple sequence).' });
/** An existing 6-digit PIN, accepted only as the CURRENT PIN while it is replaced by a 4-digit one. */
export const walletLegacyPinSchema = z.string().regex(/^[0-9]{6}$/, 'Enter your current 6-digit PIN.');
export const walletNewPinSchema = z.object({ pin: walletPinSchema, confirm: z.string() }).strict()
  .refine(v => v.pin === v.confirm, { message: 'The two PINs do not match.', path: ['confirm'] });

// ---------------------------------------------------------------------------
// Support Recharges (migrations 20270228000200, 20270310000100): Panel and Message recharges for a customer, GST / Non-GST, a payment screenshot, and Accounts
// verifying the payment. The database re-checks every rule; the customer's Relationship Manager is never taken from a request.
// ---------------------------------------------------------------------------
export const RECHARGE_KINDS = ['PANEL', 'MESSAGE'] as const;
export const RECHARGE_BILLING_TYPES = ['GST', 'NON_GST'] as const;
export const RECHARGE_PAYMENT_STATUSES = ['PENDING_VERIFICATION', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED'] as const;
export const RECHARGE_INVOICE_STATUSES = ['NOT_GENERATED', 'GENERATED', 'SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED'] as const;
export const RECHARGE_VERIFY_DECISIONS = ['RECEIVED', 'NOT_RECEIVED', 'REJECTED'] as const;
export const RECHARGE_PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const RECHARGE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const rechargeKindSchema = z.enum(RECHARGE_KINDS, { errorMap: () => ({ message: 'Choose Panel Recharge or Message Recharge.' }) });
export const rechargeBillingTypeSchema = z.enum(RECHARGE_BILLING_TYPES, { errorMap: () => ({ message: 'Choose GST or Non-GST.' }) });
export const rechargePaymentStatusSchema = z.enum(RECHARGE_PAYMENT_STATUSES, { errorMap: () => ({ message: 'Choose a valid payment status.' }) });
/** A money amount: a number with at most 2 decimals, never negative. */
const rechargeAmount = z.coerce.number({ invalid_type_error: 'Amounts must be numbers.' }).min(0, 'Amounts cannot be negative.').max(100000000, 'Amounts cannot be more than 10 crore.')
  .refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Amounts can have at most 2 decimal places.');
const rechargeText = (max: number, message: string) => z.string().trim().max(max, message).optional().nullable().transform(v => (v ? v : null));
/** A GST number as typed: spaces and case do not matter; the database checks the format again. */
const rechargeGstin = z.string().trim().transform(v => v.replace(/\s+/g, '').toUpperCase()).refine(v => v === '' || /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(v), 'Enter a valid 15-character GST number.')
  .optional().nullable().transform(v => (v ? v : null));
const rechargeFields = z.object({
  rechargeDate: isoDate,
  billingType: rechargeBillingTypeSchema,
  /** the amount before GST (for a Non-GST recharge, the whole amount) */
  rechargeAmount: rechargeAmount.refine(v => v > 0, 'Enter the recharge amount (above zero).'),
  gstAmount: rechargeAmount.default(0),
  gstNumber: rechargeGstin,
  /** Optional: when sent it must equal amount + GST (the database always computes it). */
  totalAmount: rechargeAmount.optional(),
  paymentReference: rechargeText(100, 'The payment reference can be at most 100 characters.'),
  remarks: rechargeText(1000, 'Remarks can be at most 1000 characters.'),
  screenshotId: uuidSchema.optional().nullable().transform(v => v ?? null)
});
const rechargeRules = (v: { billingType: string; rechargeAmount: number; gstAmount: number; gstNumber: string | null; totalAmount?: number }, ctx: z.RefinementCtx) => {
  const sum = Math.round(v.rechargeAmount * 100 + v.gstAmount * 100) / 100;
  if (v.billingType === 'NON_GST' && v.gstAmount !== 0) ctx.addIssue({ code: 'custom', path: ['gstAmount'], message: 'A Non-GST recharge has no GST amount.' });
  if (v.billingType === 'GST' && v.gstAmount > v.rechargeAmount) ctx.addIssue({ code: 'custom', path: ['gstAmount'], message: 'The GST amount cannot be more than the recharge amount.' });
  if (v.totalAmount !== undefined && Math.abs(v.totalAmount - sum) > 0.001) ctx.addIssue({ code: 'custom', path: ['totalAmount'], message: 'The total must equal the recharge amount plus the GST amount.' });
};
/** Editing: the customer, the kind and the RM are fixed, so none of them can be sent. */
export const rechargeBodySchema = rechargeFields.strict().superRefine(rechargeRules);
/** Creating: the customer is chosen; the Relationship Manager, the department and the status are never accepted from the browser. */
export const rechargeCreateSchema = rechargeFields.extend({ kind: rechargeKindSchema, customerId: uuidSchema, requestId: uuidSchema.optional() }).strict().superRefine(rechargeRules)
  .refine(v => !!v.screenshotId, { message: 'Upload the screenshot of the payment.', path: ['screenshotId'] });
/** Accounts: the money arrived, did not arrive, or the recharge is rejected. */
export const rechargeVerifySchema = z
  .object({
    decision: z.enum(RECHARGE_VERIFY_DECISIONS, { errorMap: () => ({ message: 'Choose Payment received, Payment not received or Reject.' }) }),
    note: z.string().trim().max(500, 'The note can be at most 500 characters.').optional().nullable().transform(v => (v ? v : null)),
    /** what Accounts saw arrive: when sent it must equal the recharge total */
    receivedAmount: rechargeAmount.optional()
  })
  .strict()
  .refine(v => v.decision === 'RECEIVED' || (v.note ?? '').length >= 3, { message: 'Say why (a short note is required).', path: ['note'] });
/** Accounts: a correction of the billing details, with the reason. */
export const rechargeCorrectSchema = z
  .object({
    note: z.string({ required_error: 'Say what was corrected and why.' }).trim().min(3, 'Say what was corrected and why.').max(500, 'The note can be at most 500 characters.'),
    billingType: rechargeBillingTypeSchema.optional(),
    rechargeAmount: rechargeAmount.refine(v => v > 0, 'Enter the recharge amount (above zero).').optional(),
    gstAmount: rechargeAmount.optional(),
    gstNumber: rechargeGstin,
    paymentReference: rechargeText(100, 'The payment reference can be at most 100 characters.'),
    customerEmail: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254).optional().nullable().or(z.literal('')),
    customerPhone: z.string().trim().max(40).optional().nullable(),
    customerAddress: z.string().trim().max(500, 'The address can be at most 500 characters.').optional().nullable()
  })
  .strict();
export const rechargeListQuerySchema = z
  .object({
    kind: rechargeKindSchema.optional().or(z.literal('').transform(() => undefined)),
    search: z.string().trim().max(100).optional(),
    paymentStatus: z.union([z.literal(''), rechargePaymentStatusSchema]).optional(),
    invoiceStatus: z.union([z.literal(''), z.enum([...RECHARGE_INVOICE_STATUSES, 'GENERATED_ANY', 'DELIVERY_ANY'])]).optional(),
    from: isoDate.optional().or(z.literal('')),
    to: isoDate.optional().or(z.literal('')),
    min: z.coerce.number().min(0).max(200000000).optional().or(z.literal('').transform(() => undefined)),
    max: z.coerce.number().min(0).max(200000000).optional().or(z.literal('').transform(() => undefined)),
    rm: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0)
  })
  .strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, { message: 'The "from" date must not be after the "to" date.', path: ['to'] })
  .refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, { message: 'The minimum amount must not be above the maximum.', path: ['max'] });
export const rechargePerformanceQuerySchema = z
  .object({ from: isoDate.optional().or(z.literal('')), to: isoDate.optional().or(z.literal('')), rm: uuidSchema.optional().or(z.literal('').transform(() => undefined)) })
  .strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, { message: 'The "from" date must not be after the "to" date.', path: ['to'] });
export const rechargeCustomerQuerySchema = z.object({ search: z.string().trim().max(100).optional() }).strict();
/** The payment proof: an image or a PDF, at most 5 MB. */
export const rechargeUploadSchema = z
  .object({
    fileName: z.string().trim().min(1, 'The file needs a name.').max(200),
    mimeType: z.enum(RECHARGE_PROOF_TYPES, { errorMap: () => ({ message: 'The payment proof must be an image (PNG, JPEG or WebP) or a PDF.' }) }),
    sizeBytes: z.coerce.number().int().positive().max(RECHARGE_MAX_FILE_BYTES, 'Files can be at most 5 MB.')
  })
  .strict();

/** Lead tags (20270305000100). The database checks who may manage which tag, duplicates and departments again. */
export const leadTagListQuerySchema = z.object({ departmentId: uuidSchema.optional().or(z.literal('').transform(() => undefined)) }).strict();
export const leadTagSaveSchema = z
  .object({
    id: uuidSchema.optional(),
    label: z.string().trim().min(1, 'Give the tag a label.').max(40, 'Keep the label to 40 characters.'),
    colour: z.enum(LEAD_TAG_COLOURS, { errorMap: () => ({ message: 'Choose one of the tag colours.' }) }),
    stage: z.enum(LEAD_STATUSES, { errorMap: () => ({ message: 'Choose the stage the tag counts as.' }) }),
    departmentIds: z.array(uuidSchema).max(20, 'Choose up to 20 departments.').optional()
  })
  .strict();
export const leadTagRetireSchema = z.object({ retired: z.boolean() }).strict();
export const leadTagSetSchema = z.object({ tagId: uuidSchema }).strict();
/** Accounts: make the invoice of a verified recharge. Nothing here is a number or an amount: the database builds the invoice from the recharge. */
export const rechargeInvoiceGenerateSchema = z
  .object({
    hsnSac: z.string().trim().regex(/^[0-9]{4,8}$/, 'The HSN/SAC code is 4 to 8 digits.').optional().or(z.literal('').transform(() => undefined)),
    taxTreatment: z.enum(['INTRA_STATE', 'INTER_STATE'], { errorMap: () => ({ message: 'Choose intra-state (CGST + SGST) or inter-state (IGST).' }) }).optional()
  })
  .strict();
export const RECHARGE_DELIVERY_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;
/** Accounts: send the invoice. "resend" is the deliberate second send of a channel that already went. */
export const rechargeInvoiceSendSchema = z
  .object({
    channels: z.array(z.enum(RECHARGE_DELIVERY_CHANNELS, { errorMap: () => ({ message: 'Choose e-mail or WhatsApp.' }) })).min(1, 'Choose e-mail, WhatsApp or both.').max(2).refine(v => new Set(v).size === v.length, 'Each channel once.'),
    resend: z.boolean().default(false)
  })
  .strict();
/** Accounts: the customer's contact for sending, with the reason. */
export const rechargeContactSchema = z
  .object({
    customerEmail: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254).optional().nullable().or(z.literal('')),
    customerPhone: z.string().trim().max(40).optional().nullable(),
    note: z.string({ required_error: 'Say what was corrected and why.' }).trim().min(3, 'Say what was corrected and why.').max(500)
  })
  .strict();

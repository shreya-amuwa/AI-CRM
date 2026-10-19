/**
 * Validation schemas shared by the API (authoritative) and the UI (early
 * feedback). The database enforces the same rules again with constraints.
 */
import { z } from 'zod';
import { mobileProblem, normalizeWebsite } from './contactValidation.js';
import { isValidGstinFormat, normalizeGstin } from './gst.js';
import { MAX_LINES, paiseToDecimal, toPaise, toRateBp } from './invoiceCalc.js';
import {
  ACCOUNT_STATUSES,
  ADDON_REQUEST_STATUSES,
  CUSTOMER_DOCUMENT_MAX_BYTES,
  CUSTOMER_DOCUMENT_MAX_LABEL,
  INVOICE_PDF_MAX_BYTES,
  INVOICE_PDF_MAX_LABEL,
  INVOICE_PURPOSES,
  INVOICE_STAGES,
  TAX_TREATMENTS,
  LEAD_STATUSES,
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
  TEAM_DIVISIONS
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
export const DESIGNATIONS = ['Department Head', 'Team Lead', 'Team Member'] as const;

/** A real calendar date (YYYY-MM-DD) as days since 1970, or null. */
function dayNumber(v: string): number | null {
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : Math.floor(t / 86_400_000);
}
const today = () => Math.floor(Date.now() / 86_400_000);

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
      .refine(v => v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15, 'Enter a valid emergency contact number (10 to 15 digits).')
  })
  .strict();
export type MemberDetailsInput = z.infer<typeof memberDetailsSchema>;

export const userCreateSchema = z
  .object({
    email: emailSchema,
    fullName: trimmed(160).min(1, 'Full name is required.'),
    password: z.string().min(10, 'Temporary password must be at least 10 characters.').max(72),
    role: assignableRoleSchema,
    departmentId: uuidSchema.optional(),
    teamId: uuidSchema.optional(),
    position: optionalText(120),
    /** Team member of a support team who opens the Technical Consultant dashboard. */
    technicalConsultant: z.boolean().optional(),
    /** Joining date, date of birth, blood group, emergency contact, designation. */
    details: memberDetailsSchema.optional()
  })
  .strict()
  .refine(u => (u.role === 'DEPARTMENT_HEAD' ? !!u.departmentId && !u.teamId : !!u.teamId), {
    message: 'Department heads need a department; team heads and members need a team.',
    path: ['teamId']
  })
  .refine(u => !u.technicalConsultant || u.role === 'TEAM_MEMBER', {
    message: 'A Technical Consultant is created as a team member of a support team.',
    path: ['role']
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

export const departmentUpdateSchema = z
  .object({
    name: trimmed(120).min(2).optional(),
    description: trimmed(1000).optional(),
    category: optionalText(120),
    iconName: trimmed(40).optional(),
    accentColor: colorSchema.optional(),
    logoUrl: optionalText(1000),
    isLocked: z.boolean().optional()
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

export const leadCreateSchema = z
  .object({ ...leadFields, services: serviceCodes.min(1, 'Select at least one service.'), ownerId: uuidSchema.optional() })
  .strict();
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z
  .object(leadFields)
  .partial()
  .extend({
    services: serviceCodes.min(1, 'Select at least one service.').optional(),
    activityNote: optionalText(500)
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

/** Accounts creates the dashboard login of a customer whose services need no Technical Consultant. */
export const accountsClientLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254),
    password: z.string().min(10, 'The password must be at least 10 characters.').max(72)
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
    /** Whether the agreed amount already includes GST. Older callers send nothing and keep the amount as the total. */
    taxBasis: z.enum(AGREEMENT_TAX_BASES, { errorMap: () => ({ message: 'Say whether the agreed amount includes or excludes GST.' }) }).default('INCLUSIVE')
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
  amount: wholeRupees('Enter the amount received.'),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Select the payment method.' }) }),
  reference: optionalText(120),
  paidAt: z.preprocess(v => (v === '' ? null : v), datetime.nullable().optional()),
  note: optionalText(1000)
};
export const accountsRecordPaymentSchema = z
  .object({ ...paymentFields, verify: z.boolean().default(false) })
  .strict()
  .refine(v => ['CASH', 'OTHER'].includes(v.method) || !!v.reference, { message: 'Enter the transaction / reference number.', path: ['reference'] });
export const accountsUpdatePaymentSchema = z.object(paymentFields).strict();
export const paymentDecisionSchema = z.object({ note: optionalText(500) }).strict();
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

export const expenseSchema = z
  .object({
    date: isoDate,
    description: trimmed(300).min(1, 'Describe the expense.'),
    departmentId: z.preprocess(v => (v === '' ? null : v), uuidSchema.nullable().optional()),
    category: trimmed(80).min(1, 'Enter the category.'),
    amount: money2,
    status: z.enum(['PAID', 'PENDING']).default('PAID'),
    notes: optionalText(1000)
  })
  .strict();
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the tax rate as a percentage from 0 to 100 (up to 2 decimals).' });
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
    /** Blank: the next number is reserved automatically. */
    invoiceNumber: z.preprocess(
      v => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/, 'The invoice number can use letters, numbers, / and - (up to 16 characters).').nullable().optional()
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
export const clientTicketCreateSchema = z
  .object({
    subject: z.string().trim().min(3, 'Enter a subject (at least 3 characters).').max(200, 'The subject is too long.'),
    description: z.string().trim().min(5, 'Describe the problem (at least 5 characters).').max(4000, 'The description is too long.'),
    category: z.enum(['GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER']).default('GENERAL'),
    serviceCode: serviceCodeSchema.optional().nullable().transform(v => v || null)
  })
  .strict();
export const clientTicketReplySchema = z.object({ message: z.string().trim().min(1, 'Write your reply.').max(4000, 'The reply is too long.') }).strict();
/** A chat message in a ticket. clientMsgId makes a retry / double click store the message once. */
export const clientTicketMessageSchema = z
  .object({
    message: z.string().trim().min(1, 'Write your message.').max(4000, 'The message is too long.'),
    clientMsgId: uuidSchema.optional().nullable().transform(v => v || null)
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

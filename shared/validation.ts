/**
 * Validation schemas shared by the API (authoritative) and the UI (early
 * feedback). The database enforces the same rules again with constraints.
 */
import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
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
    technicalConsultant: z.boolean().optional()
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
  teamId: uuidSchema.optional()
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
  name: trimmed(200).min(1, 'Contact person is required.'),
  company: trimmed(200).min(1, 'Business name is required.'),
  phone: phoneSchema,
  whatsapp: z.preprocess(v => (v === '' ? null : v), phoneSchema.nullable().optional()),
  email: z.preprocess(v => (v === '' ? null : v), emailSchema.nullable().optional()),
  city: optionalText(120),
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
  /** Technical Consultant Customers panel: sent to them, not yet sent for onboarding. */
  intake: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  /** Only records owned by the caller (e.g. a support member's own pipeline). */
  mine: z.preprocess(v => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  sort: z.enum(['newest', 'oldest', 'followUp', 'dueDate', 'amount', 'name']).default('newest')
});
export type PipelineListQuery = z.infer<typeof pipelineListQuerySchema>;

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
    sizeBytes: z.coerce.number().int().positive().max(512000)
  })
  .strict();

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
export const consultantAddonsSchema = z
  .object({
    addons: z
      .array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(), name: trimmed(120).optional() }).strict())
      .max(25)
  })
  .strict();
export const consultantDetailsSchema = z
  .object({
    name: trimmed(200).min(2, 'Enter the customer\'s name.'),
    company: trimmed(200).optional().nullable(),
    phone: trimmed(25).optional().nullable(),
    email: trimmed(254).optional().nullable()
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

export const sendToAccountsSchema = z
  .object({ amount: wholeRupees('Enter the agreed amount.'), note: optionalText(1000) })
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
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
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

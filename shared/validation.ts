/**
 * Validation schemas shared by the API (authoritative) and the UI (early
 * feedback). The database enforces the same rules again with constraints.
 */
import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
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
    position: optionalText(120)
  })
  .strict()
  .refine(u => (u.role === 'DEPARTMENT_HEAD' ? !!u.departmentId && !u.teamId : !!u.teamId), {
    message: 'Department heads need a department; team heads and members need a team.',
    path: ['teamId']
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

/**
 * API contracts shared by the backend (`server/`) and the frontend (`src/`).
 * These are transport shapes (camelCase); database rows are mapped in the
 * repositories.
 */

export const ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const TEAM_DIVISIONS = ['SALES', 'SUPPORT', 'GENERAL'] as const;
export type TeamDivision = (typeof TEAM_DIVISIONS)[number];

export const CUSTOMER_SEGMENTS = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'OTHER'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'PROSPECT'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const NOTIFICATION_PRIORITIES = ['normal', 'urgent', 'announcement'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export interface DepartmentRef {
  id: string;
  slug: string;
  name: string;
}

export interface TeamRef {
  id: string;
  name: string;
  division: TeamDivision;
}

export interface Department extends DepartmentRef {
  description: string;
  category: string | null;
  iconName: string;
  accentColor: string;
  logoUrl: string | null;
  isLocked: boolean;
  createdAt: string;
}

export interface Team extends TeamRef {
  departmentId: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  position: string | null;
  role: Role;
  status: AccountStatus;
  statusReason: string | null;
  departmentId: string | null;
  teamId: string | null;
  department: DepartmentRef | null;
  team: TeamRef | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface ProfileSummary {
  id: string;
  fullName: string;
  email?: string;
}

export interface Customer {
  id: string;
  ownerId: string;
  owner: ProfileSummary | null;
  teamId: string;
  departmentId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  segment: CustomerSegment;
  status: CustomerStatus;
  notes: string | null;
  lastOrderDate: string | null;
  lastOrderAmount: number | null;
  totalSpent: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerActivity {
  id: string;
  customerId: string;
  actorId: string | null;
  type: string;
  note: string | null;
  occurredAt: string;
}

export interface ApprovalRequest {
  id: string;
  requestType: 'USER_REGISTRATION';
  status: ApprovalStatus;
  subject: Pick<Profile, 'id' | 'email' | 'fullName' | 'status' | 'role'> | null;
  departmentId: string | null;
  teamId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  departmentId: string | null;
  teamId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerSummary {
  total: number;
  active: number;
  inactive: number;
  prospect: number;
  newThisMonth: number;
  newLastMonth: number;
  bySegment: Partial<Record<CustomerSegment, number>>;
}

export interface ImportResult {
  imported: number;
  skipped: { index: number; reason: string }[];
}

/** Registration form options (public). */
export interface RegistrationDepartment extends DepartmentRef {
  teams: TeamRef[];
}

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'ACCOUNT_INACTIVE',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'METHOD_NOT_ALLOWED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL'
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

// ---------------------------------------------------------------------------
// Sales pipeline: Lead → Potential → Onboarding (one customer record)
// ---------------------------------------------------------------------------
export const LIFECYCLE_STAGES = ['LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER', 'LOST'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const PIPELINE_STAGES = ['LEAD', 'POTENTIAL', 'ONBOARDING'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const PAYMENT_FILTERS = ['AWAITING', 'PART_PAID', 'OVERDUE'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const ONBOARDING_FILTERS = ['COLLECTING', 'WAITING_ON_CLIENT', 'READY_FOR_HANDOVER'] as const;
export type OnboardingFilter = (typeof ONBOARDING_FILTERS)[number];

export const PAYMENT_METHODS = ['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ONBOARDING_STAGES = ['SALES_CONSULTATION', 'COLLECT_REQUIREMENTS', 'SETUP', 'APPROVAL', 'HANDOVER', 'COMPLETED'] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export interface ServiceCatalogItem {
  code: string;
  name: string;
  category: string;
}

export interface PipelineCustomer {
  id: string;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  name: string;
  company: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  businessCategory: string | null;
  leadSource: string | null;
  notes: string | null;
  nextFollowUpAt: string | null;
  expectedBudget: number | null;
  dealAmount: number | null;
  amountReceived: number;
  paymentDueDate: string | null;
  services: string[];
  owner: ProfileSummary | null;
  ownerId: string;
  teamId: string;
  departmentId: string;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
  onboarding: CustomerOnboarding | null;
}

export interface CustomerOnboarding {
  stage: OnboardingStage;
  paymentMethod: PaymentMethod | null;
  startedAt: string;
  targetHandoverDate: string | null;
  forwardedToSupportAt: string | null;
  mandatorySaved: number;
}

export interface DocumentType {
  code: string;
  label: string;
  description: string;
  isMandatory: boolean;
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

export type DocumentStatus = 'PENDING' | 'UPLOADED' | 'SUPERSEDED' | 'FAILED';

export interface CustomerDocument {
  id: string;
  customerId: string;
  documentType: string;
  version: number | null;
  status: DocumentStatus;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number | null;
  uploadedBy: ProfileSummary | null;
  uploadedAt: string | null;
  createdAt: string;
}

export interface PipelineCustomerDetail extends PipelineCustomer {
  documents: CustomerDocument[];
  documentTypes: DocumentType[];
  activities: CustomerActivity[];
}

export interface PipelineCounts {
  leads: Record<'all' | LeadStatus, number>;
  potential: Record<'all' | PaymentFilter, number>;
  onboarding: Record<'all' | OnboardingFilter, number>;
  mandatoryDocuments: number;
}

export interface InboundLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  channel: string | null;
  receivedAt: string;
}

/** Returned when an upload starts: the browser PUTs the file to this one path only. */
export interface DocumentUploadTicket {
  document: CustomerDocument;
  bucket: string;
  path: string;
  token: string;
}

export interface DocumentUrl {
  url: string;
  expiresInSeconds: number;
  fileName: string;
}

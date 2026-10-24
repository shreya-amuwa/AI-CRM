/**
 * API contracts shared by the backend (`server/`) and the frontend (`src/`).
 * These are transport shapes (camelCase); database rows are mapped in the
 * repositories.
 */

export const ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'] as const;
export type Role = (typeof ROLES)[number];

/** Which side of the department a Department Head leads: a department can have one Sales head and one Support head. */
export const HEAD_DIVISIONS = ['SALES', 'SUPPORT'] as const;
export type HeadDivision = (typeof HEAD_DIVISIONS)[number];
export const HEAD_DIVISION_LABELS: Record<HeadDivision, string> = { SALES: 'Sales', SUPPORT: 'Support' };

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** What a Sales team member is: stored next to the team (it never replaces it). Only Telecaller has a dashboard so far. */
export const SALES_SUB_ROLES = ['TELECALLER', 'BUSINESS_ASSOCIATE', 'INFLUENCER', 'VISIT_SALES', 'BUSINESS_PARTNER'] as const;
export type SalesSubRole = (typeof SALES_SUB_ROLES)[number];
export const SALES_SUB_ROLE_LABELS: Record<SalesSubRole, string> = {
  TELECALLER: 'Telecaller',
  BUSINESS_ASSOCIATE: 'Business Associate',
  INFLUENCER: 'Influencer',
  VISIT_SALES: 'Visit Sales',
  BUSINESS_PARTNER: 'Business Partner'
};

/** Telecaller: the call status of a contact or a lead (separate from a lead's temperature). */
export const CALL_STATUSES = ['PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  PENDING: 'Pending',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  NOT_INTERESTED: 'Not Interested',
  COMPLETED: 'Completed'
};
export const LEAD_TEMPERATURES = ['HOT', 'WARM', 'COLD'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const TEAM_DIVISIONS = ['SALES', 'SUPPORT', 'GENERAL'] as const;
export type TeamDivision = (typeof TEAM_DIVISIONS)[number];

/**
 * The dashboard a user opens, stored in profiles.default_dashboard and kept in
 * step with role + team division by the database (one value per department role).
 */
export type DefaultDashboard =
  | 'super-admin'
  | 'department-head'
  | 'sales-department-head'
  | 'hr-head'
  | 'sales-lead'
  | 'support-lead'
  | 'accounts-staff'
  | 'team-lead'
  | 'sales-member'
  | 'support-member'
  | 'technical-consultant'
  | 'telecaller'
  | 'business-associate'
  /** A Sales sub-role that has no dashboard of its own yet: 'sales-business-associate', 'sales-influencer', 'sales-visit-sales', 'sales-business-partner'. */
  | `sales-${string}`
  | 'team-member';

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
  /** Set for a department that is the Sales or Support side of another one (Wabatalk = the Support side of D Talk). */
  facetOf: string | null;
  facetDivision: HeadDivision | null;
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
  /** Team member of a support team who opens the Technical Consultant dashboard. */
  isTechnicalConsultant: boolean;
  /** Sales role of a Sales team member (Telecaller, Business Associate, ...); null for everybody else. */
  salesSubRole?: SalesSubRole | null;
  /** Sales or Support side of a Department Head (null when not specified or not a Department Head). */
  headDivision?: HeadDivision | null;
  /** Stored default dashboard (resolved by the database from role + team division). */
  defaultDashboard?: DefaultDashboard | null;
  status: AccountStatus;
  statusReason: string | null;
  departmentId: string | null;
  teamId: string | null;
  department: DepartmentRef | null;
  team: TeamRef | null;
  approvedAt: string | null;
  createdAt: string;
}

/** One department a Department Head is authorised to work in, with the functions (Sales / Support) allowed there. */
export interface DepartmentScopeDepartment {
  id: string;
  slug: string;
  name: string;
  iconName: string | null;
  accentColor: string | null;
  /** The department whose people, customers and tickets this entry works on (D Talk for Wabatalk). */
  dataDepartmentId: string;
  dataSlug: string;
  /** The head's own department (the one they are placed in). */
  isHome: boolean;
  /** The functions authorised in this department. Empty for a head with no side set (the whole department). */
  divisions: HeadDivision[];
  /** The head has the whole department here (a head with no side set). */
  wholeDepartment: boolean;
}
/** The departments and functions a Department Head may switch between, and what the database applies to this request. */
export interface MyDepartmentScopes {
  departments: DepartmentScopeDepartment[];
  homeDepartmentId: string | null;
  activeDepartmentId: string | null;
  activeDivision: HeadDivision | null;
}
/** What the Super Admin sees when giving a Department Head more departments / functions. */
export interface DepartmentAccessInfo {
  profileId: string;
  name: string;
  role: Role;
  homeDepartmentId: string | null;
  headDivision: HeadDivision | null;
  grants: { departmentId: string; division: HeadDivision }[];
  departments: { id: string; slug: string; name: string; hasSales: boolean; hasSupport: boolean; supportDepartment?: string | null; salesDepartment?: string | null }[];
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

/** One row of the security and audit log viewer (read-only). */
export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';
export interface AuditEvent {
  id: number;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: AuditOutcome;
  actorId: string | null;
  /** Who did it, as it was when it happened (kept even if the person is removed later). */
  actor: string | null;
  actorRole: string | null;
  departmentId: string | null;
  department: string | null;
  /** The API request that caused it (the same id is in the server log). */
  requestId: string | null;
  ip: string | null;
  /** Safe details only: secrets are removed before an event is stored. */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dashboards (figures are worked out by the database from the real records; the screens add nothing of their own)
// ---------------------------------------------------------------------------
export interface LifecycleCounts {
  total: number;
  leads: number;
  potential: number;
  onboarding: number;
  customers: number;
  lost: number;
}
export interface TicketCounts {
  open: number;
  escalated: number;
  unassigned: number;
  pastSla: number;
}
export interface DashboardAlert {
  key: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  title: string;
  hint: string;
}
export interface DashboardActivity {
  at: string;
  type: string;
  note: string;
  customerId: string;
  customer: string;
  department?: string | null;
  actor: string | null;
}
export interface CompanyDepartmentRow {
  id: string;
  name: string;
  slug: string;
  locked: boolean;
  generatesRevenue: boolean;
  staff: number;
  leads: number;
  potential: number;
  onboarding: number;
  customers: number;
  lost: number;
  records: number;
  /** (onboarding + customers) / (records - lost), as a percentage; null when there is nothing to divide. */
  conversionPct: number | null;
  income: number;
  incomeThisMonth: number;
  expenses: number;
  expensesPending: number;
  outstanding: number;
  openTickets: number;
  pastSla: number;
}
/** Super Admin only: the whole company in one response. */
export interface CompanyOverview {
  generatedAt: string;
  customers: LifecycleCounts;
  money: {
    incomeThisMonth: number;
    incomeLastMonth: number;
    incomeTotal: number;
    expensesThisMonth: number;
    expensesLastMonth: number;
    expensesTotal: number;
    expensesPending: number;
    pendingConfirmations: number;
    pendingConfirmationsAmount: number;
    unverifiedPayments: number;
    unverifiedPaymentsAmount: number;
    outstandingBalance: number;
    customersWithBalance: number;
  };
  invoices: { count: number; total: number; paid: number; paidAmount: number; pending: number; pendingAmount: number; overdue: number; overdueAmount: number };
  onboarding: {
    inProgress: number;
    withConsultant: number;
    byStage: Record<'SALES_CONSULTATION' | 'COLLECT_REQUIREMENTS' | 'SETUP' | 'APPROVAL' | 'HANDOVER' | 'COMPLETED', number>;
    itemsTotal: number;
    itemsSaved: number;
    itemsVerified: number;
    itemsRejected: number;
    stalled: number;
  };
  tickets: TicketCounts;
  departments: CompanyDepartmentRow[];
  trend: { month: string; income: number; expenses: number; net: number }[];
  alerts: DashboardAlert[];
  recentActivity: DashboardActivity[];
}
export interface ScopeMemberRow {
  id: string;
  name: string;
  role: Role;
  team: string;
  teamId: string;
  leads: number;
  potential: number;
  onboarding: number;
  customers: number;
  records: number;
  followUpsOverdue: number;
  openTasks: number;
  overdueTasks: number;
  lastActivityAt: string | null;
}
/** What a Team Lead, a Department Head (or the Super Admin for one department) is responsible for. Scoped by row-level security. */
export interface ScopeOverview {
  generatedAt: string;
  scope: { role: Role; departmentId: string | null; teamId: string | null };
  customers: LifecycleCounts;
  pipeline: { followUpsOverdue: number; followUpsToday: number; leadsWithoutFollowUp: number; newLeadsThisWeek: number; wonThisMonth: number };
  money: { pendingConfirmations: number; unverifiedPayments: number; outstandingBalance: number; customersWithBalance: number; verifiedReceived: number };
  onboarding: { inProgress: number; waitingForDepartmentHead: number; waitingForTeamLead: number; withTeamMember: number; itemsTotal: number; itemsVerified: number; stalled: number };
  tickets: TicketCounts;
  tasks: { open: number; overdue: number; blocked: number; completedThisWeek: number };
  members: ScopeMemberRow[];
  teams: { id: string; name: string; division: TeamDivision; members: number; records: number; leads: number; onboarding: number; customers: number }[];
  recentActivity: DashboardActivity[];
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

export const PAYMENT_FILTERS = ['AWAITING', 'PART_PAID', 'OVERDUE', 'PAID'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const ONBOARDING_FILTERS = ['RETURNED', 'COLLECTING', 'WAITING_ON_CLIENT', 'READY_FOR_HANDOVER', 'GET_STARTED'] as const;
export type OnboardingFilter = (typeof ONBOARDING_FILTERS)[number];

export const PAYMENT_METHODS = ['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ONBOARDING_STAGES = ['SALES_CONSULTATION', 'COLLECT_REQUIREMENTS', 'SETUP', 'APPROVAL', 'HANDOVER', 'COMPLETED'] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export interface ServiceCatalogItem {
  code: string;
  name: string;
  category: string;
  /** What onboarding collects for this service (labels only, in checklist order). */
  requirements?: ServiceRequirement[];
}
export interface ServiceRequirement {
  label: string;
  kind: ChecklistKind;
  optional: boolean;
  /** Shown only after another answer (e.g. Meta Ads: only when creatives are required). */
  conditional: boolean;
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
  address: string | null;
  businessCategory: string | null;
  leadSource: string | null;
  notes: string | null;
  nextFollowUpAt: string | null;
  expectedBudget: number | null;
  dealAmount: number | null;
  /** Money recorded (pending + verified). */
  amountReceived: number;
  /** Money Accounts has verified. Only this counts as received. */
  amountVerified: number;
  paymentStatus: PaymentStatus;
  paymentWorkflow: PaymentWorkflow;
  paymentDueDate: string | null;
  services: string[];
  owner: ProfileSummary | null;
  /** Who added the lead (stays when the lead is reassigned). */
  createdBy: ProfileSummary | null;
  ownerId: string;
  teamId: string;
  departmentId: string;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
  onboarding: CustomerOnboarding | null;
}

/** Where a verified customer is in the hand-over: consultant → Department Head → Team Lead → Team Member. */
export const HANDOVER_STAGES = ['CONSULTANT', 'DEPARTMENT_HEAD', 'TEAM_LEAD', 'TEAM_MEMBER'] as const;
export type HandoverStage = (typeof HANDOVER_STAGES)[number];

export interface HandoverInfo {
  stage: HandoverStage;
  toDepartmentHeadAt: string | null;
  sentBy: string | null;
  teamLead: { id: string; fullName: string } | null;
  passedToTeamLeadAt: string | null;
  teamMember: { id: string; fullName: string } | null;
  assignedToMemberAt: string | null;
  note: string | null;
  /** The client's panel login (the password is never stored or returned). */
  clientAccount: { email: string; createdAt: string } | null;
}

/** One customer in the Accounts confirmation queue: business details and the amount to confirm. */
export interface AccountsConfirmation {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  segment: string;
  notes: string | null;
  department: string | null;
  salesperson: string | null;
  services: string[];
  dealAmount: number | null;
  amountReceived: number;
  balance: number;
  paymentMethod: string | null;
  paymentDueDate: string | null;
  sentAt: string;
  sentBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  note: string | null;
  sentToConsultantAt: string | null;
}

export interface CustomerOnboarding {
  stage: OnboardingStage;
  /** The Technical Consultant pressed "Send for onboarding" (before that the customer is in their Customers panel). */
  consultantStartedAt: string | null;
  /** Contract received (set by the Technical Consultant). */
  contractSigned: boolean;
  /** Add-on services: a catalog service (code) or one typed by hand. */
  addons: { code?: string; name: string }[];
  /** Yes / No: does the customer need add-on services? null = not answered yet. */
  addonsRequired: boolean | null;
  /** "Send to Add-ons" pressed: the customer is in the Add-ons Services section. */
  addonsSubmittedAt: string | null;
  addonsSubmittedBy: string | null;
  addonsSubmittedByName: string | null;
  /** Add-on document checklist progress (same states as the main checklist). */
  addonItemsTotal: number;
  addonItemsSaved: number;
  addonItemsVerified: number;
  addonItemsRejected: number;
  /** The latest add-on request's status (Draft -> Accounts verification -> invoice -> payment -> documents); null when none. */
  addonRequestStatus: AddonRequestStatus | null;
  /** Sales sent the customer to Accounts to confirm the amount. */
  sentToAccountsAt: string | null;
  /** Accounts confirmed the amount; the customer then goes to the Technical Consultant. */
  accountsConfirmedAt: string | null;
  paymentMethod: PaymentMethod | null;
  /** A part or full payment has been verified by Accounts. */
  paymentVerified: boolean;
  /** Documents verified + verified payment + through Accounts (calculated by the database). */
  getStarted: boolean;
  startedAt: string;
  targetHandoverDate: string | null;
  forwardedToSupportAt: string | null;
  /** Set when the Technical Consultant sent it back for re-verification. */
  returnedAt: string | null;
  returnNote: string | null;
  mandatorySaved: number;
  itemsTotal: number;
  itemsSaved: number;
  itemsVerified: number;
  itemsRejected: number;
  /** Items the Technical Consultant fills in (e.g. WABA ID). */
  consultantItemsTotal: number;
  consultantItemsDone: number;
  handoverStage: HandoverStage;
  teamLeadId: string | null;
  teamMemberId: string | null;
  toDepartmentHeadAt: string | null;
  passedToTeamLeadAt: string | null;
  assignedToMemberAt: string | null;
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
  /** Set for the PDF of an uploaded invoice. */
  invoiceId?: string | null;
}

export const CHECKLIST_KINDS = ['DETAILS', 'FILE', 'YES_NO', 'APPROVAL', 'ACCESS', 'AMOUNT', 'CHOICE'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export type ChecklistSection = 'BUSINESS_BASICS' | 'SERVICE' | 'MANDATORY_DOCUMENTS';
export type ChecklistEntryStatus = 'SAVED' | 'VERIFIED' | 'REJECTED';

/** One thing to collect during onboarding, with what was collected so far. */
export interface ChecklistItem {
  code: string;
  section: ChecklistSection;
  label: string;
  hint: string;
  kind: ChecklistKind;
  options: string[] | null;
  /** Who fills the item in: sales, or the Technical Consultant (e.g. WABA ID). */
  filledBy: 'SALES' | 'CONSULTANT';
  /** Optional items never block sending; they count once filled in. */
  optional: boolean;
  /** Service the item is listed under (first sold service that needs it). */
  serviceCode: string | null;
  services: string[];
  allowedMimeTypes: string[] | null;
  maxSizeBytes: number | null;
  entry: {
    status: ChecklistEntryStatus;
    value: string | null;
    documentId: string | null;
    savedBy: string | null;
    savedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  } | null;
}

export const REVIEW_FILTERS = ['TO_REVIEW', 'NEEDS_FIX', 'VERIFIED', 'AWAITING_DOCUMENTS', 'WAITING_ON_SALES'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];
/** `newCustomers`: customers still in the consultant's Customers panel (not yet sent for onboarding). */
export type ReviewCounts = Record<'all' | ReviewFilter | 'newCustomers' | 'addons', number>;

/** One consultation note written by the Technical Consultant. */
export interface ConsultantNote {
  id: string;
  body: string;
  serviceCode: string | null;
  author: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
  /** The caller wrote it and may still edit it. */
  canEdit: boolean;
}

export const AUTOMATIONS = ['EMAIL', 'WHATSAPP', 'AI_CALLING'] as const;
export type AutomationCode = (typeof AUTOMATIONS)[number];
export interface AutomationStatus {
  code: AutomationCode;
  /** A Google Sheet webhook is configured on the server. */
  connected: boolean;
  lastRun: { status: 'PENDING' | 'SENT' | 'FAILED'; triggeredAt: string; triggeredBy: string | null; detail: string | null } | null;
}

/** Onboarding emails / WhatsApp sent from the CRM (Wabastore, WhatsApp API + Blue Tick). */
export type ClientStage = 'WEBSITE_PENDING' | 'UNDER_REVIEW' | 'META_VERIFICATION' | 'COMPLETED';
/** The steps above plus the one-off "your mini website is ready" message. */
export type MessageStage = ClientStage | 'WEBSITE_READY';
export interface ClientMessage {
  id: string;
  channel: 'EMAIL' | 'WHATSAPP';
  stage: MessageStage;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  detail: string | null;
  attempts: number;
  recipient: string | null;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string;
}
export interface ClientMessages {
  /** Null: this customer is not automated, or has not reached the Technical Consultant yet. */
  stage: ClientStage | null;
  stageChangedAt: string | null;
  automated: boolean;
  /** off: nothing is processed; dry_run: prepared but not sent; live: sent. */
  mode: 'off' | 'dry_run' | 'live';
  testMode: boolean;
  /** Which senders are set up on the server (live mode only sends through these). */
  emailReady: boolean;
  whatsappReady: boolean;
  messages: ClientMessage[];
}

export interface PipelineCustomerDetail extends PipelineCustomer {
  documents: CustomerDocument[];
  documentTypes: DocumentType[];
  activities: CustomerActivity[];
  /** Conversations with the customer, newest first (the first one is the "Last conversation"). */
  conversations: Conversation[];
  checklist: ChecklistItem[];
  handover: HandoverInfo | null;
}

/** Leads tabs beyond the status ones: with Accounts for payment confirmation / returned by Accounts. */
export type LeadAccountsFilter = 'WITH_ACCOUNTS' | 'RETURNED';

/** One person of a sub-department with the leads they added / own (Super Admin Team Performance). */
export interface DivisionMemberStats {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: AccountStatus;
  teamId: string;
  teamName: string;
  leadsAdded: number;
  owned: number;
  leads: number;
  new: number;
  contacted: number;
  interested: number;
  readyToBuy: number;
  potential: number;
  onboarding: number;
  customers: number;
  followUpsOverdue: number;
  followUpsToday: number;
  noFollowUp: number;
  lastLeadAt: string | null;
}

export interface DivisionLeadsOverview {
  teamIds: string[];
  members: DivisionMemberStats[];
  totals: {
    members: number;
    leadsAdded: number;
    leads: number;
    potential: number;
    onboarding: number;
    customers: number;
    followUpsOverdue: number;
    followUpsToday: number;
    noFollowUp: number;
  };
  /** Same keys as PipelineCounts.leads, only for the sub-department's teams. */
  leads: PipelineCounts['leads'];
  /**
   * Same keys as PipelineCounts.potential / .onboarding and the part-payments count, only for the
   * sub-department's teams. Optional: a database that has not had the latest migration omits them.
   */
  potential?: PipelineCounts['potential'];
  onboarding?: PipelineCounts['onboarding'];
  partPayments?: number;
}

/** One person of a Support sub-department (Super Admin Team Performance). */
export interface DivisionSupportMember {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: AccountStatus;
  teamId: string;
  teamName: string;
  customersAdded: number;
  customersOwned: number;
  ticketsAssigned: number;
  ticketsOpen: number;
  ticketsInProgress: number;
  ticketsWaiting: number;
  ticketsEscalated: number;
  ticketsResolved: number;
  tasksPending: number;
  tasksDone: number;
  lastCustomerAt: string | null;
}

export interface DivisionSupportOverview {
  teamIds: string[];
  members: DivisionSupportMember[];
  totals: {
    members: number;
    customers: number;
    customersActive: number;
    tickets: number;
    open: number;
    inProgress: number;
    waiting: number;
    escalated: number;
    resolved: number;
    unassigned: number;
    tasksPending: number;
    tasksDone: number;
  };
}

export interface PipelineCounts {
  leads: Record<'all' | LeadStatus | LeadAccountsFilter, number>;
  potential: Record<'all' | PaymentFilter, number>;
  onboarding: Record<'all' | OnboardingFilter, number>;
  /** Customers with a verified part payment and a balance still to collect. */
  partPayments: number;
  mandatoryDocuments: number;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
export interface Conversation {
  id: string;
  note: string;
  /** LEAD_NOTE: the note typed when the lead was created. */
  source: 'MANUAL' | 'LEAD_NOTE';
  occurredAt: string;
  editedAt: string | null;
  author: { id: string; fullName: string } | null;
  canEdit: boolean;
}

// ---------------------------------------------------------------------------
// Payments (Sales → Accounts), kept separate from onboarding status
// ---------------------------------------------------------------------------
export const PAYMENT_STATUSES = ['NO_PAYMENT', 'PENDING_VERIFICATION', 'PARTIALLY_PAID', 'FULLY_PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_WORKFLOWS = ['NONE', 'PENDING_PAYMENT_CONFIRMATION', 'RETURNED_FROM_ACCOUNTS', 'PAYMENT_CONFIRMED'] as const;
export type PaymentWorkflow = (typeof PAYMENT_WORKFLOWS)[number];
export const PAYMENT_TYPES = ['PART', 'FULL'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type LedgerPaymentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVERSED';
export const FOLLOWUP_OUTCOMES = ['CONTACTED', 'AWAITING_PAYMENT', 'NO_RESPONSE', 'OTHER'] as const;
export type FollowUpOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export type FollowUpStatus = 'FOLLOW_UP_REQUIRED' | 'CONTACTED' | 'AWAITING_PAYMENT' | 'FULLY_PAID';

export interface LedgerPayment {
  id: string;
  type: PaymentType;
  /** What was received (the final amount: the amount before GST plus the GST). */
  amount: number;
  /** The GST split Accounts recorded; null when no GST was recorded (older payments, or an agreed amount that includes GST). */
  taxableAmount?: number | null;
  gstRate?: number | null;
  gstAmount?: number | null;
  method: PaymentMethod | null;
  reference: string | null;
  paidAt: string;
  status: LedgerPaymentStatus;
  /** ACCOUNTS: recorded by Accounts · SALES: recorded by Sales (pending until verified) · LEGACY: from before payments were tracked one by one. */
  source: 'ACCOUNTS' | 'SALES' | 'LEGACY';
  note: string | null;
  statusReason: string | null;
  recordedBy: string | null;
  recordedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface PaymentFollowUp {
  id: string;
  outcome: FollowUpOutcome;
  note: string;
  contactedAt: string;
  nextFollowUpAt: string | null;
  author: string | null;
}

export interface PaymentRequestSummary {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'RETURNED';
  agreedAmount: number;
  salesNote: string | null;
  requestedAt: string;
  requestedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

/** Everything about one customer's money. `followUps` is null unless the caller is in Accounts. */
export interface PaymentOverview {
  customerId: string;
  workflow: PaymentWorkflow;
  /** The total payable, GST included. */
  dealAmount: number | null;
  agreedAmount?: number | null;
  taxBasis?: AgreementTaxBasis;
  /** Whether Accounts may add GST to a payment (the agreed amount excludes GST), the GST recorded so far, and what is left before GST. */
  gst?: { allowed: boolean; onPayments: number; taxableBalance: number | null };
  order?: OrderSummary | null;
  recorded: number;
  verified: number;
  pending: number;
  balance: number;
  paymentStatus: PaymentStatus;
  accountsOwner: { id: string; fullName: string } | null;
  payments: LedgerPayment[];
  request: PaymentRequestSummary | null;
  followUps: PaymentFollowUp[] | null;
  isAccounts: boolean;
}

/** One Sales submission in the Accounts queue. */
export interface PaymentRequestItem {
  requestId: string;
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  notes: string | null;
  salesperson: string | null;
  services: string[];
  lastConversation: { note: string; at: string } | null;
  status: 'PENDING' | 'CONFIRMED' | 'RETURNED';
  agreedAmount: number;
  /** The total payable including GST (equal to agreedAmount unless the agreement excludes GST). */
  payableAmount?: number;
  taxBasis?: AgreementTaxBasis;
  salesNote: string | null;
  sentAt: string;
  sentBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  amountVerified: number;
  amountRecorded: number;
  balance: number;
  paymentStatus: PaymentStatus;
  stage: LifecycleStage;
  /** Who sent it: the Sales or the Support team (the person is `sentBy`). */
  sentFrom: 'SALES' | 'SUPPORT' | 'GENERAL' | null;
  /** The journey the services follow (see CustomerJourneyInfo). */
  journey: JourneyKind;
  clientLogin: ClientLoginStatus;
}

export interface AccountsPaymentCounts {
  requestsPending: number;
  onboardingPending: number;
  paymentsToVerify: number;
  partPaymentsActive: number;
  followUpsDue: number;
}

/** A customer with a verified part payment (Sales: Part payments · Accounts: pending-balance follow-ups). */
export interface PartPaymentItem {
  id: string;
  code: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  stage: LifecycleStage;
  onboarding: { stage: OnboardingStage; state: string; getStarted: boolean; paymentVerified: boolean } | null;
  services: string[];
  dealAmount: number | null;
  amountVerified: number;
  pendingAmount: number;
  balance: number;
  paymentStatus: PaymentStatus;
  lastPaymentAt: string | null;
  lastPaymentAmount: number | null;
  verifiedPayments: number;
  verifiedBy: string | null;
  salesperson: { id: string; fullName: string } | null;
  accountsOwner: { id: string; fullName: string } | null;
  /** Accounts only. */
  followUp: { status: FollowUpStatus; lastAt: string | null; nextAt: string | null; count: number } | null;
}

export type PartPaymentStatusFilter = 'PARTIAL' | 'PAID' | 'RETURNED' | 'ALL';

/** A page of part-payment customers plus the people available in the Salesperson / Accountant filters. */
export interface PartPaymentsPage extends Paginated<PartPaymentItem> {
  salespeople: { id: string; fullName: string }[];
  accountants: { id: string; fullName: string }[];
}

/** What is still missing before a customer can enter Get Started (calculated by the database; shown by the UI). */
export function getStartedBlockers(o: Pick<CustomerOnboarding, 'itemsTotal' | 'itemsSaved' | 'itemsVerified' | 'paymentVerified' | 'accountsConfirmedAt' | 'returnedAt'>): (
  | 'DOCUMENTS_MISSING'
  | 'DOCUMENTS_UNVERIFIED'
  | 'PAYMENT_UNVERIFIED'
  | 'WITH_CONSULTANT_FIX'
)[] {
  const out: ReturnType<typeof getStartedBlockers> = [];
  if (o.itemsSaved < o.itemsTotal) out.push('DOCUMENTS_MISSING');
  else if (o.itemsVerified < o.itemsTotal) out.push('DOCUMENTS_UNVERIFIED');
  if (!o.paymentVerified || !o.accountsConfirmedAt) out.push('PAYMENT_UNVERIFIED');
  if (o.returnedAt) out.push('WITH_CONSULTANT_FIX');
  return out;
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
  /** Where the file is going. R2 = Cloudflare R2 (presigned PUT in `upload`), SUPABASE = Supabase Storage (`token`). */
  provider: 'R2' | 'SUPABASE';
  /** Supabase Storage signed-upload token (empty for R2). */
  token: string;
  /** R2: PUT the file body to `upload.url` with `upload.headers`. */
  upload?: { url: string; headers: Record<string, string> };
}

export interface DocumentUrl {
  url: string;
  expiresInSeconds: number;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Accounts finance (real records only: verified payments and department_expenses)
// ---------------------------------------------------------------------------
export interface FinanceSummary {
  income: number;
  incomeCount: number;
  expenses: number;
  expensesPaid: number;
  expensesPending: number;
  expenseCount: number;
  /** income - expenses */
  net: number;
}

/** One department's earnings and expenses (Account Dashboard, Department Income). */
export interface DepartmentFinance {
  departmentId: string;
  name: string;
  slug: string;
  income: number;
  incomeCount: number;
  expenses: number;
  expenseCount: number;
  expensesPending: number;
}

export interface IncomeRow {
  id: string;
  paidAt: string;
  amount: number;
  type: PaymentType;
  method: PaymentMethod | null;
  reference: string | null;
  customerId: string;
  customerCode: string;
  customer: string;
  contact: string;
  departmentId: string | null;
  department: string | null;
  verifiedBy: string | null;
}
export interface IncomePage extends Paginated<IncomeRow> {
  /** Total of every verified payment matching the filters (not only this page). */
  sum: number;
}

export type ExpenseStatus = 'PAID' | 'PENDING';
export type ExpenseSource = 'MANUAL' | 'GOOGLE_SHEET' | 'IMPORT';
export interface ExpenseRow {
  id: string;
  date: string;
  description: string;
  /** null = company-wide */
  departmentId: string | null;
  department: string | null;
  category: string;
  amount: number;
  status: ExpenseStatus;
  notes: string | null;
  source: ExpenseSource;
  createdBy: string | null;
  canChange: boolean;
}
export interface ExpensesPage extends Paginated<ExpenseRow> {
  sum: number;
  pending: number;
  categories: string[];
}

export interface FinanceTrend {
  months: { month: string; income: number; expenses: number; net: number }[];
  expenseCategories: { category: string; amount: number }[];
  firstRecordAt: string | null;
}

// ---------------------------------------------------------------------------
// Add-on requests (Technical Consultant -> Accounts verification) and invoices (Accounts only)
// ---------------------------------------------------------------------------
export const ADDON_REQUEST_STATUSES = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'INVOICE_GENERATED',
  'PAYMENT_CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED'
] as const;
export type AddonRequestStatus = (typeof ADDON_REQUEST_STATUSES)[number];

/** One priced line: a catalogue service (serviceCode) or one typed by hand. Totals are computed by the database. */
export interface PricedLine {
  id?: string;
  serviceCode?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxPercent: number;
  tax?: number;
  lineTotal?: number;
}

/** MANUAL: older invoices; SERVICE / ADDON: issued by Accounts; UPLOADED: an existing invoice PDF uploaded by Accounts. */
export type InvoiceKind = 'MANUAL' | 'SERVICE' | 'ADDON' | 'UPLOADED' | 'GENERATED';

/** The one limit for an uploaded invoice PDF (the database and the storage bucket enforce the same). */
export const INVOICE_PDF_MAX_BYTES = 512000;
export const INVOICE_PDF_MAX_LABEL = '500 KB';
/** Customer documents (KYC, logos, photos, scripts, lists...): at most 2 MB each. Invoice PDFs keep their own, smaller limit. */
export const CUSTOMER_DOCUMENT_MAX_BYTES = 2097152;
export const CUSTOMER_DOCUMENT_MAX_LABEL = '2 MB';

export interface InvoiceFileVersion {
  documentId: string;
  fileName: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  version: number;
}
/** The current PDF of an uploaded invoice. Older versions are listed for Accounts only. */
export interface InvoiceFile extends InvoiceFileVersion {
  mimeType: string;
  versionCount: number;
  versions: InvoiceFileVersion[];
}
export interface Invoice {
  id: string;
  number: string;
  kind: InvoiceKind;
  customerId: string | null;
  customer: string;
  contact: string;
  customerCode: string | null;
  department: string | null;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: number | null;
  discount: number;
  tax: number;
  /** Null for an uploaded invoice whose total was not entered. */
  total: number | null;
  status: 'Paid' | 'Pending' | 'Overdue';
  paidAt: string | null;
  items: PricedLine[];
  note: string | null;
  /** Payment, order or service reference entered with an uploaded invoice. */
  reference: string | null;
  file: InvoiceFile | null;
  /** Only for a generated invoice (kind GENERATED): the issued snapshot and the state of its two documents. */
  generated?: GeneratedInvoice | null;
  addonRequestId: string | null;
  issuedBy: string | null;
  issuedAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Generated invoices (Accounts invoice builder): issue -> unpaid PDF + e-mail -> confirm payment -> paid PDF + e-mail
// ---------------------------------------------------------------------------
/** Hard limit for every generated PDF: strictly smaller than this many bytes. */
export const INVOICE_GENERATED_PDF_LIMIT_BYTES = 500000;
export const INVOICE_PURPOSES = ['SERVICES', 'ADDON', 'ADDITIONAL'] as const;
export type InvoicePurpose = (typeof INVOICE_PURPOSES)[number];
export const INVOICE_STAGES = ['UNPAID', 'PAID'] as const;
export type InvoiceStage = (typeof INVOICE_STAGES)[number];
export const TAX_TREATMENTS = ['INTRA_STATE', 'INTER_STATE'] as const;
export type TaxTreatmentName = (typeof TAX_TREATMENTS)[number];
export type InvoicePdfStatus = 'NOT_DUE' | 'PENDING' | 'STORED' | 'FAILED';
export type InvoiceEmailStatus = 'NOT_DUE' | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'NOT_SENT';

export interface GeneratedInvoiceLine {
  position: number;
  serviceCode: string | null;
  particulars: string;
  hsnSac: string;
  taxRate: number;
  /** Text, so values such as "1 Year", "30K Msg" and "1 Nos" are kept as typed. */
  quantity: string;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
}
export interface GeneratedTaxGroup {
  rate: number;
  base: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
}
export interface GeneratedInvoiceCustomer {
  name: string;
  businessName: string | null;
  address: string;
  contactPerson: string | null;
  contactNumber: string | null;
  gstin: string | null;
  state: string;
  stateCode: string;
}
export interface GeneratedInvoiceTotals {
  subtotal: number;
  cgstRate: number | null;
  cgstAmount: number;
  sgstRate: number | null;
  sgstAmount: number;
  igstRate: number | null;
  igstAmount: number;
  totalGst: number;
  total: number;
  inWords: string;
  breakdown: GeneratedTaxGroup[];
}
/** What happened to one document (the unpaid or the paid invoice) and to its e-mail. Never carries a storage reference. */
export interface GeneratedInvoiceStageState {
  pdfStatus: InvoicePdfStatus;
  pdfError: string | null;
  sizeBytes: number | null;
  storedAt: string | null;
  emailStatus: InvoiceEmailStatus;
  emailTo: string | null;
  emailSentAt: string | null;
  emailError: string | null;
  emailAttempts: number;
  /** Another run is working on this stage right now. */
  busy: boolean;
}
export type InvoicePaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID';
/** Whether the amount Sales agreed already has GST in it (INCLUSIVE) or GST is added on top of it (EXCLUSIVE). */
export type AgreementTaxBasis = 'INCLUSIVE' | 'EXCLUSIVE';
/**
 * The whole agreed order in one place, worked out by the database: what was agreed, the GST, what is payable, what is confirmed and
 * what is left. Every screen, the PDF and the e-mail read these same figures; none of them works the balance out itself.
 */
export interface OrderSummary {
  basis: AgreementTaxBasis;
  /** What Sales agreed, as agreed (before GST when the basis is EXCLUSIVE). */
  agreedAmount: number | null;
  /** The agreed amount before GST (null when the agreement is GST inclusive and no split is known). */
  taxableTotal: number | null;
  gstTotal: number | null;
  /** The total the customer pays, GST included. */
  totalPayable: number;
  /** Verified payments only: pending and rejected payments are never counted. */
  confirmed: number;
  pending: number;
  /** totalPayable - confirmed: what the customer still owes for the whole order. */
  balance: number;
  state: InvoicePaymentState;
  invoicedTaxable: number;
  invoicedGst: number;
  invoicedTotal: number;
  /** Always false now: no GST is estimated for the part not invoiced yet (Accounts decides it when it makes the invoice). */
  estimated: boolean;
}
export interface InvoicePaymentSummary {
  total: number;
  /** Confirmed (verified) payments applied to this invoice. Pending or rejected payments are never counted. */
  confirmed: number;
  balance: number;
  state: InvoicePaymentState;
  /** Recorded but not yet verified: shown apart, not counted. */
  pending: number;
  /** Where this invoice's payments are recorded: the customer's payment ledger, the add-on's payments, or the invoice itself. */
  ledger: 'CUSTOMER' | 'ADDON' | 'INVOICE';
  payments: { amount: number; method: PaymentMethod | null; reference: string | null; paidAt: string }[];
  /** The whole order this invoice belongs to (agreed services only); null for an additional invoice or an add-on. */
  order?: OrderSummary | null;
}

export interface GeneratedInvoice {
  number: string;
  invoiceDate: string;
  orderNumber: string;
  purpose: InvoicePurpose;
  addonRequestId: string | null;
  customer: GeneratedInvoiceCustomer;
  taxTreatment: TaxTreatmentName;
  taxTreatmentOverridden: boolean;
  taxOverrideReason: string | null;
  reverseCharge: boolean;
  terms: string;
  lines: GeneratedInvoiceLine[];
  totals: GeneratedInvoiceTotals;
  lifecycle: 'ISSUED' | 'PAID';
  /** True for an invoice made under the paid-only rule: no unpaid PDF is ever created or e-mailed, only the paid invoice. */
  paidOnly?: boolean;
  /** Total - confirmed payments applied to this invoice. Worked out by the database from the payment records, never typed or sent by the browser. */
  paymentSummary: InvoicePaymentSummary | null;
  payment: { confirmedAt: string; confirmedBy: string | null; method: PaymentMethod | null; reference: string | null; note: string | null; paidOn: string | null } | null;
  unpaid: GeneratedInvoiceStageState;
  paid: GeneratedInvoiceStageState;
}

export type InvoiceFieldSource = 'ONBOARDING' | 'CUSTOMER' | 'ADDRESS' | 'GSTIN' | 'PREVIOUS_INVOICE' | 'NONE';
/** The customer's details and the purchase's billable services, ready for the builder. Every value stays editable. */
export interface InvoicePrefill {
  customerId: string;
  customerCode: string | null;
  purpose: InvoicePurpose;
  addonRequestId: string | null;
  customer: { name: string | null; businessName: string | null; address: string | null; contactPerson: string | null; contactNumber: string | null; gstin: string | null; stateCode: string | null; state: string | null };
  sources: { businessName: InvoiceFieldSource; address: InvoiceFieldSource; contactPerson: InvoiceFieldSource; contactNumber: InvoiceFieldSource; gstin: InvoiceFieldSource; state: InvoiceFieldSource };
  recipientEmail: string | null;
  taxTreatment: TaxTreatmentName | null;
  company: { name: string; stateCode: string; gstin: string };
  suggestedInvoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  terms: string;
  lines: { serviceCode: string | null; particulars: string; hsnSac: string; taxRate: number | null; quantity: string; baseAmount: number | null }[];
  /** What Sales agreed for all the original services together (a reference only: the price per service is not recorded). */
  dealAmount: number | null;
  /** What the invoices already issued for the agreed services come to (each part payment can have its own invoice). */
  servicesInvoiced: number;
  /** The same, before GST: what an agreement made excluding GST is checked against. */
  servicesInvoicedTaxable?: number;
  /** What Sales agreed (before GST when the basis is EXCLUSIVE) and whether it includes GST. */
  agreedAmount?: number | null;
  agreedTaxBasis?: AgreementTaxBasis;
  order?: OrderSummary | null;
  addonTotal: number | null;
  existingInvoices: { id: string; number: string; kind: InvoiceKind; status: string; total: number | null }[];
  catalog: { code: string; name: string; category: string }[];
  warnings: string[];
}

/** An older agreement (no recorded GST basis) that already has invoices: Accounts confirms each one. */
export interface AgreementReviewItem {
  customerId: string;
  customerCode: string | null;
  customer: string;
  totalPayableOnRecord: number;
  invoicedTaxable: number;
  invoicedTotal: number;
  invoices: number;
  confirmedPayments: number;
  note: string;
}

export type InvoiceStepName = 'ISSUE' | 'PAYMENT' | 'PDF' | 'EMAIL';
export interface InvoiceStep {
  step: InvoiceStepName;
  stage: InvoiceStage | null;
  /** DONE: it worked (or was already done). FAILED: retry with "deliver". NOT_SENT: nothing was sent (dry run, no address). BUSY: another run is on it. */
  status: 'DONE' | 'FAILED' | 'NOT_SENT' | 'BUSY';
  message: string | null;
}
/** The result of issuing an invoice, confirming a payment or retrying a stage: the invoice as it stands now and what each step did. */
export interface InvoiceRunResult {
  invoice: Invoice;
  steps: InvoiceStep[];
}
export interface InvoicePage extends Paginated<Invoice> {
  sum?: number;
  paid?: number;
}

export interface AddonPayment {
  id: string;
  amount: number;
  method: PaymentMethod | null;
  reference: string | null;
  paidAt: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  note: string | null;
  reason: string | null;
  recordedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface AddonRequest {
  id: string;
  customerId: string;
  status: AddonRequestStatus;
  version: number;
  notes: string | null;
  customer: string;
  contact: string;
  customerCode: string | null;
  phone: string | null;
  department: string | null;
  consultant: { id: string; fullName: string } | null;
  salesperson: string | null;
  originalServices: string[];
  originalAmount: number | null;
  onboardingReference: string | null;
  onboardingStartedAt: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: PricedLine[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  invoice: Invoice | null;
  payments: AddonPayment[] | null;
  paid: number;
  pendingPayments: number;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: { total: number; saved: number; verified: number; rejected: number } | null;
  events: { action: string; note: string | null; at: string; by: string | null }[] | null;
  /** The caller may still change it (draft, or Accounts asked for changes). */
  canEdit?: boolean;
}
export interface AddonRequestPage extends Paginated<AddonRequest> {
  counts: Partial<Record<AddonRequestStatus, number>>;
  consultants: { id: string; fullName: string }[];
}

export interface InvoiceCustomer {
  id: string;
  name: string;
  company: string | null;
  customerCode: string | null;
  department: string | null;
  stage: LifecycleStage;
  dealAmount: number | null;
  amountVerified: number;
  services: { code: string; name: string }[];
  hasServiceInvoice: boolean;
}

// ---------------------------------------------------------------------------
// Client dashboard (the customer's own dashboard)
// ---------------------------------------------------------------------------
export interface ClientProfile {
  customerId: string;
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  segment: string;
  status: string;
  department: string | null;
  loginEmail: string;
  clientSince: string;
}
export type ClientServiceStatus = 'LIVE' | 'SETTING_UP' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
export interface ClientService {
  code: string;
  name: string;
  category: string;
  description: string | null;
  purchasedAt: string;
  activatedAt: string | null;
  renewsOn: string | null;
  status: ClientServiceStatus;
  plan: string | null;
  /** What the team set up for this service (e.g. WhatsApp API: campaigns sent, message package bought / sent). */
  details?: Record<string, unknown> | null;
  /** The plan bought (from the team's Excel import or entered by the team). */
  planName?: string | null;
  price?: number | null;
  billingCycle?: string | null;
  platform?: string | null;
  panelAccount?: string | null;
  /** The latest package usage (WhatsApp messages, AI Calling minutes, RCS / Voice messages). */
  usage?: ClientServiceUsage | null;
  /** Monthly deliverables, newest month first (at most 6). */
  monthly?: { month: string; metrics: Record<string, unknown> }[];
  campaignCount?: number;
}
export interface ClientServiceUsage {
  kind: 'WHATSAPP' | 'AI_CALLING' | 'RCS' | 'VOICE';
  metrics: Record<string, unknown>;
  asOf: string | null;
  validUntil: string | null;
}
export interface ClientCampaign {
  id: string;
  serviceCode: string;
  serviceName: string;
  name: string;
  template: string | null;
  sentOn: string | null;
  audienceType: string | null;
  audienceSize: number | null;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  replied: number | null;
  failed: number | null;
  status: string | null;
}

/** Excel import of existing customers (Support). */
export interface CustomerDataImportError {
  sheet: string;
  row: number;
  message: string;
}
export interface CustomerDataImportLogin {
  customerId: string;
  email: string;
  name: string;
  businessName?: string;
  /** CREATED: the login exists; FAILED: see detail. */
  login: 'CREATED' | 'FAILED';
  /** SENT: the client's e-mail went out (their sign-in details when the team chose the password, else the "Set your password" link); NOT_SENT: see detail. */
  mail: 'SENT' | 'NOT_SENT';
  /** TEAM: the password came from the file (hashed by Supabase Auth, e-mailed to the client once, never kept by the CRM); CLIENT: the client sets their own from the e-mail. */
  passwordBy?: 'TEAM' | 'CLIENT';
  detail?: string;
}
export interface CustomerDataImportResult {
  committed: boolean;
  errors: CustomerDataImportError[];
  summary: { added: number; updated: number; services: number; usage: number; campaigns: number; logins: number };
  logins: CustomerDataImportLogin[];
  /** Login e-mails whose "Client Password" in the file was not used because the customer already had a login. */
  passwordsNotUsed?: string[];
}
export type ServiceRequestStatus = 'REQUESTED' | 'IN_REVIEW' | 'IN_ADDON_WORKFLOW' | 'ACTIVATED' | 'REJECTED' | 'CANCELLED';
export interface ClientCatalogService {
  code: string;
  name: string;
  category: string;
  description: string | null;
  startingPrice: number | null;
  priceNote: string | null;
  features: string[];
  owned: boolean;
  request: { id: string; status: ServiceRequestStatus; createdAt: string; decisionNote: string | null } | null;
}
export interface ClientServiceRequest {
  id: string;
  serviceCode: string;
  serviceName: string;
  status: ServiceRequestStatus;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MonthlyPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  features: string[];
  services: { code: string; name: string }[];
}
export interface ClientPlans {
  current: (MonthlyPlan & { customerPlanId: string; startedAt: string; renewsOn: string | null; status: string; paymentStatus: 'PENDING' | 'PAID'; price: number }) | null;
  options: MonthlyPlan[];
  history: { name: string; startedAt: string; endedAt: string | null; status: string; price: number }[];
  request: { id: string; planId: string; planName: string; kind: 'SELECT' | 'UPGRADE' | 'SWITCH'; status: 'REQUESTED' | 'APPROVED'; createdAt: string; decisionNote: string | null } | null;
}
export interface ClientInvoice {
  id: string;
  number: string;
  kind: string;
  issuedAt: string;
  issueDate: string | null;
  dueDate: string | null;
  amount: number | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  status: 'Paid' | 'Pending';
  paidAt: string | null;
  overdue: boolean;
  related: string;
  items: { name?: string; quantity?: number | string; unitPrice?: number; lineTotal?: number; tax?: number; taxPercent?: number }[];
  hasFile: boolean;
  /** A generated invoice: the paid file is offered only once it is stored; before payment the unpaid file is. */
  generated?: boolean;
  fileKind?: 'PAID' | 'UNPAID' | null;
  /** Paid, but the paid invoice is still being prepared. */
  paidFilePending?: boolean;
  paymentConfirmedAt?: string | null;
  taxSummary?: { cgst: number; sgst: number; igst: number } | null;
  paymentSummary?: InvoicePaymentSummary | null;
}
export type ClientTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export interface ClientTicket {
  id: string;
  ticketNo: string;
  subject: string;
  description: string | null;
  category: string;
  priority: string;
  status: ClientTicketStatus;
  serviceCode: string | null;
  serviceName: string | null;
  resolution: string | null;
  /** The customer's Relationship Manager (the Team Member the ticket is assigned to). */
  relationshipManager: string | null;
  /** True once the ticket was escalated to a Team Lead / Department Head. */
  escalated: boolean;
  handledBy: 'RELATIONSHIP_MANAGER' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD';
  /** Replies and updates the client has not opened yet. */
  unread: number;
  lastReplyAt: string | null;
  /** The latest message of the conversation (internal staff notes are never part of it). */
  lastMessage: { text: string; from: 'CLIENT' | 'STAFF'; at: string } | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}
/** One entry of a ticket conversation: a message, or a system event shown on the timeline. */
export interface ClientTicketMessage {
  id: string;
  at: string;
  kind: 'MESSAGE' | 'EVENT';
  /** MESSAGE: who wrote it. */
  from?: 'CLIENT' | 'STAFF';
  text?: string | null;
  /** Staff name (MESSAGE from STAFF), or the person an event names (ASSIGNED). */
  author?: string | null;
  /** Relationship Manager / Team Lead / Department Head / Support. */
  role?: string | null;
  /** The client's own messages: read by Support. */
  seen?: boolean;
  clientMsgId?: string | null;
  event?: 'CREATED' | 'ASSIGNED' | 'ESCALATED' | 'STATUS' | 'REOPENED' | 'RESOLVED' | 'CLOSED';
  status?: ClientTicketStatus | null;
}
export interface ClientTicketDetail extends ClientTicket {
  messages: ClientTicketMessage[];
  staffReadAt: string | null;
  /** Older shape, kept for compatibility. */
  updates: { id: string; at: string; type: 'CLIENT' | 'SUPPORT' | 'STATUS'; status: ClientTicketStatus | null; message: string | null; author?: string | null }[];
}
export interface ClientNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: 'invoice' | 'service' | 'plan' | 'ticket' | 'service_request' | 'plan_request' | 'addon' | 'announcement' | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}
/** A notice for the client: an "office closed" day or a new service (what the signed-in client sees right now). */
export interface ClientAnnouncement {
  id: string;
  kind: 'OFFICE_CLOSED' | 'NEW_SERVICE';
  title: string;
  body: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  serviceDescription: string | null;
  /** The day the office is closed (the next one, for a repeating closure). */
  eventDate: string | null;
  eventEnd: string | null;
  daysAway: number | null;
  recurrence: 'NONE' | 'MONTHLY';
  /** Identifies this occurrence, so dismissing one month's notice does not hide next month's. */
  occurrence: string;
  createdAt: string;
}

export interface ClientNotifications {
  unread: number;
  total: number;
  items: ClientNotification[];
}
export interface ClientOverview {
  profile: ClientProfile;
  services: { total: number; live: number; items: ClientService[] };
  plan: ClientPlans['current'];
  invoices: { total: number; pending: number; recent: ClientInvoice[] };
  tickets: { total: number; open: number; recent: ClientTicket[] };
  notifications: { unread: number; recent: ClientNotification[] };
  renewals: { kind: 'SERVICE' | 'PLAN'; name: string; renewsOn: string }[];
}
// ---- Client calendar (what the team did, with insights) and documents the client provides ----
export const CLIENT_ACTIVITY_KINDS = ['CAMPAIGN', 'CALL_CAMPAIGN', 'POST', 'AD', 'SETUP', 'REPORT', 'MEETING', 'OTHER'] as const;
export type ClientActivityKind = (typeof CLIENT_ACTIVITY_KINDS)[number];
export interface ClientMetric {
  label: string;
  value: string;
}
/** One thing on the client's calendar: logged by the team (ACTIVITY) or recorded by the system. */
export interface ClientCalendarEvent {
  id: string;
  source: 'ACTIVITY' | 'SERVICE' | 'INVOICE' | 'TICKET' | 'DOCUMENT';
  /** ACTIVITY: a ClientActivityKind; others: SERVICE_STARTED, SERVICE_ACTIVATED, SERVICE_RENEWAL, INVOICE_ISSUED, INVOICE_PAID, TICKET_RAISED, TICKET_RESOLVED, DOCUMENT_VERIFIED. */
  kind: string;
  /** YYYY-MM-DD (office time). */
  date: string;
  title: string;
  summary?: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  metrics: ClientMetric[];
  createdBy?: string | null;
}
/** Staff side: an activity the team logged for a client. */
export interface ClientActivityList {
  hasClientLogin: boolean;
  services: { code: string; name: string }[];
  events: ClientCalendarEvent[];
}
export interface ClientActivityInput {
  serviceCode: string | null;
  date: string;
  kind: ClientActivityKind;
  title: string;
  summary: string | null;
  metrics: ClientMetric[];
}
export type ClientDocumentStatus = 'MISSING' | 'SAVED' | 'VERIFIED' | 'REJECTED';
export interface ClientDocumentItem {
  code: string;
  label: string;
  hint: string;
  kind: 'FILE' | 'DETAILS' | 'CHOICE';
  options: string[] | null;
  optional: boolean;
  section: 'BUSINESS_BASICS' | 'SERVICE' | 'MANDATORY_DOCUMENTS';
  sortOrder: number;
  services: { code: string; name: string }[];
  status: ClientDocumentStatus;
  /** FILE: the file name; DETAILS / CHOICE: what was typed. */
  value: string | null;
  documentId: string | null;
  savedAt: string | null;
  byClient: boolean;
  reviewedAt: string | null;
  /** Why the team sent it back (only while REJECTED). */
  reviewNote: string | null;
  /** False once the team verified it. */
  canEdit: boolean;
  allowedMimeTypes: string[] | null;
  maxSizeBytes: number | null;
}
export interface ClientDocuments {
  items: ClientDocumentItem[];
  summary: { total: number; provided: number; verified: number; needed: number };
}
/** Support / Technical Consultant: one thing a client provided, waiting to be verified (or already reviewed). */
export interface ClientDocumentQueueItem {
  customerId: string;
  customer: string;
  contact: string;
  itemCode: string;
  label: string;
  kind: 'FILE' | 'DETAILS' | 'CHOICE';
  status: 'SAVED' | 'VERIFIED' | 'REJECTED';
  value: string | null;
  documentId: string | null;
  fileName: string | null;
  savedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  services: string[];
}
export interface ClientDocumentUrl {
  url: string;
  expiresInSeconds: number;
  fileName: string;
}
/** Technical Consultant / Accounts sides of the client workflows. */
export interface ConsultantServiceRequest {
  id: string;
  serviceCode: string;
  serviceName: string;
  status: ServiceRequestStatus;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  addonRequestId: string | null;
}
export interface ConsultantOpenServiceRequest {
  id: string;
  customerId: string;
  customer: string;
  contact: string;
  serviceCode: string;
  serviceName: string;
  status: ServiceRequestStatus;
  note: string | null;
  createdAt: string;
}
export interface AccountsPlanRequest {
  id: string;
  customerId: string;
  customer: string;
  planId: string;
  planName: string;
  monthlyPrice: number;
  kind: 'SELECT' | 'UPGRADE' | 'SWITCH';
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ACTIVATED' | 'CANCELLED';
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  currentPlan: string | null;
}
export interface AccountsPlans {
  plans: (MonthlyPlan & { isActive: boolean })[];
  requests: AccountsPlanRequest[];
}

// ---------------------------------------------------------------------------
// HR: attendance, personal details, leave
// ---------------------------------------------------------------------------
export interface AttendanceRow {
  id: string;
  profileId: string;
  name: string;
  email: string;
  role: Role;
  designation: string | null;
  departmentName: string | null;
  /** ISO time of the first CRM (RM system) login of the day. */
  rmLoginAt: string | null;
  /** ISO time of the first biometric punch of the day. */
  biometricLoginAt: string | null;
  /** Whole minutes between the two, null while either is missing. */
  diffMinutes: number | null;
  /** More than 15 minutes apart. */
  discrepancy: boolean;
}
export interface AttendanceDay {
  date: string;
  rows: AttendanceRow[];
}
export interface PersonalDetails {
  profileId: string;
  designation: string | null;
  joiningDate: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  emergencyContact: string | null;
}
export type LeaveStatus = 'PENDING_DEPARTMENT_HEAD' | 'PENDING_HR' | 'APPROVED' | 'REJECTED_BY_DEPARTMENT_HEAD' | 'REJECTED_BY_HR';
export interface LeaveDecision {
  name: string | null;
  at: string;
  note: string | null;
}
export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  leaveType: 'FULL_DAY' | 'HALF_DAY';
  startDate: string;
  endDate: string;
  halfDayShift: 'MORNING' | 'AFTERNOON' | null;
  /** Working days (Sundays excluded); 0.5 for a half day. */
  days: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  departmentHead: LeaveDecision | null;
  hr: LeaveDecision | null;
}
export interface LeaveReview {
  awaiting: LeaveRequest[];
  decided: LeaveRequest[];
  canReviewAsDepartmentHead: boolean;
  canReviewAsHr: boolean;
}
export interface LeaveMonthEmployee {
  profileId: string;
  halfDays: number;
  leaveDays: number;
  records: { id: string; leaveType: 'FULL_DAY' | 'HALF_DAY'; startDate: string; endDate: string; halfDayShift: string | null; reason: string }[];
}
export interface LeaveMonthlySummary {
  month: string;
  employees: LeaveMonthEmployee[];
}


// ---------------------------------------------------------------------------
// Service journeys, client-login provisioning and delivery departments
// ---------------------------------------------------------------------------
/** TECHNICAL: every service needs the Technical Consultant. DIRECT: none does. MIXED: some do (the customer follows the Technical Consultant journey). NONE: no service yet. */
export type JourneyKind = 'TECHNICAL' | 'DIRECT' | 'MIXED' | 'NONE';
export type ClientLoginStatus = 'NOT_STARTED' | 'PENDING' | 'CREATED' | 'FAILED';
/** Where a customer is, for display. Payment, login, documents and delivery stay separate facts (below); this is only the label. */
export type JourneyStep =
  | 'LEAD' | 'PENDING_PAYMENT' | 'PAYMENT_PARTIAL' | 'PAYMENT_CONFIRMED' | 'LOGIN_PENDING' | 'LOGIN_FAILED' | 'LOGIN_CREATED'
  | 'RETURNED_TO_SALES' | 'DOCUMENTS_PENDING' | 'DOCUMENTS_VERIFIED' | 'PARTLY_SENT_TO_DELIVERY' | 'SENT_TO_DELIVERY'
  | 'TECHNICAL_CONSULTANT' | 'CUSTOMER' | 'LOST';

export interface ServiceJourneySetting {
  code: string;
  name: string;
  category: string;
  isActive: boolean;
  requiresTechnicalConsultant: boolean;
  deliveryDepartmentId: string | null;
  deliveryDepartment: string | null;
}

export interface CustomerJourneyInfo {
  customerId: string;
  journey: JourneyKind;
  followsTechnicalConsultant: boolean;
  step: JourneyStep;
  lifecycleStage: LifecycleStage;
  services: {
    code: string;
    name: string;
    category: string;
    requiresTechnicalConsultant: boolean;
    deliveryDepartment: { id: string; name: string } | null;
    sentToDeliveryAt: string | null;
    sentToDeliveryBy: string | null;
  }[];
  referrer: { id: string; name: string; division: 'SALES' | 'SUPPORT' | 'GENERAL' | null; department: string | null } | null;
  payment: { workflow: string; dealAmount: number | null; verified: number; balance: number; status: PaymentStatus };
  clientLogin: { status: ClientLoginStatus; email: string | null; attempts: number; lastError: string | null; updatedAt: string | null; createdAt: string | null; createdBy: string | null };
  documents: { total: number; saved: number; verified: number; rejected: number };
  delivery: { sent: number; total: number; unsentDirect: number; allSent: boolean };
  /** What the signed-in person may do now (the server decides; the screen only offers these). */
  can: { createLogin: boolean; returnToSales: boolean; verifyDocuments: boolean; sendToDelivery: boolean };
}

export interface DeliveryQueueItem {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  address: string | null;
  referredBy: string | null;
  referredFrom: 'SALES' | 'SUPPORT' | 'GENERAL' | null;
  services: { code: string; name: string; sentAt: string; sentBy: string | null; note: string | null; department: string | null }[];
  dealAmount: number | null;
  amountVerified: number;
  balance: number;
  paymentStatus: PaymentStatus;
  clientLogin: boolean;
}


// ---------------------------------------------------------------------------
// Business reports (Accounts / Super Admin): Sales and Support business, from the real payment records
// (migration 20261104000100_business_attribution_reports.sql). Amounts are rupees (GST included, as invoiced).
// ---------------------------------------------------------------------------
export const BUSINESS_DIVISIONS = ['SALES', 'SUPPORT'] as const;
export type BusinessDivision = (typeof BUSINESS_DIVISIONS)[number];
/** UNCLASSIFIED: an additional invoice Accounts has not yet said is a renewal or an add-on; it is credited to neither department. */
export const BUSINESS_TX_TYPES = ['INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED'] as const;
export type BusinessTxType = (typeof BUSINESS_TX_TYPES)[number];
export const BUSINESS_PAY_STATUSES = ['COLLECTED', 'PENDING', 'REFUNDED'] as const;
export type BusinessPayStatus = (typeof BUSINESS_PAY_STATUSES)[number];

export interface BusinessFigures {
  /** Verified payments (money received). */
  collected: number;
  /** Recorded but not yet verified by Accounts. */
  pending: number;
  /** Payments that were reversed. */
  refunded: number;
  /** Number of collected payments. */
  transactions: number;
  customers: number;
  /** Agreed / invoiced amount of the orders in the range. */
  billed: number;
  /** billed - collected for those orders, as of now (never below zero). */
  outstanding: number;
}
export interface BusinessByType extends BusinessFigures {
  type: BusinessTxType;
}
export interface BusinessEmployeeRow extends BusinessFigures {
  /** null: the records do not say who was responsible (listed for manual review). */
  employeeId: string | null;
  name: string;
}
export interface BusinessSection extends BusinessFigures {
  orders: number;
  byType: BusinessByType[];
  employees: BusinessEmployeeRow[];
}
export interface BusinessDepartmentSide {
  collected: number;
  pending: number;
  refunded: number;
  transactions: number;
}
export interface BusinessDepartmentRow {
  departmentId: string | null;
  name: string;
  sales: BusinessDepartmentSide;
  support: BusinessDepartmentSide;
  collected: number;
}
export interface BusinessReport {
  range: { from: string | null; to: string | null };
  filters: { departmentId: string | null; division: BusinessDivision | null; employeeId: string | null; type: BusinessTxType | null; status: BusinessPayStatus | null };
  sections: { sales?: BusinessSection; support?: BusinessSection };
  /** Income by the customer's business unit, split between Sales and Support. */
  departments: BusinessDepartmentRow[];
  unclassified: { collected: number; pending: number; transactions: number };
  organization: { collected: number; pending: number; refunded: number; billed: number; outstanding: number };
  review: { withoutEmployee: number; withoutEmployeeAmount: number; unclassifiedInvoices: number };
}
export interface BusinessTransaction {
  key: string;
  source: 'CUSTOMER_PAYMENT' | 'ADDON_PAYMENT' | 'INVOICE_PAYMENT' | 'PLAN_ACTIVATION';
  type: BusinessTxType;
  division: BusinessDivision | null;
  amount: number;
  status: BusinessPayStatus;
  occurredAt: string;
  customerId: string;
  customerName: string;
  company: string | null;
  customerCode: string | null;
  departmentId: string | null;
  department: string | null;
  service: string | null;
  employeeId: string | null;
  employeeName: string | null;
  reference: string | null;
  method: string | null;
}
export type BusinessTransactionsPage = Paginated<BusinessTransaction>;
export interface BusinessPerson {
  id: string;
  name: string;
  division: string | null;
  department: string | null;
}

export type InvoiceBusinessKind = 'RENEWAL' | 'ADDON' | 'OTHER';
export interface InvoiceBusinessInfo {
  purpose: InvoicePurpose;
  tag: { kind: InvoiceBusinessKind; serviceCode: string | null; invoiceRequestId: string | null; responsibleId: string | null; responsible: string | null; note: string | null } | null;
  /** Payments are verified: only the Super Admin can still change the classification. */
  locked: boolean;
  /** Open invoice requests a Support member made for this customer (link one to credit that member). */
  requests: { id: string; requestedBy: string | null; requestedByName: string | null; fromMonth: string; toMonth: string; note: string | null; createdAt: string }[];
}

/** One order behind the business figures: what was billed, what is collected / pending / outstanding, and its invoices. */
export type BusinessOrderState = 'PAID' | 'PARTLY_PAID' | 'UNPAID';
export interface BusinessOrderInvoice {
  invoiceId: string;
  number: string;
  date: string | null;
  total: number;
  kind: string;
  paid: boolean;
}
export interface BusinessOrder {
  key: string;
  type: 'INITIAL_SALE' | 'ADDON' | 'RENEWAL';
  division: BusinessDivision;
  billedAt: string;
  billed: number;
  collected: number;
  pending: number;
  refunded: number;
  outstanding: number;
  state: BusinessOrderState;
  customerId: string;
  customerName: string;
  company: string | null;
  customerCode: string | null;
  departmentId: string | null;
  department: string | null;
  employeeId: string | null;
  employeeName: string | null;
  invoices: BusinessOrderInvoice[];
}
export type BusinessOrdersPage = Paginated<BusinessOrder>;

// ---------------------------------------------------------------------------
// HR e-mail automation (birthdays, work anniversaries, probation reminders, employment confirmation)
// ---------------------------------------------------------------------------
export type HrEmailKind =
  | 'BIRTHDAY' | 'ANNIVERSARY' | 'PROBATION_REMINDER_EMPLOYEE' | 'PROBATION_REMINDER_HR' | 'PROBATION_OVERDUE_HR'
  | 'CONFIRMATION_EMPLOYEE' | 'CONFIRMATION_HR';
export type HrEmailStatus = 'PENDING' | 'SENDING' | 'RETRY' | 'SENT' | 'FAILED' | 'SKIPPED' | 'DRY_RUN';

export type HrAutomationCode = 'BIRTHDAY' | 'ANNIVERSARY' | 'CONFIRMATION';
export interface HrAutomationCard {
  sent: number;
  failed: number;
  waiting: number;
  last: { status: HrEmailStatus; at: string; error: string | null; employee: string | null } | null;
}
/** Live figures for the three automation cards, with the wording of each e-mail (a sample, rendered by the server). */
export interface HrEmailCards {
  today: string;
  settings: { mode: 'off' | 'dry_run' | 'live'; emailConfigured: boolean; testMode: boolean };
  /** The daily check runs at this time every day (company time zone). */
  runsAt: string;
  birthday: HrAutomationCard & { next: { date: string; names: string[] } | null };
  anniversary: HrAutomationCard & { next: { date: string; names: string[] } | null };
  confirmation: HrAutomationCard & {
    upcoming: { name: string; department: string | null; joiningDate: string; confirmationDate: string; reminderDate: string; reminderSent: boolean }[];
  };
  templates: Record<HrAutomationCode, { label: string; to: string; subject: string; text: string }[]>;
}

export interface HrEmailOverview {
  today: string;
  /** Whether the server sends real e-mail: "off", "dry_run" (nothing leaves the server) or "live". No credentials are ever included. */
  settings: { mode: 'off' | 'dry_run' | 'live'; emailConfigured: boolean; testMode: boolean };
  lastRun: { ranAt: string; day: string; birthdays: number; anniversaries: number; cyclesOpened: number; reminders: number; overdueReminders: number } | null;
  last30Days: Partial<Record<HrEmailStatus, number>>;
  byKind: Partial<Record<HrEmailKind, number>>;
  queue: { pending: number; retrying: number; failed: number };
  confirmations: { pending: number; dueWithin7Days: number; overdue: number };
  upcoming: { kind: 'BIRTHDAY' | 'ANNIVERSARY'; name: string; date: string; years?: number }[];
}
export interface HrEmailItem {
  id: string;
  kind: HrEmailKind;
  employeeName: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  status: HrEmailStatus;
  attempts: number;
  eventDate: string;
  sendAfter: string;
  sentAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string;
  error: string | null;
  createdAt: string;
}
export interface HrEmailHistory { total: number; items: HrEmailItem[] }
export interface HrProbationCycle {
  id: string;
  employeeName: string;
  employeeEmail: string | null;
  employeeCode: string;
  department: string | null;
  joiningDate: string;
  probationEnd: string;
  daysLeft: number;
  status: 'PENDING' | 'APPROVED' | 'DISMISSED';
  effectiveDate: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  note: string | null;
  /** Whether the signed-in user may approve / close it (HR lead, the employee's Department Head, Super Admin). */
  canDecide: boolean;
}
export type HrDataIssue = 'NO_VALID_EMAIL' | 'NO_DATE_OF_BIRTH' | 'NO_JOINING_DATE' | 'JOINING_DATE_IN_THE_FUTURE';
export interface HrEmailDataIssue {
  employeeKey: string;
  name: string;
  department: string | null;
  email: string | null;
  dateOfBirth: string | null;
  joiningDate: string | null;
  issues: HrDataIssue[];
}
export interface HrEmailRunSummary {
  schedule: { day: string; birthdays: number; anniversaries: number; cyclesOpened: number; reminders: number; overdueReminders: number } | null;
  send: { mode: 'off' | 'dry_run' | 'live'; claimed: number; sent: number; dryRun: number; skipped: number; retrying: number; failed: number; note?: string };
}

// ---------------------------------------------------------------------------
// Chat (client chat and internal employee chat)
// ---------------------------------------------------------------------------
export type ChatKind = 'CLIENT' | 'DIRECT' | 'GROUP';
/** How the signed-in person relates to a conversation. REVIEWER can read but never write. */
export type ChatAccess = 'CLIENT' | 'STAFF' | 'MEMBER' | 'REVIEWER';
export interface ChatPerson {
  name: string;
  position: string | null;
}
export interface ChatMember {
  id: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  position: string | null;
  label: string;
  department: string | null;
  me: boolean;
}
export interface ChatConversation {
  id: string;
  kind: ChatKind;
  access: ChatAccess;
  canWrite: boolean;
  /** Group name, the other person's name, the business (staff view of a client chat) or "Your Amuwa team" (client view). */
  title: string | null;
  /** Staff view of a client chat only. */
  customer: { id: string; name: string; business: string; code: string; hasLogin: boolean } | null;
  /** Client chat: who looks after the customer now. */
  team: { teamMember: ChatPerson | null; teamLead: ChatPerson | null } | null;
  members: ChatMember[] | null;
  isAdmin: boolean;
  /** Client chat: false until a Team Member or Team Lead is assigned (nobody can answer yet). */
  assigned: boolean | null;
  lastSeq: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderName: string | null;
  unread: number;
  readSeq: number;
  /** Where the other side has read up to ("seen"): the team for the client, the client for the team, the other person in a direct chat. */
  peerReadSeq: number | null;
  createdAt: string;
}
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  mine: boolean;
  senderKind: 'CLIENT' | 'STAFF' | 'SYSTEM';
  senderName: string | null;
  /** "Client", "Team Member", "Team Lead" in a client chat. */
  senderLabel: string | null;
  kind: 'TEXT' | 'SYSTEM';
  body: string;
  attachments: ChatAttachment[];
  clientMsgId: string | null;
  createdAt: string;
  replyTo: { id: string; seq: number; senderName: string | null; body: string } | null;
}
export interface ChatMessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
  lastSeq: number;
}
export interface ChatClientView {
  conversation: ChatConversation;
  page: ChatMessagePage;
}
export interface ChatDirectoryPerson {
  id: string;
  name: string;
  label: string;
  position: string | null;
  department: string | null;
  team: string | null;
}
export interface ChatMyClient {
  customerId: string;
  name: string;
  business: string;
  code: string;
  conversationId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  hasLogin: boolean;
  role: 'Team Member' | 'Team Lead';
}
export interface ChatReviewList {
  total: number;
  items: ChatConversation[];
}
export interface ChatUnreadSummary {
  total: number;
  internal: number;
  clients: number;
  review: number;
}
/** A file on a ticket message. updateId is the message it belongs to (absent while the upload is still a draft). */
export interface TicketAttachment {
  id: string;
  updateId?: string | null;
  name: string;
  mime: string;
  size: number;
  fromClient?: boolean;
}
export interface TicketUploadTicket {
  attachment: TicketAttachment;
  bucket: string;
  path: string;
  provider: 'R2' | 'SUPABASE';
  token: string;
  upload?: { url: string; headers: Record<string, string> };
}
export interface ChatUploadTicket {
  attachment: ChatAttachment;
  bucket: string;
  path: string;
  provider: 'R2' | 'SUPABASE';
  token: string;
  upload?: { url: string; headers: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Company workflow (Super Admin): the whole company as one diagram, read from the live tables.
// ---------------------------------------------------------------------------
export type WorkflowEndpointKind = 'team' | 'consultants' | 'head' | 'department';
export type WorkflowProcess = 'payment' | 'addon' | 'onboarding' | 'delivery' | 'tickets' | 'tasks' | 'leave';
export interface WorkflowEndpoint {
  kind: WorkflowEndpointKind;
  id: string;
}
export interface WorkflowHandoff {
  key: string;
  process: WorkflowProcess;
  from: WorkflowEndpoint;
  to: WorkflowEndpoint;
  label: string;
  hint: string;
  count: number;
  countLabel: string;
  extra?: Record<string, number>;
}
export interface CompanyWorkflow {
  generatedAt: string;
  accountsDepartmentId: string | null;
  hrDepartmentId: string | null;
  departments: {
    id: string;
    slug: string;
    name: string;
    category: string | null;
    description: string;
    accent: string;
    locked: boolean;
    generatesRevenue: boolean;
    staff: number;
    customers: number;
  }[];
  teams: { id: string; departmentId: string; name: string; division: TeamDivision; leadCount: number; memberCount: number; consultantCount: number; customers: number }[];
  heads: { id: string; name: string; departmentId: string }[];
  people: { id: string; name: string; role: Role; title: string | null; teamId: string; departmentId: string; consultant: boolean }[];
  handoffs: WorkflowHandoff[];
}

// ---------------------------------------------------------------------------
// Department income attribution
// ---------------------------------------------------------------------------
export type RevenueSource = 'ACQUISITION' | 'DEFAULT_SALES' | 'SUPPORT_ADDON' | 'CLIENT_DASHBOARD' | 'SUPPORT_INVOICE' | 'LEGACY' | 'MANUAL' | 'UNRECORDED';
export type ClientPurchaseRule = 'SUPPORT' | 'ACQUISITION' | 'SALES';
/**
 * The same set of figures for any slice. collected = verified payments (gross receipts, GST included); pending = recorded, not verified;
 * refunded = reversed; billed = order value; outstanding = billed - collected per order, never below zero. The Taxable / Gst figures split
 * the same amounts where the order's tax split is known; ...TaxSplitUnknown is the rest.
 */
export interface IncomeFigures {
  collected: number;
  collectedTaxable: number;
  collectedGst: number;
  collectedTaxSplitUnknown: number;
  pending: number;
  refunded: number;
  payments: number;
  billed: number;
  billedTaxable: number;
  billedGst: number;
  billedTaxSplitUnknown: number;
  outstanding: number;
  orders: number;
}
export interface DepartmentIncomeOrder {
  orderKey: string;
  type: BusinessTxType;
  division: BusinessDivision;
  source: RevenueSource;
  departmentId: string | null;
  department: string | null;
  customerId: string;
  customerCode: string | null;
  customer: string;
  services: string | null;
  billed: number;
  taxSplitKnown: boolean;
  billedTaxable: number | null;
  billedGst: number | null;
  collected: number;
  pending: number;
  refunded: number;
  outstanding: number;
  payments: number;
  partPaid: boolean;
  lastPaymentAt: string | null;
  billedAt: string | null;
  referralSource: string | null;
  acquisitionDivision: BusinessDivision | null;
  needsReview: boolean;
  reviewNote: string | null;
}
export interface DepartmentIncomeReport {
  scope: { departmentId: string | null; name: string | null; from: string | null; to: string | null };
  basis: string;
  /** The rule in force for what clients buy in the Client Dashboard. */
  rule: ClientPurchaseRule;
  totals: IncomeFigures;
  byDivision: { sales?: IncomeFigures; support?: IncomeFigures };
  byType: (IncomeFigures & { division: BusinessDivision; type: BusinessTxType })[];
  bySource: (IncomeFigures & { source: RevenueSource })[];
  byService: { service: string; division: BusinessDivision; collected: number; pending: number; refunded: number; payments: number }[];
  highlights: { supportAddOns: IncomeFigures; supportAcquired: IncomeFigures; supportReferrals: IncomeFigures; clientDashboard: IncomeFigures };
  /** Every department with its Sales / Support split (empty for a single department). */
  departments: { departmentId: string; name: string; sales: IncomeFigures; support: IncomeFigures; collected: number; outstanding: number }[];
  orders: DepartmentIncomeOrder[];
  review: { needsReview: number; needsReviewCollected: number; unclassifiedInvoices: number; unrecordedAttribution: number };
}
export interface AttributionReconciliation {
  legacyOrders: number;
  withoutAcquisition: number;
  items: {
    orderKey: string;
    customerId: string;
    customerCode: string | null;
    customer: string;
    division: BusinessDivision;
    source: RevenueSource;
    departmentId: string | null;
    department: string | null;
    note: string | null;
    collected: number;
    acquisitionDivision: BusinessDivision | null;
    ownerDivision: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Performance Management (Team Lead and Department Head dashboards)
// ---------------------------------------------------------------------------
export type PerformanceScope = 'MEMBER' | 'TEAM' | 'DEPARTMENT';
export type PerformancePeriodKind = 'WEEK' | 'MONTH' | 'CUSTOM';
/** A figure the CRM could not work out is null: the screens show "Insufficient data", never a guess. */
export interface PerformanceMetrics {
  scope: PerformanceScope;
  periodStart: string;
  periodEnd: string;
  today: string;
  tasks: { total: number; completed: number; pending: number; overdue: number; blocked: number };
  completionPct: number | null;
  timing: { onTime: number; late: number; completedUnknownTiming: number; onTimePct: number | null };
  duration: {
    avgActualDays: number | null;
    avgPlannedDays: number | null;
    comparedTasks: number;
    comparedActualDays: number | null;
    comparedPlannedDays: number | null;
    avgDifferenceDays: number | null;
  };
  activity: { updates: number; tasksWithoutUpdates: number };
  workload: { byPriority: { HIGH: number; MEDIUM: number; LOW: number }; peakOpenTasks: number | null };
  trend: { recentWeek: string; recentRate: number; previousWeek: string; previousRate: number; change: number } | null;
  weekly: { weekStart: string; total: number; completed: number; onTime: number; late: number; overdue: number }[];
  taskList: {
    id: string;
    title: string;
    priority: string;
    status: string;
    progress: number;
    assignedOn: string;
    dueDate: string | null;
    completedAt: string | null;
    onTime: boolean | null;
    daysToComplete: number | null;
    plannedDays: number | null;
    daysLate: number | null;
    overdue: boolean;
    updates: number;
  }[];
  delayReasons: { task: string; status: string; note: string; at: string }[];
  limitations: string[];
}
/** The written analysis. Every statement comes from the figures; a missing figure reads "Insufficient data". */
export interface PerformanceNarrative {
  summary: string;
  observations: string[];
  improvementAreas: string[];
  recommendations: string[];
  limitations: string[];
}
export interface PerformanceReport {
  id: string;
  scope: PerformanceScope;
  subjectId: string | null;
  teamId: string | null;
  departmentId: string;
  subjectName: string;
  subjectRole: string | null;
  teamName: string | null;
  departmentName: string | null;
  periodKind: PerformancePeriodKind;
  periodStart: string;
  periodEnd: string;
  metrics: PerformanceMetrics;
  fingerprint: string;
  sourceTaskCount: number;
  narrative: PerformanceNarrative | null;
  narrativeSource: 'AI' | 'RULES' | null;
  aiStatus: 'PENDING' | 'OK' | 'FAILED' | 'NOT_CONFIGURED';
  aiModel: string | null;
  aiError: string | null;
  version: number;
  trigger: 'SCHEDULED' | 'MANUAL';
  generatedBy: string | null;
  generatedAt: string;
  checkedAt: string;
  updatedAt: string;
}
export interface PerformanceReportStub {
  id: string;
  generatedAt: string;
  checkedAt: string;
  narrativeSource: 'AI' | 'RULES' | null;
  aiStatus: PerformanceReport['aiStatus'];
}
export interface PerformanceListEntry {
  scope: PerformanceScope;
  id: string;
  name: string;
  summary: PerformanceMetrics;
  report: PerformanceReportStub | null;
}
export interface PerformancePeople {
  period: { kind: PerformancePeriodKind; start: string; end: string };
  today: string;
  role: string;
  people: (PerformanceListEntry & { role: string; teamId: string | null; teamName: string; position: string | null })[];
  teams: (PerformanceListEntry & { lead: string | null; members: number })[];
  department: PerformanceListEntry | null;
}
export interface PerformanceHistoryEntry {
  version: number;
  generatedAt: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  generatedBy: string | null;
  narrativeSource: 'AI' | 'RULES' | null;
  aiStatus: string | null;
  tasks: PerformanceMetrics['tasks'];
  completionPct: number | null;
  onTimePct: number | null;
  summary: string | null;
}
export interface PerformanceRefreshResult {
  state: 'CREATED' | 'UPDATED' | 'UNCHANGED';
  report: PerformanceReport;
}

// ---------------------------------------------------------------------------
// HR Recruitment Management
// ---------------------------------------------------------------------------
export type RecruitmentConfirmation = 'NOT_STARTED' | 'OFFER_PENDING' | 'OFFERED' | 'CONFIRMED' | 'DECLINED' | 'ON_HOLD';
export type RecruitmentActionKind = 'INTERVIEW' | 'DOCUMENTS' | 'ASSESSMENT' | 'BACKGROUND_CHECK' | 'REFERENCE_CHECK' | 'OTHER';
export type RecruitmentCallOutcome = 'ANSWERED' | 'NO_ANSWER' | 'CALL_BACK' | 'NOT_INTERESTED' | 'WRONG_NUMBER';

/** One row of the candidate table: name, e-mail, position, and the three separate stages Pending / Call / Confirmation. */
export interface RecruitmentCandidate {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: string | null;
  notes: string | null;
  positionId: string;
  position: string;
  ownerId: string | null;
  /** The responsible HR employee's key in the HR directory (also set for an employee without a CRM login). */
  ownerKey: string | null;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
  pending: { open: number; overdue: number; nextDue: string | null; items: { id: string; kind: RecruitmentActionKind; title: string; dueDate: string | null; overdue: boolean | null; assignee: string | null }[] };
  call: {
    total: number;
    nextAt: string | null;
    missedScheduled: number;
    last: { outcome: RecruitmentCallOutcome; at: string; followUpDate: string | null; note: string | null } | null;
    followUpOverdue: boolean;
  };
  confirmation: { status: RecruitmentConfirmation; date: string | null; note: string | null };
}
export interface RecruitmentDetail extends RecruitmentCandidate {
  actions: { id: string; kind: RecruitmentActionKind; title: string; dueDate: string | null; status: 'OPEN' | 'DONE' | 'CANCELLED'; note: string | null; doneAt: string | null; assigneeId: string | null; assigneeKey: string | null; assignee: string | null; overdue: boolean; createdAt: string }[];
  calls: { id: string; scheduledAt: string | null; calledAt: string | null; outcome: RecruitmentCallOutcome | null; note: string | null; followUpDate: string | null; madeBy: string | null }[];
  history: { id: string; kind: string; summary: string; actor: string | null; at: string }[];
}
export interface RecruitmentList {
  total: number;
  items: RecruitmentCandidate[];
}
export interface RecruitmentOverview {
  today: string;
  candidates: number;
  withPending: number;
  overdueActions: number;
  upcomingCalls: number;
  overdueFollowUps: number;
  missedCalls: number;
  confirmed: number;
  openPositions: number;
}
export interface RecruitmentAgenda {
  upcomingCalls: { candidateId: string; name: string; position: string | null; at: string; callId: string }[];
  overdueCalls: { candidateId: string; name: string; position: string | null; at: string; callId: string }[];
  overdueFollowUps: { candidateId: string; name: string; position: string | null; followUpDate: string }[];
  overdueActions: { candidateId: string; name: string; actionId: string; title: string; dueDate: string; assignee: string | null }[];
}
/** A position HR added (source POSITION), or a designation found in the employee records that is not a position yet (source EMPLOYEES, id null: it becomes one when chosen). */
export interface RecruitmentPosition {
  id: string | null;
  title: string;
  departmentId: string | null;
  department: string | null;
  isOpen: boolean;
  candidates: number;
  source: 'POSITION' | 'EMPLOYEES';
  employees: number;
}
/** An active HR employee from the HR directory. */
export interface HrRecruiter {
  employeeKey: string;
  profileId: string | null;
  name: string;
  code: string | null;
  designation: string | null;
  hasLogin: boolean;
}

// ---------------------------------------------------------------------------
// HR Training workspace
// ---------------------------------------------------------------------------
export type TrainingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'INCOMPLETE';
export type TrainingAttendance = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export interface TrainingOverview {
  today: string;
  employeesEnrolled: number;
  activePrograms: number;
  upcomingPrograms: number;
  completed: number;
  incomplete: number;
  pendingTraining: number;
  pendingReports: number;
}
export interface TrainingDayConfig {
  dayNo: 1 | 2 | 3;
  date: string;
  title: string;
  topics: string[];
  trainerName: string | null;
  trainerId: string | null;
  criteria: { name: string; max: number }[];
  passPercent: number | null;
}
export interface TrainingProgram {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  isCancelled: boolean;
  ownerId: string | null;
  owner: string | null;
  phase: 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED';
  enrolled: number;
  byStatus: Partial<Record<TrainingStatus, number>>;
  days: TrainingDayConfig[];
}
export interface TrainingEnrollmentRow {
  id: string;
  programId: string;
  program: string;
  startDate: string;
  endDate: string;
  employeeKey: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  status: TrainingStatus;
  strengths: string | null;
  improvements: string | null;
  trainerRemarks: string | null;
  consolidated: TrainingConsolidated | null;
  consolidatedAt: string | null;
  days: { dayNo: 1 | 2 | 3; date: string; attendance: TrainingAttendance | null; completed: boolean; reported: boolean; overdue: boolean }[];
}
export interface TrainingProgramDetail extends TrainingProgram {
  enrollments: TrainingEnrollmentRow[];
}
export interface TrainingDayReport {
  dayNo: 1 | 2 | 3;
  attendance: TrainingAttendance | null;
  topicsCompleted: string[];
  tasks: { title: string; done: boolean }[];
  scores: { criterion: string; score: number; max: number }[];
  assessmentTotal: number | null;
  assessmentMax: number | null;
  assessmentResult: 'PASS' | 'FAIL' | 'RECORDED' | null;
  feedback: string | null;
  trainerRemarks: string | null;
  report: string | null;
  completed: boolean;
  reportedAt: string;
  reportedBy: string | null;
}
export interface TrainingConsolidated {
  program: string;
  startDate: string;
  endDate: string;
  status: TrainingStatus;
  daysAttended: number;
  daysCompleted: number;
  assessmentPercent: number | null;
  strengths: string | null;
  improvements: string | null;
  trainerRemarks: string | null;
  missing: string[];
  days: {
    day: number;
    title: string;
    date: string;
    trainer: string | null;
    attendance: TrainingAttendance | null;
    completed: boolean;
    topicsPlanned: number;
    topicsCompleted: number;
    tasksTotal: number;
    tasksDone: number;
    assessmentTotal: number | null;
    assessmentMax: number | null;
    assessmentPercent: number | null;
    assessmentResult: string | null;
    feedback: string | null;
    trainerRemarks: string | null;
    report: string | null;
  }[];
}
export interface TrainingEnrollmentDetail extends TrainingEnrollmentRow {
  programConfig: TrainingProgram;
  canReport: Record<'1' | '2' | '3', boolean>;
  reports: TrainingDayReport[];
  preview: TrainingConsolidated;
}
export interface TrainingRecords {
  total: number;
  items: TrainingEnrollmentRow[];
}
export interface TrainingEmployee {
  employeeKey: string;
  name: string;
  department: string | null;
  code: string | null;
  designation: string | null;
}


// ---------------------------------------------------------------------------
// Telecaller
// ---------------------------------------------------------------------------
export interface TelecallerFocusFollowUp {
  kind: 'CONTACT' | 'LEAD';
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  date: string;
  overdue: boolean;
}
export interface TelecallerHome {
  today: string;
  totalAssigned: number;
  callsPending: number;
  callsCompleted: number;
  totalLeads: number;
  hotLeads: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  focus: {
    followUps: TelecallerFocusFollowUp[];
    pendingCalls: { id: string; name: string; company: string | null; phone: string; assignedAt: string }[];
  };
}
export interface TelecallerSheet {
  id: string;
  fileName: string;
  note: string | null;
  assignedAt: string;
  hasSourceFile: boolean;
  assignedBy: string | null;
  assignedTo: string | null;
  assigneeId: string;
  total: number;
  pending: number;
  called: number;
  followUps: number;
}
export interface TelecallerContact {
  id: string;
  listId: string;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  assignedAt: string;
  callStatus: CallStatus;
  callCount: number;
  lastCalledAt: string | null;
  followUpDate: string | null;
  remarks: string | null;
  followUpDue: boolean;
}
export interface TelecallerContactList {
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<CallStatus, number>>;
  items: TelecallerContact[];
}
export interface TelecallerLead {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  leadSource: string | null;
  leadTemperature: LeadTemperature | null;
  callStatus: CallStatus | null;
  followUpDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  services: string[];
  serviceNames: string;
  /** Set once a Telecaller has converted the lead into a contact for a Business Associate. */
  converted?: { contactId: string; convertedAt: string; businessAssociate: string | null } | null;
}
export interface TelecallerLeadList {
  total: number;
  page: number;
  pageSize: number;
  sources: string[];
  items: TelecallerLead[];
}
export interface TelecallerAssignee {
  id: string;
  name: string;
  team: string;
  departmentId: string;
  openContacts: number;
}
export interface TelecallerSheetCheck {
  committed: boolean;
  listId: string | null;
  alreadyAssigned: boolean;
  errors: { row: number; message: string }[];
  summary: { rows: number; valid: number; invalid: number };
  preview: { row: number; name: string; company: string | null; phone: string; email: string | null; remarks: string | null }[];
}


// ---------------------------------------------------------------------------
// Business Associate
// ---------------------------------------------------------------------------
export const BA_STAGES = ['NEW', 'IN_PROGRESS', 'QUOTATION_PENDING', 'DEMO_SCHEDULED', 'SCOPE_PENDING', 'COMPLETED'] as const;
export type BaStage = (typeof BA_STAGES)[number];
export const BA_STAGE_LABELS: Record<BaStage, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  QUOTATION_PENDING: 'Quotation Pending',
  DEMO_SCHEDULED: 'Demo Scheduled',
  SCOPE_PENDING: 'Scope of Project Pending',
  COMPLETED: 'Completed'
};
export const DEMO_STATUSES = ['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];
export const DEMO_MODES = ['ONLINE', 'IN_PERSON'] as const;
export type DemoMode = (typeof DEMO_MODES)[number];
export type BaDocumentStatus = 'DRAFT' | 'FINAL';

export interface BaDocRef { id: string; number?: string; revision?: number; version?: number; status: BaDocumentStatus; total?: number }
export interface BaContactRow {
  id: string;
  leadId: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string | null;
  telecaller: string | null;
  telecallerId: string | null;
  assignedAt: string;
  businessAssociate: string | null;
  assignedTo: string;
  stage: BaStage;
  stageChangedAt: string;
  nextFollowUp: string | null;
  quotation: BaDocRef | null;
  nextDemo: { id: string; startsAt: string; status: DemoStatus } | null;
  scope: BaDocRef | null;
}
export interface BaContactList {
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<BaStage, number>>;
  items: BaContactRow[];
}
export interface BaContactEvent { id: string; kind: string; note: string; at: string; by: string | null }
export interface BaQuotationRow {
  id: string;
  contactId: string;
  number: string;
  revision: number;
  status: BaDocumentStatus;
  total: number;
  aiGenerated: boolean;
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  validUntil: string | null;
  hasPdf: boolean;
  createdBy: string | null;
  client?: string;
  company?: string | null;
}
export interface BaDemo {
  id: string;
  contactId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  mode: DemoMode;
  location: string | null;
  meetingLink: string | null;
  assignedTo: string;
  assignee: string | null;
  internalNotes: string | null;
  status: DemoStatus;
  rescheduleCount: number;
  feedback: string | null;
  followUpNotes: string | null;
  client: string | null;
  company: string | null;
}
export interface BaScopeRow {
  id: string;
  contactId: string;
  version: number;
  status: BaDocumentStatus;
  title: string;
  aiGenerated: boolean;
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  hasPdf: boolean;
  createdBy: string | null;
}
export interface BaContactDetail extends BaContactRow {
  address: string | null;
  notes: string | null;
  leadTemperature: LeadTemperature | null;
  callStatus: CallStatus | null;
  handoverNote: string | null;
  services: { code: string; name: string }[];
  requirements: string | null;
  profile: Record<string, string>;
  events: BaContactEvent[];
  quotations: BaQuotationRow[];
  demos: BaDemo[];
  scopes: BaScopeRow[];
}
export interface BaQuotationLine {
  position: number;
  serviceCode: string;
  name: string;
  description: string | null;
  unitLabel: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  gstRate: number;
  amount: number;
  discount: number;
  taxable: number;
  gst: number;
  total: number;
}
export interface BaPriceFlag { line: number; serviceCode: string; kind: 'NOT_IN_PRICE_LIST' | 'PRICE_DIFFERS' | 'GST_DIFFERS'; message: string }
export interface BaQuotation extends Omit<BaQuotationRow, 'client' | 'company'> {
  items: BaQuotationLine[];
  gstApplicable: boolean;
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  taxTotal: number;
  validityDays: number | null;
  paymentTerms: string | null;
  timeline: string | null;
  notes: string | null;
  content: Partial<import('./baContent').QuotationContent>;
  priceFlags: BaPriceFlag[];
  aiModel: string | null;
  reviewedAt: string | null;
  client: { name: string; company: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; businessCategory: string | null };
  requirements: string | null;
  businessProfile: Record<string, string>;
}
export interface BaScope extends BaScopeRow {
  inputs: Record<string, string>;
  content: Partial<import('./baContent').ScopeContent>;
  aiModel: string | null;
  reviewedAt: string | null;
  client?: { name: string; company: string | null };
}
export interface ServicePrice {
  serviceCode: string;
  name: string;
  category: string;
  unitLabel: string | null;
  unitPrice: number | null;
  gstRate: number | null;
  maxDiscountPct: number | null;
  isActive: boolean;
  priced: boolean;
}
export interface BaHome {
  today: string;
  assignedContacts: number;
  newContacts: number;
  leadsInProgress: number;
  quotationsDrafted: number;
  quotationsAwaitingReview: number;
  upcomingDemos: number;
  scopeDocumentsGenerated: number;
  followUpsDue: number;
  stageCounts: Partial<Record<BaStage, number>>;
  upcoming: BaDemo[];
  recent: { contactId: string; client: string; kind: string; note: string; at: string }[];
}
export interface BaAssignee { id: string; name: string; departmentId: string; openContacts: number }

// ---------------------------------------------------------------------------
// Sales Department Head dashboard
// ---------------------------------------------------------------------------
export const SALES_LEAD_FILTERS = ['ALL', 'HOT', 'WARM', 'COLD', 'UNASSIGNED', 'ASSIGNED', 'FOLLOW_UP', 'CONVERTED'] as const;
export type SalesLeadFilter = (typeof SALES_LEAD_FILTERS)[number];
export const SALES_TASK_FILTERS = ['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'] as const;
export type SalesTaskFilter = (typeof SALES_TASK_FILTERS)[number];

/** The Telecaller a lead sheet is given to (the sheet goes to a Telecaller, who calls the contacts and passes the interested ones on). */
export interface SalesLeadAssignee {
  id: string;
  name: string;
  team: string;
  teamId: string;
  role: 'Team Member';
  subRole: SalesSubRole | null;
  mode: 'TELECALLER';
  openContacts: number;
}
/** An active Sales Team Lead or Team Member (the Lead List owner filter; who an unassigned enquiry can be given to). */
export interface SalesTeamPerson {
  id: string;
  name: string;
  team: string;
  teamId: string;
  role: 'Team Lead' | 'Team Member';
  subRole: SalesSubRole | null;
}
export interface SalesSheetIssue { row: number; kind: 'INVALID' | 'DUPLICATE'; message: string }
export interface SalesSheetCheck {
  committed: boolean;
  sheetId: string | null;
  mode: 'LEADS' | 'TELECALLER';
  alreadyAssigned: boolean;
  assignee: { id: string; name: string; role: string; team: string };
  issues: SalesSheetIssue[];
  summary: { rows: number; valid: number; invalid: number; duplicates: number };
  preview: { row: number; name: string; company: string | null; phone: string; email: string | null; remarks: string | null }[];
}
export interface SalesSheet {
  id: string;
  fileName: string;
  note: string | null;
  mode: 'LEADS' | 'TELECALLER';
  uploadedAt: string;
  assignedAt: string;
  uploadedBy: string | null;
  assigneeId: string;
  assignedTo: string;
  rows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  status: 'ASSIGNED';
  hasSourceFile: boolean;
  leadsNow: number | null;
  converted: number | null;
  contactsPending: number | null;
  contactsCalled: number | null;
}

export interface SalesLeadRow {
  id: string;
  leadCode: string;
  kind: 'CUSTOMER' | 'INBOUND';
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  temperature: LeadTemperature | null;
  callStatus: CallStatus | null;
  assigneeId: string | null;
  assignee: string | null;
  team: string | null;
  assignedAt: string | null;
  lastContacted: string | null;
  followUp: string | null;
  converted: boolean;
  stage: string;
  sheet: string | null;
}
export interface SalesLeadList {
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; hot: number; warm: number; cold: number; unassigned: number; assigned: number; followUp: number; converted: number };
  items: SalesLeadRow[];
}
export interface SalesLeadDetail extends SalesLeadRow {
  details: Record<string, unknown> | null;
  history: { at: string; type: string; note: string | null }[];
}

export interface SalesTaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  startDate: string;
  dueDate: string | null;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_COMPLETED' | 'BLOCKED';
  progress: number;
  remarks: string | null;
  lastUpdateAt: string | null;
  assigneeId: string;
  assignee: string;
  assignedById: string;
  assignedBy: string;
  team: string;
  overdue: boolean;
  dueSoon: boolean;
  level: 'LEAD' | 'MEMBER';
  subtasks: number;
}
export interface SalesTaskList {
  total: number;
  page: number;
  pageSize: number;
  today: string;
  counts: { all: number; pending: number; inProgress: number; completed: number; overdue: number };
  items: SalesTaskRow[];
}
export interface SalesTaskAssignee { id: string; name: string; team: string; teamId: string; role: 'Team Lead' }

export interface SalesOverview {
  today: string;
  cards: {
    totalLeads: number; hot: number; warm: number; cold: number; assigned: number; pendingAssignment: number; teamMembers: number;
    tasksPending: number; tasksCompleted: number; followUpsDue: number; converted: number; income: number | null;
  };
  statusDistribution: { temperature: Record<'HOT' | 'WARM' | 'COLD' | 'NONE', number>; callStatus: Record<string, number> };
  recentActivities: { at: string; type: string; note: string | null; customer: string; customerId: string; by: string | null }[];
  teamActivity: { id: string; name: string; role: string; team: string; leads: number; contacted7d: number; tasksOpen: number; tasksDone: number }[];
  upcomingFollowUps: { id: string; name: string; company: string | null; followUp: string; assignee: string | null; temperature: LeadTemperature | null }[];
  pendingTasks: { id: string; title: string; dueDate: string | null; priority: string; status: string; assignee: string; overdue: boolean }[];
  recentSheets: { id: string; fileName: string; mode: 'LEADS' | 'TELECALLER'; valid: number; assignedAt: string; assignedTo: string }[];
  recentConversions: { id: string; name: string; company: string | null; stage: string; at: string; owner: string | null }[];
  highlights: { id: string; name: string; tasksDone: number; converted: number }[];
}

export interface SalesReportRow {
  id: string;
  name: string;
  team: string;
  subRole: SalesSubRole | null;
  members: number | null;
  leadsAssigned: number;
  leadsContacted: number;
  hot: number;
  warm: number;
  cold: number;
  followUps: number;
  conversions: number;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
}
export interface SalesReport {
  who: 'TEAM_LEAD' | 'TEAM_MEMBER';
  from: string;
  to: string;
  taskStatus: string | null;
  today: string;
  rows: SalesReportRow[];
}

export interface SalesIncome {
  from: string | null;
  to: string | null;
  basis: string;
  figures: Partial<IncomeFigures>;
  transactions: { date: string; customer: string; customerId: string; reference: string | null; type: string; service: string | null; amount: number; status: string; method: string | null; source: string }[];
  /** Expenses are recorded per department, not per Sales / Support side: there is no Sales-only figure, so this is null. */
  expenses: null;
}

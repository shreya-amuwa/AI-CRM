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
  | 'meta-verifier'
  | 'telecaller'
  | 'business-associate'
  /** An HR Recruiter (a designation of the HR department's staff): opens the recruiter dashboard. */
  | 'hr-recruiter'
  /** AI Studio: the department's Department Head, Team Lead and Team Member each open their own dashboard. */
  | 'ai-studio-head'
  | 'ai-studio-lead'
  | 'ai-studio-member'
  /** International / Reseller (departments flagged unified_sales_support, migration 20270127000100): Sales and Support in one dashboard for each role. */
  | 'unified-head'
  | 'unified-lead'
  | 'unified-member'
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
  /** Sales AND Support in one department (International, Reseller): decided by the database, never by the slug (20270127000100, 20270202000300). */
  unifiedSalesSupport?: boolean;
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
  /** Team member of a support team who does the first verification of WhatsApp customers (never also a Technical Consultant). */
  isMetaVerifier?: boolean;
  /** A Department Head who oversees the several departments the Super Admin assigned (a Department Head otherwise: one department). */
  isOperationsHead?: boolean;
  /** Sales role of a Sales team member (Telecaller, Business Associate, ...); null for everybody else. */
  salesSubRole?: SalesSubRole | null;
  /** HR designation of an HR employee: HR Assistant (the existing HR dashboard) or HR Recruiter (the recruiter dashboard); null for everybody else. */
  /** HR_DEPARTMENT: the HR of one business department (e.g. Digitree), placed in that department; HR scope = that department only. */
  hrSubRole?: 'HR_ASSISTANT' | 'HR_RECRUITER' | 'HR_DEPARTMENT' | null;
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
export interface OffboardingImpact {
  employee: { id: string; name: string; status: string; role: Role; isMetaVerifier: boolean; isTechnicalConsultant: boolean; department: string | null; team: string | null };
  counts: { customersAsMember: number; customersAsLead: number; customersAsVerifier: number; customersOwned: number; openTasks: number; directReports: number; reportsToReview: number; conversations: number };
  needsInterimHead: boolean;
  candidates: { id: string; name: string; role: string }[];
}
export interface OffboardingResult { status: 'SUSPENDED' | 'REVOKED'; moved: { customers: number; verifications: number; tasks: number; members: number; reports: number }; queued: number }
export interface ReassignmentItem { id: string; kind: 'CUSTOMER_MEMBER' | 'CUSTOMER_LEAD' | 'CUSTOMER_VERIFIER' | 'MEMBER_LEAD' | 'TASK' | 'DEPARTMENT_HEAD'; entityId: string; label: string | null; reason: string | null; createdAt: string; department: string | null; departmentId: string | null; from: string | null }
/** The departments a Meta Verifier verifies for: the home department plus the extras an Operations Head / the Super Admin gave. */
export interface VerifierDepartments {
  isMetaVerifier: boolean;
  home: { id: string; name: string } | null;
  extra: { id: string; name: string }[];
  canEdit: boolean;
  reassigned?: number;
}
export interface DepartmentAccessInfo {
  profileId: string;
  name: string;
  role: Role;
  homeDepartmentId: string | null;
  headDivision: HeadDivision | null;
  grants: { departmentId: string; division: HeadDivision }[];
  departments: { id: string; slug: string; name: string; hasSales: boolean; hasSupport: boolean; supportDepartment?: string | null; salesDepartment?: string | null }[];
  /** Set by a whole-matrix save: how many pairs were added / removed. */
  added?: number;
  removed?: number;
}

/** A Department Head who works in a department (their own or authorised), with every department and function they work in. */
export interface DepartmentHeadAccess {
  profile: Profile;
  access: { departmentId: string; department: string; division: HeadDivision | null }[];
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
export interface AuditLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  /** About 1 km: rounded when stored. */
  latitude: number | null;
  longitude: number | null;
  source: 'PLATFORM_IP' | 'IP_PROVIDER' | 'BROWSER_PERMISSION';
  accuracy: 'COUNTRY' | 'REGION' | 'CITY' | 'DEVICE';
}

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
  /** The address the request came from, as the hosting platform reported it. Super Admin only (null for everyone else). */
  ip: string | null;
  /**
   * Where a sign-in came from. Super Admin only; null when it was not recorded (older events, or the platform / lookup could not tell).
   * A place found from an address is the network's location, approximately: never the person's exact position.
   */
  location: AuditLocation | null;
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

// --- Super Admin Overview by department (dashboard_overview_departments) ---
export interface OverviewAbsentEmployee {
  id: string;
  name: string;
  position: string | null;
  /** Approved leave covers the day. */
  onLeave: boolean;
  leaveType: 'FULL_DAY' | 'HALF_DAY' | null;
}
export interface OverviewDepartmentAttendance {
  /** Null for active staff without a department. */
  departmentId: string | null;
  name: string;
  slug: string | null;
  staff: number;
  present: number;
  absentCount: number;
  absent: OverviewAbsentEmployee[];
}
export interface OverviewDepartmentPerformance {
  departmentId: string;
  name: string;
  slug: string;
  /** All verified income attributed to the department: the Accounts "Department Income" figure. */
  departmentIncome: number;
  departmentIncomeCount: number;
  /** Verified income paid in the period (Accounts' figure for the same dates). */
  income: number;
  incomeCount: number;
  /** The department's share of expenses dated in the period. */
  expenses: number;
  expenseCount: number;
  /** Customers whose onboarding was completed in the period. */
  onboarded: number;
  /** Completed plan purchases and renewals in the period, and their amount. */
  recharges: number;
  rechargeAmount: number;
}
export interface OverviewDepartments {
  attendanceDate: string;
  attendance: OverviewDepartmentAttendance[];
  period: { from: string; to: string };
  performance: OverviewDepartmentPerformance[];
  generatedAt: string;
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

/** Lead tags (migration 20270305000100): every lead has one tag, which counts as one lead status (its stage). */
export const LEAD_TAG_COLOURS = ['slate', 'blue', 'indigo', 'violet', 'green', 'amber', 'orange', 'red'] as const;
export type LeadTagColour = (typeof LEAD_TAG_COLOURS)[number];
export interface LeadTag {
  id: string;
  label: string;
  colour: LeadTagColour;
  /** The lead status the tag counts as. */
  stage: LeadStatus;
  scope: 'COMPANY' | 'DEPARTMENTS';
  departmentIds: string[];
  retired: boolean;
  /** The basic tag of its stage: company-wide, keeps its stage, never retired. */
  seed: boolean;
  leadCount: number;
  canManage: boolean;
}

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
  /** The lead's tag (migration 20270305000100; it counts as `leadStatus`). Absent from servers before tags. */
  leadTagId?: string | null;
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
  /** Who verified the customer: the Meta Verifier or the Technical Consultant. */
  route?: 'META' | 'TECHNICAL';
  toDepartmentHeadAt: string | null;
  sentBy: string | null;
  teamLead: { id: string; fullName: string } | null;
  passedToTeamLeadAt: string | null;
  teamMember: { id: string; fullName: string } | null;
  assignedToMemberAt: string | null;
  note: string | null;
  /** The Technical Consultant's separate consultation task for this customer (only for people who may see follow-ups). */
  followUp?: { status: 'AWAITING_CONFIGURATION' | 'SCHEDULED' | 'DUE' | 'DONE' | 'CANCELLED'; dueAt: string | null; assignedTo: string | null } | null;
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
  /** Older records only: a date typed by hand (nobody is asked for it any more). */
  targetHandoverDate: string | null;
  /** When the customer was handed over to the Meta Verifier / Technical Consultant: written by the database at the moment of the handover. */
  forwardedToSupportAt: string | null;
  /** The first handover, kept for good (the one above is cleared when the verifier sends the customer back). */
  firstHandedOverAt?: string | null;
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
  /** Which verification the customer went through: the Meta Verifier or the Technical Consultant. */
  verificationRoute?: 'META' | 'TECHNICAL' | null;
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
export type MessageStage = ClientStage | 'WEBSITE_READY' | 'ACCOUNT_CREATED';
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

/** Where Sales' next send goes (decided by the database from the services ordered) and whether anybody is there to receive it. */
export interface OnboardingHandoffInfo {
  route: 'META' | 'TECHNICAL';
  recipient: 'Meta Verifier' | 'Technical Consultant';
  recipientAvailable: boolean;
}

export interface PipelineCustomerDetail extends PipelineCustomer {
  documents: CustomerDocument[];
  documentTypes: DocumentType[];
  activities: CustomerActivity[];
  /** Conversations with the customer, newest first (the first one is the "Last conversation"). */
  conversations: Conversation[];
  checklist: ChecklistItem[];
  handover: HandoverInfo | null;
  /** AI Website client onboarding details (migration 20270113000200); null when none were recorded (or the database is not updated yet). */
  aiWebsiteOnboarding?: AiWebsiteOnboarding | null;
}

// ---- AI Website client onboarding (migration 20270113000200): one record per lead, kept through every stage ----
export interface AiWebsiteOnboarding {
  customerId: string;
  clientName: string;
  mobile: string;
  email: string | null;
  businessName: string;
  onGoogleMaps: boolean;
  googleMapsLink: string | null;
  city: string;
  businessType: string;
  businessTypeOther: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who saved it last (returned by the save; not read back with the lead). */
  updatedBy: { id: string; name: string } | null;
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
  /** The money received, GST included (a payment never carries GST of its own). */
  amount: number;
  /** Older payments only: the GST split that was recorded on the payment before GST became the order's. */
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
  /** The paid invoice made for this payment (Accounts only; null while there is none). */
  invoice?: { id: string; number: string; paid: boolean } | null;
}

/** What happened to the paid invoice of a payment right after it was recorded / verified (or when Accounts asked for it). */
/** The billing details a payment's invoice would use, and which of them the customer record lacks (Accounts adds those with the click). */
export interface PaymentInvoiceBilling {
  customer: { name?: string | null; businessName?: string | null; address?: string | null; contactPerson?: string | null; contactNumber?: string | null; gstin?: string | null; stateCode?: string | null; state?: string | null };
  taxTreatment: TaxTreatmentName | null;
  missing: ('address' | 'state')[];
}

export interface PaymentInvoiceOutcome {
  /** CREATED: made now. EXISTS: it was made before. FAILED: the payment stands, the invoice could not be made (see message). */
  status: 'CREATED' | 'EXISTS' | 'FAILED';
  /** The payment the invoice is (or was to be) made for. */
  paymentId?: string;
  invoiceId?: string;
  number?: string;
  /** PDF / e-mail / WhatsApp, one line each. */
  steps?: InvoiceStep[];
  message?: string | null;
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
  /** The GST of the order, chosen once by Accounts (never per payment). `applies` is false when the agreed amount already includes GST. */
  orderGst?: OrderGst;
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
  /** Set on the answer to "record payment" / "verify payment": the paid invoice of that payment. */
  paymentInvoice?: PaymentInvoiceOutcome;
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
  /** The department's name, or the names of the departments it is split across. */
  department: string | null;
  /** Who bears how much; empty = company-wide. The amounts add up to `amount`. */
  allocations: { departmentId: string; department: string; amount: number }[];
  /** When the list is filtered by one department: that department's own part. */
  allocatedToFilter: number | null;
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
  status: 'Paid' | 'Pending' | 'Overdue' | 'Cancelled';
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
export interface OrderGst {
  applies: boolean;
  rate?: number | null;
  selected?: boolean;
  /** An older order (GST recorded on payments or invoices, or none): never recalculated by itself. */
  legacy?: boolean;
  agreedAmount?: number | null;
  locked?: boolean;
  lockReason?: string | null;
  setAt?: string | null;
  setBy?: string | null;
  rates?: { rate: number; label: string }[];
}
export interface OrderInvoiceAllocation {
  id: string;
  number: string;
  taxable: number;
  gst: number;
  total: number;
  /** Confirmed money applied to this invoice. */
  allocated: number;
  balance: number;
  state: InvoicePaymentState;
}
export interface OrderSummary {
  basis: AgreementTaxBasis;
  /** The GST rate of the order (null until Accounts chooses it, or when the agreement includes GST). */
  gstRate?: number | null;
  gstSelected?: boolean;
  /** True while the amount payable is not known because Accounts has not chosen the GST rate yet. */
  gstRequired?: boolean;
  /** Whole-rupee rounding of the payable (payable minus the exact amount with GST). */
  roundOff?: number | null;
  /** Each invoice of the order with the confirmed money applied to it (first issued, first paid). */
  invoices?: OrderInvoiceAllocation[];
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

export type InvoiceType = 'GST' | 'NON_GST';
export interface GeneratedInvoice {
  number: string;
  /** GST: numbered GST/26-27/001, titled Tax Invoice. NON_GST: numbered Amuwa/26-27/001. Set by the database from the tax on the invoice. */
  invoiceType: InvoiceType;
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
  /** Set when Accounts cancelled this invoice (made by mistake): it stays on record but no longer counts toward the order. */
  cancelled?: { at: string; by: string | null; reason: string | null } | null;
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
  /** A preview of the next number of each series (nothing is reserved): the number is assigned when the invoice is issued. */
  nextInvoiceNumbers?: { GST: string; NON_GST: string };
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
  /** The GST rate Accounts chose for the order; the invoice lines use it (null until chosen, or for an older / GST-inclusive order). */
  orderGstRate?: number | null;
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

export type InvoiceStepName = 'ISSUE' | 'PAYMENT' | 'PDF' | 'EMAIL' | 'WHATSAPP';
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
/** The paid invoice by WhatsApp. ACCEPTED means the provider took the request; only DELIVERED / READ (a report from the provider) mean it arrived. */
export type InvoiceWhatsAppStatus = 'PENDING' | 'PROCESSING' | 'DRY_RUN' | 'ACCEPTED' | 'DELIVERED' | 'READ' | 'RETRY' | 'FAILED' | 'SKIPPED';
export interface InvoiceWhatsAppEvent {
  kind: string;
  attempt: number | null;
  code: number | null;
  detail: string | null;
  at: string;
}
export interface InvoiceWhatsAppDispatch {
  id: string;
  invoiceId: string;
  stage: 'PAID';
  /** The number, masked (+91XXXXXX1234). */
  recipient: string;
  status: InvoiceWhatsAppStatus;
  attempts: number;
  nextAttemptAt: string | null;
  detail: string | null;
  trigger: 'MANUAL' | 'AUTO';
  requestedBy: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
  events: InvoiceWhatsAppEvent[];
}
export interface InvoiceWhatsAppSettings {
  enabled: boolean;
  autoSend: boolean;
  templateName: string | null;
  templateLanguage: string;
  templateApproved: boolean;
  updatedAt: string;
  /** Only the Super Admin and the Accounts Department Head change these. */
  canEdit: boolean;
  /** What the SERVER does with a message right now (set by the server's configuration, not by these switches). */
  delivery?: { mode: 'off' | 'dry_run' | 'live'; provider: 'WABASTORE' | 'BUILDER' | null; ready: boolean; note: string };
}
/** The lead welcome WhatsApp of one lead (sent once, when the lead first reaches a sales person). */
export interface LeadWhatsAppMessage {
  id: string;
  customerId: string;
  leadName: string | null;
  salesPerson: string | null;
  recipient: string | null;
  status: 'PENDING' | 'PROCESSING' | 'DRY_RUN' | 'ACCEPTED' | 'DELIVERED' | 'READ' | 'RETRY' | 'FAILED' | 'SKIPPED';
  attempts: number;
  nextAttemptAt: string | null;
  detail: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
  events: { kind: string; attempt: number | null; code: number | null; detail: string | null; at: string }[];
}
export type LeadWhatsAppVariable = 'LEAD_NAME' | 'LEAD_COMPANY' | 'SALES_PERSON_NAME' | 'SALES_PERSON_PHONE';
export interface LeadWhatsAppSettings {
  enabled: boolean;
  templateName: string | null;
  templateLanguage: string;
  templateApproved: boolean;
  variables: LeadWhatsAppVariable[];
  updatedAt: string;
  updatedBy: string | null;
  counts: { queued: number; sent: number; failed: number; skipped: number; dryRun: number };
  recent: LeadWhatsAppMessage[];
  /** What the SERVER does with a message right now (its configuration, not these switches). */
  delivery?: { mode: 'off' | 'dry_run' | 'live'; ready: boolean; note: string };
}
export interface InvoiceWhatsAppResult {
  /** false: nothing was requested (automatic request that cannot be made); `reason` says why. */
  requested: boolean;
  replayed: boolean;
  reason: string | null;
  dispatch: InvoiceWhatsAppDispatch | null;
  /** What this server does with it now: off, dry_run (nothing is sent) or live. */
  mode: 'off' | 'dry_run' | 'live';
  note: string | null;
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
  /** True after Accounts gave a temporary password: until the client chooses their own, the dashboard shows only the change-password screen. */
  mustChangePassword?: boolean;
  /** The sign-in's own id (from the server; never sent back by the client). */
  loginId?: string;
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
/** One step of a purchased service's journey, in words written for the client (no staff, notes or internal records). */
export interface ClientServiceStep {
  key: string;
  label: string;
  state: 'DONE' | 'CURRENT' | 'UPCOMING';
  /** The client-facing state of the step (derived by the database from stored facts, never typed by staff). Older servers omit it. */
  clientState?: ServiceStepClientState;
  /** Who the step waits on. */
  owner?: 'CUSTOMER' | 'TEAM' | 'META';
  description?: string | null;
  /** An optional step (for example an existing Blue Tick check) does not hold the others back and is not counted in the percent. */
  required?: boolean;
  /** When it was reached (done steps that have a date). */
  at: string | null;
  /** What is happening now / what the client may need to do (the current step only). */
  hint: string | null;
}
export type ServiceStepClientState = 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'COMPLETED' | 'NOT_APPLICABLE';
export type ServiceTrack = 'META' | 'TECHNICAL' | 'DIRECT';
export interface ClientServiceProgress {
  code: string;
  name: string;
  status: ClientServiceStatus;
  steps: ClientServiceStep[];
  /** The key of the current step; null when the service is live. */
  current: string | null;
  headline: string | null;
  /** How this service is onboarded: verified by Meta, by our Technical Consultant, or delivered directly. */
  track?: ServiceTrack;
  /** Applicable required steps only; 100 only when the service is live. */
  percent?: number;
  stepsDone?: number;
  stepsTotal?: number;
  actionRequired?: boolean;
  updatedAt?: string | null;
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
/** One invoice of an order, with the share of the order's confirmed money that covers it. */
export interface ClientBillingInvoice {
  id: string;
  number: string | null;
  total: number;
  allocated: number;
  balance: number;
  state: 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID';
  status: 'Paid' | 'Pending';
}
/** What the client owes for one order (the agreed order, or an add-on order): payable - confirmed = balance; pending money never reduces it. */
export interface ClientBillingOrder {
  key: string;
  kind: 'ORDER' | 'ADDON';
  title: string;
  /** Accounts has not yet chosen the GST rate: the payable amount is not final, so no balance is shown. */
  gstPending: boolean;
  gstRate: number | null;
  totalPayable: number;
  confirmed: number;
  /** Recorded by Accounts, waiting for verification. */
  pending: number;
  balance: number;
  state: 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID';
  invoicedTotal: number;
  /** Part of the payable amount no invoice covers yet. */
  notYetInvoiced: number;
  invoices: ClientBillingInvoice[];
}
export interface ClientBilling {
  orders: ClientBillingOrder[];
  totals: { payable: number; confirmed: number; pending: number; outstanding: number };
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
  journey: ClientJourney;
  services: { total: number; live: number; items: ClientService[] };
  plan: ClientPlans['current'];
  invoices: { total: number; pending: number; recent: ClientInvoice[] };
  tickets: { total: number; open: number; recent: ClientTicket[] };
  notifications: { unread: number; recent: ClientNotification[] };
  renewals: { kind: 'SERVICE' | 'PLAN'; name: string; renewsOn: string }[];
}
// ---- Onboarding journey: payment -> login -> Meta verification -> Relationship Manager -> service setup -> completed ----
export const JOURNEY_STAGE_KEYS = ['PAYMENT', 'META_VERIFICATION', 'RELATIONSHIP_MANAGER', 'SERVICE_SETUP', 'COMPLETED'] as const;
export type JourneyStageKey = (typeof JOURNEY_STAGE_KEYS)[number];
export type JourneyStageStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'ACTION_REQUIRED' | 'REJECTED';
export const META_STATUSES = ['PENDING', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED'] as const;
export type MetaStatus = (typeof META_STATUSES)[number];
export type ServiceSetupStatus = 'PENDING' | 'IN_PROGRESS' | 'READY';
/** The dashboard sections the database opens and closes by stage. */
export const CLIENT_SECTIONS = ['overview', 'journey', 'services', 'subscription', 'campaigns', 'explore', 'plans', 'calendar', 'documents', 'invoices', 'tickets', 'chat', 'notifications', 'docs'] as const;
export type ClientSectionKey = (typeof CLIENT_SECTIONS)[number];
export interface JourneyPerson { name: string; position: string | null }
export interface JourneyOutstandingItem { code: string; label: string; status: 'MISSING' | 'REJECTED'; note: string | null }
export interface JourneyServiceStatus {
  code: string;
  name: string;
  category: string;
  status: ServiceSetupStatus;
  /** What this service is waiting for ("Meta verification", "Verification by our team", "Relationship Manager assignment"); null when nothing blocks it. */
  waitingFor: string | null;
  readyAt: string | null;
  note: string | null;
  track?: ServiceTrack;
  headline?: string | null;
  percent?: number;
  actionRequired?: boolean;
  stepsDone?: number;
  stepsTotal?: number;
}
export type JourneyStage =
  | { key: 'PAYMENT'; status: JourneyStageStatus; current: boolean; completedAt: string | null; accountCreatedAt: string | null; accountEmail: string | null }
  | {
      key: 'META_VERIFICATION';
      status: JourneyStageStatus;
      current: boolean;
      required: boolean;
      /** True when a service of the customer is verified by Meta; false when our own team does the verification (the stage is then not called "Meta"). */
      external?: boolean;
      title?: string;
      metaStatus: MetaStatus | 'NOT_REQUIRED';
      startedAt: string | null;
      completedAt: string | null;
      feedback: string | null;
      updatedAt: string | null;
      outstanding: JourneyOutstandingItem[];
      verifier: JourneyPerson | null;
    }
  | { key: 'RELATIONSHIP_MANAGER'; status: JourneyStageStatus; current: boolean; required: boolean; completedAt: string | null; manager: JourneyPerson | null; teamLead: JourneyPerson | null }
  | { key: 'SERVICE_SETUP'; status: JourneyStageStatus; current: boolean; completedAt: string | null; services: JourneyServiceStatus[] }
  | { key: 'COMPLETED'; status: JourneyStageStatus; current: boolean; completedAt: string | null };
export interface ClientSectionAccess { enabled: boolean; reason: string | null }
export interface ClientJourney {
  stage: JourneyStageKey;
  completed: boolean;
  completedAt: string | null;
  /** From the applicable required steps of the purchased services; 100 only when onboarding is complete. */
  progress?: { done: number; total: number; percent: number };
  stages: JourneyStage[];
  chat: { active: ChatChannel; channels: { channel: ChatChannel; label: string; open: boolean; visible: boolean; with: JourneyPerson | null }[] };
  access: Record<ClientSectionKey, ClientSectionAccess>;
}
/** What the team sees of a customer's journey (Meta verification, verifier, Relationship Manager, each service). */
export type ExistingBlueTickStatus = 'NOT_PROVIDED' | 'CUSTOMER_REPORTED' | 'CONFIRMED' | 'COULD_NOT_CONFIRM';
/** A customer who already holds a Blue Tick and bought WhatsApp API only. It never changes the sale, the invoice or the badge. */
export interface ExistingBlueTick {
  applies: boolean;
  status: ExistingBlueTickStatus;
  reference: string | null;
  note: string | null;
  recordedAt: string | null;
  reviewedAt: string | null;
  reviewer: string | null;
  canReview: boolean;
}
export interface MetaOutcomeResult { status: MetaStatus; duplicate: boolean; outcome: 'APPROVED' | 'REJECTED' | 'NEEDS_INFO'; result: 'APPLIED' | 'ALREADY_COMPLETED' }
export interface CustomerJourneyStatus {
  applies: boolean;
  metaRequired: boolean;
  /** A service of the customer is verified by Meta (the verification is Meta's, not only our team's). */
  metaExternal?: boolean;
  existingBlueTick?: ExistingBlueTick | null;
  meta: {
    status: MetaStatus;
    feedback: string | null;
    changedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    verifier: { id: string; fullName: string } | null;
    canChange: boolean;
    canAssign: boolean;
    readyToComplete: boolean;
    /** The last status change was made by the database (documents sent, a document sent back, corrected), not by a person. */
    auto?: boolean;
    /** Required documents and details not yet authorized. */
    outstanding?: { code: string; label: string; status: 'MISSING' | 'SAVED' | 'REJECTED' }[];
  };
  relationshipManager: { id: string; fullName: string } | null;
  completedAt: string | null;
  services: {
    code: string; name: string; status: ServiceSetupStatus; note: string | null; updatedAt: string | null; readyAt: string | null; canChange: boolean;
    /** The setup was started by the database (payment, verification and the Relationship Manager done). */
    auto?: boolean;
    track?: ServiceTrack;
    progress?: ClientServiceProgress | null;
  }[];
}
// ---- Subscriptions: duration chosen by Sales, dates confirmed when the panel is activated, expiry calculated by the database ----
export const SUBSCRIPTION_DURATIONS = ['1M', '2M', '3M', '6M', '1Y', '2Y', 'CUSTOM'] as const;
export type SubscriptionDurationCode = (typeof SUBSCRIPTION_DURATIONS)[number];
export const SUBSCRIPTION_DURATION_LABEL: Record<SubscriptionDurationCode, string> = {
  '1M': '1 Month', '2M': '2 Months', '3M': '3 Months', '6M': '6 Months', '1Y': '1 Year', '2Y': '2 Years', CUSTOM: 'Custom'
};
export type SubscriptionStatus = 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED' | 'PAUSED' | 'CANCELLED';
export interface SubscriptionMessages {
  total: number;
  used: number;
  remaining: number;
  percent: number;
  asOf: string | null;
  /** false: no usage figures have been reported yet (the total is the credits Sales entered). */
  reported: boolean;
}
/** One service's subscription as the team sees it. Dates are empty until the panel activation is confirmed. */
export interface SubscriptionInfo {
  service: string;
  serviceName: string;
  category: string;
  plan: string | null;
  amount: number | null;
  panel: string | null;
  durationCode: SubscriptionDurationCode | null;
  durationMonths: number | null;
  durationDays: number | null;
  durationLabel: string | null;
  messageCredits: number | null;
  status: SubscriptionStatus;
  termsComplete: boolean;
  panelCreatedOn: string | null;
  startedOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  activatedAt: string | null;
  activatedBy: string | null;
  cycle: number;
  canSetTerms: boolean;
  canActivate: boolean;
  /** What is still missing before the subscription can start (null when nothing). */
  blocker: string | null;
  canCorrect: boolean;
  canRenew: boolean;
  canResendEmail: boolean;
  messages: SubscriptionMessages | null;
  email: { status: string; detail: string | null; sentAt: string | null; attempts: number; recipient: string | null } | null;
}
export interface SubscriptionHistoryItem {
  id: string;
  service: string;
  cycle: number | null;
  action: 'TERMS_SET' | 'ACTIVATED' | 'DATES_CORRECTED' | 'RENEWED' | 'EMAIL_RESENT';
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  reason: string | null;
  by: string | null;
  at: string;
}
export interface SubscriptionOverview {
  services: SubscriptionInfo[];
  history: SubscriptionHistoryItem[];
  cycles: { service: string; cycle: number; kind: 'INITIAL' | 'RENEWAL'; status: 'ACTIVE' | 'ENDED'; plan: string | null; durationLabel: string | null; startedOn: string; expiresOn: string }[];
  /** The customer's verified payments, for choosing the one that pays for a renewal. */
  payments: { id: string; amount: number; paidAt: string; method: string | null; used: boolean }[];
}
// ---- Subscriptions list of the Sales / Business Associate dashboard (read only) ----
export interface SubscriptionListItem {
  customerId: string;
  customer: string;
  contact: string;
  lifecycleStage: LifecycleStage;
  service: string;
  serviceName: string;
  plan: string | null;
  durationLabel: string | null;
  amount: number | null;
  messageCredits: number | null;
  status: SubscriptionStatus;
  panelCreatedOn: string | null;
  startedOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  paymentStatus: string | null;
  hasLogin: boolean;
}
export interface SubscriptionList {
  total: number;
  counts: { all: number; active: number; notStarted: number; expired: number; accountsCreated: number; pendingPayments: number };
  page: number;
  pageSize: number;
  items: SubscriptionListItem[];
}
/** What the client sees under My Subscription. */
export interface ClientSubscription {
  service: string;
  serviceName: string;
  plan: string | null;
  durationLabel: string | null;
  status: SubscriptionStatus;
  panelCreated: boolean;
  panelCreatedOn: string | null;
  startedOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  messages: SubscriptionMessages | null;
  messageCredits: number | null;
}
export interface UsageAlertSettings {
  enabled: boolean;
  thresholds: number[];
  canEdit: boolean;
}

/** What happened to the client's login when Accounts confirmed the payment. */
export interface ClientLoginOutcome {
  /** LATER: nothing was made or e-mailed; Accounts creates the login from Client Logins when ready. */
  status: 'CREATED' | 'EXISTS' | 'NOT_CREATED' | 'LATER';
  email?: string;
  mail?: 'SENT' | 'NOT_SENT';
  detail?: string;
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
export type LeaveStatus = 'PENDING_DEPARTMENT_HEAD' | 'PENDING_HR' | 'APPROVED' | 'REJECTED_BY_DEPARTMENT_HEAD' | 'REJECTED_BY_HR'
  // the multi-level chain (20261225000200)
  | 'PENDING_TEAM_LEAD' | 'PENDING_OPERATIONS_HEAD' | 'REJECTED_BY_TEAM_LEAD' | 'REJECTED_BY_OPERATIONS_HEAD' | 'REVISION_REQUIRED'
  // HR's own leave is approved by the Super Admin (20261228000200)
  | 'PENDING_SUPER_ADMIN' | 'REJECTED_BY_SUPER_ADMIN';
export interface LeaveDecision {
  name: string | null;
  at: string;
  note: string | null;
}
export interface LeaveRequest {
  /** Paid leave (deducted from the balance on final approval; migration 20261231000200). Absent before that migration. */
  paid?: boolean;
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
  /** The multi-level chain (20261225000200); absent on an older database. 1 = Department Head -> HR, 2 = the chain below. */
  workflowVersion?: number;
  stages?: LeaveStage[];
  /** The step waiting now (null once decided). */
  currentStage?: LeaveStage | null;
  /** Who can decide the waiting step (names only). */
  waitingFor?: string[] | null;
  revisionNote?: string | null;
  teamLead?: LeaveDecision | null;
  operationsHead?: LeaveDecision | null;
  /** The Super Admin's decision on HR's own leave (20261228000200). */
  superAdmin?: LeaveDecision | null;
  timeline?: LeaveTimelineEntry[];
}
export type LeaveStage = 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | 'OPERATIONS_HEAD' | 'HR' | 'SUPER_ADMIN';
export interface LeaveTimelineEntry {
  stage: LeaveStage | 'SUBMITTED' | 'RESUBMITTED';
  decision: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED';
  at: string;
  note: string | null;
  by: string | null;
  /** SUPER_ADMIN_EXCEPTION: nobody else could decide this step. */
  onBehalf: string | null;
}
export interface LeaveReview {
  awaiting: LeaveRequest[];
  decided: LeaveRequest[];
  canReviewAsDepartmentHead: boolean;
  canReviewAsHr: boolean;
  /** Anyone who can be a step of somebody's chain (absent on an older database). */
  canReview?: boolean;
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
  /** The first verification is done by a Meta Verifier (WhatsApp API, Blue Tick) instead of the Technical Consultant. */
  requiresMetaVerification?: boolean;
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

/** One message of the "account created" pair, as the Accounts queue shows it. */
export interface AccountNotificationState {
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  detail: string | null;
  sentAt: string | null;
  attempts: number;
}
export type ProvisioningFilter = 'ALL' | 'NOT_STARTED' | 'PENDING' | 'FAILED' | 'CREATED';
export type ClientEmailProblem = 'MISSING' | 'INVALID' | 'IN_USE';

/** A customer in the Accounts "Client logins" queue: the login Accounts creates for every service. */
export interface ProvisioningRow {
  customerId: string;
  code: string | null;
  name: string;
  company: string | null;
  /** The e-mail on the customer record - the only one the login is made with. */
  email: string | null;
  emailProblem: ClientEmailProblem | null;
  order: { services: string[]; dealAmount: number | null; verified: number; balance: number; paymentStatus: PaymentStatus | null };
  journey: JourneyKind;
  status: ClientLoginStatus;
  attempts: number;
  lastError: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
  loginEmail: string | null;
  /** How the login was made (LINK: set-password link; TEMPORARY: temporary password) and whether the client has since chosen their own. */
  accessMethod?: ClientAccessMethod | null;
  mustChangePassword?: boolean | null;
  passwordChangedAt?: string | null;
  notification: { email: AccountNotificationState | null; whatsapp: AccountNotificationState | null } | null;
  can: { create: boolean; fixEmail: boolean; resend: boolean };
}
export interface ProvisioningQueue extends Paginated<ProvisioningRow> {
  counts: Record<ProvisioningFilter, number>;
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
  /** CONFIRMING: Confirm was clicked, the employee's confirmation e-mail is not sent yet. APPROVED (Confirmed) only once it is sent. */
  status: 'PENDING' | 'CONFIRMING' | 'APPROVED' | 'DISMISSED';
  effectiveDate: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  note: string | null;
  /** Whether the signed-in user may approve / close it (HR lead, the department's HR, the employee's Department Head, Super Admin). */
  canDecide: boolean;
  /** The end date has passed and the confirmation is not completed (an unsent confirmation e-mail keeps it overdue). Older servers omit it. */
  overdue?: boolean;
  overdueRemindedAt?: string | null;
  /** The employee's confirmation e-mail, tracked separately from the confirmation status (null before Confirm). */
  email?: { status: HrEmailStatus; error: string | null; sentAt: string | null; sendAfter: string; attempts: number; nextAttemptAt: string } | null;
  /** Set after Confirm / Retry when the e-mail could not go out now (sending switched off, not configured, a temporary failure). */
  notice?: string;
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
// ---- Welcome e-mail of a new employee (HR / Super Admin / Department Head). Never carries a password, a link or a token. ----
export type WelcomeEmailStatus = 'PENDING' | 'PROCESSING' | 'RETRYING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'DRY_RUN';
export interface WelcomeEmailItem {
  id: string;
  employeeId: string;
  employee: string;
  email: string;
  department: string | null;
  designation: string | null;
  /** The account's own status (ACTIVE once approved / created). */
  accountStatus: string;
  emailType: 'WELCOME_LOGIN';
  triggerEvent: 'EMPLOYEE_REQUEST_APPROVED' | 'ACCOUNT_PROVISIONED' | 'MANUAL_RESEND';
  requestId: string | null;
  status: WelcomeEmailStatus;
  attempts: number;
  retryCount: number;
  resendCount: number;
  sentAt: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  lastResendAt: string | null;
  /** The employee chose their own password from the e-mailed link. */
  setupCompletedAt: string | null;
  canResend: boolean;
}
export interface WelcomeEmailList { items: WelcomeEmailItem[]; counts: Partial<Record<WelcomeEmailStatus, number>> }

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
/** A client conversation belongs to one channel: the Meta Verifier's (until Meta verification is completed) or the Relationship Manager's. */
export type ChatChannel = 'META' | 'RM';
export interface ChatConversation {
  id: string;
  kind: ChatKind;
  /** Client conversations only. */
  channel?: ChatChannel | null;
  access: ChatAccess;
  canWrite: boolean;
  /** Why nobody can write in this client conversation right now (null when it is live). */
  blockReason?: string | null;
  /** Client conversations: the assigned Meta Verifier (name and position only). */
  verifier?: ChatPerson | null;
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
  /** Client chat, employees only: who is handling it now (20270129000100). Never sent to the client. */
  handler?: ChatHandler | null;
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
  /** Encrypted chats only, set by the browser from inside the encrypted message: the key of the encrypted file (never sent to the server on its own). */
  secretKey?: string;
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
  replyTo: { id: string; seq: number; senderName: string | null; body: string; deleted?: boolean } | null;
  /** Deleted for everyone: only a tombstone is left (no text, no files, no ciphertext). */
  deleted?: boolean;
  /** End-to-end encrypted (internal chats): `body` is empty and `e2ee` holds what only the recipients' devices can open. */
  encrypted?: boolean;
  /** Who sealed an encrypted message (needed to check it); null for other messages. */
  senderId?: string | null;
  e2ee?: ChatE2eeForViewer | null;
  /** Set by the BROWSER after it opened (or failed to open) an encrypted message. The server never sets it. */
  secure?: ChatSecureState;
  /** Group members this message tags (migration 20270116000300). */
  mentions?: ChatTaggedPerson[];
  /** Reactions with counts, whether I reacted, and who reacted (one per person). */
  reactions?: ChatReaction[];
  /** Set on a send whose message was stored but whose tags were refused (e.g. someone left the group meanwhile). */
  mentionWarning?: string;
}
// ---- Chat: @mentions, reactions, Delete Inbox (migration 20270116000300) ----
export interface ChatTaggedPerson { id: string; name: string; me: boolean }
export interface ChatReaction { emoji: string; count: number; mine: boolean; people: ChatTaggedPerson[] }
export interface ChatReactResult { messageId: string; reactions: ChatReaction[] }
export interface ChatInboxDeleteResult { scope: 'MINE' | 'ALL_INTERNAL'; conversations: number; messages: number; filesRemoved?: number; filesPending?: number }
/** What the server hands to ONE member of an encrypted message: the ciphertext and the key sealed for that member. */
export interface ChatE2eeForViewer {
  v: 1;
  /** Key version of the sender. */
  sv: number;
  iv: string;
  ct: string;
  wrap: ChatE2eeWrap | null;
}
export interface ChatE2eeWrap {
  to: string;
  /** Version of the recipient's key the message key was sealed for. */
  kv: number;
  /** HPKE encapsulated key. */
  enc: string;
  /** The message key, sealed. */
  w: string;
}
/** What the browser made of an encrypted message. */
export type ChatSecureState =
  | { state: 'ok' }
  | { state: 'legacy' }
  | { state: 'failed'; reason: 'locked' | 'no-key' | 'old-key' | 'bad-signature' | 'damaged' | 'unknown-sender' };
export interface ChatMessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
  lastSeq: number;
  /** Messages the screen already has that were deleted for everyone meanwhile (only when asking for newer messages). */
  deletedIds?: string[];
}
export interface ChatKeyStatus {
  hasKey: boolean;
  version: number | null;
  publicKey: string | null;
  fingerprint: string | null;
  hasBackup: boolean;
  /** The key version the stored recovery backup belongs to (older than `version` after a new key was made on a device without the passphrase). */
  backupVersion?: number | null;
}
export interface ChatMemberKey {
  profileId: string;
  name: string;
  keyVersion: number | null;
  publicKey: string | null;
  fingerprint: string | null;
}
export interface ChatPublicKey {
  profileId: string;
  keyVersion: number;
  publicKey: string;
  fingerprint: string;
  retired: boolean;
}
/** The recovery-passphrase-encrypted private key(s). Opaque to the server. */
export interface ChatKeyBackupBlob {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}
export interface ChatKeyBackup {
  version: number;
  blob: ChatKeyBackupBlob;
}
export interface ChatDeleteResult {
  id: string;
  deleted?: boolean;
  hidden?: boolean;
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
  /** The employee's designation (or position); from migration 20261228000300, absent before it. */
  designation?: string | null;
  departmentId?: string | null;
}
/** Who is handling a client conversation or ticket right now (20270129000100). Information only; the Relationship Manager is never changed by it. */
export interface ChatHandler { id: string; name: string; at: string; active: boolean; me: boolean }
/** A client conversation on the shared Support desk: the department's customers for Support employees covering for a colleague. */
export interface ChatDeskClient extends Omit<ChatMyClient, 'role'> {
  role: ChatMyClient['role'] | 'Support desk';
  rm: { id: string; name: string } | null;
  handler: ChatHandler | null;
  lastSenderName: string | null;
  /** The client wrote last and no employee has answered yet. */
  awaitingReply: boolean;
  shared: true;
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
  channel?: ChatChannel;
  role: 'Relationship Manager' | 'Team Lead' | 'Meta Verifier' | 'Team Member' | 'Support group';
  /** 20261230000500: the client support group's name, when it was named. */
  groupName?: string | null;
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
// ---------------------------------------------------------------------------
// Field Visit (Sales: Telecaller, Business Associate, Sales Team Member)
// ---------------------------------------------------------------------------
/** The filters of the Field Visit lead table. */
export const FIELD_VISIT_FILTERS = ['ALL', 'MINE', 'DEPARTMENT', 'DH_ASSIGNED', 'TO_ACCOUNTS', 'RETURNED', 'VISIT_PENDING', 'VISIT_SCHEDULED', 'VISIT_COMPLETED', 'FOLLOW_UP'] as const;
export type FieldVisitFilter = (typeof FIELD_VISIT_FILTERS)[number];
export const FIELD_VISIT_FILTER_LABELS: Record<FieldVisitFilter, string> = {
  ALL: 'All Leads',
  MINE: 'My Leads',
  DEPARTMENT: 'Department Leads',
  DH_ASSIGNED: 'Department Head Assigned',
  TO_ACCOUNTS: 'To Accounts',
  RETURNED: 'Returned by Accounts',
  VISIT_PENDING: 'Field Visit Pending',
  VISIT_SCHEDULED: 'Visit Scheduled',
  VISIT_COMPLETED: 'Visit Completed',
  FOLLOW_UP: 'Follow-up Required'
};
export const LEAD_VISIT_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED'] as const;
export type LeadVisitStatus = (typeof LEAD_VISIT_STATUSES)[number];
export const LEAD_VISIT_STATUS_LABELS: Record<LeadVisitStatus | 'NOT_PLANNED', string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  CANCELLED: 'Cancelled',
  NOT_PLANNED: 'Not planned'
};
export const VISIT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type VisitPriority = (typeof VISIT_PRIORITIES)[number];
export interface FieldVisitOverview {
  totalAssigned: number;
  myLeads: number;
  todayScheduled: number;
  completed: number;
  pending: number;
  followUps: number;
  filters: Record<FieldVisitFilter, number>;
}
export interface FieldVisitAssignmentInfo {
  id: string;
  assignedAt: string;
  priority: VisitPriority;
  instructions: string | null;
  assignedBy: string | null;
}
export interface FieldVisitLeadRow {
  leadId: string;
  name: string;
  company: string | null;
  phone: string | null;
  leadSource: string | null;
  leadStatus: LeadStatus;
  paymentWorkflow: PaymentWorkflow;
  isMine: boolean;
  owner: { id: string; fullName: string } | null;
  department: string | null;
  assignment: FieldVisitAssignmentInfo | null;
  /** A visit can be scheduled for it: it is mine or the Department Head assigned it to me. */
  canVisit: boolean;
  visitId: string | null;
  visitDate: string | null;
  plannedTime: string | null;
  visitStatus: LeadVisitStatus | 'NOT_PLANNED';
  lastVisit: string | null;
  nextFollowUp: string | null;
}
export interface FieldVisitLeadList {
  filter: FieldVisitFilter;
  total: number;
  page: number;
  pageSize: number;
  items: FieldVisitLeadRow[];
}
export interface FieldVisitAssignedRow {
  id: string;
  leadId: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  leadSource: string | null;
  leadStatus: LeadStatus;
  paymentWorkflow: PaymentWorkflow;
  services: string;
  assignedAt: string;
  assignedBy: string | null;
  priority: VisitPriority;
  instructions: string | null;
  department: string | null;
  owner: { id: string; fullName: string } | null;
  isMine: boolean;
  canVisit: boolean;
  visits: number;
  openVisitId: string | null;
  openVisitStatus: LeadVisitStatus | null;
}
export interface FieldVisitAssignedList {
  total: number;
  page: number;
  pageSize: number;
  items: FieldVisitAssignedRow[];
}
export interface LeadVisit {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  phone: string | null;
  visitDate: string;
  plannedTime: string | null;
  address: string | null;
  purpose: string;
  status: LeadVisitStatus;
  notes: string | null;
  outcome: string | null;
  requirements: string | null;
  nextSteps: string | null;
  nextFollowUp: string | null;
  cancelReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** True only when the device sent its position when the visit started. Never "verified". */
  gpsCaptured: boolean;
  checkinLat: number | null;
  checkinLng: number | null;
  checkinAccuracyM: number | null;
  checkinAt: string | null;
  locationNote: string | null;
  assignedBy: string | null;
  assignmentId: string | null;
  employee: { id: string; fullName: string };
  taskId: string | null;
  /** Live location for this visit (migration 20261228000100); absent before it runs. */
  trackingStatus?: VisitTrackingStatus;
  trackingStartedAt?: string | null;
  trackingStoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LeadVisitList {
  total: number;
  page: number;
  pageSize: number;
  items: LeadVisit[];
}
export interface SalesVisitAssignee {
  id: string;
  name: string;
  team: string;
  role: string;
}

/** The five filters of the Lead section of a Telecaller and a Business Associate. */
export const LEAD_SCOPES = ['ALL', 'MINE', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED'] as const;
export type LeadScope = (typeof LEAD_SCOPES)[number];
export const LEAD_SCOPE_LABELS: Record<LeadScope, string> = {
  ALL: 'All Leads',
  MINE: 'My Leads',
  DEPARTMENT: 'Department Leads',
  TO_ACCOUNTS: 'To Accounts',
  RETURNED: 'Returned by Accounts'
};
export interface LeadScopeCounts {
  all: number;
  mine: number;
  department: number;
  toAccounts: number;
  returned: number;
}
/** What the Accounts workflow recorded for a lead that is with Accounts or was returned by them. */
export interface LeadAccountsInfo {
  /** PENDING: with Accounts. RETURNED: Accounts returned it. */
  status: 'PENDING' | 'CONFIRMED' | 'RETURNED';
  amount: number | null;
  submittedBy: string | null;
  submittedAt: string | null;
  salesNote: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  reason: string | null;
}
export interface LeadScopeRow extends TelecallerLead {
  leadStatus: LeadStatus;
  nextFollowUpAt: string | null;
  paymentWorkflow: PaymentWorkflow;
  /** The lead is mine: only then can it be edited or sent to Accounts. The others are read-only. */
  isMine: boolean;
  owner: { id: string; fullName: string } | null;
  accounts: LeadAccountsInfo | null;
}
export interface LeadScopeList {
  scope: LeadScope;
  total: number;
  page: number;
  pageSize: number;
  sources: string[];
  /** Leads of this filter per lead status (not narrowed by search or status). */
  statusCounts: Partial<Record<LeadStatus, number>>;
  items: LeadScopeRow[];
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
  /** The authorised person of the client attended (20270119000100): a completed demo earns its incentive only with this tick. */
  authorisedPersonAttended?: boolean;
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
// ---- Business Associate: client research (web) — suggestions for the profile fields (20270225000100)
export interface BaClientResearchUsage {
  tavilyCredits?: number;
  tavilySearches?: number;
  tavilyPages?: number;
  claudeModel?: string;
  claudeInputTokens?: number;
  claudeOutputTokens?: number;
  claudeWebSearches?: number;
  estimatedUsd?: number;
  fallbackReason?: string;
}
export interface BaClientResearch {
  id: string;
  contactId: string;
  provider: 'TAVILY' | 'CLAUDE';
  suggestions: import('./baContent').ResearchSuggestions;
  sources: import('./baContent').ResearchSource[];
  usage: BaClientResearchUsage;
  createdAt: string;
  /** true when this is a stored result (no new web search was made) */
  cached: boolean;
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
  role: 'Team Lead' | 'Team Member' | 'Department Head';
  /** (20270303000100) DEPARTMENT_HEAD is offered to a Sales CEO only; the department is the recipient's */
  kind?: 'DEPARTMENT_HEAD' | 'TEAM_LEAD' | 'TEAM_MEMBER' | 'TELECALLER';
  departmentId?: string;
  department?: string;
  subRole: SalesSubRole | null;
  /** TELECALLER: the contacts go to their call list; LEADS: the rows become leads in their own pipeline (20270101000400) */
  mode: 'TELECALLER' | 'LEADS';
  openContacts: number;
  /** leads they have open now (older databases do not send it) */
  openLeads?: number;
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
export interface SalesSheetIssue {
  row: number;
  kind: 'INVALID' | 'DUPLICATE';
  message: string;
  /** the values that were sent for the row (20270101000400; not on older databases) */
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
}
/** The rows left out of one uploaded sheet; kept is false for sheets uploaded before they were kept. */
export interface SalesSheetIssues { id: string; fileName: string; kept: boolean; issues: SalesSheetIssue[] }
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
// ---- Sales CEO -> Department Head (20270303000100): the sheets a Department Head received, and who they can forward them to
export interface SalesReceivedSheet {
  id: string;
  fileName: string;
  note: string | null;
  assignedAt: string;
  assignedBy: string | null;
  /** "CEO", or the uploader's role */
  assignedByRole: string | null;
  departmentId: string;
  department: string | null;
  valid: number;
  /** still leads, still owned by the Department Head */
  openWithMe: number;
  forwarded: number;
  converted: number;
}
export interface SalesForwardAssignee { id: string; name: string; team: string; role: string; openLeads: number }
export interface SalesForwardResult { moved: number; assignee: { id: string; name: string; role: string } }
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
  /** Telecaller, Team Lead, Team Member or Department Head (20270101000400, 20270303000100) */
  assigneeRole?: string;
  departmentId?: string;
  department?: string;
  /** whether the left-out rows are kept with the sheet (sheets from before 20270101000400: no) */
  issuesKept?: boolean;
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

/** The Super Admin's review of Department Heads who work in several departments (see docs/ROLES_AND_LIFECYCLE.md). */
export interface OperationsHeadReviewItem {
  profileId: string;
  name: string;
  email: string;
  homeDepartment: string | null;
  isOperationsHead: boolean;
  /** Not an Operations Head, yet holds extra departments from before the role existed: kept as they were until the Super Admin decides. */
  needsDecision: boolean;
  extraDepartments: { departmentId: string; department: string; division: HeadDivision; transition: boolean }[];
}

/** One department in the Operations Head's overview. */
export interface OperationsOverviewRow {
  departmentId: string;
  name: string;
  slug: string;
  people: number;
  leads: number;
  onboarding: number;
  customers: number;
  awaitingDepartmentHead: number;
  withVerifier: number;
}

// ---- Meta Verifier, hand-over to the Department Head and the Technical Consultant's follow-up ---------------------------------------

export type VerificationRoute = 'META' | 'TECHNICAL';
/** Customers caught between the old and the current hand-over workflow (for the Super Admin and Department Heads). */
export interface HandoverReconciliation {
  /** Everything is authorized but nobody has sent the customer on yet: it waits in the Meta Verifier's queue. */
  verifiedNotSent: { customerId: string; customer: string; department: string; sentForVerificationAt: string | null }[];
  /** Handed over by a Meta Verifier, but no consultation follow-up was ever made. */
  handedOverWithoutFollowUp: { customerId: string; customer: string; department: string; handedOverAt: string | null; stage: HandoverStage }[];
}
export const VERIFICATION_OUTCOMES = ['NOTE', 'PENDING', 'NEEDS_CORRECTION', 'VERIFIED'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
export interface VerificationNote {
  id: string;
  outcome: VerificationOutcome;
  body: string;
  createdAt: string;
  author: string | null;
}
/** The internal WhatsApp panel details of a customer's WhatsApp service (the account / user ID only - never a password), and the Accounts-owned dashboard login, read only. */
export interface PanelDetailsService {
  code: string;
  name: string;
  platform: string | null;
  panelAccount: string | null;
  /** The Client Panel URL of this service (HTTPS, no credentials in it), or null. */
  panelUrl?: string | null;
  /** The e-mail that carried the panel link: when, by whom, whether the saved URL is still the one that was sent, and the e-mail's state. */
  link?: {
    sentAt: string;
    sentBy: string | null;
    current: boolean;
    email: { status: string; detail: string | null; sentAt: string | null; to: string | null } | null;
  } | null;
  /** Whether a panel password was set for the customer, and what happened to the e-mail that carried it. Never the password. */
  credentials?: {
    setAt: string;
    setBy: string | null;
    email: { status: string; detail: string | null; sentAt: string | null; to: string | null } | null;
  } | null;
}
export interface PanelDetails {
  canEdit: boolean;
  services: PanelDetailsService[];
  /** The address a panel password is e-mailed to (the one on the customer record), or null when there is none. */
  customerEmail?: string | null;
  dashboardLogin: { email: string; createdAt: string } | null;
}
export type ClientAccessMethod = 'LINK' | 'TEMPORARY';
/** A customer already in verification whose services say another route than the one it has: for the Super Admin or the Department Head to decide. */
export interface VerificationRouteReviewItem {
  customerId: string;
  name: string;
  department: string;
  route: VerificationRoute | null;
  suggestedRoute: VerificationRoute;
  reviewState: string | null;
}

export const FOLLOWUP_CHANNELS = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER'] as const;
export type FollowUpChannel = (typeof FOLLOWUP_CHANNELS)[number];
export const TC_FOLLOWUP_OUTCOMES = ['NO_ANSWER', 'CALL_BACK', 'CONTACTED', 'ADDON_INTERESTED', 'NOT_INTERESTED', 'COMPLETED'] as const;
export type TcFollowUpOutcome = (typeof TC_FOLLOWUP_OUTCOMES)[number];
export type TcFollowUpStatus = 'AWAITING_CONFIGURATION' | 'SCHEDULED' | 'DUE' | 'DONE' | 'CANCELLED';
export interface TcFollowUp {
  id: string;
  customerId: string;
  customer: string;
  contact: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  services: string[];
  status: TcFollowUpStatus;
  /** SCHEDULED whose date has passed shows as DUE even before the scheduled job has run. */
  effectiveStatus: TcFollowUpStatus;
  dueAt: string | null;
  eligibleAt: string;
  reason: string | null;
  lastOutcome: TcFollowUpOutcome | null;
  assignedTo: { id: string; name: string } | null;
  handedOverBy: string | null;
  handoverNote: string | null;
  contacts: number;
  lastContact: { at: string; outcome: TcFollowUpOutcome; channel: FollowUpChannel; note: string | null } | null;
  cancelledReason: string | null;
}
export interface WorkflowSettings {
  /** null until the Super Admin sets it: the business has not decided how many days the consultant waits. */
  tcFollowupDelayDays: number | null;
  updatedAt: string;
  canEdit: boolean;
  /** Follow-ups waiting for the delay to be set (in the caller's scope). */
  awaiting: number;
}


// ---------------------------------------------------------------------------
// Accounts: Customer-wise Revenue (migration 20261209000200). Purchased, invoiced, collected, pending and outstanding are different things.
// ---------------------------------------------------------------------------
export const CUSTOMER_REVENUE_SORTS = ['PURCHASED', 'INVOICED', 'COLLECTED', 'PENDING', 'OUTSTANDING', 'ORDERS', 'NAME'] as const;
export type CustomerRevenueSort = (typeof CUSTOMER_REVENUE_SORTS)[number];
export interface CustomerRevenueRow {
  customerId: string;
  code: string | null;
  name: string;
  company: string | null;
  services: string[];
  orders: number;
  /** What was ordered (billed on the customer's orders). Not income. */
  purchased: number;
  /** What the customer's non-cancelled invoices add up to. Not income. */
  invoiced: number;
  invoiceCount: number;
  /** GST on those invoices. */
  gstInvoiced: number;
  /** Verified money received: the only figure that is collected income. */
  collected: number;
  /** Recorded but not yet verified. */
  pending: number;
  refunded: number;
  /** Per order: ordered - collected (never below zero), added up. */
  outstanding: number;
  /** Verified money in the ledger that sits on no known order (shown apart, never added to an order). */
  receiptsWithoutOrder: number;
  lastOrderAt: string | null;
}
export interface CustomerRevenuePage {
  total: number;
  page: number;
  pageSize: number;
  totals: { customers: number; orders: number; purchased: number; invoiced: number; collected: number; pending: number; refunded: number; outstanding: number; receiptsWithoutOrder: number };
  top: { customerId: string; name: string; purchased: number; collected: number }[];
  items: CustomerRevenueRow[];
}

// ---------------------------------------------------------------------------
// Accounts: the e-mails to Department Heads about payments and expenses (migration 20261209000300)
// ---------------------------------------------------------------------------
export type FinanceMailStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'NO_RECIPIENT' | 'CANCELLED';
export interface FinanceMailItem {
  id: string;
  kind: 'PAYMENT_RECORDED' | 'PAYMENT_VERIFIED' | 'EXPENSE_ADDED';
  status: FinanceMailStatus;
  detail: string | null;
  attempts: number;
  department: string;
  departmentId: string;
  recipient: string | null;
  to: string | null;
  sentAt: string | null;
  createdAt: string;
  customer: string | null;
  amount: number | null;
  canRetry: boolean;
}
export interface FinanceMailList {
  counts: Partial<Record<FinanceMailStatus, number>>;
  items: FinanceMailItem[];
}

// ---------------------------------------------------------------------------
// Employee issues and HR meeting requests (one page for Team Members, Team Leads and Department Heads; two sections for HR)
// ---------------------------------------------------------------------------
export const ISSUE_CATEGORIES = ['WORKPLACE', 'HR_POLICY', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'TEAM_MANAGEMENT', 'TECHNICAL_SYSTEM', 'FACILITIES', 'OTHER'] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  WORKPLACE: 'Workplace Issue', HR_POLICY: 'HR or Policy Concern', ATTENDANCE_LEAVE: 'Attendance or Leave', SALARY_PAYROLL: 'Salary or Payroll',
  TEAM_MANAGEMENT: 'Team or Management Concern', TECHNICAL_SYSTEM: 'Technical or System Issue', FACILITIES: 'Workplace Facilities', OTHER: 'Other'
};
export const ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
export const ISSUE_STATUSES = ['NEW', 'IN_PROGRESS', 'AWAITING_EMPLOYEE', 'RESOLVED', 'CLOSED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
/** HR's wording; the employee's own page says "Waiting for your reply" for AWAITING_EMPLOYEE. */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  NEW: 'New', IN_PROGRESS: 'In Progress', AWAITING_EMPLOYEE: 'Awaiting Employee Response', RESOLVED: 'Resolved', CLOSED: 'Closed'
};
export const MEETING_CATEGORIES = ['HR_CONCERN', 'WORKPLACE_ISSUE', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'MANAGEMENT', 'PERSONAL_CONFIDENTIAL', 'OTHER'] as const;
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number];
export const MEETING_CATEGORY_LABELS: Record<MeetingCategory, string> = {
  HR_CONCERN: 'HR Concern', WORKPLACE_ISSUE: 'Workplace Issue', ATTENDANCE_LEAVE: 'Attendance or Leave', SALARY_PAYROLL: 'Salary or Payroll',
  MANAGEMENT: 'Management Discussion', PERSONAL_CONFIDENTIAL: 'Personal or Confidential Concern', OTHER: 'Other'
};
export const MEETING_STATUSES = ['PENDING', 'SCHEDULED', 'ALTERNATIVE_PROPOSED', 'DECLINED', 'CANCELLED', 'COMPLETED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  PENDING: 'Pending', SCHEDULED: 'Scheduled', ALTERNATIVE_PROPOSED: 'Another time proposed', DECLINED: 'Declined', CANCELLED: 'Cancelled', COMPLETED: 'Completed'
};
export const MEETING_MODES = ['IN_PERSON', 'ONLINE'] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];
export const MEETING_MODE_LABELS: Record<MeetingMode, string> = { IN_PERSON: 'In Person', ONLINE: 'Online' };
/** What HR can do with a meeting request (the database checks each against the request's current status). */
export const MEETING_ACTIONS = ['APPROVE', 'DECLINE', 'PROPOSE', 'RESCHEDULE', 'CANCEL', 'COMPLETE'] as const;
export type MeetingAction = (typeof MEETING_ACTIONS)[number];

export interface CaseEmployee { id: string; name: string; employeeCode: string; departmentId: string | null; department: string | null; designation: string | null }
export interface CaseHr { id: string; name: string }
/** The employee details a form shows (read from the signed-in employee's own profile). */
export interface CaseMyDetails { id: string; name: string; code: string; departmentId: string | null; department: string | null; designation: string | null }
export interface EmployeeIssue {
  id: string;
  reference: string;
  title: string;
  category: IssueCategory;
  priority: IssuePriority;
  status: IssueStatus;
  /** Only in the detail (the lists never carry the text). */
  description: string | null;
  preferredResolution: string | null;
  hrResponse: string | null;
  hrResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  assignedHr: CaseHr | null;
  employee: CaseEmployee;
  /** Set when a submission was recognised as one that already exists. */
  duplicate?: boolean;
  /** Issue routing (20270128000200): an employee issue goes to HR; HR may escalate it to the Developer Team (one linked issue) */
  recipient?: 'HR';
  routing?: 'WITH_HR' | 'ESCALATED_TO_DEVELOPERS';
  escalation?: { bugId: string; reference: string; status: DevBugStatus; assigneeName: string | null; resolutionNote: string | null;
    updatedAt: string; escalatedAt: string | null; escalatedBy: string | null } | null;
}
export interface CaseEvent {
  id: number;
  kind: string;
  /** EMPLOYEE: the employee reads it; HR: an internal note, only HR ever gets it. */
  visibility: 'EMPLOYEE' | 'HR';
  side: 'EMPLOYEE' | 'HR' | 'DEVELOPER';
  actorName: string | null;
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}
export interface IssueAttachment { id: string; name: string; mime: string; size: number; eventId: number | null; createdAt: string }
export interface EmployeeIssueDetail { issue: EmployeeIssue; events: CaseEvent[]; attachments: IssueAttachment[];
  /** HR: what the Developer Team told the reporter about the escalated issue (status changes, replies), never internal comments */
  escalationHistory?: DevBugHistoryEntry[]; duplicate?: boolean }
export interface EmployeeIssueList { items: EmployeeIssue[]; total: number; limit: number; offset: number }
export interface EmployeeIssueOverview { total: number; new: number; inProgress: number; awaiting: number; resolved: number; closed: number; urgent: number; escalated?: number }
export interface HrAssignee { id: string; name: string; designation: string }
export interface CaseDepartment { id: string; name: string }
export interface IssueUploadTicket {
  attachment: { id: string; name: string; mime: string; size: number };
  bucket: string;
  path: string;
  provider: 'R2' | 'SUPABASE';
  token: string;
  upload?: { url: string; headers: Record<string, string> };
}

export interface EmployeeMeeting {
  id: string;
  reference: string;
  subject: string;
  category: MeetingCategory;
  status: MeetingStatus;
  description: string | null;
  notes: string | null;
  preferredDate: string;
  preferredTime: string;
  mode: MeetingMode;
  confirmedDate: string | null;
  confirmedTime: string | null;
  confirmedMode: MeetingMode | null;
  location: string | null;
  link: string | null;
  instructions: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  hrResponse: string | null;
  hrResponseAt: string | null;
  /** Why it was declined, cancelled or rescheduled. */
  reason: string | null;
  /** HR only: what was discussed and what happens next (null for the employee). */
  outcome: string | null;
  followUp: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignedHr: CaseHr | null;
  employee: CaseEmployee;
  duplicate?: boolean;
}
export interface EmployeeMeetingDetail { meeting: EmployeeMeeting; events: CaseEvent[] }
export interface EmployeeMeetingList { items: EmployeeMeeting[]; total: number; limit: number; offset: number }
export interface EmployeeMeetingOverview { total: number; pending: number; scheduled: number; completed: number; declinedOrCancelled: number }

// ---- Employee approval hierarchy ---------------------------------------------------------------------------------------------------------
export type EmployeeRequestRoleKey = 'OPERATIONS_HEAD' | 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER';
export type EmployeeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface EmployeeRequest {
  id: string;
  status: EmployeeRequestStatus;
  source: 'HR' | 'MANAGER';
  attempt: number;
  resubmissionOf: string | null;
  requestedRole: EmployeeRequestRoleKey;
  department: { id: string; name: string; slug: string } | null;
  division: 'SALES' | 'SUPPORT' | 'GENERAL' | null;
  employee: { id: string; name: string; email: string; status: string; designation: string | null; joiningDate: string | null; contactNumber: string | null; employeeCode: string | null } | null;
  submittedBy: { id: string; name: string } | null;
  submittedAt: string;
  approverKind: 'SUPER_ADMIN' | 'OPERATIONS_HEAD' | 'DEPARTMENT_HEAD' | null;
  approver: { id: string; name: string } | null;
  /** A Department Head request in a department nobody is accountable for yet: it waits for the Super Admin to name the Operations Head. */
  awaitingOwner: boolean;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The signed-in person is the right approver and the request is still pending. */
  canDecide: boolean;
  history?: { id: string; attempt: number; status: EmployeeRequestStatus; decidedAt: string | null; decisionNote: string | null; decidedBy: string | null; submittedAt: string }[];
}

export interface OperationsHeadAdmin {
  id: string;
  name: string;
  email: string;
  status: string;
  homeDepartment: { id: string; name: string } | null;
  /** The operations function (20261224000100): SALES, SUPPORT, or null = both. Absent on an older database. */
  function?: OperationsFunction;
  /** `function`: what the person reaches in that department; `narrowed`: a narrower side set for that department only. */
  departments: { id: string; name: string; slug: string; primary: boolean; function?: OperationsFunction; narrowed?: OperationsFunction }[];
  pendingApprovals: number;
  lastLoginAt: string | null;
}
export interface OperationsHeadsAdmin {
  heads: OperationsHeadAdmin[];
  /** Departments nobody is accountable for: a Department Head request there cannot be routed. */
  unowned: { id: string; name: string; pendingRequests: number }[];
  departments: { id: string; name: string; slug: string; owner: { id: string; name: string } | null }[];
}
export interface OperationsActivityEntry { at: string; action?: string; type?: string; reference: string; department: string | null; by?: string | null; departmentHead?: string | null; outcome?: string }

export interface OperationsDashboardDepartment {
  id: string;
  name: string;
  slug: string;
  accountable: boolean;
  departmentHeads: { id: string; name: string; email: string; status: string; side: string | null; lastLoginAt: string | null }[];
  teamLeads: number;
  teamMembers: number;
  awaitingAssignment: number;
  pendingDepartmentHeadApprovals: number;
  leads: number;
  onboarding: number;
  customers: number;
  awaitingDepartmentHead: number;
  withVerifier: number;
}
export interface OperationsDashboard {
  departments: OperationsDashboardDepartment[];
  totals: { departments: number; departmentHeads: number; teamLeads: number; teamMembers: number; awaitingAssignment: number; pendingDepartmentHeadApprovals: number };
}
export interface OperationsDepartmentDetail {
  teamLeads: { id: string; name: string; team: string | null; division: string | null; members: number }[];
  awaitingAssignment: { id: string; name: string; email: string; approvedAt: string | null }[];
}

export type DirectoryMemberState = 'AWAITING_ASSIGNMENT' | 'ASSIGNED' | 'INACTIVE';
export interface DepartmentDirectoryMember {
  id: string;
  name: string;
  email: string;
  status: string;
  approvedAt: string | null;
  team: { id: string; name: string; division: string; isPool: boolean };
  lead: { id: string; name: string } | null;
  state: DirectoryMemberState;
  lastAssignment: { kind: string; at: string; by: string | null } | null;
}
export interface DepartmentEmployeeDirectory {
  department: { id: string; name: string } | null;
  headDivision: string | null;
  members: DepartmentDirectoryMember[];
  leads: { id: string; name: string; status: string; team: { id: string; name: string; division: string }; members: number }[];
}
export interface TeamAssignmentRecord { id: string; kind: string; note: string | null; createdAt: string; fromTeam: string | null; toTeam: string | null; lead: string | null; assignedBy: string | null }

// ---- Work reports (Team Member -> Team Lead -> Department Head -> Operations Head) ----
export type { ReportKind, ReportPeriodType, ReportStatus } from './reportFields.js';
import type { ReportFieldKey, ReportKind as WorkReportKind, ReportPeriodType as WorkReportPeriod, ReportStatus as WorkReportStatus, WeeklyReportStatus, PerformanceStage } from './reportFields.js';

export interface ReportAttachment { name?: string; url: string }
/** A task of the member as it was when the report was saved (the real record lives in work_tasks). */
export interface WorkReportTask { id: string; title: string; status: string; priority?: string; dueDate?: string | null; completedAt?: string | null }
export type WorkReportContent = Partial<Record<ReportFieldKey, string>> & { attachments?: ReportAttachment[]; assignedTasks?: WorkReportTask[]; completedTasks?: WorkReportTask[] };
/** One task the member can pick for a report (work_reports_my_tasks). */
export interface ReportTaskOption { id: string; title: string; status: string; priority: string; dueDate: string | null; progress: number; completedAt: string | null; assignedAt: string }
export type ReportApprovalStage = 'TEAM_LEAD' | 'DEPARTMENT_HEAD';
export type ReportStageStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED';

/** A report as the lists show it (a short excerpt instead of the whole content). */
export interface WorkReportSummary {
  id: string;
  kind: WorkReportKind;
  authorId: string | null;
  author: string;
  designation: string | null;
  departmentId: string;
  department: string | null;
  teamId: string | null;
  team: string | null;
  title: string;
  reportDate: string;
  periodType: WorkReportPeriod;
  periodStart: string;
  periodEnd: string;
  status: WorkReportStatus;
  revision: number;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  /** The standard form: how many tasks were assigned / completed and the short remark. */
  assignedCount?: number;
  completedCount?: number;
  remarks?: string;
  /** Team Member reports: the two approval stages (each with its own reviewer, time and comment). Absent on a database without the second migration. */
  teamLead?: string | null;
  tlStatus?: ReportStageStatus | null;
  tlReviewer?: string | null;
  tlReviewedAt?: string | null;
  tlComment?: string | null;
  dhStatus?: ReportStageStatus | null;
  dhReviewer?: string | null;
  dhReviewedAt?: string | null;
  dhComment?: string | null;
  /** Which stage made the last decision (shown with a rejection or a revision request). */
  decisionStage?: ReportApprovalStage | null;
}
export interface WorkReportEvent {
  at: string;
  actor: string;
  action: 'CREATED' | 'SUBMITTED' | 'RESUBMITTED' | 'OPENED' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED';
  fromStatus: string | null;
  toStatus: string | null;
  comment: string | null;
  revision: number;
  stage?: ReportApprovalStage | null;
}
export interface WorkReportDetail extends WorkReportSummary {
  content: WorkReportContent;
  canEdit?: boolean;
  canReview?: boolean;
  /** Which approval the caller may give right now (Team Lead or Department Head). */
  reviewStage?: ReportApprovalStage | null;
  events?: WorkReportEvent[];
}
export type ReportLevel = 'MEMBER' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | 'OPERATIONS_HEAD' | 'SUPER_ADMIN';
export interface ReportContext {
  level: ReportLevel;
  canWrite: boolean;
  name: string;
  team: string | null;
  reportsTo: { id: string; name: string }[];
  pendingReview: number;
  /** Department Head: Team Lead reports waiting / Team Member reports the Team Leads approved and that wait for the head. */
  pendingLeadReports?: number;
  pendingMemberApprovals?: number;
  /** Department Head: weekly reports sent back; Operations Head: weekly reports waiting for approval. */
  weeklyPending?: number;
  needsRevision: number;
  badge: number;
}
/** The Team Member reports a Department Head approves (stage 2), with the counts per status. */
export interface MemberApprovalList {
  items: WorkReportDetail[];
  counts: Partial<Record<WorkReportStatus, number>>;
}
export interface ReportInbox {
  items: WorkReportSummary[];
  counts: Partial<Record<WorkReportStatus, number>>;
}
/** pending = not finished (either stage); pendingTl / pendingDh say which stage it waits at. approved = fully approved (both stages). */
export interface ReportCounts { submitted: number; approved: number; pending: number; revision: number; rejected: number; pendingTl?: number; pendingDh?: number }
/** One Team Lead's box: the lead's own reports and the team's member reports with their true status (fully approved only after both approvals). */
export interface TeamLeadBox {
  leadId: string;
  lead: string;
  teamId: string | null;
  team: string | null;
  totalMembers: number;
  counts: ReportCounts;
  leadReports: WorkReportDetail[];
  memberReports: WorkReportDetail[];
  /** Status of the lead's own report in the period, shown even while the reports themselves are not released. */
  leadReportStatus: WorkReportStatus | null;
  lastSubmittedAt: string | null;
}
export interface TeamBoxMember {
  id: string;
  name: string;
  designation: string | null;
  counts: ReportCounts;
  reports: WorkReportSummary[];
}
export interface TeamReportBox {
  teamId: string | null;
  team: string | null;
  teamLead: string;
  periodStart: string;
  periodEnd: string;
  totalMembers: number;
  counts: ReportCounts;
  members: TeamBoxMember[];
  myReports: WorkReportSummary[];
}
export interface ReportPackage {
  status: WeeklyReportStatus | 'NOT_SUBMITTED';
  id?: string;
  title?: string | null;
  assignedOverview?: string | null;
  completedOverview?: string | null;
  note?: string | null;
  revision?: number;
  submittedBy?: string | null;
  submittedAt?: string;
  periodType?: WorkReportPeriod;
  periodStart?: string;
  periodEnd?: string;
  /** The figures stored when the Department Head submitted the week. */
  stats?: ReportStats | null;
  ohReviewer?: string | null;
  ohReviewedAt?: string | null;
  ohComment?: string | null;
  sentToHrAt?: string | null;
  hrCompletedAt?: string | null;
  /** The function of the week (20261230000200): SALES / SUPPORT, or ALL for the whole department. */
  function?: WeeklyReportFunction;
  events?: { at: string; actor: string; action: string; fromStatus: string | null; toStatus: string | null; comment: string | null; revision: number }[];
}
export interface DepartmentReportBox {
  departmentId: string;
  department: string | null;
  departmentHead: string;
  periodStart: string;
  periodEnd: string;
  teams: TeamLeadBox[];
  package: ReportPackage;
  myReports: WorkReportSummary[];
}
export interface OperationsDepartmentRow {
  id: string;
  name: string;
  slug: string;
  departmentHeads: string[];
  teamLeads: number;
  teamMembers: number;
  counts: {
    submitted: number;
    memberApproved: number;
    memberPending: number;
    memberPendingTl?: number;
    memberPendingDh?: number;
    memberRevision?: number;
    memberRejected?: number;
    teamLeadReports: number;
    headReports: number;
    headPending: number;
  };
  headReportStatus: WorkReportStatus | null;
  lastSubmittedAt: string | null;
  package: ReportPackage;
}
export interface OperationsReportBoard { periodStart: string; periodEnd: string; departments: OperationsDepartmentRow[] }
export interface ReportsDepartmentDetail {
  departmentId: string;
  department: string | null;
  periodStart: string;
  periodEnd: string;
  package: ReportPackage;
  /** False until the Department Head forwards the package for the period: only counts are shown before that. */
  released: boolean;
  packages: { id: string; periodType: WorkReportPeriod; periodStart: string; periodEnd: string; submittedAt: string; status?: WeeklyReportStatus }[];
  /** The period's figures worked out from the individual reports (team by team inside). */
  stats?: ReportStats;
  departmentHeads: { id: string; name: string; designation: string | null; reports: WorkReportSummary[] }[];
  teamLeads: TeamLeadBox[];
}

// ---------------------------------------------------------------------------
// Technical Consultant and Meta Verifier: two independent statuses on one customer
// ---------------------------------------------------------------------------
export const TC_WORKFLOW_STATUSES = [
  'NEW_LEAD', 'VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED', 'WAITING_FOR_CUSTOMER_PURCHASE',
  'PAYMENT_CONFIRMATION_PENDING', 'ADDON_PURCHASED', 'TECHNICAL_PROCESSING', 'COMPLETED', 'ON_HOLD'
] as const;
export type TcWorkflowStatus = (typeof TC_WORKFLOW_STATUSES)[number];
export const META_WORKFLOW_STATUSES = [
  'ONBOARDING_PENDING', 'ONBOARDING_IN_PROGRESS', 'DOCUMENTS_PENDING', 'VERIFICATION_PENDING', 'ONBOARDING_COMPLETED', 'REJECTED', 'ON_HOLD'
] as const;
export type MetaWorkflowStatus = (typeof META_WORKFLOW_STATUSES)[number];
/** The statuses a person may choose; the others (New Lead, Payment Confirmation Pending, Add-on Purchased) follow Sales and Accounts. */
export const TC_MANUAL_STATUSES: readonly TcWorkflowStatus[] = [
  'VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED', 'WAITING_FOR_CUSTOMER_PURCHASE', 'TECHNICAL_PROCESSING', 'COMPLETED', 'ON_HOLD'
];
export const TC_STATUS_LABELS: Record<TcWorkflowStatus, string> = {
  NEW_LEAD: 'New Lead', VERIFICATION_PENDING: 'Verification Pending', VERIFICATION_IN_PROGRESS: 'Verification In Progress',
  ADDON_SERVICES_RECOMMENDED: 'Add-on Services Recommended', WAITING_FOR_CUSTOMER_PURCHASE: 'Waiting for Customer Purchase',
  PAYMENT_CONFIRMATION_PENDING: 'Payment Confirmation Pending', ADDON_PURCHASED: 'Add-on Purchased', TECHNICAL_PROCESSING: 'Technical Processing',
  COMPLETED: 'Completed', ON_HOLD: 'On Hold'
};
export const META_STATUS_LABELS: Record<MetaWorkflowStatus, string> = {
  ONBOARDING_PENDING: 'Onboarding Pending', ONBOARDING_IN_PROGRESS: 'Onboarding In Progress', DOCUMENTS_PENDING: 'Documents Pending',
  VERIFICATION_PENDING: 'Verification Pending', ONBOARDING_COMPLETED: 'Onboarding Completed', REJECTED: 'Rejected', ON_HOLD: 'On Hold'
};

export interface WorkflowHistoryEntry {
  track: 'TECHNICAL_CONSULTANT' | 'META_VERIFIER';
  from: string | null;
  to: string;
  source: 'SYSTEM' | 'USER';
  by: string | null;
  note: string | null;
  at: string;
}
export interface CustomerWorkflow {
  customerId: string;
  technicalConsultant: { status: TcWorkflowStatus; since: string | null; note: string | null; by: string | null; source: 'SYSTEM' | 'USER'; sentBySales: boolean };
  metaVerifier: { applicable: boolean; status: MetaWorkflowStatus | null; since: string | null; note: string | null; by: string | null; source: 'SYSTEM' | 'USER' };
  canSetTechnicalConsultant: boolean;
  canSetMetaVerifier: boolean;
  addon: { latestStatus: string | null; open: boolean; addonsRequired: boolean | null; paymentPending: boolean };
  onboarding: { handedOver: boolean; itemsTotal: number | null; itemsVerified: number | null };
  history: WorkflowHistoryEntry[];
}
export type CustomerWorkflowStatuses = Record<string, { technicalConsultant: TcWorkflowStatus; metaVerifier: MetaWorkflowStatus | null }>;

// Top Performers & Rankings (monthly scores from the task and approved report records, AI evaluations, monthly recognition)
// ---------------------------------------------------------------------------
export type PerformerRoleKind = 'MEMBER' | 'TEAM_LEAD';
export type PerformerStatus = 'RANKED' | 'INSUFFICIENT_DATA';
export type PerformerTrend = 'IMPROVING' | 'DECLINING' | 'STEADY';
export type PerformerAwardType = 'EMPLOYEE_OF_MONTH' | 'TOP_EMPLOYEE' | 'BEST_TEAM_LEAD' | 'MOST_IMPROVED' | 'HIGHEST_COMPLETION' | 'BEST_REPORT_CONSISTENCY';
export type PerformerRecognitionStatus = 'RECOMMENDED' | 'APPROVED' | 'REJECTED';

export interface PerformerComponent {
  key: string;
  label: string;
  weight: number;
  /** 0 to 100, or null when there is no data for this measure (it is then left out of the score). */
  value: number | null;
  detail: string;
}
export interface PerformerEvaluation {
  summary: string | null;
  strengths: string[];
  improvementAreas: string[];
  whyRanked: string | null;
  source: 'AI' | 'RULES' | null;
  status: 'PENDING' | 'OK' | 'FAILED' | 'NOT_CONFIGURED';
  /** false when the figures changed after this was written (a new one is on its way). */
  current: boolean;
}
export interface PerformerMetrics {
  tasks: {
    assigned: number; completed: number; judged: number; judgedDone: number; weightedDone: number; onTime: number; late: number;
    completionPct: number | null;
    excluded: { duplicates: number; instant: number; delegated: number; blocked: number };
  };
  reports: { approved: number; pending: number; rejected: number; revision: number; coveragePct: number | null; quality: number | null; workingDays: number; coveredDays: number };
  team: { members: number; assigned: number; judged: number; judgedDone: number; weightedDone: number; completionPct: number | null; reviewsTimely: number; reviewsLate: number } | null;
  weightedCompletionPct: number | null;
  productivityPct: number | null;
  weightPresent: number;
}
export interface PerformerCard {
  scoreId: string;
  profileId: string;
  name: string;
  designation: string;
  roleKind: PerformerRoleKind;
  avatarUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  status: PerformerStatus;
  score: number | null;
  rank: number | null;
  previousScore: number | null;
  change: number | null;
  trend: PerformerTrend | null;
  metrics: PerformerMetrics;
  components: PerformerComponent[];
  insufficientReasons: string[];
  evaluation: PerformerEvaluation | null;
  departmentName?: string;
  departmentId?: string;
}
export interface PerformerRecognition {
  id: string;
  departmentId: string;
  departmentName?: string;
  month: string;
  awardType: PerformerAwardType;
  place: number;
  profileId: string;
  name: string;
  avatarUrl: string | null;
  designation: string;
  score: number | null;
  value: number | null;
  reason: string;
  status: PerformerRecognitionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  summary: string | null;
}
export interface PerformerMethodology {
  member: { key: string; label: string; weight: number }[];
  teamLead: { key: string; label: string; weight: number }[];
  thresholds: { minJudgedTasks: number; minWeightPresent: number; minRankedForAwards: number; trendPoints: number; reviewHours: number };
  rules: string[];
}
export interface PerformersDepartment {
  department: { id: string; name: string };
  month: string;
  monthEnd: string;
  today: string;
  monthClosed: boolean;
  canDecide: boolean;
  level: string;
  summary: { people: number; ranked: number; insufficient: number; avgScore: number | null; taskCompletionPct: number | null; reportCoveragePct: number | null; previousAvgScore: number | null };
  evaluationsPending: number;
  employees: PerformerCard[];
  teamLeads: PerformerCard[];
  recognitions: PerformerRecognition[];
  approvedHistory: PerformerRecognition[];
  monthly: { month: string; avgScore: number | null; ranked: number; taskCompletionPct: number | null }[];
  quarterly: { quarterStart: string; avgScore: number | null; ranked: number }[];
  methodology: PerformerMethodology;
}
export interface PerformersCompanyDepartment {
  id: string;
  name: string;
  people: number;
  ranked: number;
  insufficient: number;
  avgScore: number | null;
  previousAvgScore: number | null;
  taskCompletionPct: number | null;
  reportCoveragePct: number | null;
  topEmployee: { name: string; score: number } | null;
  topTeamLead: { name: string; score: number } | null;
  pendingRecommendations: number;
  approvedRecognitions: number;
}
export interface PerformersCompany {
  month: string;
  monthEnd: string;
  monthClosed: boolean;
  level: string;
  departments: PerformersCompanyDepartment[];
  topEmployees: PerformerCard[];
  topTeamLeads: PerformerCard[];
  trends: { departmentId: string; name: string; points: { month: string; avgScore: number | null }[] }[];
  recognitions: PerformerRecognition[];
  methodology: PerformerMethodology;
}
export interface PerformerEvaluationRun {
  written: number;
  ai: { configured: boolean; ok: number; failed: number };
  data: PerformersDepartment;
}

// Candidate careers portal — independent from staff and customer memberships.
export interface CareerProfile {
  id: string; email: string; name: string; phone: string; city: string; state: string;
  education: string; experience: string; skills: string; bio: string; version: number;
}
export interface CareerJob {
  id: string; title: string; description: string; location: string; employment_type: 'FULL_TIME' | 'PART_TIME' | 'INTERNSHIP' | 'CONTRACT';
  closes_at: string | null; position_id?: string; published?: boolean; version?: number;
  /** Vacancy fields (the HR Recruiter workspace); present on staff reads. */
  openings?: number; vacancy_status?: VacancyStatus; responsible_id?: string | null; qualifications?: string | null; skills?: string | null; experience?: string | null;
  required_steps?: ('CALL' | 'ASSESSMENT' | 'INTERVIEW')[];
  /** Job catalogue (public): a stable code, the team, how the work is done, pay, lists (one item per line) and when the job first went live. */
  code?: string; team?: string | null; work_mode?: CareerWorkMode | null; salary_text?: string | null;
  responsibilities?: string | null; benefits?: string | null; published_at?: string | null;
}
export type CareerWorkMode = 'REMOTE' | 'HYBRID' | 'ONSITE';
/** The values that exist among the open jobs, with how many jobs each has - for filter chips. */
export interface CareerJobFacet { value: string; count: number }
export interface CareerJobList {
  items: CareerJob[]; total: number;
  facets?: { teams: CareerJobFacet[]; locations: CareerJobFacet[]; modes: CareerJobFacet[] };
}
export interface CareerFile {
  id: string; file_name: string; size_bytes: number; created_at: string;
  status?: 'PENDING' | 'READY' | 'ABORTED'; storage_provider?: 'SUPABASE' | 'R2'; storage_bucket?: string; storage_path?: string;
}
export interface CareerApplication {
  id: string; posting_id: string; stage: string; candidate_message: string | null; version: number; created_at: string;
  snapshot: { profile: CareerProfile; job: CareerJob; resume_id: string };
  timeline: { kind: string; created_at: string }[];
}
export interface CareerUpload {
  file: CareerFile; bucket: string; path: string; provider: 'SUPABASE' | 'R2'; token?: string;
  upload?: { url: string; headers: Record<string,string> };
}
export interface CareerQuestion { prompt: string; options: string[]; correct?: number }
export interface CareerTest { id: string; title: string; duration_minutes: number; pass_percent: number; question_count: number }
export interface CareerAttempt {
 id: string; application_id: string; title: string; available_until: string; duration_minutes?: number; question_count?: number;
 started_at: string | null; deadline: string | null; submitted_at: string | null; score: number | null; passed: boolean | null;
 version: number; answers?: Record<string,number>; questions?: CareerQuestion[]; server_time?: string;
}
export interface CareerInterview {
 id: string; application_id: string; round: 'HR'|'DEPARTMENT_HEAD'|'MANAGEMENT'; scheduled_at: string; location: string;
 status: 'SCHEDULED'|'COMPLETED'|'CANCELLED'; recommendation?: 'PROCEED'|'REJECT'|'HOLD'; internal_feedback?: string; version?: number;
}
export interface CareerStaffApplication extends CareerApplication { title: string; resume_id: string; hr_candidate_id: string; attempts: CareerAttempt[]; interviews: CareerInterview[]; offers:CareerOffer[]; documents:CareerDocument[] }
export interface CareerOffer {id:string;application_id:string;title:string;terms:string;expires_at:string;joining_date:string;status:'DRAFT'|'RELEASED'|'ACCEPTED'|'DECLINED'|'EXPIRED'|'WITHDRAWN';version:number}
export interface CareerDocument {id:string;application_id:string;title:string;file_id:string|null;status:'REQUESTED'|'UPLOADED'|'APPROVED'|'REJECTED';message:string|null;version:number}
export interface CareerTraining {id:string;application_id:string;title:string;start_date:string;status:string;days:{day_no:number;title:string;topics:string[];trainer_name:string|null;attendance:string|null;assessment_result:string|null;completed:boolean|null}[]}

// ---------------------------------------------------------------------------
// Company reporting: daily summary, weekly cycle, HR reviews, leaderboard, analysis
// ---------------------------------------------------------------------------
export interface ReportTeamStats {
  teamId: string; team: string; lead: string | null; members: number; expected: number; submitted: number; approved: number;
  pendingTl: number; pendingDh: number; assignedTasks: number; completedTasks: number; completionRate: number | null; compliance: number | null;
}
/** Report and task figures of a department (or of a Department Head's teams) in a period, worked out from the individual reports. */
export interface ReportStats {
  members: number; teamLeads: number; departmentHeads: number;
  expected: number; submitted: number; pendingTl: number; pendingDh: number; pendingOh: number; approved: number; revision: number; rejected: number;
  assignedTasks: number; completedTasks: number; completionRate: number | null; compliance: number | null;
  teams: ReportTeamStats[];
  missing: { id: string; name: string; designation: string | null; kind: WorkReportKind; expected: number }[];
}
export interface DailyDepartmentSummary extends ReportStats { date: string; departmentId: string; department: string | null }

export type WeeklyReportFunction = 'SALES' | 'SUPPORT' | 'ALL';
export interface WeeklyDepartmentReport {
  departmentId: string; department: string | null; departmentHead: string; weekStart: string; weekEnd: string;
  /** The function this week is for, the functions this head sends a week for, who approves it, and why it cannot be sent (20261230000200). */
  function?: WeeklyReportFunction; functions?: WeeklyReportFunction[]; reviewers?: { id: string; name: string }[]; routingIssue?: string | null;
  package: ReportPackage; stats: ReportStats;
  days: { date: string; workingDay: boolean; stats: ReportStats | null }[];
  canEdit: boolean;
  weeks: { weekStart: string; status: WeeklyReportStatus }[];
}
export interface WeeklyBoardDepartment {
  id: string; name: string; slug: string; departmentHeads: string[]; stats: ReportStats; package: ReportPackage;
  /** One row per department AND function (20261230000200); routingIssue only for the Super Admin. */
  function?: WeeklyReportFunction; key?: string; reviewers?: string[]; routingIssue?: string | null;
}
export interface WeeklyBoard { weekStart: string; weekEnd: string; departments: WeeklyBoardDepartment[]; pendingApprovals: number }
export interface WeeklyPendingItem { departmentId: string; department: string; function?: WeeklyReportFunction; package: ReportPackage }
/** The Super Admin's weekly report routing review (20261230000200). */
export interface WeeklyRoutingItem {
  departmentId: string; department: string; function: WeeklyReportFunction;
  departmentHeads: { id: string; name: string }[]; operationsHead: { id: string; name: string } | null;
  issue: 'MISSING' | 'INACTIVE' | 'CONFLICT' | null; detail: string | null;
}

export interface RatingScaleLevel { value: number; label: string }
export interface HrReviewCounts { expected: number; submitted: number; drafts: number }
export interface PersonStats {
  expected: number; submitted: number; approved: number; pendingTl: number; pendingDh: number; rejected: number; revisionNow: number; revisionRequests: number;
  tlApproved: number; dhApproved: number; onTime: number; assigned: number; completed: number; compliance: number | null;
  tasksAssigned: number; tasksCompleted: number; taskCompletionRate: number | null;
}
export interface HrReview {
  id: string; packageId: string; subjectId: string | null; subject: string; subjectKind: 'TEAM_MEMBER' | 'TEAM_LEAD';
  periodStart: string; periodEnd: string; status: 'DRAFT' | 'SUBMITTED';
  rating: number | null; ratingLabel: string | null; consistencyNote: string | null; workAssessment: string | null; comments: string | null; recommendations: string | null;
  reviewer: string; submittedAt: string | null; updatedAt: string; metrics: PersonStats | null;
  department?: string;
}
export interface HrPerson { id: string; name: string; designation: string | null; stats: PersonStats; review: HrReview | null }
export interface HrTeamLead extends HrPerson { teamId: string | null; team: string | null; teamStats: ReportTeamStats | null; members: HrPerson[] }
export interface HrReviewDepartmentRow {
  id: string; name: string; packageId: string; departmentHeads: string[]; package: ReportPackage; reviews: HrReviewCounts; teamLeads: number; teamMembers: number;
}
export interface HrReviewsOverview { weekStart: string | null; weekEnd: string | null; departments: HrReviewDepartmentRow[]; weeks: string[]; scale: RatingScaleLevel[] }
export interface HrReviewDepartment {
  package: ReportPackage; departmentId: string; department: string | null; periodStart: string; periodEnd: string; reviews: HrReviewCounts; stats: ReportStats;
  teamLeads: HrTeamLead[]; otherMembers: HrPerson[]; scale: RatingScaleLevel[]; canReview: boolean;
}
export interface HrReviewSaved extends HrReview { packageStatus: WeeklyReportStatus; reviews: HrReviewCounts }
export interface HrReviewLog { total: number; items: HrReview[] }

export interface ConsolidatedDepartment {
  packageId: string; departmentId: string; department: string; status: WeeklyReportStatus; revision: number; reviews: HrReviewCounts; complete: boolean;
  alreadySubmitted: boolean; openApprovals: number; openRevisions: number;
  missingReviews: { id: string; name: string; kind: string; draft: boolean | null }[];
}
export interface ConsolidatedReadiness {
  complete: ConsolidatedDepartment[]; pending: ConsolidatedDepartment[];
  notReceived: { departmentId: string; department: string; status: string }[];
}
export interface HrConsolidated {
  weekStart: string; weekEnd: string; readiness: ConsolidatedReadiness; stage: PerformanceStage; weeks: string[];
  report: { id: string; status: 'DRAFT' | 'SUBMITTED_TO_SUPERADMIN' | 'AI_ANALYSIS_COMPLETED'; note: string | null; revision: number; submittedBy: string | null; submittedAt: string | null; snapshot: ConsolidatedReadiness | null } | null;
}
export interface HrConsolidatedSaved { id: string; status: string; note: string | null; revision: number; submittedAt: string | null; submittedDepartments: number }

export interface SaConsolidatedListItem {
  id: string; weekStart: string; weekEnd: string; status: 'SUBMITTED_TO_SUPERADMIN' | 'AI_ANALYSIS_COMPLETED'; revision: number; note: string | null;
  submittedBy: string | null; submittedAt: string | null; snapshot: ConsolidatedReadiness | null; departments: number;
  analysis: { id: string; status: string; source: string; createdAt: string } | null;
}
export interface SaConsolidated extends Omit<SaConsolidatedListItem, 'analysis' | 'departments'> {
  departments: { packageId: string; departmentId: string; department: string; package: ReportPackage; departmentHeads: string[]; stats: ReportStats; reviews: HrReviewCounts; avgRating: number | null }[];
}

export interface ScoreComponent { key: string; label: string; value: number | null; weight: number; detail: string }
export interface LeaderboardRow {
  rank: number | null; id: string; employeeId: string; name: string; role: 'TEAM_MEMBER' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD'; designation: string | null;
  departmentId: string; department: string; teamId: string | null; team: string | null; teamLead: string | null;
  assignedTasks: number; completedTasks: number; completionRate: number | null;
  reportsExpected: number; reportsSubmitted: number; compliance: number | null; onTimeRate: number | null; approvalRate: number | null;
  hrRating: number | null; hrRatingLabel: string | null; hrReviews: number;
  score: number | null; breakdown: ScoreComponent[]; status: 'RANKED' | 'INSUFFICIENT_DATA';
  category: 'STRONG' | 'AVERAGE' | 'NEEDS_ATTENTION' | 'INSUFFICIENT_DATA';
  previousScore: number | null; trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'NO_TREND';
}
export interface LeaderboardDepartment {
  departmentId: string; department: string; score: number | null; status: 'RANKED' | 'INSUFFICIENT_DATA'; people: number; ranked: number; insufficient: number;
  assignedTasks: number; completedTasks: number; completionRate: number | null; reportsExpected: number; reportsSubmitted: number; compliance: number | null;
  hrRating: number | null; rank?: number | null;
}
export interface ScoringMethod { weights: Record<string, number>; minTasks: number; minExpectedReports: number; ratingScale: RatingScaleLevel[] }
export interface Leaderboard {
  category: string;
  period: { type: string; from: string; to: string; previousFrom: string; previousTo: string };
  rows: (LeaderboardRow | LeaderboardDepartment)[];
  insufficientData: LeaderboardRow[];
  departments: LeaderboardDepartment[];
  counts: { people: number; ranked: number; insufficient: number };
  methodology: ScoringMethod;
}
export interface LeaderboardOptions {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  designations: string[];
  people: { id: string; name: string; role: string; departmentId: string; teamId: string | null }[];
  operationsHeads: { id: string; name: string }[];
  ratingScale: RatingScaleLevel[];
}
export interface EmployeeProfile {
  id: string; employeeId: string; name: string; role: string; designation: string | null; department: string; team: string | null; teamLead: string | null;
  period: { type: string; from: string; to: string };
  score: number | null; status: 'RANKED' | 'INSUFFICIENT_DATA'; category: string; breakdown: ScoreComponent[]; stats: PersonStats;
  weeks: { weekStart: string; weekEnd: string; score: number | null; status: string; completionRate: number | null; compliance: number | null; tasks: number; completed: number; submitted: number; expected: number }[];
  hrReviews: HrReview[];
  reports: WorkReportDetail[];
}
export interface ReportSettings {
  workingDays: number[]; weights: Record<string, number>; minTasks: number; minExpectedReports: number; ratingScale: RatingScaleLevel[]; canEdit: boolean; updatedAt: string;
}

/** One measurable fact the analysis is written from: it names the person / team / department, the numbers and the records it comes from. */
export interface AnalysisFact {
  factId: string; subjectType: 'PERSON' | 'TEAM' | 'DEPARTMENT'; subjectId: string; name: string; department?: string; team?: string | null; sources: string[];
  [metric: string]: unknown;
}
export interface AnalysisFacts {
  period: { from: string; to: string; days: number; previousFrom: string; previousTo: string };
  thresholds: Record<string, number>;
  counts: { people: number; ranked: number; insufficient: number };
  strongCompletion: AnalysisFact[]; lowCompletion: AnalysisFact[]; missingReports: AnalysisFact[]; repeatedRevisions: AnalysisFact[];
  wellPerformingTeams: AnalysisFact[]; taskGaps: AnalysisFact[]; performanceChanges: AnalysisFact[]; departmentDelays: AnalysisFact[];
  hrRatings: { departmentId: string; department: string; average: number; reviews: number }[];
}
export interface AnalysisNarrativeItem { text: string; factIds: string[] }
export interface AnalysisNarrative {
  summary: string;
  sections: { key: string; title: string; items: AnalysisNarrativeItem[] }[];
  limitations: string[];
}
export interface ReportAnalysis {
  id: string; periodStart: string; periodEnd: string; facts: AnalysisFacts; narrative: AnalysisNarrative; source: 'AI' | 'RULES';
  status: 'OK' | 'FAILED' | 'NOT_CONFIGURED'; model: string | null; error: string | null; createdAt: string;
}
export interface ReportAnalysisView { facts: AnalysisFacts; analysis: ReportAnalysis | null; aiConfigured: boolean }

// ---- HR Recruiter workspace ----------------------------------------------------------------------------------------------------------
export type RecruiterStage =
  | 'NEW_APPLICATION' | 'INITIAL_SCREENING' | 'CALL_SCHEDULED' | 'CALL_COMPLETED' | 'TEST_PENDING' | 'TEST_COMPLETED' | 'INTERVIEW_SCHEDULED'
  | 'INTERVIEW_COMPLETED' | 'SELECTION_REVIEW' | 'SELECTED' | 'REJECTED' | 'ON_HOLD' | 'WITHDRAWN';
export type VacancyStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'OPEN' | 'ON_HOLD' | 'CLOSED' | 'FILLED';
export interface RecruiterContext {
  id: string; name: string; email: string; designation: string; isRecruiter: boolean; isLeadership: boolean; /** An HR Assistant using the Recruitment Portal (migration 20261231000300). */ isAssistant?: boolean;
  newApplications: number; overdueFollowUps: number; vacanciesInQueue: number;
}
export interface RecruiterPerson { id: string; name: string }
/** One application as a list row or a pipeline card. */
export interface RecruiterApplicationRow {
  applicationId: string; candidateId: string | null; postingId: string; vacancy: string; department: string | null; designation: string | null;
  name: string; email: string; phone: string | null; appliedAt: string; status: string; version: number; stage: RecruiterStage;
  testStatus: 'NONE' | 'PENDING' | 'PASSED' | 'FAILED'; testScore: number | null; interviewStatus: 'NONE' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  callStatus: 'NONE' | 'SCHEDULED' | 'COMPLETED'; nextAt: string | null; nextKind: 'INTERVIEW' | 'CALL' | 'TEST' | null;
  recruiterId: string | null; recruiter: string | null; decision: 'SELECTED' | 'REJECTED' | null; decidedAt: string | null;
}
export interface RecruiterApplicationPage { total: number; page: number; pageSize: number; items: RecruiterApplicationRow[]; counts: Partial<Record<RecruiterStage, number>> }
export interface RecruiterVacancy {
  id: string; title: string; designation: string | null; departmentId: string | null; department: string | null; location: string; employmentType: string;
  openings: number; status: VacancyStatus; createdAt: string; closesAt: string | null; approvedAt: string | null; responsibleId: string | null;
  responsible: string | null; queue: boolean; applications: number; screening: number; interviewsScheduled: number; selected: number; remaining: number;
  requiredSteps: ('CALL' | 'ASSESSMENT' | 'INTERVIEW')[];
}
export interface RecruiterVacancyDetail extends RecruiterVacancy {
  description: string; qualifications: string | null; skills: string | null; experience: string | null; statusNote: string | null;
  /** Edit-form fields (migration 20261227000200; absent before it runs). */
  responsibilities?: string | null; workMode?: 'ONSITE' | 'HYBRID' | 'REMOTE' | null; version?: number; code?: string | null;
  canManage: boolean; canAct: boolean; candidates: RecruiterApplicationRow[];
}
export interface RecruiterOverview {
  kpis: {
    vacancies: number; applied: number; newApplications: number; callsPending: number; callsCompleted: number; testsPending: number;
    interviewsScheduled: number; interviewsCompleted: number; selected: number; rejected: number;
  };
  byVacancy: { postingId: string; vacancy: string; applications: number }[];
  byStage: Partial<Record<RecruiterStage, number>>;
  vacancyProgress: { postingId: string; vacancy: string; openings: number; applications: number; screening: number; interviews: number; selected: number; rejected: number }[];
  calls: { completed: number; pending: number };
  interviews: { completed: number; scheduled: number };
  recent: RecruiterApplicationRow[];
}
export interface RecruiterPipeline { stages: Partial<Record<RecruiterStage, { count: number; cards: RecruiterApplicationRow[] }>> }
export interface RecruiterCall {
  id: string; scheduledAt: string | null; calledAt: string | null; outcome: string | null; note: string | null; followUpDate: string | null; recruiter: string | null;
}
export interface RecruiterInterview {
  id: string; round: 'HR' | 'DEPARTMENT_HEAD' | 'MANAGEMENT'; scheduledAt: string; location: string; mode: string | null; interviewer: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; confirmedAt: string | null; bookedBy: 'HR' | 'CANDIDATE'; result: string | null; feedback: string | null;
  version: number; rescheduledFrom?: string | null;
}
export interface RecruiterDecisionRecord {
  id: string; seq: number; decision: 'SELECTED' | 'REJECTED'; category: string | null; reason: string | null; by: string | null; at: string; current: boolean; correctionReason: string | null;
}
export interface RecruiterApplicationDetail {
  summary: RecruiterApplicationRow;
  /** What the candidate submitted, as it was. Never edited by the recruiter. */
  submitted: {
    applicantId: string; name: string; email: string | null; phone: string | null; city: string | null; state: string | null; education: string | null;
    experience: string | null; skills: string | null; bio: string | null; candidateMessage: string | null; appliedAt: string; applicationId: string;
    candidateRecordId: string | null; resume: { id: string; fileName: string; sizeBytes: number } | null;
  };
  vacancy: RecruiterVacancy & { qualifications: string | null; skills: string | null; experience: string | null };
  documents: { id: string; title: string; status: string }[];
  assessments: { id: string; title: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'; invitedUntil: string; startedAt: string | null; completedAt: string | null; score: number | null; passed: boolean | null; passPercent: number }[];
  calls: RecruiterCall[];
  interviews: RecruiterInterview[];
  history: { at: string; previous: string | null; new: string; by: string | null; comment: string | null }[];
  /** The recruiter's own internal notes and evaluations (apart from the candidate's data). */
  notes: { id: string; kind: 'NOTE' | 'EVALUATION'; body: string; author: string | null; at: string }[];
  decisions: RecruiterDecisionRecord[];
  review: { missingSteps: string[]; selectionReview: boolean; openings: number; selected: number; remaining: number };
  can: { decide: boolean; correct: boolean; current: 'SELECTED' | 'REJECTED' | null };
}
export interface RecruiterCallLists {
  upcoming: { id: string; applicationId: string; candidate: string; phone: string | null; vacancy: string; scheduledAt: string; overdue: boolean }[];
  followUps: { id: string; applicationId: string; candidate: string; phone: string | null; vacancy: string; followUpDate: string; overdue: boolean; outcome: string | null }[];
  recent: { id: string; applicationId: string; candidate: string; vacancy: string; calledAt: string; outcome: string; note: string | null; recruiter: string | null }[];
}
export interface RecruiterInterviewListItem extends RecruiterInterview { applicationId: string; candidate: string; vacancy: string }
export interface RecruiterDecisionListItem extends RecruiterApplicationRow {
  sortAt: string; missingSteps: string[]; openings: number; category: string | null; reason: string | null; decidedBy: string | null;
}
export interface RecruiterReports {
  totals: {
    vacancies: number; openVacancies: number; closedVacancies: number; applications: number; screened: number; callsCompleted: number;
    interviewsScheduled: number; interviewsCompleted: number; selected: number; rejected: number; onHold: number;
  };
  byStage: Partial<Record<RecruiterStage, number>>;
  vacancyProgress: { postingId: string; vacancy: string; department: string | null; status: VacancyStatus; openings: number; applications: number; selected: number; rejected: number; inProgress: number }[];
  recruiters: { recruiterId: string | null; recruiter: string | null; applications: number; selected: number; rejected: number; avgDaysToDecision: number | null }[];
  scope: 'OWN' | 'COMPANY';
}
export interface RecruiterFilterOptions {
  vacancies: { id: string; title: string }[]; departments: { id: string; name: string }[]; designations: string[]; recruiters: RecruiterPerson[]; people: RecruiterPerson[];
}
export interface RecruiterDecisionResult { id: string; decision: 'SELECTED' | 'REJECTED'; decidedAt: string; alreadyRecorded?: boolean; vacancyFilled?: boolean }
/** Technical outbox row (Super Admin API only; there is no screen for it). Never carries a message body, a credential or a token. */
export interface RecruitmentEmailRecord {
  id: string; decisionId: string; applicationId: string; candidateId: string | null; recipient: string; type: 'SELECTION' | 'REJECTION'; triggerEvent: string;
  recruiterId: string | null; status: string; attempts: number; createdAt: string; processedAt: string | null; sentAt: string | null;
  providerStatus: string | null; deliveryStatus: string | null; lastError: string | null; nextAttemptAt: string | null;
}

// --- Department x function scopes, company-readable internal chat, delegated task detail (migrations 20261224000100-300) ---------------
/** STANDARD: new internal messages are readable by the company (TLS, encryption at rest, membership checks). E2EE: sealed in the browser. */
export interface ChatInternalMode { mode: 'STANDARD' | 'E2EE' }
/** SALES / SUPPORT, or null = both (the whole department). */
export type OperationsFunction = 'SALES' | 'SUPPORT' | null;
export interface OperationsScopeItem { departmentId: string; division: OperationsFunction; primary: boolean }

// --- Field Visit: live location, Field Visit leads -> Department Head -> Telecaller (migration 20261228000100) --------------------------------
export type VisitTrackingStatus = 'OFF' | 'ACTIVE' | 'STOPPED';
export type VisitTrackingIssue = 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT';
export interface TrackedPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** When the phone took the position. */
  recordedAt: string;
  receivedAt?: string;
}
export interface VisitTrackingState {
  visitId: string;
  visitStatus: LeadVisitStatus;
  trackingStatus: VisitTrackingStatus;
  trackingStartedAt: string | null;
  trackingStoppedAt: string | null;
  stopReason: 'STOPPED_BY_EMPLOYEE' | 'VISIT_ENDED' | 'PERMISSION_DENIED' | null;
  issue: VisitTrackingIssue | null;
  issueAt: string | null;
  lastLocation: TrackedPosition | null;
  points: number;
  /** Only in answers to a batch of positions: how many were stored (the rest were too close in time, or outside the visit). */
  saved?: number;
}
export interface TrackingBoardItem extends VisitTrackingState {
  employee: { id: string; fullName: string; phone: string | null };
  department: string | null;
  team: string | null;
  teamLead: string | null;
  lead: { id: string; name: string; company: string | null; address: string | null };
  purpose: string;
  visitDate: string;
  startedAt: string | null;
  completedAt: string | null;
  checkin: { latitude: number; longitude: number; accuracyMeters: number | null; at: string | null } | null;
}
export interface TrackingBoard {
  date: string;
  serverTime: string;
  items: TrackingBoardItem[];
}
export interface TrackingTrail extends VisitTrackingState {
  locations: TrackedPosition[];
  events: { event: 'STARTED' | 'STOPPED' | 'VISIT_ENDED' | VisitTrackingIssue; at: string }[];
}
export interface FieldVisitLeadRoute {
  leadId: string;
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
  stage: string;
  department: string | null;
  services: string[];
  status: 'PENDING' | 'ASSIGNED';
  createdAt: string;
  createdBy: { id: string; fullName: string; role: string } | null;
  assignedTo: { id: string; fullName: string } | null;
  assignedBy: string | null;
  assignedAt: string | null;
  history: { assignedTo: string | null; assignedBy: string | null; at: string; note: string | null }[];
  changed?: boolean;
}
export interface FieldVisitLeadQueue {
  total: number;
  page: number;
  pageSize: number;
  pending: number;
  items: FieldVisitLeadRoute[];
}
export interface FieldVisitTelecaller { id: string; name: string; team: string; openLeads: number }

// --- HR documents: NDA and Experience Letter (migration 20261229000200) ------------------------------------------------------------------
export type HrDocType = 'NDA' | 'EXPERIENCE' | 'OFFER';
export type HrDocTitle = 'Mr.' | 'Miss' | 'Mrs.' | 'Ms.';
export interface HrDocNdaFields { letterDate: string; employeeName: string }
export interface HrDocExperienceFields {
  letterDate: string;
  title: HrDocTitle;
  employeeName: string;
  designation: string;
  lastWorkingDate: string;
  signatoryName: string;
  signatoryTitle: string;
  /** The wording used for this letter (migration 20261231000700; when absent, version 1 of the master template). */
  content?: HrExperienceContent;
  templateVersion?: number;
}
export type HrDocRequest =
  | { type: 'NDA'; employeeKey: string; fields: HrDocNdaFields }
  | { type: 'EXPERIENCE'; employeeKey: string; fields: HrDocExperienceFields }
  | { type: 'OFFER'; employeeKey: string; fields: HrDocOfferFields | HrRoleOfferFields };
/** What the HR record says about the employee (the database decides; the browser only shows it). */
export interface HrDocPrefill {
  employee: {
    key: string;
    code: string;
    name: string;
    email: string | null;
    department: string | null;
    designation: string | null;
    joiningDate: string | null;
    lastWorkingDate: string | null;
    status: string;
    separated: boolean;
    /** From the HR record, for the Offer Letter (migration 20261231000700; absent before it). */
    monthlySalary?: string | null;
    workingHours?: string | null;
  };
  /** The current master template of an Offer / Experience Letter (migration 20261231000700; absent before it or for the NDA). */
  template?: HrLetterTemplateVersion | null;
  /** Details the letter needs that the record does not have (empty = the letter can be made). */
  problems: { code: string; message: string }[];
  ready: boolean;
  /** Today in India, and the letter's signatory as printed on the template: the starting values of the form. */
  today: string;
  signatory: { name: string; title: string };
}
export interface HrDocPreview { fileName: string; pdfBase64: string }
export interface HrDocument {
  id: string;
  type: HrDocType;
  employeeKey: string;
  employeeCode: string;
  employeeName: string;
  fileName: string;
  sizeBytes: number;
  fields: HrDocNdaFields | HrDocExperienceFields | HrDocOfferFields;
  generatedBy: string | null;
  createdAt: string;
}
export interface HrDocumentDownload { url: string; fileName: string }

// --- HR letters: the Offer Letter, editable wording, versioned master templates (migration 20261231000700) ----------------------------------
import type { HrExperienceContent, HrLetterType, HrOfferContent } from './hrLetters.js';
export type { HrExperienceContent, HrLetterTerm, HrLetterType, HrOfferContent } from './hrLetters.js';
export interface HrDocOfferFields {
  letterDate: string;
  employeeName: string;
  designation: string;
  department: string;
  employmentType: string;
  joiningDate: string;
  salary: string;
  probation: string;
  reportingTo: string;
  signatoryName: string;
  /** The wording of this letter (the master template's, possibly edited for this letter) and the master version it started from. */
  content: HrOfferContent;
  templateVersion: number;
}
export interface HrLetterTemplateVersion {
  type: HrLetterType;
  version: number;
  content: HrOfferContent | HrExperienceContent;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}
export interface HrLetterTemplateState {
  current: HrLetterTemplateVersion;
  versions: Omit<HrLetterTemplateVersion, 'content'>[];
  /** The caller may save a new version (Super Admin / HR Admin Head). */
  canEdit: boolean;
}

// ---- Operations Head -> Department Head -> Team Lead -> Team Member tasks, and the daily drill-down by person (20261230000300) ----
export interface OperationsPersonDaily {
  id: string; name: string; kind: 'DEPARTMENT_HEAD' | 'TEAM_LEAD' | 'MEMBER';
  teamId: string | null; team: string | null; teamLead: string | null; teamLeadId: string | null;
  tasks: { assigned: number; completed: number; pending: number; overdue: number };
  reports: { id: string; date: string; title: string; status: string; teamLeadStatus: string | null; departmentHeadStatus: string | null; submittedAt: string | null }[];
}
export interface OperationsPeopleDaily {
  departmentId: string; department: string; function: 'SALES' | 'SUPPORT' | 'ALL'; from: string; to: string; people: OperationsPersonDaily[];
}

// ---- Client support groups and Sent / Delivered / Seen (20261230000500) ----
export type ChatMessageStatus = 'SENT' | 'DELIVERED' | 'SEEN';
export interface ChatReceipt {
  seq: number; messageId: string; status: ChatMessageStatus;
  recipients: { name: string; label: string; delivered: boolean; seen: boolean }[];
}
export interface ClientSupportGroup {
  customerId: string; business: string; conversationId: string | null; name: string; named: boolean;
  client: { hasLogin: boolean };
  assigned: { id: string; name: string; role: string }[];
  members: { id: string; name: string; addedAt: string; active: boolean }[];
  canManage: boolean;
  candidates: { id: string; name: string; team: string | null }[] | null;
}

// --- Messaging onboarding: the Meta Verifier owns the initial onboarding (migration 20261231000100) ------------------------------------------
export interface OnboardingReviewScope {
  route: 'META' | 'TECHNICAL';
  /** The customer has WhatsApp API (+ Blue Tick), Blue Tick or RCS Registration. */
  messaging: boolean;
  initialOwner: 'META_VERIFIER' | 'TECHNICAL_CONSULTANT';
  /** The caller may authorize every document, Verify All, return to Sales and hand over. */
  canReviewAll: boolean;
  /** Otherwise: the items the caller (a Technical Consultant) may still authorize, those of a separately bought non-Messaging service. */
  consultantItems: string[];
}

// --- Paid leave after probation (migration 20261231000200) -------------------------------------------------------------------------------------
export type EmploymentStatus = 'PROBATION' | 'CONFIRMATION_PENDING' | 'FULL_TIME' | 'NOT_CONFIRMED' | 'UNKNOWN';
export interface PaidLeavePolicy { enabled: boolean; monthlyDays: number; creditDay: number; partialMonthRule: 'NEXT_FULL_MONTH' | 'EFFECTIVE_MONTH'; accrualStartMonth: string | null; updatedAt?: string }
export interface PaidLeaveBalance {
  employment: { status: EmploymentStatus; joiningDate?: string; probationEnd?: string; confirmedFrom?: string | null; cycleId?: string };
  policy: PaidLeavePolicy;
  eligibleFrom: string | null;
  month: string;
  carriedForward: number;
  creditedThisMonth: number;
  usedThisMonth: number;
  adjustedThisMonth: number;
  totalCredited: number;
  totalUsed: number;
  balance: number;
  pendingPaidDays: number;
  pendingPaidRequests: number;
  pendingRequests: number;
  /** Balance minus the days of paid requests still waiting for approval. */
  available: number;
}
export interface PaidLeaveEntry { type: 'MONTHLY_CREDIT' | 'LEAVE_DEBIT' | 'LEAVE_REVERSAL' | 'OPENING_BALANCE' | 'CORRECTION'; days: number; month: string; note: string | null; leaveRequestId: string | null; at: string; by: string | null }
export interface PaidLeaveDetail extends PaidLeaveBalance { profileId: string; fullName: string; entries: PaidLeaveEntry[] }
export interface PaidLeaveListItem extends PaidLeaveBalance { profileId: string; fullName: string; department: string | null }
export interface PaidLeaveList { policy: PaidLeavePolicy; canChangePolicy: boolean; items: PaidLeaveListItem[] }

// --- HR employee files: documents HR uploads to an employee's profile (migration 20261231000800_hr_employee_files.sql) -----------------------
// The file lives in Cloudflare R2 (or Supabase Storage); only this metadata is kept in PostgreSQL. HR staff read / upload / delete;
// the employee can read only their own files.
export const HR_EMPLOYEE_FILE_KINDS = ['IDENTITY', 'EMPLOYMENT', 'EDUCATION', 'LEAVE_MAIL', 'LEAVE_CANCELLATION_MAIL', 'OTHER'] as const;
export type HrEmployeeFileKind = (typeof HR_EMPLOYEE_FILE_KINDS)[number];
export const HR_EMPLOYEE_FILE_KIND_LABEL: Record<HrEmployeeFileKind, string> = {
  IDENTITY: 'Identity / KYC',
  EMPLOYMENT: 'Employment papers',
  EDUCATION: 'Education / certificates',
  LEAVE_MAIL: 'Leave mail',
  LEAVE_CANCELLATION_MAIL: 'Leave cancellation mail',
  OTHER: 'Other'
};
export const HR_EMPLOYEE_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'message/rfc822'
] as const;
export type HrEmployeeFileMimeType = (typeof HR_EMPLOYEE_FILE_MIME_TYPES)[number];
export const HR_EMPLOYEE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const HR_EMPLOYEE_FILE_MAX_LABEL = '5 MB';
export interface HrEmployeeFile {
  id: string;
  employeeKey: string;
  kind: HrEmployeeFileKind;
  leaveRef: string | null;
  note: string | null;
  fileName: string;
  mimeType: HrEmployeeFileMimeType;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}
export interface HrEmployeeFileUploadTicket {
  file: HrEmployeeFile;
  bucket: string;
  path: string;
  provider: 'R2' | 'SUPABASE';
  token: string;
  upload?: { url: string; headers: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Meetings (Google Calendar, booking links, CEO approval)
// ---------------------------------------------------------------------------
export type CalendarMeetingKind = 'APPOINTMENT' | 'DEMO' | 'MEETING' | 'INTERVIEW' | 'CEO_MEETING' | 'HR_MEETING' | 'CLIENT_MEETING';
export type CalendarMeetingMode = 'GOOGLE_MEET' | 'ONLINE_LINK' | 'IN_PERSON' | 'PHONE';
/** PENDING_AVAILABILITY (migration 20270116000400): no longer set since 20270122000100 (the Super Admin has no Enter / Exit); kept because the database still allows it. */
export type CalendarMeetingStatus = 'REQUESTED' | 'PROPOSED' | 'SCHEDULED' | 'DECLINED' | 'CANCELLED' | 'COMPLETED' | 'PENDING_AVAILABILITY';
export type CalendarMeetingSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'NOT_CONNECTED' | 'SKIPPED';

export interface MeetingAttendee {
  id: string;
  profileId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: 'REQUIRED' | 'OPTIONAL' | 'EXTERNAL';
  response: 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
}

export interface Meeting {
  id: string;
  reference: string;
  kind: CalendarMeetingKind;
  kindLabel: string;
  title: string;
  description: string | null;
  hostId: string;
  hostName: string;
  hostEmail: string | null;
  createdBy: string | null;
  createdByName: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: CalendarMeetingMode;
  location: string | null;
  meetLink: string | null;
  status: CalendarMeetingStatus;
  requiresApproval: boolean;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  cancelReason: string | null;
  bookedVia: 'STAFF' | 'BOOKING_LINK' | 'SYSTEM';
  sourceType: 'ba_demo' | 'career_interview' | 'employee_meeting' | null;
  sourceId: string | null;
  customerId: string | null;
  googleSyncStatus: CalendarMeetingSyncStatus;
  googleSyncError: string | null;
  googleEventId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canDecide: boolean;
  canAnswerProposal: boolean;
  /** The one who asked for the CEO's time may withdraw a request that is still pending, or ask for another time; never decide. */
  canWithdraw: boolean;
  canRequestChange: boolean;
  /** The viewer's own answer when they are an invited colleague; null otherwise. */
  myResponse: MeetingAttendee['response'] | null;
  /** Requests for the CEO's time: the employee's extra message, department and designation, the reason of a rejection, and the last move. */
  requestMessage: string | null;
  createdByDepartment: string | null;
  createdByDesignation: string | null;
  rejectionReason: string | null;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
  rescheduledByName: string | null;
  rescheduleReason: string | null;
  rescheduleCount: number;
  /** A client meeting (20270122000200): the client's company. */
  clientCompany?: string | null;
  attendees: MeetingAttendee[];
}

/** The dashboard sections for meeting requests with the CEO (Super Admin: everybody's; everybody else: their own). */
export const CEO_REQUEST_SECTIONS = ['PENDING', 'APPROVED', 'REJECTED', 'RESCHEDULED', 'ALL'] as const;
export type CeoRequestSection = (typeof CEO_REQUEST_SECTIONS)[number];
export interface CeoRequestList {
  section: CeoRequestSection;
  /** True for the Super Admin (the CEO): they see every employee's request and the management actions. */
  isSuperAdmin: boolean;
  counts: { pending: number; approved: number; rejected: number; rescheduled: number; all: number };
  items: Meeting[];
  limit: number;
  offset: number;
}

export interface MeetingHistoryEntry { kind: string; note: string | null; actorName: string | null; at: string; data: Record<string, unknown> }
export interface MeetingDetail extends Meeting { history: MeetingHistoryEntry[] }

export interface MeetingDirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: string;
  position: string | null;
  department: string | null;
  isCeo: boolean;
  googleConnected: boolean;
}

export interface MeetingBusyBlock { profileId: string; start: string; end: string; source: 'CRM' | 'GOOGLE' }

export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'NOT_CONNECTED';
  googleEmail: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

export interface MeetingBookingLink {
  id: string;
  hostId: string;
  slug: string;
  title: string;
  description: string | null;
  kind: Exclude<CalendarMeetingKind, 'HR_MEETING'>;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  mode: 'GOOGLE_MEET' | 'IN_PERSON' | 'PHONE';
  location: string | null;
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface MeetingAvailabilityWindow { weekday: number; start: string; end: string }

// ---- Live meeting availability of the CEO (migration 20270116000400): Enter / Exit Meeting ----
export type CeoAvailabilityStatus = 'AVAILABLE' | 'BUSY';
/** One Super Admin's live availability, as every signed-in employee sees it (the meeting and the queue only for those who may see them). */
export interface CeoPresence {
  hostId: string;
  hostName: string;
  position: string | null;
  status: CeoAvailabilityStatus;
  /** When the current status began (the meeting start while BUSY). */
  since: string | null;
  updatedAt: string | null;
  /** The meeting the CEO is in: only for the CEO and the people who may see that meeting. */
  meeting: { id: string; title: string; startsAt: string; endsAt: string; mode: string; meetLink: string | null } | null;
  /** The CEO's own queue of requests waiting for them to be free (null for everybody else). */
  pending: { id: string; title: string; startsAt: string; endsAt: string; requestedBy: string | null; createdAt: string }[] | null;
  /** How many waiting requests the viewer can count (the CEO: all; anyone else: their own). */
  pendingCount: number;
}
/** What Exit Meeting scheduled. */
export interface CeoAutoScheduled { id: string; title: string; startsAt: string; endsAt: string; requestedStartsAt: string; moved: boolean; requestedBy: string | null }
export interface CeoPresenceExit extends CeoPresence { scheduled: CeoAutoScheduled[] }
/** CEO office arrival (20270128000300): HR marks it once a day; it only drives the banner on "Ask the CEO for time", never the requests. */
export interface CeoOfficeCeo {
  ceoId: string; name: string; position: string | null; arrived: boolean; arrivedAt: string | null; markedBy: string | null; presence: 'AVAILABLE' | 'BUSY';
  // CEO Availability (20270201000100): today's status and the latest status update (the time and the person); optional so an older database still works
  status?: 'ARRIVED' | 'NOT_ARRIVED';
  updatedAt?: string | null;
  updatedStatus?: 'ARRIVED' | 'NOT_ARRIVED' | null;
  updatedBy?: string | null;
  /** False when the latest update is from an earlier day (today has no update yet). */
  updatedToday?: boolean;
}
export interface CeoOfficeStatus { day: string; canMark: boolean; ceos: CeoOfficeCeo[]; duplicate?: boolean }

export interface MeetingSettings {
  timezone: string;
  availability: MeetingAvailabilityWindow[];
  availabilityIsDefault: boolean;
  delegates: { id: string; name: string; email: string }[];
  bookingTypes: MeetingBookingLink[];
  isCeo: boolean;
}

/** The public booking page (no login). */
export interface PublicBookingPage {
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  durationMinutes: number;
  mode: 'GOOGLE_MEET' | 'IN_PERSON' | 'PHONE';
  location: string | null;
  hostName: string;
  hostPosition: string | null;
  requiresApproval: boolean;
  timezone: string;
  slots: string[];
}

export interface PublicBookingResult {
  reference: string;
  status: CalendarMeetingStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  manageUrl: string | null;
}

export interface PublicBookingView {
  id: string;
  reference: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: string;
  location: string | null;
  meetLink: string | null;
  status: CalendarMeetingStatus;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  decisionNote: string | null;
  hostName: string;
  slug: string | null;
}

// ---------------------------------------------------------------------------
// Upload Leads (docs/LEAD_UPLOAD.md): a Sales employee adds many leads from an Excel / CSV file
// ---------------------------------------------------------------------------
/** One row of the file as read in the browser: the text of each mapped column (empty when the column is missing). */
export interface LeadUploadRawRow {
  /** the row number in the file (the heading row is 1) */
  row: number;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  company: string;
  businessType: string;
  location: string;
  services: string;
  leadSource: string;
  description: string;
  followUpDate: string;
  assignee: string;
}
export type LeadUploadOutcome = 'NEW' | 'CREATED' | 'DUPLICATE' | 'INVALID' | 'FAILED';
export interface LeadUploadCheckRow {
  row: number;
  outcome: 'NEW' | 'DUPLICATE' | 'INVALID';
  message?: string;
  ownerId?: string;
  ownerName?: string;
  /** the existing record, when the caller may open it */
  duplicateOf?: string | null;
}
export interface LeadUploadCheckResult {
  rows: LeadUploadCheckRow[];
  summary: { total: number; new: number; duplicates: number; invalid: number };
}
export type LeadUploadStatus = 'PROCESSING' | 'COMPLETED' | 'INTERRUPTED';
export interface LeadUploadBatch {
  id: string;
  fileName: string;
  fileType: 'XLSX' | 'CSV';
  status: LeadUploadStatus;
  totalRows: number;
  processedRows: number;
  created: number;
  duplicates: number;
  invalid: number;
  failed: number;
  createdAt: string;
  completedAt: string | null;
}
export interface LeadUploadChunkResult {
  batch: LeadUploadBatch;
  results: { row: number; outcome: Exclude<LeadUploadOutcome, 'NEW'>; message?: string; leadId?: string }[];
}
export interface LeadUploadIssues {
  batch: LeadUploadBatch;
  rows: { row: number; outcome: Exclude<LeadUploadOutcome, 'NEW' | 'CREATED'>; message: string | null; data: Partial<LeadUploadRawRow> }[];
}

// ---------------------------------------------------------------------------
// BolifyAI panel recharge reminder calls (GET /reminder-calls; Super Admin and HR staff)
// ---------------------------------------------------------------------------
/** SCHEDULED / RETRY / PROCESSING / DRY_RUN read as "Pending"; ACCEPTED as "Submitted" (BolifyAI took the request, not "answered"). */
export type ReminderCallStatus = 'SCHEDULED' | 'PROCESSING' | 'ACCEPTED' | 'COMPLETED' | 'FAILED' | 'RETRY' | 'SKIPPED' | 'CANCELLED' | 'DRY_RUN';
export interface ReminderCallRow {
  id: string;
  customerId: string;
  customer: string;
  company: string | null;
  /** Masked (+91XXXXXX1234); null when the customer has no valid mobile. */
  phone: string | null;
  serviceCode: string;
  serviceName: string;
  planName: string | null;
  /** Calendar dates (Asia/Kolkata), YYYY-MM-DD. */
  expiryDate: string;
  daysLeft: number;
  stage: number;
  scheduledDate: string;
  /** UTC timestamps (ISO); shown in IST. */
  submittedAt: string | null;
  status: ReminderCallStatus;
  attempts: number;
  responseCode: number | null;
  response: { httpStatus?: number; success?: boolean; message?: string; callId?: string } | null;
  callId: string | null;
  callOutcome: 'COMPLETED' | 'NOT_ANSWERED' | 'BUSY' | 'FAILED' | null;
  callDurationSeconds: number | null;
  completedAt: string | null;
  reason: string | null;
  updatedAt: string;
}
export interface ReminderCallList {
  today: string;
  total: number;
  counts: { all: number; stage7: number; stage5: number; stage1: number; pending: number; submitted: number; failed: number; completed: number; skipped: number };
  lastSchedule: { ranAt: string; day: string; created: number; cancelled: number } | null;
  rows: ReminderCallRow[];
}

// =============================================================================
// AI Design Studio (migration 20270110000100): a separate, client-oriented department.
// Department Head -> Team Lead -> Team Member. Every shape below is what the ads_* database functions return.
// =============================================================================
/**
 * The department slug. This department is named "AI Design Studio" (migration 20270118000100 gave the name back; the slug and every ads_* function
 * are unchanged). It is a different department from "AI Studio" and from "Amuwa Design Studio" (slug designstudio).
 */
export const AI_DESIGN_STUDIO_SLUG = 'ai-design-studio';

// ---- Amuwa Design Studio / AI Design Studio roles (migrations 20270112000100, 20270112000200): Department Head -> Team Lead -> Team Member only. ----
// No Sales or Support role, team or side is offered or accepted (the database refuses it: private.designstudio_role_problem).
/** Amuwa Design Studio, an active department (migration 20270118000100 restored its name after it was labelled "(Retired)"). */
export const AMUWA_DESIGN_STUDIO_SLUG = 'designstudio';
/** The departments whose people are never given a Sales or Support role (only Department Head, Team Lead and Team Member). */
export const NO_SALES_SUPPORT_DEPARTMENT_SLUGS: readonly string[] = [AI_DESIGN_STUDIO_SLUG, AMUWA_DESIGN_STUDIO_SLUG];

// ---- International and Reseller (migration 20270127000100): Sales AND Support in one dashboard for every role ----
/**
 * The departments flagged unified_sales_support in the database. Used by the forms only, to offer the plain roles (Department Head, Team Lead, Team Member),
 * the department's one team and no Sales / Support side; the database decides who may do what (the flag, private.dept_is_unified).
 */
export const UNIFIED_DEPARTMENT_SLUGS: readonly string[] = ['international', 'reseller'];

export const ADS_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type AdsPriority = (typeof ADS_PRIORITIES)[number];
export const ADS_PRIORITY_LABELS: Record<AdsPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };

export const ADS_NOTICE_CATEGORIES = ['NEW_INSTRUCTIONS', 'DESIGN_FEEDBACK', 'REQUIREMENT_CHANGE', 'REVISION_REQUEST', 'APPROVAL_UPDATE', 'DELIVERY_UPDATE', 'IMPORTANT'] as const;
export type AdsNoticeCategory = (typeof ADS_NOTICE_CATEGORIES)[number];
export const ADS_NOTICE_CATEGORY_LABELS: Record<AdsNoticeCategory, string> = {
  NEW_INSTRUCTIONS: 'New client instructions', DESIGN_FEEDBACK: 'Design feedback', REQUIREMENT_CHANGE: 'Requirement change', REVISION_REQUEST: 'Revision request',
  APPROVAL_UPDATE: 'Approval update', DELIVERY_UPDATE: 'Delivery update', IMPORTANT: 'Important client communication'
};
export const ADS_NOTICE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AdsNoticeStatus = (typeof ADS_NOTICE_STATUSES)[number];
export const ADS_NOTICE_STATUS_LABELS: Record<AdsNoticeStatus, string> = { OPEN: 'Open', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' };

export const ADS_ASSIGNMENT_STATUSES = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'REVISION_REQUIRED', 'COMPLETED'] as const;
export type AdsAssignmentStatus = (typeof ADS_ASSIGNMENT_STATUSES)[number];
export const ADS_ASSIGNMENT_STATUS_LABELS: Record<AdsAssignmentStatus, string> = {
  ASSIGNED: 'Assigned', ACCEPTED: 'Accepted', IN_PROGRESS: 'In Progress', PENDING_REVIEW: 'Pending Review', REVISION_REQUIRED: 'Revision Required', COMPLETED: 'Completed'
};

export const ADS_REPORT_STATUSES = ['PENDING_TL', 'PENDING_DH', 'APPROVED', 'RETURNED'] as const;
export type AdsReportStatus = (typeof ADS_REPORT_STATUSES)[number];
export const ADS_REPORT_STATUS_LABELS: Record<AdsReportStatus, string> = {
  PENDING_TL: 'Pending Team Lead approval', PENDING_DH: 'Pending Department Head approval', APPROVED: 'Approved', RETURNED: 'Returned'
};

export const ADS_ISSUE_CATEGORIES = ['CLIENT_REQUIREMENTS', 'WORK_ASSIGNMENT', 'DESIGN_BLOCKER', 'TECHNICAL', 'TEAM_COORDINATION', 'OTHER'] as const;
export type AdsIssueCategory = (typeof ADS_ISSUE_CATEGORIES)[number];
export const ADS_ISSUE_CATEGORY_LABELS: Record<AdsIssueCategory, string> = {
  CLIENT_REQUIREMENTS: 'Client requirements', WORK_ASSIGNMENT: 'Work assignment', DESIGN_BLOCKER: 'Design-related blocker', TECHNICAL: 'Technical difficulty',
  TEAM_COORDINATION: 'Team coordination', OTHER: 'Other work-related concern'
};
export const ADS_ISSUE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type AdsIssueStatus = (typeof ADS_ISSUE_STATUSES)[number];
export const ADS_ISSUE_STATUS_LABELS: Record<AdsIssueStatus, string> = { OPEN: 'Open', UNDER_REVIEW: 'Under Review', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };

export interface AdsLink { name: string; url: string }
export type AdsRole = 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER';

export interface AdsContext {
  userId: string;
  name: string;
  role: AdsRole;
  departmentId: string;
  teamId: string | null;
  leadId: string | null;
  leadName: string | null;
  /** A Team Member who has no Team Lead yet: work, reports and issues go straight to the Department Head. */
  unassigned: boolean;
}
export interface AdsPerson { id: string; name: string; role: 'TEAM_HEAD' | 'TEAM_MEMBER'; leadId: string | null; leadName: string | null; hasLead: boolean }

export interface AdsClient {
  id: string;
  clientName: string;
  companyName: string | null;
  contactPerson: string | null;
  contactNumber: string | null;
  email: string | null;
  businessAddress: string | null;
  requirements: string | null;
  designService: string | null;
  workDescription: string | null;
  remarks: string | null;
  attachments: AdsLink[];
  status: 'ACTIVE' | 'INACTIVE';
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit?: boolean;
}
export interface AdsNotice {
  id: string;
  clientId: string;
  clientName: string | null;
  title: string;
  category: AdsNoticeCategory;
  description: string;
  priority: AdsPriority;
  status: AdsNoticeStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}
export interface AdsEvent { id: number; event: string; fromValue: string | null; toValue: string | null; note: string | null; actorId: string | null; actorName: string | null; createdAt: string }
export interface AdsAssignment {
  id: string;
  /** (20270225000100) the list says whether the caller may delete this assignment (shown on the card); the delete is checked again */
  canDelete?: boolean;
  clientId: string;
  clientName: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  priority: AdsPriority;
  dueDate: string | null;
  status: AdsAssignmentStatus;
  progress: number;
  attachments: AdsLink[];
  assignedBy: string;
  assignedByName: string | null;
  assigneeId: string;
  assigneeName: string | null;
  assigneeRole: AdsRole | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  overdue: boolean;
  memberCount: number;
  memberCompleted: number;
}
export interface AdsAssignmentDetail extends AdsAssignment {
  events: AdsEvent[];
  /** What a Team Lead passed on to Team Members (the rows the caller may see). */
  members: AdsAssignment[];
  canReview: boolean;
  canUpdateStatus: boolean;
  /** The Team Lead who gave it or the Department Head may delete it (20270220000100); absent before that migration. */
  canDelete?: boolean;
}
export interface AdsReport {
  id: string;
  authorId: string;
  authorName: string | null;
  authorRole: AdsRole | null;
  leadId: string | null;
  leadName: string | null;
  reportDate: string;
  clientId: string | null;
  clientName: string | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  workCompleted: string;
  workInProgress: string | null;
  pendingWork: string | null;
  challenges: string | null;
  remarks: string | null;
  attachments: AdsLink[];
  status: AdsReportStatus;
  returnStage: 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | null;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  /** The caller is the one who must decide on it now (the database works this out). */
  canReview: boolean;
}
export interface AdsReportDetail extends AdsReport { events: AdsEvent[] }
export interface AdsIssue {
  id: string;
  reference: string;
  title: string;
  category: AdsIssueCategory;
  description: string;
  clientId: string | null;
  clientName: string | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  priority: AdsPriority;
  attachments: AdsLink[];
  status: AdsIssueStatus;
  handlerLevel: 'TEAM_LEAD' | 'DEPARTMENT_HEAD';
  raisedBy: string;
  raisedByName: string | null;
  leadName: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AdsIssueDetail extends AdsIssue { events: AdsEvent[]; canWork: boolean; canEscalate: boolean }
export interface AdsActivity { id: number; entityType: 'assignment' | 'report' | 'issue' | 'notice' | 'client'; entityId: string; event: string; fromValue: string | null; toValue: string | null; actorName: string | null; createdAt: string; title: string | null }
export interface AdsOverview {
  clients: number;
  assignments: { total: number; ongoing: number; completed: number; pending: number; overdue: number };
  upcoming: AdsAssignment[];
  pendingReports: number;
  /** null for a Department Head (they do not write daily reports). */
  reportToday: boolean | null;
  openIssues: number;
  notices: AdsNotice[];
  activity: AdsActivity[];
}

// ---- AI Studio (migration 20270105000100): projects, tasks and daily reports -------------------------------------------------------------
export const AI_STUDIO_SLUG = 'ai-studio';
export const AI_STUDIO_PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type AiStudioProjectStatus = (typeof AI_STUDIO_PROJECT_STATUSES)[number];
export const AI_STUDIO_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const;
export type AiStudioTaskStatus = (typeof AI_STUDIO_TASK_STATUSES)[number];
export const AI_STUDIO_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type AiStudioPriority = (typeof AI_STUDIO_PRIORITIES)[number];
// REJECTED_BY_TL (20270302000100): the Team Lead rejected it, with a reason; final (a return is for corrections)
export const AI_STUDIO_REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'REJECTED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED'] as const;
export type AiStudioReportStatus = (typeof AI_STUDIO_REPORT_STATUSES)[number];
export const AI_STUDIO_REPORT_STATUS_LABELS: Record<AiStudioReportStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_TL_APPROVAL: 'Pending Team Lead Approval',
  RETURNED_BY_TL: 'Returned for Correction',
  REJECTED_BY_TL: 'Rejected',
  PENDING_DH_APPROVAL: 'Pending Department Head Approval',
  RETURNED_BY_DH: 'Returned by Department Head',
  APPROVED: 'Approved'
};
export type AiStudioRole = 'ADMIN' | 'HEAD' | 'LEAD' | 'MEMBER';

export interface AiStudioTaskCounts { total: number; assigned: number; ongoing: number; onHold: number; completed: number; progress: number }
export interface AiStudioProject {
  id: string;
  name: string;
  description: string | null;
  status: AiStudioProjectStatus;
  createdAt: string;
  /** When the project is due (set by the Super Admin / Department Head, migration 20270119000100); null = no deadline. */
  deadlineAt?: string | null;
  /** The caller works on this project. */
  mine: boolean;
  /** 20270221000100: the caller is not on the project but has a task in it (a cross-team task). */
  viaTask?: boolean;
  leads: { id: string; name: string }[];
  memberCount: number;
  tasks: AiStudioTaskCounts;
}
/** The clock (migration 20270119000100): a running project with a deadline. The server's own time comes with the list so every browser counts to the same moment. */
export interface AiStudioDeadlineItem {
  projectId: string;
  name: string;
  status: AiStudioProjectStatus;
  deadlineAt: string;
  /** The caller works on this project. */
  mine: boolean;
  /** Tasks of this project not completed yet that the caller may see / that are assigned to the caller. */
  openTasks: number;
  myOpenTasks: number;
}
export interface AiStudioDeadlines { serverNow: string; items: AiStudioDeadlineItem[] }
export interface AiStudioPerson {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  position: string | null;
  status: AccountStatus;
  leadId: string | null;
  leadName: string | null;
  /** When the account was created, and the joining date from the employee details (when recorded). */
  createdAt: string;
  joiningDate: string | null;
  projects: { id: string; name: string }[];
  openTasks: number;
  completedTasks: number;
}
export interface AiStudioTask {
  id: string;
  /** (20270225000100) the list says whether the caller may delete this task (shown on the row); the delete is checked again */
  canDelete?: boolean;
  projectId: string;
  projectName: string;
  title: string;
  description: string | null;
  priority: AiStudioPriority;
  status: AiStudioTaskStatus;
  progress: number;
  dueDate: string | null;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assigneeId: string;
  assigneeName: string;
  assignedById: string | null;
  assignedByName: string | null;
  lastUpdateNote: string | null;
  lastUpdateAt: string | null;
  completionNote: string | null;
  attachments: string[];
  overdue: boolean;
  /** 20270221000100 (optional: absent on an older database). STANDARD (the employee's own team) or CROSS_TEAM (another team's Team Lead gave it). */
  assignmentType?: AiStudioAssignmentType;
  /** The project-owning team: the Team Lead who gave it ("<name>'s team"). */
  ownerTeam?: string | null;
  /** The employee's team now, and when the task was given. */
  assigneeTeam?: string | null;
  assigneeTeamAtAssignment?: string | null;
}
export type AiStudioAssignmentType = 'STANDARD' | 'CROSS_TEAM';
export interface AiStudioTaskHistoryEntry {
  id: string; kind: 'ASSIGNED' | 'PROGRESS' | 'EDITED'; status: AiStudioTaskStatus; progress: number; note: string | null; authorName: string | null; createdAt: string;
  /** 20270221000100: an edit's values before / after (field -> {from, to}). */
  details?: Record<string, unknown> | null;
}
export interface AiStudioTaskDetail extends AiStudioTask { canUpdate: boolean; canEdit: boolean; canDelete?: boolean; reportCount?: number; history: AiStudioTaskHistoryEntry[] }
/** Somebody a task of a project can go to (GET /ai-studio/projects/:id/assignees): grouped by team, with their open workload as counts only. */
export interface AiStudioAssignee {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  designation: string | null;
  role: 'TEAM_HEAD' | 'TEAM_MEMBER';
  primaryLeadId: string | null;
  primaryLeadName: string | null;
  team: string;
  myTeam: boolean;
  onProject: boolean;
  /** Worked out by the server from the reporting lines; the browser never sends it. */
  assignmentType: AiStudioAssignmentType;
  eligible: boolean;
  reason: string | null;
  workload: { active: number; highPriority: number; dueToday: number; overdue: number; crossTeam: number };
  onLeaveToday: boolean;
  punchedInToday: boolean;
}
export interface AiStudioAssignees { projectId: string; projectName: string; managesProject: boolean; canAssignCrossTeam: boolean; people: AiStudioAssignee[] }
export interface AiStudioTaskPage { items: AiStudioTask[]; total: number; page: number; pageSize: number }

export interface AiStudioReportSummary {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: 'MEMBER' | 'LEAD';
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskTitle: string | null;
  reportDate: string;
  status: AiStudioReportStatus;
  revision: number;
  leadId: string | null;
  leadName: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
  /** 20270219000100: 'DAILY' (one report for the day, many tasks) or 'SINGLE' (an older one-project report). Absent on an older database. */
  kind?: 'DAILY' | 'SINGLE';
  teamName?: string | null;
  /** 20270302000100: when the report reached HR's AI Studio Performance (null = not sent), and when the Team Lead decided it. */
  sentToHrAt?: string | null;
  tlReviewedAt?: string | null;
  counts?: { projects: number; tasks: number; completed: number; crossTeam: number } | null;
  hasBlockers?: boolean;
}
export interface AiStudioReportHistoryEntry {
  id: string;
  /** SENT_TO_HR (20270302000100): when it reached HR's AI Studio Performance. A rejection is a Team Lead RETURNED step whose toStatus is REJECTED_BY_TL. */
  action: 'CREATED' | 'SUBMITTED' | 'RESUBMITTED' | 'APPROVED' | 'RETURNED' | 'EDITED' | 'SENT_TO_HR';
  stage: 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | null;
  /** 20270214000100: what the Team Lead changed (field -> before / after) on an EDITED step. */
  changes?: Record<string, { from: string | null; to: string | null }> | null;
  fromStatus: string | null;
  toStatus: AiStudioReportStatus;
  comment: string | null;
  actorName: string | null;
  actorRole: string | null;
  revision: number;
  createdAt: string;
}
/** 20270219000100: one history entry of a task, as a report shows it (read from the task's history, never copied). */
export interface AiStudioReportWorkEntry { id: string; at: string; status: AiStudioTaskStatus; progress: number; note: string | null }
/** One task of a consolidated report: the day's entries and the state the day ended with. */
export interface AiStudioReportWorkTask {
  taskId: string;
  title: string;
  description: string | null;
  priority: AiStudioPriority;
  projectId: string;
  projectName: string;
  assignedById: string | null;
  assignedByName: string | null;
  assignedAt: string;
  dueDate: string | null;
  crossTeam: boolean;
  entries: AiStudioReportWorkEntry[];
  /** No update was recorded on this task on the report date. */
  noUpdate: boolean;
  status: AiStudioTaskStatus;
  progress: number;
  progressBefore: number | null;
  completedAt: string | null;
  links: string[];
  currentStatus: AiStudioTaskStatus;
  currentProgress: number;
}
export interface AiStudioReportWorkSummary { projects: number; tasks: number; completed: number; inProgress: number; onHold: number; crossTeam: number; updates: number; links: number; withoutUpdate: number }
export interface AiStudioDailyReportOptions {
  date: string;
  existingReportId: string | null;
  tasks: { id: string; title: string; projectId: string; projectName: string; status: AiStudioTaskStatus; progress: number; crossTeam: boolean; assignedByName: string | null; updatesOnDate: number }[];
}
export interface AiStudioDailyReportPreview { date: string; work: AiStudioReportWorkTask[]; summary: AiStudioReportWorkSummary; updateIds: string[] }
/** A task's own part of the daily reports that mention it (whoever may see the task, e.g. the Team Lead who gave it). */
export interface AiStudioTaskReportEntry { reportId: string; reportDate: string; status: AiStudioReportStatus; authorName: string; submittedAt: string | null; entries: AiStudioReportWorkEntry[]; canOpen: boolean }

export interface AiStudioReportDetail extends AiStudioReportSummary {
  /** 20270219000100 (absent on an older database). */
  tomorrowPlan?: string | null;
  /** 20270302000100: the Daily Work Description (10-150 words to submit; not required on reports made before that migration). */
  workDescription?: string | null;
  descriptionRequired?: boolean;
  /** The Team Lead may reject it (final, with a reason). */
  canReject?: boolean;
  authorDesignation?: string | null;
  /** The content is fixed (submitted and not returned): the work shown is exactly what was submitted. */
  frozen?: boolean;
  /** A consolidated report's tasks and their work (null for an older one-task report). */
  work?: AiStudioReportWorkTask[] | null;
  summary?: AiStudioReportWorkSummary | null;
  workCompleted: string | null;
  workInProgress: string | null;
  pendingWork: string | null;
  blockers: string | null;
  remarks: string | null;
  tlComment: string | null;
  tlReviewedAt: string | null;
  tlReviewerName: string | null;
  dhComment: string | null;
  dhReviewedAt: string | null;
  dhReviewerName: string | null;
  canEdit: boolean;
  canReview: boolean;
  /** 20270214000100 (optional: absent on an older database): the Team Lead reviewing it may correct it before deciding. */
  canLeadEdit?: boolean;
  reviewStage: 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | null;
  history: AiStudioReportHistoryEntry[];
}
// ---- HR's AI Studio Performance (20270302000100): the approved Team Member reports and the Team Lead reports, team-wise and project-wise ----
export interface AiStudioHrTask { taskId: string | null; title: string; projectId: string | null; projectName: string | null; status: AiStudioTaskStatus | null; progress: number | null; completed: boolean; notes: string[] }
export interface AiStudioHrMemberReport {
  id: string; reportDate: string; memberId: string; memberName: string; leadId: string | null; leadName: string | null; teamName: string;
  tasks: AiStudioHrTask[]; projectIds: string[];
  description: string | null; workCompleted: string | null; pendingWork: string | null; blockers: string | null; remarks: string | null;
  status: AiStudioReportStatus; approvalStatus: 'APPROVED'; approvedBy: string | null; approvedAt: string | null; sentToHrAt: string; revision: number;
  completedTasks: number; pendingTasks: number;
}
export interface AiStudioHrLeadReport {
  id: string; reportDate: string; leadId: string; leadName: string; teamName: string; status: AiStudioReportStatus; sentToHrAt: string;
  description: string | null; workCompleted: string | null; pendingWork: string | null; blockers: string | null; remarks: string | null;
  tasks: AiStudioHrTask[]; projectIds: string[];
  /** The team's day, from the APPROVED member reports of that date only. */
  teamMembers: number; approvedMemberReports: number; completedTasks: number; pendingTasks: number;
}
export interface AiStudioHrTeam { leadId: string | null; leadName: string | null; teamName: string; projects: { id: string; name: string }[]; members: { id: string; name: string; projects: { id: string; name: string }[] }[] }
export interface AiStudioHrProject { id: string; name: string; status: AiStudioProjectStatus; people: { id: string; name: string; role: 'LEAD' | 'MEMBER'; leadId: string | null }[] }
export interface AiStudioHrPerformance { from: string; to: string; teams: AiStudioHrTeam[]; projects: AiStudioHrProject[]; memberReports: AiStudioHrMemberReport[]; leadReports: AiStudioHrLeadReport[] }
export interface AiStudioHrAccess {
  allowed: boolean;
  /** The Super Admin names the HR employees who may open it. */
  canManage: boolean;
  viewers: { id: string; name: string; email: string; active: boolean; grantedAt: string }[];
  candidates: { id: string; name: string; email: string }[];
}
export interface AiStudioReportPage { items: AiStudioReportSummary[]; total: number; page: number; pageSize: number; counts: Partial<Record<AiStudioReportStatus, number>> }
export interface AiStudioReportContext {
  role: AiStudioRole;
  today: string;
  /** The Team Lead (a Team Member's report) or the Department Head(s) (a Team Lead's report) who review the report. */
  reviewer: string | null;
  hasReviewer: boolean;
  /** TEAM_LEAD: Team Member -> Team Lead -> Department Head. DIRECT: straight to the Department Head (a Team Lead's own report, or a Team Member with no Team Lead yet). */
  route: 'TEAM_LEAD' | 'DIRECT';
  projects: { id: string; name: string }[];
  tasks: { id: string; projectId: string; title: string; status: AiStudioTaskStatus }[];
}
export interface AiStudioOverview {
  role: AiStudioRole;
  today: string;
  projects?: { id: string; name: string; status: AiStudioProjectStatus; tasks: number; completed: number }[];
  myTasks?: { total: number; assigned: number; ongoing: number; completed: number; pending: number; overdue: number };
  upcoming?: AiStudioTask[];
  recent?: { kind: 'TASK' | 'REPORT'; text: string; at: string; entityType: 'ai_studio_task' | 'ai_studio_report'; entityId: string }[];
  dailyReport?: { todayStatus: AiStudioReportStatus | null; todayCount: number; returned: number; pendingApproval: number; approved: number };
  team?: {
    members: number;
    tasks: { total: number; ongoing: number; completed: number; pending: number; overdue: number };
    reportsToReview: number;
    reportsToday: number;
  };
  department?: {
    employees: number;
    leads: number;
    members: number;
    unassignedMembers: number;
    activeProjects: number;
    tasks: { assigned: number; ongoing: number; completed: number; pending: number; overdue: number };
    reportsAwaitingHead: number;
    reportsAwaitingLead: number;
    reportsApproved: number;
    reportsToday: number;
    projects: { id: string; name: string; status: AiStudioProjectStatus; total: number; completed: number; ongoing: number; progress: number; leads: string[] }[];
  };
}

// ---- Crocodial integration (migration 20270115000100) -----------------------------------------------------------------------------
export type CrocodialHealth = 'UNKNOWN' | 'OK' | 'NO_CREDENTIAL' | 'AUTH_FAILED' | 'DISABLED_AT_SOURCE' | 'RATE_LIMITED' | 'ERROR';
export interface CrocodialConnection {
  id: string;
  name: string;
  externalAccountLabel: string | null;
  /** The NAME of the server setting that holds the token; the token itself never leaves the server. */
  credentialRef: string;
  /** Whether the server has that setting (added by the server; the database cannot know). */
  credentialConfigured?: boolean;
  enabled: boolean;
  health: CrocodialHealth;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}
/** "Refresh" on a Sales dashboard (croc_refresh_*): the browser names a scope; the database works out the people and connections. */
export type CrocodialRefreshScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'ALL';
export type CrocodialRefreshState = 'UP_TO_DATE' | 'REFRESH_QUEUED' | 'SYNCING' | 'PARTIALLY_SYNCED' | 'SYNC_FAILED' | 'RATE_LIMITED'
  | 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'DATA_UNAVAILABLE';
export interface CrocodialRefreshRequest {
  id: string;
  scope: CrocodialRefreshScope;
  departmentId: string | null;
  /** connected people the request covers (counted from approved mappings) */
  people: number;
  connections: number;
  /** QUEUED: a read was started; JOINED: a read already running / asked for; UP_TO_DATE: read in the last 2 minutes */
  outcome: 'QUEUED' | 'JOINED' | 'UP_TO_DATE';
  requestedAt: string;
  state: CrocodialRefreshState;
  /** false while the read is queued or running */
  finished: boolean;
  /** the oldest complete read of the connections involved (null: never read) */
  lastSyncAt: string | null;
  repeated?: boolean;
}
// ---- Crocodial -> CRM lead pipeline (20270304000100)
export type CrocodialLinkStatus = 'LINKED' | 'PENDING_CREATE' | 'PENDING_LINK' | 'UNMAPPED_ASSIGNEE' | 'OUT_OF_SCOPE' | 'NOT_ENABLED' | 'AMBIGUOUS' | 'OWNER_CONFLICT' | 'PROTECTED' | 'IGNORED' | 'FAILED';
export interface CrocodialReconcileOverview {
  departments: { departmentId: string; name: string; enabled: boolean; leadImport: 'OFF' | 'PREVIEW' | 'IMPORT' }[];
  counts: Partial<Record<CrocodialLinkStatus, number>>;
  ownershipDiffers: number;
  externalLeads: number;
  missingAtSource: number;
  unknownStatuses: { status: string; leads: number }[];
  mappings: { status: string; disposition: string }[];
  unmappedAssignees: { externalId: number; name: string | null; leads: number }[];
  reconcile: { last_run_at: string | null; last_ok_at: string | null; last_error: string | null; processed_last_run: number; created_last_run: number; updated_last_run: number; duration_ms_last_run: number | null; pending: number } | null;
  resources: { resource: string; lastOkAt: string | null; lastRunAt: string | null; lastError: string | null; rowsLastRun: number | null; inProgress: boolean }[];
  recentRuns: { resource: string; outcome: string; rows: number; pages: number; finishedAt: string; seconds: number; error: string | null; rateLimited: boolean }[];
}
export interface CrocodialLeadLink {
  id: string;
  externalLeadId: number;
  status: CrocodialLinkStatus;
  reason: string | null;
  assignmentMode: 'EXTERNAL' | 'CRM_OVERRIDE';
  importSource: 'CREATED' | 'MATCHED' | 'MANUAL' | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  externalStatus: string | null;
  disposition: string | null;
  externalOwner: string | null;
  mappedOwner: string | null;
  customerId: string | null;
  crmOwner: string | null;
  department: string | null;
  candidates: { id: string; name: string; lifecycle: string; owner: string | null }[];
  lastReconciledAt: string | null;
  externalUpdatedAt: string | null;
}
export interface CrocodialLeadLinkList { total: number; items: CrocodialLeadLink[] }
/** Who owns which Crocodial lead now (point in time); each lead counted once, under its one current assignee. */
export interface CrocodialTeamLeads {
  people: { profileId: string; name: string; teamId: string | null; teamName: string | null; assigned: number; contacted: number; notContacted: number; followupDue: number }[];
  totals: { assigned: number; newLeads: number; contacted: number; notContacted: number; followupDue: number };
  statuses: { status: string; disposition: string | null; leads: number }[];
  connectedEmployees: number;
}
export interface CrocodialReconcileRun { batches: number; processed: number; created: number; updated: number; held: number; failed: number; pending: number; enabled: boolean; error?: string }
export interface CrocodialLeadActivity {
  linked: boolean;
  externalLeadId?: number;
  status?: CrocodialLinkStatus;
  reason?: string | null;
  assignmentMode?: 'EXTERNAL' | 'CRM_OVERRIDE';
  externalStatus?: string | null;
  disposition?: string | null;
  externalOwner?: string | null;
  externalOwnerProfile?: string | null;
  crmOwner?: string | null;
  ownershipDiffers?: boolean;
  missingAtSource?: boolean;
  lastSyncAt?: string | null;
  lastReconciledAt?: string | null;
  calls?: { total: number; outgoing: number; incoming: number; missed: number; connected: number; talkSeconds: number; lastCallAt: string | null };
  callHistory?: { at: string | null; type: string; connected: boolean | null; seconds: number; by: string | null }[];
  remarks?: { at: string | null; text: string | null; by: string | null }[];
  followups?: { scheduledAt: string | null; done: boolean | null; completedAt: string | null; note: string | null; by: string | null }[];
  ownerHistory?: { observedAt: string; owner: string | null }[];
}
export interface CrocodialRefreshCapabilities {
  kind: 'EMPLOYEE' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | 'OPERATIONS_HEAD' | 'SUPER_ADMIN';
  active: boolean;
  /** Crocodial is switched on for a Sales department the caller works in or covers (20270303000100: a head's / CEO's scopes too) */
  rollout: boolean;
  /** (20270303000100) show the Crocodial menu: a manager whose Sales departments have Crocodial on (even before anyone is connected), or a connected person */
  eligible?: boolean;
  /** (20270303000100) the Sales departments with Crocodial on that a Department Head / CEO / Super Admin covers */
  enabledDepartments?: { departmentId: string; name: string }[];
  self: { state: 'CONNECTED' | 'NOT_MAPPED' | 'PENDING_APPROVAL' | 'NOT_ENABLED'; lastSyncAt?: string | null };
  team: { people: number } | null;
  departments: { departmentId: string; name: string; people: number; lastSyncAt: string | null }[];
  all: { people: number } | null;
  /** the caller's latest request of the last 10 minutes, to keep showing its progress after a reload */
  recent: CrocodialRefreshRequest | null;
}
/** What one server (Cloudflare / Vercel / Node.js, environment, deployment) reported about a connection's token: never the token. */
export interface CrocodialRuntimeReport {
  runtime: string;
  platform: 'cloudflare' | 'vercel' | 'node';
  environment: string | null;
  deployment: string | null;
  host: string | null;
  credentialDetected: boolean;
  credentialFormatValid: boolean;
  context: 'PAGE' | 'TEST' | 'SYNC' | 'REFRESH';
  reportedAt: string;
}
export interface CrocodialConnectionHealth {
  connection: CrocodialConnection;
  syncable: boolean;
  refreshRequestedAt: string | null;
  lastManualSyncAt: string | null;
  lastSyncAt: string | null;
  syncRunning: boolean;
  syncInProgress: boolean;
  lastSyncError: string | null;
  connectedPeople: number;
  refreshesToday: number;
  runtimes: CrocodialRuntimeReport[];
  /** checked live by the server answering this page */
  current: { nameValid: boolean; credentialDetected: boolean; credentialFormatValid: boolean };
}
export interface CrocodialHealthReport {
  /** the server answering this page */
  server: { runtime: string; platform: 'cloudflare' | 'vercel' | 'node'; environment: string | null; deployment: string | null; host: string | null };
  connections: CrocodialConnectionHealth[];
}
export interface CrocodialMapping {
  id: string;
  connectionId: string;
  externalEmployeeId: number;
  externalName: string | null;
  profileId: string;
  profileName: string;
  departmentId: string;
  departmentName: string | null;
  division: 'SALES';
  roleSnapshot: { role?: string; salesSubRole?: string | null; teamId?: string | null; teamName?: string | null };
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  approvedByName: string | null;
  approvedAt: string | null;
  effectiveFrom: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
  live: boolean;
}
export interface CrocodialAdminOverview {
  rollout: { departmentId: string; departmentName: string; departmentSlug: string; division: 'SALES'; allowed: boolean; note: string | null; updatedAt: string }[];
  connections: CrocodialConnection[];
  departmentLinks: { id: string; connectionId: string; departmentId: string; departmentName: string; division: 'SALES'; enabled: boolean; stage: 'PILOT' | 'PRODUCTION'; updatedAt: string }[];
  mappings: CrocodialMapping[];
  externalEmployees: { connectionId: string; externalId: number; name: string | null; isActive: boolean | null; branchIds: number[]; lastSeenAt: string; missingSince: string | null; mappingStatus: 'PENDING' | 'APPROVED' | null }[];
  externalBranches: { connectionId: string; externalId: number; name: string | null; status: string | null; missingSince: string | null }[];
  audit: { at: string; action: string; actorName: string | null; entityId: string | null; metadata: Record<string, unknown> }[];
}
export interface CrocodialProfileCheck {
  profileId: string;
  name: string;
  status: string;
  role: string;
  salesSubRole: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  teamDivision: string | null;
  active: boolean;
  inDepartment: boolean;
  inFunction: boolean;
  eligible: boolean;
}
export interface CrocodialMappingCheck {
  profile: CrocodialProfileCheck | null;
  externalEmployee: { externalId: number; name: string | null; isActive: boolean | null } | null;
  externalAlreadyMapped: boolean;
  profileAlreadyMapped: boolean;
  departmentLinked: boolean;
}
export interface CrocodialTestResult {
  ok: boolean;
  health: Exclude<CrocodialHealth, 'UNKNOWN'>;
  message: string;
  employees: number;
  branches: number;
  timezone: string | null;
  requests: number;
}
export interface CrocodialMyStatus {
  enabled: boolean;
  connectionName?: string;
  externalName?: string | null;
  departmentName?: string;
  lastSuccessAt?: string | null;
  health?: CrocodialHealth;
  timezone?: string | null;
}

export type CrocodialSyncResource = 'leads' | 'call-logs' | 'followups' | 'remarks';
export interface CrocodialSyncStatus {
  connectionId: string;
  syncable: boolean;
  lastManualSyncAt: string | null;
  resources: { resource: CrocodialSyncResource; checkpoint: string | null; lastFullAt: string | null; running: boolean; inProgress: boolean;
    lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; rowsLastRun: number | null; skippedLastRun: number | null }[];
  counts: { leads: number; calls: number; followups: number; remarks: number; missing: number };
  /** Records whose Crocodial user has no approved mapping: kept, never counted for anyone. */
  unmatched: { calls: number; followups: number; leads: number };
  unmatchedByUser: { externalId: number; name: string | null; calls: number }[];
  recentRuns: { resource: CrocodialSyncResource; startedAt: string; finishedAt: string; outcome: 'DONE' | 'PARTIAL' | 'FAILED'; fullPull: boolean; pages: number; rows: number; skipped: number; error: string | null }[];
}
export interface CrocodialSyncRunResult {
  connections: { connectionId: string; health: string; error?: string;
    resources: { resource: CrocodialSyncResource; outcome: 'DONE' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; pages: number; rows: number; skipped: number; error?: string }[] }[];
  requests: number;
  note: string | null;
}

/** One person's Crocodial activity (croc_activity): absent figures mean "not available", never zero. */
export interface CrocodialActivity {
  enabled: boolean;
  reason?: 'NOT_ENABLED';
  available?: boolean;
  stale?: boolean;
  lastSyncAt?: string | null;
  timezone?: string;
  from?: string;
  to?: string;
  person?: { id: string; name: string; role: string; salesSubRole: string | null };
  demos?: { scheduled: number; completed: number; cancelled: number; upcoming: number };
  calls?: { made: number; connected: number; notConnected?: number; connectRate: number | null; talkSeconds: number; incoming: number; missed: number; uniqueLeads: number; uniqueNumbers?: number };
  followups?: { scheduled: number; completed: number; completionRate: number | null; overdue: number };
  leads?: { assigned: number; neverCalled: number; followUpDue: number };
  remarks?: number;
  daily?: { day: string; made: number; connected: number }[];
  recentCalls?: { callAt: string; type: string; connected: boolean | null; durationSeconds: number | null; contactName: string | null; phone: string | null; leadStatus: string | null }[];
  upcomingFollowups?: { scheduledAt: string; note: string | null; leadName: string | null; overdue: boolean }[];
}

/** The connected people a manager may see (croc_team_activity). Totals cover only these people, never the whole department. */
/** A person's Crocodial leads (croc_leads): assigned to their mapped Crocodial user now; phones masked. */
export interface CrocodialLeads {
  enabled: boolean;
  reason?: 'NOT_ENABLED';
  person?: { id: string; name: string };
  counts?: { all: number; neverCalled: number; followUpDue: number };
  total?: number;
  page?: number;
  pageSize?: number;
  lastSyncAt?: string | null;
  items?: {
    id: number; name: string | null; company: string | null; city: string | null; status: string | null; source: string | null; phone: string | null;
    called: boolean | null; dialerOutcome: string | null; remarkCount: number | null; nextFollowupAt: string | null; followUpDue: boolean | null;
    lastInteractionAt: string | null; createdAt: string | null; calls: number;
  }[];
}
export interface CrocodialTeamActivity {
  connectedEmployees: number;
  label: string;
  stage: 'PILOT' | 'PRODUCTION';
  from: string | null;
  to: string | null;
  oldestSyncAt: string | null;
  anyStale: boolean;
  unavailable: number;
  note: string;
  people: {
    profileId: string; name: string; role: string; salesSubRole: string | null; teamId: string | null; teamName: string | null;
    departmentId: string; departmentName: string | null; available: boolean; stale: boolean; lastSyncAt: string | null;
    calls: CrocodialActivity['calls'] | null; followups: CrocodialActivity['followups'] | null; demos: CrocodialActivity['demos'] | null;
  }[];
  totals: { made: number; connected: number; notConnected?: number; connectRate: number | null; talkSeconds: number; uniqueLeads: number; uniqueNumbers?: number; followupsScheduled: number;
    followupsCompleted: number; followupsOverdue: number; demosScheduled: number; demosCompleted: number };
  teams: { teamId: string | null; teamName: string | null; people: number; made: number | null; connected: number | null }[];
  daily: { day: string; made: number; connected: number }[];
}

// ---------------------------------------------------------------------------
// Sales Department Head: role-wise sections (migration 20270117000300). Read-only figures counted from existing records.
// ---------------------------------------------------------------------------
export type SalesRole = 'TELECALLER' | 'BUSINESS_ASSOCIATE';
/** OFF: no approved Crocodial mapping; NOT_SYNCED: connected, first sync not finished; ON: call figures available. */
export type SalesRoleCrocodialState = 'OFF' | 'NOT_SYNCED' | 'ON';
/** Call figures come from Crocodial only (null unless crocodial = ON); demo figures from the CRM demo schedule; the rest are CRM records. */
export interface SalesRoleMetrics {
  crocodial: SalesRoleCrocodialState;
  calls: number | null; connected: number | null; notConnected: number | null; connectRate: number | null; uniqueNumbers: number | null; talkSeconds: number | null;
  // Telecaller (CRM)
  leadsCreated?: number; convertedLeads?: number;
  // Business Associate (CRM)
  leadsAssigned?: number; demosScheduled?: number; demosCompleted?: number; demosCancelled?: number; demosUpcoming?: number;
  quotations?: number; dealsClosed?: number; dealValue?: number;
}
export interface SalesRolePersonRow {
  id: string; name: string; email: string | null; phone: string | null; employeeCode: string; status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  teamId: string | null; teamName: string | null; teamLeadId: string | null; teamLeadName: string | null;
}
export interface SalesRoleList {
  role: SalesRole; from: string; to: string; total: number; page: number; pageSize: number;
  teamLeads: { id: string; name: string }[];
  items: (SalesRolePersonRow & { metrics: SalesRoleMetrics })[];
}
/** One Crocodial call as the screens show it (number masked to its last 4 digits). */
export interface SalesRoleCall {
  id: number; callAt: string; type: string | null; connected: boolean | null; durationSeconds: number | null; contactName: string | null; phone: string | null; leadStatus: string | null;
}
export interface SalesRolePersonDashboard {
  role: SalesRole; from: string; to: string;
  person: SalesRolePersonRow & { joinedAt: string };
  metrics: SalesRoleMetrics;
  crocodial: { state: SalesRoleCrocodialState; lastSyncAt: string | null; stale: boolean };
  /** one row per day of the period (India time); calls / connected are null when the person is not connected to Crocodial */
  daily: ({ day: string } & Record<string, number | string | null>)[];
  records: {
    calls: SalesRoleCall[];
    leads?: { id: string; name: string; company: string | null; stage: string; leadStatus: string | null; convertedTo: string | null; createdAt: string }[];
    contacts?: { id: string; name: string; company: string | null; stage: string; assignedAt: string; telecaller: string | null }[];
    demos?: { id: string; title: string; client: string; startsAt: string; mode: string; status: string }[];
    quotations?: { id: string; number: string; revision: number; client: string; total: number; finalizedAt: string }[];
    deals?: { id: string; name: string; company: string | null; stage: string; dealAmount: number | null; closedAt: string }[];
  };
}

// ---------------------------------------------------------------------------
// Client meetings (migration 20270122000200): a meeting of kind CLIENT_MEETING with the client as its outside guest
// ---------------------------------------------------------------------------
export interface ClientMeetingInput {
  clientName: string; clientEmail: string; companyName: string; title: string; agenda: string;
  startsAt: string; endsAt: string; timezone?: string | null; mode: 'ONLINE' | 'OFFLINE'; meetLink?: string | null; location?: string | null;
  hostId?: string | null; clientRequestId: string;
}
/** The meeting as created; duplicate: the same form was already sent (no second meeting, no second e-mail). */
export type ClientMeetingResult = Meeting & { client: { name: string | null; email: string } | null; duplicate: boolean };
/** One e-mail of a meeting and how its delivery went (meeting_mail_outbox). */
export interface MeetingMail {
  id: number; toEmail: string; toName: string | null; kind: string; external: boolean;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED'; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string; meetingVersion: number;
  /** a later new-time or cancellation e-mail to the same person replaced it (it is not sent again) */
  superseded: boolean;
}

// ---------------------------------------------------------------------------
// Bugs for the Developers team (migration 20270122000300)
// ---------------------------------------------------------------------------
export type DevBugStatus = 'PENDING' | 'UNDER_REVIEW' | 'IN_PROGRESS' | 'NEEDS_INFO' | 'RESOLVED' | 'REJECTED' | 'CLOSED';
/** Issue routing (20270128000200): EMPLOYEE (an employee reported it), HR_REPORT (HR reported it), HR_ESCALATION (HR escalated an employee issue) */
export type DevBugSource = 'EMPLOYEE' | 'HR_REPORT' | 'HR_ESCALATION';
export type DevIssueCategory = 'BUG' | 'FEATURE_REQUEST' | 'ACCESS_LOGIN' | 'DATA_ISSUE' | 'PERFORMANCE' | 'OTHER';
export type DevIssuePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export interface DevBugRouting {
  category?: DevIssueCategory; priority?: DevIssuePriority; source?: DevBugSource; sourceIssueReference?: string | null;
  affectedDepartment?: string | null; affectedEmployee?: string | null;
}
export type DevBugAssignmentStatus = 'UNASSIGNED' | 'ASSIGNED';
export interface DevBugRow extends DevBugRouting {
  id: string; reference: string; title: string; status: DevBugStatus; reporterName: string; department: string | null; designation: string | null;
  assigneeId: string | null; assigneeName: string | null; attachmentCount: number; createdAt: string; updatedAt: string; resolvedAt: string | null;
  /** UNASSIGNED: every developer sees it; ASSIGNED: the Team Lead and the assigned developer only (20270122000400) */
  assignmentStatus: DevBugAssignmentStatus; assignedByName: string | null; assignedAt: string | null;
  /** the reporter's own list carries the resolution note */
  resolutionNote?: string | null;
  /** the last message of the conversation between the reporter and the developers */
  lastMessage?: { from: 'REPORTER' | 'DEVELOPER'; note: string | null; by: string | null; at: string } | null;
}
export interface DevBugHistoryEntry { id: number; kind: 'SUBMITTED' | 'ASSIGNED' | 'STATUS' | 'COMMENT' | 'MESSAGE'; internal: boolean; note: string | null; data: Record<string, unknown>; by: string | null; at: string }
export interface DevBug extends DevBugRouting {
  sourceIssueId?: string | null; affectedDepartmentId?: string | null; affectedEmployeeId?: string | null;
  id: string; reference: string; title: string; description: string; steps: string | null; status: DevBugStatus;
  reporterId: string; reporterName: string; department: string | null; designation: string | null;
  assigneeId: string | null; assigneeName: string | null; resolutionNote: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
  assignmentStatus: DevBugAssignmentStatus; assignedById: string | null; assignedByName: string | null; assignedAt: string | null;
  /** the assignment history (the team only; empty for the reporter) */
  assignments: { to: string | null; by: string | null; at: string }[];
  /** fromIssue: a file of the escalated employee issue (referenced, not copied) */
  attachments: { id: string; name: string; mime: string; size: number; fromIssue?: boolean }[];
  /** internal comments only for the developers */
  history: DevBugHistoryEntry[];
  duplicate?: boolean;
}
export interface DevBugList {
  total: number;
  counts: { PENDING: number; IN_PROGRESS: number; RESOLVED: number; REJECTED: number; MINE: number; UNASSIGNED: number;
    UNDER_REVIEW?: number; NEEDS_INFO?: number; CLOSED?: number; OPEN?: number };
  /** the Team Lead sees every bug; a developer the unassigned ones and their own */
  isLead: boolean;
  /** the lead's view of the team's workload */
  byDeveloper: { id: string; name: string; open: number; closed: number }[];
  items: DevBugRow[];
}
/** developers: who the Team Lead can assign to (empty for everyone else) */
export interface DevBugAccess { isDeveloper: boolean; isLead: boolean; meId?: string | null; developers: { id: string; name: string }[] }
export interface DevTeamMember { id: string; name: string; email: string | null; active: boolean; isLead: boolean; department: string | null; addedAt: string }

// ---------------------------------------------------------------------------
// Post-meeting summaries and the CEO's Meeting Decisions (migration 20270124000200)
// ---------------------------------------------------------------------------
export type MeetingSummaryStatus = 'PENDING' | 'DRAFT' | 'SUBMITTED' | 'REVISION_REQUESTED' | 'REVISED';
export type MeetingSummaryOwnerMethod =
  | 'SENIORITY' | 'HOST' | 'CREATOR' | 'SELECTED' | 'DELEGATED' | 'TRANSFERRED' | 'ROUTED' | 'ESCALATED' | 'NO_LEADER' | 'SELECTION_REQUIRED';
export type MeetingDecisionStatus = 'PROPOSED' | 'APPROVED' | 'IN_PROGRESS' | 'IMPLEMENTED' | 'ON_HOLD';
export type MeetingActionStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'CANCELLED';
export type MeetingActionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type MeetingBlockerCategory = 'PENDING_APPROVAL' | 'RESOURCE' | 'OPERATIONAL' | 'CUSTOMER_ESCALATION' | 'DEPENDENCY' | 'CEO_DECISION' | 'OTHER';
/** A colleague as a summary shows them: rank 4 CEO, 3 Operations Head, 2 Department Head, 1 Team Lead, 0 member. */
export interface MeetingSummaryPerson {
  id: string;
  name: string;
  rank: number;
  roleLabel: string;
  position: string | null;
  active: boolean;
  department: string | null;
  team: string | null;
}
export interface MeetingSummaryAttendee extends MeetingSummaryPerson {
  invited: boolean;
  response: string | null;
  /** null: not confirmed yet. */
  attended: boolean | null;
}
export interface MeetingSummaryDecision {
  id?: string;
  key: string;
  title: string;
  description: string | null;
  departmentId: string | null;
  department?: string | null;
  teamId: string | null;
  team?: string | null;
  decidedBy: string | null;
  decidedByName?: string | null;
  status: MeetingDecisionStatus;
  ceoFollowUp?: boolean;
  ceoFollowUpNote?: string | null;
}
export interface MeetingSummaryAction {
  id?: string;
  key: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName?: string | null;
  dueDate: string | null;
  priority: MeetingActionPriority;
  status: MeetingActionStatus;
  decisionKey: string | null;
  overdue?: boolean;
  completedAt?: string | null;
  updatedAt?: string | null;
}
export interface MeetingSummaryBlocker {
  id?: string;
  key: string;
  category: MeetingBlockerCategory;
  description: string;
  needsCeoAttention: boolean;
  ceoFollowUp?: boolean;
  ceoFollowUpNote?: string | null;
}
export interface MeetingSummaryContent {
  purposeNote: string | null;
  executiveSummary: string | null;
  discussionPoints: string[];
  noDecisions: boolean;
  noBlockers: boolean;
  nextSteps: string | null;
  followUp: { required: boolean; date: string | null; outcome: string | null };
  decisions: MeetingSummaryDecision[];
  actions: MeetingSummaryAction[];
  blockers: MeetingSummaryBlocker[];
}
export interface MeetingSummaryRevision {
  revisionNo: number;
  kind: 'SUBMITTED' | 'REVISED';
  changeNote: string | null;
  actor: string | null;
  createdAt: string;
  snapshot: MeetingSummaryContent & { submittedBy?: string; submittedAt?: string; attended?: string[] };
}
export interface MeetingSummary {
  id: string;
  status: MeetingSummaryStatus;
  overdue: boolean;
  dueAt: string;
  isHistorical: boolean;
  owner: MeetingSummaryPerson | null;
  ownerMethod: MeetingSummaryOwnerMethod | null;
  ownerReason: string | null;
  ownerAssignedBy: string | null;
  ownerAssignedAt: string | null;
  selectionRequired: boolean;
  candidates: MeetingSummaryPerson[];
  attendanceConfirmedAt: string | null;
  attendanceConfirmedBy: string | null;
  revisionNo: number;
  version: number;
  submittedAt: string | null;
  firstSubmittedAt: string | null;
  submittedBy: string | null;
  updatedAt: string;
  canRead: boolean;
  content: MeetingSummaryContent | null;
  comments: { id: number; kind: 'CLARIFICATION' | 'RESPONSE' | 'FOLLOW_UP'; body: string; author: string | null; createdAt: string }[] | null;
  revisions: MeetingSummaryRevision[] | null;
  history: { kind: string; note: string | null; actor: string | null; createdAt: string }[] | null;
  assignable: { id: string; name: string; roleLabel: string }[] | null;
  routeTargets: MeetingSummaryPerson[] | null;
}
/** One meeting's summary as the viewer may see it (outcome fields only: no guests, links or locations). */
export interface MeetingSummaryView {
  meetingId: string;
  eligible: boolean;
  started: boolean;
  ended: boolean;
  meeting: {
    id: string; reference: string; title: string; purpose: string | null; kind: string; status: string;
    startsAt: string; endsAt: string; timezone: string;
    department: string | null; departmentId: string | null; division: string | null; team: string | null;
    host: MeetingSummaryPerson | null; organiser: MeetingSummaryPerson | null;
  };
  attendance: MeetingSummaryAttendee[];
  can: { confirmAttendance: boolean; edit: boolean; submit: boolean; amend: boolean; assignOwner: boolean; clarify: boolean; flag: boolean; reply: boolean; updateActions: boolean };
  summary: MeetingSummary | null;
}
export interface MeetingSummaryRow {
  meetingId: string;
  reference: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  meetingStatus: string;
  department: string | null;
  departmentId: string | null;
  team: string | null;
  teamId: string | null;
  owner: MeetingSummaryPerson | null;
  ownerMethod: MeetingSummaryOwnerMethod | null;
  hostName: string | null;
  attendees: number;
  invited: number;
  status: MeetingSummaryStatus;
  overdue: boolean;
  dueAt: string;
  isHistorical: boolean;
  awaitingAttendance: boolean;
  decisions: number;
  actions: number;
  openActions: number;
  blockers: number;
  needsAttention: boolean;
  submittedAt: string | null;
  revisionNo: number;
  version: number;
}
export type MeetingSummaryTab = 'PENDING' | 'DRAFT' | 'SUBMITTED' | 'OVERDUE' | 'ALL';
export interface MeetingSummaryList {
  items: MeetingSummaryRow[];
  total: number;
  counts: Record<'PENDING' | 'DRAFT' | 'SUBMITTED' | 'OVERDUE', number>;
}
export interface MyMeetingAction {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: MeetingActionPriority;
  status: MeetingActionStatus;
  overdue: boolean;
  meetingId: string;
  meetingTitle: string;
  meetingStartsAt: string;
  ownerName: string | null;
}
export interface MeetingReportsOverview {
  held: number;
  submitted: number;
  revisionRequested: number;
  pending: number;
  overdue: number;
  decisions: number;
  openActions: number;
  overdueActions: number;
  attention: number;
  latestDecisions: { id: string; title: string; description: string | null; status: MeetingDecisionStatus; ceoFollowUp: boolean; decidedByName: string | null;
    department: string | null; meetingId: string; meetingTitle: string; meetingStartsAt: string }[];
  attentionItems: { type: 'BLOCKER' | 'DECISION'; id: string; text: string; category: MeetingBlockerCategory | null; flagged: boolean; meetingId: string; meetingTitle: string }[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  leaders: MeetingSummaryPerson[];
  overdueHours: number;
}
export interface MeetingReportList { items: MeetingSummaryRow[]; total: number }
export interface MeetingReportAction {
  id: string;
  title: string;
  description: string | null;
  status: MeetingActionStatus;
  priority: MeetingActionPriority;
  dueDate: string | null;
  overdue: boolean;
  assigneeName: string | null;
  decision: string | null;
  meetingId: string;
  meetingTitle: string;
  meetingStartsAt: string;
  ownerName: string | null;
  department: string | null;
  updatedAt: string;
}
export interface MeetingReportActionList { items: MeetingReportAction[]; total: number }

// ---------------------------------------------------------------------------
// Notification Health (migration 20270126000200). Counts, times, statuses and short failure codes only: never a device address or key.
// "Accepted" means the push service took the message, not that the device showed it or made a sound.
// ---------------------------------------------------------------------------
export type NotificationHealthStatus = 'READY' | 'SETUP_REQUIRED' | 'NOTIFICATIONS_BLOCKED' | 'DEVICE_NOT_REGISTERED' | 'PUSH_UNAVAILABLE'
  | 'DELIVERY_FAILED' | 'RETRY_PENDING' | 'REMINDERS_DISABLED' | 'COMPANY_PAUSED';
export type NotificationSoundStatus = 'CONFIRMED' | 'AUDIO_ENABLED' | 'AUDIO_LOCKED' | 'UNKNOWN';
export interface NotificationHealthEmployee {
  profileId: string;
  name: string;
  role: string;
  designation: string | null;
  departmentId: string | null;
  department: string | null;
  status: NotificationHealthStatus;
  remindersEnabled: boolean;
  effective: { punchIn: string; lunch: string; punchOut: string };
  activeDevices: number;
  inactiveDevices: number;
  expiredDevices: number;
  lastAcceptedAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  failed7d: number;
  retryPending: number;
  pending: number;
  todayGenerated: number;
  todayNoDevice: number;
  reminderMissing: boolean;
  noReminderToday: boolean;
  onLeave: boolean;
  attendanceStatus: string;
  blockedReported: boolean;
  lastDeviceCheckAt: string | null;
  testConfirmedAt: string | null;
  soundStatus: NotificationSoundStatus;
}
export interface NotificationHealthReport {
  generatedAt: string;
  today: string;
  pushConfigured: boolean | null;
  summary: { eligible: number; remindersEnabled: number; remindersDisabled: number; withDevice: number; withoutDevice: number; recentFailures: number;
             reminderMissing: number; ready: number; byStatus: Partial<Record<NotificationHealthStatus, number>> };
  queue: { pending: number; retryPending: number; accepted24h: number; failed24h: number; expired24h: number; cancelled24h: number };
  todayReminders: { generated: number; bellWritten: number; noDevice: number; pushOff: number };
  scheduler: {
    lastSuccessAt: string | null; lastRunAt: string | null; lastRunOk: boolean | null; lastError: string | null; lastRunPushConfigured: boolean | null;
    runs24h: number; failedRuns24h: number; health: 'HEALTHY' | 'DELAYED' | 'NOT_RUNNING';
    last24h: { attempted: number; accepted: number; failed: number; retry: number; gone: number; noDevice: number; generated: number };
  };
  employees: NotificationHealthEmployee[];
}
export interface NotificationHealthDetail {
  profileId: string;
  name: string;
  devices: { id: string; label: string | null; active: boolean; createdAt: string; lastSuccessAt: string | null; lastFailureAt: string | null;
             lastFailureCode: string | null; failureCount: number; deactivatedReason: string | null; testConfirmedAt: string | null }[];
  browsers: { label: string | null; permission: string; pushState: string; audioState: string; standalone: boolean; checkedAt: string }[];
  deliveries: { id: number; kind: 'ATTENDANCE_REMINDER' | 'TEST'; reminderKind: string | null; step: number | null; device: string | null; status: string;
                attempts: number; statusCode: number | null; error: string | null; createdAt: string; acceptedAt: string | null; finishedAt: string | null }[];
  reminders: { date: string; kind: string; step: number; dueAt: string | null; sentAt: string; pushStatus: string | null; devices: number }[];
}
/** A test notification: `sent` = devices whose push service accepted it. */
export interface NotificationTestResult { devices: number; sent: number; retry: number; failed: number; gone: number; pushConfigured: boolean }

// ---------------------------------------------------------------------------
// Email Management (migration 20270201000100). No message bodies, links, codes or keys anywhere. "ACCEPTED" means the provider took the
// e-mail; DELIVERY_CONFIRMED needs the provider's own delivery event.
// ---------------------------------------------------------------------------
export type EmailProviderName = 'resend' | 'ses' | 'smtp' | 'brevo';
export interface EmailSettings {
  providerOrder: ('resend' | 'ses' | 'smtp')[] | null;
  quotaThresholds: number[];
  resendDailyLimit: number;
  resendMonthlyLimit: number;
  sesDailyLimit: number | null;
  criticalReserve: number;
  maxAutoRecipients: number;
  allowedSenderDomains: string[];
  updatedAt?: string;
}
export interface EmailSender { category: string; fromEmail: string; fromName: string; replyTo: string | null; enabled: boolean; updatedAt?: string }
export interface EmailRule {
  id: string; name: string; category: string; application: string | null; departmentId: string | null; workflow: string | null;
  mode: 'CC' | 'BCC'; target: string; profileIds: string[]; addresses: string[]; excludeProfileIds: string[]; priority: number; enabled: boolean;
  effectiveFrom: string | null; effectiveTo: string | null; updatedAt?: string;
}
export interface EmailProviderState {
  provider: 'resend' | 'ses' | 'smtp';
  pausedUntil: string | null; pauseReason: string | null; lastSuccessAt: string | null; lastErrorAt: string | null; lastErrorCategory: string | null;
  reportedDaily: string | null; reportedMonthly: string | null; reportedAt: string | null; usedToday: number; usedMonth: number;
}
export interface EmailDiagnostics {
  route: EmailProviderName[]; intended: EmailProviderName | null; excluded: { provider: EmailProviderName; reason: string }[]; fallback: boolean;
  sesProductionEnabled: boolean; configured: Record<'resend' | 'ses' | 'smtp', boolean>; sesRegion: string | null; sesRegionExplicit: boolean;
  sesConfigurationSet: boolean; smtpHost: string | null; fromEmail: string; replyTo: string; globalCc: number; globalBcc: number;
  resendWebhookSecret: boolean; orderFromEnv: string | null;
}
export interface EmailOverview {
  settings: EmailSettings;
  today: { submitted: number; accepted: number; deliveryConfirmed: number; failed: number; bounced: number; complained: number; unknown: number;
           suppressed: number; retryPending: number; processing: number; fallbacks: number };
  providers: EmailProviderState[];
  senders: EmailSender[];
  rules: EmailRule[];
  suppressions: number;
  webhookEvents24h: number;
  lastWebhookAt: string | null;
  diagnostics: EmailDiagnostics;
}
export interface EmailProviderCheck { provider: 'resend' | 'ses' | 'smtp'; ok: boolean; checkedAt: string; summary: string; details: Record<string, unknown> }
export interface EmailHistoryItem {
  id: string; application: string; category: string; template: string | null; priority: string; sender: string | null; recipient: string;
  cc: string[]; bccCount: number; bcc: string[] | null; status: string; provider: EmailProviderName | null; fallbackUsed: boolean; attempts: number;
  errorCategory: string | null; customerId: string | null; applicationId: string | null; createdAt: string; acceptedAt: string | null;
  deliveredAt: string | null; bouncedAt: string | null; complainedAt: string | null;
}
export interface EmailHistoryPage { total: number; items: EmailHistoryItem[] }
export interface EmailHistoryDetail {
  attempts: { provider: string; outcome: string; errorCategory: string | null; statusCode: number | null; ms: number | null; at: string }[];
  events: { type: string; bounceType: string | null; at: string }[];
}
export interface EmailSuppression { email: string; active: boolean; reason: string; source: string; note: string | null; updatedAt: string }
export interface EmailRulePreview { rule: string; recipients: { mode: 'CC' | 'BCC'; email: string; name: string | null }[] }

// ---------------------------------------------------------------------------
// Company Notice Board (migration 20270131000200)
// ---------------------------------------------------------------------------
export type NoticeCategory = 'GENERAL' | 'HR' | 'POLICY' | 'EVENT' | 'HOLIDAY' | 'IT_SYSTEM' | 'OPERATIONS' | 'OTHER';
export type NoticePriority = 'NORMAL' | 'IMPORTANT' | 'URGENT';
/** SALES / SUPPORT (20270224000100): one department's Sales or Support function; `employees` empty = the whole function */
export type NoticeAudienceType = 'COMPANY' | 'DEPARTMENT' | 'ROLE' | 'EMPLOYEES' | 'SALES' | 'SUPPORT';
/** SUPER_ADMIN / HR / DEVELOPER: any audience; OPERATIONS_HEAD: only the departments they own */
/** 20270202000100: SUPER_ADMIN, HR and CRM_TEAM (Ashish, Shreya, Siddhesh by profile id) publish; the earlier OPERATIONS_HEAD / DEVELOPER only mark old notices. */
export type NoticePublisherRole = 'SUPER_ADMIN' | 'OPERATIONS_HEAD' | 'HR' | 'DEVELOPER' | 'CRM_TEAM';
export interface CompanyNotice {
  id: string; reference: string; title: string; body: string; category: NoticeCategory; priority: NoticePriority;
  status: 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED'; expired: boolean; publishAt: string; expiresAt: string | null; releasedAt: string | null; updatedAt: string; version: number;
  publisherId: string; publisherName: string | null; publisherRole: NoticePublisherRole;
  audience: { type: NoticeAudienceType; departments: string[]; roles: string[]; employees: string[]; departmentNames: string[] };
  isRecipient: boolean; read: boolean; readAt: string | null; canManage: boolean; recipientCount: number; readCount: number;
  /** 20270202000100: the person's own acknowledgement, and (managers only; 0 for everybody else) how many acknowledged */
  acknowledged: boolean; acknowledgedAt: string | null; acknowledgedCount: number;
  attachments: { id: string; name: string; mime: string; size: number }[];
  /** the publisher's / Super Admin's view of an opened notice: every version */
  history?: { version: number; action: 'PUBLISHED' | 'EDITED' | 'ARCHIVED'; by: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
  duplicate?: boolean; notified?: number;
}
export interface NoticeList { items: CompanyNotice[]; total: number; unread: number; publisherRole: NoticePublisherRole | null }
export interface NoticeReceipts {
  noticeId: string; status: CompanyNotice['status']; total: number; read: number; unread: number;
  acknowledged: number; notAcknowledged: number; readPercent: number; acknowledgedPercent: number; version: number;
  push: { devices: number; accepted: number; pending: number; failed: number; cancelled: number };
  rows: { profileId: string; name: string; department: string | null; notifiedAt: string | null; readAt: string | null; acknowledgedAt: string | null; acknowledgedVersion: number | null }[];
}
/** 20270202000100: the popup queue (Urgent first, then Important, then Normal; the oldest first inside a priority), the acknowledgement, and the CRM team's access */
export interface NoticePending { pending: number; items: CompanyNotice[] }
/** Deleting a notice (migration 20270205000100): a soft delete, the record and its receipts are kept. */
export interface NoticeDeleted { id: string; deleted: true; alreadyDeleted: boolean }
export interface NoticeAcknowledged { noticeId: string; acknowledged: boolean; acknowledgedAt: string | null; pending: number }
export interface NoticeManagers {
  managers: { profileId: string; name: string; email: string | null; status: string; department: string | null; since: string }[];
  candidates: { profileId: string; name: string; role: string; department: string | null }[];
}
export interface NoticeAudienceOptions {
  canPublish: boolean; role: NoticePublisherRole | null; audiences: NoticeAudienceType[];
  departments: { id: string; name: string }[]; roles: { id: string; label: string }[];
  employees: { id: string; name: string; role: string; department: string | null; departmentId: string | null }[];
  /** (20270224000100) the Sales / Support departments with the people of that function; absent before the migration runs */
  sales?: NoticeDivisionDepartment[];
  support?: NoticeDivisionDepartment[];
}
export interface NoticeDivisionDepartment {
  id: string; name: string;
  employees: { id: string; name: string; role: string; team: string | null }[];
}

// ---------------------------------------------------------------------------
// HR Awards (20270203000100): Award Management > Awards
// ---------------------------------------------------------------------------
export type HrAwardCode = 'PROFESSIONALISM_EXCELLENCE' | 'RISING_STAR' | 'PLAYER' | 'EMERGING_LEADER' | 'DEPARTMENT' | 'TEAM' | 'BUSINESS_ICON';
export type HrAwardNomineeType = 'INDIVIDUAL' | 'TEAM' | 'DEPARTMENT';
/** NO_NOMINEES: nothing yet; NOMINATIONS_OPEN: nominees, no winner yet; WINNERS_DECLARED: at least one winner */
export type HrAwardStatus = 'NO_NOMINEES' | 'NOMINATIONS_OPEN' | 'WINNERS_DECLARED';
export interface HrAwardCard {
  code: HrAwardCode; name: string; description: string | null; nomineeType: HrAwardNomineeType;
  periodId: string | null; nominees: number; winners: number; status: HrAwardStatus; winnerNames: string[];
}
export interface HrAwardsOverview {
  month: string; monthLabel: string; awards: HrAwardCard[];
  /** the months that have award records, newest first */
  history: { month: string; monthLabel: string; nominees: number; winners: number }[];
}
export interface HrAwardNominee {
  id: string; periodId: string; nomineeType: HrAwardNomineeType; entityId: string;
  profileId: string | null; teamId: string | null; departmentId: string | null;
  name: string; departmentName: string | null; teamName: string | null; designation: string | null;
  reason: string; remarks: string | null; status: 'NOMINATED' | 'WINNER';
  nominatedAt: string; nominatedBy: string | null; updatedAt: string; updatedBy: string | null;
}
export interface HrAwardWinner {
  id: string; periodId: string; nomineeId: string; name: string; nomineeType: HrAwardNomineeType;
  departmentName: string | null; teamName: string | null; designation: string | null; remarks: string | null;
  declaredAt: string; declaredBy: string | null; updatedAt: string;
  revokedAt: string | null; revokedBy: string | null; revokeReason: string | null;
}
export interface HrAwardDetail {
  award: { code: HrAwardCode; name: string; description: string | null; nomineeType: HrAwardNomineeType };
  month: string; monthLabel: string; periodId: string | null;
  totalNominees: number; totalWinners: number; status: HrAwardStatus;
  nominees: HrAwardNominee[]; winners: HrAwardWinner[]; revokedWinners: HrAwardWinner[]; removedNominees: number;
}
export interface HrAwardOptions {
  employees: { id: string; name: string; departmentId: string | null; departmentName: string | null; teamId: string | null; teamName: string | null; designation: string | null }[];
  teams: { id: string; name: string; departmentId: string; departmentName: string; members: number }[];
  departments: { id: string; name: string; members: number }[];
}

// ---------------------------------------------------------------------------
// Role-based Offer Letter templates (20270206000100): HR > Offer Letter Generation
// ---------------------------------------------------------------------------
import type { OfferLetterhead, OfferTemplateContent } from './offerTemplates.js';
export type { OfferBlock, OfferLetterhead, OfferTemplateContent, OfferTemplateField } from './offerTemplates.js';
/** A role-based Offer Letter request: the template version and the values HR entered (the server loads the wording and letterhead itself). */
export interface HrRoleOfferFields { offerTemplateId: string; templateVersion: number; values: Record<string, string> }
export interface OfferTemplateFile { id: string; kind: 'SAMPLE' | 'LETTERHEAD'; fileName: string; mimeType: string; sizeBytes: number; uploadedBy: string | null; createdAt: string }
export interface OfferTemplateVersion {
  templateId: string;
  version: number;
  letterhead: OfferLetterhead;
  sampleFile: OfferTemplateFile | null;
  letterheadFile: OfferTemplateFile | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  content?: OfferTemplateContent;
  /** letters issued with this version (in the version history) */
  issued?: number;
}
export interface OfferTemplate {
  id: string;
  key: string;
  designation: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
  versionCount: number;
  current: OfferTemplateVersion & { content: OfferTemplateContent };
  /** letters issued from this template */
  issued: number;
}
export interface OfferTemplateList { canManage: boolean; templates: OfferTemplate[] }
export interface OfferTemplateHistory extends OfferTemplate { versions: OfferTemplateVersion[] }
/** The bundled letterheads (from the supplied samples), for the template editor. */
export interface OfferLetterheadOption { key: string; label: string }

// ---- Task daily reports and performance approval (migration 20270209000100) ----
export type TaskReportStatus = 'PENDING' | 'APPROVED' | 'RETURNED';

/** One daily report of a Team Member against one assigned task. */
export interface TaskDailyReport {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  taskPriority: string;
  taskDueDate: string | null;
  authorId: string;
  author: string;
  designation: string | null;
  departmentId: string;
  teamId: string | null;
  reviewerId: string | null;
  reportDate: string;
  workCompleted: string;
  progress: number;
  pendingWork: string | null;
  delayReason: string | null;
  remarks: string | null;
  status: TaskReportStatus;
  revision: number;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  /** The signed-in person is the reviewer and the report waits for a decision. */
  canReview: boolean;
  /** The signed-in person wrote it and it was returned for correction. */
  canEdit: boolean;
  /** 20270213000100 (optional: absent on an older database). The Team Lead who last edited it before deciding, and when. */
  editedBy?: string | null;
  editedAt?: string | null;
  /** The signed-in person is the reviewer and may edit the waiting report before deciding it. */
  canReviewerEdit?: boolean;
}
/** A changed field of a report or an evaluation: the value before and after. */
export type FieldChanges = Record<string, { from: string | number | null; to: string | number | null }>;
export interface TaskDailyReportDetail extends TaskDailyReport {
  history: { action: 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'RESUBMITTED' | 'EDITED'; by: string | null; at: string; from: string | null; to: string; remarks: string | null; revision: number; changes?: FieldChanges | null }[];
}
export interface TaskDailyReportList {
  counts: { pending: number; approved: number; returned: number; total: number };
  total: number;
  items: TaskDailyReport[];
}
/** A task the Team Member may report on. */
export interface TaskReportTaskOption {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  progress: number;
  description: string | null;
  assignedAt: string;
  lastReportDate: string | null;
  reportedToday: boolean;
}

export interface PerformancePart { key: string; label: string; weight: number; value: number | null }
export interface MemberPerformanceMetrics {
  tasks: { total: number; completed: number; pending: number; overdue: number; onTime: number; late: number; crossTeam?: number };
  /** AI Studio (20270221000100): projects contributed to, cross-team tasks, submitted daily reports that name a blocker. */
  contribution?: { projects: number; crossTeamTasks: number; blockers: number };
  completionPct: number | null;
  onTimePct: number | null;
  progressPct: number | null;
  reports: { submitted: number; approved: number; returned: number; pending: number; approvalPct: number | null; expectedDays: number; approvedDays: number; consistencyPct: number | null };
  parts: PerformancePart[];
  score: number | null;
}
export interface LeadPerformanceMetrics {
  own: { total: number; completed: number; overdue: number; completionPct: number | null };
  team: { members: number; total: number; completed: number; pending: number; overdue: number; onTime: number; late: number; completionPct: number | null; onTimePct: number | null; progressPct: number | null };
  reports: { submitted: number; approved: number; returned: number; pending: number; waitingOverOneDay: number; reviewedPct: number | null; avgReviewHours: number | null };
  management: { tasksAssignedToTeam: number; tasksReceived: number; handedDown: number; handledOrDelegated: number; delegationPct: number | null; crossTeamGiven?: number };
  parts: PerformancePart[];
  score: number | null;
}
export interface PerformanceRecordState {
  id: string;
  status: TaskReportStatus;
  version: number;
  /** The score that was stored (for an approved record: the score that was approved). */
  score: number | null;
  generatedAt: string;
  refreshedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  canDecide: boolean;
  canResubmit: boolean;
  /** 20270210000100 (optional: absent on an older database). The rating (1 to 5) given when approving. */
  rating?: number | null;
  /** The reviewer may return it (false for a member of International / Reseller: their reports are returned, not their performance). */
  canReturn?: boolean;
  /** Approving needs a rating (International / Reseller). */
  ratingRequired?: boolean;
  /** The member's daily reports in the period still waiting for review (International / Reseller cannot approve until they are decided). */
  waitingReports?: number;
  /** 20270213000100: the reviewer may update the rating and remarks of this approved evaluation. */
  canUpdate?: boolean;
}
export interface PerformancePerson<M = MemberPerformanceMetrics | LeadPerformanceMetrics> {
  id: string;
  name: string;
  designation: string | null;
  role: 'TEAM_MEMBER' | 'TEAM_HEAD';
  teamId: string | null;
  team: string | null;
  metrics: M;
  liveScore: number | null;
  record: PerformanceRecordState | null;
}
export type PerformanceMember = PerformancePerson<MemberPerformanceMetrics>;
export type PerformanceLead = PerformancePerson<LeadPerformanceMetrics> & { members: PerformanceMember[] };
interface PerformanceOverviewBase { periodStart: string; periodEnd: string; today: string }
export interface MemberPerformanceOverview extends PerformanceOverviewBase { role: 'TEAM_MEMBER'; me: PerformanceMember }
export interface LeadPerformanceOverview extends PerformanceOverviewBase {
  role: 'TEAM_HEAD';
  me: PerformancePerson<LeadPerformanceMetrics>;
  members: PerformanceMember[];
  pendingReports: number;
  pendingRecords: number;
  /** 20270210000100: only the Team Lead decides the members (International / Reseller). */
  leadDecidesMembers?: boolean;
  /** 20270214000100: AI Studio's own reports (the drill-down opens those). */
  source?: PerformanceSource;
}
export interface DepartmentPerformanceOverview extends PerformanceOverviewBase {
  role: 'DEPARTMENT_HEAD' | 'SUPER_ADMIN';
  department: { id: string; name: string };
  tasks: { total: number; completed: number; pending: number; overdue: number; completionPct: number | null };
  reports: { submitted: number; approved: number; returned: number; pending: number; approvedPct: number | null };
  leads: PerformanceLead[];
  unassignedMembers: PerformanceMember[];
  pendingRecords: number;
  /** 20270210000100: members without a Team Lead wait for one (International / Reseller) instead of being decided by the Department Head. */
  leadDecidesMembers?: boolean;
  /** 20270214000100: AI Studio's own reports (the drill-down opens those). */
  source?: PerformanceSource;
}
export type PerformanceOverview = MemberPerformanceOverview | LeadPerformanceOverview | DepartmentPerformanceOverview;
export interface PerformanceRecordHistoryEntry { action: 'GENERATED' | 'REFRESHED' | 'APPROVED' | 'RETURNED' | 'RESUBMITTED' | 'UPDATED' | 'REOPENED'; by: string | null; at: string; from: string | null; to: string; score: number | null; remarks: string | null; rating?: number | null; changes?: FieldChanges | null }

// ---- Performance Management, every department: one person's work for the reviewer (20270213000100) ----
export interface PerformanceWorkTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  progress: number;
  assignedAt: string;
  completedAt: string | null;
  overdue: boolean;
  /** Completed by the deadline (null: not completed, or no deadline). */
  onTime: boolean | null;
  reports: number;
  pendingReports: number;
  lastReport: { id: string; reportDate: string; progress: number; status: TaskReportStatus } | null;
  /** AI Studio (20270214000100): the task's project. */
  project?: string | null;
}
/** Where the work comes from: the task records and task daily reports, or AI Studio's own tasks and daily reports (20270214000100). */
export type PerformanceSource = 'TASKS' | 'AI_STUDIO';
export interface PerformanceWork { id: string; name: string; role: 'TEAM_MEMBER' | 'TEAM_HEAD'; periodStart: string; periodEnd: string; tasks: PerformanceWorkTask[]; source?: PerformanceSource }

// ---- International / Reseller: performance evaluation history of one person (20270210000100) ----
export interface PerformanceSubjectRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: TaskReportStatus;
  score: number | null;
  rating: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
}
export interface PerformanceSubjectHistory { id: string; name: string; role: 'TEAM_MEMBER' | 'TEAM_HEAD'; records: PerformanceSubjectRecord[] }

// ---------------------------------------------------------------------------------------------------------------------------------
// Google Sheet sync of existing customers (docs/CUSTOMER_SHEET_SYNC.md, migration 20270216000100)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface SheetSyncRun { at: string; rows: number; added: number; updated: number; saved: number; rejected: number; duplicates: number; outcome: 'OK' | 'PARTIAL' | 'FAILED' | 'EMPTY' }
export interface SheetSyncConnection {
  id: string;
  keyHint: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  lastSyncAt: string | null;
  syncCount: number;
  lastResult: Omit<SheetSyncRun, 'at' | 'rows'> | null;
  runs: SheetSyncRun[];
}
/** The answer when a sheet is connected (or its key replaced): the key is shown ONCE, inside the script. */
export interface SheetSyncConnectResult { connection: SheetSyncConnection; key: string }
export type SheetSyncRowStatus = 'ADDED' | 'UPDATED' | 'SAVED' | 'DUPLICATE' | 'ERROR' | 'SKIPPED';
/** What the sheet gets back: one result per sheet row, written into its "CRM Status" column. */
export interface SheetSyncResult {
  results: { row: number; status: SheetSyncRowStatus; message: string }[];
  summary: { added: number; updated: number; saved: number; rejected: number; duplicates: number; outcome: SheetSyncRun['outcome'] };
  logins: { row?: number; email: string; created: boolean; mail: 'SENT' | 'NOT_SENT'; detail?: string }[];
}
/** Global search (Ctrl / Cmd + K): the kinds of records the database may return (public.global_search). */
export const SEARCH_RECORD_TYPES = ['employee', 'customer', 'lead', 'meeting', 'ticket', 'department', 'notice', 'ai_studio_task', 'ai_studio_project', 'ai_studio_report'] as const;
export type SearchRecordType = (typeof SEARCH_RECORD_TYPES)[number];
export interface SearchRecord {
  type: SearchRecordType;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  reference: string | null;
  score: number;
}
export interface SearchResponse {
  query: string;
  groups: { type: SearchRecordType; items: SearchRecord[]; hasMore: boolean }[];
}
/** One opened result (GET /search/records/:type/:id): label / value pairs for display, in order. */
export interface SearchRecordCard { type: SearchRecordType; id: string; title: string; fields: [string, string][] }

// ---------------------------------------------------------------------------
// Assigned task deletion (20270220000100): Team Lead, Department Head, Operations Head
// ---------------------------------------------------------------------------
/** What the delete confirmation shows for a Task module task: whether the caller may delete it and what goes with it. */
export interface TaskDeletePreview {
  taskId: string; title: string; status: string; assigneeName: string | null;
  canDelete: boolean; reason: string | null;
  subtasks: number; updates: number; dailyReports: number;
}
export interface TaskDeleteResult { deleted: true; taskId: string; title: string; subtasks: number; updates: number; dailyReports: number }
export interface AiStudioTaskDeleteResult { deleted: true; taskId: string; title: string; updates: number; reports: number }
export interface AdsAssignmentDeleteResult { deleted: true; id: string; title: string; memberParts: number }

// ---------------------------------------------------------------------------
// Dashboard Explorer (migration 20270301000100): the Managing Director's preview audit and dashboard improvement requests
// ---------------------------------------------------------------------------
export interface PreviewSession { sessionId: string; startedAt: string }
export interface PreviewRecent { dashboardId: string; department: string; viewedAt: string }
export interface ImprovementRequestResult { id: string; reference: string; status: DevBugStatus; duplicate: boolean }
export interface ImprovementRequestRow {
  id: string; reference: string; title: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; status: DevBugStatus;
  dashboardId: string | null; department: string | null; page: string | null; viewport: string | null; resolutionNote: string | null; createdAt: string; updatedAt: string;
}

// ---------------------------------------------------------------------------
// Support Recharges (migration 20270228000200)
// ---------------------------------------------------------------------------
export type RechargeKind = 'PANEL' | 'MESSAGE';
export type RechargeStatus = 'PENDING' | 'VERIFIED' | 'COMPLETED' | 'REJECTED';
export interface SupportRecharge {
  id: string;
  reference: string;
  kind: RechargeKind;
  customerName: string;
  rechargeDate: string;
  gstAmount: number;
  gstDetails: string | null;
  nonGstAmount: number;
  nonGstDetails: string | null;
  totalAmount: number;
  status: RechargeStatus;
  remarks: string | null;
  statusNote: string | null;
  statusAt: string | null;
  statusByName: string | null;
  createdById: string;
  createdByName: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
  screenshot: { id: string; name: string; mime: string; size: number } | null;
  /** decided by the database for the signed-in person */
  canEdit: boolean;
  nextStatuses: RechargeStatus[];
}
export interface SupportRechargeSummary {
  totalRecharges: number;
  totalAmount: number;
  totalGst: number;
  totalNonGst: number;
  pending: number;
  verified: number;
  completed: number;
  rejected: number;
}
export interface SupportRechargeList {
  items: SupportRecharge[];
  total: number;
  limit: number;
  offset: number;
  summary: SupportRechargeSummary;
  role: 'SUPER_ADMIN' | 'HEAD' | 'LEAD' | 'MEMBER';
  canCreate: boolean;
}
export interface RechargeUploadTicket {
  attachment: { id: string; name: string; mime: string; size: number };
  bucket: string;
  path: string;
  provider: 'R2' | 'SUPABASE';
  token: string;
  upload?: { url: string; headers: Record<string, string> };
}

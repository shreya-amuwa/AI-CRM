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

/**
 * The dashboard a user opens, stored in profiles.default_dashboard and kept in
 * step with role + team division by the database (one value per department role).
 */
export type DefaultDashboard =
  | 'super-admin'
  | 'department-head'
  | 'hr-head'
  | 'sales-lead'
  | 'support-lead'
  | 'accounts-staff'
  | 'team-lead'
  | 'sales-member'
  | 'support-member'
  | 'technical-consultant'
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
  amount: number;
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
  dealAmount: number | null;
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
export type InvoiceKind = 'MANUAL' | 'SERVICE' | 'ADDON' | 'UPLOADED';

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
  addonRequestId: string | null;
  issuedBy: string | null;
  issuedAt: string;
  createdAt: string;
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
export type ClientServiceStatus = 'LIVE' | 'SETTING_UP';
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
  items: { name?: string; quantity?: number; unitPrice?: number; lineTotal?: number }[];
  hasFile: boolean;
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

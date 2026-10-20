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
  /** The total payable, GST included. */
  dealAmount: number | null;
  agreedAmount?: number | null;
  taxBasis?: AgreementTaxBasis;
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
  /** True while the GST of the part not invoiced yet is still an estimate. */
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
  lines: { serviceCode: string | null; particulars: string; hsnSac: string; taxRate: number; quantity: string; baseAmount: number | null }[];
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
  /** SENT: the "Set your password" e-mail went out; NOT_SENT: see detail (it can be sent again later). */
  mail: 'SENT' | 'NOT_SENT';
  detail?: string;
}
export interface CustomerDataImportResult {
  committed: boolean;
  errors: CustomerDataImportError[];
  summary: { added: number; updated: number; services: number; usage: number; campaigns: number; logins: number };
  logins: CustomerDataImportLogin[];
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

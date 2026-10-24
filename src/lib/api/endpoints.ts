/**
 * Typed API endpoints, grouped by resource. Components and hooks call these;
 * they never call fetch() or Supabase tables directly.
 */
import type {
  BaAssignee, BaContactDetail, BaContactList, BaDemo, BaHome, BaQuotation, BaQuotationRow, BaScope, BaScopeRow, ServicePrice,
  SalesSubRole,
  HeadDivision,
  TelecallerAssignee,
  TelecallerContact,
  TelecallerContactList,
  TelecallerHome,
  TelecallerLead,
  TelecallerLeadList,
  TelecallerSheet,
  TelecallerSheetCheck,
  TrainingAttendance,
  TrainingEmployee,
  TrainingEnrollmentDetail,
  TrainingOverview,
  TrainingProgram,
  TrainingProgramDetail,
  TrainingRecords,
  HrRecruiter,
  RecruitmentActionKind,
  RecruitmentAgenda,
  RecruitmentCallOutcome,
  RecruitmentCandidate,
  RecruitmentConfirmation,
  RecruitmentDetail,
  RecruitmentList,
  RecruitmentOverview,
  RecruitmentPosition,
  PerformanceHistoryEntry,
  PerformancePeople,
  PerformancePeriodKind,
  PerformanceReport,
  PerformanceScope,
  AuditEvent,
  AuditOutcome,
  CompanyOverview,
  CompanyWorkflow,
  ScopeOverview,
  BusinessOrdersPage,
  BusinessPerson,
  BusinessReport,
  BusinessTransactionsPage,
  InvoiceBusinessInfo,
  ClientActivityInput,
  ClientActivityList,
  ClientCalendarEvent,
  ClientDocumentQueueItem,
  CustomerJourneyInfo,
  DeliveryQueueItem,
  ServiceJourneySetting,
  AttendanceDay,
  HrEmailDataIssue,
  HrEmailHistory,
  HrEmailKind,
  HrEmailCards,
  HrEmailOverview,
  HrEmailRunSummary,
  HrEmailStatus,
  HrProbationCycle,
  LeaveMonthlySummary,
  LeaveRequest,
  LeaveReview,
  PersonalDetails,
  AccountsPlans,
  ConsultantOpenServiceRequest,
  ConsultantServiceRequest,
  MonthlyPlan,
  AccountsConfirmation,
  DivisionLeadsOverview,
  DivisionSupportOverview,
  AddonRequest,
  AddonRequestPage,
  AddonRequestStatus,
  Invoice,
  InvoiceCustomer,
  InvoiceKind,
  InvoicePage,
  InvoicePrefill,
  AgreementReviewItem,
  AgreementTaxBasis,
  OrderSummary,
  InvoicePurpose,
  InvoiceRunResult,
  InvoiceStage,
  ClientDocumentUrl,
  AccountsPaymentCounts,
  ChecklistItem,
  ConsultantNote,
  ExpensesPage,
  DepartmentFinance,
  FinanceSummary,
  FinanceTrend,
  IncomePage,
  ApprovalRequest,
  AuditLog,
  Customer,
  CustomerActivity,
  CustomerSegment,
  CustomerStatus,
  CustomerDocument,
  CustomerSummary,
  Conversation,
  FollowUpOutcome,
  LeadAccountsFilter,
  PartPaymentItem,
  PartPaymentsPage,
  PartPaymentStatusFilter,
  PaymentOverview,
  PaymentRequestItem,
  PaymentType,
  Department,
  DocumentUploadTicket,
  TicketAttachment,
  TicketUploadTicket,
  AttributionReconciliation,
  ClientPurchaseRule,
  DepartmentIncomeReport,
  DocumentUrl,
  HandoverStage,
  InboundLead,
  LeadStatus,
  OnboardingFilter,
  PaymentFilter,
  PaymentMethod,
  PipelineCounts,
  ReviewCounts,
  AutomationCode,
  AutomationStatus,
  ClientMessages,
  PipelineCustomer,
  PipelineCustomerDetail,
  PipelineStage,
  ServiceCatalogItem,
  ImportResult,
  Notification,
  NotificationPriority,
  Paginated,
  Profile,
  RegistrationDepartment,
  Role,
  Team,
  TeamDivision
} from '../../../shared/contracts';
import type { BusinessOrdersQuery, BusinessReportQuery, BusinessTransactionsQuery, InvoiceBusinessTagInput, MemberDetailsInput, PricedLineInput, ExpenseInput, CustomerCreateInput, CustomerUpdateInput, LeadCreateInput, LeadUpdateInput, UploadMimeType } from '../../../shared/validation';
import { requireSupabase } from '../../services/supabaseClient';
import { api } from './client';

export interface CustomerQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CustomerStatus;
  segment?: CustomerSegment;
  ownerId?: string;
  teamId?: string;
  departmentId?: string;
  sort?: 'createdAt' | 'name' | 'lastOrderAmount';
  order?: 'asc' | 'desc';
  /** Comma-separated lifecycle stages, e.g. 'ONBOARDING,CUSTOMER'. */
  lifecycle?: string;
}

export interface AccountsPaymentInput {
  type: PaymentType;
  /** With GST: the amount before GST. */
  amount: number;
  gstRate?: number | null;
  method: PaymentMethod;
  reference?: string | null;
  paidAt?: string | null;
  note?: string | null;
}

export interface PartPaymentsParams {
  status?: PartPaymentStatusFilter;
  search?: string;
  salesperson?: string;
  accountsOwner?: string;
  from?: string;
  to?: string;
  followUp?: 'FOLLOW_UP_REQUIRED' | 'CONTACTED' | 'AWAITING_PAYMENT' | 'FULLY_PAID';
  sort?: 'recent' | 'balance' | 'name' | 'followUp';
  page?: number;
  pageSize?: number;
  /** Super Admin: one sub-department (department + team division). */
  departmentId?: string;
  division?: TeamDivision;
}

export interface PipelineQuery {
  stage: PipelineStage;
  /** Super Admin: one sub-department (department + team division) and optionally one owner. */
  departmentId?: string;
  division?: TeamDivision;
  ownerId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  service?: string;
  source?: string;
  leadStatus?: LeadStatus;
  followUpFrom?: string;
  followUpTo?: string;
  noFollowUp?: boolean;
  payment?: PaymentFilter;
  /** Leads tabs: with Accounts for payment confirmation / returned by Accounts. */
  accounts?: LeadAccountsFilter;
  onboarding?: OnboardingFilter;
  handover?: HandoverStage;
  handoverMine?: 'TEAM_LEAD' | 'TEAM_MEMBER';
  review?: 'TO_REVIEW' | 'NEEDS_FIX' | 'VERIFIED' | 'AWAITING_DOCUMENTS' | 'WAITING_ON_SALES';
  forwarded?: boolean;
  /** Technical Consultant Customers panel (not yet sent for onboarding). */
  intake?: boolean;
  /** Technical Consultant Add-ons Services section. */
  addons?: boolean;
  mine?: boolean;
  sort?: 'newest' | 'oldest' | 'followUp' | 'dueDate' | 'amount' | 'name';
}

export const pipelineApi = {
  services: () => api.get<ServiceCatalogItem[]>('/pipeline/services'),
  counts: () => api.get<PipelineCounts>('/pipeline/counts'),
  divisionSupportOverview: (departmentId: string, division: TeamDivision) =>
    api.get<DivisionSupportOverview>('/pipeline/division-support-overview', { departmentId, division }),
  divisionOverview: (departmentId: string, division: TeamDivision) =>
    api.get<DivisionLeadsOverview>('/pipeline/division-overview', { departmentId, division }),
  list: (q: PipelineQuery) => api.get<Paginated<PipelineCustomer>>('/pipeline/customers', { ...q }),
  get: (id: string) => api.get<PipelineCustomerDetail>(`/pipeline/customers/${id}`),
  createLead: (body: LeadCreateInput) => api.post<PipelineCustomer>('/pipeline/leads', body),
  updateLead: (id: string, body: LeadUpdateInput) => api.patch<PipelineCustomer>(`/pipeline/leads/${id}`, body),
  moveToPotential: (id: string, body: { dealAmount: number; paymentDueDate: string }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/move-to-potential`, body),
  recordPayment: (id: string, body: { amount: number; method?: PaymentMethod }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/payments`, body),
  /** Where the customer is on its journey, and what the signed-in person may do next. */
  customerJourney: (id: string) => api.get<CustomerJourneyInfo>(`/pipeline/customers/${id}/journey`),
  /** Accounts: create the dashboard login of a customer whose services need no Technical Consultant. */
  accountsCreateClientLogin: (id: string, body: { email: string; password: string }) =>
    api.post<{ email: string }>(`/pipeline/customers/${id}/accounts/client-login`, body),
  /** Sales / Support: send the verified services to the department that delivers them. */
  sendToDelivery: (id: string, note?: string | null) =>
    api.post<{ sent: number; remaining: number; departments: string | null }>(`/pipeline/customers/${id}/send-to-delivery`, { note: note || null }),
  deliveryQueue: (q: { search?: string; page?: number; pageSize?: number } = {}) => api.get<Paginated<DeliveryQueueItem>>('/pipeline/delivery-queue', { ...q }),
  serviceJourneys: () => api.get<ServiceJourneySetting[]>('/pipeline/service-journeys'),
  /** Super Admin only. */
  setServiceJourney: (code: string, body: { requiresTechnicalConsultant: boolean; deliveryDepartmentId?: string | null }) =>
    api.patch<ServiceJourneySetting[]>(`/pipeline/service-journeys/${code}`, body),
  createClientAccount: (id: string, body: { email: string; password: string }) =>
    api.post<{ email: string }>(`/pipeline/customers/${id}/client-account`, body),
  sendToDepartmentHead: (id: string, note?: string | null) => api.post<null>(`/pipeline/customers/${id}/handover/department-head`, { note: note || null }),
  passToTeamLead: (id: string, teamLeadId: string, note?: string | null) =>
    api.post<null>(`/pipeline/customers/${id}/handover/team-lead`, { teamLeadId, note: note || null }),
  assignToTeamMember: (id: string, memberId: string, note?: string | null) =>
    api.post<null>(`/pipeline/customers/${id}/handover/team-member`, { memberId, note: note || null }),
  backOut: (id: string, reason?: string | null) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/back-out`, { reason: reason || null }),
  startOnboarding: (id: string, body: { amountReceived: number; paymentMethod: PaymentMethod; targetHandoverDate?: string | null }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/start-onboarding`, body),
  updateOnboarding: (id: string, body: { targetHandoverDate: string | null }) =>
    api.patch<PipelineCustomer>(`/pipeline/customers/${id}/onboarding`, body),
  forwardToSupport: (id: string) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/forward-to-support`),
  consultantSetContract: (id: string, signed: boolean) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/contract`, { signed }),
  consultantUpdateCustomer: (id: string, body: { name: string; company?: string | null; phone?: string | null; email?: string | null; expectedUpdatedAt?: string | null }) =>
    api.patch<PipelineCustomer>(`/pipeline/customers/${id}/consultant/details`, body),
  consultantSetAddonsRequired: (id: string, required: boolean) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/addons-required`, { required }),
  addonChecklist: (id: string) => api.get<ChecklistItem[]>(`/pipeline/customers/${id}/addon-checklist`),
  consultantNotes: (id: string) => api.get<ConsultantNote[]>(`/pipeline/customers/${id}/consultant/notes`),
  consultantAddNote: (id: string, body: { body: string; serviceCode?: string | null }) =>
    api.post<ConsultantNote[]>(`/pipeline/customers/${id}/consultant/notes`, body),
  consultantUpdateNote: (id: string, noteId: string, body: string) =>
    api.patch<ConsultantNote[]>(`/pipeline/customers/${id}/consultant/notes/${noteId}`, { body }),
  consultantStartOnboarding: (id: string) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/start-onboarding`),
  conversations: (id: string) => api.get<Conversation[]>(`/pipeline/customers/${id}/conversations`),
  addConversation: (id: string, note: string) => api.post<Conversation[]>(`/pipeline/customers/${id}/conversations`, { note }),
  updateConversation: (conversationId: string, note: string) => api.patch<null>(`/pipeline/conversations/${conversationId}`, { note }),
  sendToAccounts: (id: string, body: { amount: number; note?: string | null }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/send-to-accounts`, { amount: body.amount, note: body.note || null }),
  paymentOverview: (id: string) => api.get<PaymentOverview>(`/pipeline/customers/${id}/payment-overview`),
  partPayments: (q: PartPaymentsParams = {}) => api.get<PartPaymentsPage>('/pipeline/part-payments', { ...q }),
  paymentRequests: (q: { status?: 'PENDING' | 'CONFIRMED' | 'RETURNED'; search?: string; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<PaymentRequestItem>>('/pipeline/accounts/payment-requests', { ...q }),
  accountsCounts: () => api.get<AccountsPaymentCounts>('/pipeline/accounts/counts'),
  accountsTeam: () => api.get<{ id: string; fullName: string; role: string }[]>('/pipeline/accounts/team'),
  recordAccountsPayment: (id: string, body: AccountsPaymentInput & { verify: boolean }) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments`, body),
  updateAccountsPayment: (id: string, paymentId: string, body: AccountsPaymentInput) =>
    api.patch<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}`, body),
  verifyAccountsPayment: (id: string, paymentId: string) => api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/verify`, {}),
  rejectAccountsPayment: (id: string, paymentId: string, reason: string) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/reject`, { reason }),
  reverseAccountsPayment: (id: string, paymentId: string, reason: string) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/reverse`, { reason }),
  confirmPaymentAndReturn: (id: string, note?: string | null) => api.post<null>(`/pipeline/customers/${id}/accounts/payment-confirmed`, { note: note || null }),
  customerBackedOff: (id: string, reason?: string | null) => api.post<null>(`/pipeline/customers/${id}/accounts/back-off`, { reason: reason || null }),
  assignPaymentOwner: (id: string, ownerId: string | null) => api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/owner`, { ownerId }),
  addPaymentFollowUp: (id: string, body: { outcome: FollowUpOutcome; note: string; nextFollowUpAt?: string | null }) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/followups`, { ...body, nextFollowUpAt: body.nextFollowUpAt || null }),
  accountsConfirmations: (q: { status?: 'PENDING' | 'CONFIRMED'; search?: string; page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<AccountsConfirmation>>('/pipeline/accounts/confirmations', { ...q }),
  confirmAccountsPayment: (id: string, note?: string | null) => api.post<null>(`/pipeline/customers/${id}/accounts/confirm`, { note: note || null }),
  returnToSales: (id: string, note: string | null) => api.post<null>(`/pipeline/customers/${id}/return-to-sales`, { note }),
  inbound: () => api.get<InboundLead[]>('/pipeline/inbound'),
  claimInbound: (leadId: string) => api.post<PipelineCustomer>(`/pipeline/inbound/${encodeURIComponent(leadId)}/claim`),
  saveChecklistItem: (id: string, item: string, body: { value: string }) =>
    api.patch<null>(`/pipeline/customers/${id}/checklist/${item}`, body),
  saveConsultantItem: (id: string, item: string, body: { value: string }) =>
    api.patch<null>(`/pipeline/customers/${id}/consultant-items/${item}`, body),
  reviewCounts: () => api.get<ReviewCounts>('/pipeline/review-counts'),
  // Support / Technical Consultant: the client's calendar activity and the documents clients provide
  clientCustomers: (search?: string) => api.get<{ id: string; code: string | null; name: string; company: string | null; hasClientLogin: boolean }[]>('/pipeline/client-customers', { search: search || undefined }),
  clientActivity: (customerId: string) => api.get<ClientActivityList>(`/pipeline/customers/${customerId}/client-activity`),
  logClientActivity: (customerId: string, input: ClientActivityInput) => api.post<ClientCalendarEvent>(`/pipeline/customers/${customerId}/client-activity`, input),
  updateClientActivity: (id: string, input: ClientActivityInput) => api.patch<ClientCalendarEvent>(`/pipeline/client-activity/${id}`, input),
  deleteClientActivity: (id: string) => api.delete<null>(`/pipeline/client-activity/${id}`),
  clientDocumentQueue: (status: 'PENDING' | 'REVIEWED') => api.get<ClientDocumentQueueItem[]>('/pipeline/client-documents', { status }),
  reviewClientDocument: (customerId: string, itemCode: string, decision: 'VERIFIED' | 'REJECTED', note?: string) =>
    api.post<null>(`/pipeline/customers/${customerId}/client-documents/${itemCode}/review`, { decision, note: note || undefined }),
  clientUploadUrl: (documentId: string, action: 'view' | 'download' = 'view') => api.get<ClientDocumentUrl>(`/pipeline/client-documents/${documentId}/url`, { action }),
  verifyAll: (id: string) => api.post<{ verified: number }>(`/pipeline/customers/${id}/checklist/verify-all`),
  automations: (id: string) => api.get<AutomationStatus[]>(`/pipeline/customers/${id}/automations`),
  clientMessages: (id: string) => api.get<ClientMessages>(`/pipeline/customers/${id}/client-messages`),
  resendClientMessages: (id: string) => api.post<{ stage: string; queued: number }>(`/pipeline/customers/${id}/client-messages/resend`),
  setWebsite: (id: string, url: string) => api.post<{ website: string }>(`/pipeline/customers/${id}/consultant/website`, { url }),
  triggerAutomation: (id: string, code: AutomationCode) => api.post<AutomationStatus>(`/pipeline/customers/${id}/automations/${code}`),
  reviewChecklistItem: (id: string, item: string, body: { decision: 'VERIFIED' | 'REJECTED'; note?: string | null }) =>
    api.post<null>(`/pipeline/customers/${id}/checklist/${item}/review`, body)
};

export interface ExpenseParams {
  search?: string;
  departmentId?: string;
  companyWide?: boolean;
  category?: string;
  status?: 'PAID' | 'PENDING';
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Add-on requests (Technical Consultant -> Accounts Business Verification) and Accounts-issued invoices. */
export const addonsApi = {
  request: (customerId: string) => api.get<AddonRequest | null>(`/pipeline/customers/${customerId}/addon-request`),
  save: (customerId: string, body: { items: PricedLineInput[]; notes?: string | null; submit?: boolean; expectedVersion?: number }) =>
    api.post<AddonRequest>(`/pipeline/customers/${customerId}/addon-request`, body),
  startDocuments: (customerId: string) => api.post<AddonRequest>(`/pipeline/customers/${customerId}/addon-request/start-documents`),
  complete: (customerId: string) => api.post<AddonRequest>(`/pipeline/customers/${customerId}/addon-request/complete`),
  // Accounts
  list: (q: { status?: AddonRequestStatus; search?: string; consultant?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    api.get<AddonRequestPage>('/accounts/addon-requests', { ...q }),
  get: (id: string) => api.get<AddonRequest>(`/accounts/addon-requests/${id}`),
  decide: (id: string, body: { decision: 'APPROVE' | 'REJECT' | 'CHANGES'; note?: string | null; expectedVersion?: number }) =>
    api.post<AddonRequest>(`/accounts/addon-requests/${id}/decision`, body),
  /** The invoice of an approved request is uploaded by Accounts: begin -> upload -> invoicesApi.completeUpload. */
  beginInvoiceUpload: (id: string, body: {
    invoiceNumber?: string | null; issueDate?: string | null; dueDate?: string | null; reference?: string | null; note?: string | null;
    fileName: string; mimeType: 'application/pdf'; sizeBytes: number;
  }) => api.post<DocumentUploadTicket>(`/accounts/addon-requests/${id}/invoice-upload`, body),
  recordPayment: (id: string, body: { amount: number; method: PaymentMethod; reference?: string | null; paidAt?: string | null; note?: string | null; verify?: boolean }) =>
    api.post<AddonRequest>(`/accounts/addon-requests/${id}/payments`, body),
  decidePayment: (paymentId: string, body: { decision: 'VERIFY' | 'REJECT'; reason?: string | null }) =>
    api.post<AddonRequest>(`/accounts/addon-payments/${paymentId}/decision`, body),
  confirmPayment: (id: string, note?: string | null) => api.post<AddonRequest>(`/accounts/addon-requests/${id}/confirm-payment`, { note: note || null })
};

export const invoicesApi = {
  /** Read-only: invoices for one customer the caller may see. */
  forCustomer: (customerId: string) => api.get<Invoice[]>(`/pipeline/customers/${customerId}/invoices`),
  /** Read-only: every invoice the caller may see (Sales: own customers; TC: assigned; Accounts: all). */
  visible: (q: { search?: string; status?: 'Paid' | 'Pending'; page?: number; pageSize?: number } = {}) => api.get<InvoicePage>('/invoices', { ...q }),
  // Accounts only
  list: (q: { search?: string; kind?: InvoiceKind; status?: 'Paid' | 'Pending'; page?: number; pageSize?: number } = {}) =>
    api.get<InvoicePage>('/accounts/invoices', { ...q }),
  setStatus: (id: string, status: 'Paid' | 'Pending') => api.patch<Invoice>(`/accounts/invoices/${id}`, { status }),
  customers: (search?: string) => api.get<InvoiceCustomer[]>('/accounts/invoice-customers', { search }),
  /** One invoice the caller may read (current PDF included for an uploaded invoice). */
  get: (id: string) => api.get<Invoice>(`/invoices/${id}`),
  // Existing invoice PDFs (Accounts only): begin -> upload to the signed path -> complete
  beginUpload: (body: {
    customerId: string; invoiceNumber?: string | null; issueDate?: string | null; dueDate?: string | null; amount?: number | null;
    reference?: string | null; note?: string | null; fileName: string; mimeType: 'application/pdf'; sizeBytes: number;
  }) => api.post<DocumentUploadTicket>('/accounts/invoice-uploads', body),
  beginReplacement: (id: string, body: { fileName: string; mimeType: 'application/pdf'; sizeBytes: number }) =>
    api.post<DocumentUploadTicket>(`/accounts/invoices/${id}/replace`, body),
  completeUpload: (documentId: string) => api.post<Invoice>(`/accounts/invoice-uploads/${documentId}/complete`),
  updateDetails: (id: string, body: { issueDate?: string | null; dueDate?: string | null; amount?: number | null; reference?: string | null; note?: string | null }) =>
    api.post<Invoice>(`/accounts/invoices/${id}/details`, body)
};

/** The Accounts invoice builder: prefill -> issue (+ unpaid PDF + e-mail) -> confirm payment (+ paid PDF + e-mail). */
export const generatedInvoicesApi = {
  prefill: (customerId: string, q: { purpose: InvoicePurpose; addonRequestId?: string | null }) =>
    api.get<InvoicePrefill>(`/accounts/customers/${customerId}/invoice-prefill`, { purpose: q.purpose, addonRequestId: q.addonRequestId }),
  /** Accounts: say whether the amount on record is before or after GST (audited, with a reason). */
  setAgreementBasis: (customerId: string, body: { basis: AgreementTaxBasis; reason: string }) =>
    api.post<OrderSummary>(`/accounts/customers/${customerId}/agreement-basis`, body),
  agreementReview: () => api.get<AgreementReviewItem[]>('/accounts/agreement-review'),
  /** `body.requestId` is created once per builder session: repeating the request never creates a second invoice. */
  issue: (body: Record<string, unknown>) => api.post<InvoiceRunResult>('/accounts/generated-invoices', body),
  confirmPayment: (id: string, body: { method?: PaymentMethod | null; reference?: string | null; note?: string | null; paidOn?: string | null; amount?: string | null; requestId?: string }) =>
    api.post<InvoiceRunResult>(`/accounts/generated-invoices/${id}/confirm-payment`, body),
  /** Retry what is left of a stage (a missing PDF or e-mail). */
  deliver: (id: string, stage: InvoiceStage) => api.post<InvoiceRunResult>(`/accounts/generated-invoices/${id}/deliver`, { stage }),
  /** A short-lived link to a stored PDF (anyone who may read the invoice). */
  fileUrl: (id: string, stage: InvoiceStage, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/invoices/${id}/pdf`, { stage, action })
};

export const financeApi = {
  summary: (q: { departmentId?: string; from?: string; to?: string } = {}) => api.get<FinanceSummary>('/accounts/finance/summary', { ...q }),
  /** Earnings and expenses of each revenue department (Accounts, Education & Training and HR are left out). */
  departments: () => api.get<DepartmentFinance[]>('/accounts/finance/departments'),
  income: (q: { search?: string; departmentId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    api.get<IncomePage>('/accounts/finance/income', { ...q }),
  expenses: (q: ExpenseParams = {}) => api.get<ExpensesPage>('/accounts/finance/expenses', { ...q }),
  addExpense: (body: ExpenseInput) => api.post<{ id: string }>('/accounts/finance/expenses', body),
  updateExpense: (id: string, body: ExpenseInput) => api.patch<null>(`/accounts/finance/expenses/${id}`, body),
  deleteExpense: (id: string) => api.delete<null>(`/accounts/finance/expenses/${id}`),
  trend: (months = 12) => api.get<FinanceTrend>('/accounts/finance/trend', { months })
};

export const documentsApi = {
  beginUpload: (customerId: string, body: { documentType: string; fileName: string; mimeType: UploadMimeType; sizeBytes: number }) =>
    api.post<DocumentUploadTicket>(`/pipeline/customers/${customerId}/documents`, body),
  complete: (documentId: string) => api.post<CustomerDocument>(`/documents/${documentId}/complete`),
  abort: (documentId: string) => api.post<null>(`/documents/${documentId}/abort`),
  url: (documentId: string, action: 'view' | 'download') => api.get<DocumentUrl>(`/documents/${documentId}/url`, { action }),
  remove: (documentId: string) => api.delete<null>(`/documents/${documentId}`)
};

export const meApi = {
  get: () => api.get<Profile>('/me'),
  update: (body: { fullName?: string; phone?: string | null; position?: string | null; avatarUrl?: string | null }) =>
    api.patch<Profile>('/me', body)
};

export const customersApi = {
  list: (q: CustomerQuery = {}) => api.get<Paginated<Customer>>('/customers', { ...q }),
  summary: () => api.get<CustomerSummary>('/customers/summary'),
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  create: (body: CustomerCreateInput) => api.post<Customer>('/customers', body),
  update: (id: string, body: CustomerUpdateInput) => api.patch<Customer>(`/customers/${id}`, body),
  /** Super Admin / the department's Department Head. Refused while the customer has an issued invoice or a verified payment. */
  remove: (id: string) => api.delete<{ name: string }>(`/customers/${id}`),
  import: (customers: unknown[]) => api.post<ImportResult>('/customers/import', { customers }),
  activities: (id: string) => api.get<CustomerActivity[]>(`/customers/${id}/activities`),
  addActivity: (id: string, body: { type: string; note?: string }) => api.post<CustomerActivity>(`/customers/${id}/activities`, body)
};

export const usersApi = {
  list: (q: { page?: number; pageSize?: number; status?: string; role?: Role; departmentId?: string; teamId?: string; division?: TeamDivision; search?: string } = {}) =>
    api.get<Paginated<Profile>>('/users', { ...q }),
  get: (id: string) => api.get<Profile>(`/users/${id}`),
  create: (body: { email: string; fullName: string; password: string; role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string; position?: string | null; technicalConsultant?: boolean; details?: MemberDetailsInput }) =>
    api.post<Profile>('/users', body),
  assign: (id: string, body: { role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string }) => api.patch<Profile>(`/users/${id}`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: string) =>
    api.post<Profile>(`/users/${id}/status`, { status, reason }),
  setTechnicalConsultant: (id: string, value: boolean) => api.post<Profile>(`/users/${id}/technical-consultant`, { value }),
  setHeadDivision: (id: string, division: HeadDivision | null) => api.post<Profile>(`/users/${id}/head-division`, { division }),
  setSalesSubRole: (id: string, role: SalesSubRole | null) => api.post<Profile>(`/users/${id}/sales-sub-role`, { role }),
  remove: (id: string) => api.delete<null>(`/users/${id}`)
};

export const approvalsApi = {
  list: (q: { status?: string; page?: number; pageSize?: number } = {}) => api.get<Paginated<ApprovalRequest>>('/approval-requests', { ...q }),
  approve: (id: string, body: { teamId?: string; note?: string } = {}) => api.post<ApprovalRequest>(`/approval-requests/${id}/approve`, body),
  reject: (id: string, note?: string) => api.post<ApprovalRequest>(`/approval-requests/${id}/reject`, { note })
};

export const notificationsApi = {
  list: (q: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) => api.get<Paginated<Notification>>('/notifications', { ...q }),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.patch<Notification>(`/notifications/${id}/read`, {}),
  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),
  remove: (id: string) => api.delete<null>(`/notifications/${id}`),
  broadcast: (body: { title: string; body: string; priority?: NotificationPriority; departmentId?: string; division?: TeamDivision }) =>
    api.post<{ recipients: number }>('/announcements', body)
};

/** Attendance, employee details and the Department Head -> HR leave approval. */
export const trainingApi = {
  overview: () => api.get<TrainingOverview>('/hr/training/overview'),
  programs: () => api.get<TrainingProgram[]>('/hr/training/programs'),
  saveProgram: (body: { id?: string; name: string; description?: string | null; startDate: string; ownerId?: string | null }) => api.post<TrainingProgram>('/hr/training/programs', body),
  cancelProgram: (id: string, cancel: boolean) => api.post<TrainingProgram>(`/hr/training/programs/${id}/cancel`, { cancel }),
  employees: () => api.get<TrainingEmployee[]>('/hr/training/employees'),
  records: (q: { search?: string; status?: string; limit?: number; offset?: number }) => api.get<TrainingRecords>('/hr/training/records', q),
  program: (id: string) => api.get<TrainingProgramDetail>(`/hr/training/programs/${id}`),
  saveDay: (id: string, day: number, body: { title: string; topics: string[]; trainerName?: string | null; trainerId?: string | null; criteria: { name: string; max: number }[]; passPercent?: number | null }) =>
    api.post<TrainingProgram>(`/hr/training/programs/${id}/days/${day}`, body),
  enroll: (id: string, employeeKeys: string[]) => api.post<{ added: number; skipped: number; unknown: string[] }>(`/hr/training/programs/${id}/enrollments`, { employeeKeys }),
  enrollment: (id: string) => api.get<TrainingEnrollmentDetail>(`/hr/training/enrollments/${id}`),
  unenroll: (id: string) => api.delete<null>(`/hr/training/enrollments/${id}`),
  saveReport: (id: string, day: number, body: { attendance: TrainingAttendance | null; topicsCompleted: string[]; tasks: { title: string; done: boolean }[]; scores: { criterion: string; score: number }[]; feedback?: string | null; trainerRemarks?: string | null; report?: string | null }) =>
    api.post<{ dayNo: number; completed: boolean; status: string; assessmentResult: string | null }>(`/hr/training/enrollments/${id}/days/${day}`, body),
  review: (id: string, body: { strengths?: string | null; improvements?: string | null; trainerRemarks?: string | null }) => api.post<{ id: string; status: string }>(`/hr/training/enrollments/${id}/review`, body)
};

export interface TelecallerLeadBody {
  name: string;
  company: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  leadSource: string;
  notes?: string | null;
  services: string[];
  leadTemperature: string;
  callStatus: string;
  followUpDate?: string | null;
}
export const telecallerApi = {
  home: () => api.get<TelecallerHome>('/telecaller/home'),
  assignable: (departmentId?: string) => api.get<TelecallerAssignee[]>('/telecaller/assignable', { departmentId }),
  lists: (assigneeId?: string) => api.get<TelecallerSheet[]>('/telecaller/lists', { assigneeId }),
  checkSheet: (body: { assigneeId: string; fileName: string; note?: string | null; hash: string; rows: { row: number; name: string; company?: string; phone: string; email?: string; remarks?: string }[]; commit: boolean }) =>
    api.post<TelecallerSheetCheck>('/telecaller/lists', body),
  storeSource: (listId: string, data: string) => api.post<{ stored: true; size: number }>(`/telecaller/lists/${listId}/source`, { data }),
  contacts: (q: { listId?: string; search?: string; status?: string; page?: number; pageSize?: number }) => api.get<TelecallerContactList>('/telecaller/contacts', q),
  updateContact: (id: string, body: { callStatus: string; remarks?: string | null; followUpDate?: string | null; called?: boolean }) =>
    api.patch<Pick<TelecallerContact, 'id' | 'callStatus' | 'lastCalledAt' | 'followUpDate' | 'remarks' | 'callCount'>>(`/telecaller/contacts/${id}`, body),
  leads: (q: { search?: string; temperature?: string; callStatus?: string; source?: string; page?: number; pageSize?: number }) => api.get<TelecallerLeadList>('/telecaller/leads', q),
  lead: (id: string) => api.get<TelecallerLead>(`/telecaller/leads/${id}`),
  createLead: (body: TelecallerLeadBody) => api.post<TelecallerLead>('/telecaller/leads', body),
  updateLead: (id: string, body: Partial<TelecallerLeadBody> & { leadTemperature: string; callStatus: string }) => api.patch<TelecallerLead>(`/telecaller/leads/${id}`, body)
};

export interface BaQuotationBody {
  items?: { serviceCode: string; description?: string | null; quantity: number; unitPrice: number; discountPct?: number; gstRate?: number }[];
  gstApplicable?: boolean;
  validityDays?: number | null;
  paymentTerms?: string | null;
  timeline?: string | null;
  notes?: string | null;
  content?: Record<string, unknown>;
  reviewed?: boolean;
}
export interface BaDemoBody { title: string; description?: string | null; startsAt: string; endsAt: string; mode: 'ONLINE' | 'IN_PERSON'; location?: string | null; meetingLink?: string | null; internalNotes?: string | null }
export const businessAssociateApi = {
  home: () => api.get<BaHome>('/ba/home'),
  assignees: () => api.get<BaAssignee[]>('/telecaller/ba-assignees'),
  convertLead: (leadId: string, body: { assigneeId?: string | null; note?: string | null }) =>
    api.post<{ contactId: string; assignedTo: string; assigneeName: string }>(`/telecaller/leads/${leadId}/convert`, body),
  contacts: (q: { search?: string; stage?: string; page?: number; pageSize?: number }) => api.get<BaContactList>('/ba/contacts', q),
  contact: (id: string) => api.get<BaContactDetail>(`/ba/contacts/${id}`),
  updateContact: (id: string, body: { requirements?: string | null; profile?: Record<string, string>; nextFollowUp?: string | null; stage?: string }) => api.patch<BaContactDetail>(`/ba/contacts/${id}`, body),
  addNote: (id: string, note: string) => api.post<{ ok: true }>(`/ba/contacts/${id}/notes`, { note }),
  reassign: (id: string, assigneeId: string) => api.post<{ contactId: string }>(`/ba/contacts/${id}/reassign`, { assigneeId }),
  prices: () => api.get<ServicePrice[]>('/ba/prices'),
  savePrice: (code: string, body: { unitLabel: string; unitPrice: number; gstRate: number; maxDiscountPct: number; isActive: boolean }) => api.post<{ serviceCode: string }>(`/ba/prices/${code}`, body),
  quotations: (contactId?: string) => api.get<BaQuotationRow[]>('/ba/quotations', { contactId }),
  quotation: (id: string) => api.get<BaQuotation>(`/ba/quotations/${id}`),
  createQuotation: (contactId: string, body: BaQuotationBody) => api.post<BaQuotation>('/ba/quotations', { contactId, ...body }),
  saveQuotation: (id: string, body: BaQuotationBody) => api.patch<BaQuotation>(`/ba/quotations/${id}`, body),
  aiQuotation: (id: string, instructions?: string) => api.post<BaQuotation>(`/ba/quotations/${id}/ai`, { instructions: instructions || undefined }),
  reviewQuotation: (id: string) => api.post<BaQuotation>(`/ba/quotations/${id}/review`),
  reviseQuotation: (id: string) => api.post<BaQuotation>(`/ba/quotations/${id}/revise`),
  finalizeQuotation: (id: string) => api.post<BaQuotation>(`/ba/quotations/${id}/finalize`),
  quotationFile: (id: string, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/ba/quotations/${id}/file`, { action }),
  demos: (q: { from?: string; to?: string; status?: string; contactId?: string }) => api.get<BaDemo[]>('/ba/demos', q),
  createDemo: (contactId: string, body: BaDemoBody) => api.post<BaDemo>('/ba/demos', { contactId, ...body }),
  updateDemo: (id: string, body: Partial<BaDemoBody>) => api.patch<BaDemo>(`/ba/demos/${id}`, body),
  demoStatus: (id: string, status: 'COMPLETED' | 'CANCELLED', feedback?: string | null, followUpNotes?: string | null) => api.post<BaDemo>(`/ba/demos/${id}/status`, { status, feedback, followUpNotes }),
  scopes: (contactId: string) => api.get<BaScopeRow[]>(`/ba/contacts/${contactId}/scope`),
  scope: (id: string) => api.get<BaScope>(`/ba/scope/${id}`),
  createScope: (contactId: string, body: { title?: string; inputs?: Record<string, string>; content?: Record<string, unknown>; reviewed?: boolean }) => api.post<BaScope>('/ba/scope', { contactId, ...body }),
  saveScope: (id: string, body: { title?: string; inputs?: Record<string, string>; content?: Record<string, unknown>; reviewed?: boolean }) => api.patch<BaScope>(`/ba/scope/${id}`, body),
  aiScope: (id: string, body: { section?: string; instructions?: string }) => api.post<BaScope>(`/ba/scope/${id}/ai`, body),
  reviewScope: (id: string) => api.post<BaScope>(`/ba/scope/${id}/review`),
  finalizeScope: (id: string) => api.post<BaScope>(`/ba/scope/${id}/finalize`),
  scopeFile: (id: string, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/ba/scope/${id}/file`, { action }),
  leads: (q: { search?: string; temperature?: string; callStatus?: string; source?: string; page?: number; pageSize?: number }) => api.get<TelecallerLeadList>('/ba/leads', q),
  lead: (id: string) => api.get<TelecallerLead>(`/ba/leads/${id}`),
  createLead: (body: TelecallerLeadBody) => api.post<TelecallerLead>('/ba/leads', body),
  updateLead: (id: string, body: Partial<TelecallerLeadBody> & { leadTemperature: string; callStatus: string }) => api.patch<TelecallerLead>(`/ba/leads/${id}`, body)
};

export const recruitmentApi = {
  overview: () => api.get<RecruitmentOverview>('/hr/recruitment/overview'),
  agenda: () => api.get<RecruitmentAgenda>('/hr/recruitment/agenda'),
  positions: () => api.get<RecruitmentPosition[]>('/hr/recruitment/positions'),
  savePosition: (body: { id?: string; title: string; departmentId?: string | null; isOpen: boolean }) => api.post<{ id: string; title: string; isOpen: boolean }>('/hr/recruitment/positions', body),
  recruiters: () => api.get<HrRecruiter[]>('/hr/recruitment/recruiters'),
  list: (q: { search?: string; positionId?: string; confirmation?: string; pending?: string; call?: string; ownerKey?: string; limit?: number; offset?: number }) => api.get<RecruitmentList>('/hr/recruitment/candidates', q),
  get: (id: string) => api.get<RecruitmentDetail>(`/hr/recruitment/candidates/${id}`),
  create: (body: RecruitmentCandidateInput) => api.post<RecruitmentCandidate>('/hr/recruitment/candidates', body),
  update: (id: string, body: RecruitmentCandidateInput) => api.patch<RecruitmentCandidate>(`/hr/recruitment/candidates/${id}`, body),
  addAction: (id: string, body: { kind: RecruitmentActionKind; title: string; dueDate?: string | null; assigneeKey?: string | null }) => api.post<{ id: string }>(`/hr/recruitment/candidates/${id}/actions`, body),
  closeAction: (id: string, body: { done: boolean; note?: string | null }) => api.post<{ id: string; status: string }>(`/hr/recruitment/actions/${id}/close`, body),
  scheduleCall: (id: string, at: string) => api.post<{ id: string }>(`/hr/recruitment/candidates/${id}/calls`, { at }),
  recordCall: (id: string, body: { callId?: string | null; outcome: RecruitmentCallOutcome; note?: string | null; followUpDate?: string | null }) => api.post<{ id: string }>(`/hr/recruitment/candidates/${id}/calls/record`, body),
  setConfirmation: (id: string, body: { status: RecruitmentConfirmation; date?: string | null; note?: string | null }) => api.post<RecruitmentCandidate>(`/hr/recruitment/candidates/${id}/confirmation`, body)
};
export interface RecruitmentCandidateInput {
  name: string;
  email: string;
  phone?: string | null;
  positionId?: string | null;
  positionTitle?: string | null;
  ownerKey?: string | null;
  source?: string | null;
  notes?: string | null;
}

export const performanceApi = {
  people: (q: { kind: PerformancePeriodKind; start: string; end: string; departmentId?: string }) => api.get<PerformancePeople>('/performance/people', q),
  report: (k: PerformanceReportKey) => api.get<PerformanceReport | null>('/performance/report', k),
  generate: (k: PerformanceReportKey) => api.post<{ state: string; report: PerformanceReport }>('/performance/report', k),
  history: (id: string) => api.get<PerformanceHistoryEntry[]>(`/performance/report/${id}/history`)
};

export interface PerformanceReportKey {
  scope: PerformanceScope;
  subjectId?: string;
  teamId?: string;
  departmentId?: string;
  kind: PerformancePeriodKind;
  start: string;
  end: string;
  [k: string]: string | undefined;
}

export const hrApi = {
  recordRmLogin: () => api.post<null>('/attendance/rm-login'),
  attendance: (date?: string) => api.get<AttendanceDay>('/hr/attendance', { date }),
  manualPunch: (body: { profileId: string; kind: 'RM' | 'BIOMETRIC'; at: string }) => api.post<null>('/hr/attendance/punch', body),
  personalDetails: () => api.get<PersonalDetails[]>('/hr/personal-details'),
  myLeave: () => api.get<LeaveRequest[]>('/leave/mine'),
  leaveToReview: () => api.get<LeaveReview>('/leave/review'),
  submitLeave: (body: { leaveType: 'FULL_DAY' | 'HALF_DAY'; startDate: string; endDate?: string; halfDayShift?: 'MORNING' | 'AFTERNOON'; reason: string }) =>
    api.post<LeaveRequest>('/leave', body),
  decideAsDepartmentHead: (id: string, approve: boolean, note?: string) => api.post<LeaveRequest>(`/leave/${id}/department-head-decision`, { approve, note: note || undefined }),
  decideAsHr: (id: string, approve: boolean, note?: string) => api.post<LeaveRequest>(`/leave/${id}/hr-decision`, { approve, note: note || undefined }),
  monthlySummary: (month: string) => api.get<LeaveMonthlySummary>('/leave/monthly-summary', { month }),

  // E-mail automation (birthdays, work anniversaries, probation reminders, employment confirmation) - HR staff only
  emailOverview: () => api.get<HrEmailOverview>('/hr/email-automation/overview'),
  emailHistory: (q: { status?: HrEmailStatus; kind?: HrEmailKind; limit?: number; offset?: number } = {}) => api.get<HrEmailHistory>('/hr/email-automation/history', { ...q }),
  emailCards: () => api.get<HrEmailCards>('/hr/email-automation/cards'),
  probation: () => api.get<HrProbationCycle[]>('/hr/email-automation/probation'),
  confirmProbation: (id: string, body: { effectiveDate?: string; note?: string } = {}) => api.post<HrProbationCycle>(`/hr/email-automation/probation/${id}/confirm`, body),
  dismissProbation: (id: string, note: string) => api.post<HrProbationCycle>(`/hr/email-automation/probation/${id}/dismiss`, { note }),
  retryEmail: (id: string) => api.post<{ id: string; status: string }>(`/hr/email-automation/events/${id}/retry`, {}),
  emailDataIssues: () => api.get<HrEmailDataIssue[]>('/hr/email-automation/data-issues'),
  setEmployeeDates: (body: { employeeKey: string; dateOfBirth?: string; joiningDate?: string }) => api.post<{ employeeKey: string }>('/hr/email-automation/employee-dates', body),
  runEmailAutomation: () => api.post<HrEmailRunSummary>('/hr/email-automation/run', {})
};

export const organizationApi = {
  departments: () => api.get<Department[]>('/departments'),
  createDepartment: (body: { name: string; description?: string; category?: string }) => api.post<Department>('/departments', body),
  updateDepartment: (id: string, body: Partial<Pick<Department, 'name' | 'description' | 'isLocked'>>) => api.patch<Department>(`/departments/${id}`, body),
  deleteDepartment: (id: string) => api.delete<null>(`/departments/${id}`),
  teams: (departmentId?: string) => api.get<Team[]>('/teams', { departmentId }),
  createTeam: (body: { departmentId: string; name: string; division?: TeamDivision }) => api.post<Team>('/teams', body)
};

export const auditApi = {
  list: (q: { page?: number; pageSize?: number; action?: string; entityType?: string; entityId?: string } = {}) =>
    api.get<Paginated<AuditLog>>('/audit-logs', { ...q }),
  /** Security & Audit Logs viewer: search, filters, pages. Read-only; the database scopes it by role. */
  search: (q: { page?: number; pageSize?: number; q?: string; action?: string; outcome?: AuditOutcome; entityType?: string; from?: string; to?: string } = {}) =>
    api.get<Paginated<AuditEvent>>('/audit-logs/search', { ...q }),
  actions: () => api.get<string[]>('/audit-logs/actions')
};

/** Dashboards: the figures come from the database; screens only show them. */
export const dashboardApi = {
  /** Super Admin only. */
  company: () => api.get<CompanyOverview>('/dashboard/company-overview'),
  /** Super Admin only: every department, team, person and the hand-offs between them. */
  workflow: () => api.get<CompanyWorkflow>('/dashboard/company-workflow'),
  /** Team Lead (the team), Department Head (the department), Super Admin (all, or the department named). */
  scope: (departmentId?: string) => api.get<ScopeOverview>('/dashboard/scope-overview', { departmentId }),
  /** Records that a list was exported from the browser (who, what, how many rows). Call it when the file is made. */
  recordExport: (dataset: string, rows: number, note?: string) => api.post<null>('/security/data-exports', { dataset, rows, note })
};

/** Public sign-up options (departments + teams) via the anon-callable RPC. */
export async function fetchRegistrationOptions(): Promise<RegistrationDepartment[]> {
  const { data, error } = await requireSupabase().rpc('list_registration_options');
  if (error) {
    console.error('[registration] list_registration_options failed', error);
    throw new Error(describeRegistrationError(error));
  }
  return (data || []) as RegistrationDepartment[];
}

/** Turn the PostgREST error into an actionable message for setup problems. */
function describeRegistrationError(error: { code?: string; message?: string }): string {
  const msg = error.message || '';
  if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)) {
    return 'Could not load departments: the database is not set up yet. Apply the migrations in supabase/migrations (see docs/SETUP_SUPABASE.md).';
  }
  if (/invalid api key|jwt|apikey/i.test(msg) || error.code === 'PGRST301') {
    return 'Could not load departments: the Supabase API key is invalid. Check VITE_SUPABASE_ANON_KEY and restart the app.';
  }
  if (error.code === '42501') {
    return 'Could not load departments: permission denied. Re-run the migrations so anonymous users can read sign-up options.';
  }
  if (/fetch|network/i.test(msg)) {
    return 'Could not load departments: cannot reach Supabase. Check VITE_SUPABASE_URL and your connection.';
  }
  return `Could not load departments (${error.code || 'error'}): ${msg || 'please try again.'}`;
}

/** The staff side of the client dashboard: service requests (Technical Consultant), plans (Accounts), replies (Support). */
export const clientWorkApi = {
  openServiceRequests: () => api.get<ConsultantOpenServiceRequest[]>('/pipeline/service-requests'),
  serviceRequests: (customerId: string) => api.get<ConsultantServiceRequest[]>(`/pipeline/customers/${customerId}/service-requests`),
  decideServiceRequest: (id: string, body: { decision: 'IN_REVIEW' | 'REJECTED'; note?: string | null }) =>
    api.post<null>(`/pipeline/service-requests/${id}/decision`, body),
  plans: () => api.get<AccountsPlans>('/accounts/plans'),
  createPlan: (body: PlanInput & { code: string }) => api.post<{ id: string }>('/accounts/plans', body),
  updatePlan: (id: string, body: PlanInput) => api.patch<{ id: string }>(`/accounts/plans/${id}`, body),
  decidePlanRequest: (id: string, body: { decision: 'APPROVE' | 'REJECT' | 'ACTIVATE'; note?: string | null; paymentConfirmed?: boolean; renewsOn?: string | null }) =>
    api.post<null>(`/accounts/plan-requests/${id}/decision`, body),
  replyToClient: (ticketId: string, message: string) => api.post<null>(`/support/tickets/${ticketId}/client-reply`, { message })
};
/** Files on tickets for staff: the server checks the person may see the ticket (or the customer, for a new ticket). */
export const ticketFilesApi = {
  forTicket: (ticketId: string) => api.get<TicketAttachment[]>(`/support/tickets/${ticketId}/attachments`),
  begin: (body: { ticketId?: string; customerId?: string; fileName: string; mimeType: string; sizeBytes: number }) => api.post<TicketUploadTicket>('/support/ticket-uploads', body),
  complete: (id: string) => api.post<TicketAttachment>(`/support/ticket-uploads/${id}/complete`, {}),
  abort: (id: string) => api.post<null>(`/support/ticket-uploads/${id}/abort`, {}),
  url: (id: string, action: 'view' | 'download' = 'view') => api.get<ClientDocumentUrl>(`/support/ticket-attachments/${id}/url`, { action })
};
export interface PlanInput { name: string; description?: string | null; monthlyPrice: number; features: string[]; services: string[]; isActive: boolean }
export type { MonthlyPlan };

export const departmentIncomeApi = {
  report: (q: { departmentId?: string; from?: string; to?: string } = {}) => api.get<DepartmentIncomeReport>('/reports/department-income', { ...q }),
  reconciliation: () => api.get<AttributionReconciliation>('/reports/department-income/reconciliation'),
  setOrderAttribution: (body: { orderKey: string; division: 'SALES' | 'SUPPORT'; departmentId?: string | null; reason: string }) =>
    api.post<unknown>('/reports/department-income/orders/attribution', body),
  setCustomerAcquisition: (customerId: string, body: { division: 'SALES' | 'SUPPORT'; reason: string }) =>
    api.post<unknown>(`/reports/department-income/customers/${customerId}/acquisition`, body),
  settings: () => api.get<{ clientPurchaseAttribution: ClientPurchaseRule; updatedAt: string }>('/reports/department-income/settings'),
  setSettings: (clientPurchaseAttribution: ClientPurchaseRule) => api.patch<unknown>('/reports/department-income/settings', { clientPurchaseAttribution })
};

export const businessReportApi = {
  report: (q: BusinessReportQuery = {}) => api.get<BusinessReport>('/accounts/business-report', { ...q }),
  transactions: (q: Partial<BusinessTransactionsQuery> = {}) => api.get<BusinessTransactionsPage>('/accounts/business-report/transactions', { ...q }),
  orders: (q: Partial<BusinessOrdersQuery> = {}) => api.get<BusinessOrdersPage>('/accounts/business-report/orders', { ...q }),
  people: () => api.get<BusinessPerson[]>('/accounts/business-report/people'),
  invoiceBusiness: (invoiceId: string) => api.get<InvoiceBusinessInfo>(`/accounts/invoices/${invoiceId}/business`),
  tagInvoice: (invoiceId: string, body: InvoiceBusinessTagInput) => api.post<null>(`/accounts/invoices/${invoiceId}/business`, body)
};

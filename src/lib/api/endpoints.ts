/**
 * Typed API endpoints, grouped by resource. Components and hooks call these;
 * they never call fetch() or Supabase tables directly.
 */
import type { NotificationHealthDetail, NotificationHealthReport, NotificationTestResult } from '../../../shared/contracts';
import type { PaidLeaveBalance, PaidLeaveDetail, PaidLeaveList, PaidLeavePolicy } from '../../../shared/contracts';
import type { OnboardingReviewScope } from '../../../shared/contracts';
import type { FieldVisitLeadQueue, FieldVisitLeadRoute, FieldVisitTelecaller, TrackedPosition, TrackingBoard, TrackingTrail, VisitTrackingIssue, VisitTrackingState } from '../../../shared/contracts';
import type { CrocodialAdminOverview, CrocodialConnection, CrocodialMapping, CrocodialMappingCheck, CrocodialMyStatus, CrocodialSyncRunResult, CrocodialSyncStatus, CrocodialTestResult, CrocodialActivity, CrocodialLeads, CrocodialRefreshCapabilities, CrocodialRefreshRequest, CrocodialRefreshScope, CrocodialHealthReport, CrocodialTeamActivity } from '../../../shared/contracts';
import type { LeadUploadBatch, LeadUploadCheckResult, LeadUploadChunkResult, LeadUploadIssues, LeadUploadRawRow } from '../../../shared/contracts';
import type {
  AiWebsiteOnboarding,
  WelcomeEmailItem, WelcomeEmailList,
  ReminderCallList,
  OperationsHeadReviewItem, OperationsOverviewRow,
  CustomerWorkflow, CustomerWorkflowStatuses, TcWorkflowStatus, MetaWorkflowStatus,
  PerformersDepartment, PerformersCompany, PerformerRecognition, PerformerEvaluationRun,
  DepartmentEmployeeDirectory, EmployeeRequest, OperationsActivityEntry, OperationsDashboard, OperationsDepartmentDetail, OperationsFunction, OperationsHeadAdmin, OperationsHeadsAdmin, OperationsScopeItem, TeamAssignmentRecord,
  ClientAccessMethod, PanelDetails, TcFollowUp, VerificationNote, VerificationRouteReviewItem, WorkflowSettings,
  BaAssignee, BaContactDetail, BaContactList, BaDemo, BaHome, BaQuotation, BaQuotationRow, BaScope, BaScopeRow, ServicePrice,
  SalesSubRole,
  HeadDivision,
  MyDepartmentScopes,
  DepartmentAccessInfo, DepartmentHeadAccess, VerifierDepartments, OffboardingImpact, OffboardingResult, ReassignmentItem,
  SalesIncome, SalesLeadAssignee, SalesRole, SalesRoleList, SalesRolePersonDashboard, SalesTeamPerson, SalesLeadDetail, SalesLeadList, SalesOverview, SalesReport, SalesSheet, SalesSheetCheck, SalesSheetIssues, SalesTaskAssignee, SalesTaskList,
  TelecallerAssignee,
  TelecallerContact,
  TelecallerContactList,
  TelecallerHome,
  TelecallerLead,
  TelecallerLeadList,
  LeadScope,
  FieldVisitAssignedList,
  FieldVisitFilter,
  FieldVisitLeadList,
  FieldVisitOverview,
  LeadVisit,
  LeadVisitList,
  SalesVisitAssignee,
  VisitPriority,
  LeadScopeCounts,
  LeadScopeList,
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
  OverviewDepartments,
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
  CustomerJourneyStatus,
  ExistingBlueTick,
  MetaOutcomeResult,
  SubscriptionList,
  SubscriptionOverview,
  ClientLoginOutcome,
  ProvisioningFilter,
  ProvisioningQueue,
  DeliveryQueueItem,
  ServiceJourneySetting,
  AttendanceDay,
  HrProbationCycle,
  HrDocPrefill,
  HrDocPreview,
  HrDocRequest,
  HrDocType, HrExperienceContent, HrLetterTemplateState, HrLetterTemplateVersion, HrLetterType, HrOfferContent,
  HrDocument,
  HrDocumentDownload,
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
  InvoiceWhatsAppDispatch,
  InvoiceWhatsAppResult,
  InvoiceWhatsAppSettings,
  LeadWhatsAppMessage,
  LeadWhatsAppSettings,
  LeadWhatsAppVariable,
  PaymentInvoiceBilling,
  PaymentInvoiceOutcome,
  AccountsPaymentCounts,
  ChecklistItem,
  ConsultantNote,
  ExpensesPage,
  CustomerRevenuePage, DepartmentFinance, FinanceMailList,
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
  HrEmployeeFile,
  HrEmployeeFileKind,
  HrEmployeeFileUploadTicket,
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
  OnboardingHandoffInfo,
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
import type { BusinessOrdersQuery, BusinessReportQuery, BusinessTransactionsQuery, InvoiceBusinessTagInput, MemberDetailsInput, PricedLineInput, ExpenseInput, CustomerCreateInput, CustomerUpdateInput, LeadCreateInput, LeadCreateRequestInput, LeadUpdateInput, UploadMimeType, AiWebsiteOnboardingBody } from '../../../shared/validation';
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
  /** The money received, in whole rupees, GST included. */
  amount: number;
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
  /** Both workflow statuses of one customer (Technical Consultant and Meta Verifier), the history, and who may change which. */
  workflow: (id: string) => api.get<CustomerWorkflow>(`/pipeline/customers/${id}/workflow`),
  reviewScope: (id: string) => api.get<OnboardingReviewScope>(`/pipeline/customers/${id}/review-scope`),
  workflowStatuses: (ids: string[]) => (ids.length ? api.get<CustomerWorkflowStatuses>('/pipeline/workflow-statuses', { ids: ids.join(',') }) : Promise.resolve({} as CustomerWorkflowStatuses)),
  setTcStatus: (id: string, body: { status: TcWorkflowStatus; note?: string }) => api.post<CustomerWorkflow>(`/pipeline/customers/${id}/workflow/technical-consultant`, body),
  setMetaStatus: (id: string, body: { status: MetaWorkflowStatus; note?: string }) => api.post<CustomerWorkflow>(`/pipeline/customers/${id}/workflow/meta-verifier`, body),
  services: () => api.get<ServiceCatalogItem[]>('/pipeline/services'),
  counts: () => api.get<PipelineCounts>('/pipeline/counts'),
  divisionSupportOverview: (departmentId: string, division: TeamDivision) =>
    api.get<DivisionSupportOverview>('/pipeline/division-support-overview', { departmentId, division }),
  divisionOverview: (departmentId: string, division: TeamDivision) =>
    api.get<DivisionLeadsOverview>('/pipeline/division-overview', { departmentId, division }),
  list: (q: PipelineQuery) => api.get<Paginated<PipelineCustomer>>('/pipeline/customers', { ...q }),
  get: (id: string) => api.get<PipelineCustomerDetail>(`/pipeline/customers/${id}`),
  createLead: (body: LeadCreateRequestInput) => api.post<PipelineCustomer>('/pipeline/leads', body),
  updateLead: (id: string, body: LeadUpdateInput) => api.patch<PipelineCustomer>(`/pipeline/leads/${id}`, body),
  /** Add or update the AI Website client onboarding details of a lead (one record per lead). */
  saveAiWebsiteOnboarding: (id: string, body: AiWebsiteOnboardingBody) => api.post<AiWebsiteOnboarding>(`/pipeline/customers/${id}/ai-website-onboarding`, body),
  moveToPotential: (id: string, body: { dealAmount: number; paymentDueDate: string }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/move-to-potential`, body),
  recordPayment: (id: string, body: { amount: number; method?: PaymentMethod }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/payments`, body),
  /** Where the customer is on its journey, and what the signed-in person may do next. */
  customerJourney: (id: string) => api.get<CustomerJourneyInfo>(`/pipeline/customers/${id}/journey`),
  /** Meta verification, the Meta Verifier, the Relationship Manager and each service's setup, as the team sees them. */
  journeyStatus: (id: string) => api.get<CustomerJourneyStatus>(`/pipeline/customers/${id}/journey-status`),
  setMetaVerification: (id: string, body: { status: 'IN_PROGRESS' | 'DOCUMENTS_REQUIRED' | 'REJECTED' | 'COMPLETED'; feedback?: string | null }) =>
    api.post<CustomerJourneyStatus>(`/pipeline/customers/${id}/meta-verification`, body),
  /** The authoritative Meta decision (idempotent by event key; Approved needs the Meta reference). */
  recordMetaOutcome: (id: string, body: { outcome: 'APPROVED' | 'REJECTED' | 'NEEDS_INFO'; eventKey: string; reference?: string | null; note?: string | null }) =>
    api.post<MetaOutcomeResult>(`/pipeline/customers/${id}/meta-outcome`, body),
  /** A customer who already holds a Blue Tick and bought WhatsApp API only. */
  existingBlueTick: (id: string) => api.get<ExistingBlueTick>(`/pipeline/customers/${id}/existing-blue-tick`),
  setExistingBlueTick: (id: string, body: { status: 'NOT_PROVIDED' | 'CUSTOMER_REPORTED' | 'CONFIRMED' | 'COULD_NOT_CONFIRM'; reference?: string | null; note?: string | null }) =>
    api.post<ExistingBlueTick>(`/pipeline/customers/${id}/existing-blue-tick`, body),
  /** Subscriptions: the terms Sales sets (never a date), the activation the team confirms (the expiry is calculated), corrections and renewals. */
  subscriptionsList: (q: { search?: string; status?: string; page?: number; pageSize?: number } = {}) => api.get<SubscriptionList>('/pipeline/subscriptions', { ...q }),
  subscriptions: (id: string) => api.get<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions`),
  setSubscriptionTerms: (id: string, service: string, body: Record<string, unknown>) =>
    api.post<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions/${service}/terms`, body),
  confirmSubscriptionActivation: (id: string, service: string, body: { activationDate: string; panelCreatedOn?: string | null; note?: string | null }) =>
    api.post<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions/${service}/activation`, body),
  correctSubscriptionDates: (id: string, service: string, body: { activationDate: string; panelCreatedOn?: string | null; reason: string }) =>
    api.post<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions/${service}/dates`, body),
  confirmSubscriptionRenewal: (id: string, service: string, body: { paymentId: string; startDate?: string | null; terms?: Record<string, unknown> | null; note?: string | null }) =>
    api.post<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions/${service}/renewal`, body),
  resendActivationEmail: (id: string, service: string) =>
    api.post<SubscriptionOverview>(`/pipeline/customers/${id}/subscriptions/${service}/activation-email/resend`, {}),
  assignMetaVerifier: (id: string, verifierId?: string | null) => api.post<CustomerJourneyStatus>(`/pipeline/customers/${id}/meta-verifier`, { verifierId: verifierId ?? null }),
  metaVerifierCandidates: (id: string) => api.get<{ id: string; fullName: string }[]>(`/pipeline/customers/${id}/meta-verifier/candidates`),
  setServiceSetup: (id: string, service: string, body: { status: 'IN_PROGRESS' | 'READY'; note?: string | null }) =>
    api.post<CustomerJourneyStatus>(`/pipeline/customers/${id}/services/${service}/setup`, body),
  /** Accounts: create the dashboard login (any service). The e-mail is the one on the customer record; no password is typed or sent. */
  accountsCreateClientLogin: (id: string, method: ClientAccessMethod = 'LINK') => api.post<{ email: string; status: 'CREATED'; method: ClientAccessMethod }>(`/pipeline/customers/${id}/accounts/client-login`, { method }),
  /** Accounts: the Client logins queue (customer, ID, order, e-mail, status, time, result). */
  clientLogins: (q: { status?: ProvisioningFilter; search?: string; page?: number; pageSize?: number } = {}) =>
    api.get<ProvisioningQueue>('/pipeline/accounts/client-logins', { ...q }),
  /** Accounts: correct the e-mail on the record before a login is made (reason required, audited). */
  correctCustomerEmail: (id: string, body: { email: string; reason: string }) => api.post<null>(`/pipeline/customers/${id}/accounts/customer-email`, body),
  /** Accounts: send the set-password e-mail again. */
  resendAccountEmail: (id: string) => api.post<null>(`/pipeline/customers/${id}/accounts/account-email/resend`, {}),
  /** Department Head / Super Admin / the verifier: Meta has completed the verification. */
  markMetaVerificationCompleted: (id: string) => api.post<null>(`/pipeline/customers/${id}/meta-verification-completed`, {}),
  /** Sales / Support: send the verified services to the department that delivers them. */
  sendToDelivery: (id: string, note?: string | null) =>
    api.post<{ sent: number; remaining: number; departments: string | null }>(`/pipeline/customers/${id}/send-to-delivery`, { note: note || null }),
  deliveryQueue: (q: { search?: string; page?: number; pageSize?: number } = {}) => api.get<Paginated<DeliveryQueueItem>>('/pipeline/delivery-queue', { ...q }),
  serviceJourneys: () => api.get<ServiceJourneySetting[]>('/pipeline/service-journeys'),
  /** Super Admin only. */
  setServiceJourney: (code: string, body: { requiresTechnicalConsultant: boolean; deliveryDepartmentId?: string | null }) =>
    api.patch<ServiceJourneySetting[]>(`/pipeline/service-journeys/${code}`, body),
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
  handoffInfo: (id: string) => api.get<OnboardingHandoffInfo>(`/pipeline/customers/${id}/handoff`),
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
  recordAccountsPayment: (id: string, body: AccountsPaymentInput & { verify: boolean; invoice?: boolean }) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments`, body),
  setOrderGst: (id: string, rate: number) => api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/order-gst`, { rate }),
  updateAccountsPayment: (id: string, paymentId: string, body: AccountsPaymentInput) =>
    api.patch<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}`, body),
  verifyAccountsPayment: (id: string, paymentId: string, invoice = true) => api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/verify`, { invoice }),
  rejectAccountsPayment: (id: string, paymentId: string, reason: string) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/reject`, { reason }),
  reverseAccountsPayment: (id: string, paymentId: string, reason: string) =>
    api.post<PaymentOverview>(`/pipeline/customers/${id}/accounts/payments/${paymentId}/reverse`, { reason }),
  /** Confirms the payment; the answer says what happened to the client's dashboard login (made and e-mailed automatically). */
  confirmPaymentAndReturn: (id: string, note?: string | null) => api.post<{ clientLogin: ClientLoginOutcome }>(`/pipeline/customers/${id}/accounts/payment-confirmed`, { note: note || null }),
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
  /** The paid invoice of one verified payment (also the retry when the automatic one could not be made). Idempotent. */
  invoiceForPayment: (paymentId: string, body: { customer?: Record<string, string | undefined> } = {}) => api.post<PaymentInvoiceOutcome>(`/accounts/payments/${paymentId}/invoice`, body),
  /** Which billing details the payment's invoice has and which the customer record lacks (address, state). */
  paymentInvoiceBilling: (paymentId: string) => api.get<PaymentInvoiceBilling>(`/accounts/payments/${paymentId}/invoice-billing`),
  /** An Accounts team lead / head cancels a wrongly made invoice (reason required). */
  cancel: (id: string, reason: string) => api.post<Invoice & { replayed: boolean }>(`/accounts/generated-invoices/${id}/cancel`, { reason }),
  /** Retry what is left of a stage (a missing PDF or e-mail). */
  deliver: (id: string, stage: InvoiceStage) => api.post<InvoiceRunResult>(`/accounts/generated-invoices/${id}/deliver`, { stage }),
  /** A short-lived link to a stored PDF (anyone who may read the invoice). */
  fileUrl: (id: string, stage: InvoiceStage, action: 'view' | 'download') => api.get<ClientDocumentUrl>(`/invoices/${id}/pdf`, { stage, action }),
  /** Send the paid invoice by WhatsApp (one dispatch per invoice and number; `resend` sends a failed one again). */
  sendWhatsApp: (id: string, resend = false) => api.post<InvoiceWhatsAppResult>(`/accounts/generated-invoices/${id}/whatsapp`, { resend }),
  whatsAppHistory: (id: string) => api.get<InvoiceWhatsAppDispatch[]>(`/accounts/generated-invoices/${id}/whatsapp`),
  whatsAppSettings: () => api.get<InvoiceWhatsAppSettings>('/accounts/invoice-whatsapp/settings'),
  setWhatsAppSettings: (body: { enabled: boolean; autoSend: boolean; templateName: string | null; templateLanguage: string; templateApproved: boolean }) =>
    api.post<InvoiceWhatsAppSettings>('/accounts/invoice-whatsapp/settings', body)
};

export const financeApi = {
  summary: (q: { departmentId?: string; from?: string; to?: string } = {}) => api.get<FinanceSummary>('/accounts/finance/summary', { ...q }),
  /** Earnings and expenses of each revenue department (Accounts, Education & Training and HR are left out). */
  departments: () => api.get<DepartmentFinance[]>('/accounts/finance/departments'),
  income: (q: { search?: string; departmentId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    api.get<IncomePage>('/accounts/finance/income', { ...q }),
  financeMail: (q: { status?: string; limit?: number } = {}) => api.get<FinanceMailList>('/accounts/finance-mail', { ...q }),
  retryFinanceMail: (id: string) => api.post<{ queued: number }>(`/accounts/finance-mail/${id}/retry`, {}),
  customerRevenue: (q: { search?: string; from?: string; to?: string; serviceCode?: string; departmentId?: string; sort?: string; dir?: string; page?: number; pageSize?: number } = {}) =>
    api.get<CustomerRevenuePage>('/accounts/finance/customer-revenue', { ...q }),
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
  /** The departments and functions a Department Head may switch between (nothing for anyone else). */
  departmentScopes: () => api.get<MyDepartmentScopes>('/me/department-scopes'),
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
  create: (body: { email: string; fullName: string; role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string; position?: string | null; technicalConsultant?: boolean; details?: MemberDetailsInput }) =>
    api.post<Profile>('/users', body),
  assign: (id: string, body: { role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string }) => api.patch<Profile>(`/users/${id}`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: string) =>
    api.post<Profile>(`/users/${id}/status`, { status, reason }),
  setTechnicalConsultant: (id: string, value: boolean) => api.post<Profile>(`/users/${id}/technical-consultant`, { value }),
  setMetaVerifier: (id: string, value: boolean) => api.post<Profile>(`/users/${id}/meta-verifier`, { value }),
  /** Super Admin: make a Department Head an Operations Head (several departments), or take it back. */
  setOperationsHead: (id: string, value: boolean, note?: string | null) => api.post<Profile>(`/users/${id}/operations-head`, { value, note: note || null }),
  operationsHeadReview: () => api.get<OperationsHeadReviewItem[]>('/users/operations-head-review'),
  operationsOverview: () => api.get<OperationsOverviewRow[]>('/operations/overview'),
  setHeadDivision: (id: string, division: HeadDivision | null) => api.post<Profile>(`/users/${id}/head-division`, { division }),
  /** Department Heads who work in a department (own or authorised), with all their departments. */
  departmentHeads: (departmentId: string) => api.get<DepartmentHeadAccess[]>('/users/department-heads', { departmentId }),
  departmentAccess: (id: string) => api.get<DepartmentAccessInfo>(`/users/${id}/department-access`),
  /** The departments a Meta Verifier verifies for (home + extras), and saving the extras. */
  verifierDepartments: (id: string) => api.get<VerifierDepartments>(`/users/${id}/verifier-departments`),
  /** Offboarding: what is attached to a person, the one-step offboarding, and the Reassignment Required queue. */
  offboardingImpact: (id: string) => api.get<OffboardingImpact>(`/users/${id}/offboarding-impact`),
  offboard: (id: string, body: { replacementId?: string | null; status: 'SUSPENDED' | 'REVOKED'; reason?: string | null }) => api.post<OffboardingResult>(`/users/${id}/offboard`, body),
  reassignmentQueue: () => api.get<ReassignmentItem[]>('/reassignment-queue'),
  reassignmentResolve: (item: string, toId: string | null) => api.post<{ resolved: string; to: string | null }>(`/reassignment-queue/${item}/resolve`, { toId }),
  setVerifierDepartments: (id: string, departmentIds: string[]) => api.post<VerifierDepartments>(`/users/${id}/verifier-departments`, { departmentIds }),
  /** Save the whole matrix of extra (department, function) pairs of a Department Head in one step (Super Admin). */
  applyDepartmentAccess: (id: string, pairs: { departmentId: string; division: HeadDivision }[]) => api.post<DepartmentAccessInfo>(`/users/${id}/department-access/apply`, { pairs }),
  setDepartmentAccess: (id: string, body: { departmentId: string; division: HeadDivision; granted: boolean }) => api.post<DepartmentAccessInfo>(`/users/${id}/department-access`, body),
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
    api.post<{ recipients: number }>('/announcements', body),
  // Notification Health (20270126000200): Super Admin and HR staff
  health: (q: { departmentId?: string; role?: string; issue?: string } = {}) => api.get<NotificationHealthReport>('/notifications/health', { ...q }),
  healthEmployee: (profileId: string) => api.get<NotificationHealthDetail>(`/notifications/health/${profileId}`),
  healthTest: (profileId: string) => api.post<NotificationTestResult>(`/notifications/health/${profileId}/test`, {})
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
export interface SalesSheetRowBody { row: number; name: string; company?: string; phone: string; email?: string; remarks?: string }
export const salesHeadApi = {
  overview: () => api.get<SalesOverview>('/sales-head/overview'),
  assignees: () => api.get<SalesLeadAssignee[]>('/sales-head/lead-assignees'),
  teamPeople: () => api.get<SalesTeamPerson[]>('/sales-head/team-people'),
  sheets: () => api.get<SalesSheet[]>('/sales-head/sheets'),
  checkSheet: (body: { assigneeId: string; fileName: string; note?: string | null; hash: string; rows: SalesSheetRowBody[]; commit: boolean }) => api.post<SalesSheetCheck>('/sales-head/sheets', body),
  storeSource: (sheetId: string, data: string) => api.post<{ stored: true; size: number }>(`/sales-head/sheets/${sheetId}/source`, { data }),
  sheetIssues: (sheetId: string) => api.get<SalesSheetIssues>(`/sales-head/sheets/${sheetId}/issues`),
  leads: (q: { search?: string; filter?: string; assigneeId?: string; sort?: string; dir?: string; page?: number; pageSize?: number }) => api.get<SalesLeadList>('/sales-head/leads', q),
  lead: (id: string) => api.get<SalesLeadDetail>(`/sales-head/leads/${encodeURIComponent(id)}`),
  assignInbound: (id: string, assigneeId: string) => api.post<{ customerId: string; assignee: string }>(`/sales-head/leads/${encodeURIComponent(id)}/assign`, { assigneeId }),
  tasks: (q: { filter?: string; search?: string; assigneeId?: string; page?: number; pageSize?: number }) => api.get<SalesTaskList>('/sales-head/tasks', q),
  taskAssignees: () => api.get<SalesTaskAssignee[]>('/sales-head/task-assignees'),
  createTask: (body: { assigneeId: string; title: string; description?: string | null; priority: 'LOW' | 'MEDIUM' | 'HIGH'; dueDate?: string | null }) => api.post<{ id: string }>('/sales-head/tasks', body),
  reports: (q: { who?: string; from?: string; to?: string; taskStatus?: string }) => api.get<SalesReport>('/sales-head/reports', q),
  income: (q: { from?: string; to?: string }) => api.get<SalesIncome>('/sales-head/income', q),
  // role-wise sections (migration 20270117000300): /roles/telecaller, /roles/business-associate
  roleList: (role: SalesRole, q: { from?: string; to?: string; search?: string; teamLeadId?: string; status?: string; sort?: string; page?: number; pageSize?: number }) =>
    api.get<SalesRoleList>(`/sales-head/roles/${role.toLowerCase().replace(/_/g, '-')}/people`, q),
  rolePerson: (role: SalesRole, id: string, q: { from?: string; to?: string }) =>
    api.get<SalesRolePersonDashboard>(`/sales-head/roles/${role.toLowerCase().replace(/_/g, '-')}/people/${encodeURIComponent(id)}`, q)
};
/** Field Visit: the Sales employee's leads and visits, and the Department Head's assignments. */
export const fieldVisitApi = {
  overview: () => api.get<FieldVisitOverview>('/field-visits/overview'),
  leads: (q: { filter: FieldVisitFilter; search?: string; sort?: string; page?: number; pageSize?: number }) => api.get<FieldVisitLeadList>('/field-visits/leads', q),
  assigned: (q: { search?: string; page?: number; pageSize?: number } = {}) => api.get<FieldVisitAssignedList>('/field-visits/assigned', q),
  list: (q: { scope?: 'OPEN' | 'HISTORY' | 'ALL'; status?: string; leadId?: string; search?: string; page?: number; pageSize?: number } = {}) => api.get<LeadVisitList>('/field-visits', q),
  schedule: (body: { leadId: string; visitDate: string; plannedTime?: string | null; address?: string | null; purpose: string; notes?: string | null; clientRequestId?: string }) =>
    api.post<LeadVisit>('/field-visits', body),
  update: (id: string, body: { visitDate: string; plannedTime?: string | null; address?: string | null; purpose: string; notes?: string | null }) => api.patch<LeadVisit>(`/field-visits/${id}`, body),
  start: (id: string, body: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null; locationNote?: string | null }) => api.post<LeadVisit>(`/field-visits/${id}/start`, body),
  complete: (id: string, body: { status: 'COMPLETED' | 'FOLLOW_UP_REQUIRED'; outcome: string; notes?: string | null; requirements?: string | null; nextSteps?: string | null; followUpDate?: string | null }) =>
    api.post<LeadVisit>(`/field-visits/${id}/complete`, body),
  cancel: (id: string, reason?: string | null) => api.post<LeadVisit>(`/field-visits/${id}/cancel`, { reason: reason || null }),
  assignees: () => api.get<SalesVisitAssignee[]>('/field-visits/assignees'),
  assign: (body: { leadId: string; assigneeId: string; priority: VisitPriority; instructions?: string | null }) => api.post<{ id: string; leadId: string; assignee: string; reassigned: boolean }>('/field-visits/assignments', body),
  cancelAssignment: (leadId: string) => api.delete<{ id: string; leadId: string }>(`/field-visits/assignments/${leadId}`),
  // live location while a visit is in progress (the employee), and the board / trail (Team Lead, Department Head, Operations Head, HR)
  trackingStart: (id: string, p: TrackedPosition) => api.post<VisitTrackingState>(`/field-visits/${id}/tracking/start`, p),
  trackingPoints: (id: string, points: TrackedPosition[]) => api.post<VisitTrackingState>(`/field-visits/${id}/tracking/points`, { points }),
  trackingIssue: (id: string, issue: VisitTrackingIssue) => api.post<VisitTrackingState>(`/field-visits/${id}/tracking/issue`, { issue }),
  trackingStop: (id: string) => api.post<VisitTrackingState>(`/field-visits/${id}/tracking/stop`, {}),
  trackingBoard: (date?: string) => api.get<TrackingBoard>('/field-visits/tracking/board', date ? { date } : {}),
  trackingTrail: (id: string) => api.get<TrackingTrail>(`/field-visits/${id}/tracking`),
  // Field Visit leads waiting for the Sales Department Head
  leadQueue: (q: { status?: 'PENDING' | 'ASSIGNED' | 'ALL'; search?: string; page?: number; pageSize?: number } = {}) => api.get<FieldVisitLeadQueue>('/field-visits/lead-queue', q),
  leadTelecallers: (leadId: string) => api.get<FieldVisitTelecaller[]>(`/field-visits/lead-queue/${leadId}/telecallers`),
  leadAssign: (leadId: string, body: { telecallerId: string; note?: string | null }) => api.post<FieldVisitLeadRoute>(`/field-visits/lead-queue/${leadId}/assign`, body)
};

/** The five filters of the Lead section: All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts. */
export const leadScopeApi = {
  list: (q: { scope: LeadScope; search?: string; source?: string; status?: string; temperature?: string; callStatus?: string; service?: string; followUpFrom?: string; followUpTo?: string; noFollowUp?: boolean; sort?: 'newest' | 'followUp'; page?: number; pageSize?: number }) => api.get<LeadScopeList>('/lead-scope', q),
  counts: () => api.get<LeadScopeCounts>('/lead-scope/counts')
};

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

/** Top performers: a department's monthly rankings, the company view (Operations Head / Super Admin) and the Department Head's recognition decisions. */
export const performersApi = {
  department: (q: { month?: string; departmentId?: string }) => api.get<PerformersDepartment>('/top-performers/department', q),
  company: (q: { month?: string }) => api.get<PerformersCompany>('/top-performers/company', q),
  evaluate: (q: { month?: string; departmentId?: string }) => api.post<PerformerEvaluationRun>('/top-performers/evaluate', q),
  decide: (id: string, body: { decision: 'APPROVE' | 'REJECT'; note?: string }) => api.post<PerformerRecognition>(`/top-performers/recognitions/${id}/decision`, body)
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
  // paid leave (balance from the database's ledger; a paid request reserves the days until the final approval deducts them)
  myPaidLeave: () => api.get<PaidLeaveBalance>('/leave/paid-balance'),
  submitPaidLeave: (body: { leaveType: 'FULL_DAY' | 'HALF_DAY'; startDate: string; endDate?: string; halfDayShift?: 'MORNING' | 'AFTERNOON'; reason: string }) =>
    api.post<LeaveRequest>('/leave/paid', body),
  paidLeaveList: (search?: string) => api.get<PaidLeaveList>('/hr/paid-leave', search ? { search } : {}),
  paidLeaveDetail: (profileId: string) => api.get<PaidLeaveDetail>(`/hr/paid-leave/${profileId}`),
  paidLeaveAdjust: (profileId: string, body: { kind: 'OPENING_BALANCE' | 'CORRECTION'; days: number; note: string }) => api.post<PaidLeaveDetail>(`/hr/paid-leave/${profileId}/adjust`, body),
  paidLeavePolicy: (body: { enabled: boolean; monthlyDays: number; creditDay: number; partialMonthRule: 'NEXT_FULL_MONTH' | 'EFFECTIVE_MONTH'; startMonth?: string | null }) =>
    api.post<PaidLeavePolicy>('/hr/paid-leave/policy', body),
  confirmationDate: (cycleId: string, body: { effectiveDate: string; note: string }) => api.post<{ cycleId: string; effectiveDate: string; before: string | null }>(`/hr/probation/${cycleId}/effective-date`, body),
  leaveToReview: () => api.get<LeaveReview>('/leave/review'),
  submitLeave: (body: { leaveType: 'FULL_DAY' | 'HALF_DAY'; startDate: string; endDate?: string; halfDayShift?: 'MORNING' | 'AFTERNOON'; reason: string }) =>
    api.post<LeaveRequest>('/leave', body),
  decideAsDepartmentHead: (id: string, approve: boolean, note?: string) => api.post<LeaveRequest>(`/leave/${id}/department-head-decision`, { approve, note: note || undefined }),
  decideAsHr: (id: string, approve: boolean, note?: string) => api.post<LeaveRequest>(`/leave/${id}/hr-decision`, { approve, note: note || undefined }),
  /** One step of the multi-level chain: the server checks the caller decides the waiting step. */
  decideLeave: (id: string, decision: 'APPROVE' | 'REJECT' | 'REVISE', note?: string) => api.post<LeaveRequest>(`/leave/${id}/decision`, { decision, note: note || undefined }),
  resubmitLeave: (id: string, reason: string) => api.post<LeaveRequest>(`/leave/${id}/resubmit`, { reason }),
  monthlySummary: (month: string) => api.get<LeaveMonthlySummary>('/leave/monthly-summary', { month }),

  // Probation confirmation approvals (HR staff only). The HR e-mails themselves are sent by the server's daily scheduler.
  probation: () => api.get<HrProbationCycle[]>('/hr/email-automation/probation'),
  confirmProbation: (id: string, body: { effectiveDate?: string; note?: string } = {}) => api.post<HrProbationCycle>(`/hr/email-automation/probation/${id}/confirm`, body),
  dismissProbation: (id: string, note: string) => api.post<HrProbationCycle>(`/hr/email-automation/probation/${id}/dismiss`, { note })
};

/** NDA and Experience Letter: made by the server on the official templates, kept per employee (HR staff only). */
export const hrDocumentsApi = {
  prefill: (employeeKey: string, type: HrDocType) => api.get<HrDocPrefill>('/hr/documents/prefill', { employeeKey, type }),
  preview: (body: HrDocRequest) => api.post<HrDocPreview>('/hr/documents/preview', body),
  generate: (body: HrDocRequest) => api.post<HrDocument>('/hr/documents', body),
  list: (q: { employeeKey?: string; type?: HrDocType } = {}) => api.get<HrDocument[]>('/hr/documents', { ...q }),
  download: (id: string) => api.get<HrDocumentDownload>(`/hr/documents/${id}/download`),
  // the master templates of the Offer / Experience Letter (migration 20261231000700)
  templateState: (type: HrLetterType) => api.get<HrLetterTemplateState>(`/hr/letter-templates/${type}`),
  templateVersion: (type: HrLetterType, version: number) => api.get<HrLetterTemplateVersion>(`/hr/letter-templates/${type}/versions/${version}`),
  saveTemplate: (type: HrLetterType, body: { content: HrOfferContent | HrExperienceContent; baseVersion: number; note?: string }) =>
    api.post<HrLetterTemplateVersion>(`/hr/letter-templates/${type}`, body)
};

/** Tells the server a sign-in was refused, so it can note the attempt with the address and place the hosting platform reports. Never throws. */
export const signInReportApi = {
  failed: (identifier: string): void => {
    try {
      void fetch('/api/v1/auth/login-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: identifier.trim().slice(0, 254) }), keepalive: true }).catch(() => undefined);
    } catch {
      /* best effort: the sign-in screen is not affected */
    }
  }
};

export const organizationApi = {
  departments: () => api.get<Department[]>('/departments'),
  createDepartment: (body: { name: string; description?: string; category?: string }) => api.post<Department>('/departments', body),
  updateDepartment: (id: string, body: Partial<Pick<Department, 'name' | 'description'>>) => api.patch<Department>(`/departments/${id}`, body),
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
  /** Super Admin only: who is absent in each department, and each department's business in a period (default: this month). */
  companyDepartments: (q: { from?: string; to?: string; attendanceDate?: string } = {}) =>
    api.get<OverviewDepartments>('/dashboard/company-departments', q),
  /** Super Admin only: every department, team, person and the hand-offs between them. */
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
/** Documents on an employee's HR profile, stored in R2 (HR staff upload / delete; the employee may read their own). */
export const hrEmployeeFilesApi = {
  list: (employeeKey: string) => api.get<HrEmployeeFile[]>('/hr/employee-files', { employeeKey }),
  begin: (body: { employeeKey: string; kind: HrEmployeeFileKind; fileName: string; mimeType: string; sizeBytes: number; leaveRef?: string | null; note?: string | null }) =>
    api.post<HrEmployeeFileUploadTicket>('/hr/employee-file-uploads', body),
  complete: (id: string) => api.post<HrEmployeeFile>(`/hr/employee-file-uploads/${id}/complete`, {}),
  abort: (id: string) => api.post<null>(`/hr/employee-file-uploads/${id}/abort`, {}),
  url: (id: string, action: 'view' | 'download' = 'view') => api.get<ClientDocumentUrl>(`/hr/employee-files/${id}/url`, { action }),
  remove: (id: string) => api.delete<null>(`/hr/employee-files/${id}`)
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

/** The Meta Verifier workflow: verification notes, re-routing, the consultant's follow-ups and the follow-up delay. */
export const workflowApi = {
  verificationNotes: (customerId: string) => api.get<VerificationNote[]>(`/pipeline/customers/${customerId}/verification/notes`),
  panelDetails: (customerId: string) => api.get<PanelDetails>(`/pipeline/customers/${customerId}/verification/panel-details`),
  setPanelDetails: (customerId: string, serviceCode: string, body: { platform: string | null; account: string | null }) =>
    api.patch<PanelDetails>(`/pipeline/customers/${customerId}/verification/panel-details/${serviceCode}`, body),
  /** The Client Panel URL of one service (null clears it). Sends nothing; the link goes out only with sendPanelLink. */
  setPanelUrl: (customerId: string, serviceCode: string, url: string | null) =>
    api.patch<PanelDetails>(`/pipeline/customers/${customerId}/verification/panel-details/${serviceCode}/url`, { url }),
  sendPanelLink: (customerId: string, serviceCode: string, body: { requestId: string; resend?: boolean }) =>
    api.post<PanelDetails & { link: { queued: boolean; replayed: boolean; reason?: string } }>(`/pipeline/customers/${customerId}/verification/panel-details/${serviceCode}/link`, body),
  /** The password the Meta Verifier set on the customer's WhatsApp panel, e-mailed to the customer once. `requestId` makes a retry a no-op. */
  sendPanelCredentials: (customerId: string, serviceCode: string, body: { password: string; requestId: string }) =>
    api.post<PanelDetails>(`/pipeline/customers/${customerId}/verification/panel-details/${serviceCode}/credentials`, body),
  addVerificationNote: (customerId: string, body: { body: string; outcome: string }) => api.post<VerificationNote[]>(`/pipeline/customers/${customerId}/verification/notes`, body),
  reroute: (customerId: string, route: 'META' | 'TECHNICAL', reason: string) => api.post<null>(`/pipeline/customers/${customerId}/verification/reroute`, { route, reason }),
  routeReview: () => api.get<VerificationRouteReviewItem[]>('/pipeline/verification-route-review'),
  setServiceMetaVerification: (code: string, value: boolean) => api.patch<ServiceJourneySetting[]>(`/pipeline/service-journeys/${code}/meta-verification`, { value }),
  followUps: (scope: 'OPEN' | 'DONE' | 'ALL' = 'OPEN') => api.get<TcFollowUp[]>('/consultant/followups', { scope }),
  recordContact: (id: string, body: { channel: string; outcome: string; note?: string | null; nextFollowUpAt?: string | null }) =>
    api.post<{ id: string; status: string }>(`/consultant/followups/${id}/contact`, { ...body, note: body.note || null, nextFollowUpAt: body.nextFollowUpAt || null }),
  assignFollowUp: (id: string, profileId: string) => api.post<null>(`/consultant/followups/${id}/assign`, { profileId }),
  settings: () => api.get<WorkflowSettings>('/workflow/settings'),
  setFollowUpDelay: (days: number | null) => api.post<WorkflowSettings>('/workflow/tc-followup-delay', { days })
};

/** Employee approval: HR submits, the right approver decides, the Operations Head's departments, and the Department Head's team assignment. */
/** Welcome e-mail of new employees: status for HR / Super Admin / the employee's Department Head, and the secure resend (a fresh link is made when it is sent). */
export const welcomeEmailsApi = {
  list: (q: { status?: string; employee?: string } = {}) => api.get<WelcomeEmailList>('/welcome-emails', { ...q }),
  resend: (employeeId: string) => api.post<WelcomeEmailItem>(`/welcome-emails/${employeeId}/resend`, {})
};

/** BolifyAI panel recharge reminder calls (7, 5 and 1 day before expiry): read only, for the Super Admin and HR staff. */
export const reminderCallsApi = {
  list: (q: { filter?: string; page?: number; pageSize?: number } = {}) => api.get<ReminderCallList>('/reminder-calls', { ...q })
};

export const employeesApi = {
  submit: (body: unknown) => api.post<EmployeeRequest>('/employee-requests', body),
  list: (q: { status?: string; toDecide?: boolean } = {}) => api.get<EmployeeRequest[]>('/employee-requests', { status: q.status, toDecide: q.toDecide === undefined ? undefined : String(q.toDecide) }),
  get: (id: string) => api.get<EmployeeRequest>(`/employee-requests/${id}`),
  decide: (id: string, body: { approve: boolean; note?: string; departmentIds?: string[]; primaryDepartmentIds?: string[] }) => api.post<EmployeeRequest>(`/employee-requests/${id}/decide`, body),
  resubmit: (id: string, body: { role: string; departmentId: string; division?: string; position?: string; employeeCode?: string }) => api.post<EmployeeRequest>(`/employee-requests/${id}/resubmit`, body),
  operationsHeads: () => api.get<OperationsHeadsAdmin>('/operations/heads'),
  setScope: (id: string, body: { departmentIds: string[]; primaryDepartmentIds?: string[] }) => api.post<OperationsHeadAdmin>(`/operations/heads/${id}/scope`, body),
  applyScope: (id: string, body: { function: OperationsFunction; departments: OperationsScopeItem[] }) => api.post<OperationsHeadAdmin>(`/operations/heads/${id}/function-scope`, body),
  functionScopeReview: () => api.get<Record<string, unknown>>('/operations/function-scope-review'),
  headActivity: (id: string) => api.get<OperationsActivityEntry[]>(`/operations/heads/${id}/activity`),
  dashboard: () => api.get<OperationsDashboard>('/operations/dashboard'),
  departmentActivity: (id: string) => api.get<OperationsActivityEntry[]>(`/operations/departments/${id}/activity`),
  departmentDetail: (id: string) => api.get<OperationsDepartmentDetail>(`/operations/departments/${id}`),
  directory: (departmentId?: string) => api.get<DepartmentEmployeeDirectory>('/department/employees', { departmentId }),
  assignToLead: (memberId: string, body: { leadId: string; note?: string }) => api.post<null>(`/department/employees/${memberId}/assign-lead`, body),
  assignments: (memberId: string) => api.get<TeamAssignmentRecord[]>(`/department/employees/${memberId}/assignments`)
};

// Upload Leads (docs/LEAD_UPLOAD.md): preview, then start / send the rows in chunks / finish
export const leadUploadApi = {
  check: (rows: LeadUploadRawRow[]) => api.post<LeadUploadCheckResult>('/lead-uploads/check', { rows }),
  start: (body: { clientRequestId: string; fileName: string; fileType: 'XLSX' | 'CSV'; fileHash: string; totalRows: number }) =>
    api.post<LeadUploadBatch>('/lead-uploads', body),
  rows: (batchId: string, rows: LeadUploadRawRow[]) => api.post<LeadUploadChunkResult>(`/lead-uploads/${batchId}/rows`, { rows }),
  finish: (batchId: string) => api.post<LeadUploadBatch>(`/lead-uploads/${batchId}/finish`, {}),
  history: () => api.get<LeadUploadBatch[]>('/lead-uploads'),
  issues: (batchId: string) => api.get<LeadUploadIssues>(`/lead-uploads/${batchId}/issues`)
};

/** The lead welcome WhatsApp ("our services", once when a lead first reaches a sales person). */
/** Crocodial integration: the Super Admin's configuration and an employee's own switch (the database decides who may do what). */
export const crocodialApi = {
  overview: () => api.get<CrocodialAdminOverview>('/crocodial/admin'),
  setRollout: (body: { departmentId: string; division: 'SALES'; allowed: boolean; note?: string | null }) => api.post<CrocodialAdminOverview>('/crocodial/rollout', body),
  saveConnection: (body: { id?: string; name: string; externalAccountLabel?: string | null; credentialRef: string; enabled?: boolean }) =>
    api.post<CrocodialConnection>('/crocodial/connections', body),
  testConnection: (id: string) => api.post<CrocodialTestResult>(`/crocodial/connections/${id}/test`, {}),
  saveDepartmentLink: (body: { connectionId: string; departmentId: string; division: 'SALES'; enabled: boolean; stage?: 'PILOT' | 'PRODUCTION' }) =>
    api.post<{ id: string }>('/crocodial/department-links', body),
  checkMapping: (body: { connectionId: string; externalEmployeeId: number; profileId: string; departmentId: string }) =>
    api.post<CrocodialMappingCheck>('/crocodial/mappings/check', body),
  createMapping: (body: { connectionId: string; externalEmployeeId: number; profileId: string; departmentId: string }) =>
    api.post<CrocodialMapping>('/crocodial/mappings', body),
  approveMapping: (id: string) => api.post<CrocodialMapping>(`/crocodial/mappings/${id}/approve`, {}),
  countMappingFrom: (id: string, from: string | null) => api.post<CrocodialMapping>(`/crocodial/mappings/${id}/count-from`, { from }),
  revokeMapping: (id: string, reason?: string) => api.post<CrocodialMapping>(`/crocodial/mappings/${id}/revoke`, { reason: reason || null }),
  me: () => api.get<CrocodialMyStatus>('/crocodial/me'),
  syncStatus: () => api.get<CrocodialSyncStatus[]>('/crocodial/sync'),
  syncNow: (id: string) => api.post<CrocodialSyncRunResult>(`/crocodial/connections/${id}/sync`, {}),
  activity: (q: { profileId?: string; from?: string; to?: string } = {}) => api.get<CrocodialActivity>('/crocodial/activity', { ...q }),
  leads: (q: { profileId?: string; search?: string; filter?: 'ALL' | 'NEVER_CALLED' | 'FOLLOW_UP_DUE'; page?: number; pageSize?: number } = {}) =>
    api.get<CrocodialLeads>('/crocodial/leads', { ...q }),
  refreshCapabilities: () => api.get<CrocodialRefreshCapabilities>('/crocodial/refresh-capabilities'),
  refresh: (scope: CrocodialRefreshScope, departmentId?: string) =>
    api.post<CrocodialRefreshRequest>('/crocodial/refresh', departmentId ? { scope, departmentId } : { scope }),
  refreshStatus: (id: string) => api.get<CrocodialRefreshRequest>(`/crocodial/refresh/${id}`),
  connectionHealth: () => api.get<CrocodialHealthReport>('/crocodial/connection-health'),
  teamActivity: (q: { from?: string; to?: string; departmentId?: string; teamId?: string } = {}) => api.get<CrocodialTeamActivity>('/crocodial/team-activity', { ...q })
};

export const leadWhatsAppApi = {
  settings: () => api.get<LeadWhatsAppSettings>('/sales/lead-whatsapp/settings'),
  saveSettings: (body: { enabled: boolean; templateName: string | null; templateLanguage: string; templateApproved: boolean; variables: LeadWhatsAppVariable[] }) =>
    api.post<LeadWhatsAppSettings>('/sales/lead-whatsapp/settings', body),
  history: (customerId: string) => api.get<LeadWhatsAppMessage[]>(`/leads/${customerId}/whatsapp`),
  resend: (customerId: string) => api.post<LeadWhatsAppMessage>(`/leads/${customerId}/whatsapp/retry`, {})
};

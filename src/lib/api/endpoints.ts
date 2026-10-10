/**
 * Typed API endpoints, grouped by resource. Components and hooks call these;
 * they never call fetch() or Supabase tables directly.
 */
import type {
  AccountsConfirmation,
  AccountsPaymentCounts,
  ChecklistItem,
  ConsultantNote,
  ExpensesPage,
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
import type { ExpenseInput, CustomerCreateInput, CustomerUpdateInput, LeadCreateInput, LeadUpdateInput, UploadMimeType } from '../../../shared/validation';
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
}

export interface PipelineQuery {
  stage: PipelineStage;
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
  list: (q: PipelineQuery) => api.get<Paginated<PipelineCustomer>>('/pipeline/customers', { ...q }),
  get: (id: string) => api.get<PipelineCustomerDetail>(`/pipeline/customers/${id}`),
  createLead: (body: LeadCreateInput) => api.post<PipelineCustomer>('/pipeline/leads', body),
  updateLead: (id: string, body: LeadUpdateInput) => api.patch<PipelineCustomer>(`/pipeline/leads/${id}`, body),
  moveToPotential: (id: string, body: { dealAmount: number; paymentDueDate: string }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/move-to-potential`, body),
  recordPayment: (id: string, body: { amount: number; method?: PaymentMethod }) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/payments`, body),
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
  consultantSetAddons: (id: string, addons: { code?: string; name?: string }[]) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/addons`, { addons }),
  consultantUpdateCustomer: (id: string, body: { name: string; company?: string | null; phone?: string | null; email?: string | null; expectedUpdatedAt?: string | null }) =>
    api.patch<PipelineCustomer>(`/pipeline/customers/${id}/consultant/details`, body),
  consultantSetAddonsRequired: (id: string, required: boolean) =>
    api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/addons-required`, { required }),
  consultantSendToAddons: (id: string) => api.post<PipelineCustomer>(`/pipeline/customers/${id}/consultant/send-to-addons`),
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
  verifyAll: (id: string) => api.post<{ verified: number }>(`/pipeline/customers/${id}/checklist/verify-all`),
  automations: (id: string) => api.get<AutomationStatus[]>(`/pipeline/customers/${id}/automations`),
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

export const financeApi = {
  /** Departments that earn revenue (the Accounts Dashboard lists only these for income). */
  departments: () => api.get<{ id: string; name: string; slug: string }[]>('/accounts/finance/departments'),
  summary: (q: { departmentId?: string; from?: string; to?: string } = {}) => api.get<FinanceSummary>('/accounts/finance/summary', { ...q }),
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
  remove: (id: string) => api.delete<null>(`/customers/${id}`),
  import: (customers: unknown[]) => api.post<ImportResult>('/customers/import', { customers }),
  activities: (id: string) => api.get<CustomerActivity[]>(`/customers/${id}/activities`),
  addActivity: (id: string, body: { type: string; note?: string }) => api.post<CustomerActivity>(`/customers/${id}/activities`, body)
};

export const usersApi = {
  list: (q: { page?: number; pageSize?: number; status?: string; role?: Role; departmentId?: string; teamId?: string; search?: string } = {}) =>
    api.get<Paginated<Profile>>('/users', { ...q }),
  get: (id: string) => api.get<Profile>(`/users/${id}`),
  create: (body: { email: string; fullName: string; password: string; role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string; position?: string | null }) =>
    api.post<Profile>('/users', body),
  assign: (id: string, body: { role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string }) => api.patch<Profile>(`/users/${id}`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: string) =>
    api.post<Profile>(`/users/${id}/status`, { status, reason }),
  setTechnicalConsultant: (id: string, value: boolean) => api.post<Profile>(`/users/${id}/technical-consultant`, { value }),
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
    api.get<Paginated<AuditLog>>('/audit-logs', { ...q })
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

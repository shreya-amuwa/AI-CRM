/**
 * Typed API endpoints, grouped by resource. Components and hooks call these;
 * they never call fetch() or Supabase tables directly.
 */
import type {
  ApprovalRequest,
  AuditLog,
  Customer,
  CustomerActivity,
  CustomerSegment,
  CustomerStatus,
  CustomerSummary,
  Department,
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
import type { CustomerCreateInput, CustomerUpdateInput } from '../../../shared/validation';
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
}

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
  create: (body: { email: string; fullName: string; password: string; role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string; position?: string }) =>
    api.post<Profile>('/users', body),
  assign: (id: string, body: { role: Exclude<Role, 'SUPER_ADMIN'>; departmentId?: string; teamId?: string }) => api.patch<Profile>(`/users/${id}`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: string) =>
    api.post<Profile>(`/users/${id}/status`, { status, reason }),
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

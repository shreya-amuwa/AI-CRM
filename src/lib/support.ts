import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';

/**
 * Data access for the Support Team Member dashboard (migration
 * 20261009000100_support_member_dashboard.sql): customers, tickets and the
 * invoices linked to customers. Reads go straight to Supabase and are limited
 * by row-level security; every write is a database function that re-checks the
 * hierarchy (member → team lead → department head).
 */

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  return supabase;
}

/** Turns "VALIDATION_ERROR: Choose ..." into "Choose ...". */
export function cleanDbError(message: string): string {
  return message.replace(/^[A-Z_]+:\s*/, '');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(cleanDbError(error.message));
  return data as T;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export type CustomerSegmentValue = 'RETAIL' | 'WHOLESALE' | 'CORPORATE' | 'OTHER';
export type CustomerStatusValue = 'ACTIVE' | 'INACTIVE' | 'PROSPECT';

export interface SupportCustomer {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  segment: CustomerSegmentValue;
  status: CustomerStatusValue;
  ownerId: string;
  ownerName: string | null;
  teamId: string;
  /** Primary (first) service, kept for older screens. */
  serviceCode: string | null;
  serviceDetails: WhatsAppDetails;
  /** Every service the customer bought, each with its own details. */
  services: CustomerServiceEntry[];
  channel: string | null;
  service: string | null;
  requirement: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
}

export const SEGMENT_LABELS: Record<CustomerSegmentValue, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  CORPORATE: 'Corporate',
  OTHER: 'Other'
};
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatusValue, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PROSPECT: 'Prospect'
};
export const CHANNELS = ['Phone', 'WhatsApp', 'Email', 'Walk-in', 'Website', 'Other'] as const;

/** Extra details kept for a WhatsApp API customer (empty for other services). */
export interface WhatsAppDetails {
  campaignsSent?: number;
  campaignNotes?: string;
  packageMessages?: number;
  messagesSent?: number;
}
export const isWhatsAppService = (code: string | null | undefined) => !!code && code.startsWith('WHATSAPP_API');
export const messagesRemaining = (d: WhatsAppDetails) => Math.max(0, (d.packageMessages || 0) - (d.messagesSent || 0));

/** One service of a customer with its own form data (WhatsApp API: campaigns and message package). */
export interface CustomerServiceEntry {
  serviceCode: string;
  serviceDetails: WhatsAppDetails;
}

export interface ServiceOption {
  code: string;
  name: string;
  category: string;
}

/** Services catalog (crm_services), for the service / product dropdown. */
export function useServices() {
  const [services, setServices] = useState<ServiceOption[]>([]);
  useEffect(() => {
    db()
      .from('crm_services')
      .select('code, name, category')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setServices((data || []).map((r: any) => ({ code: r.code, name: r.name, category: r.category }))));
  }, []);
  return services;
}

const CUSTOMER_COLUMNS =
  'id, customer_code, name, company, email, phone, segment, status, owner_id, team_id, channel, service_code, service_interest, service_details, requirement, notes, created_at, updated_at';

export const toCustomer = (r: any, owners: Map<string, string>, last: Map<string, string>): SupportCustomer => ({
  id: r.id,
  code: r.customer_code,
  name: r.name,
  company: r.company,
  email: r.email,
  phone: r.phone,
  segment: r.segment,
  status: r.status,
  ownerId: r.owner_id,
  ownerName: owners.get(r.owner_id) ?? null,
  teamId: r.team_id,
  serviceCode: r.service_code ?? null,
  serviceDetails: r.service_details || {},
  services: [],
  channel: r.channel,
  service: r.service_interest,
  requirement: r.requirement,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastInteractionAt: last.get(r.id) ?? null
});

async function ownerNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const { data } = await db().from('profiles').select('id, full_name').in('id', unique);
  (data || []).forEach((p: any) => map.set(p.id, p.full_name));
  return map;
}

async function lastInteractions(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await db()
    .from('customer_activities')
    .select('customer_id, occurred_at')
    .in('customer_id', ids)
    .order('occurred_at', { ascending: false })
    .limit(500);
  (data || []).forEach((a: any) => {
    if (!map.has(a.customer_id)) map.set(a.customer_id, a.occurred_at);
  });
  return map;
}

export interface CustomerFilters {
  search: string;
  status: CustomerStatusValue | 'ALL';
  scope: 'all' | 'mine';
  page: number;
  pageSize: number;
}

/** A page of customers the signed-in user may see (RLS decides), newest activity first. */
export function useSupportCustomers(filters: CustomerFilters, ownerId: string | undefined) {
  const [items, setItems] = useState<SupportCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(filters.search);
  useEffect(() => {
    const t = setTimeout(() => setSearch(filters.search.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const { status, scope, page, pageSize } = filters;
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = db()
        .from('customers')
        .select(CUSTOMER_COLUMNS, { count: 'exact' })
        .eq('lifecycle_stage', 'CUSTOMER')
        .order('updated_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (status !== 'ALL') q = q.eq('status', status);
      if (scope === 'mine' && ownerId) q = q.eq('owner_id', ownerId);
      if (search) {
        const term = search.toLowerCase().replace(/[%,()]/g, ' ').trim();
        if (term) q = q.or(`search_text.ilike.%${term}%,customer_code.ilike.%${term}%`);
      }
      const { data, error: err, count } = await q;
      if (err) throw new Error(cleanDbError(err.message));
      const rows = data || [];
      const [owners, last] = await Promise.all([ownerNames(rows.map((r: any) => r.owner_id)), lastInteractions(rows.map((r: any) => r.id))]);
      setItems(rows.map((r: any) => toCustomer(r, owners, last)));
      setTotal(count ?? rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, [status, scope, page, pageSize, search, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime('customers', () => void load());
  return { items, total, loading, error, reload: load };
}

export interface CustomerStats {
  total: number;
  assigned: number;
  active: number;
  newThisMonth: number;
}

/** Headline counts for the dashboard cards (counted by the database, not by paging). */
export function useCustomerStats(ownerId: string | undefined) {
  const [stats, setStats] = useState<CustomerStats>({ total: 0, assigned: 0, active: 0, newThisMonth: 0 });
  const [recent, setRecent] = useState<SupportCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const base = () => db().from('customers').select('id', { count: 'exact', head: true }).eq('lifecycle_stage', 'CUSTOMER');
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const [all, mine, active, fresh, latest] = await Promise.all([
        base(),
        ownerId ? base().eq('owner_id', ownerId) : Promise.resolve({ count: 0 } as any),
        base().eq('status', 'ACTIVE'),
        base().gte('created_at', since.toISOString()),
        db().from('customers').select(CUSTOMER_COLUMNS).eq('lifecycle_stage', 'CUSTOMER').order('updated_at', { ascending: false }).limit(5)
      ]);
      setStats({ total: all.count ?? 0, assigned: mine.count ?? 0, active: active.count ?? 0, newThisMonth: fresh.count ?? 0 });
      const rows = latest.data || [];
      const owners = await ownerNames(rows.map((r: any) => r.owner_id));
      setRecent(rows.map((r: any) => toCustomer(r, owners, new Map())));
    } finally {
      setLoading(false);
    }
  }, [ownerId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime('customers', () => void load());
  return { stats, recent, loading, reload: load };
}

/** All customers the user may see, for pickers (newest first, capped). */
export function useCustomerOptions() {
  const [options, setOptions] = useState<{ id: string; code: string; name: string; company: string | null }[]>([]);
  useEffect(() => {
    db()
      .from('customers')
      .select('id, customer_code, name, company')
      .eq('lifecycle_stage', 'CUSTOMER')
      .order('name')
      .limit(1000)
      .then(({ data }) => setOptions((data || []).map((r: any) => ({ id: r.id, code: r.customer_code, name: r.name, company: r.company }))));
  }, []);
  return options;
}

export interface CustomerActivityRow {
  id: string;
  type: string;
  note: string | null;
  actorName: string | null;
  occurredAt: string;
}

export async function loadCustomerActivities(customerId: string): Promise<CustomerActivityRow[]> {
  const { data, error } = await db()
    .from('customer_activities')
    .select('id, type, note, actor_id, occurred_at')
    .eq('customer_id', customerId)
    .order('occurred_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(cleanDbError(error.message));
  const names = await ownerNames((data || []).map((a: any) => a.actor_id).filter(Boolean));
  return (data || []).map((a: any) => ({ id: a.id, type: a.type, note: a.note, actorName: names.get(a.actor_id) ?? null, occurredAt: a.occurred_at }));
}

export interface CustomerInput {
  name: string;
  company: string;
  phone: string;
  email: string;
  segment: CustomerSegmentValue;
  status: CustomerStatusValue;
  services: CustomerServiceEntry[];
  requirement: string;
  channel: string;
  notes: string;
  assigneeId?: string;
}

const customerArgs = (i: CustomerInput) => ({
  p_name: i.name,
  p_company: i.company,
  p_phone: i.phone,
  p_email: i.email,
  p_segment: i.segment,
  p_status: i.status,
  p_services: i.services.map(x => ({ serviceCode: x.serviceCode, serviceDetails: isWhatsAppService(x.serviceCode) ? x.serviceDetails : {} })),
  p_requirement: i.requirement,
  p_channel: i.channel,
  p_notes: i.notes,
  p_assignee: i.assigneeId || null
});

/** The services of one customer (customer_services), first-added first. */
export async function loadCustomerServices(customerId: string): Promise<CustomerServiceEntry[]> {
  const { data } = await db().from('customer_services').select('service_code, details, created_at').eq('customer_id', customerId).order('created_at');
  return (data || []).map((r: any) => ({ serviceCode: r.service_code, serviceDetails: r.details || {} }));
}

export const customerApi = {
  create: (i: CustomerInput) => rpc<string>('create_support_customer', customerArgs(i)),
  update: (customerId: string, i: CustomerInput) => rpc<void>('update_support_customer', { p_customer: customerId, ...customerArgs(i) })
};

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketCategory = 'GENERAL' | 'BILLING' | 'TECHNICAL' | 'ONBOARDING' | 'COMPLAINT' | 'SERVICE_REQUEST' | 'OTHER';

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_CUSTOMER: 'Waiting for Customer',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed'
};
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General query',
  BILLING: 'Billing',
  TECHNICAL: 'Technical issue',
  ONBOARDING: 'Onboarding',
  COMPLAINT: 'Complaint',
  SERVICE_REQUEST: 'Service request',
  OTHER: 'Other'
};
export const isTicketOpen = (s: TicketStatus) => s !== 'RESOLVED' && s !== 'CLOSED';

export interface SupportTicket {
  id: string;
  ticketNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  departmentId: string;
  teamId: string | null;
  subject: string;
  description: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  createdBy: string | null;
  resolutionNotes: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketUpdateRow {
  id: string;
  ticketId: string;
  authorId: string | null;
  kind: 'CREATED' | 'STATUS_CHANGED' | 'ASSIGNED' | 'ESCALATED' | 'NOTE';
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  assigneeId: string | null;
  note: string | null;
  createdAt: string;
}

export const toTicket = (r: any, cust: Map<string, { name: string; code: string }>): SupportTicket => ({
  id: r.id,
  ticketNo: r.ticket_no,
  customerId: r.customer_id,
  customerName: cust.get(r.customer_id)?.name ?? 'Customer',
  customerCode: cust.get(r.customer_id)?.code ?? '',
  departmentId: r.department_id,
  teamId: r.team_id,
  subject: r.subject,
  description: r.description,
  category: r.category,
  priority: r.priority,
  status: r.status,
  assigneeId: r.assignee_id,
  createdBy: r.created_by,
  resolutionNotes: r.resolution_notes,
  escalatedAt: r.escalated_at,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export interface TicketData {
  tickets: SupportTicket[];
  updates: TicketUpdateRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Every ticket (and its history) the signed-in user may see, kept live. */
export function useTickets(): TicketData {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [updates, setUpdates] = useState<TicketUpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        db().from('support_tickets').select('*').order('updated_at', { ascending: false }).limit(1000),
        db().from('support_ticket_updates').select('*').order('created_at', { ascending: true }).limit(5000)
      ]);
      const firstError = t.error || u.error;
      if (firstError) throw new Error(cleanDbError(firstError.message));
      const rows = t.data || [];
      const ids = [...new Set(rows.map((r: any) => r.customer_id))];
      const cust = new Map<string, { name: string; code: string }>();
      if (ids.length) {
        const { data } = await db().from('customers').select('id, name, customer_code').in('id', ids);
        (data || []).forEach((c: any) => cust.set(c.id, { name: c.name, code: c.customer_code }));
      }
      setTickets(rows.map((r: any) => toTicket(r, cust)));
      setUpdates(
        (u.data || []).map((r: any) => ({
          id: r.id,
          ticketId: r.ticket_id,
          authorId: r.author_id,
          kind: r.kind,
          fromStatus: r.from_status,
          toStatus: r.to_status,
          assigneeId: r.assignee_id,
          note: r.note,
          createdAt: r.created_at
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useRealtime('support_tickets', () => void reload());
  useRealtime('support_ticket_updates', () => void reload());
  return { tickets, updates, loading, error, reload };
}

export const ticketApi = {
  create: (i: { customerId: string; subject: string; description: string; category: TicketCategory; priority: TicketPriority; assigneeId?: string }) =>
    rpc<string>('create_support_ticket', {
      p_customer: i.customerId,
      p_subject: i.subject,
      p_description: i.description,
      p_category: i.category,
      p_priority: i.priority,
      p_assignee: i.assigneeId || null
    }),
  update: (ticketId: string, i: { status: TicketStatus; note?: string; resolution?: string }) =>
    rpc<void>('update_support_ticket', { p_ticket: ticketId, p_status: i.status, p_note: i.note || null, p_resolution: i.resolution || null }),
  assign: (ticketId: string, assigneeId: string, note?: string) =>
    rpc<void>('assign_support_ticket', { p_ticket: ticketId, p_assignee: assigneeId, p_note: note || null })
};

// ---------------------------------------------------------------------------
// Invoices (read-only here; created by Sales / Accounts)
// ---------------------------------------------------------------------------
export interface SupportInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  customerCode: string | null;
  company: string;
  amount: number;
  status: 'Paid' | 'Pending' | 'Overdue';
  issueDate: string;
  dueDate: string;
  taxAmount: number | null;
  service: string | null;
  items: { description: string; quantity: number; rate: number; amount: number }[];
  terms: string | null;
  billingAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  departmentName: string | null;
  createdAt: string;
}

/** Invoices linked to customers the user may see (RLS), newest first. */
export function useSupportInvoices() {
  const [invoices, setInvoices] = useState<SupportInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const { data, error: err } = await db().from('member_invoices').select('*').not('customer_id', 'is', null).order('created_at', { ascending: false }).limit(500);
      if (err) throw new Error(cleanDbError(err.message));
      const rows = data || [];
      const ids = [...new Set(rows.map((r: any) => r.customer_id))];
      const codes = new Map<string, string>();
      if (ids.length) {
        const { data: cs } = await db().from('customers').select('id, customer_code').in('id', ids);
        (cs || []).forEach((c: any) => codes.set(c.id, c.customer_code));
      }
      setInvoices(
        rows.map((r: any) => {
          const d = r.details || {};
          const items = Array.isArray(d.items) ? d.items : [];
          return {
            id: r.id,
            invoiceNumber: r.invoice_number,
            customerId: r.customer_id,
            customerName: r.customer_name,
            customerCode: codes.get(r.customer_id) ?? null,
            company: r.company,
            amount: Number(r.amount),
            status: r.status,
            issueDate: r.issue_date,
            dueDate: r.due_date,
            taxAmount: typeof d.taxAmount === 'number' ? d.taxAmount : null,
            service: items[0]?.description ?? d.service ?? null,
            items,
            terms: d.terms ?? null,
            billingAddress: d.billingAddress ?? null,
            contactEmail: d.contactEmail ?? null,
            contactPhone: d.contactPhone ?? null,
            departmentName: d.departmentName ?? null,
            createdAt: r.created_at
          };
        })
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load invoices.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime('member_invoices', () => void load());
  return { invoices, loading, error, reload: load };
}

// ---------------------------------------------------------------------------
// Invoice requests (Support asks Sales / Accounts to raise an invoice)
// ---------------------------------------------------------------------------
export interface InvoiceRequest {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  requestedBy: string | null;
  requestedByName: string | null;
  fromMonth: string;
  toMonth: string;
  note: string | null;
  status: 'REQUESTED' | 'RAISED' | 'CANCELLED';
  createdAt: string;
}

export function useInvoiceRequests() {
  const [requests, setRequests] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const { data, error: err } = await db().from('invoice_requests').select('*').order('created_at', { ascending: false }).limit(500);
      if (err) throw new Error(cleanDbError(err.message));
      const rows = data || [];
      const cust = new Map<string, { name: string; code: string }>();
      const ids = [...new Set(rows.map((r: any) => r.customer_id))];
      if (ids.length) {
        const { data: cs } = await db().from('customers').select('id, name, customer_code').in('id', ids);
        (cs || []).forEach((c: any) => cust.set(c.id, { name: c.name, code: c.customer_code }));
      }
      const names = await ownerNames(rows.map((r: any) => r.requested_by).filter(Boolean));
      setRequests(
        rows.map((r: any) => ({
          id: r.id,
          customerId: r.customer_id,
          customerName: cust.get(r.customer_id)?.name ?? 'Customer',
          customerCode: cust.get(r.customer_id)?.code ?? '',
          requestedBy: r.requested_by,
          requestedByName: names.get(r.requested_by) ?? null,
          fromMonth: r.from_month,
          toMonth: r.to_month,
          note: r.note,
          status: r.status,
          createdAt: r.created_at
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load invoice requests.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime('invoice_requests', () => void load());
  return { requests, loading, error, reload: load };
}

export const invoiceRequestApi = {
  /** from / to as "YYYY-MM" (month inputs). */
  create: (i: { customerId: string; fromMonth: string; toMonth: string; note?: string }) =>
    rpc<string>('request_invoice', { p_customer: i.customerId, p_from: `${i.fromMonth}-01`, p_to: `${i.toMonth}-01`, p_note: i.note || null })
};

export const fmtMonth = (d: string) => {
  const date = new Date(`${d.slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------
/** Calls onChange (debounced) when rows of a table change. */
export function useRealtime(table: string, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`support-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => cb.current(), 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [table]);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const fmtWhen = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const fmtDay = (d: string | null) => {
  if (!d) return '—';
  const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

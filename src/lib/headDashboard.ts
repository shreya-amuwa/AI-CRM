import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';
import { cleanDbError } from './support';

/**
 * Department Head dashboard data (migration 20270125000100_department_head_dashboard.sql). Every call is a read-only database function that works out the
 * head's own department from the signed-in session; no department id, role or user id is ever sent from here, and the database refuses anyone who is not a
 * Department Head. Nothing in this file writes.
 */

export type AttendanceState = 'PRESENT' | 'ABSENT' | 'ON_LEAVE';

export interface AttendanceSummary { employees: number; present: number; absent: number; onLeave: number; rate: number | null }
export interface AttendanceRow {
  profileId: string; name: string; role: string; designation: string | null; team: string | null; date: string; status: AttendanceState;
  punchIn: string | null; punchOut: string | null; workedMinutes: number | null;
  leave: { id: string; type: 'FULL_DAY' | 'HALF_DAY'; halfDayShift: 'MORNING' | 'AFTERNOON' | null } | null;
}
export interface AttendanceList { date: string; today: string; timeZone: string; summary: AttendanceSummary; total: number; items: AttendanceRow[] }

export type LeadState = 'NEW' | 'IN_PROGRESS' | 'CONVERTED' | 'LOST';
export interface LeadSummary { total: number; new: number; inProgress: number; converted: number; lost: number }
export interface LeadRow {
  id: string; code: string | null; name: string; company: string | null; phone: string | null; email: string | null; city: string | null; state: LeadState; stage: string;
  leadStatus: string; source: string | null; nextFollowUpAt: string | null; expectedBudget: number | null; owner: { id: string; name: string } | null;
  services: { code: string; name: string }[]; createdAt: string;
}
export interface LeadList { summary: LeadSummary; sources: { source: string; count: number }[]; total: number; items: LeadRow[] }
export interface LeadOwner { id: string; name: string; team: string; role: string; designation: string | null }

export interface CustomerSummary { total: number; active: number; inactive: number; new: number; withPendingInvoices: number }
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'PROSPECT';
export interface CustomerRow {
  id: string; code: string | null; name: string; company: string | null; phone: string | null; email: string | null; city: string | null; status: CustomerStatus; lifecycleStage: string;
  department: string | null; relationshipManager: { id: string; name: string } | null; services: { code: string; name: string }[]; pendingInvoices: number; createdAt: string;
}
export interface CustomerList { summary: CustomerSummary; total: number; items: CustomerRow[] }

export interface InvoiceSummary { count: number; amount: number; paid: number; paidAmount: number; pending: number; pendingAmount: number; overdue: number; overdueAmount: number }
export type InvoiceStatus = 'Paid' | 'Pending' | 'Cancelled';
export interface InvoiceRow {
  id: string; number: string; kind: string; customerId: string | null; customer: string; contact: string; amount: number; status: InvoiceStatus; overdue: boolean;
  issueDate: string | null; dueDate: string | null; paidAt: string | null; paidAmount: number; outstanding: number; services: string[]; hasDocument: boolean;
}
export interface InvoiceList { summary: InvoiceSummary; total: number; items: InvoiceRow[] }

export interface CustomerDetail {
  customer: {
    id: string; code: string | null; name: string; company: string | null; phone: string | null; whatsapp: string | null; email: string | null; city: string | null; address: string | null;
    status: CustomerStatus; lifecycleStage: string; createdAt: string; customerSince: string | null; department: string | null;
    relationshipManager: { id: string; name: string } | null; teamLead: { id: string; name: string } | null; teamMember: { id: string; name: string } | null; hasClientLogin: boolean;
  };
  services: { code: string; name: string }[];
  origin: { leadSource: string | null; expectedBudget: number | null; leadCreatedAt: string | null };
  payments: { dealAmount: number | null; amountReceived: number | null; fullyPaid: boolean | null };
  invoices: { id: string; number: string; kind: string; amount: number; status: InvoiceStatus; overdue: boolean; issueDate: string | null; dueDate: string | null }[];
  invoiceSummary: { count: number; invoiced: number; paid: number; outstanding: number };
}

export interface CustomerTicket { id: string; ticketNo: string; subject: string; status: string; priority: string; createdAt: string; assignee: { id: string; name: string } | null }

export interface HeadOverviewData {
  department: { id: string; name: string } | null;
  today: string;
  attendance: AttendanceSummary;
  customers: CustomerSummary;
  leads: LeadSummary;
  invoices: InvoiceSummary;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(cleanDbError(error.message));
  return data as T;
}

export const headApi = {
  overview: () => rpc<HeadOverviewData>('head_dashboard_overview'),
  attendance: (q: { date?: string | null; status?: AttendanceState | null; search?: string; limit?: number; offset?: number }) =>
    rpc<AttendanceList>('head_attendance_list', { p_date: q.date || null, p_status: q.status || null, p_search: q.search || null, p_limit: q.limit ?? 50, p_offset: q.offset ?? 0 }),
  leads: (q: { search?: string; status?: LeadState | null; source?: string | null; limit?: number; offset?: number }) =>
    rpc<LeadList>('head_lead_list', { p_search: q.search || null, p_status: q.status || null, p_source: q.source || null, p_limit: q.limit ?? 20, p_offset: q.offset ?? 0 }),
  leadOwners: () => rpc<LeadOwner[]>('head_lead_owners'),
  customers: (q: { search?: string; status?: CustomerStatus | null; limit?: number; offset?: number }) =>
    rpc<CustomerList>('head_customer_list', { p_search: q.search || null, p_status: q.status || null, p_limit: q.limit ?? 20, p_offset: q.offset ?? 0 }),
  customer: (id: string) => rpc<CustomerDetail>('head_customer_detail', { p_customer: id }),
  /** The customer's support tickets: the existing Department Head function (it checks the customer is in the head's department). */
  customerTickets: (id: string) => rpc<CustomerTicket[]>('head_customer_tickets', { p_customer: id }),
  invoices: (q: { search?: string; status?: 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED' | null; from?: string | null; to?: string | null; limit?: number; offset?: number }) =>
    rpc<InvoiceList>('head_invoice_list', { p_search: q.search || null, p_status: q.status || null, p_from: q.from || null, p_to: q.to || null, p_limit: q.limit ?? 20, p_offset: q.offset ?? 0 })
};

/**
 * Runs `load` now and whenever `deps` change, ignoring an answer that arrived after a newer request (typing in a search box never shows an older result).
 * `reload` runs it again (after a lead was added).
 */
export function useHeadData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    load().then(
      d => { if (mine === seq.current) { setData(d); setError(null); } },
      e => { if (mine === seq.current) setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
    ).finally(() => { if (mine === seq.current) setLoading(false); });
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));
export const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-');
export const dayText = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const hours = (minutes: number | null) => (minutes === null || minutes === undefined ? '-' : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';
import { cleanDbError, toTicket, useRealtime, type SupportTicket, type TicketData, type TicketPriority, type TicketStatus, type TicketUpdateRow } from './support';

/**
 * Team Leader dashboard data (migration 20261009100000_team_leader_dashboard.sql).
 * Every call is a database function that takes the caller from the session
 * (auth.uid()) and only returns that Team Lead's scope: customers of their team
 * plus customers the Department Head handed to them.
 */

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  return supabase;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(cleanDbError(error.message));
  return data as T;
}

export type Assignment = 'MINE' | 'TEAM' | 'DECISION';

export interface TlMemberLoad {
  id: string;
  fullName: string;
  customers: number;
  openTickets: number;
  urgentTickets: number;
}

export interface TlActivity {
  id: string;
  type: string;
  note: string | null;
  occurredAt: string;
  customerId: string;
  customerName: string;
  actorName: string | null;
}

export interface TlDashboard {
  lead: { id: string; fullName: string; teamId: string; teamName: string | null };
  totals: { customers: number; mine: number; team: number; needsDecision: number; openTickets: number; urgentTickets: number };
  members: TlMemberLoad[];
  decisions: { id: string; name: string; company: string | null; code: string; passedAt: string | null }[];
  alerts: { id: string; ticketNo: string; subject: string; priority: TicketPriority; status: TicketStatus; updatedAt: string; customerId: string; customerName: string }[];
  activity: TlActivity[];
}

export interface TlCustomer {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PROSPECT';
  lifecycleStage: 'LEAD' | 'POTENTIAL' | 'ONBOARDING' | 'CUSTOMER' | 'LOST';
  assigneeId: string | null;
  assigneeName: string | null;
  assignment: Assignment;
  handedOver: boolean;
  openTickets: number;
  totalTickets: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface TlTicket {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  customerId: string;
  customerName: string;
  customerCode: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** The lead may act on it (same rule as update_support_ticket); otherwise view only. */
  manageable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerQuery {
  search?: string;
  status?: string;
  assignment?: Assignment | '';
  memberId?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'activity' | 'tickets';
  page: number;
  pageSize: number;
}

export interface TicketQuery {
  search?: string;
  status?: TicketStatus | 'OPEN_ONLY' | 'ALL';
  priority?: TicketPriority | '';
  customerId?: string;
  assigneeId?: string;
  sort?: 'updated' | 'created' | 'priority';
  page: number;
  pageSize: number;
}

export const teamLeadApi = {
  dashboard: () => rpc<TlDashboard>('team_lead_dashboard'),
  customers: (q: CustomerQuery) =>
    rpc<Page<TlCustomer>>('team_lead_customers', {
      p_search: q.search || null,
      p_status: q.status || null,
      p_assignment: q.assignment || null,
      p_member: q.memberId || null,
      p_sort: q.sort || 'newest',
      p_page: q.page,
      p_page_size: q.pageSize
    }),
  tickets: (q: TicketQuery) =>
    rpc<Page<TlTicket>>('team_lead_tickets', {
      p_search: q.search || null,
      p_status: q.status || 'OPEN_ONLY',
      p_priority: q.priority || null,
      p_customer: q.customerId || null,
      p_assignee: q.assigneeId || null,
      p_sort: q.sort || 'updated',
      p_page: q.page,
      p_page_size: q.pageSize
    }),
  /** Keep with me (the lead's own id) or assign to a member of the lead's team. */
  assign: (customerId: string, assigneeId: string) => rpc<void>('team_lead_assign_customer', { p_customer: customerId, p_assignee: assigneeId }),
  /** One ticket and its history, for the ticket detail (read access follows RLS). */
  ticket: async (ticketId: string, customer: { name: string; code: string }): Promise<{ ticket: SupportTicket; updates: TicketUpdateRow[] } | null> => {
    const [t, u] = await Promise.all([
      db().from('support_tickets').select('*').eq('id', ticketId).maybeSingle(),
      db().from('support_ticket_updates').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true })
    ]);
    const err = t.error || u.error;
    if (err) throw new Error(cleanDbError(err.message));
    if (!t.data) return null;
    return {
      ticket: toTicket(t.data, new Map([[t.data.customer_id, customer]])),
      updates: (u.data || []).map((r: any) => ({
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
    };
  }
};

/** Keeps a server-side list in sync with its query (latest response wins). */
export function useServerList<Q, T>(load: (q: Q) => Promise<Page<T>>, query: Q, version: number) {
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(query);
  const run = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    load(JSON.parse(key) as Q)
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(e instanceof Error ? e.message : 'Could not load the list.')
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [load, key]);
  useEffect(run, [run, version]);
  return { data, loading, error, reload: run };
}

/** Dashboard summary; `version` bumps after changes made on the page, realtime covers the rest. */
export function useTeamLeadDashboard(version: number) {
  const [data, setData] = useState<TlDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setData(await teamLeadApi.dashboard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, version]);
  useRealtime('support_tickets', () => void reload());
  useRealtime('customers', () => void reload());
  return { data, error, loading, reload };
}

/** A TicketData for one ticket, so the existing ticket detail can be reused. */
export function singleTicketData(ticket: SupportTicket, updates: TicketUpdateRow[], reload: () => Promise<void>): TicketData {
  return { tickets: [ticket], updates, loading: false, error: null, reload };
}

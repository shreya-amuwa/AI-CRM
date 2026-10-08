import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Lead,
  LeadSourceId,
  DepartmentId,
  TeamMemberActivity,
  EndOfDayReport,
  FollowUpTask,
  Deal,
  RecentUpdate,
  LeadSourceStat,
  MemberTarget,
  Invoice,
  CalendarEvent
} from '../types/crm';
import type { LeadStatus } from '../../shared/contracts';
import { pipelineApi } from '../lib/api/endpoints';
import { getSupabase } from './supabaseClient';

/**
 * The team member's workspace, stored in Supabase (see migration
 * 20261007000200_member_workspace.sql) so every device signed in to the same
 * account sees the same data.
 *
 * Components read synchronously from an in-memory copy; `connect()` loads it
 * from the database and keeps it current through Realtime, and every write
 * goes to the database first. Listeners registered with `subscribe()` are
 * called whenever the copy changes (locally or from another device).
 *
 * Leads are the member's own pipeline records (customers table, lifecycle
 * LEAD → POTENTIAL → ONBOARDING), the same data My Leads shows.
 */

type Row = Record<string, any>;

const MEMBER_TABLES = [
  'member_follow_ups',
  'member_activities',
  'member_deals',
  'member_calendar_events',
  'member_eod_reports',
  'member_invoices'
] as const;
type MemberTable = (typeof MEMBER_TABLES)[number];

const SOURCE_COLORS: Record<string, string> = {
  WhatsApp: '#10B981',
  'Meta Ads': '#3B82F6',
  Website: '#8B5CF6',
  Referral: '#F59E0B',
  Other: '#94A3B8'
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Lead source text (e.g. "Instagram") → the chart's source buckets. */
function sourceIdOf(source: string | null): LeadSourceId {
  const s = (source || '').toLowerCase();
  if (s.includes('whatsapp')) return 'whatsapp';
  if (/meta|instagram|facebook/.test(s)) return 'meta';
  if (/website|web/.test(s)) return 'website';
  if (s.includes('referr')) return 'references';
  if (s.includes('cold')) return 'coldcalling';
  return 'thirdparty';
}

const LEAD_STATUS_STAGE: Record<string, NonNullable<Lead['stage']>> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  READY_TO_BUY: 'Proposal'
};

/** A pipeline customer (customers table) as the home dashboard's Lead. */
function toLead(r: Row): Lead {
  const stage: Lead['stage'] =
    r.lifecycle_stage === 'LEAD'
      ? LEAD_STATUS_STAGE[r.lead_status] || 'New'
      : r.lifecycle_stage === 'POTENTIAL'
        ? 'Negotiation'
        : r.lifecycle_stage === 'LOST'
          ? 'Lost'
          : 'Won';
  return {
    id: r.id,
    name: r.name,
    contact: r.phone || '',
    email: r.email || '',
    company: r.company || '',
    sourceId: sourceIdOf(r.lead_source),
    departmentId: '' as DepartmentId,
    assignedTo: r.owner_id,
    stage,
    priority: 'Medium',
    lastActionDate: r.updated_at ? new Date(r.updated_at).toLocaleString() : undefined,
    receivedAt: r.created_at,
    status: 'Verified',
    dealValue: Number(r.deal_amount ?? r.expected_budget) || 0,
    notes: r.notes || '',
    rawPayload: {}
  };
}

const toFollowUp = (r: Row): FollowUpTask => ({
  id: r.id,
  userId: r.owner_id,
  leadId: r.lead_id || '',
  leadName: r.lead_name,
  company: r.company || '',
  type: r.type,
  dateTimeStr: r.due_label,
  notes: r.notes,
  status: r.status,
  completedAt: r.completed_at || undefined
});

const toActivity = (r: Row): TeamMemberActivity & { createdAt: string } => ({
  id: r.id,
  userId: r.owner_id,
  leadId: r.lead_id || '',
  leadName: r.lead_name,
  action: r.action,
  notes: r.notes || undefined,
  type: r.type,
  time: formatTime(r.created_at),
  date: localDate(new Date(r.created_at)),
  createdAt: r.created_at
});

const toDeal = (r: Row): Deal => ({
  id: r.id,
  userId: r.owner_id,
  leadId: r.lead_id || '',
  leadName: r.lead_name,
  company: r.company,
  value: Number(r.value) || 0,
  stage: r.stage,
  expectedClose: r.expected_close || '',
  createdAt: localDate(new Date(r.created_at))
});

const toEvent = (r: Row): CalendarEvent => ({
  id: r.id,
  userId: r.owner_id,
  title: r.title,
  customer: r.customer,
  company: r.company || undefined,
  type: r.type,
  date: r.event_date,
  time: r.event_time,
  status: r.status
});

const toEod = (r: Row): EndOfDayReport => ({
  id: r.id,
  userId: r.owner_id,
  userName: r.user_name,
  date: r.report_date,
  timestamp: r.created_at,
  leadsAdvanced: r.leads_advanced,
  salesClosed: r.sales_closed,
  callsMade: r.calls_made,
  demosScheduled: r.demos_scheduled,
  notes: r.notes || undefined
});

const toInvoice = (r: Row): Invoice => ({
  ...(r.details || {}),
  id: r.id,
  invoiceNumber: r.invoice_number,
  customerName: r.customer_name,
  company: r.company,
  amount: Number(r.amount) || 0,
  status: r.status,
  issueDate: r.issue_date,
  dueDate: r.due_date,
  userId: r.owner_id,
  teamMemberId: r.owner_id
});

class TeamMemberStore {
  private userId: string | null = null;
  private departmentSlug: string | null = null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<() => void>();
  private reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;

  private leads: Lead[] = [];
  private rawStages = new Map<string, string>();
  private followUps: FollowUpTask[] = [];
  private activities: (TeamMemberActivity & { createdAt: string })[] = [];
  private deals: Deal[] = [];
  private events: CalendarEvent[] = [];
  private eodReports: EndOfDayReport[] = [];
  private invoices: Invoice[] = [];

  public loading = false;
  public lastError: string | null = null;

  // --- CONNECTION -----------------------------------------------------------

  /** Loads the member's workspace and keeps it live. Safe to call repeatedly. */
  public async connect(userId: string, departmentSlug?: string | null): Promise<void> {
    const dept = departmentSlug || null;
    if (this.userId === userId && this.departmentSlug === dept && this.channel) return;
    this.disconnect();
    const generation = this.generation;
    this.userId = userId;
    this.departmentSlug = dept;

    const supabase = getSupabase();
    if (!supabase) {
      this.lastError = 'The CRM is not connected to its database.';
      this.emit();
      return;
    }

    this.loading = true;
    this.emit();
    await Promise.all([this.reload('customers'), ...MEMBER_TABLES.map(t => this.reload(t))]);
    if (generation !== this.generation) return; // disconnected or reconnected meanwhile
    this.loading = false;
    this.emit();

    let channel = supabase.channel(`member-workspace-${userId}`);
    for (const table of MEMBER_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `owner_id=eq.${userId}` },
        () => this.scheduleReload(table)
      );
    }
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers', filter: `owner_id=eq.${userId}` },
      () => this.scheduleReload('customers')
    );
    this.channel = channel.subscribe();
  }

  public disconnect(): void {
    this.generation++;
    this.loading = false;
    const supabase = getSupabase();
    if (this.channel && supabase) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.reloadTimers.forEach(t => clearTimeout(t));
    this.reloadTimers.clear();
    this.userId = null;
    this.leads = [];
    this.followUps = [];
    this.activities = [];
    this.deals = [];
    this.events = [];
    this.eodReports = [];
    this.invoices = [];
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach(l => l());
  }

  private scheduleReload(table: MemberTable | 'customers'): void {
    clearTimeout(this.reloadTimers.get(table));
    this.reloadTimers.set(
      table,
      setTimeout(() => {
        void this.reload(table).then(() => this.emit());
      }, 250)
    );
  }

  private async reload(table: MemberTable | 'customers'): Promise<void> {
    const supabase = getSupabase();
    const userId = this.userId;
    if (!supabase || !userId) return;

    let query;
    if (table === 'customers') {
      query = supabase
        .from('customers')
        .select('id, name, phone, email, company, lead_source, lifecycle_stage, lead_status, deal_amount, expected_budget, notes, owner_id, created_at, updated_at')
        .eq('owner_id', userId)
        .in('lifecycle_stage', ['LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER', 'LOST'])
        .order('created_at', { ascending: false })
        .limit(500);
    } else {
      query = supabase.from(table).select('*').eq('owner_id', userId).order('created_at', { ascending: false }).limit(500);
    }

    const { data, error } = await query;
    if (this.userId !== userId) return; // signed out / switched user meanwhile
    if (error) {
      this.lastError = error.message;
      console.error(`[teamMemberStore] failed to load ${table}:`, error.message);
      return;
    }
    const rows = data || [];
    switch (table) {
      case 'customers':
        this.leads = rows.map(toLead);
        this.rawStages = new Map(rows.map(r => [r.id, r.lifecycle_stage]));
        break;
      case 'member_follow_ups':
        this.followUps = rows.map(toFollowUp);
        break;
      case 'member_activities':
        this.activities = rows.map(toActivity);
        break;
      case 'member_deals':
        this.deals = rows.map(toDeal);
        break;
      case 'member_calendar_events':
        this.events = rows.map(toEvent);
        break;
      case 'member_eod_reports':
        this.eodReports = rows.map(toEod);
        break;
      case 'member_invoices':
        this.invoices = rows.map(toInvoice);
        break;
    }
  }

  /** Runs a write, then refreshes the affected table(s) and notifies listeners. */
  private async write(tables: (MemberTable | 'customers')[], op: () => PromiseLike<{ error: any }>): Promise<void> {
    const { error } = await op();
    if (error) {
      this.lastError = error.message;
      throw new Error(error.message);
    }
    await Promise.all(tables.map(t => this.reload(t)));
    this.emit();
  }

  private db() {
    const supabase = getSupabase();
    if (!supabase || !this.userId) throw new Error('Not connected to the CRM database.');
    return supabase;
  }

  // --- LEADS ----------------------------------------------------------------

  public getAssignedLeads(_userId?: string): Lead[] {
    return this.leads;
  }

  public async updateLeadStage(leadId: string, _userId: string, newStage: Lead['stage'], notes?: string): Promise<void> {
    const lead = this.leads.find(l => l.id === leadId);
    // Lead statuses are changed through the pipeline API (validated + audited);
    // later stages (payment, onboarding) are only changed in My Leads.
    const status = { New: 'NEW', 'New Lead': 'NEW', Contacted: 'CONTACTED', Interested: 'INTERESTED', Demo: 'INTERESTED', Proposal: 'READY_TO_BUY' }[
      newStage as string
    ] as LeadStatus | undefined;
    const row = this.rawStages.get(leadId);
    if (status && row === 'LEAD') {
      await pipelineApi.updateLead(leadId, { leadStatus: status, ...(notes ? { activityNote: notes } : {}) });
      await this.reload('customers');
      this.emit();
    }
    await this.logActivity({
      leadId,
      leadName: lead?.name || '',
      action: `Stage updated to ${newStage}`,
      type: 'stage',
      notes: notes || `Moved to ${newStage}`
    });
  }

  // --- FOLLOW UPS -----------------------------------------------------------

  public getFollowUps(_userId?: string, status?: FollowUpTask['status']): FollowUpTask[] {
    return status ? this.followUps.filter(f => f.status === status) : this.followUps;
  }

  public async toggleFollowUpStatus(followUpId: string): Promise<void> {
    const db = this.db();
    const task = this.followUps.find(t => t.id === followUpId);
    if (!task) return;
    const next = task.status === 'completed' ? 'upcoming' : 'completed';
    await this.write(['member_follow_ups'], () =>
      db
        .from('member_follow_ups')
        .update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null })
        .eq('id', followUpId)
    );
  }

  public async addFollowUp(task: Omit<FollowUpTask, 'id' | 'userId'>): Promise<void> {
    const db = this.db();
    await this.write(['member_follow_ups'], () =>
      db.from('member_follow_ups').insert({
        lead_id: task.leadId || null,
        lead_name: task.leadName,
        company: task.company || null,
        type: task.type,
        due_label: task.dateTimeStr,
        notes: task.notes,
        status: task.status
      })
    );
  }

  // --- ACTIVITIES & UPDATES -------------------------------------------------

  public getTodayActivities(_userId?: string): TeamMemberActivity[] {
    const today = localDate();
    return this.activities.filter(a => a.date === today);
  }

  public async logActivity(item: {
    leadId: string;
    leadName: string;
    action: string;
    notes?: string;
    type?: TeamMemberActivity['type'];
  }): Promise<void> {
    const db = this.db();
    await this.write(['member_activities'], () =>
      db.from('member_activities').insert({
        lead_id: item.leadId || null,
        lead_name: item.leadName,
        action: item.action,
        notes: item.notes || null,
        type: item.type || 'update'
      })
    );
  }

  /** New leads and the member's own actions, newest first. */
  public getRecentUpdates(): RecentUpdate[] {
    const fromLeads = this.leads.map(l => ({
      id: `lead-${l.id}`,
      title: `New lead: ${l.company || l.name}`,
      type: 'lead' as const,
      timestamp: l.receivedAt
    }));
    const fromActivities = this.activities.map(a => ({
      id: `act-${a.id}`,
      title: a.action,
      type: (a.type === 'call' ? 'call' : a.type === 'stage' ? 'deal' : 'lead') as RecentUpdate['type'],
      timestamp: a.createdAt
    }));
    return [...fromLeads, ...fromActivities]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 10)
      .map(u => ({ ...u, timeAgo: timeAgo(u.timestamp) }));
  }

  // --- ANALYTICS ------------------------------------------------------------

  public getLeadSources(_userId?: string): LeadSourceStat[] {
    const total = this.leads.length || 1;
    const counts: Record<string, number> = { WhatsApp: 0, 'Meta Ads': 0, Website: 0, Referral: 0, Other: 0 };
    this.leads.forEach(l => {
      if (l.sourceId === 'whatsapp') counts.WhatsApp++;
      else if (l.sourceId === 'meta') counts['Meta Ads']++;
      else if (l.sourceId === 'website') counts.Website++;
      else if (l.sourceId === 'references') counts.Referral++;
      else counts.Other++;
    });
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      percentage: Math.round((count / total) * 100),
      color: SOURCE_COLORS[name]
    }));
  }

  /** No sales targets are stored yet, so only the won count is real. */
  public getMemberTarget(_userId?: string): MemberTarget {
    const current = this.leads.filter(l => l.stage === 'Won').length;
    return { current, goal: 0, percentage: 0 };
  }

  public getDashboardKpis(_userId?: string) {
    const leads = this.leads;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const convertedLeads = leads.filter(l => l.stage === 'Won').length;
    return {
      totalLeads: leads.length,
      newLeadsThisWeek: leads.filter(l => new Date(l.receivedAt).getTime() >= weekAgo).length,
      followUpsDue: this.followUps.filter(f => f.status !== 'completed').length,
      convertedLeads,
      dealsInProgress: leads.filter(l => l.stage === 'Contacted' || l.stage === 'Interested' || l.stage === 'Proposal').length,
      conversionRate: leads.length > 0 ? Math.round((convertedLeads / leads.length) * 100) : 0
    };
  }

  // --- END OF DAY REPORT ----------------------------------------------------

  public async saveEndOfDayReport(report: {
    userName: string;
    leadsAdvanced: number;
    salesClosed: number;
    callsMade: number;
    demosScheduled: number;
    notes?: string;
  }): Promise<EndOfDayReport | null> {
    const db = this.db();
    await this.write(['member_eod_reports'], () =>
      db.from('member_eod_reports').upsert(
        {
          owner_id: this.userId,
          user_name: report.userName,
          report_date: localDate(),
          leads_advanced: report.leadsAdvanced,
          sales_closed: report.salesClosed,
          calls_made: report.callsMade,
          demos_scheduled: report.demosScheduled,
          notes: report.notes || null
        },
        { onConflict: 'owner_id,report_date' }
      )
    );
    return this.getTodayEndOfDayReport();
  }

  public getTodayEndOfDayReport(_userId?: string): EndOfDayReport | null {
    const today = localDate();
    return this.eodReports.find(r => r.date === today) || null;
  }

  // --- INVOICES -------------------------------------------------------------

  public getInvoices(_userId?: string): Invoice[] {
    return this.invoices;
  }

  public async addInvoice(invoice: Omit<Invoice, 'id'>): Promise<void> {
    const db = this.db();
    const { invoiceNumber, customerName, company, amount, status, issueDate, dueDate, userId, teamMemberId, ...details } =
      invoice;
    await this.write(['member_invoices'], () =>
      db.from('member_invoices').insert({
        invoice_number: invoiceNumber,
        customer_name: customerName,
        company: company || '',
        amount,
        status,
        issue_date: issueDate,
        due_date: dueDate,
        details
      })
    );
  }

  // --- CALENDAR -------------------------------------------------------------

  public getCalendarEvents(_userId?: string): CalendarEvent[] {
    return this.events;
  }

  public async addCalendarEvent(event: Omit<CalendarEvent, 'id' | 'userId'>): Promise<void> {
    const db = this.db();
    await this.write(['member_calendar_events'], () =>
      db.from('member_calendar_events').insert({
        title: event.title,
        customer: event.customer,
        company: event.company || null,
        type: event.type,
        event_date: event.date,
        event_time: event.time,
        status: event.status
      })
    );
  }

  public async deleteCalendarEvent(eventId: string): Promise<void> {
    const db = this.db();
    await this.write(['member_calendar_events'], () => db.from('member_calendar_events').delete().eq('id', eventId));
  }

  // --- DEALS ----------------------------------------------------------------

  public getDeals(_userId?: string): Deal[] {
    return this.deals;
  }

  public async addDeal(deal: Omit<Deal, 'id' | 'createdAt' | 'userId'>): Promise<void> {
    const db = this.db();
    await this.write(['member_deals'], () =>
      db.from('member_deals').insert({
        lead_id: deal.leadId || null,
        lead_name: deal.leadName,
        company: deal.company || '',
        value: deal.value,
        stage: deal.stage,
        expected_close: deal.expectedClose || null
      })
    );
  }

  public async updateDealStage(dealId: string, newStage: Deal['stage']): Promise<void> {
    const db = this.db();
    await this.write(['member_deals'], () => db.from('member_deals').update({ stage: newStage }).eq('id', dealId));
  }
}

export const teamMemberStore = new TeamMemberStore();

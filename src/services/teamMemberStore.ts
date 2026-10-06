import {
  Lead,
  TeamMemberActivity,
  EndOfDayReport,
  FollowUpTask,
  Deal,
  RecentUpdate,
  LeadSourceStat,
  MemberTarget,
  Customer,
  Invoice,
  CalendarEvent
} from '../types/crm';

export interface TeamMemberUser {
  id: string;
  name: string;
  email: string;
  role: 'team-member';
  title: string;
  department: string;
  departmentId: string;
  avatar: string;
  targetCalls: number;
  targetDemos: number;
  targetDeals: number;
  currentDeals: number;
}

export const SAMPLE_TEAM_MEMBERS: TeamMemberUser[] = [
  {
    id: 'tm-priya',
    name: 'Priya Nair',
    email: 'priya@amuwa.com',
    role: 'team-member',
    title: 'Sales Executive',
    department: 'Wabastore',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    targetCalls: 15,
    targetDemos: 5,
    targetDeals: 15,
    currentDeals: 8
  },
  {
    id: 'tm-rahul',
    name: 'Rahul Kumar',
    email: 'rahul@amuwa.com',
    role: 'team-member',
    title: 'Sales Executive',
    department: 'Wabastore',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    targetCalls: 12,
    targetDemos: 4,
    targetDeals: 12,
    currentDeals: 6
  },
  {
    id: 'tm-amit',
    name: 'Amit Patel',
    email: 'amit@amuwa.com',
    role: 'team-member',
    title: 'Senior Sales Specialist',
    department: 'Wabastore',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
    targetCalls: 14,
    targetDemos: 4,
    targetDeals: 14,
    currentDeals: 7
  }
];

export const INITIAL_PRIYA_LEADS: Lead[] = [];
export const INITIAL_RAHUL_LEADS: Lead[] = [];
export const INITIAL_AMIT_LEADS: Lead[] = [];
export const INITIAL_FOLLOW_UPS: FollowUpTask[] = [];
export const INITIAL_ACTIVITIES: TeamMemberActivity[] = [];
export const INITIAL_RECENT_UPDATES: RecentUpdate[] = [];
export const INITIAL_CUSTOMERS: Customer[] = [];
export const INITIAL_CUSTOMER_ACTIVITIES: any[] = [];
export const INITIAL_INVOICES: Invoice[] = [
  {
    id: 'INV-WAB-001',
    invoiceNumber: 'WAB-SLS-2026-101',
    customerName: 'Rajesh Mehra',
    company: 'Titan Company Limited',
    amount: 185000,
    issueDate: 'Sep 25, 2026',
    dueDate: '2026-10-15',
    status: 'Paid',
    departmentId: 'wabastore-sales',
    departmentName: 'Wabastore (Sales Division)',
    division: 'Sales',
    terms: 'Net 15 days. Subject to Meta Cloud WhatsApp Commerce terms.',
    contactEmail: 'billing@wabastore.com',
    contactPhone: '+91 80 4912 2001',
    userId: 'tm-priya',
    teamMemberId: 'tm-priya',
    teamMemberName: 'Priya Nair',
    teamMemberRole: 'Sales Executive',
    items: [
      { description: 'Wabastore E-Commerce Storefront Engine & Catalog Sync', quantity: 1, rate: 185000, amount: 185000 }
    ]
  },
  {
    id: 'INV-WBX-001',
    invoiceNumber: 'WBX-SLS-2026-102',
    customerName: 'Sanjay Kapoor',
    company: 'FabIndia Overseas Pvt Ltd',
    amount: 215000,
    issueDate: 'Sep 27, 2026',
    dueDate: '2026-10-18',
    status: 'Pending',
    departmentId: 'whatsbox-sales',
    departmentName: 'Whatsbox (Sales Division)',
    division: 'Sales',
    terms: 'Annual subscription billed upfront with 99.9% uptime SLA.',
    contactEmail: 'sales@whatsbox.com',
    contactPhone: '+91 80 4912 3001',
    userId: 'tm-rahul',
    teamMemberId: 'tm-rahul',
    teamMemberName: 'Rahul Kumar',
    teamMemberRole: 'Sales Executive',
    items: [
      { description: 'Whatsbox Multi-Agent Unified Inbox License (25 Seats)', quantity: 1, rate: 215000, amount: 215000 }
    ]
  },
  {
    id: 'INV-DTK-001',
    invoiceNumber: 'DTK-SLS-2026-103',
    customerName: 'Girish Kulkarni',
    company: 'Bajaj Finance Limited',
    amount: 240000,
    issueDate: 'Sep 28, 2026',
    dueDate: '2026-10-12',
    status: 'Pending',
    departmentId: 'dtalk-sales',
    departmentName: 'D-Talk (Sales Division)',
    division: 'Sales',
    terms: 'Includes 100-channel PRI line allocation. TRAI compliance guidelines apply.',
    contactEmail: 'sales@dtalk.com',
    contactPhone: '+91 20 6711 5001',
    userId: 'tm-amit',
    teamMemberId: 'tm-amit',
    teamMemberName: 'Amit Patel',
    teamMemberRole: 'Senior Sales Specialist',
    items: [
      { description: 'Enterprise 100-Channel PRI SIP Trunking & Dialer Suite', quantity: 1, rate: 240000, amount: 240000 }
    ]
  },
  {
    id: 'INV-DGT-001',
    invoiceNumber: 'DGT-SLS-2026-104',
    customerName: 'Manish Chawla',
    company: 'Cognizant Technology Solutions',
    amount: 195000,
    issueDate: 'Sep 29, 2026',
    dueDate: '2026-10-14',
    status: 'Paid',
    departmentId: 'digitree-sales',
    departmentName: 'Digitree (Sales Division)',
    division: 'Sales',
    terms: 'Software license valid for 12 months with unlimited dynamic QR generations.',
    contactEmail: 'sales@digitree.com',
    contactPhone: '+91 124 459 8001',
    userId: 'tm-priya',
    teamMemberId: 'tm-priya',
    teamMemberName: 'Priya Nair',
    teamMemberRole: 'Sales Executive',
    items: [
      { description: 'Digitree Dynamic AIQR Enterprise Multi-Brand Platform', quantity: 1, rate: 195000, amount: 195000 }
    ]
  },
  {
    id: 'INV-MPL-001',
    invoiceNumber: 'MPL-SLS-2026-105',
    customerName: 'Anil Agrawal',
    company: 'Godrej Properties Limited',
    amount: 280000,
    issueDate: 'Sep 20, 2026',
    dueDate: '2026-09-30',
    status: 'Overdue',
    departmentId: 'mpillar-sales',
    departmentName: 'M Pillar (Sales Division)',
    division: 'Sales',
    terms: 'Mobilization within 14 business days. Milestone billing upon site setup.',
    contactEmail: 'sales@mpillar.com',
    contactPhone: '+91 22 6889 6001',
    userId: 'tm-rahul',
    teamMemberId: 'tm-rahul',
    teamMemberName: 'Rahul Kumar',
    teamMemberRole: 'Sales Executive',
    items: [
      { description: 'Smart Construction Site Safety & Daily Attendance IoT Suite', quantity: 1, rate: 280000, amount: 280000 }
    ]
  },
  {
    id: 'INV-WBS-001',
    invoiceNumber: 'WBS-SLS-2026-106',
    customerName: 'Karthik Raman',
    company: 'Nykaa E-Retail Limited',
    amount: 230000,
    issueDate: 'Sep 26, 2026',
    dueDate: '2026-10-16',
    status: 'Paid',
    departmentId: 'wabastar-sales',
    departmentName: 'Wabastar (Sales Division)',
    division: 'Sales',
    terms: 'Net 15 days. Dedicated high-throughput messaging quotas apply.',
    contactEmail: 'sales@wabastar.com',
    contactPhone: '+91 80 4912 2005',
    userId: 'tm-amit',
    teamMemberId: 'tm-amit',
    teamMemberName: 'Amit Patel',
    teamMemberRole: 'Senior Sales Specialist',
    items: [
      { description: 'Wabastar High-Throughput Marketing Automation License', quantity: 1, rate: 230000, amount: 230000 }
    ]
  }
];
export const INITIAL_CALENDAR_EVENTS: CalendarEvent[] = [];
export const INITIAL_DEALS_CRM: Deal[] = [];

class TeamMemberStore {
  private leadsKey = 'amuwa_crm_team_member_leads_v3';
  private activitiesKey = 'amuwa_crm_team_member_activities_v3';
  private followUpsKey = 'amuwa_crm_team_member_followups_v3';
  private reportsKey = 'amuwa_crm_team_member_reports_v3';
  private updatesKey = 'amuwa_crm_team_member_recent_updates_v3';
  private invoicesKey = 'amuwa_crm_team_member_invoices_v3';
  private eventsKey = 'amuwa_crm_team_member_events_v3';
  private dealsKey = 'amuwa_crm_team_member_deals_v3';

  constructor() {
    this.initStore();
  }

  private initStore() {
    try {
      if (!localStorage.getItem(this.leadsKey)) {
        const all = [...INITIAL_PRIYA_LEADS, ...INITIAL_RAHUL_LEADS, ...INITIAL_AMIT_LEADS];
        localStorage.setItem(this.leadsKey, JSON.stringify(all));
      }
      if (!localStorage.getItem(this.activitiesKey)) {
        localStorage.setItem(this.activitiesKey, JSON.stringify(INITIAL_ACTIVITIES));
      }
      if (!localStorage.getItem(this.followUpsKey)) {
        localStorage.setItem(this.followUpsKey, JSON.stringify(INITIAL_FOLLOW_UPS));
      }
      if (!localStorage.getItem(this.updatesKey)) {
        localStorage.setItem(this.updatesKey, JSON.stringify(INITIAL_RECENT_UPDATES));
      }
      if (!localStorage.getItem(this.invoicesKey)) {
        localStorage.setItem(this.invoicesKey, JSON.stringify(INITIAL_INVOICES));
      }
      if (!localStorage.getItem(this.eventsKey)) {
        localStorage.setItem(this.eventsKey, JSON.stringify(INITIAL_CALENDAR_EVENTS));
      }
      if (!localStorage.getItem(this.dealsKey)) {
        localStorage.setItem(this.dealsKey, JSON.stringify(INITIAL_DEALS_CRM));
      }
    } catch (e) {
      console.error('Failed to init TeamMemberStore:', e);
    }
  }

  // --- LEADS ---
  public getAssignedLeads(userId: string): Lead[] {
    try {
      const all: Lead[] = JSON.parse(localStorage.getItem(this.leadsKey) || '[]');
      return all.filter(l => l.assignedTo === userId);
    } catch {
      return [];
    }
  }

  public addLead(leadData: Partial<Lead> & { name: string; contact: string; assignedTo: string }): Lead {
    const newLead: Lead = {
      id: `PLD-${Date.now()}`,
      name: leadData.name,
      contact: leadData.contact,
      email: leadData.email,
      company: leadData.company || 'Private Client',
      sourceId: leadData.sourceId || 'whatsapp',
      departmentId: leadData.departmentId || 'wabastore',
      assignedTo: leadData.assignedTo,
      stage: leadData.stage || 'New',
      priority: leadData.priority || 'Medium',
      lastActionDate: 'Just now',
      receivedAt: new Date().toISOString(),
      status: 'Verified',
      dealValue: leadData.dealValue || 30000,
      notes: leadData.notes || '',
      rawPayload: {}
    };

    try {
      const all: Lead[] = JSON.parse(localStorage.getItem(this.leadsKey) || '[]');
      localStorage.setItem(this.leadsKey, JSON.stringify([newLead, ...all]));
      this.addRecentUpdate(`New lead added: ${newLead.company || newLead.name}`, 'lead');
    } catch (e) {
      console.error('Failed to add lead:', e);
    }

    return newLead;
  }

  public updateLeadStage(leadId: string, userId: string, newStage: Lead['stage'], notes?: string): boolean {
    try {
      const all: Lead[] = JSON.parse(localStorage.getItem(this.leadsKey) || '[]');
      let targetLead: Lead | undefined;
      const updated = all.map(l => {
        if (l.id === leadId && l.assignedTo === userId) {
          targetLead = l;
          return {
            ...l,
            stage: newStage,
            lastActionDate: `Today, ${this.formatCurrentTime()}`,
            notes: notes ? `${l.notes ? l.notes + ' | ' : ''}${notes}` : l.notes
          };
        }
        return l;
      });

      localStorage.setItem(this.leadsKey, JSON.stringify(updated));

      if (targetLead) {
        this.logActivity({
          userId,
          leadId,
          leadName: targetLead.name,
          action: `Stage updated to ${newStage}`,
          type: 'stage',
          notes: notes || `Moved to ${newStage}`
        });

        this.addRecentUpdate(`Deal moved to ${newStage} – ${targetLead.company || targetLead.name}`, 'deal');
      }

      return true;
    } catch {
      return false;
    }
  }

  // --- FOLLOW UPS ---
  public getFollowUps(userId: string, status?: 'upcoming' | 'overdue' | 'completed'): FollowUpTask[] {
    try {
      const all: FollowUpTask[] = JSON.parse(localStorage.getItem(this.followUpsKey) || '[]');
      const userTasks = all.filter(f => f.userId === userId || (!f.userId && userId === 'tm-priya'));
      if (status) {
        return userTasks.filter(f => f.status === status);
      }
      return userTasks;
    } catch {
      return [];
    }
  }

  public toggleFollowUpStatus(followUpId: string): boolean {
    try {
      const all: FollowUpTask[] = JSON.parse(localStorage.getItem(this.followUpsKey) || '[]');
      const updated = all.map(t => {
        if (t.id === followUpId) {
          const nextStatus = t.status === 'completed' ? 'upcoming' : 'completed';
          return {
            ...t,
            status: nextStatus as any,
            completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined
          };
        }
        return t;
      });
      localStorage.setItem(this.followUpsKey, JSON.stringify(updated));
      return true;
    } catch {
      return false;
    }
  }

  public addFollowUp(task: Omit<FollowUpTask, 'id'>): FollowUpTask {
    const newTask: FollowUpTask = {
      ...task,
      id: `FUP-${Date.now()}`
    };
    try {
      const all: FollowUpTask[] = JSON.parse(localStorage.getItem(this.followUpsKey) || '[]');
      localStorage.setItem(this.followUpsKey, JSON.stringify([newTask, ...all]));
    } catch {}
    return newTask;
  }

  // --- RECENT UPDATES ---
  public getRecentUpdates(): RecentUpdate[] {
    try {
      return JSON.parse(localStorage.getItem(this.updatesKey) || '[]');
    } catch {
      return INITIAL_RECENT_UPDATES;
    }
  }

  public addRecentUpdate(title: string, type: 'lead' | 'deal' | 'invoice' | 'call'): void {
    const newUpdate: RecentUpdate = {
      id: `RUP-${Date.now()}`,
      title,
      timeAgo: 'Just now',
      type,
      timestamp: new Date().toISOString()
    };
    try {
      const all = this.getRecentUpdates();
      localStorage.setItem(this.updatesKey, JSON.stringify([newUpdate, ...all.slice(0, 15)]));
    } catch {}
  }

  // --- ACTIVITIES ---
  public getTodayActivities(userId: string): TeamMemberActivity[] {
    try {
      const all: TeamMemberActivity[] = JSON.parse(localStorage.getItem(this.activitiesKey) || '[]');
      return all.filter(a => a.userId === userId || (!a.userId && userId === 'tm-priya'));
    } catch {
      return [];
    }
  }

  public logActivity(item: {
    userId: string;
    leadId: string;
    leadName: string;
    action: string;
    notes?: string;
    type?: TeamMemberActivity['type'];
  }): TeamMemberActivity {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = this.formatCurrentTime();

    const newAct: TeamMemberActivity = {
      id: `ACT-${Date.now()}`,
      userId: item.userId,
      leadId: item.leadId,
      leadName: item.leadName,
      action: item.action,
      time: nowTime,
      date: today,
      type: item.type || 'update',
      notes: item.notes
    };

    try {
      const all: TeamMemberActivity[] = JSON.parse(localStorage.getItem(this.activitiesKey) || '[]');
      localStorage.setItem(this.activitiesKey, JSON.stringify([newAct, ...all]));
    } catch (e) {
      console.error('Failed to log activity:', e);
    }

    return newAct;
  }

  // --- LEAD SOURCES ANALYTICS ---
  public getLeadSources(userId: string): LeadSourceStat[] {
    const leads = this.getAssignedLeads(userId);
    const total = leads.length || 1;

    const counts: Record<string, number> = {
      WhatsApp: 0,
      'Meta Ads': 0,
      Website: 0,
      Referral: 0,
      Other: 0
    };

    leads.forEach(l => {
      if (l.sourceId === 'whatsapp') counts.WhatsApp++;
      else if (l.sourceId === 'meta') counts['Meta Ads']++;
      else if (l.sourceId === 'website') counts.Website++;
      else if (l.sourceId === 'references') counts.Referral++;
      else counts.Other++;
    });

    const colors: Record<string, string> = {
      WhatsApp: '#10B981',
      'Meta Ads': '#3B82F6',
      Website: '#8B5CF6',
      Referral: '#F59E0B',
      Other: '#94A3B8'
    };

    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      percentage: Math.round((count / total) * 100),
      color: colors[name] || '#94A3B8'
    }));
  }

  // --- TARGET & STATS ---
  public getMemberTarget(userId: string): MemberTarget {
    const user = SAMPLE_TEAM_MEMBERS.find(u => u.id === userId);
    const goal = user?.targetDeals || 15;
    const current = (user?.currentDeals || 8);
    const percentage = Math.round((current / goal) * 100);

    return {
      current,
      goal,
      percentage
    };
  }

  public getDashboardKpis(userId: string) {
    const leads = this.getAssignedLeads(userId);
    const totalLeads = leads.length || 28;
    const followUps = this.getFollowUps(userId, 'upcoming');
    const overdueFollowUps = this.getFollowUps(userId, 'overdue');
    const followUpsDue = (followUps.length + overdueFollowUps.length) || 6;
    const convertedLeads = leads.filter(l => l.stage === 'Won').length + 6; // Historical + won
    const dealsInProgress = leads.filter(l => l.stage === 'Contacted' || l.stage === 'Interested' || l.stage === 'Proposal').length || 12;

    return {
      totalLeads,
      totalLeadsGrowth: '+12%',
      followUpsDue,
      followUpsGrowth: '+2%',
      convertedLeads,
      convertedGrowth: '+33%',
      dealsInProgress,
      dealsGrowth: '+9%'
    };
  }

  // --- END OF DAY REPORT ---
  public saveEndOfDayReport(report: {
    userId: string;
    userName: string;
    leadsAdvanced: number;
    salesClosed: number;
    callsMade: number;
    demosScheduled: number;
    notes?: string;
  }): EndOfDayReport {
    const today = new Date().toISOString().split('T')[0];
    const newReport: EndOfDayReport = {
      id: `EOD-${Date.now()}`,
      userId: report.userId,
      userName: report.userName,
      date: today,
      timestamp: new Date().toISOString(),
      leadsAdvanced: report.leadsAdvanced,
      salesClosed: report.salesClosed,
      callsMade: report.callsMade,
      demosScheduled: report.demosScheduled,
      notes: report.notes
    };

    try {
      const all: EndOfDayReport[] = JSON.parse(localStorage.getItem(this.reportsKey) || '[]');
      const filtered = all.filter(r => !(r.userId === report.userId && r.date === today));
      localStorage.setItem(this.reportsKey, JSON.stringify([newReport, ...filtered]));
    } catch (e) {
      console.error('Failed to save EOD report:', e);
    }

    return newReport;
  }

  public getTodayEndOfDayReport(userId: string): EndOfDayReport | null {
    try {
      const today = new Date().toISOString().split('T')[0];
      const all: EndOfDayReport[] = JSON.parse(localStorage.getItem(this.reportsKey) || '[]');
      return all.find(r => r.userId === userId && r.date === today) || null;
    } catch {
      return null;
    }
  }

  // --- CUSTOMERS ---
  // Customers live in Supabase (see src/hooks/useCustomers.ts). The legacy
  // browser copy is only read once for import (src/lib/legacyStorage.ts).

  // TODO(db-migration): invoices, leads, deals, follow-ups, events and reports
  // below are still browser-local and move to Supabase in the next phase.
  // --- INVOICES ---
  public getInvoices(userId?: string): Invoice[] {
    try {
      const stored = localStorage.getItem(this.invoicesKey);
      let list: Invoice[] = [];
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Normalize legacy entries in storage to assign ownership
          list = parsed.map((inv: any) => {
            if (!inv.userId && !inv.teamMemberId) {
              if (inv.invoiceNumber === 'WAB-SLS-2026-101' || inv.invoiceNumber === 'DGT-SLS-2026-104') {
                return { ...inv, userId: 'tm-priya', teamMemberId: 'tm-priya', teamMemberName: 'Priya Nair', teamMemberRole: 'Sales Executive' };
              }
              if (inv.invoiceNumber === 'WBX-SLS-2026-102' || inv.invoiceNumber === 'MPL-SLS-2026-105') {
                return { ...inv, userId: 'tm-rahul', teamMemberId: 'tm-rahul', teamMemberName: 'Rahul Kumar', teamMemberRole: 'Sales Executive' };
              }
              if (inv.invoiceNumber === 'DTK-SLS-2026-103' || inv.invoiceNumber === 'WBS-SLS-2026-106') {
                return { ...inv, userId: 'tm-amit', teamMemberId: 'tm-amit', teamMemberName: 'Amit Patel', teamMemberRole: 'Senior Sales Specialist' };
              }
              if (inv.teamMemberName?.toLowerCase().includes('rahul')) {
                return { ...inv, userId: 'tm-rahul', teamMemberId: 'tm-rahul' };
              }
              if (inv.teamMemberName?.toLowerCase().includes('amit')) {
                return { ...inv, userId: 'tm-amit', teamMemberId: 'tm-amit' };
              }
              return { ...inv, userId: 'tm-priya', teamMemberId: 'tm-priya', teamMemberName: inv.teamMemberName || 'Priya Nair' };
            }
            return inv;
          }).filter(inv =>
            !inv.departmentId?.includes('education') &&
            !inv.departmentId?.includes('hr') &&
            !inv.departmentId?.includes('amuwa')
          );
        }
      }
      if (list.length === 0) {
        list = INITIAL_INVOICES;
        localStorage.setItem(this.invoicesKey, JSON.stringify(INITIAL_INVOICES));
      }

      // Isolate strictly by team member ID when querying for a team member
      if (userId && userId !== 'all' && userId !== 'admin' && userId !== 'superadmin' && userId !== 'accounts-head') {
        return list.filter(inv => inv.userId === userId || inv.teamMemberId === userId);
      }

      // Superadmin / Central Accounts Head / System View queries see all invoices
      return list;
    } catch {
      if (userId && userId !== 'all' && userId !== 'admin' && userId !== 'superadmin' && userId !== 'accounts-head') {
        return INITIAL_INVOICES.filter(inv => inv.userId === userId || inv.teamMemberId === userId);
      }
      return INITIAL_INVOICES;
    }
  }

  public addInvoice(invoice: Omit<Invoice, 'id'>): Invoice {
    const newInv: Invoice = {
      ...invoice,
      id: `INV-${Date.now()}`
    };
    try {
      // Read directly from storage without user filtering to preserve all team members' data
      const stored = localStorage.getItem(this.invoicesKey);
      let all: Invoice[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) all = parsed;
        } catch {}
      }
      if (all.length === 0) all = [...INITIAL_INVOICES];
      
      const updated = [newInv, ...all];
      localStorage.setItem(this.invoicesKey, JSON.stringify(updated));

      // Global notification event for reactive UI updates across open views
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('amuwa_crm_invoice_created', { detail: newInv }));
      }
    } catch (e) {
      console.error('Failed to add invoice in teamMemberStore:', e);
    }
    return newInv;
  }

  // --- CALENDAR EVENTS ---
  public getCalendarEvents(userId?: string): CalendarEvent[] {
    try {
      const all: CalendarEvent[] = JSON.parse(localStorage.getItem(this.eventsKey) || '[]');
      if (userId && userId !== 'all' && userId !== 'admin' && userId !== 'superadmin') {
        return all.filter(e => !e.userId || e.userId === userId);
      }
      return all;
    } catch {
      return INITIAL_CALENDAR_EVENTS;
    }
  }

  public addCalendarEvent(event: Omit<CalendarEvent, 'id'>): CalendarEvent {
    const newEvt: CalendarEvent = {
      ...event,
      id: `EVT-${Date.now()}`
    };
    try {
      const raw = localStorage.getItem(this.eventsKey);
      const all: CalendarEvent[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(this.eventsKey, JSON.stringify([...all, newEvt]));
    } catch {}
    return newEvt;
  }

  // --- DEALS ---
  public getDeals(userId?: string): Deal[] {
    try {
      const all: Deal[] = JSON.parse(localStorage.getItem(this.dealsKey) || '[]');
      if (userId && userId !== 'all' && userId !== 'admin' && userId !== 'superadmin') {
        return all.filter(d => !d.userId || d.userId === userId);
      }
      return all;
    } catch {
      return INITIAL_DEALS_CRM;
    }
  }

  public addDeal(deal: Omit<Deal, 'id' | 'createdAt'>): Deal {
    const newDeal: Deal = {
      ...deal,
      id: `DL-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    try {
      const raw = localStorage.getItem(this.dealsKey);
      const all: Deal[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(this.dealsKey, JSON.stringify([newDeal, ...all]));
    } catch {}
    return newDeal;
  }

  public updateDealStage(dealId: string, newStage: Deal['stage']): boolean {
    try {
      const all = this.getDeals();
      const updated = all.map(d => (d.id === dealId ? { ...d, stage: newStage } : d));
      localStorage.setItem(this.dealsKey, JSON.stringify(updated));
      return true;
    } catch {
      return false;
    }
  }

  private formatCurrentTime(): string {
    const d = new Date();
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
  }
}

export const teamMemberStore = new TeamMemberStore();

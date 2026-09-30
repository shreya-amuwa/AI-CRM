import {
  TeamLeadUser,
  TeamRepPerformance,
  UnassignedLead,
  EodSubmissionItem,
  TeamDealItem
} from '../types/crm';

export const SAMPLE_TEAM_LEAD: TeamLeadUser = {
  id: 'tl-vikram',
  name: 'Vikram Deshmukh',
  email: 'lead@amuwa.com',
  role: 'team-lead',
  title: 'Sales Team Lead',
  podName: 'WabaStore Sales Pod Alpha',
  departmentId: 'wabastore',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  teamMemberIds: ['tm-priya', 'tm-rahul', 'tm-amit', 'tm-sneha', 'tm-rohan']
};

export const INITIAL_POD_REPS: TeamRepPerformance[] = [
  {
    id: 'tm-priya',
    name: 'Priya Nair',
    email: 'priya@amuwa.com',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    status: 'Available',
    activeLeads: 28,
    callsToday: 18,
    demosToday: 4,
    wonDealsMonth: 8,
    revenueClosed: 620000,
    targetRevenue: 750000,
    quotaPercent: 82.7,
    capacityMax: 35,
    pendingTasks: 4,
    overdueTasks: 0,
    conversionRate: 28.5
  },
  {
    id: 'tm-rahul',
    name: 'Rahul Kumar',
    email: 'rahul@amuwa.com',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    status: 'On Call',
    activeLeads: 21,
    callsToday: 14,
    demosToday: 3,
    wonDealsMonth: 6,
    revenueClosed: 540000,
    targetRevenue: 650000,
    quotaPercent: 83.0,
    capacityMax: 30,
    pendingTasks: 3,
    overdueTasks: 1,
    conversionRate: 24.0
  },
  {
    id: 'tm-amit',
    name: 'Amit Patel',
    email: 'amit@amuwa.com',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
    status: 'In Demo',
    activeLeads: 24,
    callsToday: 16,
    demosToday: 4,
    wonDealsMonth: 7,
    revenueClosed: 690000,
    targetRevenue: 800000,
    quotaPercent: 86.2,
    capacityMax: 35,
    pendingTasks: 5,
    overdueTasks: 0,
    conversionRate: 29.1
  },
  {
    id: 'tm-sneha',
    name: 'Sneha Deshmukh',
    email: 'sneha.d@amuwa.com',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    status: 'Available',
    activeLeads: 16,
    callsToday: 12,
    demosToday: 2,
    wonDealsMonth: 5,
    revenueClosed: 510000,
    targetRevenue: 650000,
    quotaPercent: 78.4,
    capacityMax: 25,
    pendingTasks: 2,
    overdueTasks: 2,
    conversionRate: 22.0
  },
  {
    id: 'tm-rohan',
    name: 'Rohan Varma',
    email: 'rohan.v@amuwa.com',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    status: 'Offline',
    activeLeads: 14,
    callsToday: 9,
    demosToday: 1,
    wonDealsMonth: 4,
    revenueClosed: 485000,
    targetRevenue: 650000,
    quotaPercent: 74.6,
    capacityMax: 25,
    pendingTasks: 2,
    overdueTasks: 1,
    conversionRate: 21.5
  }
];

export const INITIAL_UNASSIGNED_LEADS: UnassignedLead[] = [];

export const INITIAL_TEAM_DEALS: TeamDealItem[] = [];

export const INITIAL_EOD_SUBMISSIONS: EodSubmissionItem[] = [];

class TeamLeadStore {
  private reps: TeamRepPerformance[] = INITIAL_POD_REPS;
  private unassignedLeads: UnassignedLead[] = INITIAL_UNASSIGNED_LEADS;
  private teamDeals: TeamDealItem[] = INITIAL_TEAM_DEALS;
  private eodSubmissions: EodSubmissionItem[] = INITIAL_EOD_SUBMISSIONS;
  private podTarget: number = 3500000; // ₹35 Lakhs monthly quota

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const savedReps = localStorage.getItem('tl_reps_data');
      if (savedReps) this.reps = JSON.parse(savedReps);

      const savedLeads = localStorage.getItem('tl_unassigned_leads');
      if (savedLeads) this.unassignedLeads = JSON.parse(savedLeads);

      const savedDeals = localStorage.getItem('tl_team_deals');
      if (savedDeals) this.teamDeals = JSON.parse(savedDeals);

      const savedEods = localStorage.getItem('tl_eod_submissions');
      if (savedEods) this.eodSubmissions = JSON.parse(savedEods);

      const savedTarget = localStorage.getItem('tl_pod_target');
      if (savedTarget) this.podTarget = Number(savedTarget);
    } catch (e) {
      console.warn('Could not load team lead data from localStorage', e);
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem('tl_reps_data', JSON.stringify(this.reps));
      localStorage.setItem('tl_unassigned_leads', JSON.stringify(this.unassignedLeads));
      localStorage.setItem('tl_team_deals', JSON.stringify(this.teamDeals));
      localStorage.setItem('tl_eod_submissions', JSON.stringify(this.eodSubmissions));
      localStorage.setItem('tl_pod_target', String(this.podTarget));
    } catch (e) {
      console.warn('Could not persist team lead data', e);
    }
  }

  // --- GETTERS ---
  public getReps(): TeamRepPerformance[] {
    return [...this.reps];
  }

  public getUnassignedLeads(): UnassignedLead[] {
    return [...this.unassignedLeads];
  }

  public getTeamDeals(): TeamDealItem[] {
    return [...this.teamDeals];
  }

  public getEodSubmissions(): EodSubmissionItem[] {
    return [...this.eodSubmissions];
  }

  public getPodTarget(): number {
    return this.podTarget;
  }

  public getPodKpis() {
    const totalRevenueClosed = this.reps.reduce((sum, r) => sum + r.revenueClosed, 0);
    const totalActiveLeads = this.reps.reduce((sum, r) => sum + r.activeLeads, 0);
    const totalCallsToday = this.reps.reduce((sum, r) => sum + r.callsToday, 0);
    const totalDemosToday = this.reps.reduce((sum, r) => sum + r.demosToday, 0);
    const totalWonDeals = this.reps.reduce((sum, r) => sum + r.wonDealsMonth, 0);
    const targetPercent = Math.round((totalRevenueClosed / this.podTarget) * 100);
    const avgConversion = (
      this.reps.reduce((sum, r) => sum + r.conversionRate, 0) / this.reps.length
    ).toFixed(1);
    const pendingEods = this.eodSubmissions.filter(e => e.status === 'Submitted').length;
    const overdueTotal = this.reps.reduce((sum, r) => sum + r.overdueTasks, 0);

    return {
      podTarget: this.podTarget,
      totalRevenueClosed,
      targetPercent,
      totalActiveLeads,
      totalCallsToday,
      totalDemosToday,
      totalWonDeals,
      avgConversion: Number(avgConversion),
      unassignedCount: this.unassignedLeads.length,
      pendingEods,
      overdueTotal,
      activeRepsCount: this.reps.filter(r => r.status !== 'Offline').length,
      totalRepsCount: this.reps.length
    };
  }

  // --- ACTIONS ---

  // 1. Assign single lead to a rep
  public assignLeadToRep(leadId: string, repId: string, notes?: string): boolean {
    const leadIndex = this.unassignedLeads.findIndex(l => l.id === leadId);
    if (leadIndex === -1) return false;

    const repIndex = this.reps.findIndex(r => r.id === repId);
    if (repIndex === -1) return false;

    const lead = this.unassignedLeads[leadIndex];
    this.unassignedLeads.splice(leadIndex, 1);

    // Update rep load
    this.reps[repIndex].activeLeads += 1;
    this.reps[repIndex].pendingTasks += 1;

    // Create a new Deal item for tracking
    const newDeal: TeamDealItem = {
      id: `TDL-${Date.now().toString().slice(-4)}`,
      dealName: `${lead.company} - ${lead.interest.slice(0, 30)}`,
      company: lead.company,
      clientContact: lead.phone,
      assignedRepId: this.reps[repIndex].id,
      assignedRepName: this.reps[repIndex].name,
      value: lead.estimatedValue,
      stage: 'New Lead',
      probability: 20,
      expectedClose: 'Oct 20, 2026',
      notes: notes || `Distributed from unassigned queue by Team Lead.`
    };
    this.teamDeals.unshift(newDeal);

    this.saveToStorage();
    return true;
  }

  // 2. Auto Round-Robin Distribute All Unassigned Leads
  public autoRoundRobinDistribute(): { distributedCount: number; summary: Record<string, number> } {
    if (this.unassignedLeads.length === 0) {
      return { distributedCount: 0, summary: {} };
    }

    const availableReps = this.reps.filter(r => r.status !== 'Offline');
    const targetReps = availableReps.length > 0 ? availableReps : this.reps;
    let repIdx = 0;
    const summary: Record<string, number> = {};
    const count = this.unassignedLeads.length;

    while (this.unassignedLeads.length > 0) {
      const lead = this.unassignedLeads.shift()!;
      const rep = targetReps[repIdx % targetReps.length];

      // Update rep
      const storeRep = this.reps.find(r => r.id === rep.id);
      if (storeRep) {
        storeRep.activeLeads += 1;
        storeRep.pendingTasks += 1;
      }

      summary[rep.name] = (summary[rep.name] || 0) + 1;

      // Add to deals
      this.teamDeals.unshift({
        id: `TDL-${Date.now().toString().slice(-4)}-${repIdx}`,
        dealName: `${lead.company} - ${lead.interest.slice(0, 30)}`,
        company: lead.company,
        clientContact: lead.phone,
        assignedRepId: rep.id,
        assignedRepName: rep.name,
        value: lead.estimatedValue,
        stage: 'New Lead',
        probability: 20,
        expectedClose: 'Oct 20, 2026',
        notes: `Auto Round-Robin assignment by Team Lead.`
      });

      repIdx++;
    }

    this.saveToStorage();
    return { distributedCount: count, summary };
  }

  // 3. Reassign Lead / Deal from one rep to another
  public reassignDeal(dealId: string, toRepId: string): boolean {
    const deal = this.teamDeals.find(d => d.id === dealId);
    const toRep = this.reps.find(r => r.id === toRepId);
    if (!deal || !toRep) return false;

    const fromRep = this.reps.find(r => r.id === deal.assignedRepId);
    if (fromRep && fromRep.activeLeads > 0) {
      fromRep.activeLeads -= 1;
    }

    toRep.activeLeads += 1;
    deal.assignedRepId = toRep.id;
    deal.assignedRepName = toRep.name;
    deal.leadReviewNote = `Reassigned to ${toRep.name} on ${new Date().toLocaleDateString()}`;

    this.saveToStorage();
    return true;
  }

  // 4. Review EOD Report with managerial feedback
  public reviewEodSubmission(eodId: string, feedback: string): boolean {
    const eod = this.eodSubmissions.find(e => e.id === eodId);
    if (!eod) return false;

    eod.status = 'Reviewed';
    eod.leadFeedback = feedback;
    this.saveToStorage();
    return true;
  }

  // 5. Approve Discount Request
  public approveDiscountRequest(dealId: string): boolean {
    const deal = this.teamDeals.find(d => d.id === dealId);
    if (!deal) return false;

    deal.isDiscountApproved = true;
    deal.requiresDiscountApproval = false;
    deal.leadReviewNote = `Approved ${deal.discountRequested}% discount exception by Team Lead Vikram.`;
    this.saveToStorage();
    return true;
  }

  // 6. Update Pod Target
  public updatePodTarget(newTarget: number) {
    this.podTarget = newTarget;
    this.saveToStorage();
  }

  // 7. Update Rep Status
  public updateRepStatus(repId: string, status: 'Available' | 'On Call' | 'In Demo' | 'Offline') {
    const rep = this.reps.find(r => r.id === repId);
    if (rep) {
      rep.status = status;
      this.saveToStorage();
    }
  }

  // 8. Add new incoming lead to test real-time intake
  public simulateIncomingLead(lead: Partial<UnassignedLead>) {
    const newLead: UnassignedLead = {
      id: `ULD-${Date.now().toString().slice(-4)}`,
      name: lead.name || 'Prakash Sharma',
      company: lead.company || 'Sharma Global Exports',
      phone: lead.phone || '+91 98112 34567',
      email: lead.email || 'prakash@sharmaglobal.in',
      source: lead.source || 'WhatsApp',
      interest: lead.interest || 'Bulk WhatsApp Messaging API and CRM sync',
      estimatedValue: lead.estimatedValue || 65000,
      receivedAt: 'Just now',
      priority: lead.priority || 'High',
      city: lead.city || 'Mumbai'
    };
    this.unassignedLeads.unshift(newLead);
    this.saveToStorage();
    return newLead;
  }
}

export const teamLeadStore = new TeamLeadStore();

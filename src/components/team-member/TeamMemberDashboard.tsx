import React, { useState, useEffect } from 'react';
import {
  Users,
  Clock,
  CheckCircle2,
  TrendingUp,
  Calendar,
  X,
  Plus,
  Phone,
  MessageSquare,
  Handshake,
  Send,
  Sparkles,
  AlertCircle,
  Building2,
  Mail,
  Check,
  Bell,
  Search,
  FileText,
  Activity
} from 'lucide-react';
import { Lead, TeamMemberActivity, EndOfDayReport, FollowUpTask, Deal } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';
import { useAuth } from '../../context/AuthContext';
import { TeamMemberLayout, TeamMemberNav } from './TeamMemberLayout';
import { MemberPipelineRows } from './MemberPipelineRows';
import { MemberAnalyticsWidgets } from './MemberAnalyticsWidgets';
import { MemberFollowUpsTable } from './MemberFollowUpsTable';
import { MemberRightSidebar } from './MemberRightSidebar';
import { MemberCustomersDashboard } from './MemberCustomersDashboard';
import { MemberDealsDashboard } from './MemberDealsDashboard';
import { MemberCalendarDashboard } from './MemberCalendarDashboard';
import { MemberInvoicesDashboard } from './MemberInvoicesDashboard';
import { MemberReportsDashboard } from './MemberReportsDashboard';
import { MemberSettingsDashboard } from './MemberSettingsDashboard';
import { FieldVisitTrackerView } from '../common/FieldVisitTrackerView';

interface TeamMemberDashboardProps {
  currentUserId: string;
  userName: string;
}

export const TeamMemberDashboard: React.FC<TeamMemberDashboardProps> = ({
  currentUserId,
  userName
}) => {
  const { profile } = useAuth();
  // Navigation State: 'home' is default, or 'leads'
  const [activeNav, setActiveNav] = useState<TeamMemberNav>('home');
  const [globalSearch, setGlobalSearch] = useState('');

  // Store state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<TeamMemberActivity[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [kpis, setKpis] = useState({
    totalLeads: 28,
    totalLeadsGrowth: '+12%',
    followUpsDue: 6,
    followUpsGrowth: '+2%',
    convertedLeads: 8,
    convertedGrowth: '+33%',
    dealsInProgress: 12,
    dealsGrowth: '+9%'
  });
  const [target, setTarget] = useState({ current: 8, goal: 15, percentage: 53 });
  const [eodReport, setEodReport] = useState<EndOfDayReport | null>(null);

  // Date Range state
  const [dateRange, setDateRange] = useState('Sep 1, 2026 – Sep 30, 2026');

  // Modals & Forms
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionModalType, setActionModalType] = useState<
    'call' | 'message' | 'demo' | 'update' | 'addLead' | 'createDeal' | 'leadDetail' | null
  >(null);

  // Form states
  const [callNotes, setCallNotes] = useState('');
  const [customMessage, setCustomMessage] = useState('Hello, I am reaching out from Wabastore regarding your inquiry.');
  const [demoDate, setDemoDate] = useState('2026-09-30');
  const [demoTime, setDemoTime] = useState('03:00 PM');
  const [selectedStage, setSelectedStage] = useState<Lead['stage']>('Contacted');
  const [updateNotes, setUpdateNotes] = useState('');

  // New Lead form
  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    contact: '',
    email: '',
    company: '',
    priority: 'Medium' as 'High' | 'Medium' | 'Low',
    stage: 'New' as Lead['stage'],
    dealValue: 35000,
    notes: ''
  });

  // Create Deal form
  const [dealForm, setDealForm] = useState({
    leadId: '',
    company: '',
    value: 50000,
    stage: 'Proposal' as 'Proposal' | 'Negotiation' | 'Won',
    expectedClose: '2026-10-15'
  });

  // End of Day Modal
  const [isEodModalOpen, setIsEodModalOpen] = useState(false);
  const [eodNotes, setEodNotes] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Refresh all dashboard data
  const refreshData = () => {
    const assigned = teamMemberStore.getAssignedLeads(currentUserId);
    const acts = teamMemberStore.getTodayActivities(currentUserId);
    const tasks = teamMemberStore.getFollowUps(currentUserId);
    const updates = teamMemberStore.getRecentUpdates();
    const dashboardKpis = teamMemberStore.getDashboardKpis(currentUserId);
    const memberTarget = teamMemberStore.getMemberTarget(currentUserId);
    const eod = teamMemberStore.getTodayEndOfDayReport(currentUserId);

    setLeads(assigned);
    setActivities(acts);
    setFollowUps(tasks);
    setRecentUpdates(updates);
    setKpis(dashboardKpis);
    setTarget(memberTarget);
    setEodReport(eod);
  };

  useEffect(() => {
    refreshData();
  }, [currentUserId]);

  // Dynamic Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    const firstName = userName.split(' ')[0] || 'Priya';
    if (hour < 12) return `Good Morning, ${firstName} ☀️`;
    if (hour < 17) return `Good Afternoon, ${firstName} 🌤️`;
    return `Good Evening, ${firstName} 🌙`;
  };

  // Profile avatar
  const avatarUrl =
    profile?.avatarUrl ||
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80';

  // --- ACTIONS ---
  const handleConfirmCall = () => {
    if (!selectedLead) return;
    teamMemberStore.logActivity({
      userId: currentUserId,
      leadId: selectedLead.id,
      leadName: selectedLead.name,
      action: `Call with ${selectedLead.company || selectedLead.name}`,
      notes: callNotes || 'Phone conversation completed.',
      type: 'call'
    });
    showToast(`Call logged for ${selectedLead.name}`);
    setActionModalType(null);
    setCallNotes('');
    refreshData();
  };

  const handleConfirmMessage = () => {
    if (!selectedLead) return;
    const cleanPhone = selectedLead.contact.replace(/[^\d]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(customMessage)}`;
    window.open(waUrl, '_blank');

    teamMemberStore.logActivity({
      userId: currentUserId,
      leadId: selectedLead.id,
      leadName: selectedLead.name,
      action: `WhatsApp sent to ${selectedLead.company || selectedLead.name}`,
      notes: customMessage,
      type: 'message'
    });

    showToast(`WhatsApp message logged for ${selectedLead.name}`);
    setActionModalType(null);
    refreshData();
  };

  const handleConfirmScheduleDemo = () => {
    if (!selectedLead) return;
    teamMemberStore.updateLeadStage(selectedLead.id, currentUserId, 'Interested', `Demo scheduled on ${demoDate} at ${demoTime}`);
    teamMemberStore.logActivity({
      userId: currentUserId,
      leadId: selectedLead.id,
      leadName: selectedLead.name,
      action: `Demo scheduled: ${selectedLead.company || selectedLead.name}`,
      notes: `Scheduled for ${demoDate} at ${demoTime}`,
      type: 'demo'
    });
    teamMemberStore.addFollowUp({
      userId: currentUserId,
      leadId: selectedLead.id,
      leadName: selectedLead.name,
      company: selectedLead.company || 'Client',
      type: 'Meeting',
      dateTimeStr: `${demoDate} • ${demoTime}`,
      notes: 'Live product walkthrough & commercial review',
      status: 'upcoming'
    });
    showToast(`Demo scheduled with ${selectedLead.name}`);
    setActionModalType(null);
    refreshData();
  };

  const handleConfirmUpdateStage = () => {
    if (!selectedLead) return;
    teamMemberStore.updateLeadStage(selectedLead.id, currentUserId, selectedStage, updateNotes);
    showToast(`Lead stage updated to ${selectedStage}`);
    setActionModalType(null);
    setUpdateNotes('');
    refreshData();
  };

  const handleCreateNewLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadForm.name.trim() || !newLeadForm.contact.trim()) {
      alert('Please provide name and phone number');
      return;
    }

    teamMemberStore.addLead({
      name: newLeadForm.name,
      contact: newLeadForm.contact,
      email: newLeadForm.email,
      company: newLeadForm.company,
      priority: newLeadForm.priority,
      stage: newLeadForm.stage,
      dealValue: Number(newLeadForm.dealValue),
      notes: newLeadForm.notes,
      assignedTo: currentUserId
    });

    showToast(`New lead added: ${newLeadForm.name}`);
    setActionModalType(null);
    setNewLeadForm({
      name: '',
      contact: '',
      email: '',
      company: '',
      priority: 'Medium',
      stage: 'New',
      dealValue: 35000,
      notes: ''
    });
    refreshData();
  };

  const handleCreateDealSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetLead = leads.find(l => l.id === dealForm.leadId) || leads[0];
    if (targetLead) {
      teamMemberStore.updateLeadStage(targetLead.id, currentUserId, dealForm.stage, `Deal created: ₹${dealForm.value.toLocaleString('en-IN')}`);
      teamMemberStore.logActivity({
        userId: currentUserId,
        leadId: targetLead.id,
        leadName: targetLead.name,
        action: `Deal created – ${targetLead.company || targetLead.name} (₹${dealForm.value.toLocaleString('en-IN')})`,
        type: 'stage'
      });
    }
    showToast('New deal created successfully!');
    setActionModalType(null);
    refreshData();
  };

  const handleSubmitEndOfDay = () => {
    const todayActs = teamMemberStore.getTodayActivities(currentUserId);
    const callsMade = todayActs.filter(a => a.type === 'call' || a.action.toLowerCase().includes('call')).length;
    const demosScheduled = todayActs.filter(a => a.type === 'demo' || a.action.toLowerCase().includes('demo')).length;
    const leadsAdvanced = todayActs.filter(a => a.type === 'stage' || a.action.toLowerCase().includes('stage')).length;
    const salesClosed = leads.filter(l => l.stage === 'Won').length;

    const saved = teamMemberStore.saveEndOfDayReport({
      userId: currentUserId,
      userName,
      leadsAdvanced,
      salesClosed,
      callsMade,
      demosScheduled,
      notes: eodNotes
    });

    setEodReport(saved);
    setIsEodModalOpen(false);
    showToast(`Great work today, ${userName.split(' ')[0]}! Day completed.`);
  };

  const leadSources = teamMemberStore.getLeadSources(currentUserId);

  return (
    <TeamMemberLayout
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      searchQuery={globalSearch}
      onSearchChange={setGlobalSearch}
    >
      <div className="space-y-6 max-w-7xl mx-auto pb-10">
        {/* TOAST NOTIFICATION */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 1: HOME SECTION (PIPELINE EMPTIED, LEAD SOURCE, CONVERSION RATE, NEW UPDATES) */}
        {/* ========================================================================= */}
        {activeNav === 'home' && (
          <div className="space-y-6">
            {/* HERO GREETING & DATE RANGE */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
                  {getGreeting()}
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Welcome to your command center. Here's your overview, lead acquisition sources, and conversion progress.
                </p>
              </div>

              {/* Date Filter Dropdown */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{dateRange}</span>
                  <svg className="w-3.5 h-3.5 text-slate-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* TOP 4 METRIC KPI CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Total Leads</span>
                  <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
                    {kpis.totalLeads}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{kpis.totalLeadsGrowth} vs. last 7 days</span>
                  </div>
                </div>
                <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Follow-ups Due</span>
                  <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
                    {kpis.followUpsDue}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{kpis.followUpsGrowth} vs. last 7 days</span>
                  </div>
                </div>
                <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Converted Leads</span>
                  <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
                    {kpis.convertedLeads}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{kpis.convertedGrowth} vs. last 7 days</span>
                  </div>
                </div>
                <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Deals in Progress</span>
                  <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
                    {kpis.dealsInProgress}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{kpis.dealsGrowth} vs. last 7 days</span>
                  </div>
                </div>
                <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* MAIN HOME GRID: LEAD SOURCE, CONVERSION RATE & NEW UPDATES ON HOME SECTION */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* LEFT & CENTER HOME CONTENT (8 cols) */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* 1. LEAD SOURCE & CONVERSION RATE CARDS */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <MemberAnalyticsWidgets
                    leadSources={leadSources}
                    conversionRate={28}
                    conversionChange="+6%"
                    convertedCount={8}
                    totalLeads={leads.length || 28}
                  />

                  {/* 2. RECENT / NEW UPDATES PANEL ON HOME SECTION */}
                  <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                            <Activity className="w-4 h-4" />
                          </div>
                          <h3 className="text-xs font-bold font-heading text-slate-900">New Updates</h3>
                        </div>
                        <span className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">
                          View All
                        </span>
                      </div>

                      <div className="space-y-3.5">
                        {recentUpdates.map((update) => (
                          <div key={update.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                              {update.type === 'lead' ? '🎯' : update.type === 'deal' ? '🤝' : '📄'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-slate-800 leading-tight">
                                {update.title}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-1">
                                {update.timeAgo}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Live webhook synchronization</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Connected
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. TASKS & FOLLOW-UPS PREVIEW */}
                <div className="pt-2">
                  <MemberFollowUpsTable
                    followUps={followUps}
                    onCall={(task) => {
                      const lead = leads.find(l => l.id === task.leadId) || {
                        id: task.leadId,
                        name: task.leadName,
                        company: task.company,
                        contact: '+91 98765 00000',
                        sourceId: 'whatsapp' as any,
                        departmentId: 'wabastore',
                        assignedTo: currentUserId,
                        receivedAt: new Date().toISOString(),
                        status: 'Verified' as any,
                        rawPayload: {}
                      };
                      setSelectedLead(lead);
                      setActionModalType('call');
                    }}
                    onOpenMessage={(task) => {
                      const lead = leads.find(l => l.id === task.leadId) || {
                        id: task.leadId,
                        name: task.leadName,
                        company: task.company,
                        contact: '+91 98765 00000',
                        sourceId: 'whatsapp' as any,
                        departmentId: 'wabastore',
                        assignedTo: currentUserId,
                        receivedAt: new Date().toISOString(),
                        status: 'Verified' as any,
                        rawPayload: {}
                      };
                      setSelectedLead(lead);
                      setActionModalType('message');
                    }}
                    onViewDetails={(task) => {
                      alert(`Follow-up Details:\n${task.leadName} (${task.company})\nTime: ${task.dateTimeStr}\nNotes: ${task.notes}`);
                    }}
                    onToggleComplete={(taskId) => {
                      teamMemberStore.toggleFollowUpStatus(taskId);
                      refreshData();
                      showToast('Follow-up status updated');
                    }}
                  />
                </div>
              </div>

              {/* RIGHT SIDEBAR ON HOME (4 cols) */}
              <div className="lg:col-span-4">
                <MemberRightSidebar
                  userName={userName}
                  userRole="Sales Executive"
                  avatarUrl={avatarUrl}
                  target={target}
                  activities={activities}
                  recentUpdates={recentUpdates}
                  onAddLead={() => setActionModalType('addLead')}
                  onLogCall={() => {
                    if (leads.length > 0) {
                      setSelectedLead(leads[0]);
                      setActionModalType('call');
                    } else {
                      alert('No leads available to call.');
                    }
                  }}
                  onSendWhatsApp={() => {
                    if (leads.length > 0) {
                      setSelectedLead(leads[0]);
                      setActionModalType('message');
                    } else {
                      alert('No leads available to message.');
                    }
                  }}
                  onCreateDeal={() => {
                    if (leads.length > 0) {
                      setDealForm(prev => ({ ...prev, leadId: leads[0].id, company: leads[0].company || '' }));
                    }
                    setActionModalType('createDeal');
                  }}
                  onOpenEndOfDay={() => setIsEodModalOpen(true)}
                  isDayCompleted={!!eodReport}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: MY LEADS SECTION (MY LEADS PIPELINE IN ROW MANNER) */}
        {/* ========================================================================= */}
        {activeNav === 'leads' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
                  My Leads
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Full pipeline view displaying your assigned leads in organized row format.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActionModalType('addLead')}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Lead</span>
              </button>
            </div>

            {/* PIPELINE IN ROW MANNER */}
            <MemberPipelineRows
              leads={leads}
              onSelectLead={(lead) => {
                setSelectedLead(lead);
                setActionModalType('leadDetail');
              }}
              onAdvanceStage={(leadId, nextStage) => {
                teamMemberStore.updateLeadStage(leadId, currentUserId, nextStage);
                showToast(`Moved lead to ${nextStage}`);
                refreshData();
              }}
              onCallLead={(lead) => {
                setSelectedLead(lead);
                setActionModalType('call');
              }}
              onMessageLead={(lead) => {
                setSelectedLead(lead);
                setActionModalType('message');
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW: FIELD VISITS (LIVE GPS TRACKING) */}
        {/* ========================================================================= */}
        {activeNav === 'field-visits' && (
          <FieldVisitTrackerView
            viewerRole="team-member"
            currentUserId={currentUserId}
            userName={userName}
          />
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: TASKS & FOLLOW-UPS FULL VIEW */}
        {/* ========================================================================= */}
        {activeNav === 'tasks' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
                  Tasks & Follow-ups
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Track your scheduled calls, WhatsApp messages, meetings, and overdue reminders.
                </p>
              </div>
            </div>

            <MemberFollowUpsTable
              followUps={followUps}
              onCall={(task) => {
                const lead = leads.find(l => l.id === task.leadId) || {
                  id: task.leadId,
                  name: task.leadName,
                  company: task.company,
                  contact: '+91 98765 00000',
                  sourceId: 'whatsapp' as any,
                  departmentId: 'wabastore',
                  assignedTo: currentUserId,
                  receivedAt: new Date().toISOString(),
                  status: 'Verified' as any,
                  rawPayload: {}
                };
                setSelectedLead(lead);
                setActionModalType('call');
              }}
              onOpenMessage={(task) => {
                const lead = leads.find(l => l.id === task.leadId) || {
                  id: task.leadId,
                  name: task.leadName,
                  company: task.company,
                  contact: '+91 98765 00000',
                  sourceId: 'whatsapp' as any,
                  departmentId: 'wabastore',
                  assignedTo: currentUserId,
                  receivedAt: new Date().toISOString(),
                  status: 'Verified' as any,
                  rawPayload: {}
                };
                setSelectedLead(lead);
                setActionModalType('message');
              }}
              onViewDetails={(task) => {
                alert(`Follow-up Details:\n${task.leadName} (${task.company})\nTime: ${task.dateTimeStr}\nNotes: ${task.notes}`);
              }}
              onToggleComplete={(taskId) => {
                teamMemberStore.toggleFollowUpStatus(taskId);
                refreshData();
                showToast('Follow-up status updated');
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 4: CUSTOMERS DASHBOARD (matches uploaded UI) */}
        {/* ========================================================================= */}
        {activeNav === 'customers' && (
          <MemberCustomersDashboard
            currentUserId={currentUserId}
            onSendWhatsApp={(phone) => {
              const clean = phone.replace(/[^\d]/g, '');
              window.open(`https://wa.me/${clean}`, '_blank');
            }}
            onCreateInvoice={() => setActiveNav('invoices')}
          />
        )}

        {/* ========================================================================= */}
        {/* VIEW 5: DEALS WORKSPACE */}
        {/* ========================================================================= */}
        {activeNav === 'deals' && (
          <MemberDealsDashboard currentUserId={currentUserId} />
        )}

        {/* ========================================================================= */}
        {/* VIEW 6: CALENDAR */}
        {/* ========================================================================= */}
        {activeNav === 'calendar' && (
          <MemberCalendarDashboard currentUserId={currentUserId} />
        )}

        {/* ========================================================================= */}
        {/* VIEW 7: INVOICES & BILLING */}
        {/* ========================================================================= */}
        {activeNav === 'invoices' && (
          <MemberInvoicesDashboard currentUserId={currentUserId} />
        )}

        {/* ========================================================================= */}
        {/* VIEW 8: PERFORMANCE REPORTS */}
        {/* ========================================================================= */}
        {activeNav === 'reports' && (
          <MemberReportsDashboard currentUserId={currentUserId} />
        )}

        {/* ========================================================================= */}
        {/* VIEW 9: SETTINGS & TARGETS */}
        {/* ========================================================================= */}
        {activeNav === 'settings' && (
          <MemberSettingsDashboard
            currentUserId={currentUserId}
            userName={userName}
          />
        )}

        {/* ========================================================================= */}
        {/* MODALS */}
        {/* ========================================================================= */}

        {/* 1. ADD LEAD MODAL */}
        {actionModalType === 'addLead' && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900">Add New Lead</h3>
                </div>
                <button
                  onClick={() => setActionModalType(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateNewLead} className="space-y-3.5 mt-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Lead / Contact Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Chandra"
                    value={newLeadForm.name}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Company / Store Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Chandra Enterprises"
                    value={newLeadForm.company}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, company: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Phone Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 98765 00000"
                      value={newLeadForm.contact}
                      onChange={(e) => setNewLeadForm({ ...newLeadForm, contact: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      placeholder="contact@company.com"
                      value={newLeadForm.email}
                      onChange={(e) => setNewLeadForm({ ...newLeadForm, email: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Priority</label>
                    <select
                      value={newLeadForm.priority}
                      onChange={(e: any) => setNewLeadForm({ ...newLeadForm, priority: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                    >
                      <option value="High">High Priority</option>
                      <option value="Medium">Medium Priority</option>
                      <option value="Low">Low Priority</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Initial Stage</label>
                    <select
                      value={newLeadForm.stage}
                      onChange={(e: any) => setNewLeadForm({ ...newLeadForm, stage: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                    >
                      <option value="New">New</option>
                      <option value="Contacted">Contacted</option>
                      <option value="Interested">Interested</option>
                      <option value="Proposal">Proposal</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Notes / Requirement</label>
                  <textarea
                    rows={2}
                    placeholder="Requirement details..."
                    value={newLeadForm.notes}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActionModalType(null)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-xs hover:bg-blue-700 cursor-pointer"
                  >
                    Create Lead
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 2. CREATE DEAL MODAL */}
        {actionModalType === 'createDeal' && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Handshake className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900">Create New Deal</h3>
                </div>
                <button
                  onClick={() => setActionModalType(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateDealSubmit} className="space-y-3.5 mt-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Select Lead *</label>
                  <select
                    value={dealForm.leadId}
                    onChange={(e) => {
                      const l = leads.find(x => x.id === e.target.value);
                      setDealForm({ ...dealForm, leadId: e.target.value, company: l?.company || '' });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                  >
                    {leads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.company || 'Private'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Estimated Deal Value (₹) *</label>
                  <input
                    type="number"
                    required
                    value={dealForm.value}
                    onChange={(e) => setDealForm({ ...dealForm, value: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Deal Stage</label>
                    <select
                      value={dealForm.stage}
                      onChange={(e: any) => setDealForm({ ...dealForm, stage: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                    >
                      <option value="Proposal">Proposal</option>
                      <option value="Negotiation">Negotiation</option>
                      <option value="Won">Closed Won</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Target Close Date</label>
                    <input
                      type="date"
                      value={dealForm.expectedClose}
                      onChange={(e) => setDealForm({ ...dealForm, expectedClose: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActionModalType(null)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-purple-600 text-white rounded-xl font-bold shadow-xs hover:bg-purple-700 cursor-pointer"
                  >
                    Save Deal
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. LOG CALL MODAL */}
        {actionModalType === 'call' && selectedLead && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                    <Phone className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900">Log Phone Call</h3>
                </div>
                <button
                  onClick={() => setActionModalType(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900 text-xs">{selectedLead.name}</div>
                  <div className="text-[11px] text-slate-500">{selectedLead.company}</div>
                </div>
                <a
                  href={`tel:${selectedLead.contact}`}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <Phone className="w-3 h-3" />
                  <span>{selectedLead.contact}</span>
                </a>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Call Notes & Outcome</label>
                  <textarea
                    rows={3}
                    value={callNotes}
                    onChange={(e) => setCallNotes(e.target.value)}
                    placeholder="Spoke with client, discussed requirements and pricing..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setActionModalType(null)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCall}
                    className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 cursor-pointer"
                  >
                    Save Call Log
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. WHATSAPP MESSAGE MODAL */}
        {actionModalType === 'message' && selectedLead && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900">Send WhatsApp Message</h3>
                </div>
                <button
                  onClick={() => setActionModalType(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 text-xs">{selectedLead.name} ({selectedLead.contact})</div>
                <div className="text-[11px] text-slate-500">{selectedLead.company}</div>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Message Content</label>
                  <textarea
                    rows={3}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setActionModalType(null)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmMessage}
                    className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold flex items-center gap-1.5 hover:bg-emerald-700 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Open WhatsApp</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. LEAD DETAIL MODAL */}
        {actionModalType === 'leadDetail' && selectedLead && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-base text-slate-900">{selectedLead.name}</h3>
                  <p className="text-xs text-slate-500">{selectedLead.company} • Priority: {selectedLead.priority || 'Medium'}</p>
                </div>
                <button
                  onClick={() => setActionModalType(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Phone</span>
                    <span className="font-semibold text-slate-800">{selectedLead.contact}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Email</span>
                    <span className="font-semibold text-slate-800">{selectedLead.email || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Current Stage</span>
                    <span className="font-semibold text-blue-600">{selectedLead.stage}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Estimated Deal</span>
                    <span className="font-semibold text-emerald-600">
                      ₹{(selectedLead.dealValue || 35000).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-700 font-semibold block mb-1">Notes & History</span>
                  <p className="p-3 bg-slate-50 rounded-xl text-slate-600 border border-slate-200">
                    {selectedLead.notes || 'No extra notes recorded.'}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="pt-3 flex items-center justify-between border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActionModalType('call')}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-semibold hover:bg-blue-100 cursor-pointer"
                    >
                      Call
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionModalType('message')}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-semibold hover:bg-emerald-100 cursor-pointer"
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionModalType('demo')}
                      className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg font-semibold hover:bg-purple-100 cursor-pointer"
                    >
                      Schedule Demo
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActionModalType(null)}
                    className="px-4 py-1.5 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. END OF DAY MODAL */}
        {isEodModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900">Complete My Day</h3>
                </div>
                <button
                  onClick={() => setIsEodModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3.5 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    <span className="text-slate-500 block text-[11px]">Calls Today</span>
                    <span className="text-lg font-bold text-blue-600">
                      {activities.filter(a => a.type === 'call' || a.action.toLowerCase().includes('call')).length}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    <span className="text-slate-500 block text-[11px]">Demos Scheduled</span>
                    <span className="text-lg font-bold text-purple-600">
                      {activities.filter(a => a.type === 'demo' || a.action.toLowerCase().includes('demo')).length}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    <span className="text-slate-500 block text-[11px]">Leads Advanced</span>
                    <span className="text-lg font-bold text-amber-600">
                      {activities.filter(a => a.type === 'stage' || a.action.toLowerCase().includes('stage')).length}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    <span className="text-slate-500 block text-[11px]">Sales Closed</span>
                    <span className="text-lg font-bold text-emerald-600">
                      {leads.filter(l => l.stage === 'Won').length}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Daily Summary & Notes</label>
                  <textarea
                    rows={3}
                    value={eodNotes}
                    onChange={(e) => setEodNotes(e.target.value)}
                    placeholder="Accomplishments, key conversations, and focus for tomorrow..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEodModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitEndOfDay}
                    className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold shadow-xs hover:bg-emerald-700 cursor-pointer"
                  >
                    Submit End of Day Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </TeamMemberLayout>
  );
};

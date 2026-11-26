import React, { useState, useEffect } from 'react';
import { Users, Clock, CheckCircle2, X, Phone, MessageSquare, Send } from 'lucide-react';
import { Lead, TeamMemberActivity, FollowUpTask } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';
import { useAuth } from '../../context/AuthContext';
import { memberTitle } from '../../lib/auth/roleMapping';
import { MemberTasksView } from '../tasks/MemberTasksView';
import { MemberAnalyticsWidgets } from './MemberAnalyticsWidgets';
import { MemberFollowUpsTable } from './MemberFollowUpsTable';
import { MemberRightSidebar } from './MemberRightSidebar';
import { HomeClock } from './HomeClock';
import { MemberCustomersDashboard } from './MemberCustomersDashboard';
import { MemberCalendarDashboard } from './MemberCalendarDashboard';
import { MemberInvoicesDashboard } from './MemberInvoicesDashboard';
import { MemberSettingsDashboard } from './MemberSettingsDashboard';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { DeliveryQueue } from '../delivery/DeliveryQueue';
import { CrocodialActivityPanel } from '../crocodial/CrocodialActivity';
import { CrocodialLeadsPanel } from '../crocodial/CrocodialLeads';
import { showDetails } from '../feedback/AppFeedback';

/** The member pages that are not the lead pipeline: one implementation, used by the Team Member dashboard and by the unified Business Associate dashboard. */
export type MemberSection = 'home' | 'work-tasks' | 'tasks' | 'customers' | 'calendar' | 'invoices' | 'settings' | 'delivery' | 'notifications';

export type MemberWorkspaceData = ReturnType<typeof useMemberWorkspace>;

/**
 * The member's own numbers, from the database through the member store (leads, today's activities, follow-ups, target). Call it once per dashboard:
 * the store is shared, and it stays subscribed to live changes while the dashboard is open.
 */
export function useMemberWorkspace(currentUserId: string) {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<TeamMemberActivity[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [kpis, setKpis] = useState(() => teamMemberStore.getDashboardKpis(currentUserId));
  const [target, setTarget] = useState(() => teamMemberStore.getMemberTarget(currentUserId));

  const refreshData = () => {
    const assigned = teamMemberStore.getAssignedLeads(currentUserId);
    const acts = teamMemberStore.getTodayActivities(currentUserId);
    const tasks = teamMemberStore.getFollowUps(currentUserId);
    const dashboardKpis = teamMemberStore.getDashboardKpis(currentUserId);
    const memberTarget = teamMemberStore.getMemberTarget(currentUserId);

    setLeads(assigned);
    setActivities(acts);
    setFollowUps(tasks);
    setKpis(dashboardKpis);
    setTarget(memberTarget);
  };

  // Load the workspace from the database and stay subscribed to live changes.
  const departmentSlug = profile?.department?.slug;
  useEffect(() => {
    const unsubscribe = teamMemberStore.subscribe(refreshData);
    void teamMemberStore.connect(currentUserId, departmentSlug).then(refreshData);
    return () => {
      unsubscribe();
      teamMemberStore.disconnect();
    };
  }, [currentUserId, departmentSlug]);
  return { leads, activities, followUps, kpis, target, leadSources: teamMemberStore.getLeadSources(currentUserId) };
}

interface Props {
  section: MemberSection;
  currentUserId: string;
  userName: string;
  workspace: MemberWorkspaceData;
  /** Where "View invoices" on a customer leads. */
  onOpenInvoices?: () => void;
}

export const MemberSections: React.FC<Props> = ({ section, currentUserId, userName, workspace, onOpenInvoices }) => {
  const { user } = useAuth();
  const { leads, activities, followUps, kpis, target } = workspace;
  const activeNav = section;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionModalType, setActionModalType] = useState<'call' | 'message' | null>(null);
  const [callNotes, setCallNotes] = useState('');
  const [customMessage, setCustomMessage] = useState('Hello, I am reaching out from Wabastore regarding your inquiry.');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Dynamic Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    const firstName = userName.split(' ')[0] || 'there';
    if (hour < 12) return `Good Morning, ${firstName} ☀️`;
    if (hour < 17) return `Good Afternoon, ${firstName} 🌤️`;
    return `Good Evening, ${firstName} 🌙`;
  };

  // Follow-up tasks may point at a lead that is no longer assigned; open the
  // action modals with what the task itself knows.
  const leadForTask = (task: FollowUpTask): Lead =>
    leads.find(l => l.id === task.leadId) || {
      id: task.leadId,
      name: task.leadName,
      company: task.company,
      contact: '',
      sourceId: 'whatsapp' as any,
      departmentId: 'wabastore',
      assignedTo: currentUserId,
      receivedAt: new Date().toISOString(),
      status: 'Verified' as any,
      rawPayload: {}
    };

  // --- ACTIONS ---
  // Every action writes to the database; the store then refreshes this view
  // (and any other device signed in to the same account).
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      showToast(success);
      return true;
    } catch (err) {
      showToast(`Could not save: ${err instanceof Error ? err.message : 'unknown error'}`);
      return false;
    }
  };

  const handleConfirmCall = async () => {
    if (!selectedLead) return;
    const lead = selectedLead;
    const ok = await run(
      () =>
        teamMemberStore.logActivity({
          leadId: lead.id,
          leadName: lead.name,
          action: `Call with ${lead.company || lead.name}`,
          notes: callNotes || 'Phone conversation completed.',
          type: 'call'
        }),
      `Call logged for ${lead.name}`
    );
    if (ok) {
      setActionModalType(null);
      setCallNotes('');
    }
  };

  const handleConfirmMessage = async () => {
    if (!selectedLead) return;
    const lead = selectedLead;
    const cleanPhone = lead.contact.replace(/[^\d]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(customMessage)}`, '_blank');
    const ok = await run(
      () =>
        teamMemberStore.logActivity({
          leadId: lead.id,
          leadName: lead.name,
          action: `WhatsApp sent to ${lead.company || lead.name}`,
          notes: customMessage,
          type: 'message'
        }),
      `WhatsApp message logged for ${lead.name}`
    );
    if (ok) setActionModalType(null);
  };

  const leadSources = workspace.leadSources;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
        {/* TOAST NOTIFICATION */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {activeNav === 'home' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">{getGreeting()}</h1>
                <p className="text-sm text-slate-500 mt-0.5">Here is where your leads stand today.</p>
              </div>
              <HomeClock />
            </div>

            {/* Crocodial calling activity: only for a person with an approved mapping (the database decides) */}
            <CrocodialActivityPanel />
            <CrocodialLeadsPanel />

            {/* The member's own numbers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Total Leads', value: kpis.totalLeads, note: `${kpis.newLeadsThisWeek} new in last 7 days`, icon: Users, tone: 'bg-blue-50 text-blue-600' },
                { label: 'Follow-ups Due', value: kpis.followUpsDue, note: 'Open follow-ups', icon: Clock, tone: 'bg-amber-50 text-amber-600' },
                { label: 'Converted Leads', value: kpis.convertedLeads, note: `${kpis.conversionRate}% conversion`, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' }
              ].map(card => {
                const Icon = card.icon;
                return (
                  <div key={card.label} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-slate-500">{card.label}</span>
                      <div className="text-2xl font-bold font-heading text-slate-900 leading-none">{card.value}</div>
                      <div className="text-[11px] font-medium text-slate-400 pt-1">{card.note}</div>
                    </div>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${card.tone}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <MemberAnalyticsWidgets
                leadSources={leadSources}
                totalLeads={kpis.totalLeads}
              />
              <MemberRightSidebar userName={userName} userRole={memberTitle(user)} target={target} activities={activities} />
            </div>
          </div>
        )}

        {activeNav === 'work-tasks' && <MemberTasksView />}

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
                setSelectedLead(leadForTask(task));
                setActionModalType('call');
              }}
              onOpenMessage={(task) => {
                setSelectedLead(leadForTask(task));
                setActionModalType('message');
              }}
              onViewDetails={(task) => {
                void showDetails({
                  title: `Follow-up: ${task.leadName}`,
                  details: [`Company: ${task.company || '—'}`, `Time: ${task.dateTimeStr}`, `Notes: ${task.notes || '—'}`]
                });
              }}
              onToggleComplete={(taskId) => {
                void run(() => teamMemberStore.toggleFollowUpStatus(taskId), 'Follow-up status updated');
              }}
            />
          </div>
        )}

        {activeNav === 'customers' && (
          <MemberCustomersDashboard
            currentUserId={currentUserId}
            onSendWhatsApp={(phone) => {
              const clean = phone.replace(/[^\d]/g, '');
              window.open(`https://wa.me/${clean}`, '_blank');
            }}
            onViewInvoices={() => onOpenInvoices?.()}
          />
        )}

        {activeNav === 'calendar' && <MemberCalendarDashboard />}

        {activeNav === 'invoices' && <MemberInvoicesDashboard currentUserId={currentUserId} />}

        {activeNav === 'settings' && <MemberSettingsDashboard currentUserId={currentUserId} userName={userName} />}

        {activeNav === 'delivery' && <DeliveryQueue />}

        {activeNav === 'notifications' && <NotificationsPage />}

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
    </div>
  );
};

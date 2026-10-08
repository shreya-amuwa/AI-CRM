import React, { useState, useEffect } from 'react';
import {
  TeamLeadLayout,
  TeamLeadNav
} from './TeamLeadLayout';
import { LeadOverviewTab } from './LeadOverviewTab';
import { LeadRepsTab } from './LeadRepsTab';
import { LeadDistributionTab } from './LeadDistributionTab';
import { LeadPipelineTab } from './LeadPipelineTab';
import { LeadEodTab } from './LeadEodTab';
import { LeadSlaRadarTab } from './LeadSlaRadarTab';
import { LeadAnalyticsTab } from './LeadAnalyticsTab';
import { LeadSettingsTab } from './LeadSettingsTab';
import { teamLeadStore } from '../../services/teamLeadStore';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { FieldVisitTrackerView } from '../common/FieldVisitTrackerView';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { TeamLeadTasksView } from '../tasks/TeamLeadTasksView';
import { HandoverBoard } from '../handover/HandoverBoard';
import { useAuth } from '../../context/AuthContext';

interface TeamLeadDashboardProps {
  currentUserId: string;
  userName: string;
}

export const TeamLeadDashboard: React.FC<TeamLeadDashboardProps> = ({
  currentUserId,
  userName
}) => {
  const { profile } = useAuth();
  const [activeNav, setActiveNav] = useState<TeamLeadNav>('overview');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Store data states
  const [reps, setReps] = useState(teamLeadStore.getReps());
  const [unassignedLeads, setUnassignedLeads] = useState(teamLeadStore.getUnassignedLeads());
  const [teamDeals, setTeamDeals] = useState(teamLeadStore.getTeamDeals());
  const [eodSubmissions, setEodSubmissions] = useState(teamLeadStore.getEodSubmissions());
  const [podTarget, setPodTarget] = useState(teamLeadStore.getPodTarget());
  const [kpis, setKpis] = useState(teamLeadStore.getPodKpis());

  const refreshAllData = () => {
    setReps(teamLeadStore.getReps());
    setUnassignedLeads(teamLeadStore.getUnassignedLeads());
    setTeamDeals(teamLeadStore.getTeamDeals());
    setEodSubmissions(teamLeadStore.getEodSubmissions());
    setPodTarget(teamLeadStore.getPodTarget());
    setKpis(teamLeadStore.getPodKpis());
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // --- ACTIONS ---

  // 1. Auto Round-Robin
  const handleAutoRoundRobin = () => {
    const result = teamLeadStore.autoRoundRobinDistribute();
    refreshAllData();
    if (result.distributedCount > 0) {
      showToast(`Successfully auto-distributed ${result.distributedCount} leads across available reps.`);
    } else {
      showToast('No unassigned leads in queue.');
    }
  };

  // 2. Assign Single Lead
  const handleAssignLead = (leadId: string, repId: string) => {
    const rep = reps.find(r => r.id === repId);
    teamLeadStore.assignLeadToRep(leadId, repId);
    refreshAllData();
    showToast(`Lead assigned to ${rep?.name || 'sales rep'}.`);
  };

  // 3. Reassign Leads
  const handleReassignLeads = (fromRepId: string, toRepId: string, count: number) => {
    const fromRep = reps.find(r => r.id === fromRepId);
    const toRep = reps.find(r => r.id === toRepId);
    if (!fromRep || !toRep) return;

    // Transfer deals
    const dealsOfRep = teamDeals.filter(d => d.assignedRepId === fromRepId);
    const dealsToMove = dealsOfRep.slice(0, count);
    dealsToMove.forEach(d => {
      teamLeadStore.reassignDeal(d.id, toRepId);
    });

    refreshAllData();
    showToast(`Reassigned ${dealsToMove.length} leads from ${fromRep.name} to ${toRep.name}.`);
  };

  // 4. Update Rep Status
  const handleUpdateStatus = (repId: string, status: 'Available' | 'On Call' | 'In Demo' | 'Offline') => {
    teamLeadStore.updateRepStatus(repId, status);
    refreshAllData();
    showToast(`Status updated to ${status}.`);
  };

  // 5. Review EOD
  const handleReviewEod = (eodId: string, feedback: string) => {
    teamLeadStore.reviewEodSubmission(eodId, feedback);
    refreshAllData();
    showToast('EOD daily report reviewed and supervisory feedback sent.');
  };

  // 6. Approve Discount
  const handleApproveDiscount = (dealId: string) => {
    teamLeadStore.approveDiscountRequest(dealId);
    refreshAllData();
    showToast('Special discount request authorized.');
  };

  // 7. Update Pod Target
  const handleUpdatePodTarget = (newTarget: number) => {
    teamLeadStore.updatePodTarget(newTarget);
    refreshAllData();
  };

  // 8. Simulate Incoming Lead
  const handleSimulateLead = () => {
    const simulated = teamLeadStore.simulateIncomingLead({
      company: 'Royal Jewels Studio',
      name: 'Pooja Agarwal',
      source: 'WhatsApp',
      estimatedValue: 85000,
      interest: 'WhatsApp Catalog & Abandoned Cart Recovery Bot'
    });
    refreshAllData();
    showToast(`New inquiry received from ${simulated.company} (WhatsApp).`);
  };

  // 9. Nudge Rep
  const handleNudgeRep = (repName: string, taskTitle: string) => {
    showToast(`Urgent SLA Nudge sent to ${repName} for "${taskTitle}".`);
  };

  // 10. Export Report
  const handleExportReport = () => {
    showToast('Exporting Pod Alpha Sales Performance Report (Excel/PDF)...');
  };

  return (
    <TeamLeadLayout
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      unassignedCount={kpis.unassignedCount}
      pendingEodCount={kpis.pendingEods}
      overdueCount={kpis.overdueTotal}
      onQuickDistribute={handleAutoRoundRobin}
    >
      {/* Dynamic Toast Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white py-3 px-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* VIEW 1: OVERVIEW */}
      {activeNav === 'overview' && (
        <LeadOverviewTab
          kpis={kpis}
          reps={reps}
          unassignedLeads={unassignedLeads}
          onNavigateTab={setActiveNav}
          onAutoDistribute={handleAutoRoundRobin}
        />
      )}

      {/* VIEW: TASKS FROM THE DEPARTMENT HEAD → TEAM MEMBERS */}
      {activeNav === 'assigned-tasks' && <TeamLeadTasksView />}

      {/* VIEW: VERIFIED CLIENTS PASSED BY THE DEPARTMENT HEAD → ASSIGN TO A TEAM MEMBER */}
      {activeNav === 'client-handovers' && <HandoverBoard role="TEAM_HEAD" />}

      {/* VIEW: TEAM MEMBERS & ACCESS (team leads add members to their own team) */}
      {activeNav === 'team-members' && (
        <StaffManagementPanel
          departmentSlug={profile?.department?.slug || ''}
          subDept={profile?.team?.division === 'SUPPORT' ? 'support' : profile?.team?.division === 'SALES' ? 'sales' : null}
        />
      )}

      {/* VIEW 2: REPS */}
      {activeNav === 'reps' && (
        <LeadRepsTab
          reps={reps}
          onUpdateStatus={handleUpdateStatus}
          onReassignLeads={handleReassignLeads}
        />
      )}

      {/* VIEW: FIELD VISITS (LIVE GPS TRACKING) */}
      {activeNav === 'field-visits' && (
        <FieldVisitTrackerView
          viewerRole="team-lead"
          userName={userName}
        />
      )}

      {/* VIEW 3: DISTRIBUTION */}
      {activeNav === 'distribution' && (
        <LeadDistributionTab
          unassignedLeads={unassignedLeads}
          reps={reps}
          onAutoRoundRobin={handleAutoRoundRobin}
          onAssignLead={handleAssignLead}
          onSimulateLead={handleSimulateLead}
        />
      )}

      {/* VIEW 4: PIPELINE */}
      {activeNav === 'pipeline' && (
        <LeadPipelineTab
          deals={teamDeals}
          reps={reps}
          onApproveDiscount={handleApproveDiscount}
          onReassignDeal={(dealId, toRepId) => {
            teamLeadStore.reassignDeal(dealId, toRepId);
            refreshAllData();
            showToast('Deal reassigned to new rep.');
          }}
        />
      )}

      {/* VIEW 5: EOD */}
      {activeNav === 'eod' && (
        <LeadEodTab
          submissions={eodSubmissions}
          onReviewSubmission={handleReviewEod}
        />
      )}

      {/* VIEW 6: SLA RADAR */}
      {activeNav === 'sla' && (
        <LeadSlaRadarTab
          reps={reps}
          onNudgeRep={handleNudgeRep}
          onReassignOverdue={(taskLead, toRepId) => {
            const rep = reps.find(r => r.id === toRepId);
            showToast(`Lead "${taskLead}" reassigned to ${rep?.name || 'rep'}.`);
            refreshAllData();
          }}
        />
      )}

      {/* VIEW 7: ANALYTICS */}
      {activeNav === 'analytics' && (
        <LeadAnalyticsTab
          reps={reps}
          onExportReport={handleExportReport}
        />
      )}

      {/* VIEW 8: SETTINGS */}
      {activeNav === 'settings' && (
        <LeadSettingsTab
          podTarget={podTarget}
          reps={reps}
          onUpdatePodTarget={handleUpdatePodTarget}
          showToast={showToast}
        />
      )}
    </TeamLeadLayout>
  );
};

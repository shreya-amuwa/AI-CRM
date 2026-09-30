import React from 'react';
import {
  Headphones, ArrowLeft, ArrowRight, Users, LifeBuoy
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { SupportHeadDashboardView } from './support/SupportHeadDashboardView';
import { SupportHeadTicketsView } from './support/SupportHeadTicketsView';
import { SupportHeadCustomersView } from './support/SupportHeadCustomersView';
import { SupportHeadIssuesView } from './support/SupportHeadIssuesView';
import { SupportHeadFollowUpsView } from './support/SupportHeadFollowUpsView';
import { SupportHeadResolutionView } from './support/SupportHeadResolutionView';
import { SupportHeadTeamPerformanceView } from './support/SupportHeadTeamPerformanceView';
import { SupportHeadReportsView } from './support/SupportHeadReportsView';
import { SupportHeadFlowView } from './support/SupportHeadFlowView';
import { DepartmentTeamMembersView } from './shared/DepartmentTeamMembersView';
import { DepartmentTeamHierarchyView } from './shared/DepartmentTeamHierarchyView';

interface WabastoreSupportOSProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

export const WabastoreSupportOS: React.FC<WabastoreSupportOSProps> = ({
  activeTab,
  onSelectTab,
  subDept,
  onSelectSubDept
}) => {
  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <SupportHeadDashboardView onNavigateTab={onSelectTab} />;
      case 'support_tickets':
        return <SupportHeadTicketsView />;
      case 'support_customers':
        return <SupportHeadCustomersView />;
      case 'support_issues':
        return <SupportHeadIssuesView />;
      case 'support_follow_ups':
        return <SupportHeadFollowUpsView />;
      case 'support_resolution':
        return <SupportHeadResolutionView />;
      case 'department_members':
        return <DepartmentTeamMembersView department="support" />;
      case 'team_members':
        return <DepartmentTeamHierarchyView department="support" />;
      case 'support_team_performance':
        return <SupportHeadTeamPerformanceView />;
      case 'support_reports':
        return <SupportHeadReportsView />;
      case 'support_flow':
        return <SupportHeadFlowView />;
      default:
        return <SupportHeadDashboardView onNavigateTab={onSelectTab} />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* Top Department Context Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 text-white flex items-center justify-center shadow-xs">
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                WabaStore &bull; Support Department
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                Department Head OS
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Department-wide command center for active tickets, customer history, issue resolution, and team SLAs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onSelectSubDept(null)}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
            <span>Switch Sub-Department</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content Area */}
      <div>
        {renderActiveView()}
      </div>
    </div>
  );
};

import React from 'react';
import {
  TrendingUp, ArrowLeft, ArrowRight, Users
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { AllLeadsView } from './AllLeadsView';
import { SalesHeadDashboardView } from './sales/SalesHeadDashboardView';
import { SalesHeadCustomersView } from './sales/SalesHeadCustomersView';
import { SalesHeadDealsView } from './sales/SalesHeadDealsView';
import { SalesHeadFollowUpsView } from './sales/SalesHeadFollowUpsView';
import { SalesHeadRevenueView } from './sales/SalesHeadRevenueView';
import { SalesHeadConversionView } from './sales/SalesHeadConversionView';
import { SalesHeadTeamPerformanceView } from './sales/SalesHeadTeamPerformanceView';
import { SalesHeadReportsView } from './sales/SalesHeadReportsView';
import { DepartmentTeamMembersView } from './shared/DepartmentTeamMembersView';
import { DepartmentTeamHierarchyView } from './shared/DepartmentTeamHierarchyView';
import { FieldVisitTrackerView } from '../../common/FieldVisitTrackerView';
import { DepartmentAccountsBillingView } from '../shared/DepartmentAccountsBillingView';
import { useAuth } from '../../../context/AuthContext';

interface WabastoreSalesOSProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

export const WabastoreSalesOS: React.FC<WabastoreSalesOSProps> = ({
  activeTab,
  onSelectTab,
  subDept,
  onSelectSubDept
}) => {
  const { selectDepartment } = useAuth();

  // SUB-DEPARTMENT SELECTOR SCREEN
  if (!subDept) {
    return (
      <div className="space-y-8 animate-fade-in py-8 max-w-5xl mx-auto font-sans">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WABASTORE SALES OS v2.0</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Daily Sales Operating System
          </h2>
          <p className="text-slate-600 max-w-xl mx-auto text-sm">
            Choose your role to access the sales operating system designed for maximum productivity and real-time insights.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            onClick={() => onSelectSubDept('sales')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-emerald-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 to-teal-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-8 h-8" />
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Active
                </span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
                Sales Department Head Dashboard
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Full operational oversight across 9 core modules: department snapshot, leads pipeline, customers, deals, follow-ups, revenue tracking, conversion funnels, team performance, and multi-dimensional reports.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs shadow-md group-hover:bg-emerald-700 transition-colors">
                <span>Enter Sales Head OS</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          <div
            className="bg-white rounded-3xl p-8 border border-slate-200 shadow-md relative overflow-hidden opacity-85"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-cyan-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
                  <Users className="w-8 h-8" />
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Sub-Team View
                </span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900">
                Sales Executive Workspace
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Dedicated individual lead workbench for frontline executives. Team leaders and members track daily calls, WhatsApp touches, personal conversion, and assigned tasks.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => onSelectSubDept('sales')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                <span>Switch to Sales</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="text-center text-sm text-slate-600 py-4">
          <p>⚡ Official WabaStore Commerce Sales Department &bull; Real-time Meta CRM Integration</p>
        </div>
      </div>
    );
  }

  // Render the requested active tab view
  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <SalesHeadDashboardView onNavigateTab={onSelectTab} />;
      case 'leads':
        return <AllLeadsView />;
      case 'sales_customers':
        return <SalesHeadCustomersView />;
      case 'sales_deals':
        return <SalesHeadDealsView />;
      case 'sales_follow_ups':
        return <SalesHeadFollowUpsView />;
      case 'field_visits':
        return <FieldVisitTrackerView viewerRole="admin" userName="Admin Console" />;
      case 'sales_revenue':
        return <SalesHeadRevenueView />;
      case 'sales_conversion':
        return <SalesHeadConversionView />;
      case 'department_members':
        return <DepartmentTeamMembersView department="sales" />;
      case 'team_members':
        return <DepartmentTeamHierarchyView department="sales" />;
      case 'sales_team_performance':
        return <SalesHeadTeamPerformanceView />;
      case 'sales_reports':
        return <SalesHeadReportsView />;
      case 'accounts':
        return (
          <DepartmentAccountsBillingView
            departmentId="wabastore"
            departmentName="Wabastore"
            onNavigateToMasterAccounts={() => selectDepartment('accounts')}
          />
        );
      default:
        return <SalesHeadDashboardView onNavigateTab={onSelectTab} />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* Top Department Context Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shadow-xs">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                WabaStore &bull; Sales Department
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Department Head OS
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Department-wide command center for leads, accounts, deals, pipeline velocity, and team performance
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

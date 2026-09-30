import React from 'react';
import {
  BarChart3,
  TrendingUp,
  Target,
  Phone,
  Video,
  Award,
  Download,
  Calendar,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { teamMemberStore } from '../../services/teamMemberStore';

interface MemberReportsDashboardProps {
  currentUserId: string;
}

export const MemberReportsDashboard: React.FC<MemberReportsDashboardProps> = ({ currentUserId }) => {
  const target = teamMemberStore.getMemberTarget(currentUserId);
  const leads = teamMemberStore.getAssignedLeads(currentUserId);
  const activities = teamMemberStore.getTodayActivities(currentUserId);

  const funnelSteps = [
    { label: 'Total Leads Ingested', count: 28, percentage: 100, color: 'bg-blue-500' },
    { label: 'Contacted & Qualified', count: 21, percentage: 75, color: 'bg-amber-500' },
    { label: 'Demonstrations Conducted', count: 14, percentage: 50, color: 'bg-purple-500' },
    { label: 'Commercial Proposals', count: 7, percentage: 25, color: 'bg-indigo-500' },
    { label: 'Closed Won Contracts', count: 5, percentage: 18, color: 'bg-emerald-500' }
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Performance & Analytics Reports
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor sales velocity, conversion funnels, quota attainment, and customer acquisition metrics.
          </p>
        </div>

        <button
          type="button"
          onClick={() => alert('Exporting monthly performance PDF report...')}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export Report</span>
        </button>
      </div>

      {/* KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Quota Attainment</span>
            <div className="text-2xl font-bold font-heading text-slate-900 mt-1">
              78%
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">On track for tier bonus</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Calls Logged</span>
            <div className="text-2xl font-bold font-heading text-slate-900 mt-1">
              84
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">↑ 14% vs target</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
            <Phone className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Demos Conducted</span>
            <div className="text-2xl font-bold font-heading text-slate-900 mt-1">
              22
            </div>
            <span className="text-[11px] text-purple-600 font-semibold mt-1 block">5 scheduled this week</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Video className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Customer Rating</span>
            <div className="text-2xl font-bold font-heading text-slate-900 mt-1">
              4.9 / 5.0
            </div>
            <span className="text-[11px] text-amber-600 font-semibold mt-1 block">Top 5% in team</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* CONVERSION FUNNEL (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">Sales Conversion Funnel</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Progression from initial lead acquisition down to contract sign-off.
            </p>
          </div>

          <div className="space-y-4 pt-2">
            {funnelSteps.map((step, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{step.label}</span>
                  <span className="font-mono font-bold text-slate-900">
                    {step.count} ({step.percentage}%)
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${step.color} transition-all duration-700`}
                    style={{ width: `${step.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PERFORMANCE TARGET & REWARD (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-xs font-heading text-slate-900">Monthly Quota Progress</h3>
            <p className="text-xs text-slate-500 mt-0.5">Target attainment and commission tier.</p>
          </div>

          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Deals Closed</span>
              <span className="font-bold text-blue-600 font-mono">8 of 15 deals</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-blue-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-600" style={{ width: '53%' }} />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Current: 53%</span>
              <span>Need 7 more deals for 100%</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span className="font-bold text-emerald-800">Incentive Status: Tier 2 Active</span>
            </div>
            <p className="text-emerald-700 text-[11px] leading-relaxed">
              Earn an extra 8% commission on deals closed above ₹ 50,000 for this billing cycle.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

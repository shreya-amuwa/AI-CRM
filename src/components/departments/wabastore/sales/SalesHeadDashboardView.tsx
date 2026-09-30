import React from 'react';
import {
  TrendingUp,
  Users,
  Database,
  Handshake,
  PhoneCall,
  DollarSign,
  Filter,
  Award,
  FileText,
  Sparkles,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Share2,
  Calendar
} from 'lucide-react';
import { ActiveTab } from '../../../layout/Sidebar';
import { WabastoreWebhookLiveBar } from '../WabastoreWebhookLiveBar';

interface SalesHeadDashboardViewProps {
  onNavigateTab?: (tab: ActiveTab) => void;
}

export const SalesHeadDashboardView: React.FC<SalesHeadDashboardViewProps> = ({
  onNavigateTab
}) => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const kpis = {
    totalLeads: 428,
    leadsGrowth: '+18%',
    activeCustomers: 248,
    activeDealsValue: 14280000,
    activeDealsCount: 48,
    revenueBooked: 8450000,
    revenueTarget: 11000000,
    targetPercent: 76.8,
    conversionRate: 28.4,
    pendingFollowUps: 38,
    overdueTasks: 6,
    activeReps: 12,
    totalReps: 14
  };

  const productRevenues = [
    { name: 'WabaStore Official WhatsApp API', value: 4250000, pct: 50.3, deals: 24 },
    { name: 'Multi-Agent Support & Sales Desk', value: 2180000, pct: 25.8, deals: 14 },
    { name: 'WhatsApp Catalog & Inventory Sync', value: 1240000, pct: 14.7, deals: 9 },
    { name: 'Abandoned Cart Recovery Engine', value: 780000, pct: 9.2, deals: 6 }
  ];

  const recentMilestones = [
    { id: 1, title: 'Closed Won: Zenith Retail Chain', rep: 'Priya Nair', pod: 'Pod Alpha', value: 180000, time: '14 mins ago' },
    { id: 2, title: 'Proposal Sent: Singhania Textiles', rep: 'Amit Patel', pod: 'Pod Alpha', value: 75000, time: '35 mins ago' },
    { id: 3, title: 'Demo Completed: Kuber Logistics', rep: 'Sameer Kulkarni', pod: 'Pod Beta', value: 140000, time: '1 hour ago' },
    { id: 4, title: 'New High-Value Lead: Tata Tech Suppliers', source: 'Meta Ads', value: 120000, time: '2 hours ago' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* 1. TOP HEADER & EXECUTIVE OVERVIEW BANNER */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-emerald-950/20">
        <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 w-64 h-64 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                WabaStore Sales Department Head
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {kpis.activeReps} of {kpis.totalReps} Sales Reps Active
              </span>
              <span className="text-xs text-slate-400">
                2 Active Sales Pods (Alpha & Beta)
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold font-heading tracking-tight">
              Sales Department Overview
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm max-w-2xl">
              Complete department snapshot: Track pipeline volume, monthly quota attainment, cross-pod customer accounts, and real-time team execution.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigateTab && onNavigateTab('leads')}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition-all active:scale-95"
            >
              <Database className="w-4 h-4" />
              <span>Manage Leads (428)</span>
            </button>
            <button
              onClick={() => onNavigateTab && onNavigateTab('sales_reports')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 backdrop-blur-md flex items-center gap-1.5 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Department Report</span>
            </button>
          </div>
        </div>

        {/* Department Revenue Progress Bar */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-300">Department Monthly Quota Pacing:</span>
            <span className="font-bold font-mono text-white">
              {formatINR(kpis.revenueBooked)} / {formatINR(kpis.revenueTarget)} ({kpis.targetPercent}%)
            </span>
          </div>
          <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(kpis.targetPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. REAL-TIME WABASTORE WEBHOOK LIVE GATEWAY BAR */}
      <WabastoreWebhookLiveBar onLeadIngested={() => onNavigateTab && onNavigateTab('leads')} />

      {/* 3. TOP 6 EXECUTIVE KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        
        {/* Leads */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('leads')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Total Leads</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono">
            {kpis.totalLeads}
          </p>
          <span className="text-[10px] font-bold text-emerald-600 mt-1 block">
            {kpis.leadsGrowth} this month
          </span>
        </div>

        {/* Customers */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('sales_customers')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Customers</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono">
            {kpis.activeCustomers}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            213 Active Accounts
          </span>
        </div>

        {/* Active Deals */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('sales_deals')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Pipeline Value</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Handshake className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono truncate">
            {formatINR(kpis.activeDealsValue)}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            {kpis.activeDealsCount} Active Deals
          </span>
        </div>

        {/* Revenue */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('sales_revenue')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Revenue Won</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-emerald-600 mt-2 font-mono truncate">
            {formatINR(kpis.revenueBooked)}
          </p>
          <span className="text-[10px] font-bold text-emerald-600 mt-1 block">
            {kpis.targetPercent}% of Monthly Target
          </span>
        </div>

        {/* Conversion */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('sales_conversion')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Conversion</span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Filter className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono">
            {kpis.conversionRate}%
          </p>
          <span className="text-[10px] text-teal-700 mt-1 block">
            Overall Win Rate
          </span>
        </div>

        {/* Pending Follow-ups */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('sales_follow_ups')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Follow-ups</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono">
            {kpis.pendingFollowUps}
          </p>
          <span className="text-[10px] font-bold text-rose-600 mt-1 block">
            {kpis.overdueTasks} Overdue Tasks
          </span>
        </div>

      </div>

      {/* 3. TWO COLUMN DETAILED SECTIONS: REVENUE BY PRODUCT & RECENT MILESTONES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT 2 COLUMNS: REVENUE BREAKDOWN & TEAM OVERVIEW */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Revenue By Product / Service */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold font-heading text-slate-900">
                  Revenue Ingestion by Product & Service
                </h3>
                <p className="text-xs text-slate-500">Commercial distribution across WabaStore core SaaS catalog</p>
              </div>
              <button
                onClick={() => onNavigateTab && onNavigateTab('sales_revenue')}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                <span>Full Ledger</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {productRevenues.map(prod => (
                <div key={prod.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{prod.name}</span>
                    <span className="font-mono font-bold text-slate-900">
                      {formatINR(prod.value)} <span className="text-[11px] text-slate-400 font-normal">({prod.pct}% • {prod.deals} Deals)</span>
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                      style={{ width: `${prod.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Department Operational Hubs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              onClick={() => onNavigateTab && onNavigateTab('sales_team_performance')}
              className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold">
                <Award className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-xs text-slate-900">Team Performance</h4>
              <p className="text-[11px] text-slate-500">
                Track 2 Team Leaders (Vikram & Rajesh) and 14 sales executives.
              </p>
            </div>

            <div
              onClick={() => onNavigateTab && onNavigateTab('sales_conversion')}
              className="p-5 rounded-2xl bg-gradient-to-br from-teal-50 to-white border border-teal-100 hover:border-teal-300 hover:shadow-md transition-all cursor-pointer space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold">
                <Filter className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-xs text-slate-900">Funnel & Loss Analysis</h4>
              <p className="text-[11px] text-slate-500">
                Analyze drop-offs from Lead to Qualified to Closed Customer.
              </p>
            </div>

            <div
              onClick={() => onNavigateTab && onNavigateTab('sales_follow_ups')}
              className="p-5 rounded-2xl bg-gradient-to-br from-amber-50 to-white border border-amber-100 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center font-bold">
                <PhoneCall className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-xs text-slate-900">Follow-up Adherence</h4>
              <p className="text-[11px] text-slate-500">
                Prevent lead leakage with strict 24-hour response SLAs.
              </p>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: RECENT SALES MILESTONES & DISPATCH */}
        <div className="space-y-6">
          
          {/* Recent Milestones Feed */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold font-heading text-slate-900">
                  Recent Department Milestones
                </h3>
              </div>
              <span className="text-[10px] text-emerald-600 font-bold">Live Stream</span>
            </div>

            <div className="space-y-3">
              {recentMilestones.map(m => (
                <div
                  key={m.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{m.title}</span>
                    <span className="font-mono font-bold text-emerald-600">
                      {formatINR(m.value)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{m.rep ? `${m.rep} • ${m.pod}` : `Source: ${m.source}`}</span>
                    <span>{m.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Urgent Overdue Notice */}
          <div className="bg-rose-50/90 rounded-2xl border border-rose-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <h4 className="text-xs font-bold">Overdue Sales Reminders ({kpis.overdueTasks})</h4>
            </div>
            <p className="text-xs text-rose-700 leading-relaxed">
              There are {kpis.overdueTasks} scheduled demos and WhatsApp calls overdue across sales pods. 
              Review the follow-ups panel to trigger escalations.
            </p>
            <button
              onClick={() => onNavigateTab && onNavigateTab('sales_follow_ups')}
              className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              Open Follow-ups Center
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};

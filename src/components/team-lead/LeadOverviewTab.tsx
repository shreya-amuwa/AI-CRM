import React from 'react';
import {
  TrendingUp,
  Users,
  PhoneCall,
  CalendarCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Share2,
  Sparkles,
  Clock,
  ShieldCheck,
  Phone,
  Video,
  UserCheck
} from 'lucide-react';
import { TeamRepPerformance, UnassignedLead } from '../../types/crm';

interface LeadOverviewTabProps {
  kpis: {
    podTarget: number;
    totalRevenueClosed: number;
    targetPercent: number;
    totalActiveLeads: number;
    totalCallsToday: number;
    totalDemosToday: number;
    totalWonDeals: number;
    avgConversion: number;
    unassignedCount: number;
    pendingEods: number;
    overdueTotal: number;
    activeRepsCount: number;
    totalRepsCount: number;
  };
  reps: TeamRepPerformance[];
  unassignedLeads: UnassignedLead[];
  onNavigateTab: (tab: any) => void;
  onAutoDistribute: () => void;
}

export const LeadOverviewTab: React.FC<LeadOverviewTabProps> = ({
  kpis,
  reps,
  unassignedLeads,
  onNavigateTab,
  onAutoDistribute
}) => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* 1. HERO GREETING & POD HEALTH BANNER */}
      <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-indigo-950/20">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 w-64 h-64 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                Pod Alpha • WabaStore Team
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {kpis.activeRepsCount} of {kpis.totalRepsCount} Reps Active
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold font-heading tracking-tight">
              Good day, Vikram Deshmukh
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm max-w-xl">
              Your sales pod is currently at <strong className="text-white font-semibold">{kpis.targetPercent}%</strong> of its monthly revenue goal. 
              There are <span className="text-amber-300 font-bold">{kpis.unassignedCount} incoming leads</span> in the queue waiting for assignment.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {kpis.unassignedCount > 0 && (
              <button
                onClick={onAutoDistribute}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-xs font-bold shadow-lg shadow-blue-500/30 flex items-center gap-2 transition-all active:scale-95"
              >
                <Share2 className="w-4 h-4" />
                <span>Auto Round-Robin ({kpis.unassignedCount})</span>
              </button>
            )}

            <button
              onClick={() => onNavigateTab('distribution')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 backdrop-blur-md flex items-center gap-1.5 transition-all"
            >
              <span>Lead Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quota Progress Bar */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-300">Monthly Pod Quota Progress:</span>
            <span className="font-bold font-mono text-white">
              {formatINR(kpis.totalRevenueClosed)} / {formatINR(kpis.podTarget)} ({kpis.targetPercent}%)
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

      {/* 2. TOP 4 KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Closed Revenue */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pod Revenue Booked</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-heading text-slate-900 font-mono">
              {formatINR(kpis.totalRevenueClosed)}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-emerald-600">+14% vs last month</span>
              <span className="text-[11px] text-slate-400">• Goal: 35L</span>
            </div>
          </div>
        </div>

        {/* Active Pod Leads */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Active Pipeline Leads</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-heading text-slate-900 font-mono">
              {kpis.totalActiveLeads}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-blue-600">Avg 20.6 / rep</span>
              <span className="text-[11px] text-slate-400">• 5 Sales Reps</span>
            </div>
          </div>
        </div>

        {/* Calls & Demos Today */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Outreach Activities Today</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-heading text-slate-900 font-mono">
              {kpis.totalCallsToday} <span className="text-sm font-normal text-slate-400">Calls</span> / {kpis.totalDemosToday} <span className="text-sm font-normal text-slate-400">Demos</span>
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-indigo-600">89% Target Adherence</span>
            </div>
          </div>
        </div>

        {/* Pod Win Rate */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Avg Pod Conversion</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-heading text-slate-900 font-mono">
              {kpis.avgConversion}%
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-purple-600">{kpis.totalWonDeals} Deals Won</span>
              <span className="text-[11px] text-slate-400">This Month</span>
            </div>
          </div>
        </div>

      </div>

      {/* 3. TWO COLUMN WORKSPACE: LIVE REP ROSTER & UNASSIGNED QUEUE PREVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT 2 COLUMNS: REPS LIVE STATUS & LOAD */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold font-heading text-slate-900">
                Pod Reps Live Activity & Workload
              </h2>
              <p className="text-xs text-slate-500">
                Real-time presence, active pipeline volume, and monthly quota achievement.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('reps')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              <span>View Roster</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {reps.map(rep => {
              const statusColors = {
                Available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'On Call': 'bg-blue-50 text-blue-700 border-blue-200',
                'In Demo': 'bg-purple-50 text-purple-700 border-purple-200',
                Offline: 'bg-slate-100 text-slate-600 border-slate-200'
              }[rep.status];

              const statusDot = {
                Available: 'bg-emerald-500',
                'On Call': 'bg-blue-500 animate-pulse',
                'In Demo': 'bg-purple-500',
                Offline: 'bg-slate-400'
              }[rep.status];

              return (
                <div key={rep.id} className="py-3.5 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusDot}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                          {rep.name}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusColors}`}>
                          {rep.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span><strong>{rep.activeLeads}</strong> leads</span>
                        <span>•</span>
                        <span><strong>{rep.callsToday}</strong> calls today</span>
                        <span>•</span>
                        <span>Win: <strong>{rep.conversionRate}%</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Quota attainment bar */}
                  <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 w-36">
                    <div className="flex items-center justify-between w-full text-[11px]">
                      <span className="text-slate-500">Quota</span>
                      <span className="font-bold font-mono text-slate-900">{rep.quotaPercent}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full"
                        style={{ width: `${Math.min(rep.quotaPercent, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      {formatINR(rep.revenueClosed)} / {formatINR(rep.targetRevenue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: INCOMING UNASSIGNED QUEUE & URGENT SLA ALERTS */}
        <div className="space-y-6">
          
          {/* Incoming Leads Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
                <h3 className="text-xs font-bold font-heading text-slate-900">
                  Unassigned Leads ({unassignedLeads.length})
                </h3>
              </div>
              <button
                onClick={() => onNavigateTab('distribution')}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700"
              >
                View All
              </button>
            </div>

            <div className="space-y-2.5">
              {unassignedLeads.slice(0, 3).map(lead => (
                <div
                  key={lead.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 truncate max-w-[140px]">
                      {lead.company}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {lead.source}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">
                    {lead.interest}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                    <span className="font-mono font-semibold text-slate-700">
                      {formatINR(lead.estimatedValue)}
                    </span>
                    <span>{lead.receivedAt}</span>
                  </div>
                </div>
              ))}
            </div>

            {unassignedLeads.length > 0 ? (
              <button
                onClick={onAutoDistribute}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Auto Distribute All ({unassignedLeads.length})</span>
              </button>
            ) : (
              <div className="text-center py-3 text-xs text-slate-400">
                All incoming leads distributed!
              </div>
            )}
          </div>

          {/* Urgent SLA Alert Banner */}
          <div className="bg-rose-50/80 rounded-2xl border border-rose-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <h3 className="text-xs font-bold font-heading">
                SLA Alert: {kpis.overdueTotal} Overdue Follow-ups
              </h3>
            </div>
            <p className="text-xs text-rose-700 leading-relaxed">
              Reps have overdue follow-up tasks from yesterday. Check the SLA Radar to nudge reps or reassign stale leads.
            </p>
            <button
              onClick={() => onNavigateTab('sla')}
              className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
            >
              Open SLA Radar
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};

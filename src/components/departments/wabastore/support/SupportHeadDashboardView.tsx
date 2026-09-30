import React from 'react';
import {
  LifeBuoy,
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  Award,
  FileText,
  GitFork,
  ArrowUpRight,
  TrendingUp,
  MessageCircle,
  Mail,
  Phone,
  Globe,
  Sparkles,
  Zap,
  ChevronRight,
  ShieldAlert,
  HelpCircle,
  ThumbsUp
} from 'lucide-react';
import { ActiveTab } from '../../../layout/Sidebar';

interface SupportHeadDashboardViewProps {
  onNavigateTab?: (tab: ActiveTab) => void;
}

export const SupportHeadDashboardView: React.FC<SupportHeadDashboardViewProps> = ({
  onNavigateTab
}) => {
  const kpis = {
    activeTickets: 142,
    resolvedIssues: 1284,
    pendingRequests: 28,
    avgResponseTime: '14 mins',
    avgResolutionTime: '3.8 hrs',
    csatScore: '4.8 / 5.0',
    onlineStaff: '10 / 12'
  };

  const channelBreakdown = [
    { channel: 'WhatsApp Inbound Desk', icon: MessageCircle, share: '58%', tickets: 82, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { channel: 'Email Support API', icon: Mail, share: '22%', tickets: 31, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { channel: 'In-App Webhook Portal', icon: Globe, share: '12%', tickets: 17, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    { channel: 'Direct Telephony Call', icon: Phone, share: '8%', tickets: 12, color: 'text-amber-600 bg-amber-50 border-amber-200' }
  ];

  const urgentEscalations = [
    { id: 'TICK-802', customer: 'Zenith Retail Chain', issue: 'Meta WhatsApp Template 504 Gateway Timeout', priority: 'Critical', timeOverdue: '22m overdue', assigned: 'Neha Kulkarni' },
    { id: 'TICK-798', customer: 'Patil Enterprises', issue: 'Catalog Inventory Webhook Sync Mismatch', priority: 'Critical', timeOverdue: '14m overdue', assigned: 'Aakash Singhal' },
    { id: 'TICK-791', customer: 'Mehta Traders', issue: 'Razorpay Payment Confirmation Callback Failed', priority: 'High', timeOverdue: '8m overdue', assigned: 'Kavita Roy' }
  ];

  const operationalShortcuts = [
    { title: 'Ticket Management', tab: 'support_tickets' as ActiveTab, desc: 'View 142 active tickets across 5 stages', icon: LifeBuoy, color: 'emerald' },
    { title: 'Customer History', tab: 'support_customers' as ActiveTab, desc: 'Inspect customer profiles, logs & sentiment', icon: Users, color: 'blue' },
    { title: 'Issues & Complaints', tab: 'support_issues' as ActiveTab, desc: 'Root cause tracking & bug patches', icon: AlertCircle, color: 'rose' },
    { title: 'Follow-ups & SLA', tab: 'support_follow_ups' as ActiveTab, desc: 'Scheduled callbacks & pending touches', icon: Clock, color: 'amber' },
    { title: 'Resolution Analytics', tab: 'support_resolution' as ActiveTab, desc: 'FCR velocity & reopened ticket rates', icon: CheckCircle2, color: 'teal' },
    { title: 'Team Performance', tab: 'support_team_performance' as ActiveTab, desc: 'Support leads & rep productivity scorecards', icon: Award, color: 'purple' },
    { title: 'Support Reports', tab: 'support_reports' as ActiveTab, desc: 'Multi-filter analytics & CSV/Excel export', icon: FileText, color: 'indigo' },
    { title: 'Support Flow Lifecycle', tab: 'support_flow' as ActiveTab, desc: 'End-to-end 6-stage journey & system latency', icon: GitFork, color: 'cyan' }
  ];

  return (
    <div className="space-y-6 font-sans">
      {/* Top Banner Alert / Welcome */}
      <div className="bg-gradient-to-r from-teal-900 via-slate-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-500/20 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              <span>SUPPORT COMMAND CENTER &bull; LIVE STREAM</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Support Department Head Dashboard
            </h2>
            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              Real-time monitoring across customer inquiries, first-response adherence, resolution velocity, escalations, and technical team productivity.
            </p>
          </div>

          <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md px-5 py-3.5 rounded-2xl border border-white/15">
            <div>
              <span className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold block">CSAT Satisfaction</span>
              <span className="text-2xl font-bold text-white font-mono">{kpis.csatScore}</span>
              <span className="text-[10px] text-teal-300 block font-semibold mt-0.5">&uarr; 94.2% Positive Feedback</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/30 flex items-center justify-center text-teal-300">
              <ThumbsUp className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">Active Tickets</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{kpis.activeTickets}</span>
            <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">34 Urgent</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Across 5 stages</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">Resolved Issues</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{kpis.resolvedIssues}</span>
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">&uarr; 94.2%</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Month to date</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">Pending Client</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-amber-600 font-mono">{kpis.pendingRequests}</span>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Awaiting info</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Logs / verification</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">First Response</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-teal-600 font-mono">{kpis.avgResponseTime}</span>
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">&lt;30m SLA</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">96.4% on-target</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">Avg Resolution</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{kpis.avgResolutionTime}</span>
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">&lt;6h Target</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">91.8% within SLA</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">FCR Velocity</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">72.4%</span>
            <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">1st Touch</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Resolved on call</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-slate-500 text-xs font-semibold block">Staff Online</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-emerald-600 font-mono">{kpis.onlineStaff}</span>
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Live</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">2 on break</span>
        </div>
      </div>

      {/* Middle Grid: SLA Adherence & Inbound Channel Share */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SLA Health Monitor */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-600" />
              <span>SLA Performance Gauges</span>
            </h3>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Optimal</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-700">First Response SLA (&lt; 30 mins)</span>
                <span className="text-teal-700 font-bold font-mono">96.4%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full" style={{ width: '96.4%' }} />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Target: 95.0% &bull; +1.4% above benchmark</span>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-700">Full Resolution SLA (&lt; 6 hrs)</span>
                <span className="text-emerald-700 font-bold font-mono">91.8%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '91.8%' }} />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Target: 90.0% &bull; +1.8% above benchmark</span>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-700">Ticket Reopen Rate (&lt; 5.0%)</span>
                <span className="text-blue-700 font-bold font-mono">3.2% (Healthy)</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: '32%' }} />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Only 3.2% reopened following resolution</span>
            </div>
          </div>
        </div>

        {/* Inbound Volume by Channel */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-600" />
              <span>Inbound Channel Distribution</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">142 Inquiries</span>
          </div>

          <div className="space-y-2.5">
            {channelBreakdown.map((ch, idx) => {
              const Icon = ch.icon;
              return (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-lg border ${ch.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">{ch.channel}</span>
                      <span className="text-[10px] text-slate-400">{ch.tickets} Active Inquiries</span>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-slate-900 text-xs bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs">
                    {ch.share}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Urgent Escalations & Overdue Radar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-rose-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>Urgent SLA Escalations</span>
            </h3>
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
              Action Required
            </span>
          </div>

          <div className="space-y-2">
            {urgentEscalations.map((esc, i) => (
              <div key={i} className="p-2.5 rounded-xl bg-rose-50/60 border border-rose-100 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-rose-800">{esc.id}</span>
                  <span className="text-[10px] font-bold text-rose-600 bg-rose-100/70 px-2 py-0.5 rounded-md">
                    {esc.timeOverdue}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-800 line-clamp-1">{esc.issue}</div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-rose-100/60">
                  <span>{esc.customer}</span>
                  <span className="font-semibold text-slate-700">Lead: {esc.assigned}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Operational Hub Navigation Shortcuts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Support Operations Hub Modules
          </h3>
          <span className="text-xs text-slate-500">8 Dedicated Operational Views</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {operationalShortcuts.map((mod, idx) => {
            const Icon = mod.icon;
            return (
              <div
                key={idx}
                onClick={() => onNavigateTab && onNavigateTab(mod.tab)}
                className="bg-white border border-slate-200 hover:border-teal-500 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-teal-50 text-teal-600 border border-teal-100 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 group-hover:text-teal-600 transition-all" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 group-hover:text-teal-600 transition-colors">
                    {mod.title}
                  </h4>
                  <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                    {mod.desc}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-teal-600">
                  <span>Open Module</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

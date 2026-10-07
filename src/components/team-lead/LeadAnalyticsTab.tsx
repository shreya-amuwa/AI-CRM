import React from 'react';
import {
  BarChart3,
  Trophy,
  TrendingUp,
  Download,
  Users,
  Target,
  Sparkles,
  ArrowUpRight,
  Filter
} from 'lucide-react';
import { TeamRepPerformance } from '../../types/crm';

interface LeadAnalyticsTabProps {
  reps: TeamRepPerformance[];
  onExportReport: () => void;
}

export const LeadAnalyticsTab: React.FC<LeadAnalyticsTabProps> = ({
  reps,
  onExportReport
}) => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  // Sort reps by revenue closed (descending)
  const sortedReps = [...reps].sort((a, b) => b.revenueClosed - a.revenueClosed);

  const totalPodRevenue = reps.reduce((sum, r) => sum + r.revenueClosed, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Pod Analytics & Leaderboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Comparative performance, sales velocity, and multi-channel acquisition ROI.
          </p>
        </div>

        <button
          onClick={onExportReport}
          className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs font-bold flex items-center gap-2 shadow-2xs transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>Export Pod Performance (PDF/Excel)</span>
        </button>
      </div>

      {/* Top Row: Rep Leaderboard */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Trophy className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-heading text-slate-900">
                Pod Alpha Revenue Leaderboard
              </h2>
              <p className="text-xs text-slate-500">Ranked by monthly closed contract value</p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600">
            Total Closed: {formatINR(totalPodRevenue)}
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {sortedReps.map((rep, idx) => {
            const rankBadges: Record<number, string> = {
              0: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
              1: 'bg-slate-200 text-slate-800 border-slate-300 font-bold',
              2: 'bg-amber-50 text-amber-800 border-amber-200 font-semibold'
            };

            const defaultRank = 'bg-slate-50 text-slate-600 border-slate-200 font-medium';

            return (
              <div
                key={rep.id}
                className="py-3.5 flex items-center justify-between gap-4 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs border ${
                      rankBadges[idx] || defaultRank
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div>
                    <h3 className="font-bold text-xs sm:text-sm text-slate-900">{rep.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{rep.wonDealsMonth} deals closed</span>
                      <span>•</span>
                      <span>Win Rate: <strong>{rep.conversionRate}%</strong></span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-sm sm:text-base text-slate-900 block">
                    {formatINR(rep.revenueClosed)}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-600">
                    {rep.quotaPercent}% of Quota
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Column Grid: Conversion Funnel & Lead Source Efficiency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Pod Sales Conversion Funnel */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold font-heading text-slate-900">
              Pod Full-Funnel Conversion
            </h3>
            <span className="text-xs font-bold text-indigo-600">Overall: 21.4%</span>
          </div>

          <div className="space-y-3 pt-1">
            {[
              { stage: '1. Total Inquiries Received', count: 140, pct: 100, color: 'from-blue-600 to-indigo-600' },
              { stage: '2. Contacted & Qualified', count: 98, pct: 70, color: 'from-blue-500 to-cyan-500' },
              { stage: '3. Product Demos Conducted', count: 52, pct: 37, color: 'from-indigo-500 to-purple-500' },
              { stage: '4. Proposals & Contracts Sent', count: 38, pct: 27, color: 'from-purple-500 to-pink-500' },
              { stage: '5. Deals Won & Invoiced', count: 30, pct: 21, color: 'from-emerald-500 to-teal-400' }
            ].map(f => (
              <div key={f.stage} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{f.stage}</span>
                  <span className="font-mono font-bold text-slate-900">
                    {f.count} ({f.pct}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${f.color} transition-all duration-500`}
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lead Source Efficiency */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold font-heading text-slate-900">
              Lead Source ROI & Volume
            </h3>
            <span className="text-xs text-slate-500">This Month</span>
          </div>

          <div className="space-y-3 pt-1">
            {[
              { source: 'WhatsApp Campaigns', leads: 58, won: 18, rate: '31.0%', revenue: 1450000 },
              { source: 'Meta & Instagram Ads', leads: 42, won: 7, rate: '16.6%', revenue: 680000 },
              { source: 'Website Inbound Form', leads: 26, won: 4, rate: '15.3%', revenue: 515000 },
              { source: 'Client Referrals', leads: 14, won: 1, rate: '7.1%', revenue: 200000 }
            ].map(src => (
              <div
                key={src.source}
                className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-4"
              >
                <div>
                  <h4 className="font-bold text-xs text-slate-900">{src.source}</h4>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <span>{src.leads} leads</span>
                    <span>•</span>
                    <span className="text-emerald-600 font-bold">{src.won} Won ({src.rate})</span>
                  </div>
                </div>

                <div className="text-right font-mono font-bold text-xs text-slate-800">
                  {formatINR(src.revenue)}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

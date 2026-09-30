import React from 'react';
import {
  CheckCircle2, Clock, RotateCcw, ThumbsUp, BarChart3, TrendingUp,
  Star, Award, ShieldCheck
} from 'lucide-react';

export const SupportHeadResolutionView: React.FC = () => {
  const metrics = {
    fcrRate: '72.4%',
    avgResolution: '3.8 hrs',
    reopenRate: '3.2%',
    csatAverage: '4.8 / 5.0'
  };

  const reopenCauses = [
    { cause: 'Partial Fix or Incomplete Configuration', share: '45%', count: 18 },
    { cause: 'Intermittent Third-party API Glitch', share: '35%', count: 14 },
    { cause: 'Client User Misunderstanding of Workflow', share: '20%', count: 8 }
  ];

  const timeDistribution = [
    { label: '< 1 Hour (Rapid Resolution)', share: '42%', color: 'bg-emerald-500' },
    { label: '1 - 4 Hours (Standard Tier-1)', share: '38%', color: 'bg-teal-500' },
    { label: '4 - 12 Hours (Tier-2 Engineering Patch)', share: '14%', color: 'bg-blue-500' },
    { label: '> 12 Hours (Meta Escalation / Complex Bug)', share: '6%', color: 'bg-amber-500' }
  ];

  const csatQuotes = [
    { client: 'Rajesh Mehta (Mehta Traders)', rating: 5, quote: 'Neha resolved our 504 timeout within 25 minutes. Our festive sales campaign went through seamlessly!' },
    { client: 'Deepak Deshmukh (Deshmukh Agro)', rating: 5, quote: 'Quick and courteous support over WhatsApp. The catalog images look crisp on every phone.' },
    { client: 'Amit Joshi (NextGen Living)', rating: 4, quote: 'Very helpful team, although the payment webhook explanation was a bit technical.' }
  ];

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <CheckCircle2 className="w-6 h-6 text-teal-600" />
          <span>Support Resolution Quality &amp; Velocity</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Track first-contact resolution, resolution time distribution, reopen rates, and CSAT customer sentiment
        </p>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 block">First Contact Resolution</span>
          <span className="text-3xl font-bold text-slate-900 font-mono mt-1 block">{metrics.fcrRate}</span>
          <span className="text-[11px] font-semibold text-emerald-600 mt-1 block">&uarr; +4.2% MoM (Target: 70%)</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 block">Avg Full Resolution Time</span>
          <span className="text-3xl font-bold text-teal-600 font-mono mt-1 block">{metrics.avgResolution}</span>
          <span className="text-[11px] font-semibold text-emerald-600 mt-1 block">91.8% within 6-hour SLA</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 block">Ticket Reopen Rate</span>
          <span className="text-3xl font-bold text-blue-600 font-mono mt-1 block">{metrics.reopenRate}</span>
          <span className="text-[11px] font-semibold text-emerald-600 mt-1 block">Well below 5% SLA threshold</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 block">Overall CSAT Rating</span>
          <span className="text-3xl font-bold text-amber-600 font-mono mt-1 block">{metrics.csatAverage}</span>
          <span className="text-[11px] font-semibold text-emerald-600 mt-1 block">Based on 482 survey ratings</span>
        </div>
      </div>

      {/* Middle Grid: Time Distribution & Reopen Causes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-600" />
            <span>Resolution Time Distribution</span>
          </h3>

          <div className="space-y-3">
            {timeDistribution.map((t, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-700">{t.label}</span>
                  <span className="font-mono font-bold text-slate-900">{t.share}</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${t.color} rounded-full`} style={{ width: t.share }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-blue-600" />
            <span>Reopened Tickets Root Cause Breakdown</span>
          </h3>

          <div className="space-y-3">
            {reopenCauses.map((rc, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">{rc.cause}</h4>
                  <span className="text-[10px] text-slate-400">{rc.count} reopened instances</span>
                </div>
                <span className="font-mono font-bold text-xs bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs">
                  {rc.share}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CSAT Quotes */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
          <span>Recent Customer Feedback &amp; CSAT Reviews</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {csatQuotes.map((q, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center gap-1 text-amber-400">
                {[...Array(q.rating)].map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                ))}
              </div>
              <p className="text-slate-700 italic leading-relaxed">"{q.quote}"</p>
              <span className="font-bold text-slate-900 block text-[11px] pt-1 border-t border-slate-200">{q.client}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

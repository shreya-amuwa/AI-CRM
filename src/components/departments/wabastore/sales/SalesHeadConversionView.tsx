import React from 'react';
import {
  Filter,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Share2,
  Users,
  Target,
  Sparkles,
  PieChart
} from 'lucide-react';

export const SalesHeadConversionView: React.FC = () => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const funnelSteps = [
    {
      stage: 'Stage 1: Lead Ingestion',
      count: 428,
      pct: 100,
      dropoff: '0%',
      desc: 'Total leads captured across WhatsApp API, Meta Ads, and Website.',
      color: 'from-blue-600 to-indigo-600'
    },
    {
      stage: 'Stage 2: Contacted & Qualified',
      count: 294,
      pct: 68.7,
      dropoff: '31.3% Disqualified / Unresponsive',
      desc: 'Prospects reached by sales reps and verified for budget & timeline.',
      color: 'from-blue-500 to-cyan-500'
    },
    {
      stage: 'Stage 3: Opportunity / Deal Created',
      count: 152,
      pct: 35.5,
      dropoff: '48.3% Stalled at Demo',
      desc: 'Formal commercial proposal sent or custom scope demo conducted.',
      color: 'from-purple-500 to-pink-500'
    },
    {
      stage: 'Stage 4: Closed Customer Account',
      count: 88,
      pct: 20.6,
      dropoff: '42.1% Lost in Negotiation',
      desc: 'Payment completed and onboarded to WabaStore SaaS.',
      color: 'from-emerald-500 to-teal-400'
    }
  ];

  const sourceConversions = [
    { source: 'WhatsApp Direct Commerce', leads: 158, won: 54, rate: '34.2%', revenue: 3840000 },
    { source: 'Website Inbound Catalog', leads: 94, won: 23, rate: '24.5%', revenue: 2150000 },
    { source: 'Meta & Instagram Ads', leads: 118, won: 26, rate: '22.1%', revenue: 2420000 },
    { source: 'Telecalling Support Desk', leads: 58, won: 10, rate: '17.2%', revenue: 980000 }
  ];

  const lossReasons = [
    { reason: 'Price Sensitivity / Annual Budget Mismatch', pct: 38, count: 46, recommendation: 'Introduce quarterly flexi-billing or starter plan.' },
    { reason: 'Chose Competitor / Legacy CRM Vendor', pct: 26, count: 32, recommendation: 'Highlight official Meta WhatsApp green-tick guarantee.' },
    { reason: 'Missing Custom ERP / POS Integration', pct: 18, count: 22, recommendation: 'Accelerate webhook bridge templates for Tally/Zoho.' },
    { reason: 'Unresponsive After Proposal / Cold Drop', pct: 18, count: 22, recommendation: 'Automate WhatsApp re-engagement drip sequence.' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Conversion & Funnel Analytics
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-800">
              20.6% Overall Lead-to-Customer
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Analyze lead progression across sales velocity stages, channel effectiveness, and churn loss factors.
          </p>
        </div>
      </div>

      {/* Main Funnel Visualization Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold font-heading text-slate-900">
              Sales Pipeline Velocity Funnel (Lead &rarr; Qualified &rarr; Deal &rarr; Customer)
            </h2>
            <p className="text-xs text-slate-500">Full department conversion progression</p>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
            88 Closed Customers
          </span>
        </div>

        <div className="space-y-5 pt-2">
          {funnelSteps.map(step => (
            <div key={step.stage} className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{step.stage}</span>
                  <p className="text-[11px] text-slate-500">{step.desc}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {step.count} ({step.pct}%)
                  </span>
                  <span className="text-[10px] text-rose-600 block">{step.dropoff}</span>
                </div>
              </div>

              <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden p-0.5 shadow-inner">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${step.color} transition-all duration-700`}
                  style={{ width: `${step.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Column Grid: Source Conversion Comparison & Lost Leads Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Source Conversion Comparison */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold font-heading text-slate-900">
                Conversion Rates by Ingestion Source
              </h3>
              <p className="text-xs text-slate-500">Channel ROI and commercial effectiveness</p>
            </div>
            <span className="text-xs text-slate-400">4 Channels</span>
          </div>

          <div className="space-y-3 pt-1">
            {sourceConversions.map(src => (
              <div
                key={src.source}
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-4"
              >
                <div>
                  <h4 className="font-bold text-xs text-slate-900">{src.source}</h4>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1">
                    <span>{src.leads} leads</span>
                    <span>&bull;</span>
                    <span className="text-emerald-700 font-bold">{src.won} Won ({src.rate})</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-slate-900 block">
                    {formatINR(src.revenue)}
                  </span>
                  <span className="text-[10px] text-slate-400">Revenue Won</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lost Leads / Churn Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold font-heading text-slate-900">
                Lost Leads & Stalled Opportunities Analysis
              </h3>
              <p className="text-xs text-slate-500">Root cause breakdown across 122 lost inquiries</p>
            </div>
            <span className="text-xs font-bold text-rose-600">122 Lost</span>
          </div>

          <div className="space-y-3 pt-1">
            {lossReasons.map(loss => (
              <div
                key={loss.reason}
                className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-800">{loss.reason}</span>
                  <span className="font-mono font-bold text-rose-600">{loss.pct}% ({loss.count})</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  <strong className="text-indigo-700">Coaching Note:</strong> {loss.recommendation}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

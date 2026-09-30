import React, { useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  Target,
  CreditCard,
  AlertCircle,
  FileCheck2,
  Calendar,
  Users,
  Download,
  CheckCircle2,
  Clock
} from 'lucide-react';

export const SalesHeadRevenueView: React.FC = () => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const revenueMetrics = {
    target: 11000000,
    achieved: 8450000,
    pending: 1820000,
    overdue: 430000,
    runRate: '₹92,50,000 Projected',
    growthPct: '+16.4%'
  };

  const podPerformance = [
    {
      pod: 'WabaStore Pod Alpha',
      lead: 'Vikram Deshmukh (Team Lead)',
      target: 6000000,
      achieved: 4850000,
      pct: 80.8,
      deals: 18,
      repsCount: 5
    },
    {
      pod: 'WabaStore Pod Beta',
      lead: 'Rajesh Gupta (Team Lead)',
      target: 5000000,
      achieved: 3600000,
      pct: 72.0,
      deals: 12,
      repsCount: 5
    }
  ];

  const repRevenueList = [
    { name: 'Amit Patel', pod: 'Pod Alpha', target: 1200000, achieved: 1040000, wonDeals: 4, pending: 180000 },
    { name: 'Priya Nair', pod: 'Pod Alpha', target: 1200000, achieved: 980000, wonDeals: 4, pending: 220000 },
    { name: 'Sameer Kulkarni', pod: 'Pod Beta', target: 1100000, achieved: 890000, wonDeals: 3, pending: 140000 },
    { name: 'Rahul Kumar', pod: 'Pod Alpha', target: 1100000, achieved: 850000, wonDeals: 3, pending: 190000 },
    { name: 'Ananya Verma', pod: 'Pod Beta', target: 1000000, achieved: 780000, wonDeals: 3, pending: 150000 },
    { name: 'Sneha Deshmukh', pod: 'Pod Alpha', target: 1000000, achieved: 740000, wonDeals: 2, pending: 110000 },
    { name: 'Rohan Varma', pod: 'Pod Alpha', target: 900000, achieved: 680000, wonDeals: 2, pending: 95000 },
    { name: 'Rajesh Patel', pod: 'Pod Beta', target: 900000, achieved: 560000, wonDeals: 2, pending: 120000 }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Sales Revenue & Targets
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              {formatINR(revenueMetrics.achieved)} Closed
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time billing monitor: Track sales quotas, collections, pending payments, and pod performance.
          </p>
        </div>

        <button
          onClick={() => alert('Exporting Department Revenue Ledger (Excel/CSV)...')}
          className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl flex items-center gap-2 shadow-2xs transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Revenue Ledger</span>
        </button>
      </div>

      {/* Top 4 Financial Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Achieved vs Target */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Revenue Booked</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-emerald-600 mt-2 font-mono">
            {formatINR(revenueMetrics.achieved)}
          </p>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-400">Target: {formatINR(revenueMetrics.target)}</span>
            <span className="font-bold text-emerald-700">76.8%</span>
          </div>
        </div>

        {/* Pending Collections */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pending Collections</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-blue-600 mt-2 font-mono">
            {formatINR(revenueMetrics.pending)}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            14 Invoices awaiting payment
          </span>
        </div>

        {/* Overdue Invoices */}
        <div className="bg-white rounded-2xl p-5 border border-rose-200 shadow-xs bg-rose-50/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800">Overdue Payments</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-rose-600 mt-2 font-mono">
            {formatINR(revenueMetrics.overdue)}
          </p>
          <span className="text-[10px] text-rose-700 mt-1 block font-semibold">
            3 Invoices &gt;30 days past due
          </span>
        </div>

        {/* Monthly Projected */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Month-End Run Rate</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-2 font-mono">
            {revenueMetrics.runRate.split(' ')[0]}
          </p>
          <span className="text-[10px] font-bold text-emerald-600 mt-1 block">
            {revenueMetrics.growthPct} vs Last Month
          </span>
        </div>

      </div>

      {/* Pod Comparison Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {podPerformance.map(pod => (
          <div key={pod.pod} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-sm text-slate-900">{pod.pod}</h3>
                <p className="text-xs text-slate-500">{pod.lead}</p>
              </div>
              <span className="text-xs font-bold font-mono text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                {pod.pct}% Quota
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Achieved Revenue:</span>
                <span className="font-bold font-mono text-slate-900">
                  {formatINR(pod.achieved)} / {formatINR(pod.target)}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                  style={{ width: `${Math.min(pod.pct, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>Won Deals: <strong className="text-slate-800">{pod.deals}</strong></span>
              <span>Pod Reps: <strong className="text-slate-800">{pod.repsCount}</strong></span>
            </div>
          </div>
        ))}
      </div>

      {/* Individual Team Member Revenue Contribution */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Sales Executive Revenue Generation Ledger
            </h3>
            <p className="text-xs text-slate-500">Individual rep contributions towards monthly targets</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Sales Executive</th>
                <th className="py-3 px-4">Pod</th>
                <th className="py-3 px-4">Target Quota</th>
                <th className="py-3 px-4">Revenue Achieved</th>
                <th className="py-3 px-4">Pacing %</th>
                <th className="py-3 px-4">Won Deals</th>
                <th className="py-3 px-4 text-right">Pending Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {repRevenueList.map(rep => {
                const pct = Math.round((rep.achieved / rep.target) * 100);

                return (
                  <tr key={rep.name} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {rep.name}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {rep.pod}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {formatINR(rep.target)}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-600">
                      {formatINR(rep.achieved)}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                      {pct}%
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">
                      {rep.wonDeals} Deals
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-slate-500">
                      {formatINR(rep.pending)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

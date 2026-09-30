import React, { useState } from 'react';
import {
  Handshake,
  Search,
  Filter,
  Kanban,
  Building2,
  DollarSign,
  User,
  Calendar,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';

interface DealItem {
  id: string;
  dealName: string;
  company: string;
  assignedRep: string;
  pod: 'Pod Alpha' | 'Pod Beta';
  value: number;
  stage: 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';
  expectedClose: string;
  probability: number;
}

export const SalesHeadDealsView: React.FC = () => {
  const [deals] = useState<DealItem[]>([
    {
      id: 'DL-501',
      dealName: 'Singhania Textiles - Bulk WhatsApp Commerce',
      company: 'Singhania Textiles',
      assignedRep: 'Priya Nair',
      pod: 'Pod Alpha',
      value: 175000,
      stage: 'Negotiation',
      expectedClose: 'Oct 02, 2026',
      probability: 80
    },
    {
      id: 'DL-502',
      dealName: 'Kuber Logistics Hub - Enterprise Automation',
      company: 'Kuber Logistics Hub',
      assignedRep: 'Sameer Kulkarni',
      pod: 'Pod Beta',
      value: 240000,
      stage: 'Proposal',
      expectedClose: 'Oct 08, 2026',
      probability: 60
    },
    {
      id: 'DL-503',
      dealName: 'Zenith Retail Chain - 20 Multi-Branch Bots',
      company: 'Zenith Retail Chain',
      assignedRep: 'Rahul Kumar',
      pod: 'Pod Alpha',
      value: 380000,
      stage: 'Closed Won',
      expectedClose: 'Sep 24, 2026',
      probability: 100
    },
    {
      id: 'DL-504',
      dealName: 'Tata Tech Supply - CRM Webhook Bridge',
      company: 'Tata Tech Supply',
      assignedRep: 'Amit Patel',
      pod: 'Pod Alpha',
      value: 320000,
      stage: 'Closed Won',
      expectedClose: 'Sep 26, 2026',
      probability: 100
    },
    {
      id: 'DL-505',
      dealName: 'Deshmukh Agro Foods - Export Notification Bot',
      company: 'Deshmukh Agro Foods',
      assignedRep: 'Sneha Deshmukh',
      pod: 'Pod Alpha',
      value: 195000,
      stage: 'Negotiation',
      expectedClose: 'Oct 04, 2026',
      probability: 75
    },
    {
      id: 'DL-506',
      dealName: 'Metro Healthcare - Patient OTP & Lab Reports',
      company: 'Metro Healthcare Clinics',
      assignedRep: 'Ananya Verma',
      pod: 'Pod Beta',
      value: 185000,
      stage: 'Proposal',
      expectedClose: 'Oct 12, 2026',
      probability: 60
    },
    {
      id: 'DL-507',
      dealName: 'BrightEdge Learning - Admission Query Bot',
      company: 'BrightEdge Learning',
      assignedRep: 'Rohan Varma',
      pod: 'Pod Alpha',
      value: 140000,
      stage: 'Proposal',
      expectedClose: 'Oct 15, 2026',
      probability: 50
    },
    {
      id: 'DL-508',
      dealName: 'Apex Cloud Logistics - Live Transit Tracker',
      company: 'Apex Logistics Corp',
      assignedRep: 'Amit Patel',
      pod: 'Pod Alpha',
      value: 210000,
      stage: 'Closed Won',
      expectedClose: 'Sep 28, 2026',
      probability: 100
    },
    {
      id: 'DL-509',
      dealName: 'Nova Digital Agency - White Label WhatsApp Reseller',
      company: 'Nova Digital Agency',
      assignedRep: 'Sameer Kulkarni',
      pod: 'Pod Beta',
      value: 150000,
      stage: 'Negotiation',
      expectedClose: 'Oct 06, 2026',
      probability: 70
    },
    {
      id: 'DL-510',
      dealName: 'Urban Crafts Studio - WhatsApp Shop Catalog',
      company: 'Urban Crafts Studio',
      assignedRep: 'Rajesh Patel',
      pod: 'Pod Beta',
      value: 85000,
      stage: 'Closed Lost',
      expectedClose: 'Sep 20, 2026',
      probability: 0
    }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPod, setSelectedPod] = useState<'All' | 'Pod Alpha' | 'Pod Beta'>('All');
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredDeals = deals.filter(d => {
    if (selectedPod !== 'All' && d.pod !== selectedPod) return false;
    if (
      searchQuery &&
      !d.company.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !d.dealName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !d.assignedRep.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const stages: Array<DealItem['stage']> = ['Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

  const totalPipeline = filteredDeals.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Deals & Pipeline
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
              {filteredDeals.length} Opportunities • {formatINR(totalPipeline)}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Track opportunities across sales stages, monitor probability, and review close schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Pod Filter */}
          <select
            value={selectedPod}
            onChange={e => setSelectedPod(e.target.value as any)}
            className="py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-600 shadow-2xs"
          >
            <option value="All">All Pods (Alpha & Beta)</option>
            <option value="Pod Alpha">Pod Alpha (Vikram)</option>
            <option value="Pod Beta">Pod Beta (Rajesh)</option>
          </select>

          {/* Search Box */}
          <div className="relative w-48 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search deals..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-2xs"
            />
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('board')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                viewMode === 'board' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
              }`}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Pipeline Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {stages.map(stage => {
          const stageDeals = filteredDeals.filter(d => d.stage === stage);
          const stageTotal = stageDeals.reduce((s, d) => s + d.value, 0);

          return (
            <div key={stage} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
              <span className="text-xs font-semibold text-slate-500">{stage}</span>
              <p className="text-xl font-bold font-heading text-slate-900 mt-1 font-mono">
                {formatINR(stageTotal)}
              </p>
              <span className="text-[10px] text-slate-400">{stageDeals.length} Deals in stage</span>
            </div>
          );
        })}
      </div>

      {/* KANBAN BOARD VIEW */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {stages.map(stage => {
            const stageDeals = filteredDeals.filter(d => d.stage === stage);

            const stageStyles: Record<string, { bg: string; border: string; badge: string }> = {
              Proposal: { bg: 'bg-amber-50/50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800' },
              Negotiation: { bg: 'bg-blue-50/50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-800' },
              'Closed Won': { bg: 'bg-emerald-50/50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800' },
              'Closed Lost': { bg: 'bg-rose-50/50', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-800' }
            };

            const style = stageStyles[stage];

            return (
              <div
                key={stage}
                className="bg-slate-100/70 rounded-2xl p-4 border border-slate-200/60 flex flex-col space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                  <span className="font-bold text-xs text-slate-900">{stage}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
                    {stageDeals.length} Deals
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                  {stageDeals.length === 0 ? (
                    <div className="text-center py-8 text-[11px] text-slate-400">
                      No deals currently in {stage}
                    </div>
                  ) : (
                    stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-xs transition-all space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-xs text-slate-900 leading-snug line-clamp-2">
                            {deal.company}
                          </h4>
                          <span className="font-mono font-bold text-xs text-emerald-600 shrink-0">
                            {formatINR(deal.value)}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 line-clamp-1">
                          {deal.dealName}
                        </p>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                          <div className="flex items-center gap-1.5 font-medium text-slate-700">
                            <User className="w-3 h-3 text-slate-400" />
                            <span>{deal.assignedRep}</span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-600">
                            {deal.pod}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Target: {deal.expectedClose}</span>
                          <span className="font-mono font-bold text-slate-600">{deal.probability}% Win</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Deal & Company</th>
                <th className="py-3 px-4">Assigned Rep</th>
                <th className="py-3 px-4">Sales Pod</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Opportunity Value</th>
                <th className="py-3 px-4">Expected Close</th>
                <th className="py-3 px-4 text-right">Probability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredDeals.map(deal => (
                <tr key={deal.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-slate-900">{deal.company}</div>
                    <div className="text-[11px] text-slate-500">{deal.dealName}</div>
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-700">
                    {deal.assignedRep}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">
                    {deal.pod}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                      {deal.stage}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {formatINR(deal.value)}
                  </td>
                  <td className="py-3.5 px-4 text-slate-500">
                    {deal.expectedClose}
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-right text-indigo-600">
                    {deal.probability}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
};

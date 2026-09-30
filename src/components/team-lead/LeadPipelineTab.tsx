import React, { useState } from 'react';
import {
  Kanban,
  Filter,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  DollarSign,
  User,
  ShieldCheck,
  Tag,
  ArrowRight,
  Sparkles,
  MessageSquare
} from 'lucide-react';
import { TeamDealItem, TeamRepPerformance } from '../../types/crm';

interface LeadPipelineTabProps {
  deals: TeamDealItem[];
  reps: TeamRepPerformance[];
  onApproveDiscount: (dealId: string) => void;
  onReassignDeal: (dealId: string, toRepId: string) => void;
}

export const LeadPipelineTab: React.FC<LeadPipelineTabProps> = ({
  deals,
  reps,
  onApproveDiscount,
  onReassignDeal
}) => {
  const [selectedRepFilter, setSelectedRepFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredDeals = deals.filter(deal => {
    if (selectedRepFilter !== 'All' && deal.assignedRepId !== selectedRepFilter) return false;
    if (
      searchQuery &&
      !deal.dealName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !deal.company.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const stages: Array<TeamDealItem['stage']> = [
    'New Lead',
    'Contacted',
    'Demo',
    'Proposal',
    'Negotiation',
    'Closed Won'
  ];

  const totalPipelineValue = filteredDeals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Top Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Team Deals & Pipeline Oversight
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
              {filteredDeals.length} Deals • {formatINR(totalPipelineValue)}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cross-rep sales pipeline with discount authorization controls and Team Lead co-pilot notes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rep Filter Dropdown */}
          <select
            value={selectedRepFilter}
            onChange={e => setSelectedRepFilter(e.target.value)}
            className="py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-600 shadow-2xs"
          >
            <option value="All">All Pod Reps (5)</option>
            {reps.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          {/* Search Box */}
          <div className="relative w-48 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search deals..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600"
            />
          </div>

          {/* View Mode Toggle */}
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

      {/* Special Discount Approvals Banner if pending */}
      {deals.some(d => d.requiresDiscountApproval) && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold text-xs">
                Discount Authorization Requested
              </p>
              <p className="text-[11px] text-amber-800">
                Reps have requested special discount exceptions requiring your managerial approval.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold bg-amber-200/80 px-2.5 py-1 rounded-lg text-amber-950 font-mono">
            {deals.filter(d => d.requiresDiscountApproval).length} Requests Pending
          </span>
        </div>
      )}

      {/* KANBAN BOARD VIEW */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 overflow-x-auto pb-4">
          {stages.map(stage => {
            const stageDeals = filteredDeals.filter(d => d.stage === stage);
            const stageTotal = stageDeals.reduce((s, d) => s + d.value, 0);

            const stageHeaders: Record<string, { bg: string; text: string; border: string }> = {
              'New Lead': { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
              Contacted: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
              Demo: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
              Proposal: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
              Negotiation: { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200' },
              'Closed Won': { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' }
            };

            const headerStyle = stageHeaders[stage];

            return (
              <div
                key={stage}
                className="bg-slate-100/70 rounded-2xl p-3 border border-slate-200/60 flex flex-col space-y-3 min-w-[240px]"
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-slate-800">{stage}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200">
                      {stageDeals.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-slate-500">
                    {formatINR(stageTotal)}
                  </span>
                </div>

                {/* Cards List */}
                <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                  {stageDeals.length === 0 ? (
                    <div className="text-center py-8 text-[11px] text-slate-400">
                      No deals in {stage}
                    </div>
                  ) : (
                    stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs hover:shadow-xs transition-all space-y-2 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-xs text-slate-900 leading-snug line-clamp-2">
                            {deal.company}
                          </span>
                          <span className="font-mono font-bold text-xs text-indigo-700 shrink-0">
                            {formatINR(deal.value)}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 line-clamp-1">
                          {deal.dealName}
                        </p>

                        {/* Rep Badge */}
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                          <div className="flex items-center gap-1.5 font-medium text-slate-700">
                            <User className="w-3 h-3 text-slate-400" />
                            <span>{deal.assignedRepName}</span>
                          </div>
                          <span>{deal.expectedClose}</span>
                        </div>

                        {/* Discount approval banner inside card */}
                        {deal.requiresDiscountApproval && (
                          <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px] text-amber-900 font-bold">
                              <span>Req. {deal.discountRequested}% Discount</span>
                              <span className="text-amber-700">Needs Approval</span>
                            </div>
                            <button
                              onClick={() => onApproveDiscount(deal.id)}
                              className="w-full py-1 px-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold transition-colors"
                            >
                              Approve Discount
                            </button>
                          </div>
                        )}

                        {deal.leadReviewNote && (
                          <div className="p-1.5 rounded-lg bg-indigo-50/70 text-indigo-900 text-[10px] italic">
                            💬 {deal.leadReviewNote}
                          </div>
                        )}

                        {/* Reassign rep option */}
                        <div className="pt-1 flex items-center justify-between text-[10px]">
                          <select
                            value={deal.assignedRepId}
                            onChange={e => onReassignDeal(deal.id, e.target.value)}
                            className="bg-slate-50 text-slate-600 rounded-md py-0.5 px-1 border border-slate-200 text-[10px] cursor-pointer"
                          >
                            {reps.map(r => (
                              <option key={r.id} value={r.id}>
                                Rep: {r.name.split(' ')[0]}
                              </option>
                            ))}
                          </select>
                          <span className="text-slate-400 font-mono">{deal.probability}% win</span>
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
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Deal Value</th>
                <th className="py-3 px-4">Close Date</th>
                <th className="py-3 px-4">Discount Status</th>
                <th className="py-3 px-4 text-right">Team Lead Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredDeals.map(deal => (
                <tr key={deal.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-slate-900">{deal.company}</div>
                    <div className="text-[11px] text-slate-500">{deal.dealName}</div>
                  </td>
                  <td className="py-3.5 px-4 font-medium text-slate-700">
                    {deal.assignedRepName}
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
                  <td className="py-3.5 px-4">
                    {deal.requiresDiscountApproval ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        {deal.discountRequested}% Requested
                      </span>
                    ) : deal.isDiscountApproved ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Approved
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Standard</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {deal.requiresDiscountApproval ? (
                      <button
                        onClick={() => onApproveDiscount(deal.id)}
                        className="py-1 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
                      >
                        Approve Discount
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">No Action Required</span>
                    )}
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

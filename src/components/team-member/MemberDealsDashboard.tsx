import React, { useState } from 'react';
import {
  Handshake,
  TrendingUp,
  Plus,
  DollarSign,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Filter,
  Search,
  X
} from 'lucide-react';
import { Deal } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';

interface MemberDealsDashboardProps {
  currentUserId: string;
}

export const MemberDealsDashboard: React.FC<MemberDealsDashboardProps> = ({ currentUserId }) => {
  const [deals, setDeals] = useState<Deal[]>(() => teamMemberStore.getDeals(currentUserId));
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [newDealForm, setNewDealForm] = useState({
    leadName: '',
    company: '',
    value: 65000,
    stage: 'Proposal' as Deal['stage'],
    expectedClose: '2026-10-15'
  });

  const stages: Deal['stage'][] = ['Proposal', 'Negotiation', 'Won', 'Lost'];

  const stageColors: Record<Deal['stage'], { bg: string; border: string; text: string; dot: string }> = {
    Proposal: { bg: 'bg-purple-50', border: 'border-t-purple-500', text: 'text-purple-700', dot: 'bg-purple-500' },
    Negotiation: { bg: 'bg-amber-50', border: 'border-t-amber-500', text: 'text-amber-700', dot: 'bg-amber-500' },
    Won: { bg: 'bg-emerald-50', border: 'border-t-emerald-600', text: 'text-emerald-700', dot: 'bg-emerald-600' },
    Lost: { bg: 'bg-rose-50', border: 'border-t-rose-500', text: 'text-rose-700', dot: 'bg-rose-500' }
  };

  const totalValue = deals.reduce((acc, d) => acc + d.value, 0);
  const wonDeals = deals.filter(d => d.stage === 'Won');
  const wonValue = wonDeals.reduce((acc, d) => acc + d.value, 0);
  const winRate = deals.length > 0 ? Math.round((wonDeals.length / deals.length) * 100) : 0;
  const avgDealSize = deals.length > 0 ? Math.round(totalValue / deals.length) : 0;

  const handleAdvance = (dealId: string, next: Deal['stage']) => {
    teamMemberStore.updateDealStage(dealId, next);
    setDeals(teamMemberStore.getDeals(currentUserId));
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDealForm.leadName || !newDealForm.company) return;

    teamMemberStore.addDeal({
      userId: currentUserId,
      leadId: `LD-${Date.now()}`,
      leadName: newDealForm.leadName,
      company: newDealForm.company,
      value: Number(newDealForm.value) || 50000,
      stage: newDealForm.stage,
      expectedClose: newDealForm.expectedClose
    });

    setDeals(teamMemberStore.getDeals(currentUserId));
    setIsAddModalOpen(false);
    setNewDealForm({
      leadName: '',
      company: '',
      value: 65000,
      stage: 'Proposal',
      expectedClose: '2026-10-15'
    });
  };

  const filteredDeals = deals.filter(d => {
    const q = searchQuery.toLowerCase();
    return !q || d.leadName.toLowerCase().includes(q) || d.company.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Deals & Opportunities
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Track deal stages, pipeline values, and close rates across your active pipeline.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Deal</span>
        </button>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Pipeline Value</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {totalValue.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">Active pipeline</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Deals Won</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              {wonDeals.length} deals
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">
              ₹ {wonValue.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Win Rate</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              {winRate}%
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">↑ 8% vs target</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Avg Deal Size</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {avgDealSize.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Per closed deal</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Handshake className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* PIPELINE COLUMNS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stages.map(st => {
          const stageDeals = filteredDeals.filter(d => d.stage === st);
          const stVal = stageDeals.reduce((acc, d) => acc + d.value, 0);
          const styling = stageColors[st];

          return (
            <div
              key={st}
              className={`bg-slate-50/70 rounded-2xl border border-slate-200/80 p-4 flex flex-col justify-between border-t-2 ${styling.border}`}
            >
              <div>
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/70">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800">{st}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${styling.bg} ${styling.text}`}>
                      {stageDeals.length}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 font-semibold">
                    ₹ {(stVal / 1000).toFixed(0)}k
                  </span>
                </div>

                <div className="space-y-3">
                  {stageDeals.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs">No deals in {st}</div>
                  ) : (
                    stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        className="bg-white rounded-xl p-3.5 border border-slate-200/80 hover:border-blue-400 hover:shadow-xs transition-all"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-bold text-xs text-slate-900">{deal.company}</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">{deal.leadName}</p>
                          </div>
                          <span className="font-mono font-bold text-xs text-blue-600">
                            ₹ {deal.value.toLocaleString('en-IN')}
                          </span>
                        </div>

                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                          <span>Target: {deal.expectedClose}</span>
                          {st === 'Proposal' && (
                            <button
                              type="button"
                              onClick={() => handleAdvance(deal.id, 'Negotiation')}
                              className="text-blue-600 font-bold hover:underline"
                            >
                              Negotiate →
                            </button>
                          )}
                          {st === 'Negotiation' && (
                            <button
                              type="button"
                              onClick={() => handleAdvance(deal.id, 'Won')}
                              className="text-emerald-600 font-bold hover:underline"
                            >
                              Close Won ✓
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE DEAL MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Handshake className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900">Add Deal Opportunity</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company / Account Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Hypermarket"
                  value={newDealForm.company}
                  onChange={(e) => setNewDealForm({ ...newDealForm, company: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Primary Contact *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Chandra"
                  value={newDealForm.leadName}
                  onChange={(e) => setNewDealForm({ ...newDealForm, leadName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Deal Value (₹) *</label>
                  <input
                    type="number"
                    required
                    value={newDealForm.value}
                    onChange={(e) => setNewDealForm({ ...newDealForm, value: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Stage</label>
                  <select
                    value={newDealForm.stage}
                    onChange={(e: any) => setNewDealForm({ ...newDealForm, stage: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="Proposal">Proposal</option>
                    <option value="Negotiation">Negotiation</option>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Target Close Date</label>
                <input
                  type="date"
                  value={newDealForm.expectedClose}
                  onChange={(e) => setNewDealForm({ ...newDealForm, expectedClose: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-xs hover:bg-blue-700"
                >
                  Save Deal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

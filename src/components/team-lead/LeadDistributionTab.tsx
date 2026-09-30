import React, { useState } from 'react';
import {
  GitPullRequest,
  Share2,
  Plus,
  Filter,
  CheckSquare,
  Square,
  Users,
  Building2,
  Phone,
  Mail,
  MapPin,
  Clock,
  Sparkles,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { UnassignedLead, TeamRepPerformance } from '../../types/crm';

interface LeadDistributionTabProps {
  unassignedLeads: UnassignedLead[];
  reps: TeamRepPerformance[];
  onAutoRoundRobin: () => void;
  onAssignLead: (leadId: string, repId: string) => void;
  onSimulateLead: () => void;
}

export const LeadDistributionTab: React.FC<LeadDistributionTabProps> = ({
  unassignedLeads,
  reps,
  onAutoRoundRobin,
  onAssignLead,
  onSimulateLead
}) => {
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [bulkTargetRepId, setBulkTargetRepId] = useState<string>(reps[0]?.id || '');
  const [sourceFilter, setSourceFilter] = useState<string>('All');

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredLeads = unassignedLeads.filter(l => {
    if (sourceFilter !== 'All' && l.source !== sourceFilter) return false;
    return true;
  });

  const toggleSelectAll = () => {
    if (selectedLeadIds.length === filteredLeads.length) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(filteredLeads.map(l => l.id));
    }
  };

  const toggleSelectLead = (id: string) => {
    if (selectedLeadIds.includes(id)) {
      setSelectedLeadIds(selectedLeadIds.filter(i => i !== id));
    } else {
      setSelectedLeadIds([...selectedLeadIds, id]);
    }
  };

  const handleBulkAssign = () => {
    if (!bulkTargetRepId || selectedLeadIds.length === 0) return;
    selectedLeadIds.forEach(id => {
      onAssignLead(id, bulkTargetRepId);
    });
    setSelectedLeadIds([]);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Main Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Lead Distribution Hub
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
              {unassignedLeads.length} In Queue
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Incoming inquiries from WhatsApp API, Meta Ads, and Website awaiting pod distribution.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSimulateLead}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Simulate Incoming Lead</span>
          </button>

          <button
            type="button"
            onClick={onAutoRoundRobin}
            disabled={unassignedLeads.length === 0}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs disabled:opacity-50 transition-all active:scale-95"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>Auto Round-Robin All</span>
          </button>
        </div>
      </div>

      {/* Distribution Strategy Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <GitPullRequest className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase">Routing Policy</span>
            <p className="text-xs font-bold text-slate-800">Active Rep Round-Robin</p>
            <p className="text-[10px] text-slate-500">Skips reps marked as 'Offline'</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase">Available Reps</span>
            <p className="text-xs font-bold text-slate-800">
              {reps.filter(r => r.status !== 'Offline').length} of {reps.length} Reps Ready
            </p>
            <p className="text-[10px] text-slate-500">Avg capacity utilization: 68%</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase">Queue Value</span>
            <p className="text-xs font-bold text-slate-800 font-mono">
              {formatINR(unassignedLeads.reduce((s, l) => s + l.estimatedValue, 0))}
            </p>
            <p className="text-[10px] text-slate-500">Across {unassignedLeads.length} leads</p>
          </div>
        </div>
      </div>

      {/* Bulk Action Bar if items selected */}
      {selectedLeadIds.length > 0 && (
        <div className="bg-indigo-900 text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-indigo-950/20 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold">
              {selectedLeadIds.length} lead{selectedLeadIds.length > 1 ? 's' : ''} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-indigo-200">Assign to:</span>
            <select
              value={bulkTargetRepId}
              onChange={e => setBulkTargetRepId(e.target.value)}
              className="py-1.5 px-3 bg-white text-slate-900 rounded-xl text-xs font-bold focus:outline-none"
            >
              {reps.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.activeLeads} active)
                </option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              className="py-1.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-xs transition-colors"
            >
              Assign Now
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {['All', 'WhatsApp', 'Meta Ads', 'Website'].map(tab => (
          <button
            key={tab}
            onClick={() => setSourceFilter(tab)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              sourceFilter === tab
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Unassigned Leads Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {filteredLeads.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center font-bold">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-sm text-slate-800">Lead Queue is Completely Clear!</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              All incoming inquiries have been assigned to your sales pod. New inquiries will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4 w-10">
                    <button
                      onClick={toggleSelectAll}
                      className="p-1 rounded text-slate-400 hover:text-slate-700"
                    >
                      {selectedLeadIds.length === filteredLeads.length ? (
                        <CheckSquare className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">Company & Lead</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Inquiry / Interest</th>
                  <th className="py-3 px-4">Est. Value</th>
                  <th className="py-3 px-4">Received</th>
                  <th className="py-3 px-4 text-right">Direct Assignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLeads.map(lead => {
                  const isSelected = selectedLeadIds.includes(lead.id);
                  const sourceBadges = {
                    WhatsApp: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    'Meta Ads': 'bg-blue-50 text-blue-700 border-blue-200',
                    Website: 'bg-purple-50 text-purple-700 border-purple-200',
                    Referral: 'bg-amber-50 text-amber-700 border-amber-200'
                  }[lead.source] || 'bg-slate-50 text-slate-700 border-slate-200';

                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? 'bg-indigo-50/40' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => toggleSelectLead(lead.id)}
                          className="p-1 rounded text-slate-400 hover:text-slate-700"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{lead.company}</div>
                        <div className="text-[11px] text-slate-500">{lead.name} • {lead.city}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-mono text-slate-700">{lead.phone}</div>
                        <div className="text-[10px] text-slate-400">{lead.email}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${sourceBadges}`}>
                          {lead.source}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 max-w-[200px] truncate text-slate-600">
                        {lead.interest}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {formatINR(lead.estimatedValue)}
                      </td>

                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {lead.receivedAt}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <select
                          defaultValue=""
                          onChange={e => {
                            if (e.target.value) {
                              onAssignLead(lead.id, e.target.value);
                            }
                          }}
                          className="text-xs font-semibold py-1.5 px-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-indigo-600 focus:outline-none cursor-pointer"
                        >
                          <option value="" disabled>
                            Assign to Rep...
                          </option>
                          {reps.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.status})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

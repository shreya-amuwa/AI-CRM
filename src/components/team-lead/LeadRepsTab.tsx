import React, { useState } from 'react';
import {
  Users,
  Search,
  PhoneCall,
  Video,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  ArrowRightLeft,
  X,
  Mail,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';
import { TeamRepPerformance } from '../../types/crm';

interface LeadRepsTabProps {
  reps: TeamRepPerformance[];
  onUpdateStatus: (repId: string, status: 'Available' | 'On Call' | 'In Demo' | 'Offline') => void;
  onReassignLeads: (fromRepId: string, toRepId: string, count: number) => void;
}

export const LeadRepsTab: React.FC<LeadRepsTabProps> = ({
  reps,
  onUpdateStatus,
  onReassignLeads
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepForReassign, setSelectedRepForReassign] = useState<TeamRepPerformance | null>(null);
  const [targetRepId, setTargetRepId] = useState<string>('');
  const [reassignCount, setReassignCount] = useState<number>(3);

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredReps = reps.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExecuteReassign = () => {
    if (!selectedRepForReassign || !targetRepId) return;
    onReassignLeads(selectedRepForReassign.id, targetRepId, reassignCount);
    setSelectedRepForReassign(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Pod Reps Management & Workload
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor real-time availability, outreach capacity, quota pacing, and rebalance pipeline load.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search reps by name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-2xs"
          />
        </div>
      </div>

      {/* Rep Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredReps.map(rep => {
          const loadPercent = Math.round((rep.activeLeads / rep.capacityMax) * 100);
          const isHighLoad = loadPercent >= 80;

          return (
            <div
              key={rep.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between space-y-4"
            >
              {/* Top Profile & Status */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={rep.avatar}
                      alt={rep.name}
                      className="w-12 h-12 rounded-xl object-cover ring-2 ring-indigo-500/20"
                    />
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{rep.name}</h3>
                      <p className="text-[11px] text-slate-500 font-mono">{rep.email}</p>
                    </div>
                  </div>

                  {/* Status Dropdown */}
                  <div className="relative group">
                    <select
                      value={rep.status}
                      onChange={e => onUpdateStatus(rep.id, e.target.value as any)}
                      className="text-[10px] font-bold py-1 px-2.5 rounded-full border bg-slate-50 text-slate-700 cursor-pointer focus:outline-none"
                    >
                      <option value="Available">🟢 Available</option>
                      <option value="On Call">🔵 On Call</option>
                      <option value="In Demo">🟣 In Demo</option>
                      <option value="Offline">⚪ Offline</option>
                    </select>
                  </div>
                </div>

                {/* Quota Progress */}
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Monthly Quota Pacing</span>
                    <span className="font-bold font-mono text-slate-900">{rep.quotaPercent}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                      style={{ width: `${Math.min(rep.quotaPercent, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                    <span>{formatINR(rep.revenueClosed)}</span>
                    <span className="text-slate-400">Target: {formatINR(rep.targetRevenue)}</span>
                  </div>
                </div>

                {/* Pipeline Load Metric */}
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 block">Active Leads</span>
                    <span className="font-bold text-xs font-mono text-slate-800">
                      {rep.activeLeads} / {rep.capacityMax}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 block">Calls Today</span>
                    <span className="font-bold text-xs font-mono text-indigo-600">
                      {rep.callsToday}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 block">Deals Won</span>
                    <span className="font-bold text-xs font-mono text-emerald-600">
                      {rep.wonDealsMonth}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isHighLoad ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {loadPercent}% Capacity
                </span>

                <button
                  onClick={() => {
                    setSelectedRepForReassign(rep);
                    const otherRep = reps.find(r => r.id !== rep.id);
                    if (otherRep) setTargetRepId(otherRep.id);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500" />
                  <span>Rebalance Leads</span>
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* REASSIGN MODAL */}
      {selectedRepForReassign && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Rebalance Leads</h3>
                  <p className="text-[11px] text-slate-500">From {selectedRepForReassign.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedRepForReassign(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Select Destination Rep:
                </label>
                <select
                  value={targetRepId}
                  onChange={e => setTargetRepId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-600 font-medium"
                >
                  {reps
                    .filter(r => r.id !== selectedRepForReassign.id)
                    .map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.activeLeads} active leads • {r.status})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Number of Leads to Transfer:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={selectedRepForReassign.activeLeads}
                    value={reassignCount}
                    onChange={e => setReassignCount(Number(e.target.value))}
                    className="w-24 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 text-center"
                  />
                  <span className="text-xs text-slate-500">
                    of {selectedRepForReassign.activeLeads} active leads
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedRepForReassign(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReassign}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs"
              >
                Transfer Leads
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

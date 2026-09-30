import React, { useState } from 'react';
import {
  Settings,
  Target,
  ShieldCheck,
  Bell,
  Save,
  CheckCircle2,
  Users,
  Sliders,
  Sparkles
} from 'lucide-react';
import { TeamRepPerformance } from '../../types/crm';

interface LeadSettingsTabProps {
  podTarget: number;
  reps: TeamRepPerformance[];
  onUpdatePodTarget: (newTarget: number) => void;
  showToast: (msg: string) => void;
}

export const LeadSettingsTab: React.FC<LeadSettingsTabProps> = ({
  podTarget,
  reps,
  onUpdatePodTarget,
  showToast
}) => {
  const [targetVal, setTargetVal] = useState<number>(podTarget);
  const [routingMode, setRoutingMode] = useState<'round-robin' | 'capacity' | 'manual'>('round-robin');
  const [slaHours, setSlaHours] = useState<number>(24);
  const [autoReassignHours, setAutoReassignHours] = useState<number>(48);

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const handleSaveSettings = () => {
    onUpdatePodTarget(targetVal);
    showToast('Pod settings and quota targets successfully updated');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 max-w-4xl">
      
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
          Pod Configuration & Quota Targets
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Configure monthly pod quotas, lead distribution rules, and SLA escalation thresholds.
        </p>
      </div>

      {/* 1. Monthly Pod Revenue Quota */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Monthly Pod Revenue Target</h2>
            <p className="text-xs text-slate-500">Total closed won target for WabaStore Sales Pod Alpha</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Pod Quota Amount (INR):
            </label>
            <input
              type="number"
              step="50000"
              value={targetVal}
              onChange={e => setTargetVal(Number(e.target.value))}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div className="sm:pt-5">
            <span className="text-xs text-slate-500 block">Formatted Target:</span>
            <span className="text-lg font-bold font-mono text-emerald-600">
              {formatINR(targetVal)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Lead Distribution Policy */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Automatic Routing Engine</h2>
            <p className="text-xs text-slate-500">Configure how incoming WhatsApp and Meta leads are dispatched</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              id: 'round-robin' as const,
              title: 'Active Round-Robin',
              desc: 'Evenly distributes to online & available reps sequentially.'
            },
            {
              id: 'capacity' as const,
              title: 'Capacity Weighted',
              desc: 'Prioritizes reps with lowest active pipeline workload.'
            },
            {
              id: 'manual' as const,
              title: 'Team Lead Manual',
              desc: 'Holds all incoming leads in queue until you assign them.'
            }
          ].map(rule => (
            <div
              key={rule.id}
              onClick={() => setRoutingMode(rule.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                routingMode === rule.id
                  ? 'bg-indigo-50/70 border-indigo-500 ring-1 ring-indigo-500'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-900">{rule.title}</span>
                {routingMode === rule.id && (
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                )}
              </div>
              <p className="text-[11px] text-slate-500">{rule.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. SLA Escalation Windows */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">SLA Escalation Thresholds</h2>
            <p className="text-xs text-slate-500">Set reminder windows to prevent lead leakage</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Overdue Alert Threshold (Hours):
            </label>
            <input
              type="number"
              value={slaHours}
              onChange={e => setSlaHours(Number(e.target.value))}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
            />
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              Flagged in SLA Radar when no action logged within this time.
            </span>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Automatic Reassignment Window (Hours):
            </label>
            <input
              type="number"
              value={autoReassignHours}
              onChange={e => setAutoReassignHours(Number(e.target.value))}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
            />
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              Prompt Team Lead to reassign lead if stagnant after this duration.
            </span>
          </div>
        </div>
      </div>

      {/* Save Settings Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSaveSettings}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs flex items-center gap-2 transition-all active:scale-95"
        >
          <Save className="w-4 h-4" />
          <span>Save Pod Configuration</span>
        </button>
      </div>

    </div>
  );
};

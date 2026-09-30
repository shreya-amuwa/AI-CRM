import React, { useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  ArrowRightLeft,
  CheckCircle2,
  Phone,
  MessageSquare,
  Building2,
  User,
  ShieldAlert
} from 'lucide-react';
import { TeamRepPerformance } from '../../types/crm';

interface LeadSlaRadarTabProps {
  reps: TeamRepPerformance[];
  onNudgeRep: (repName: string, taskTitle: string) => void;
  onReassignOverdue: (taskLead: string, toRepId: string) => void;
}

export const LeadSlaRadarTab: React.FC<LeadSlaRadarTabProps> = ({
  reps,
  onNudgeRep,
  onReassignOverdue
}) => {
  const [reassignModalTarget, setReassignModalTarget] = useState<any | null>(null);
  const [selectedTargetRep, setSelectedTargetRep] = useState<string>(reps[0]?.id || '');

  // Overdue items mock data for Pod Alpha
  const [overdueTasks, setOverdueTasks] = useState([
    {
      id: 'OVD-101',
      leadCompany: 'Urban Crafts Studio',
      clientName: 'Sunil Rao',
      clientPhone: '+91 99112 88776',
      assignedRepId: 'tm-sneha',
      assignedRepName: 'Sneha Deshmukh',
      taskType: 'WhatsApp Demo Follow-up',
      overdueSince: '48 hours overdue',
      priority: 'High',
      dealValue: 65000,
      notes: 'Client was ready for catalog demo, no contact logged since Wednesday.'
    },
    {
      id: 'OVD-102',
      leadCompany: 'Zenith Retail Chain',
      clientName: 'Vivek Oberoi',
      clientPhone: '+91 97112 34567',
      assignedRepId: 'tm-rahul',
      assignedRepName: 'Rahul Kumar',
      taskType: 'Commercial Proposal Follow-up',
      overdueSince: '36 hours overdue',
      priority: 'High',
      dealValue: 180000,
      notes: 'Commercial quotation sent on Tuesday, follow-up call missed.'
    },
    {
      id: 'OVD-103',
      leadCompany: 'Deshmukh Agro Foods',
      clientName: 'Nitin Deshmukh',
      clientPhone: '+91 98223 99881',
      assignedRepId: 'tm-sneha',
      assignedRepName: 'Sneha Deshmukh',
      taskType: 'Payment Link Resend',
      overdueSince: '28 hours overdue',
      priority: 'Medium',
      dealValue: 95000,
      notes: 'Payment gateway link expired, client requested fresh invoice link.'
    },
    {
      id: 'OVD-104',
      leadCompany: 'Metro Healthcare Clinics',
      clientName: 'Dr. Alok Verma',
      clientPhone: '+91 98443 11229',
      assignedRepId: 'tm-rohan',
      assignedRepName: 'Rohan Varma',
      taskType: 'API Security Document Sharing',
      overdueSince: '24 hours overdue',
      priority: 'Medium',
      dealValue: 85000,
      notes: 'Rep marked as offline, hospital security compliance query pending.'
    }
  ]);

  const handleExecuteReassign = () => {
    if (!reassignModalTarget || !selectedTargetRep) return;
    onReassignOverdue(reassignModalTarget.leadCompany, selectedTargetRep);
    setOverdueTasks(overdueTasks.filter(t => t.id !== reassignModalTarget.id));
    setReassignModalTarget(null);
  };

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              SLA & Lead Leakage Radar
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
              {overdueTasks.length} Escalations
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Strict SLA monitor: Detect leads slipping through the cracks without follow-up for &gt;24 hours.
          </p>
        </div>
      </div>

      {/* SLA Policy Summary Card */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Pod SLA Policy: 24-Hour Follow-up Guarantee
            </h3>
            <p className="text-xs text-slate-500">
              Any lead without logged outreach after 24 hours triggers a Team Lead escalation. Stalled leads can be reassigned in 1 click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <span className="text-[11px] text-slate-400 block uppercase font-bold">Risk Value</span>
            <span className="text-lg font-bold font-mono text-rose-600">
              {formatINR(overdueTasks.reduce((s, t) => s + t.dealValue, 0))}
            </span>
          </div>
        </div>
      </div>

      {/* Escalated Tasks List */}
      <div className="space-y-3">
        {overdueTasks.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/80 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">Zero SLA Breaches!</h3>
            <p className="text-xs text-slate-500">All pod leads and follow-ups are up to date within the 24-hour window.</p>
          </div>
        ) : (
          overdueTasks.map(task => (
            <div
              key={task.id}
              className="bg-white rounded-2xl border border-rose-200/80 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-rose-300 transition-all"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-bold text-sm text-slate-900">{task.leadCompany}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                    {task.overdueSince}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                    {task.taskType}
                  </span>
                  <span className="font-mono font-bold text-xs text-indigo-600">
                    {formatINR(task.dealValue)}
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  {task.notes}
                </p>

                <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                  <span>Client: <strong>{task.clientName}</strong> ({task.clientPhone})</span>
                  <span>•</span>
                  <span>Assigned Rep: <strong className="text-slate-800">{task.assignedRepName}</strong></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onNudgeRep(task.assignedRepName, task.taskType)}
                  className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold border border-amber-200/80 flex items-center gap-1.5 transition-colors"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Nudge Rep</span>
                </button>

                <button
                  onClick={() => {
                    setReassignModalTarget(task);
                    const otherRep = reps.find(r => r.id !== task.assignedRepId && r.status !== 'Offline');
                    if (otherRep) setSelectedTargetRep(otherRep.id);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Reassign Now</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Reassign Modal */}
      {reassignModalTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Reassign Stalled Lead</h3>
                  <p className="text-[11px] text-slate-500">{reassignModalTarget.leadCompany}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Select an active sales rep to immediately take over this lead and contact the client:
              </p>

              <select
                value={selectedTargetRep}
                onChange={e => setSelectedTargetRep(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:border-indigo-600"
              >
                {reps.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.activeLeads} leads • {r.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReassignModalTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReassign}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs"
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

import React, { useState } from 'react';
import {
  AlertCircle, ShieldAlert, CheckCircle2, Clock, Wrench, Bug,
  ChevronRight, ArrowUpRight, Search, Filter, Sparkles, Building2
} from 'lucide-react';

interface IssueCategory {
  id: string;
  category: string;
  totalComplaints: number;
  criticalCount: number;
  priority: 'Critical' | 'High' | 'Medium';
  status: 'Investigating' | 'Patch in Testing' | 'Fix Deployed' | 'Closed';
  assignedLead: string;
  affectedAccounts: number;
  rootCause: string;
  targetResolution: string;
}

export const SUPPORT_ISSUES_DATA: IssueCategory[] = [
  {
    id: 'ISS-01',
    category: 'Meta WhatsApp Template 504 Timeout',
    totalComplaints: 34,
    criticalCount: 14,
    priority: 'Critical',
    status: 'Patch in Testing',
    assignedLead: 'Neha Kulkarni (Eng Lead)',
    affectedAccounts: 18,
    rootCause: 'Rate-limiting spike during festive bulk campaign dispatches across Meta Graph v20.0 endpoints.',
    targetResolution: 'Deploy batch queue throttler with 150 msg/sec limit'
  },
  {
    id: 'ISS-02',
    category: 'Inbound Webhook Signature Verification (HMAC)',
    totalComplaints: 28,
    criticalCount: 11,
    priority: 'Critical',
    status: 'Investigating',
    assignedLead: 'Aakash Singhal (Tech Lead)',
    affectedAccounts: 12,
    rootCause: 'Payload secret key mismatch following automated key rotation cycle on third-party webhook relays.',
    targetResolution: 'Update dual-key acceptance window for 48 hours'
  },
  {
    id: 'ISS-03',
    category: 'Catalog & Inventory SKU Sync Delays',
    totalComplaints: 22,
    criticalCount: 5,
    priority: 'High',
    status: 'Fix Deployed',
    assignedLead: 'Deepak Verma',
    affectedAccounts: 9,
    rootCause: 'Shopify/WooCommerce image thumbnail processing concurrency bottleneck on image resize workers.',
    targetResolution: 'Auto-scaled thumbnail worker pool from 2 to 6 instances'
  },
  {
    id: 'ISS-04',
    category: 'Payment Gateway Order Webhook Failures',
    totalComplaints: 18,
    criticalCount: 4,
    priority: 'High',
    status: 'Patch in Testing',
    assignedLead: 'Kavita Roy',
    affectedAccounts: 8,
    rootCause: 'Razorpay & Cashfree callback retry timeout when payload latency exceeds 3,000ms.',
    targetResolution: 'Asynchronous ACK response + background reconciliation queue'
  },
  {
    id: 'ISS-05',
    category: 'Multi-Agent Support Desk Session Disconnects',
    totalComplaints: 12,
    criticalCount: 0,
    priority: 'Medium',
    status: 'Closed',
    assignedLead: 'Manish Sharma',
    affectedAccounts: 5,
    rootCause: 'WebSocket heartbeat timeout interval was set too aggressively (15s instead of 45s).',
    targetResolution: 'WebSocket ping-pong configuration extended to 60s'
  }
];

export const SupportHeadIssuesView: React.FC = () => {
  const [issues] = useState<IssueCategory[]>(SUPPORT_ISSUES_DATA);
  const [selectedIssue, setSelectedIssue] = useState<IssueCategory | null>(null);

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'Investigating':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Investigating</span>;
      case 'Patch in Testing':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">Patch in Testing</span>;
      case 'Fix Deployed':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">Fix Deployed</span>;
      case 'Closed':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Closed</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{s}</span>;
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Bug className="w-6 h-6 text-rose-600" />
            <span>Customer Issues &amp; Complaints Radar</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track categorized problems, affected accounts, priority escalations, and engineering patch status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
            114 Total Complaints Grouped into 5 Categories
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {issues.map(iss => (
          <div
            key={iss.id}
            onClick={() => setSelectedIssue(iss)}
            className="bg-white border border-slate-200 hover:border-rose-300 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer space-y-3.5 flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-slate-400">{iss.id}</span>
                {getStatusBadge(iss.status)}
              </div>
              <h3 className="text-sm font-bold text-slate-900 leading-snug">{iss.category}</h3>
              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{iss.rootCause}</p>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-500">
                <span>Complaints Logged:</span>
                <span className="font-mono font-bold text-slate-900">{iss.totalComplaints} tickets</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>Affected Accounts:</span>
                <span className="font-mono font-semibold text-rose-700">{iss.affectedAccounts} accounts</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>Engineering Owner:</span>
                <span className="font-semibold text-slate-800">{iss.assignedLead}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-rose-600">
              <span>View Resolution Patch</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>

      {/* Selected Issue Modal */}
      {selectedIssue && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="font-mono text-xs font-bold text-slate-400">{selectedIssue.id}</span>
                <h3 className="font-bold text-base text-slate-900">{selectedIssue.category}</h3>
              </div>
              <button onClick={() => setSelectedIssue(null)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Identified Root Cause</span>
                <p className="text-slate-800 leading-relaxed">{selectedIssue.rootCause}</p>
              </div>

              <div className="p-3 bg-teal-50/70 border border-teal-100 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-teal-800 block">Engineering Fix &amp; Patch</span>
                <p className="text-slate-800 leading-relaxed">{selectedIssue.targetResolution}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-600 bg-slate-50 p-3 rounded-xl">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Owner</span>
                  <span className="font-semibold text-slate-800">{selectedIssue.assignedLead}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Impact</span>
                  <span className="font-semibold text-slate-800">{selectedIssue.affectedAccounts} Enterprise Clients</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  alert(`Paging engineering tier-3 deployment on ${selectedIssue.id}`);
                  setSelectedIssue(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
              >
                Dispatch Engineering Hotfix
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

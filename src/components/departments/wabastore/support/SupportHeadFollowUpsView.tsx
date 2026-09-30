import React, { useState } from 'react';
import {
  Clock, CheckCircle2, AlertTriangle, Phone, MessageSquare, Video,
  Search, Filter, Send, Bell, Calendar, UserCheck
} from 'lucide-react';

interface FollowUpItem {
  id: string;
  customer: string;
  company: string;
  type: 'Scheduled Callback' | 'Awaiting Client Action' | 'Post-Fix Check-in' | 'SLA Overdue Alert';
  scheduledTime: string;
  assignedAgent: string;
  channel: 'Phone Call' | 'WhatsApp Touch' | 'Screen-share Demo' | 'Email';
  status: 'Pending' | 'Completed' | 'Overdue';
  notes: string;
}

export const SUPPORT_FOLLOW_UPS_DATA: FollowUpItem[] = [
  {
    id: 'FOL-101',
    customer: 'Rajesh Mehta',
    company: 'Mehta Traders',
    type: 'Scheduled Callback',
    scheduledTime: 'Today, 11:30 AM',
    assignedAgent: 'Neha Kulkarni',
    channel: 'Phone Call',
    status: 'Pending',
    notes: 'Verify festive campaign template batch queue throughput with CTO.'
  },
  {
    id: 'FOL-102',
    customer: 'Sneha Patil',
    company: 'Patil Enterprises',
    type: 'SLA Overdue Alert',
    scheduledTime: 'Today, 09:00 AM (2h Overdue)',
    assignedAgent: 'Aakash Singhal',
    channel: 'Screen-share Demo',
    status: 'Overdue',
    notes: 'Immediate screen-share needed to inspect 12 zero-stock SKU webhook payloads.'
  },
  {
    id: 'FOL-103',
    customer: 'Amit Joshi',
    company: 'NextGen Living',
    type: 'Awaiting Client Action',
    scheduledTime: 'Today, 02:00 PM',
    assignedAgent: 'Kavita Roy',
    channel: 'WhatsApp Touch',
    status: 'Pending',
    notes: 'Customer promised to share Razorpay payment webhook transaction ID.'
  },
  {
    id: 'FOL-104',
    customer: 'Vikram Malhotra',
    company: 'Zenith Retail Chain',
    type: 'SLA Overdue Alert',
    scheduledTime: 'Today, 08:15 AM (3h Overdue)',
    assignedAgent: 'Neha Kulkarni',
    channel: 'Email',
    status: 'Overdue',
    notes: 'Send updated HMAC public verification certificate for their staging server.'
  },
  {
    id: 'FOL-105',
    customer: 'Deepak Deshmukh',
    company: 'Deshmukh Agro',
    type: 'Post-Fix Check-in',
    scheduledTime: 'Today, 03:30 PM',
    assignedAgent: 'Pooja Nair',
    channel: 'WhatsApp Touch',
    status: 'Pending',
    notes: 'Confirm catalog images render without distortion in live WhatsApp store.'
  },
  {
    id: 'FOL-106',
    customer: 'Isha Verma',
    company: 'Fashion House',
    type: 'Scheduled Callback',
    scheduledTime: 'Today, 12:00 PM',
    assignedAgent: 'Manish Sharma',
    channel: 'Phone Call',
    status: 'Completed',
    notes: 'Added 2 telecallers and verified dashboard login credentials over call.'
  }
];

export const SupportHeadFollowUpsView: React.FC = () => {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>(SUPPORT_FOLLOW_UPS_DATA);
  const [nudgedAgents, setNudgedAgents] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'All' | 'Overdue' | 'Scheduled' | 'Pending'>('All');

  const handleNudge = (id: string, agent: string) => {
    setNudgedAgents(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      alert(`Urgent SLA push notification dispatched to ${agent}`);
    }, 150);
  };

  const filtered = followUps.filter(item => {
    if (activeTab === 'Overdue') return item.status === 'Overdue';
    if (activeTab === 'Scheduled') return item.type === 'Scheduled Callback';
    if (activeTab === 'Pending') return item.status === 'Pending';
    return true;
  });

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Clock className="w-6 h-6 text-amber-600" />
            <span>Support Follow-ups &amp; Callback SLA Monitor</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor pending responses, client callbacks, post-fix verification, and unresolved SLA breaches
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
            2 Overdue Follow-ups Require Immediate Attention
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(['All', 'Overdue', 'Scheduled', 'Pending'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === tab
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab} Follow-ups
          </button>
        ))}
      </div>

      {/* Cards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(f => (
          <div
            key={f.id}
            className={`bg-white border rounded-2xl p-5 shadow-xs space-y-3 transition-all ${
              f.status === 'Overdue'
                ? 'border-rose-300 bg-rose-50/20'
                : f.status === 'Completed'
                ? 'border-emerald-200 bg-emerald-50/10'
                : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-900">{f.id}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  f.status === 'Overdue'
                    ? 'bg-rose-100 text-rose-700'
                    : f.status === 'Completed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {f.type}
                </span>
              </div>
              <span className="font-mono text-xs font-bold text-slate-700">{f.scheduledTime}</span>
            </div>

            <div>
              <h3 className="font-bold text-sm text-slate-900">{f.customer} &bull; {f.company}</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{f.notes}</p>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Assigned: <strong className="text-slate-800">{f.assignedAgent}</strong> ({f.channel})
              </span>

              {f.status === 'Overdue' ? (
                <button
                  onClick={() => handleNudge(f.id, f.assignedAgent)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                    nudgedAgents[f.id]
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 hover:bg-rose-700 text-white shadow-2xs'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{nudgedAgents[f.id] ? 'Nudged!' : 'Nudge Agent'}</span>
                </button>
              ) : (
                <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700">
                  {f.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  PhoneCall,
  Search,
  Filter,
  Video,
  MessageSquare,
  Users,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  BellRing,
  ArrowRightLeft,
  X
} from 'lucide-react';

interface FollowUpItem {
  id: string;
  clientName: string;
  company: string;
  phone: string;
  assignedRep: string;
  pod: 'Pod Alpha' | 'Pod Beta';
  type: 'Call' | 'Demo' | 'WhatsApp' | 'Meeting';
  scheduledTime: string;
  status: 'Upcoming' | 'Overdue' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  notes: string;
}

export const SalesHeadFollowUpsView: React.FC = () => {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([
    {
      id: 'FLP-101',
      clientName: 'Sunil Rao',
      company: 'Urban Crafts Studio',
      phone: '+91 99112 88776',
      assignedRep: 'Sneha Deshmukh',
      pod: 'Pod Alpha',
      type: 'Demo',
      scheduledTime: 'Yesterday, 04:00 PM',
      status: 'Overdue',
      priority: 'High',
      notes: 'Demo on WhatsApp catalog store setup missed.'
    },
    {
      id: 'FLP-102',
      clientName: 'Vivek Oberoi',
      company: 'Zenith Retail Chain',
      phone: '+91 97112 34567',
      assignedRep: 'Rahul Kumar',
      pod: 'Pod Alpha',
      type: 'Call',
      scheduledTime: 'Yesterday, 02:30 PM',
      status: 'Overdue',
      priority: 'High',
      notes: 'Commercial agreement revision follow-up.'
    },
    {
      id: 'FLP-103',
      clientName: 'Nitin Deshmukh',
      company: 'Deshmukh Agro Foods',
      phone: '+91 98223 99881',
      assignedRep: 'Sneha Deshmukh',
      pod: 'Pod Alpha',
      type: 'WhatsApp',
      scheduledTime: 'Yesterday, 11:30 AM',
      status: 'Overdue',
      priority: 'Medium',
      notes: 'Resend payment link for annual plan.'
    },
    {
      id: 'FLP-104',
      clientName: 'Dr. Alok Verma',
      company: 'Metro Healthcare Clinics',
      phone: '+91 98443 11229',
      assignedRep: 'Ananya Verma',
      pod: 'Pod Beta',
      type: 'Meeting',
      scheduledTime: 'Today, 02:00 PM',
      status: 'Upcoming',
      priority: 'High',
      notes: 'Security compliance review meeting with CTO.'
    },
    {
      id: 'FLP-105',
      clientName: 'Gaurav Bansal',
      company: 'Kuber Logistics Hub',
      phone: '+91 99887 66554',
      assignedRep: 'Sameer Kulkarni',
      pod: 'Pod Beta',
      type: 'Demo',
      scheduledTime: 'Today, 04:30 PM',
      status: 'Upcoming',
      priority: 'High',
      notes: 'High-concurrency webhook integration walkthrough.'
    },
    {
      id: 'FLP-106',
      clientName: 'Rajesh Singhania',
      company: 'Singhania Textiles',
      phone: '+91 98231 44556',
      assignedRep: 'Priya Nair',
      pod: 'Pod Alpha',
      type: 'Call',
      scheduledTime: 'Today, 05:30 PM',
      status: 'Upcoming',
      priority: 'Medium',
      notes: 'Review discount approval from Team Lead.'
    }
  ]);

  const [filterType, setFilterType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerNudge = (rep: string, client: string) => {
    setToastMsg(`🔔 Urgent follow-up alert dispatched to ${rep} for ${client}.`);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const filteredItems = followUps.filter(f => {
    if (filterType !== 'All' && f.type !== filterType) return false;
    if (filterStatus !== 'All' && f.status !== filterStatus) return false;
    if (
      searchQuery &&
      !f.company.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !f.clientName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !f.assignedRep.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white py-3 px-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in">
          <BellRing className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold">{toastMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Sales Follow-ups & Activity SLA
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
              38 Pending Activities
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor client calls, product demos, WhatsApp touches, and enforce 24-hour response SLAs across pods.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by client or rep..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-2xs"
          />
        </div>
      </div>

      {/* Activity Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Calls Scheduled</span>
          <p className="text-2xl font-bold font-heading text-blue-600 mt-1 font-mono">28</p>
          <span className="text-[10px] text-slate-400">Scheduled today</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Live Demos</span>
          <p className="text-2xl font-bold font-heading text-purple-600 mt-1 font-mono">9</p>
          <span className="text-[10px] text-slate-400">Product walkthroughs</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">WhatsApp Touches</span>
          <p className="text-2xl font-bold font-heading text-emerald-600 mt-1 font-mono">42</p>
          <span className="text-[10px] text-slate-400">Catalog inquiries</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-rose-200 shadow-xs bg-rose-50/40">
          <span className="text-xs font-semibold text-rose-800">Overdue Breaches</span>
          <p className="text-2xl font-bold font-heading text-rose-600 mt-1 font-mono">6</p>
          <span className="text-[10px] text-rose-700 font-bold">&gt;24 hrs without contact</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase mr-1">Activity Type:</span>
        {['All', 'Call', 'Demo', 'WhatsApp', 'Meeting'].map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filterType === t
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}

        <div className="h-4 w-px bg-slate-200 mx-2 hidden sm:block" />

        <span className="text-xs font-bold text-slate-400 uppercase mr-1">Status:</span>
        {['All', 'Upcoming', 'Overdue'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filterStatus === s
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Follow-ups Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Client & Company</th>
                <th className="py-3 px-4">Activity Type</th>
                <th className="py-3 px-4">Scheduled Slot</th>
                <th className="py-3 px-4">Assigned Rep</th>
                <th className="py-3 px-4">Sales Pod</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-right">Supervisory Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredItems.map(item => {
                const isOverdue = item.status === 'Overdue';

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isOverdue ? 'bg-rose-50/20' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{item.company}</div>
                      <div className="text-[11px] text-slate-500">{item.clientName} &bull; {item.phone}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {item.type}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-600">
                      {item.scheduledTime}
                    </td>

                    <td className="py-3.5 px-4 font-semibold text-slate-800">
                      {item.assignedRep}
                    </td>

                    <td className="py-3.5 px-4 text-slate-600">
                      {item.pod}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isOverdue
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 max-w-xs truncate text-slate-500">
                      {item.notes}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      {isOverdue ? (
                        <button
                          onClick={() => triggerNudge(item.assignedRep, item.company)}
                          className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold flex items-center gap-1.5 ml-auto transition-colors"
                        >
                          <BellRing className="w-3 h-3" />
                          <span>Nudge Rep</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">On Track</span>
                      )}
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

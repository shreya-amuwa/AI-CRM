import React, { useState } from 'react';
import {
  Award, Users, Clock, CheckCircle2, Star, ShieldCheck,
  Search, Filter, Bell, ArrowUpRight
} from 'lucide-react';

interface SupportStaff {
  id: string;
  name: string;
  role: 'Team Lead' | 'Senior Specialist' | 'Support Executive';
  pod: 'Tier-1 Operations' | 'Tier-2 Technical Escalations';
  ticketsHandled: number;
  avgResponseTime: string;
  resolutionRate: string;
  pendingTickets: number;
  csatScore: number;
  status: 'Available' | 'In Chat' | 'On Call' | 'Offline';
}

export const SUPPORT_TEAM_DATA: SupportStaff[] = [
  {
    id: 'STAFF-01',
    name: 'Aakash Singhal',
    role: 'Team Lead',
    pod: 'Tier-1 Operations',
    ticketsHandled: 84,
    avgResponseTime: '11m',
    resolutionRate: '96.4%',
    pendingTickets: 2,
    csatScore: 4.9,
    status: 'Available'
  },
  {
    id: 'STAFF-02',
    name: 'Neha Kulkarni',
    role: 'Team Lead',
    pod: 'Tier-2 Technical Escalations',
    ticketsHandled: 58,
    avgResponseTime: '14m',
    resolutionRate: '94.8%',
    pendingTickets: 4,
    csatScore: 4.9,
    status: 'In Chat'
  },
  {
    id: 'STAFF-03',
    name: 'Kavita Roy',
    role: 'Senior Specialist',
    pod: 'Tier-2 Technical Escalations',
    ticketsHandled: 48,
    avgResponseTime: '12m',
    resolutionRate: '95.2%',
    pendingTickets: 3,
    csatScore: 4.8,
    status: 'Available'
  },
  {
    id: 'STAFF-04',
    name: 'Manish Sharma',
    role: 'Support Executive',
    pod: 'Tier-1 Operations',
    ticketsHandled: 42,
    avgResponseTime: '15m',
    resolutionRate: '93.5%',
    pendingTickets: 3,
    csatScore: 4.7,
    status: 'On Call'
  },
  {
    id: 'STAFF-05',
    name: 'Pooja Nair',
    role: 'Support Executive',
    pod: 'Tier-1 Operations',
    ticketsHandled: 39,
    avgResponseTime: '13m',
    resolutionRate: '94.1%',
    pendingTickets: 2,
    csatScore: 4.8,
    status: 'In Chat'
  },
  {
    id: 'STAFF-06',
    name: 'Deepak Verma',
    role: 'Senior Specialist',
    pod: 'Tier-2 Technical Escalations',
    ticketsHandled: 35,
    avgResponseTime: '18m',
    resolutionRate: '91.4%',
    pendingTickets: 4,
    csatScore: 4.6,
    status: 'Available'
  },
  {
    id: 'STAFF-07',
    name: 'Ritu Sen',
    role: 'Support Executive',
    pod: 'Tier-1 Operations',
    ticketsHandled: 31,
    avgResponseTime: '14m',
    resolutionRate: '96.0%',
    pendingTickets: 1,
    csatScore: 4.9,
    status: 'Available'
  },
  {
    id: 'STAFF-08',
    name: 'Siddharth Jain',
    role: 'Support Executive',
    pod: 'Tier-1 Operations',
    ticketsHandled: 29,
    avgResponseTime: '22m',
    resolutionRate: '88.5%',
    pendingTickets: 5,
    csatScore: 4.4,
    status: 'Offline'
  }
];

export const SupportHeadTeamPerformanceView: React.FC = () => {
  const [team] = useState<SupportStaff[]>(SUPPORT_TEAM_DATA);
  const [podFilter, setPodFilter] = useState('All');

  const filtered = team.filter(m => {
    if (podFilter !== 'All' && m.pod !== podFilter) return false;
    return true;
  });

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'Available':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Available</span>;
      case 'In Chat':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">In Chat</span>;
      case 'On Call':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">On Call</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">Offline</span>;
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Award className="w-6 h-6 text-teal-600" />
            <span>Support Team Leaders &amp; Members Performance</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Supervise team leads, frontline support reps, tickets handled, response speeds, and customer satisfaction
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={podFilter}
            onChange={e => setPodFilter(e.target.value)}
            className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500 font-semibold"
          >
            <option value="All">All Support Pods</option>
            <option value="Tier-1 Operations">Tier-1 Operations Pod</option>
            <option value="Tier-2 Technical Escalations">Tier-2 Technical Escalations Pod</option>
          </select>
        </div>
      </div>

      {/* Roster Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Support Specialist</th>
                <th className="py-3.5 px-4">Role &amp; Pod</th>
                <th className="py-3.5 px-4">Presence</th>
                <th className="py-3.5 px-4">Tickets Handled</th>
                <th className="py-3.5 px-4">Avg Response Time</th>
                <th className="py-3.5 px-4">Resolution Rate</th>
                <th className="py-3.5 px-4">Pending Queue</th>
                <th className="py-3.5 px-4">CSAT Rating</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(staff => (
                <tr key={staff.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center text-xs">
                        {staff.name.charAt(0)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 block">{staff.name}</span>
                        <span className="font-mono text-[10px] text-slate-400">{staff.id}</span>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-slate-800 block">{staff.role}</span>
                    <span className="text-[10px] text-slate-400">{staff.pod}</span>
                  </td>

                  <td className="py-3.5 px-4">
                    {getStatusBadge(staff.status)}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {staff.ticketsHandled}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold text-teal-700">
                    {staff.avgResponseTime}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {staff.resolutionRate}
                  </td>

                  <td className="py-3.5 px-4 font-mono">
                    {staff.pendingTickets > 3 ? (
                      <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-bold border border-amber-200">
                        {staff.pendingTickets} Pending
                      </span>
                    ) : (
                      <span className="text-slate-600 font-semibold">{staff.pendingTickets} Pending</span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold text-amber-600">
                    ⭐ {staff.csatScore.toFixed(1)} / 5.0
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => alert(`Assigned ticket capacity adjusted for ${staff.name}`)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                    >
                      Manage Load
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Award,
  Users,
  Search,
  Filter,
  TrendingUp,
  Target,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Building2,
  ChevronDown
} from 'lucide-react';

interface MemberPerformanceRecord {
  id: string;
  name: string;
  role: 'Team Lead' | 'Sales Executive' | 'Senior Specialist';
  pod: 'Pod Alpha' | 'Pod Beta';
  leadsHandled: number;
  followUpsCompleted: number;
  wonDeals: number;
  conversionRate: number;
  revenue: number;
  target: number;
  pacingPct: number;
  status: 'Top Performer' | 'On Track' | 'Needs Attention';
}

export const SalesHeadTeamPerformanceView: React.FC = () => {
  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const records: MemberPerformanceRecord[] = [
    // Team Leaders
    {
      id: 'TL-01',
      name: 'Vikram Deshmukh',
      role: 'Team Lead',
      pod: 'Pod Alpha',
      leadsHandled: 124,
      followUpsCompleted: 98,
      wonDeals: 18,
      conversionRate: 28.5,
      revenue: 4850000,
      target: 6000000,
      pacingPct: 80.8,
      status: 'Top Performer'
    },
    {
      id: 'TL-02',
      name: 'Rajesh Gupta',
      role: 'Team Lead',
      pod: 'Pod Beta',
      leadsHandled: 110,
      followUpsCompleted: 82,
      wonDeals: 12,
      conversionRate: 22.4,
      revenue: 3600000,
      target: 5000000,
      pacingPct: 72.0,
      status: 'On Track'
    },
    // Reps
    {
      id: 'REP-01',
      name: 'Amit Patel',
      role: 'Senior Specialist',
      pod: 'Pod Alpha',
      leadsHandled: 28,
      followUpsCompleted: 24,
      wonDeals: 4,
      conversionRate: 29.1,
      revenue: 1040000,
      target: 1200000,
      pacingPct: 86.6,
      status: 'Top Performer'
    },
    {
      id: 'REP-02',
      name: 'Priya Nair',
      role: 'Sales Executive',
      pod: 'Pod Alpha',
      leadsHandled: 28,
      followUpsCompleted: 26,
      wonDeals: 4,
      conversionRate: 28.5,
      revenue: 980000,
      target: 1200000,
      pacingPct: 81.6,
      status: 'Top Performer'
    },
    {
      id: 'REP-03',
      name: 'Sameer Kulkarni',
      role: 'Sales Executive',
      pod: 'Pod Beta',
      leadsHandled: 26,
      followUpsCompleted: 20,
      wonDeals: 3,
      conversionRate: 24.2,
      revenue: 890000,
      target: 1100000,
      pacingPct: 80.9,
      status: 'On Track'
    },
    {
      id: 'REP-04',
      name: 'Rahul Kumar',
      role: 'Sales Executive',
      pod: 'Pod Alpha',
      leadsHandled: 24,
      followUpsCompleted: 18,
      wonDeals: 3,
      conversionRate: 24.0,
      revenue: 850000,
      target: 1100000,
      pacingPct: 77.2,
      status: 'On Track'
    },
    {
      id: 'REP-05',
      name: 'Ananya Verma',
      role: 'Sales Executive',
      pod: 'Pod Beta',
      leadsHandled: 22,
      followUpsCompleted: 16,
      wonDeals: 3,
      conversionRate: 22.8,
      revenue: 780000,
      target: 1000000,
      pacingPct: 78.0,
      status: 'On Track'
    },
    {
      id: 'REP-06',
      name: 'Sneha Deshmukh',
      role: 'Sales Executive',
      pod: 'Pod Alpha',
      leadsHandled: 20,
      followUpsCompleted: 14,
      wonDeals: 2,
      conversionRate: 22.0,
      revenue: 740000,
      target: 1000000,
      pacingPct: 74.0,
      status: 'On Track'
    },
    {
      id: 'REP-07',
      name: 'Rohan Varma',
      role: 'Sales Executive',
      pod: 'Pod Alpha',
      leadsHandled: 18,
      followUpsCompleted: 12,
      wonDeals: 2,
      conversionRate: 21.5,
      revenue: 680000,
      target: 900000,
      pacingPct: 75.5,
      status: 'On Track'
    },
    {
      id: 'REP-08',
      name: 'Rajesh Patel',
      role: 'Sales Executive',
      pod: 'Pod Beta',
      leadsHandled: 16,
      followUpsCompleted: 10,
      wonDeals: 2,
      conversionRate: 18.0,
      revenue: 560000,
      target: 900000,
      pacingPct: 62.2,
      status: 'Needs Attention'
    }
  ];

  const [roleFilter, setRoleFilter] = useState<'All' | 'Team Lead' | 'Reps'>('All');
  const [podFilter, setPodFilter] = useState<'All' | 'Pod Alpha' | 'Pod Beta'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecords = records.filter(r => {
    if (roleFilter === 'Team Lead' && r.role !== 'Team Lead') return false;
    if (roleFilter === 'Reps' && r.role === 'Team Lead') return false;
    if (podFilter !== 'All' && r.pod !== podFilter) return false;
    if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Sales Team Performance
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
              2 Team Leads &bull; 8 Core Executives
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor Team Leaders and Sales Executives across handled volume, follow-up adherence, closed revenue, and targets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as any)}
            className="py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-600 shadow-2xs"
          >
            <option value="All">All Roles</option>
            <option value="Team Lead">Team Leaders Only</option>
            <option value="Reps">Sales Executives Only</option>
          </select>

          {/* Pod Filter */}
          <select
            value={podFilter}
            onChange={e => setPodFilter(e.target.value as any)}
            className="py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-600 shadow-2xs"
          >
            <option value="All">All Pods</option>
            <option value="Pod Alpha">Pod Alpha (Vikram)</option>
            <option value="Pod Beta">Pod Beta (Rajesh)</option>
          </select>

          {/* Search */}
          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search employee..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Team Leaders Highlights Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {records.filter(r => r.role === 'Team Lead').map(tl => (
          <div
            key={tl.id}
            className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between gap-4 hover:border-slate-300 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-base ring-2 ring-indigo-500/20">
                {tl.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-slate-900">{tl.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                    {tl.role}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{tl.pod} &bull; {tl.wonDeals} Deals Closed</p>
              </div>
            </div>

            <div className="text-right">
              <span className="font-mono font-bold text-emerald-600 text-base block">
                {formatINR(tl.revenue)}
              </span>
              <span className="text-[11px] font-bold text-slate-500 font-mono">
                {tl.pacingPct}% of {formatINR(tl.target)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Comprehensive Performance Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Sales Pod</th>
                <th className="py-3 px-4">Leads Handled</th>
                <th className="py-3 px-4">Follow-ups</th>
                <th className="py-3 px-4">Deals Closed</th>
                <th className="py-3 px-4">Win Rate</th>
                <th className="py-3 px-4">Revenue Achieved</th>
                <th className="py-3 px-4">Quota Target</th>
                <th className="py-3 px-4">Pacing</th>
                <th className="py-3 px-4 text-right">Performance Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredRecords.map(m => {
                const statusStyles: Record<string, string> = {
                  'Top Performer': 'bg-emerald-100 text-emerald-800',
                  'On Track': 'bg-blue-100 text-blue-800',
                  'Needs Attention': 'bg-amber-100 text-amber-900'
                };

                return (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {m.name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {m.role}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      {m.pod}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700">
                      {m.leadsHandled}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700">
                      {m.followUpsCompleted}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-600">
                      {m.wonDeals}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-800">
                      {m.conversionRate}%
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {formatINR(m.revenue)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-500">
                      {formatINR(m.target)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-indigo-600">
                      {m.pacingPct}%
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusStyles[m.status]}`}>
                        {m.status}
                      </span>
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

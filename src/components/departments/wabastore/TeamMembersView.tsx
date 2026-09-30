import React, { useState } from 'react';
import {
  TrendingUp, Users, Award, Target, PhoneCall, MessageSquare,
  Mail, MoreVertical, ArrowUpRight, ArrowDownRight, Zap, DollarSign
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  avatar: string;
  leadsAssigned: number;
  callsCompleted: number;
  demos: number;
  proposals: number;
  wonDeals: number;
  revenue: number;
  target: number;
  performance: number;
  status: 'active' | 'inactive' | 'on-leave';
  joinDate: string;
}

export const TeamMembersView: React.FC = () => {
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const teamMembers: TeamMember[] = [
    {
      id: 'EMP-9801',
      name: 'Ananya Verma',
      role: 'Senior Sales Executive',
      email: 'ananya.verma@wabastore.com',
      phone: '+91 98765-43210',
      avatar: 'AV',
      leadsAssigned: 25,
      callsCompleted: 45,
      demos: 8,
      proposals: 12,
      wonDeals: 4,
      revenue: 145000,
      target: 150000,
      performance: 96,
      status: 'active',
      joinDate: '2023-01-15'
    },
    {
      id: 'EMP-4421',
      name: 'Sameer Kulkarni',
      role: 'Sales Executive',
      email: 'sameer.kulkarni@wabastore.com',
      phone: '+91 97654-32109',
      avatar: 'SK',
      leadsAssigned: 22,
      callsCompleted: 38,
      demos: 6,
      proposals: 10,
      wonDeals: 3,
      revenue: 125000,
      target: 120000,
      performance: 104,
      status: 'active',
      joinDate: '2023-03-20'
    },
    {
      id: 'EMP-5532',
      name: 'Priya Sharma',
      role: 'Sales Executive',
      email: 'priya.sharma@wabastore.com',
      phone: '+91 96543-21098',
      avatar: 'PS',
      leadsAssigned: 18,
      callsCompleted: 28,
      demos: 3,
      proposals: 5,
      wonDeals: 1,
      revenue: 65000,
      target: 100000,
      performance: 65,
      status: 'on-leave',
      joinDate: '2023-06-10'
    },
    {
      id: 'EMP-7645',
      name: 'Rajesh Patel',
      role: 'Business Development Executive',
      email: 'rajesh.patel@wabastore.com',
      phone: '+91 95432-10987',
      avatar: 'RP',
      leadsAssigned: 20,
      callsCompleted: 32,
      demos: 2,
      proposals: 4,
      wonDeals: 1,
      revenue: 55000,
      target: 110000,
      performance: 50,
      status: 'active',
      joinDate: '2023-05-08'
    },
    {
      id: 'EMP-8234',
      name: 'Deepika Nair',
      role: 'Sales Executive',
      email: 'deepika.nair@wabastore.com',
      phone: '+91 94321-09876',
      avatar: 'DN',
      leadsAssigned: 21,
      callsCompleted: 42,
      demos: 7,
      proposals: 9,
      wonDeals: 2,
      revenue: 105000,
      target: 130000,
      performance: 81,
      status: 'active',
      joinDate: '2023-07-12'
    },
    {
      id: 'EMP-9012',
      name: 'Arjun Kapoor',
      role: 'Junior Sales Executive',
      email: 'arjun.kapoor@wabastore.com',
      phone: '+91 93210-98765',
      avatar: 'AK',
      leadsAssigned: 15,
      callsCompleted: 22,
      demos: 2,
      proposals: 3,
      wonDeals: 0,
      revenue: 35000,
      target: 80000,
      performance: 44,
      status: 'active',
      joinDate: '2024-02-01'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'on-leave':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getPerformanceColor = (performance: number) => {
    if (performance >= 90) return 'text-emerald-600';
    if (performance >= 75) return 'text-blue-600';
    if (performance >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerformanceBg = (performance: number) => {
    if (performance >= 90) return 'bg-emerald-50 border-emerald-200';
    if (performance >= 75) return 'bg-blue-50 border-blue-200';
    if (performance >= 60) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-100/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                Team Members 👥
              </h1>
              <p className="text-sm text-slate-600 mt-1">Manage team performance and activities</p>
            </div>
            <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-4 py-2 rounded-md font-semibold text-sm transition-all ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-4 py-2 rounded-md font-semibold text-sm transition-all ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Table
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-sm text-slate-600 mb-1">Total Team Members</p>
            <p className="text-3xl font-bold text-slate-900">{teamMembers.length}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm">
            <p className="text-sm text-emerald-600 mb-1">Active Members</p>
            <p className="text-3xl font-bold text-emerald-600">{teamMembers.filter(m => m.status === 'active').length}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-sm text-slate-600 mb-1">Total Revenue</p>
            <p className="text-3xl font-bold text-slate-900">₹{(teamMembers.reduce((sum, m) => sum + m.revenue, 0) / 1000).toFixed(0)}K</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-sm text-slate-600 mb-1">Avg Performance</p>
            <p className="text-3xl font-bold text-slate-900">{(teamMembers.reduce((sum, m) => sum + m.performance, 0) / teamMembers.length).toFixed(0)}%</p>
          </div>
        </div>

        {/* Cards View */}
        {viewMode === 'cards' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teamMembers.map((member) => (
              <div key={member.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-shadow overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-white/30 flex items-center justify-center font-bold text-white text-lg">
                      {member.avatar}
                    </div>
                    <div>
                      <h3 className="font-bold text-white">{member.name}</h3>
                      <p className="text-xs text-white/80">{member.role}</p>
                    </div>
                  </div>
                  <button className="text-white/80 hover:text-white">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-6">
                  {/* Contact Info */}
                  <div className="mb-4 space-y-2">
                    <a href={`mailto:${member.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                      <Mail className="w-4 h-4" /> {member.email}
                    </a>
                    <a href={`tel:${member.phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                      <PhoneCall className="w-4 h-4" /> {member.phone}
                    </a>
                  </div>

                  {/* Status */}
                  <div className="mb-4 flex items-center gap-2">
                    <span className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${getStatusColor(member.status)}`}>
                      {member.status === 'active' ? '🟢 Active' : member.status === 'on-leave' ? '📍 On Leave' : '⚫ Inactive'}
                    </span>
                  </div>

                  {/* Performance Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600">Performance</span>
                      <span className={`text-sm font-bold ${getPerformanceColor(member.performance)}`}>
                        {member.performance}%
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-blue-500 to-emerald-500`}
                        style={{ width: `${Math.min(member.performance, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-slate-600 mb-1">Calls</p>
                      <p className="text-xl font-bold text-slate-900">{member.callsCompleted}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-slate-600 mb-1">Demos</p>
                      <p className="text-xl font-bold text-slate-900">{member.demos}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-slate-600 mb-1">Won</p>
                      <p className="text-xl font-bold text-emerald-600">{member.wonDeals}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-slate-600 mb-1">Revenue</p>
                      <p className="text-lg font-bold text-slate-900">₹{(member.revenue / 1000).toFixed(0)}K</p>
                    </div>
                  </div>

                  {/* Target Progress */}
                  <div className="border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600">Target Progress</span>
                      <span className="text-xs font-bold text-slate-900">{((member.revenue / member.target) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                        style={{ width: `${Math.min((member.revenue / member.target) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-600 mt-2">₹{(member.revenue / 1000).toFixed(0)}K of ₹{(member.target / 1000).toFixed(0)}K</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Name</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Contact</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Calls</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Proposals</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Won</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Revenue</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((member) => (
                    <tr key={member.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center font-bold text-emerald-600">
                            {member.avatar}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{member.name}</p>
                            <p className="text-xs text-slate-600">{member.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <a href={`mailto:${member.email}`} className="text-xs text-blue-600 hover:underline">{member.email}</a>
                          <a href={`tel:${member.phone}`} className="text-xs text-blue-600 hover:underline">{member.phone}</a>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-block ${getStatusColor(member.status)}`}>
                          {member.status === 'active' ? '🟢 Active' : member.status === 'on-leave' ? '📍 On Leave' : '⚫ Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{member.callsCompleted}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{member.proposals}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-emerald-600">{member.wonDeals}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">₹{(member.revenue / 1000).toFixed(0)}K</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border font-semibold text-xs ${getPerformanceBg(member.performance)} ${getPerformanceColor(member.performance)}`}>
                          {member.performance}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

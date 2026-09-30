import React, { useState } from 'react';
import {
  BarChart3, Users, TrendingUp, AlertTriangle, CheckCircle2,
  Clock, Send, DollarSign, Target, ArrowUpRight, ArrowDownRight,
  Activity, Zap, Settings, Bell
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  leadsAssigned: number;
  callsCompleted: number;
  followupsCompleted: number;
  demos: number;
  proposals: number;
  wonDeals: number;
  revenue: number;
  pendingTasks: number;
  target: number;
  achieved: number;
  status: 'on-track' | 'needs-attention' | 'overdue';
}

export const ManagerDashboard: React.FC = () => {
  const todayDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const [teamMembers] = useState<TeamMember[]>([
    {
      id: 'EMP-9801',
      name: 'Ananya Verma',
      leadsAssigned: 12,
      callsCompleted: 18,
      followupsCompleted: 9,
      demos: 2,
      proposals: 3,
      wonDeals: 1,
      revenue: 35000,
      pendingTasks: 5,
      target: 50000,
      achieved: 35000,
      status: 'on-track'
    },
    {
      id: 'EMP-4421',
      name: 'Sameer Kulkarni',
      leadsAssigned: 15,
      callsCompleted: 22,
      followupsCompleted: 12,
      demos: 3,
      proposals: 4,
      wonDeals: 2,
      revenue: 48000,
      pendingTasks: 2,
      target: 50000,
      achieved: 48000,
      status: 'on-track'
    },
    {
      id: 'EMP-5532',
      name: 'Priya Sharma',
      leadsAssigned: 8,
      callsCompleted: 12,
      followupsCompleted: 4,
      demos: 1,
      proposals: 2,
      wonDeals: 0,
      revenue: 15000,
      pendingTasks: 8,
      target: 50000,
      achieved: 15000,
      status: 'needs-attention'
    },
    {
      id: 'EMP-7645',
      name: 'Rajesh Patel',
      leadsAssigned: 10,
      callsCompleted: 14,
      followupsCompleted: 5,
      demos: 0,
      proposals: 1,
      wonDeals: 0,
      revenue: 8000,
      pendingTasks: 12,
      target: 50000,
      achieved: 8000,
      status: 'overdue'
    }
  ]);

  const getStatusColor = (status: string) => {
    return {
      'on-track': 'text-emerald-600 bg-emerald-50 border-emerald-200',
      'needs-attention': 'text-amber-600 bg-amber-50 border-amber-200',
      'overdue': 'text-red-600 bg-red-50 border-red-200'
    }[status] || 'text-slate-600 bg-slate-50 border-slate-200';
  };

  const getStatusLabel = (status: string) => {
    return {
      'on-track': '✓ On Track',
      'needs-attention': '⚠ Needs Attention',
      'overdue': '🔴 Overdue'
    }[status] || status;
  };

  const totalMetrics = teamMembers.reduce((acc, member) => ({
    leads: acc.leads + member.leadsAssigned,
    calls: acc.calls + member.callsCompleted,
    followups: acc.followups + member.followupsCompleted,
    demos: acc.demos + member.demos,
    proposals: acc.proposals + member.proposals,
    won: acc.won + member.wonDeals,
    revenue: acc.revenue + member.revenue,
    target: acc.target + member.target,
    achieved: acc.achieved + member.achieved
  }), { leads: 0, calls: 0, followups: 0, demos: 0, proposals: 0, won: 0, revenue: 0, target: 0, achieved: 0 });

  const teamProgress = (totalMetrics.achieved / totalMetrics.target) * 100;

  // Find attention required items
  const attentionRequired = [
    {
      type: 'no-followup',
      count: 3,
      label: 'Leads with no follow-up scheduled',
      icon: AlertTriangle,
      color: 'text-orange-600 bg-orange-50'
    },
    {
      type: 'overdue',
      count: 5,
      label: 'Overdue follow-ups',
      icon: Clock,
      color: 'text-red-600 bg-red-50'
    },
    {
      type: 'inactive',
      count: 2,
      label: 'Leads inactive for 3+ days',
      icon: AlertTriangle,
      color: 'text-amber-600 bg-amber-50'
    },
    {
      type: 'pending-proposal',
      count: 4,
      label: 'Proposals waiting for response',
      icon: Send,
      color: 'text-cyan-600 bg-cyan-50'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-100/50 shadow-sm">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono text-slate-500">{todayDate}</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  MANAGER VIEW
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                Team Performance Dashboard 👥
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors">
                <Bell className="w-5 h-5 text-slate-600" />
              </button>
              <button className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors">
                <Settings className="w-5 h-5 text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 flex justify-center">
        <div className="w-full max-w-6xl">
          {/* TODAY'S TEAM PERFORMANCE */}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm mb-8">
            <div className="bg-gradient-to-r from-slate-50 to-slate-50 border-b border-slate-100 px-6 sm:px-8 py-4">
              <h2 className="text-xl font-bold font-heading text-slate-900">Today's Team Performance</h2>
            </div>

            <div className="p-6 sm:p-8">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
                <MetricCard icon={Users} label="Total Leads" value={totalMetrics.leads} color="text-blue-600" borderColor="border-blue-200" />
                <MetricCard icon={Activity} label="Calls" value={totalMetrics.calls} color="text-emerald-600" borderColor="border-emerald-200" />
                <MetricCard icon={Zap} label="Follow-ups" value={totalMetrics.followups} color="text-purple-600" borderColor="border-purple-200" />
                <MetricCard icon={CheckCircle2} label="Demos" value={totalMetrics.demos} color="text-indigo-600" borderColor="border-indigo-200" />
                <MetricCard icon={Send} label="Proposals" value={totalMetrics.proposals} color="text-cyan-600" borderColor="border-cyan-200" />
                <MetricCard icon={TrendingUp} label="Won Deals" value={totalMetrics.won} color="text-emerald-600" borderColor="border-emerald-200" />
                <MetricCard icon={DollarSign} label="Revenue" value={`₹${(totalMetrics.revenue / 1000).toFixed(0)}K`} color="text-orange-600" borderColor="border-orange-200" />
                <MetricCard icon={Target} label="Target" value={`₹${(totalMetrics.target / 1000).toFixed(0)}K`} color="text-slate-600" borderColor="border-slate-200" />
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="text-sm mb-2">
                  <span className="font-semibold text-slate-900">₹{(totalMetrics.achieved / 1000).toLocaleString('en-IN')}K</span>
                  <span className="text-slate-600"> of ₹{(totalMetrics.target / 1000).toLocaleString('en-IN')}K target</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${Math.min(teamProgress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ATTENTION REQUIRED SECTION */}
          <div className="bg-red-50 border-2 border-red-200 rounded-3xl p-6 sm:p-8 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-red-900">⚠️ Attention Required</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {attentionRequired.map((item, idx) => (
                <button
                  key={idx}
                  className={`rounded-2xl border-2 p-4 text-left transition-all hover:shadow-md cursor-pointer`}
                >
                  <div className={`${item.color} w-12 h-12 rounded-xl flex items-center justify-center mb-3`}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div className="text-3xl font-bold text-slate-900 mb-1">{item.count}</div>
                  <p className="text-sm text-slate-600">{item.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* TEAM MEMBERS */}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-slate-50 to-slate-50 border-b border-slate-100 px-6 sm:px-8 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold font-heading text-slate-900">Team Members</h2>
              <span className="text-sm font-semibold text-slate-600">{teamMembers.length} Sales Reps</span>
            </div>

            <div className="divide-y divide-slate-100">
              {teamMembers.map(member => (
                <div key={member.id} className="p-6 sm:p-8 hover:bg-slate-50 transition-colors border-l-4 border-l-slate-100">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg mb-1">{member.name}</h3>
                      <p className="text-sm text-slate-600">{member.id}</p>
                    </div>
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getStatusColor(member.status)}`}>
                      {getStatusLabel(member.status)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-8 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Leads</p>
                      <p className="font-bold text-slate-900">{member.leadsAssigned}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Calls</p>
                      <p className="font-bold text-slate-900">{member.callsCompleted}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Follow-ups</p>
                      <p className="font-bold text-slate-900">{member.followupsCompleted}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Demos</p>
                      <p className="font-bold text-slate-900">{member.demos}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Proposals</p>
                      <p className="font-bold text-slate-900">{member.proposals}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Won</p>
                      <p className="font-bold text-slate-900">{member.wonDeals}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Revenue</p>
                      <p className="font-bold text-slate-900">₹{(member.revenue / 1000).toFixed(0)}K</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <p className="text-xs text-slate-600 mb-0.5">Pending</p>
                      <p className="font-bold text-slate-900">{member.pendingTasks}</p>
                    </div>
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-600">Target Progress</span>
                      <span className="font-semibold text-slate-900">{((member.achieved / member.target) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                        style={{ width: `${Math.min((member.achieved / member.target) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface MetricCardProps {
  icon: React.ComponentType<any>;
  label: string;
  value: string | number;
  color: string;
  borderColor: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon: Icon, label, value, color, borderColor }) => (
  <div className={`bg-white rounded-2xl p-5 border-2 ${borderColor} hover:shadow-lg hover:scale-105 transition-all duration-200 cursor-pointer`}>
    <div className="flex items-center gap-2.5 mb-3">
      <div className={`p-2 rounded-lg bg-${color.split('-')[1]}-50`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-3xl font-bold text-slate-900 leading-tight">{value}</p>
  </div>
);

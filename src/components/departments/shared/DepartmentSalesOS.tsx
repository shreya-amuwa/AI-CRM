import React, { useState } from 'react';
import {
  BarChart3, FileText, Users, Settings, LogOut, ArrowLeft,
  Search, Filter, Download, PhoneCall, Mail, MessageSquare,
  TrendingUp, Clock, CheckCircle2, AlertTriangle, Eye, Send,
  DollarSign, Target, Award, ArrowUpRight, ArrowDownRight,
  ChevronRight, Sparkles, LucideIcon
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { DepartmentSalesConfig, SalesTeamMember, SalesLead } from '../../../data/departmentSalesData';

interface DepartmentSalesOSProps {
  config: DepartmentSalesConfig;
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  onBackToSelector: () => void;
}

type DashboardView = 'manager' | 'leads' | 'team-members' | 'settings';

export const DepartmentSalesOS: React.FC<DepartmentSalesOSProps> = ({
  config,
  onBackToSelector
}) => {
  const [currentView, setCurrentView] = useState<DashboardView>('manager');
  const [teamMembers] = useState<SalesTeamMember[]>(config.teamMembers);
  const [leads, setLeads] = useState<SalesLead[]>(config.leads);
  const [leadSearchTerm, setLeadSearchTerm] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>('all');
  const [teamViewMode, setTeamViewMode] = useState<'cards' | 'table'>('cards');

  const todayDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Calculate Aggregated Metrics
  const totalMetrics = teamMembers.reduce((acc, m) => ({
    leads: acc.leads + m.leadsAssigned,
    calls: acc.calls + m.callsCompleted,
    followups: acc.followups + m.followupsCompleted,
    demos: acc.demos + m.demos,
    proposals: acc.proposals + m.proposals,
    won: acc.won + m.wonDeals,
    revenue: acc.revenue + m.revenue,
    target: acc.target + m.target,
    achieved: acc.achieved + m.achieved
  }), { leads: 0, calls: 0, followups: 0, demos: 0, proposals: 0, won: 0, revenue: 0, target: 0, achieved: 0 });

  const teamProgress = totalMetrics.target > 0 ? (totalMetrics.achieved / totalMetrics.target) * 100 : 0;

  // Filter leads
  const filteredLeads = leads.filter(l => {
    const matchesSearch = l.name.toLowerCase().includes(leadSearchTerm.toLowerCase()) ||
                          l.company.toLowerCase().includes(leadSearchTerm.toLowerCase()) ||
                          l.email.toLowerCase().includes(leadSearchTerm.toLowerCase()) ||
                          l.phone.includes(leadSearchTerm);
    const matchesStatus = leadStatusFilter === 'all' || l.status === leadStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: 'on-track' | 'needs-attention' | 'overdue') => {
    switch (status) {
      case 'on-track':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">On Track</span>;
      case 'needs-attention':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Needs Attention</span>;
      case 'overdue':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">Overdue</span>;
    }
  };

  const getLeadStatusBadge = (status: 'hot' | 'warm' | 'cold' | 'converted') => {
    switch (status) {
      case 'hot':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">HOT</span>;
      case 'warm':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">WARM</span>;
      case 'cold':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">COLD</span>;
      case 'converted':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">WON</span>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Sidebar Navigation */}
      <div className="fixed left-0 top-0 w-64 h-screen bg-white border-r border-slate-200 hidden lg:flex flex-col z-30 shadow-xs">
        {/* Top Department Hub Button */}
        <div className="p-4 pb-3 border-b border-slate-100 bg-slate-50/50">
          <button
            onClick={onBackToSelector}
            className="w-full px-3.5 py-2.5 rounded-xl bg-white hover:bg-blue-50/80 border border-slate-200 hover:border-blue-300 text-slate-700 hover:text-blue-700 font-bold text-xs flex items-center gap-2 transition-all shadow-2xs group"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600 group-hover:-translate-x-1 transition-transform" />
            <span>Department Hub</span>
          </button>
        </div>

        {/* Department Logo & Title */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${config.themeColor.gradient} flex items-center justify-center shadow-md`}>
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-tight">{config.departmentName} Sales</h1>
              <p className="text-xs text-slate-500 font-mono">Operating System</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button
            onClick={() => setCurrentView('manager')}
            className={`w-full px-4 py-3 rounded-xl flex items-center justify-between font-semibold text-sm transition-all ${
              currentView === 'manager'
                ? `${config.themeColor.lightBg} ${config.themeColor.primaryText} shadow-xs font-bold`
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-4 h-4" />
              <span>Managers View</span>
            </div>
          </button>

          <button
            onClick={() => setCurrentView('leads')}
            className={`w-full px-4 py-3 rounded-xl flex items-center justify-between font-semibold text-sm transition-all ${
              currentView === 'leads'
                ? `${config.themeColor.lightBg} ${config.themeColor.primaryText} shadow-xs font-bold`
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4" />
              <span>All Leads</span>
            </div>
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
              {leads.length}
            </span>
          </button>

          <button
            onClick={() => setCurrentView('team-members')}
            className={`w-full px-4 py-3 rounded-xl flex items-center justify-between font-semibold text-sm transition-all ${
              currentView === 'team-members'
                ? `${config.themeColor.lightBg} ${config.themeColor.primaryText} shadow-xs font-bold`
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4" />
              <span>Team Members</span>
            </div>
          </button>
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={() => setCurrentView('settings')}
            className={`w-full px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-colors ${
              currentView === 'settings'
                ? `${config.themeColor.lightBg} ${config.themeColor.primaryText} font-bold`
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="lg:ml-64">
        {/* VIEW 1: MANAGER DASHBOARD (Matches User Screenshot) */}
        {currentView === 'manager' && (
          <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20">
            {/* Sticky Header */}
            <div className="sticky top-0 z-20 backdrop-blur-xl bg-white/85 border-b border-slate-100 shadow-2xs">
              <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono text-slate-500">{todayDate}</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      MANAGER VIEW
                    </span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 flex items-center gap-2">
                    <span>Team Performance Dashboard</span>
                    <span>👥</span>
                  </h1>
                </div>
              </div>
            </div>

            {/* Dashboard Body */}
            <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              {/* Today's Team Performance Container */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-md">
                <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center justify-between">
                  <span>Today's Team Performance</span>
                  <span className="text-xs font-mono text-slate-400 font-normal">Real-time sync</span>
                </h2>

                {/* 8 Metric KPI Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {/* Total Leads */}
                  <div className="p-4 rounded-2xl border border-slate-100 bg-white shadow-xs hover:border-slate-300 transition-all">
                    <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                      <Users className="w-4 h-4 text-blue-500" />
                      <span>TOTAL LEADS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.leads}
                    </div>
                  </div>

                  {/* Calls */}
                  <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/20 shadow-xs hover:border-emerald-400 transition-all">
                    <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <PhoneCall className="w-4 h-4 text-emerald-500" />
                      <span>CALLS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.calls}
                    </div>
                  </div>

                  {/* Follow-ups */}
                  <div className="p-4 rounded-2xl border border-purple-200 bg-purple-50/20 shadow-xs hover:border-purple-400 transition-all">
                    <div className="flex items-center gap-2 text-purple-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <Clock className="w-4 h-4 text-purple-500" />
                      <span>FOLLOW-UPS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.followups}
                    </div>
                  </div>

                  {/* Demos */}
                  <div className="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/20 shadow-xs hover:border-indigo-400 transition-all">
                    <div className="flex items-center gap-2 text-indigo-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                      <span>DEMOS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.demos}
                    </div>
                  </div>

                  {/* Proposals */}
                  <div className="p-4 rounded-2xl border border-cyan-200 bg-cyan-50/20 shadow-xs hover:border-cyan-400 transition-all">
                    <div className="flex items-center gap-2 text-cyan-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <Send className="w-4 h-4 text-cyan-500" />
                      <span>PROPOSALS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.proposals}
                    </div>
                  </div>

                  {/* Won Deals */}
                  <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/30 shadow-xs hover:border-emerald-400 transition-all">
                    <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      <span>WON DEALS</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      {totalMetrics.won}
                    </div>
                  </div>

                  {/* Revenue */}
                  <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-xs hover:border-amber-400 transition-all">
                    <div className="flex items-center gap-2 text-amber-700 text-xs font-bold uppercase tracking-wider mb-2">
                      <DollarSign className="w-4 h-4 text-amber-600" />
                      <span>REVENUE</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      ₹{Math.round(totalMetrics.revenue / 1000)}K
                    </div>
                  </div>

                  {/* Target */}
                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-xs hover:border-slate-400 transition-all">
                    <div className="flex items-center gap-2 text-slate-600 text-xs font-bold uppercase tracking-wider mb-2">
                      <Target className="w-4 h-4 text-slate-500" />
                      <span>TARGET</span>
                    </div>
                    <div className="text-3xl font-black text-slate-900 font-heading">
                      ₹{Math.round(totalMetrics.target / 1000)}K
                    </div>
                  </div>
                </div>

                {/* Target Progress Bar */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span className="font-semibold text-slate-800">
                      ₹{Math.round(totalMetrics.achieved / 1000)}K of ₹{Math.round(totalMetrics.target / 1000)}K target
                    </span>
                    <span className="font-mono font-bold text-slate-900">{Math.round(teamProgress)}%</span>
                  </div>
                  <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${config.themeColor.gradient} transition-all duration-500 rounded-full`}
                      style={{ width: `${Math.min(teamProgress, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Attention Required Section */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <span>Attention Required</span>
                  </h3>
                  <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    Action items
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-orange-50/60 border border-orange-200 text-orange-900 flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold font-heading">3</div>
                      <div className="text-xs font-medium text-orange-800">No follow-up scheduled</div>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-orange-400" />
                  </div>

                  <div className="p-4 rounded-2xl bg-red-50/60 border border-red-200 text-red-900 flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold font-heading">5</div>
                      <div className="text-xs font-medium text-red-800">Overdue follow-ups</div>
                    </div>
                    <Clock className="w-6 h-6 text-red-400" />
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-amber-900 flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold font-heading">2</div>
                      <div className="text-xs font-medium text-amber-800">Inactive for 3+ days</div>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-amber-400" />
                  </div>

                  <div className="p-4 rounded-2xl bg-cyan-50/60 border border-cyan-200 text-cyan-900 flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold font-heading">4</div>
                      <div className="text-xs font-medium text-cyan-800">Proposals waiting reply</div>
                    </div>
                    <Send className="w-6 h-6 text-cyan-400" />
                  </div>
                </div>
              </div>

              {/* Team Member Performance Cards */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-md">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Sales Representatives Performance</h3>
                    <p className="text-xs text-slate-500">Individual progress and daily completed actions</p>
                  </div>
                  <button
                    onClick={() => setCurrentView('team-members')}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                  >
                    <span>View All Reps</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {teamMembers.map((member) => {
                    const progress = member.target > 0 ? (member.achieved / member.target) * 100 : 0;
                    return (
                      <div
                        key={member.id}
                        className="p-5 rounded-2xl border border-slate-100 hover:border-slate-300 hover:shadow-md transition-all bg-slate-50/30"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${config.themeColor.gradient} text-white font-bold flex items-center justify-center text-sm shadow-xs`}>
                              {member.avatar}
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900">{member.name}</h4>
                              <p className="text-xs text-slate-500">{member.role}</p>
                            </div>
                          </div>
                          {getStatusBadge(member.status)}
                        </div>

                        {/* Metrics Grid */}
                        <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-100 text-center text-xs">
                          <div>
                            <div className="text-slate-400 font-medium">Calls</div>
                            <div className="font-bold text-slate-800 text-sm mt-0.5">{member.callsCompleted}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-medium">Follow-ups</div>
                            <div className="font-bold text-slate-800 text-sm mt-0.5">{member.followupsCompleted}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-medium">Demos</div>
                            <div className="font-bold text-slate-800 text-sm mt-0.5">{member.demos}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-medium">Proposals</div>
                            <div className="font-bold text-slate-800 text-sm mt-0.5">{member.proposals}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-medium">Won</div>
                            <div className="font-bold text-emerald-600 text-sm mt-0.5">{member.wonDeals}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 font-medium">Revenue</div>
                            <div className="font-bold text-slate-900 text-sm mt-0.5">₹{Math.round(member.revenue / 1000)}K</div>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>Target: ₹{Math.round(member.target / 1000)}K</span>
                            <span className="font-bold text-slate-800">{Math.round(progress)}%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-gradient-to-r ${config.themeColor.gradient} rounded-full`}
                              style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                          <a
                            href={`tel:${member.phone}`}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => setCurrentView('leads')}
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
                          >
                            View Leads
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: ALL LEADS */}
        {currentView === 'leads' && (
          <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20 p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                  All {config.departmentName} Sales Leads
                </h1>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  {filteredLeads.length} leads in active pipeline
                </p>
              </div>

              {/* Search & Filter */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search leads..."
                    value={leadSearchTerm}
                    onChange={(e) => setLeadSearchTerm(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 shadow-2xs"
                  />
                </div>

                <select
                  value={leadStatusFilter}
                  onChange={(e) => setLeadStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden shadow-2xs"
                >
                  <option value="all">All Stages</option>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                  <option value="converted">Won</option>
                </select>
              </div>
            </div>

            {/* Leads Table */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Lead / Company</th>
                      <th className="px-6 py-4">Source</th>
                      <th className="px-6 py-4">Value</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Next Action</th>
                      <th className="px-6 py-4">Assigned Rep</th>
                      <th className="px-6 py-4 text-right">Quick Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {filteredLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-900 text-sm">{lead.name}</div>
                          <div className="text-slate-500 text-xs">{lead.company}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono text-[11px]">
                            {lead.source}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900">
                          ₹{lead.value.toLocaleString('en-IN')}
                        </td>
                        <td className="px-6 py-4">
                          {getLeadStatusBadge(lead.status)}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{lead.nextFollowup}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-800">{lead.assignedTo}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={`tel:${lead.phone}`}
                              className="p-2 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-600 text-slate-600 transition-colors"
                              title="Call"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                            </a>
                            <a
                              href={`mailto:${lead.email}`}
                              className="p-2 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 transition-colors"
                              title="Email"
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: TEAM MEMBERS */}
        {currentView === 'team-members' && (
          <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20 p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                  {config.departmentName} Sales Team
                </h1>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  {teamMembers.length} Active Sales Representatives & Consultants
                </p>
              </div>

              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setTeamViewMode('cards')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    teamViewMode === 'cards' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setTeamViewMode('table')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    teamViewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Table
                </button>
              </div>
            </div>

            {teamViewMode === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="bg-white rounded-3xl p-6 border border-slate-100 shadow-md flex flex-col justify-between space-y-4 hover:-translate-y-1 transition-all"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${config.themeColor.gradient} text-white font-bold flex items-center justify-center text-lg shadow-sm`}>
                          {member.avatar}
                        </div>
                        {getStatusBadge(member.status)}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-lg">{member.name}</h3>
                        <p className="text-xs text-slate-500">{member.role}</p>
                        <p className="text-xs font-mono text-slate-400 mt-1">{member.email}</p>
                      </div>
                    </div>

                    <div className="space-y-2 pt-3 border-t border-slate-100 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Leads Assigned:</span>
                        <span className="font-bold text-slate-900">{member.leadsAssigned}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Calls Completed:</span>
                        <span className="font-bold text-slate-900">{member.callsCompleted}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Deals Won:</span>
                        <span className="font-bold text-emerald-600">{member.wonDeals}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Revenue:</span>
                        <span className="font-bold text-slate-900">₹{member.revenue.toLocaleString('en-IN')}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-medium text-slate-600">
                      <span>Achievement:</span>
                      <span className="font-bold text-slate-900">
                        {Math.round((member.achieved / member.target) * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-md overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase">
                    <tr>
                      <th className="px-6 py-4">Member</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">Assigned Leads</th>
                      <th className="px-6 py-4">Calls</th>
                      <th className="px-6 py-4">Demos</th>
                      <th className="px-6 py-4">Won</th>
                      <th className="px-6 py-4">Revenue</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-4 flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${config.themeColor.gradient} text-white font-bold flex items-center justify-center text-xs`}>
                            {member.avatar}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900">{member.name}</div>
                            <div className="text-xs text-slate-400 font-mono">{member.id}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4">{member.role}</td>
                        <td className="px-6 py-4 font-bold">{member.leadsAssigned}</td>
                        <td className="px-6 py-4">{member.callsCompleted}</td>
                        <td className="px-6 py-4">{member.demos}</td>
                        <td className="px-6 py-4 font-bold text-emerald-600">{member.wonDeals}</td>
                        <td className="px-6 py-4 font-bold text-slate-900">₹{member.revenue.toLocaleString('en-IN')}</td>
                        <td className="px-6 py-4">{getStatusBadge(member.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* VIEW 4: SETTINGS */}
        {currentView === 'settings' && (
          <div className="min-h-screen flex items-center justify-center p-8">
            <div className="text-center max-w-md space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-inner">
                <Settings className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold font-heading text-slate-900">
                {config.departmentName} Sales OS Settings
              </h2>
              <p className="text-sm text-slate-500">
                Configure team targets, webhook routing, WhatsApp messaging templates, and automated follow-up intervals.
              </p>
              <button
                onClick={() => setCurrentView('manager')}
                className={`px-5 py-2.5 rounded-xl text-white font-semibold text-xs shadow-sm ${config.themeColor.buttonBg} ${config.themeColor.buttonHover} transition-all`}
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 lg:hidden z-30 flex items-center justify-around py-2">
        <button
          onClick={() => setCurrentView('manager')}
          className={`flex flex-col items-center gap-1 py-1 text-xs font-semibold ${
            currentView === 'manager' ? config.themeColor.primaryText : 'text-slate-500'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span>Managers</span>
        </button>
        <button
          onClick={() => setCurrentView('leads')}
          className={`flex flex-col items-center gap-1 py-1 text-xs font-semibold ${
            currentView === 'leads' ? config.themeColor.primaryText : 'text-slate-500'
          }`}
        >
          <FileText className="w-5 h-5" />
          <span>Leads</span>
        </button>
        <button
          onClick={() => setCurrentView('team-members')}
          className={`flex flex-col items-center gap-1 py-1 text-xs font-semibold ${
            currentView === 'team-members' ? config.themeColor.primaryText : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>Team</span>
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`flex flex-col items-center gap-1 py-1 text-xs font-semibold ${
            currentView === 'settings' ? config.themeColor.primaryText : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
};

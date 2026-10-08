import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  GitPullRequest,
  Kanban,
  FileCheck2,
  AlertTriangle,
  BarChart3,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  Sparkles,
  Search,
  Share2,
  ShieldCheck,
  Navigation,
  MapPin,
  UserPlus,
  UserCheck,
  ClipboardList
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { usePendingApprovalsCount } from '../../hooks/usePendingApprovalsCount';
import { UserAccessManagementModal } from '../common/UserAccessManagementModal';

export type TeamLeadNav =
  | 'overview'
  | 'assigned-tasks'
  | 'client-handovers'
  | 'team-members'
  | 'reps'
  | 'field-visits'
  | 'distribution'
  | 'pipeline'
  | 'eod'
  | 'sla'
  | 'analytics'
  | 'settings';

interface TeamLeadLayoutProps {
  children: React.ReactNode;
  activeNav: TeamLeadNav;
  onSelectNav: (nav: TeamLeadNav) => void;
  unassignedCount: number;
  pendingEodCount: number;
  overdueCount: number;
  onQuickDistribute: () => void;
}

export const TeamLeadLayout: React.FC<TeamLeadLayoutProps> = ({
  children,
  activeNav,
  onSelectNav,
  unassignedCount,
  pendingEodCount,
  overdueCount,
  onQuickDistribute
}) => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const pendingApprovalsCount = usePendingApprovalsCount();

  const navItems = [
    { id: 'overview' as TeamLeadNav, label: 'Pod Command Center', icon: LayoutDashboard },
    { id: 'assigned-tasks' as TeamLeadNav, label: 'Assigned Tasks', icon: ClipboardList },
    { id: 'client-handovers' as TeamLeadNav, label: 'Client Hand-overs', icon: UserCheck },
    { id: 'team-members' as TeamLeadNav, label: 'Team Members & Access', icon: UserPlus },
    { id: 'reps' as TeamLeadNav, label: 'Team Reps (5)', icon: Users },
    {
      id: 'field-visits' as TeamLeadNav,
      label: 'Field Visits (Live GPS)',
      icon: Navigation,
      badge: '1 Live',
      badgeColor: 'bg-emerald-600 text-white'
    },
    {
      id: 'distribution' as TeamLeadNav,
      label: 'Lead Distribution',
      icon: GitPullRequest,
      badge: unassignedCount > 0 ? `${unassignedCount} New` : undefined,
      badgeColor: 'bg-blue-600 text-white'
    },
    { id: 'pipeline' as TeamLeadNav, label: 'Team Pipeline & Deals', icon: Kanban },
    {
      id: 'eod' as TeamLeadNav,
      label: 'EOD Daily Reviews',
      icon: FileCheck2,
      badge: pendingEodCount > 0 ? `${pendingEodCount} Due` : undefined,
      badgeColor: 'bg-amber-500 text-white'
    },
    {
      id: 'sla' as TeamLeadNav,
      label: 'SLA & Overdue Radar',
      icon: AlertTriangle,
      badge: overdueCount > 0 ? `${overdueCount}` : undefined,
      badgeColor: 'bg-rose-500 text-white'
    },
    { id: 'analytics' as TeamLeadNav, label: 'Analytics & Leaderboard', icon: BarChart3 },
    { id: 'settings' as TeamLeadNav, label: 'Pod Targets & Rules', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col antialiased text-slate-900 selection:bg-indigo-500/20">
      
      {/* TOP HEADER */}
      <header className="h-16 bg-white border-b border-slate-200/80 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 shadow-xs">
        
        {/* Left branding & Pod Title */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-3">
            <AmuwaLogo size="sm" />
            <div className="hidden sm:block h-5 w-px bg-slate-200" />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-slate-900 tracking-tight font-heading">
                  WabaStore Sales OS
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                  Pod Alpha
                </span>
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                Team Lead Supervisory Hub
              </span>
            </div>
          </div>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          
          {/* Quick 1-Click Distribute Leads Button */}
          {unassignedCount > 0 && (
            <button
              onClick={onQuickDistribute}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium text-xs hover:from-blue-700 hover:to-indigo-700 shadow-xs shadow-blue-500/20 transition-all active:scale-95"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Distribute {unassignedCount} Leads</span>
            </button>
          )}

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 relative transition-colors"
            >
              <Bell className="w-4 h-4" />
              {(unassignedCount > 0 || overdueCount > 0) && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              )}
              {(unassignedCount > 0 || overdueCount > 0) && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500" />
              )}
            </button>

            {isNotificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200/80 p-4 z-50 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">Pod Notifications</h4>
                  <span className="text-[10px] text-blue-600 font-medium">Real-time</span>
                </div>
                <div className="space-y-2 mt-2">
                  {unassignedCount > 0 && (
                    <div
                      onClick={() => {
                        onSelectNav('distribution');
                        setIsNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-blue-50/80 hover:bg-blue-100/80 cursor-pointer border border-blue-100 text-xs transition-colors"
                    >
                      <p className="font-semibold text-blue-900">{unassignedCount} Unassigned Leads in Queue</p>
                      <p className="text-[11px] text-blue-700 mt-0.5">Leads from WhatsApp & Meta Ads waiting for pod assignment.</p>
                    </div>
                  )}
                  {overdueCount > 0 && (
                    <div
                      onClick={() => {
                        onSelectNav('sla');
                        setIsNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-rose-50/80 hover:bg-rose-100/80 cursor-pointer border border-rose-100 text-xs transition-colors"
                    >
                      <p className="font-semibold text-rose-900">{overdueCount} Overdue Follow-up Tasks</p>
                      <p className="text-[11px] text-rose-700 mt-0.5">Reps have overdue follow-up reminders requiring Team Lead attention.</p>
                    </div>
                  )}
                  {pendingEodCount > 0 && (
                    <div
                      onClick={() => {
                        onSelectNav('eod');
                        setIsNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-amber-50/80 hover:bg-amber-100/80 cursor-pointer border border-amber-100 text-xs transition-colors"
                    >
                      <p className="font-semibold text-amber-900">{pendingEodCount} EOD Submissions Ready</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">Review and sign off on reps' daily closed sales.</p>
                    </div>
                  )}
                  {pendingApprovalsCount > 0 && (
                    <div
                      onClick={() => {
                        setIsAccessModalOpen(true);
                        setIsNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-indigo-50/90 hover:bg-indigo-100/90 cursor-pointer border border-indigo-200 text-xs transition-colors"
                    >
                      <p className="font-semibold text-indigo-900 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                        {pendingApprovalsCount} Registration{pendingApprovalsCount > 1 ? 's' : ''} Awaiting Approval
                      </p>
                      <p className="text-[11px] text-indigo-700 mt-0.5">Click to authorize new team members and activate their logins.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Staff Access & Approvals Button */}
          <button
            type="button"
            onClick={() => setIsAccessModalOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs relative"
            title="Authorize registered team members and manage access"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Staff Approvals</span>
            {pendingApprovalsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                {pendingApprovalsCount}
              </span>
            )}
          </button>

          {/* Team Lead Profile Pill */}
          <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200">
            <div className="hidden lg:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-800 leading-tight">
                {user?.name || 'Vikram Deshmukh'}
              </span>
              <span className="text-[10px] font-medium text-indigo-600">
                Sales Team Lead
              </span>
            </div>

            <button
              onClick={logout}
              title="Logout"
              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>

      </header>

      {/* BODY WITH SIDEBAR & CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* DESKTOP SIDEBAR */}
        <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200/80 shrink-0">
          <div className="p-4 flex flex-col gap-1">
            <div className="px-3 py-2 mb-2 rounded-xl bg-gradient-to-br from-indigo-50/80 via-blue-50/50 to-slate-50 border border-indigo-100/80">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800">Team Lead Portal</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                Managing 5 reps in WabaStore Sales Pod Alpha.
              </p>
            </div>

            <span className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Command Center
            </span>

            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectNav(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-500/30'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : item.badgeColor
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-auto p-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Amuwa Sales OS</span>
              <span className="font-mono">v2.8-TL</span>
            </div>
          </div>
        </aside>

        {/* MOBILE DRAWER */}
        {isMobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs flex">
            <div className="w-64 bg-white h-full p-4 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-2">
                <div className="flex items-center gap-2">
                  <AmuwaLogo size="sm" />
                  <span className="text-xs font-bold text-slate-900">Pod Alpha</span>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1 flex-1">
                {navItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSelectNav(item.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isActive ? 'bg-white/20 text-white' : item.badgeColor
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
            <div className="flex-1" onClick={() => setIsMobileMenuOpen(false)} />
          </div>
        )}

        {/* MAIN CONTENT WORKSPACE */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>

      </div>

      {/* Staff Access & Approvals Modal */}
      {isAccessModalOpen && (
        <UserAccessManagementModal
          isOpen={isAccessModalOpen}
          onClose={() => setIsAccessModalOpen(false)}
        />
      )}
    </div>
  );
};

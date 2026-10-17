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
  Share2,
  ShieldCheck,
  Navigation,
  MapPin,
  UserPlus,
  ClipboardList
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { NavButton, NavGroupLabel, SidebarBrand, SidebarFrame, SignOutButton, TopBar, UserChip } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { closeMenu } from '../layout/menuState';

export type TeamLeadNav =
  | 'overview'
  | 'assigned-tasks'
  | 'team-members'
  | 'reps'
  | 'field-visits'
  | 'distribution'
  | 'pipeline'
  | 'eod'
  | 'sla'
  | 'analytics'
  | 'settings'
  | 'notifications';

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
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const navItems = [
    { id: 'overview' as TeamLeadNav, label: 'Pod Command Center', icon: LayoutDashboard },
    { id: 'assigned-tasks' as TeamLeadNav, label: 'Assigned Tasks', icon: ClipboardList },
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
    { id: 'settings' as TeamLeadNav, label: 'Pod Targets & Rules', icon: Settings },
    { id: 'notifications' as TeamLeadNav, label: 'Notification Center', icon: Bell }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex antialiased">
      <SidebarFrame
        ariaLabel="Sales Team Lead navigation"
        footer={
          <>
            <SignOutButton onClick={() => void logout()} />
            <div className="flex items-center justify-between px-2.5 pt-2 text-[11px] text-slate-500">
              <span>Amuwa Sales OS</span>
              <span className="font-mono">v2.8-TL</span>
            </div>
          </>
        }
      >
        <SidebarBrand title="Amuwa" subtitle="Team Lead Supervisory Hub" />
        <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-700" aria-hidden="true" />
            <span className="text-xs font-bold text-slate-900">Team Lead Portal</span>
          </div>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">Managing 5 reps in WabaStore Sales Pod Alpha.</p>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Team Lead pages">
          <NavGroupLabel>Command Center</NavGroupLabel>
          {navItems.map(item => (
            <NavButton
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={activeNav === item.id}
              onClick={() => {
                onSelectNav(item.id);
                closeMenu();
              }}
            >
              {item.badge && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${activeNav === item.id ? 'bg-white text-blue-700' : item.badgeColor}`}>{item.badge}</span>}
            </NavButton>
          ))}
        </nav>
      </SidebarFrame>

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          left={
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight truncate">WabaStore Sales OS</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 shrink-0">Pod Alpha</span>
              </div>
              <span className="block text-xs text-slate-500">Team Lead Supervisory Hub</span>
            </div>
          }
          actions={
            <>
              {/* Quick 1-click distribute button */}
              {unassignedCount > 0 && (
                <button
                  type="button"
                  onClick={onQuickDistribute}
                  className="hidden md:flex items-center gap-2 h-10 px-3.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors"
                >
                  <Share2 className="w-4 h-4" aria-hidden="true" />
                  <span>Distribute {unassignedCount} Leads</span>
                </button>
              )}
              <LeaveCenter />
              {/* Pod notifications */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  aria-label="Pod notifications"
                  aria-expanded={isNotificationsOpen}
                  className="relative w-11 h-11 rounded-xl border border-slate-200 bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-colors"
                >
                  <Bell className="w-[18px] h-[18px]" strokeWidth={1.9} aria-hidden="true" />
                  {(unassignedCount > 0 || overdueCount > 0) && <span className="absolute top-2.5 right-3 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />}
                </button>
                {isNotificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <h4 className="text-sm font-bold text-slate-900">Pod Notifications</h4>
                      <span className="text-[11px] text-blue-700 font-semibold">Real-time</span>
                    </div>
                    <div className="space-y-2 mt-2">
                      {unassignedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectNav('distribution');
                            setIsNotificationsOpen(false);
                          }}
                          className="w-full text-left p-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-100 text-xs transition-colors"
                        >
                          <p className="font-bold text-blue-800">{unassignedCount} Unassigned Leads in Queue</p>
                          <p className="text-[11px] text-blue-700 mt-0.5">Leads from WhatsApp & Meta Ads waiting for pod assignment.</p>
                        </button>
                      )}
                      {overdueCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectNav('sla');
                            setIsNotificationsOpen(false);
                          }}
                          className="w-full text-left p-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-100 text-xs transition-colors"
                        >
                          <p className="font-bold text-rose-800">{overdueCount} Overdue Follow-up Tasks</p>
                          <p className="text-[11px] text-rose-700 mt-0.5">Reps have overdue follow-up reminders requiring Team Lead attention.</p>
                        </button>
                      )}
                      {pendingEodCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectNav('eod');
                            setIsNotificationsOpen(false);
                          }}
                          className="w-full text-left p-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-100 text-xs transition-colors"
                        >
                          <p className="font-bold text-amber-800">{pendingEodCount} EOD Submissions Ready</p>
                          <p className="text-[11px] text-amber-700 mt-0.5">Review and sign off on reps' daily closed sales.</p>
                        </button>
                      )}
                      {unassignedCount === 0 && overdueCount === 0 && pendingEodCount === 0 && <p className="py-4 text-center text-xs text-slate-500">You're all caught up.</p>}
                    </div>
                  </div>
                )}
              </div>
              <UserChip name={user?.name || 'Vikram Deshmukh'} role="Sales Team Lead" />
            </>
          }
        />
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};

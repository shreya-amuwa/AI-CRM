import React, { Suspense, lazy, useMemo, useState } from 'react';
import { BarChart3, Bell, Building2, FileBarChart, LayoutDashboard, RotateCcw, ShieldCheck, Trophy, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { TeamMemberManagement, type TeamMemberTab } from '../common/TeamMemberManagement';
import { DepartmentGrid } from '../dashboard/DepartmentSelector';
import { DashboardShell, PageTitle, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { useOpenReportsRequest } from '../reports/reportEvents';
import { BusinessReports } from '../reports/BusinessReports';
import { DepartmentIncome } from '../reports/DepartmentIncome';
import { TopPerformersPage } from '../top-performers/TopPerformersPage';
import { ghostBtn, primaryBtn } from '../tasks/head/headParts';
import { CompanyOverview } from './CompanyOverview';
import { SecurityAuditLogs } from './SecurityAuditLogs';

const ReportPerformance = lazy(() => import('./performance/ReportPerformance'));

type Page = 'overview' | 'departments' | 'team' | 'reports' | 'income' | 'top-performers' | 'report-performance' | 'security' | 'chat' | 'notifications';

/**
 * The Super Admin's dashboard (the only role with a company-wide view). It replaces the old "pick a department" hub:
 *   Overview            the company in one page (figures from the database, see CompanyOverview)
 *   Departments         the department cards: open a department's own panel, lock / unlock, add one (unchanged functions)
 *   Business Reports    the existing company business report
 *   Team Members        Team Member Management in full screen: Add Team Member, Team Members (the directory), Access Control
 *   Security & Audit    who did what, and what was refused (read-only)
 * Opening a department still uses the existing department panels; their "home" button brings the Super Admin back here.
 */
export const SuperAdminDashboard: React.FC = () => {
  const { user, logout, selectDepartment } = useAuth();
  const { refreshDepartments } = useDepartments();
  const [page, setPage] = useState<Page>('overview');
  // the header's "Add Team Member" opens Team Member Management on its Add tab
  const [teamTab, setTeamTab] = useState<{ tab: TeamMemberTab; n: number }>({ tab: 'members', n: 0 });
  const openTeam = (tab: TeamMemberTab) => {
    setTeamTab(t => ({ tab, n: t.n + 1 }));
    setPage('team');
  };
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setPage('chat'), []));
  useOpenReportsRequest(React.useCallback(() => setPage('report-performance'), []));

  const groups: ShellNavGroup[] = useMemo(
    () => [
      { items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
      {
        label: 'Company',
        items: [
          { id: 'departments', label: 'Departments', icon: Building2 },
          { id: 'team', label: 'Team Members', icon: Users },
          { id: 'income', label: 'Department Income', icon: Building2 },
          { id: 'top-performers', label: 'Top Performers & Rankings', icon: Trophy },
          { id: 'report-performance', label: 'Reports & Performance', icon: FileBarChart },
          { id: 'reports', label: 'Business Reports', icon: BarChart3 }
        ]
      },
      { label: 'Governance', items: [{ id: 'security', label: 'Security & Audit Logs', icon: ShieldCheck }] },
      {
        label: 'Communication',
        items: [
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ],
    [chatUnread]
  );

  return (
    <DashboardShell
      title="Amuwa"
      subtitle="Super Admin"
      ariaLabel="Super Admin navigation"
      groups={groups}
      active={page}
      onSelect={id => {
        // the menu entry opens Team Members on the directory (the header button opens the Add tab)
        if (id === 'team' && page !== 'team') setTeamTab(t => ({ tab: 'members', n: t.n }));
        setPage(id as Page);
      }}
      user={{ name: user?.name || 'Super Admin', role: 'Super Admin' }}
      onSignOut={() => void logout()}
      wide={page === 'overview' || page === 'security' || page === 'reports' || page === 'income' || page === 'top-performers' || page === 'report-performance' || page === 'team'}
      flush={page === 'chat'}
      topActions={
        <>
          <button type="button" className={`${primaryBtn} !h-10 !px-4`} onClick={() => openTeam('add')}>
            <UserPlus className="w-4 h-4" aria-hidden="true" /> Add Team Member
          </button>
          <NotificationBell />
        </>
      }
    >
      {page === 'overview' && <CompanyOverview onOpenDepartment={slug => selectDepartment(slug as never)} />}
      {page === 'departments' && (
        <div className="space-y-6">
          <PageTitle
            title="Departments"
            subtitle="Open a department's own panel, lock or unlock access to it, or add a new department."
            actions={
              <button type="button" className={ghostBtn} onClick={() => void refreshDepartments()}>
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reload departments
              </button>
            }
          />
          <DepartmentGrid />
        </div>
      )}
      {page === 'team' && <TeamMemberManagement initialTab={teamTab.tab} openRequest={teamTab.n} />}
      {page === 'income' && <DepartmentIncome />}
      {page === 'top-performers' && <TopPerformersPage mode="COMPANY" />}
      {page === 'report-performance' && <Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading</div>}><ReportPerformance /></Suspense>}
      {page === 'reports' && <BusinessReports />}
      {page === 'security' && <SecurityAuditLogs />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

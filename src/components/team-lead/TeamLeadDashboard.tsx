import React, { useMemo, useState } from 'react';
import { Bell, ClipboardList, LayoutDashboard, LineChart, Navigation, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { FieldVisitTrackerView } from '../common/FieldVisitTrackerView';
import { ScopeOverviewPanel } from '../common/ScopeOverviewPanel';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { DashboardShell, PageTitle, type ShellNavGroup } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { REPORTS_NAV, ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { PerformanceManagement } from '../performance/PerformanceManagement';
import { TeamLeadTasksView } from '../tasks/TeamLeadTasksView';
import { TeamCustomers } from './TeamCustomers';

export type TeamLeadNav = 'overview' | 'customers' | 'assigned-tasks' | 'performance' | 'field-visits' | 'team-members' | 'chat' | 'raise-issue' | 'work-reports' | 'notifications';

interface TeamLeadDashboardProps {
  currentUserId: string;
  userName: string;
}

/**
 * Team Lead (Sales and the other non-Support teams). Support Team Leads have their own dashboard.
 * Every figure comes from the database, limited to the Team Lead's own team (GET /dashboard/scope-overview and the customer pipeline).
 * An earlier version ran on a browser-only demo store with made-up people and numbers: it is gone.
 */
export const TeamLeadDashboard: React.FC<TeamLeadDashboardProps> = ({ userName }) => {
  const { profile, logout } = useAuth();
  const [nav, setNav] = useState<TeamLeadNav>('overview');
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setNav('chat'), []));
  useOpenIssuesRequest(React.useCallback(() => setNav('raise-issue'), []));
  const reportsBadge = useReportsBadge();
  useOpenReportsRequest(React.useCallback(() => setNav('work-reports'), []));

  const groups: ShellNavGroup[] = useMemo(
    () => [
      { items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
      {
        label: 'Team',
        items: [
          { id: 'customers', label: 'Team Customers', icon: Users },
          { id: 'assigned-tasks', label: 'Assigned Tasks', icon: ClipboardList },
          { id: 'performance', label: 'Performance Management', icon: LineChart },
          { ...REPORTS_NAV, badge: reportsBadge },
          { id: 'field-visits', label: 'Field Visits', icon: Navigation }
        ]
      },
      {
        label: 'People',
        items: [
          { id: 'team-members', label: 'Team Members & Access', icon: UserPlus },
          { ...ISSUES_NAV },
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ],
    [chatUnread, reportsBadge]
  );

  return (
    <DashboardShell
      title="Amuwa"
      subtitle={profile?.team?.name ? `${profile.team.name} team` : 'Team Lead'}
      ariaLabel="Team Lead navigation"
      groups={groups}
      active={nav}
      onSelect={id => setNav(id as TeamLeadNav)}
      user={{ name: userName || 'Team Lead', role: 'Team Lead' }}
      onSignOut={() => void logout()}
      flush={nav === 'chat'}
      wide={nav === 'team-members'}
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
    >
      {nav === 'overview' && (
        <div className="space-y-6">
          <PageTitle title={`Hello, ${userName?.split(' ')[0] || 'there'}`} subtitle="Where your team's customers are, who is carrying what, and what is overdue." />
          <ScopeOverviewPanel heading="Your team" hint="Counted from your team's real records." />
        </div>
      )}
      {nav === 'customers' && <TeamCustomers />}
      {nav === 'assigned-tasks' && <TeamLeadTasksView />}
      {nav === 'performance' && <PerformanceManagement mode="TEAM_LEAD" />}
      {nav === 'field-visits' && <FieldVisitTrackerView viewerRole="team-lead" userName={userName} />}
      {nav === 'team-members' && (
        <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} subDept={profile?.team?.division === 'SALES' ? 'sales' : profile?.team?.division === 'SUPPORT' ? 'support' : null} />
      )}
      {nav === 'chat' && <ChatRoute />}
      {nav === 'raise-issue' && <IssuesRoute />}
      {nav === 'work-reports' && <ReportsRoute />}
      {nav === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

import React, { useMemo, useState } from 'react';
import { Bell, Briefcase, ClipboardList, LayoutDashboard, LineChart, Navigation, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { FieldVisitTrackerView } from '../common/FieldVisitTrackerView';
import { ActiveFieldVisits } from '../field-visit/ActiveFieldVisits';
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
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';

export type TeamLeadNav = 'overview' | 'my-leads' | 'my-potential' | 'my-onboarding' | 'my-part-payments' | 'customers' | 'assigned-tasks' | 'performance' | 'field-visits' | 'team-members' | 'chat' | 'raise-issue' | 'work-reports' | 'notifications';

const MY_SECTION: Record<'my-leads' | 'my-potential' | 'my-onboarding' | 'my-part-payments', PipelineSection> = {
  'my-leads': 'leads', 'my-potential': 'potential', 'my-onboarding': 'onboarding', 'my-part-payments': 'part-payments'
};
const MY_NAV: Record<PipelineSection, TeamLeadNav> = { leads: 'my-leads', potential: 'my-potential', onboarding: 'my-onboarding', 'part-payments': 'my-part-payments' };

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
  const { counts: pipelineCounts } = usePipelineCounts();
  // bumped on every sidebar click so choosing a section again returns to its list
  const [navNonce, setNavNonce] = useState(0);
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setNav('chat'), []));
  useOpenIssuesRequest(React.useCallback(() => setNav('raise-issue'), []));
  const reportsBadge = useReportsBadge();
  useOpenReportsRequest(React.useCallback(() => setNav('work-reports'), []));

  const groups: ShellNavGroup[] = useMemo(
    () => [
      {
        items: [
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          // the Team Lead's own leads, worked through the same Leads -> Potential -> Customer onboarding steps as a Sales Team Member's
          { id: 'my-leads-group', label: 'My Leads', icon: Briefcase, children: [{ id: 'my-leads', label: 'Leads' }, { id: 'my-potential', label: 'Potential' }, { id: 'my-onboarding', label: 'Customer onboarding' }, { id: 'my-part-payments', label: 'Part payments' }] }
        ]
      },
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
      onSelect={id => { setNav(id as TeamLeadNav); setNavNonce(n => n + 1); }}
      user={{ name: userName || 'Team Lead', role: 'Team Lead' }}
      onSignOut={() => void logout()}
      flush={nav === 'chat'}
      wide={nav === 'team-members' || nav.startsWith('my-')}
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
      {(nav === 'my-leads' || nav === 'my-potential' || nav === 'my-onboarding' || nav === 'my-part-payments') && (
        <PipelineWorkspace section={MY_SECTION[nav]} counts={pipelineCounts} ownOnly resetKey={navNonce} onNavigate={s => setNav(MY_NAV[s])} />
      )}
      {nav === 'customers' && <TeamCustomers />}
      {nav === 'assigned-tasks' && <TeamLeadTasksView />}
      {nav === 'performance' && <PerformanceManagement mode="TEAM_LEAD" />}
      {nav === 'field-visits' && (
        <div className="space-y-8">
          {/* visits of the lead's own Team Members, live (Field Visit pages); the earlier trip tracker stays below */}
          <ActiveFieldVisits audience="manager" />
          <FieldVisitTrackerView viewerRole="team-lead" userName={userName} />
        </div>
      )}
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

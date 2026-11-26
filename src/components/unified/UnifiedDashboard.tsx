import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Bell, CalendarCheck, ClipboardList, Clock3, FileText, Headset, LayoutDashboard, LineChart, ListChecks, Megaphone, Target, UserCheck, UserCircle, UserPlus, Users,
  BarChart3, Briefcase, Crosshair
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { useWorkTasks } from '../../lib/workTasks';
import { navigateTo } from '../../utils/router';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { DashboardShell, type ShellNavGroup, type ShellNavItem } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { PerformanceManagement } from '../performance/PerformanceManagement';
import { PerformanceHub } from '../performance/PerformanceHub';
import { ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { LeadAssign } from '../sales-head/LeadAssign';
import { LeadList } from '../sales-head/LeadList';
import { SalesPerformance } from '../sales-head/SalesPerformance';
import { SalesReports } from '../sales-head/SalesReports';
import { HeadAttendancePage } from '../department-head/HeadAttendancePage';
import { HeadLeadsPage } from '../department-head/HeadLeadsPage';
import { HeadSupportCustomersPage } from '../department-head/HeadCustomersPage';
import { SupportDeskPage } from '../support-member/SupportDeskPage';
import { SupportLeadCustomers, SupportLeadTickets } from '../support-member/SupportLeadViews';
import { TasksPage as MemberTasksPage } from '../support-member/TasksPage';
import { TeamActivityPage } from '../support-member/TeamActivityPage';
import { TeamCustomers } from '../team-lead/TeamCustomers';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { HeadAssign } from '../tasks/head/HeadAssign';
import { HeadDaily } from '../tasks/head/HeadDaily';
import { HeadReports } from '../tasks/head/HeadReports';
import { TeamLeadTasksView } from '../tasks/TeamLeadTasksView';
import { WorkUpdatesPanel, useWorkUpdateCounts } from '../tasks/WorkUpdates';
import { useOpenWorkUpdateRequest } from '../tasks/workUpdateEvents';
import { MemberSections, useMemberWorkspace } from '../team-member/MemberSections';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import { UnifiedOverview } from './UnifiedOverview';
import { UnifiedProfile } from './UnifiedProfile';
import { UnifiedMemberCustomers, UnifiedMemberTickets } from './UnifiedSupport';
import {
  UNIFIED_BASE, UNIFIED_PATHS, UNIFIED_WHO_LABEL, canOpen, parseUnifiedPage, unifiedMenu, type UnifiedPage, type UnifiedWho
} from './unifiedNav';

const ICONS: Record<string, React.ElementType> = {
  overview: LayoutDashboard, 'sales-add-lead': UserPlus, 'sales-my-leads': Briefcase, 'sales-dept-leads': Target, 'sales-team-leads': Users, 'sales-assign': Crosshair,
  'sales-follow-ups': CalendarCheck, 'sales-performance': LineChart, 'sales-reports': BarChart3, 'support-customers': Users, 'support-tickets': Headset,
  'support-desk': Megaphone, 'support-activity': Activity, tasks: ClipboardList, 'tasks-group': ClipboardList, 'daily-reports': FileText, performance: LineChart,
  team: UserCheck, 'team-attendance': Clock3, 'raise-issue': ISSUES_NAV.icon, chat: CHAT_NAV.icon, notifications: Bell, profile: UserCircle
};

const SECTION_OF: Partial<Record<UnifiedPage, PipelineSection>> = {
  'sales-add-lead': 'leads', 'sales-leads': 'leads', 'sales-potential': 'potential', 'sales-onboarding': 'onboarding', 'sales-part-payments': 'part-payments'
};
const PAGE_OF: Record<PipelineSection, UnifiedPage> = { leads: 'sales-leads', potential: 'sales-potential', onboarding: 'sales-onboarding', 'part-payments': 'sales-part-payments' };

// the pages that need the person's tasks load them themselves, so the dashboard does not keep a live task feed open for pages that never use it
const HeadAssignPage: React.FC = () => { const data = useWorkTasks(); return <HeadAssign data={data} />; };
const HeadTaskReportsPage: React.FC = () => { const data = useWorkTasks(); return <HeadReports data={data} />; };
const HeadDailyPage: React.FC = () => { const data = useWorkTasks(); return <HeadDaily data={data} />; };
const MemberTasks: React.FC = () => { const tasks = useWorkTasks(); return <MemberTasksPage tasks={tasks} />; };
const FollowUps: React.FC<{ userId: string; userName: string }> = ({ userId, userName }) => {
  const workspace = useMemberWorkspace(userId);
  return <MemberSections section="tasks" currentUserId={userId} userName={userName} workspace={workspace} />;
};

/**
 * International and Reseller: the Department Head, the Team Leads and the Team Members all open THIS dashboard (one component; the person's role in the
 * database picks the menu and the pages, the database decides what each page may show). Sales and Support are two sections of the same sidebar: choosing
 * one opens its workspace inside the same dashboard, never another dashboard. Attendance and Meeting Request are added by the shell; Leave is the top bar's.
 */
export const UnifiedDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const reportsBadge = useReportsBadge();
  const updateCounts = useWorkUpdateCounts();
  const { counts: pipelineCounts } = usePipelineCounts();
  const userId = user?.id || profile?.id || '';
  const who: UnifiedWho = profile?.role === 'DEPARTMENT_HEAD' ? 'HEAD' : profile?.role === 'TEAM_HEAD' ? 'LEAD' : 'MEMBER';
  const displayName = profile?.fullName || user?.name || UNIFIED_WHO_LABEL[who];
  const initial = useCallback((): UnifiedPage => {
    const p = parseUnifiedPage(window.location.pathname);
    return canOpen(who, p) ? p : 'overview';
  }, [who]);
  const [page, setPage] = useState<UnifiedPage>(initial);
  // bumped on every sidebar click: choosing a section again returns to its list (and re-opens the Add Lead form)
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onPop = () => setPage(initial());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [initial]);
  const go = useCallback((next: UnifiedPage) => {
    const target = canOpen(who, next) ? next : 'overview';
    setPage(target);
    setNonce(n => n + 1);
    const seg = UNIFIED_PATHS[target];
    navigateTo(seg ? `${UNIFIED_BASE(userId)}/${seg}` : UNIFIED_BASE(userId));
  }, [who, userId]);

  useOpenChatRequest(useCallback(() => go('chat'), [go]));
  useOpenIssuesRequest(useCallback(() => go('raise-issue'), [go]));
  useOpenReportsRequest(useCallback(() => go('daily-reports'), [go]));
  useOpenWorkUpdateRequest(useCallback(() => go(who === 'HEAD' ? 'task-updates' : 'tasks'), [go, who]));

  const badges: Record<string, number> = useMemo(() => ({
    'daily-reports': reportsBadge || 0, chat: chatUnread || 0, notifications: unreadCount || 0, 'task-updates': updateCounts?.pending || 0
  }), [reportsBadge, chatUnread, unreadCount, updateCounts?.pending]);

  const groups: ShellNavGroup[] = useMemo(() => {
    const toItem = (it: ReturnType<typeof unifiedMenu>[number]['items'][number]): ShellNavItem => ({
      id: it.id, label: it.label, icon: ICONS[it.id] || ListChecks, badge: badges[it.id] || undefined,
      children: it.children?.map(c => ({ id: c.id, label: c.label, badge: badges[c.id] || undefined }))
    });
    return unifiedMenu(who).map(g => ({ label: g.label, items: g.items.map(toItem) }));
  }, [who, badges]);

  const deptName = profile?.department?.name || 'Department';
  const body = (() => {
    switch (page) {
      case 'overview': return <UnifiedOverview who={who} go={go} />;
      case 'sales-add-lead': return who === 'HEAD'
        ? <HeadLeadsPage startAdd={nonce + 1} />
        : <PipelineWorkspace section="leads" counts={pipelineCounts} ownOnly startWithAdd resetKey={nonce} onNavigate={s => go(PAGE_OF[s])} />;
      case 'sales-leads': case 'sales-potential': case 'sales-onboarding': case 'sales-part-payments':
        return <PipelineWorkspace section={SECTION_OF[page] as PipelineSection} counts={pipelineCounts} ownOnly resetKey={nonce} onNavigate={s => go(PAGE_OF[s])} />;
      case 'sales-dept-leads': return <LeadList key={nonce} go={() => undefined} />;
      case 'sales-team-leads': return <TeamCustomers />;
      case 'sales-assign': return <LeadAssign />;
      case 'sales-follow-ups': return <FollowUps userId={userId} userName={displayName} />;
      case 'sales-performance': return who === 'HEAD' ? <SalesPerformance /> : <PerformanceManagement mode="TEAM_LEAD" />;
      case 'sales-reports': return <SalesReports />;
      case 'support-customers': return who === 'HEAD' ? <HeadSupportCustomersPage /> : who === 'LEAD' ? <SupportLeadCustomers /> : <UnifiedMemberCustomers />;
      case 'support-tickets': return who === 'MEMBER' ? <UnifiedMemberTickets /> : <SupportLeadTickets />;
      case 'support-desk': return <SupportDeskPage />;
      case 'support-activity': return <TeamActivityPage />;
      case 'tasks': return who === 'HEAD' ? <HeadAssignPage /> : who === 'LEAD' ? <TeamLeadTasksView /> : <MemberTasks />;
      case 'task-updates': return <WorkUpdatesPanel />;
      case 'task-reports': return <HeadTaskReportsPage />;
      case 'task-daily': return <HeadDailyPage />;
      case 'daily-reports': return <ReportsRoute />;
      case 'performance': return <PerformanceHub mode={who === 'HEAD' ? 'DEPARTMENT_HEAD' : 'TEAM_LEAD'} />;
      case 'team': return <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} />;
      case 'team-attendance': return <HeadAttendancePage />;
      case 'raise-issue': return <IssuesRoute />;
      case 'chat': return <ChatRoute />;
      case 'notifications': return <NotificationsPage />;
      case 'profile': return <UnifiedProfile />;
      default: return <UnifiedOverview who={who} go={go} />;
    }
  })();

  return (
    <DashboardShell
      title={deptName}
      subtitle={UNIFIED_WHO_LABEL[who]}
      ariaLabel={`${deptName} navigation`}
      groups={groups}
      active={page}
      meetingsLabel="Meeting Request"
      onSelect={id => go(id as UnifiedPage)}
      user={{ name: displayName, role: UNIFIED_WHO_LABEL[who] }}
      onSignOut={() => void logout()}
      topLeft={
        <div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>
          {deptName}{profile?.team?.name && who !== 'HEAD' ? ` · ${profile.team.name}` : ''} · Sales &amp; Support
        </div>
      }
      topActions={<><LeaveCenter /><NotificationBell /></>}
      wide
      flush={page === 'chat'}
    >
      <div data-testid={`unified-page-${page}`}>{body}</div>
    </DashboardShell>
  );
};

export default UnifiedDashboard;

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CalendarRange, ClipboardList, FileText, FolderKanban, LayoutDashboard, LineChart, ListChecks, Users } from 'lucide-react';
import type { AiStudioOverview } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { navigateTo } from '../../utils/router';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { openFromNotification, useOpenIssuesRequest } from '../issues/issueEvents';
import { DashboardShell, groupNavItems, type ShellNavGroup } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { PerformanceApprovals } from '../performance/PerformanceApprovals';
import { AiStudioOverviewPage } from './AiStudioOverview';
import { DepartmentTasks, MemberProjects, ProjectManagement } from './AiStudioProjects';
import { DailyReportsPage, DepartmentReports } from './AiStudioReports';
import { AiStudioTeam } from './AiStudioTeam';
import { LeadWeeklyReport } from './AiStudioWeekly';
import { AI_STUDIO_CHANGED_EVENT, useOpenAiStudioRequest } from './aiStudioEvents';

export type AiStudioPage = 'overview' | 'projects' | 'tasks' | 'team' | 'daily-report' | 'weekly-report' | 'performance' | 'raise-issue' | 'chat' | 'notifications';

export const AI_STUDIO_BASE = (userId: string) => `/ai-studio/dashboard/${userId}`;
const PAGES: readonly AiStudioPage[] = ['projects', 'tasks', 'team', 'daily-report', 'weekly-report', 'performance', 'raise-issue', 'chat', 'notifications'];

export function parseAiStudioPage(path: string): AiStudioPage {
  const seg = path.replace(/\/+$/, '').split('/')[4] as AiStudioPage;
  return PAGES.includes(seg) ? seg : 'overview';
}

type Who = 'HEAD' | 'LEAD' | 'MEMBER';
const WHO_LABEL: Record<Who, string> = { HEAD: 'Department Head', LEAD: 'Team Lead', MEMBER: 'Team Member' };

/** Waiting reports for the Daily Report badge (the Team Lead's team, the Department Head's approvals). Read again after every change. */
function useWaitingReports(who: Who): number {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    if (who === 'MEMBER') return;
    aiStudioApi.overview().then((o: AiStudioOverview) => setN(who === 'HEAD' ? o.department?.reportsAwaitingHead ?? 0 : o.team?.reportsToReview ?? 0), () => undefined);
  }, [who]);
  useEffect(() => {
    load();
    window.addEventListener(AI_STUDIO_CHANGED_EVENT, load);
    return () => window.removeEventListener(AI_STUDIO_CHANGED_EVENT, load);
  }, [load]);
  return n;
}

/**
 * The AI Studio dashboard of the Team Member, the Team Lead and the Department Head (one component: the person's real role in the database picks the menu
 * and the pages; the database decides what each page may show). Attendance and the meeting requests are the CRM's own pages (the shell adds them), and
 * Chat, Raise an Issue, Notifications and Leave are the shared ones.
 */
export const AiStudioDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const userId = user?.id || profile?.id || '';
  const who: Who = profile?.role === 'DEPARTMENT_HEAD' ? 'HEAD' : profile?.role === 'TEAM_HEAD' ? 'LEAD' : 'MEMBER';
  const waiting = useWaitingReports(who);
  const [rawPage, setPage] = useState<AiStudioPage>(() => parseAiStudioPage(window.location.pathname));
  // Performance Management is the Team Lead's and the Department Head's (20270213000100): a Team Member who opens its address gets the Overview
  // (the database refuses them too)
  // the Weekly Report is the Team Lead's (20270306000100: Team Lead -> the Super Admin); anyone else who opens its address gets the Overview
  const page: AiStudioPage = (rawPage === 'performance' && who === 'MEMBER') || (rawPage === 'weekly-report' && who !== 'LEAD') ? 'overview' : rawPage;
  // a notification opens the item again even when its page is already on screen
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onPop = () => setPage(parseAiStudioPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: AiStudioPage) => {
    setPage(next);
    navigateTo(next === 'overview' ? AI_STUDIO_BASE(userId) : `${AI_STUDIO_BASE(userId)}/${next}`);
  }, [userId]);

  useOpenChatRequest(useCallback(() => setPage('chat'), []));
  useOpenIssuesRequest(useCallback(() => setPage('raise-issue'), []));
  useOpenAiStudioRequest(useCallback(d => { setNonce(n => n + 1); go(d.kind === 'task' ? (who === 'HEAD' ? 'tasks' : 'projects') : d.kind === 'project' ? 'projects' : d.kind === 'weekly' ? 'weekly-report' : 'daily-report'); }, [go, who]));

  const items = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    ...(who === 'HEAD'
      ? [
          { id: 'projects', label: 'Project Management', icon: FolderKanban },
          { id: 'tasks', label: 'Tasks', icon: ListChecks },
          { id: 'team', label: 'Team Management', icon: Users },
          { id: 'daily-report', label: 'Daily Reports', icon: FileText, badge: waiting },
          { id: 'performance', label: 'Performance Management', icon: LineChart }
        ]
      : [
          { id: 'projects', label: 'Projects', icon: ClipboardList },
          { id: 'daily-report', label: 'Daily Report', icon: FileText, badge: who === 'LEAD' ? waiting : 0 },
          // its own side-panel entry for the Team Lead (not a tab of Daily Report); the Team Member has none
          // (20270306000100) the Team Lead's weekly team report for the Super Admin
          ...(who === 'LEAD' ? [{ id: 'weekly-report', label: 'Weekly Report', icon: CalendarRange }] : []),
          ...(who === 'LEAD' ? [{ id: 'performance', label: 'Performance Management', icon: LineChart }] : [])
        ]),
    { ...ISSUES_NAV },
    { ...CHAT_NAV, badge: chatUnread },
    { id: 'notifications', label: 'Notification Center', icon: Bell, badge: unreadCount }
  ];
  // Attendance and Meeting Request come first (the shell adds them); then the AI Studio work; then the shared sections, as in the other dashboards
  const groups: ShellNavGroup[] = groupNavItems(items, [
    { ids: who === 'HEAD' ? ['overview', 'projects', 'tasks', 'team', 'daily-report', 'performance'] : who === 'LEAD' ? ['overview', 'projects', 'daily-report', 'weekly-report', 'performance'] : ['overview', 'projects', 'daily-report'] },
    { label: 'Team', ids: ['raise-issue', 'chat', 'notifications'] }
  ]);
  const displayName = profile?.fullName || user?.name || 'AI Studio';
  const key = `${page}-${nonce}`;

  return (
    <DashboardShell
      title="AI Studio"
      subtitle={WHO_LABEL[who]}
      ariaLabel="AI Studio navigation"
      groups={groups}
      active={page}
      meetingsLabel="Meeting Request"
      onSelect={id => go(id as AiStudioPage)}
      user={{ name: displayName, role: WHO_LABEL[who] }}
      onSignOut={() => void logout()}
      topLeft={
        <div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>
          {profile?.department?.name || 'AI Studio'}
          {profile?.team?.name && who !== 'HEAD' ? ` · ${profile.team.name}` : ''}
        </div>
      }
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
      wide
      flush={page === 'chat'}
    >
      {page === 'overview' && <AiStudioOverviewPage go={p => go(p === 'reports' ? 'daily-report' : p)} />}
      {page === 'projects' && (who === 'HEAD' ? <ProjectManagement key={key} role="HEAD" /> : <MemberProjects key={key} role={who} />)}
      {page === 'tasks' && who === 'HEAD' && <DepartmentTasks key={key} role="HEAD" />}
      {page === 'team' && who === 'HEAD' && <AiStudioTeam canChange departmentSlug={profile?.department?.slug || 'ai-studio'} />}
      {page === 'daily-report' && (who === 'HEAD' ? <DepartmentReports key={key} role="HEAD" /> : <DailyReportsPage key={key} role={who} />)}
      {page === 'weekly-report' && who === 'LEAD' && <LeadWeeklyReport key={key} />}
      {page === 'performance' && who !== 'MEMBER' && (
        <PerformanceApprovals title="Performance Management"
          subtitle={who === 'LEAD'
            ? 'Your team members: their tasks and daily reports, your review of each report, and your evaluation of their performance.'
            : 'AI Studio: every Team Lead and team member, the Team Leads\' evaluations of their members, and your evaluation of each Team Lead.'} />
      )}
      {page === 'raise-issue' && <IssuesRoute />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage onOpenItem={n => void openFromNotification(n)} />}
    </DashboardShell>
  );
};

export default AiStudioDashboard;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, ClipboardList, FileText, LayoutDashboard, MessageSquareWarning, Palette, Settings, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { LeaveCenter } from '../leave/LeaveCenter';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { MemberSettingsDashboard } from '../team-member/MemberSettingsDashboard';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { navigateTo } from '../../utils/router';
import { AI_DESIGN_STUDIO_SLUG } from '../../../shared/contracts';
import { AdsSessionProvider, ErrorLine, LoadingLine, ROLE_TITLE, aiDesignStudioApi, useAdsData } from './adsUi';
import { useOpenAdsRequest } from './adsEvents';
import { AdsOverviewPage } from './AdsOverviewPage';
import { AdsClientAdd } from './AdsClientAdd';
import { AdsClientNotices } from './AdsClientNotices';
import { AdsAssign } from './AdsAssign';
import { AdsReports } from './AdsReports';
import { AdsIssues } from './AdsIssues';

export type AdsPage = 'overview' | 'client-add' | 'client-notice' | 'assign' | 'report' | 'issue' | 'chat' | 'notification' | 'settings' | 'team';
const PAGES: AdsPage[] = ['overview', 'client-add', 'client-notice', 'assign', 'report', 'issue', 'chat', 'notification', 'settings', 'team'];

export const ADS_BASE = (userId: string) => `/ai-design-studio/dashboard/${userId}`;
export function parseAdsPage(path: string): AdsPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  return (PAGES as string[]).includes(seg) ? (seg as AdsPage) : 'overview';
}

/** A notification about a record opens the page that holds it. */
const PAGE_OF_ENTITY: Record<string, AdsPage> = {
  ads_client: 'client-add', ads_notice: 'client-notice', ads_assignment: 'assign', ads_report: 'report', ads_issue: 'issue'
};

/**
 * The AI Design Studio dashboard: ONE sidebar for the Team Member and the Team Lead (the Department Head gets the same pages plus Team
 * Members, to add people and name Team Leads). What each role may see and do is decided by the database; the pages only adapt their
 * content to the role. This is a separate department from AI Studio: nothing of AI Studio's dashboards is used or changed here.
 */
export const AiDesignStudioDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<AdsPage>(() => parseAdsPage(window.location.pathname));
  const session = useAdsData(() => aiDesignStudioApi.context());
  // the people the caller may give work to (a Team Member gets an empty list); read again when a Team Lead is named
  const people = useAdsData(() => aiDesignStudioApi.people().catch(() => []));

  useEffect(() => {
    const onPop = () => setPage(parseAdsPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: AdsPage) => {
    setPage(next);
    navigateTo(next === 'overview' ? ADS_BASE(userId) : `${ADS_BASE(userId)}/${next}`);
    window.scrollTo({ top: 0 });
  }, [userId]);

  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(useCallback(() => setPage('chat'), []));
  useOpenAdsRequest(useCallback(d => { const p = PAGE_OF_ENTITY[d.entityType]; if (p) setPage(p); }, []));

  const ctx = session.data;
  const head = ctx?.role === 'DEPARTMENT_HEAD';
  const groups: ShellNavGroup[] = useMemo(() => [
    // Attendance and Meeting Request come first (the shell adds them to the top section)
    { items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'Clients', items: [{ id: 'client', label: 'Client', icon: Palette, children: [{ id: 'client-add', label: 'Client Add' }, { id: 'client-notice', label: 'Client Notice' }] }] },
    { label: 'Work', items: [
      { id: 'assign', label: 'Assign', icon: ClipboardList },
      { id: 'report', label: 'Report', icon: FileText },
      { id: 'issue', label: 'Raise an Issue', icon: MessageSquareWarning }
    ] },
    ...(head ? [{ label: 'Team', items: [{ id: 'team', label: 'Team Members', icon: UserPlus }] }] : []),
    { label: 'Communication', items: [{ ...CHAT_NAV, badge: chatUnread }, { id: 'notification', label: 'Notification', icon: Bell, badge: unreadCount }] },
    { label: 'Account', items: [{ id: 'settings', label: 'Settings', icon: Settings }] }
  ], [head, chatUnread, unreadCount]);

  const displayName = profile?.fullName || user?.name || 'Amuwa Design Studio';
  const roleTitle = ctx ? ROLE_TITLE[ctx.role] : 'Amuwa Design Studio';

  let body: React.ReactNode;
  if (session.loading && !session.data) body = <LoadingLine />;
  else if (!ctx) body = <ErrorLine message={session.error || 'Your Amuwa Design Studio workspace could not be opened.'} onRetry={session.reload} />;
  else {
    body = (
      <AdsSessionProvider value={{ ctx, people: people.data ?? [], reloadPeople: people.reload }}>
        {page === 'overview' && <AdsOverviewPage onNavigate={go} />}
        {page === 'client-add' && <AdsClientAdd />}
        {page === 'client-notice' && <AdsClientNotices />}
        {page === 'assign' && <AdsAssign />}
        {page === 'report' && <AdsReports />}
        {page === 'issue' && <AdsIssues />}
        {page === 'chat' && <ChatRoute />}
        {page === 'notification' && <NotificationsPage />}
        {page === 'settings' && <MemberSettingsDashboard currentUserId={userId} userName={displayName} />}
        {page === 'team' && head && <TeamMemberManagement departmentSlug={AI_DESIGN_STUDIO_SLUG} />}
      </AdsSessionProvider>
    );
  }

  return (
    <DashboardShell
      title="Amuwa Design Studio"
      subtitle={roleTitle}
      ariaLabel="Amuwa Design Studio navigation"
      groups={groups}
      active={page}
      onSelect={id => go(id as AdsPage)}
      user={{ name: displayName, role: roleTitle }}
      onSignOut={() => void logout()}
      meetingsLabel="Meeting Request"
      topLeft={
        <div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>
          {profile?.department?.name || 'Amuwa Design Studio'}
          {ctx?.role === 'TEAM_MEMBER' ? ` · ${ctx.leadName ? `Team Lead: ${ctx.leadName}` : 'No Team Lead yet'}` : ''}
        </div>
      }
      topActions={<><LeaveCenter /><NotificationBell /></>}
      wide
      flush={page === 'chat'}
    >
      {body}
    </DashboardShell>
  );
};

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bell, FileText, FolderKanban, LayoutDashboard, ListChecks, UserCheck, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { useNotifications } from '../../context/NotificationContext';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { openFromNotification } from '../issues/issueEvents';
import { DashboardShell, groupNavItems, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { AiStudioOverviewPage } from './AiStudioOverview';
import { AiStudioPeoplePage } from './AiStudioPeople';
import { DepartmentTasks, ProjectManagement } from './AiStudioProjects';
import { DepartmentReports } from './AiStudioReports';
import { AI_STUDIO_CHANGED_EVENT, useOpenAiStudioRequest } from './aiStudioEvents';
import { useRememberedPage } from '../../hooks/useRememberedPage';

const AttendancePage = React.lazy(() => import('../attendance/AttendancePage'));

const AI_STUDIO_WORKSPACE_PAGES = ['overview', 'projects', 'leads', 'members', 'tasks', 'reports', 'chat', 'notifications'] as const;
type Page = (typeof AI_STUDIO_WORKSPACE_PAGES)[number];

/** Reports waiting for the Super Admin's final decision (the badge of Daily Reports). */
function useAwaitingFinal(): number {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    aiStudioApi.overview().then(o => setN(o.department?.reportsAwaitingHead ?? 0), () => undefined);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AI_STUDIO_CHANGED_EVENT, load);
    return () => window.removeEventListener(AI_STUDIO_CHANGED_EVENT, load);
  }, [load]);
  return n;
}

/**
 * AI Studio, managed by the Super Admin as its Department Head. It opens from the Super Admin's own sidebar and has a sidebar of its own (the CRM's dashboard shell);
 * "Back to Super Admin" returns to the unchanged Super Admin dashboard. Nothing here changes the Super Admin's role: the database lets the Super Admin manage AI Studio
 * (projects, people, tasks, every report, the final approval of daily reports) and nobody from another department.
 *
 * Attendance and Meeting Requests are the CRM's own pages (the shell adds them to every menu); Attendance opens the register narrowed to AI Studio.
 */
export const AiStudioWorkspace: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const { user, logout } = useAuth();
  const { departments } = useDepartments();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const awaiting = useAwaitingFinal();
  const [page, setPage] = useRememberedPage<Page>('ai-studio-workspace', 'overview', AI_STUDIO_WORKSPACE_PAGES);
  const [nonce, setNonce] = useState(0);
  const dept = departments.find(d => d.id === 'ai-studio');
  useOpenChatRequest(useCallback(() => setPage('chat'), []));
  useOpenAiStudioRequest(useCallback(d => { setNonce(n => n + 1); setPage(d.kind === 'task' ? 'tasks' : d.kind === 'project' ? 'projects' : 'reports'); }, []));

  const items = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'leads', label: 'Team Leads', icon: UserCheck },
    { id: 'members', label: 'Team Members', icon: Users },
    { id: 'tasks', label: 'Tasks', icon: ListChecks },
    { id: 'reports', label: 'Daily Reports', icon: FileText, badge: awaiting },
    { ...CHAT_NAV, badge: chatUnread },
    { id: 'notifications', label: 'Notification Center', icon: Bell, badge: unreadCount }
  ];
  const groups: ShellNavGroup[] = groupNavItems(items, [
    { ids: ['overview', 'projects', 'leads', 'members', 'tasks', 'reports'] },
    { label: 'Communication', ids: ['chat', 'notifications'] }
  ]);
  const key = `${page}-${nonce}`;
  return (
    <DashboardShell
      title="AI Studio"
      subtitle="Managed by the Managing Director"
      ariaLabel="AI Studio navigation"
      groups={groups}
      active={page}
      meetingsLabel="Meeting Requests"
      attendanceView={<Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading</div>}><AttendancePage hrView defaultDepartment={dept?.dbId ? { id: dept.dbId, name: dept.name } : undefined} /></Suspense>}
      onSelect={id => setPage(id as Page)}
      user={{ name: user?.name || 'Managing Director', role: 'Managing Director' }}
      onSignOut={() => void logout()}
      footerExtra={
        <button type="button" onClick={onExit} className="w-full flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm font-semibold text-blue-700 hover:bg-blue-50">
          <ArrowLeft className="w-[18px] h-[18px]" aria-hidden="true" /> Back to Managing Director
        </button>
      }
      topLeft={<div className="hidden lg:block text-sm text-slate-500">AI Studio · Department Head workspace</div>}
      topActions={<NotificationBell />}
      wide
      flush={page === 'chat'}
    >
      {page === 'overview' && <AiStudioOverviewPage go={p => setPage(p === 'projects' ? 'projects' : p === 'team' ? 'members' : 'reports')} />}
      {page === 'projects' && <ProjectManagement key={key} role="ADMIN" />}
      {page === 'leads' && <AiStudioPeoplePage kind="LEAD" departmentSlug="ai-studio" />}
      {page === 'members' && <AiStudioPeoplePage kind="MEMBER" departmentSlug="ai-studio" />}
      {page === 'tasks' && <DepartmentTasks key={key} role="ADMIN" />}
      {page === 'reports' && <DepartmentReports key={key} role="ADMIN" />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage onOpenItem={n => void openFromNotification(n)} />}
    </DashboardShell>
  );
};

export default AiStudioWorkspace;

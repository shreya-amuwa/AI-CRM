import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarCheck, ClipboardList, FileSpreadsheet, LayoutDashboard, LineChart, Megaphone, ReceiptIndianRupee, Target, TrendingUp, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ClientNotices } from '../notices/ClientNotices';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { SalesOverview } from './SalesOverview';
import { LeadList } from './LeadList';
import { LeadAssign } from './LeadAssign';
import { SalesDailyTasks } from './SalesDailyTasks';
import { SalesPerformance } from './SalesPerformance';
import { SalesIncomePage } from './SalesIncomePage';
import { SalesReports } from './SalesReports';
import { ContactSheets } from '../telecaller/ContactSheets';
import { ServicePrices } from '../business-associate/ServicePrices';

export type SalesHeadPage =
  | 'overview' | 'leads-list' | 'leads-assign' | 'tasks' | 'performance' | 'income' | 'reports' | 'telecaller-sheets' | 'service-prices' | 'notices' | 'team' | 'chat' | 'notifications';

export interface SalesHeadNavigate {
  (page: SalesHeadPage, options?: { filter?: string }): void;
}

/** Page ↔ path segment after /sales-head/dashboard/:id */
const PATHS: Record<SalesHeadPage, string> = {
  overview: '',
  'leads-list': 'leads',
  'leads-assign': 'leads/assign',
  tasks: 'tasks',
  performance: 'performance',
  income: 'income',
  reports: 'reports',
  'telecaller-sheets': 'telecaller-sheets',
  'service-prices': 'service-prices',
  notices: 'notices',
  team: 'team',
  chat: 'chat',
  notifications: 'notifications'
};
export const SALES_HEAD_BASE = (userId: string) => `/sales-head/dashboard/${userId}`;
export function parseSalesHeadPage(path: string): SalesHeadPage {
  const rest = path.replace(/\/+$/, '').split('/').slice(4).join('/');
  return (Object.keys(PATHS) as SalesHeadPage[]).find(k => PATHS[k] === rest) ?? 'overview';
}

/**
 * The Sales Department Head dashboard: its own navigation, and every page reads the Sales teams of the department only (the database
 * enforces it). It shares the CRM's design pieces with the other dashboards; the Support Department Head keeps the shared Department Head
 * dashboard and its data.
 */
export const SalesHeadDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<SalesHeadPage>(() => parseSalesHeadPage(window.location.pathname));
  // a filter the page being opened should start with (the Overview cards link to the Lead List)
  const [intent, setIntent] = useState<{ filter?: string; n: number }>({ n: 0 });
  const chatUnread = useChatNavBadge();

  useEffect(() => {
    const onPop = () => setPage(parseSalesHeadPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go: SalesHeadNavigate = (next, options) => {
    setIntent(i => ({ ...options, n: i.n + 1 }));
    setPage(next);
    const seg = PATHS[next];
    navigateTo(seg ? `${SALES_HEAD_BASE(userId)}/${seg}` : SALES_HEAD_BASE(userId));
  };
  useOpenChatRequest(React.useCallback(() => go('chat'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: ShellNavGroup[] = useMemo(
    () => [
      {
        items: [
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'leads', label: 'Leads', icon: Target, children: [{ id: 'leads-list', label: 'Lead List' }, { id: 'leads-assign', label: 'Lead Assign' }] },
          { id: 'tasks', label: 'Daily Tasks', icon: CalendarCheck },
          { id: 'performance', label: 'Performance Management', icon: LineChart },
          { id: 'income', label: 'Department Income', icon: TrendingUp },
          { id: 'reports', label: 'Reports', icon: ReceiptIndianRupee },
          { id: 'telecaller-sheets', label: 'Telecaller Sheets', icon: FileSpreadsheet },
          { id: 'service-prices', label: 'Service Prices', icon: ReceiptIndianRupee },
          { id: 'notices', label: 'Client Notices', icon: Megaphone },
          { id: 'team', label: 'Team Members & Access', icon: UserPlus },
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ],
    [chatUnread]
  );

  const displayName = profile?.fullName || user?.name || 'Sales Department Head';
  const deptName = profile?.department?.name || 'Sales';

  return (
    <DashboardShell
      title="Amuwa"
      subtitle={`${deptName} · Sales`}
      ariaLabel="Sales Department Head navigation"
      groups={groups}
      active={page}
      onSelect={id => go(id as SalesHeadPage)}
      user={{ name: displayName, role: 'Sales Department Head' }}
      onSignOut={() => void logout()}
      flush={page === 'chat'}
      topLeft={
        <div className="hidden lg:flex items-center gap-2 text-sm text-slate-500" title={profile?.email}>
          <ClipboardList className="w-4 h-4" aria-hidden="true" /> Sales Department Head · {deptName}
        </div>
      }
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
      wide
    >
      {page === 'overview' && <SalesOverview go={go} />}
      {page === 'leads-list' && <LeadList key={intent.n} initialFilter={intent.filter} go={go} />}
      {page === 'leads-assign' && <LeadAssign />}
      {page === 'tasks' && <SalesDailyTasks key={intent.n} initialFilter={intent.filter} />}
      {page === 'performance' && <SalesPerformance />}
      {page === 'income' && <SalesIncomePage />}
      {page === 'reports' && <SalesReports />}
      {page === 'telecaller-sheets' && <ContactSheets />}
      {page === 'service-prices' && <ServicePrices />}
      {page === 'notices' && <ClientNotices />}
      {page === 'team' && <StaffManagementPanel departmentSlug={profile?.department?.slug || ''} subDept="sales" />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

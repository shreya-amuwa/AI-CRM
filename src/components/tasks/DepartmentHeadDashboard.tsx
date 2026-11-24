import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  Bell,
  Activity,
  CalendarCheck,
  ClipboardList,
  FileSpreadsheet,
  Headset,
  LayoutDashboard,
  LineChart,
  Megaphone,
  ReceiptIndianRupee,
  TrendingUp,
  Trophy,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Clock3,
  FileText
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { HandoverBoard } from '../handover/HandoverBoard';
import { ClientNotices } from '../notices/ClientNotices';
import { ExistingCustomerImport } from '../support/ExistingCustomerImport';
import { AccountsConfirmations } from '../accounts/AccountsConfirmations';
import { AccountsPlans } from '../accounts/AccountsPlans';
import { DepartmentIncome } from '../reports/DepartmentIncome';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { SupportDeskPage } from '../support-member/SupportDeskPage';
import { TeamActivityPage } from '../support-member/TeamActivityPage';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { useWorkTasks } from '../../lib/workTasks';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { REPORTS_NAV, ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { HEAD_PAGES, HeadOverview, useWaitingForLead, type HeadPage } from './head/HeadOverview';
import { HeadAssign } from './head/HeadAssign';
import { HeadReports } from './head/HeadReports';
import { HeadDaily } from './head/HeadDaily';
import { HeadSearch } from './head/HeadSearch';
import { PerformanceManagement } from '../performance/PerformanceManagement';
import { TopPerformersPage } from '../top-performers/TopPerformersPage';
import { ContactSheets } from '../telecaller/ContactSheets';
import { ServicePrices } from '../business-associate/ServicePrices';
import { OperationsDashboard } from '../operations/OperationsDashboard';
import { WorkUpdatesPanel, useWorkUpdateCounts } from './WorkUpdates';
import { useOpenWorkUpdateRequest } from './workUpdateEvents';
import { useRememberedPage } from '../../hooks/useRememberedPage';
import { HeadAttendancePage } from '../department-head/HeadAttendancePage';
import { HeadLeadsPage } from '../department-head/HeadLeadsPage';
import { HeadCustomersPage } from '../department-head/HeadCustomersPage';
import { HeadInvoicesPage } from '../department-head/HeadInvoicesPage';
import { TeamAttendanceSummary } from '../attendance/TeamAttendance';

/**
 * Department Head dashboard (the design handoff): grouped navigation, a search bar, and these pages.
 *   Overview    - the day at a glance, from real tasks, hand-overs and tickets.
 *   Assign      - give a task to a Team Lead; see how the lead split it and every update that came back.
 *   Reports     - how much work is completed / not, per team lead and member.
 *   Daily Tasks - what was due on a day and how much of it is completed.
 *   The rest are the existing hand-over, customer, support, notice, staff and notification pages.
 */
// The page the head was on, kept while the dashboard is re-opened for another department (the page does not reset to the Overview).
let lastHeadPage: HeadPage | null = null;

export const DepartmentHeadDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const isAccounts = profile?.department?.slug === 'accounts';
  const supportSide = profile?.headDivision === 'SUPPORT';
  const operationsHead = !!profile?.isOperationsHead;
  const [nav, setNav] = useRememberedPage<HeadPage>('department-head', lastHeadPage ?? (isAccounts ? 'payments' : operationsHead ? 'operations' : 'overview'), HEAD_PAGES);
  const [taskQuery, setTaskQuery] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  // the Overview's "Add lead": opens the Leads page with the form already open (a number, so asking twice works)
  const [addLead, setAddLead] = useState(0);
  const data = useWorkTasks();
  const waiting = useWaitingForLead();
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setNav('chat'), []));
  useOpenIssuesRequest(React.useCallback(() => setNav('raise-issue'), []));
  const reportsBadge = useReportsBadge();
  useOpenReportsRequest(React.useCallback(() => setNav('work-reports'), []));
  useOpenWorkUpdateRequest(React.useCallback(() => setNav('work-updates'), []));
  const updateCounts = useWorkUpdateCounts();

  const groups: ShellNavGroup[] = useMemo(() => {
    const work = [
      { id: 'assign', label: 'Assign', icon: ClipboardList },
      { id: 'work-updates', label: 'Work Updates', icon: Clock3, badge: updateCounts?.pending || 0 },
      { id: 'reports', label: 'Task Reports', icon: BarChart3 },
      { id: REPORTS_NAV.id, label: REPORTS_NAV.label, icon: REPORTS_NAV.icon, badge: reportsBadge },
      { id: 'performance', label: 'Performance Management', icon: LineChart },
      { id: 'top-performers', label: 'Top Performers & Rankings', icon: Trophy },
      { id: 'daily', label: 'Daily Tasks', icon: CalendarCheck },
      { id: 'activity', label: 'Team Activity', icon: Activity }
    ];
    // The Accounts Department Head also confirms the amount of customers Sales sends, and configures the monthly plans.
    if (isAccounts) {
      work.unshift({ id: 'payments', label: 'Payment confirmations', icon: ReceiptIndianRupee });
      work.push({ id: 'plans', label: 'Monthly Plans', icon: Sparkles });
    } else {
      // The income of their own department (the database refuses any other department)
      work.push({ id: 'income', label: 'Department Income', icon: TrendingUp });
      // Telecaller Sheets and Service Prices are Sales pages: a Support Department Head does not get them (the Sales Department Head dashboard has them, and
      // the database refuses a Support head either way). A head of a whole department with no side set keeps them, as before.
      if (!supportSide) {
        work.push({ id: 'telecaller-sheets', label: 'Telecaller Sheets', icon: FileSpreadsheet });
        work.push({ id: 'service-prices', label: 'Service Prices', icon: ReceiptIndianRupee });
      }
    }
    return [
      {
        items: [
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          // an Operations Head also sees the departments they oversee side by side
          ...(operationsHead ? [{ id: 'operations', label: 'Operations Dashboard', icon: Building2 }] : [])
        ]
      },
      { label: 'Work', items: work },
      {
        label: 'Customers',
        items: [
          { id: 'clients', label: 'Client Hand-overs', icon: UserCheck, badge: waiting || 0 },
          // not for the Accounts head (Accounts has its own invoice pages)
          ...(!isAccounts ? [{ id: 'leads', label: 'Leads', icon: UserPlus }] : []),
          { id: 'customers', label: 'Customers', icon: Users },
          ...(!isAccounts ? [{ id: 'invoices', label: 'Invoices', icon: FileText }] : []),
          { id: 'import', label: 'Import Customers', icon: FileSpreadsheet },
          { id: 'support', label: 'Support Desk', icon: Headset },
          { id: 'notices', label: 'Client Notices', icon: Megaphone }
        ]
      },
      {
        label: 'Team',
        items: [
          { id: 'team-attendance', label: 'Team Attendance', icon: CalendarCheck },
          { id: 'team', label: 'Team Members & Access', icon: UserPlus },
          { ...ISSUES_NAV },
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ];
  }, [isAccounts, supportSide, operationsHead, waiting, chatUnread, reportsBadge, updateCounts?.pending]);

  const pages = useMemo(() => groups.flatMap(g => g.items.map(i => ({ id: i.id as HeadPage, label: i.label }))), [groups]);
  const go = (p: HeadPage) => {
    lastHeadPage = p;
    // leaving the Leads page ends the Overview's "open the lead form" request, so the next visit starts on the list
    if (p !== 'leads') setAddLead(0);
    setNav(p);
  };
  // a page this department does not have (for example Accounts' Payment confirmations): its own first page, never a blank or stale one
  React.useEffect(() => {
    if (!pages.some(p => p.id === nav)) setNav(isAccounts ? 'payments' : operationsHead ? 'operations' : 'overview');
  }, [pages, nav, isAccounts, operationsHead]);

  return (
    <DashboardShell
      title="Amuwa"
      subtitle={operationsHead ? `CEO · ${profile?.department?.name || 'Departments'}` : profile?.department?.name || 'Department'}
      ariaLabel={operationsHead ? 'CEO navigation' : 'Department Head navigation'}
      groups={groups}
      active={nav}
      onSelect={id => go(id as HeadPage)}
      user={{ name: user?.name || (operationsHead ? 'CEO' : 'Department Head'), role: operationsHead ? 'CEO' : 'Department Head' }}
      onSignOut={() => void logout()}
      flush={nav === 'chat'}
      wide={nav === 'team'}
      topLeft={
        <HeadSearch
          data={data}
          pages={pages}
          onPage={go}
          onTask={q => {
            setTaskQuery(q);
            go('assign');
          }}
          onCustomers={q => {
            setCustomerQuery(q);
            go('customers');
          }}
        />
      }
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
    >
      {data.error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm" role="alert">
          {data.error}
        </div>
      )}
      {nav === 'overview' && <div className="mb-6"><TeamAttendanceSummary /></div>}
      {nav === 'overview' && <HeadOverview data={data} go={go} onAddLead={() => { setAddLead(n => n + 1); go('leads'); }} />}
      {nav === 'operations' && operationsHead && <OperationsDashboard />}
      {nav === 'assign' && <HeadAssign data={data} query={taskQuery} />}
      {nav === 'work-updates' && <WorkUpdatesPanel />}
      {nav === 'reports' && <HeadReports data={data} />}
      {nav === 'performance' && <PerformanceManagement mode="DEPARTMENT_HEAD" />}
      {nav === 'top-performers' && <TopPerformersPage mode={operationsHead ? 'COMPANY' : 'DEPARTMENT_HEAD'} />}
      {nav === 'daily' && <HeadDaily data={data} />}
      {nav === 'activity' && <TeamActivityPage />}
      {nav === 'support' && <SupportDeskPage />}
      {nav === 'clients' && <HandoverBoard role="DEPARTMENT_HEAD" />}
      {nav === 'leads' && !isAccounts && <HeadLeadsPage startAdd={addLead} />}
      {nav === 'customers' && <HeadCustomersPage initialSearch={customerQuery} waitingForLead={waiting} onOpenHandovers={() => go('clients')} />}
      {nav === 'invoices' && !isAccounts && <HeadInvoicesPage />}
      {nav === 'team-attendance' && <HeadAttendancePage />}
      {nav === 'notices' && <ClientNotices />}
      {nav === 'import' && <ExistingCustomerImport onDone={() => go('customers')} />}
      {nav === 'payments' && <AccountsConfirmations />}
      {nav === 'plans' && <AccountsPlans />}
      {nav === 'income' && <DepartmentIncome own />}
      {nav === 'telecaller-sheets' && !supportSide && <ContactSheets />}
      {nav === 'service-prices' && !supportSide && <ServicePrices />}
      {nav === 'chat' && <ChatRoute />}
      {nav === 'raise-issue' && <IssuesRoute />}
      {nav === 'work-reports' && <ReportsRoute />}
      {nav === 'notifications' && <NotificationsPage />}
      {nav === 'team' && <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} />}
    </DashboardShell>
  );
};

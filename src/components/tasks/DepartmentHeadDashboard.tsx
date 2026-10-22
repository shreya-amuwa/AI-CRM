import React, { useMemo, useState } from 'react';
import {
  BarChart3,
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
  Sparkles,
  UserCheck,
  UserPlus,
  Users
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { HandoverBoard } from '../handover/HandoverBoard';
import { DepartmentCustomers } from '../handover/DepartmentCustomers';
import { ClientNotices } from '../notices/ClientNotices';
import { ExistingCustomerImport } from '../support/ExistingCustomerImport';
import { AccountsConfirmations } from '../accounts/AccountsConfirmations';
import { AccountsPlans } from '../accounts/AccountsPlans';
import { DepartmentIncome } from '../reports/DepartmentIncome';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { SupportDeskPage } from '../support-member/SupportDeskPage';
import { TeamActivityPage } from '../support-member/TeamActivityPage';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { useWorkTasks } from '../../lib/workTasks';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { HeadOverview, useWaitingForLead, type HeadPage } from './head/HeadOverview';
import { HeadAssign } from './head/HeadAssign';
import { HeadReports } from './head/HeadReports';
import { HeadDaily } from './head/HeadDaily';
import { HeadSearch } from './head/HeadSearch';
import { PerformanceManagement } from '../performance/PerformanceManagement';

/**
 * Department Head dashboard (the design handoff): grouped navigation, a search bar, and these pages.
 *   Overview    - the day at a glance, from real tasks, hand-overs and tickets.
 *   Assign      - give a task to a Team Lead; see how the lead split it and every update that came back.
 *   Reports     - how much work is completed / not, per team lead and member.
 *   Daily Tasks - what was due on a day and how much of it is completed.
 *   The rest are the existing hand-over, customer, support, notice, staff and notification pages.
 */
export const DepartmentHeadDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const isAccounts = profile?.department?.slug === 'accounts';
  const [nav, setNav] = useState<HeadPage>(isAccounts ? 'payments' : 'overview');
  const [taskQuery, setTaskQuery] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const data = useWorkTasks();
  const waiting = useWaitingForLead();
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setNav('chat'), []));

  const groups: ShellNavGroup[] = useMemo(() => {
    const work = [
      { id: 'assign', label: 'Assign', icon: ClipboardList },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'performance', label: 'Performance Management', icon: LineChart },
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
    }
    return [
      { items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
      { label: 'Work', items: work },
      {
        label: 'Customers',
        items: [
          { id: 'clients', label: 'Client Hand-overs', icon: UserCheck, badge: waiting || 0 },
          { id: 'customers', label: 'Customers', icon: Users },
          { id: 'import', label: 'Import Customers', icon: FileSpreadsheet },
          { id: 'support', label: 'Support Desk', icon: Headset },
          { id: 'notices', label: 'Client Notices', icon: Megaphone }
        ]
      },
      {
        label: 'Team',
        items: [
          { id: 'team', label: 'Team Members & Access', icon: UserPlus },
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ];
  }, [isAccounts, waiting, chatUnread]);

  const pages = useMemo(() => groups.flatMap(g => g.items.map(i => ({ id: i.id as HeadPage, label: i.label }))), [groups]);
  const go = (p: HeadPage) => setNav(p);

  return (
    <DashboardShell
      title="Amuwa"
      subtitle={profile?.department?.name || 'Department'}
      ariaLabel="Department Head navigation"
      groups={groups}
      active={nav}
      onSelect={id => go(id as HeadPage)}
      user={{ name: user?.name || 'Department Head', role: 'Department Head' }}
      onSignOut={() => void logout()}
      showHelp
      flush={nav === 'chat'}
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
      {nav === 'overview' && <HeadOverview data={data} go={go} />}
      {nav === 'assign' && <HeadAssign data={data} query={taskQuery} />}
      {nav === 'reports' && <HeadReports data={data} />}
      {nav === 'performance' && <PerformanceManagement mode="DEPARTMENT_HEAD" />}
      {nav === 'daily' && <HeadDaily data={data} />}
      {nav === 'activity' && <TeamActivityPage />}
      {nav === 'support' && <SupportDeskPage />}
      {nav === 'clients' && <HandoverBoard role="DEPARTMENT_HEAD" />}
      {nav === 'customers' && <DepartmentCustomers initialSearch={customerQuery} waitingForLead={waiting} onOpenHandovers={() => go('clients')} />}
      {nav === 'notices' && <ClientNotices />}
      {nav === 'import' && <ExistingCustomerImport onDone={() => go('customers')} />}
      {nav === 'payments' && <AccountsConfirmations />}
      {nav === 'plans' && <AccountsPlans />}
      {nav === 'income' && <DepartmentIncome own />}
      {nav === 'chat' && <ChatRoute />}
      {nav === 'notifications' && <NotificationsPage />}
      {nav === 'team' && <StaffManagementPanel departmentSlug={profile?.department?.slug || ''} />}
    </DashboardShell>
  );
};

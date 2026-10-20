import React, { useEffect, useState } from 'react';
import { BadgeCheck, BarChart3, Bell, Building2, FileText, LayoutDashboard, ReceiptIndianRupee, Sparkles, TrendingUp, Wallet, WalletCards } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { addonsApi, pipelineApi } from '../../lib/api/endpoints';
import type { AccountsPaymentCounts } from '../../../shared/contracts';
import { PartPaymentsView } from '../payments/PartPaymentsView';
import { useNotifications } from '../../context/NotificationContext';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { AccountsConfirmations } from './AccountsConfirmations';
import { BusinessVerification } from './BusinessVerification';
import { AccountsInvoices } from './AccountsInvoices';
import { AccountsPlans } from './AccountsPlans';
import { AccountsOverview } from './finance/AccountsOverview';
import { AccountsIncome } from './finance/AccountsIncome';
import { AccountsDepartmentIncome } from './finance/AccountsDepartmentIncome';
import { AccountsExpenses } from './finance/AccountsExpenses';
import { BusinessReports } from '../reports/BusinessReports';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { LeaveCenter } from '../leave/LeaveCenter';

type Page = 'overview' | 'income' | 'confirmations' | 'business-verification' | 'invoices' | 'plans' | 'part-payments' | 'department-income' | 'business-reports' | 'expenses' | 'chat' | 'notifications';

/**
 * Accounts department staff (members and leads): company finance overview, income,
 * payment confirmation, Business Verification of add-ons, invoices (Accounts is the only department
 * that issues them), part-payment follow-ups, department income, expenses, analytics.
 */
export const AccountsDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const [page, setPage] = useState<Page>('overview');
  // choosing the page you are already on starts it afresh (Department Income goes back to its department cards)
  const [pageKey, setPageKey] = useState(0);
  const [counts, setCounts] = useState<AccountsPaymentCounts | null>(null);
  // Add-on requests that wait for Accounts: to verify, or approved and waiting for the invoice.
  const [addonsWaiting, setAddonsWaiting] = useState(0);
  const refreshCounts = () => {
    pipelineApi.accountsCounts().then(setCounts, () => setCounts(null));
    addonsApi.list({ pageSize: 1 }).then(
      r => setAddonsWaiting((r.counts.PENDING_VERIFICATION ?? 0) + (r.counts.APPROVED ?? 0)),
      () => setAddonsWaiting(0)
    );
  };
  useEffect(refreshCounts, []);
  useOpenChatRequest(React.useCallback(() => setPage('chat'), []));
  usePipelineRealtime(refreshCounts);

  const displayName = profile?.fullName || user?.name || 'Accounts';
  const groups: ShellNavGroup[] = [
    { items: [{ id: 'overview', label: 'Account Overview', icon: LayoutDashboard }] },
    {
      label: 'Payments',
      items: [
        { id: 'confirmations', label: 'Confirmation', icon: ReceiptIndianRupee, badge: (counts?.requestsPending ?? 0) + (counts?.onboardingPending ?? 0) },
        { id: 'business-verification', label: 'Business Verification', icon: BadgeCheck, badge: addonsWaiting },
        { id: 'part-payments', label: 'Part Payment', icon: Wallet, badge: counts?.followUpsDue ?? 0 },
        { id: 'invoices', label: 'Invoices', icon: FileText },
        { id: 'plans', label: 'Monthly Plans', icon: Sparkles }
      ]
    },
    {
      label: 'Finance',
      items: [
        { id: 'income', label: 'Income', icon: TrendingUp },
        { id: 'department-income', label: 'Department Income', icon: Building2 },
        { id: 'expenses', label: 'Expenses', icon: WalletCards },
        { id: 'business-reports', label: 'Business Reports', icon: BarChart3 }
      ]
    },
    {
      label: 'Team',
      items: [
        { ...CHAT_NAV, badge: chatUnread },
        { id: 'notifications', label: 'Notification Center', icon: Bell, badge: unreadCount }
      ]
    }
  ];

  return (
    <DashboardShell
      title="Amuwa Accounts"
      subtitle={profile?.department?.name || 'Accounts Department'}
      ariaLabel="Accounts navigation"
      groups={groups}
      active={page}
      onSelect={id => {
        if (id === page) setPageKey(k => k + 1);
        setPage(id as Page);
      }}
      user={{ name: displayName, role: 'Accounts' }}
      onSignOut={() => void logout()}
      topLeft={<div className="hidden lg:block text-sm text-slate-500">{profile?.department?.name || 'Accounts Department'}</div>}
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
      wide
      flush={page === 'chat'}
    >
      {page === 'overview' && <AccountsOverview />}
      {page === 'income' && <AccountsIncome />}
      {page === 'confirmations' && <AccountsConfirmations onCountsChanged={refreshCounts} />}
      {page === 'business-verification' && <BusinessVerification onCountsChanged={refreshCounts} />}
      {page === 'invoices' && <AccountsInvoices />}
      {page === 'plans' && <AccountsPlans />}
      {page === 'part-payments' && <PartPaymentsView mode="accounts" onCountsChanged={refreshCounts} />}
      {page === 'department-income' && <AccountsDepartmentIncome key={pageKey} />}
      {page === 'business-reports' && <BusinessReports />}
      {page === 'expenses' && <AccountsExpenses />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

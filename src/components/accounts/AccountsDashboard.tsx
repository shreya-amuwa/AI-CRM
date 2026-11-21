import React, { useEffect, useState } from 'react';
import { BadgeCheck, BarChart3, Bell, Building2, Crown, MailCheck, FileText, KeyRound, Layers, LayoutDashboard, ReceiptIndianRupee, Sparkles, TrendingUp, Wallet, WalletCards } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { addonsApi, pipelineApi } from '../../lib/api/endpoints';
import type { AccountsPaymentCounts } from '../../../shared/contracts';
import { PartPaymentsView } from '../payments/PartPaymentsView';
import { useNotifications } from '../../context/NotificationContext';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { REPORTS_NAV, ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { useOpenChatRequest } from '../chat/chatEvents';
import { AccountsConfirmations } from './AccountsConfirmations';
import { ClientLogins } from './ClientLogins';
import { BusinessVerification } from './BusinessVerification';
import { AccountsInvoices } from './AccountsInvoices';
import { AccountsPlans } from './AccountsPlans';
import { AccountsOverview } from './finance/AccountsOverview';
import { AccountsIncome } from './finance/AccountsIncome';
import { AccountsDepartmentIncome } from './finance/AccountsDepartmentIncome';
import { AccountsExpenses } from './finance/AccountsExpenses';
import { CustomerRevenue } from './finance/CustomerRevenue';
import { FinanceMails } from './finance/FinanceMails';
import { BusinessReports } from '../reports/BusinessReports';
import { DepartmentIncome } from '../reports/DepartmentIncome';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { LeaveCenter } from '../leave/LeaveCenter';
import { useRememberedPage } from '../../hooks/useRememberedPage';

const ACCOUNTS_PAGES = ['overview', 'income', 'confirmations', 'client-logins', 'business-verification', 'invoices', 'plans', 'part-payments', 'department-income', 'income-attribution', 'customer-revenue', 'finance-mails', 'business-reports', 'expenses', 'chat', 'raise-issue', 'work-reports', 'notifications'] as const;
type Page = (typeof ACCOUNTS_PAGES)[number];

/**
 * Accounts department staff (members and leads): company finance overview, income,
 * payment confirmation, Business Verification of add-ons, invoices (Accounts is the only department
 * that issues them), part-payment follow-ups, department income, expenses, analytics.
 */
export const AccountsDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const [page, setPage] = useRememberedPage<Page>('accounts', 'overview', ACCOUNTS_PAGES);
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
  useOpenIssuesRequest(React.useCallback(() => setPage('raise-issue'), []));
  const reportsBadge = useReportsBadge();
  useOpenReportsRequest(React.useCallback(() => setPage('work-reports'), []));
  usePipelineRealtime(refreshCounts);

  const displayName = profile?.fullName || user?.name || 'Accounts';
  const groups: ShellNavGroup[] = [
    { items: [{ id: 'overview', label: 'Account Overview', icon: LayoutDashboard }] },
    {
      label: 'Payments',
      items: [
        { id: 'confirmations', label: 'Confirmation', icon: ReceiptIndianRupee, badge: (counts?.requestsPending ?? 0) + (counts?.onboardingPending ?? 0) },
        { id: 'client-logins', label: 'Client Logins', icon: KeyRound },
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
        { id: 'income-attribution', label: 'Income by Division', icon: Layers },
        { id: 'customer-revenue', label: 'Customer-wise Revenue', icon: Crown },
        { id: 'finance-mails', label: 'Finance e-mails', icon: MailCheck },
        { id: 'expenses', label: 'Expenses', icon: WalletCards },
        { id: 'business-reports', label: 'Business Reports', icon: BarChart3 }
      ]
    },
    {
      label: 'Team',
      items: [
        { ...REPORTS_NAV, badge: reportsBadge },
        { ...ISSUES_NAV },
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
      {page === 'client-logins' && <ClientLogins />}
      {page === 'business-verification' && <BusinessVerification onCountsChanged={refreshCounts} />}
      {page === 'invoices' && <AccountsInvoices />}
      {page === 'plans' && <AccountsPlans />}
      {page === 'part-payments' && <PartPaymentsView mode="accounts" onCountsChanged={refreshCounts} />}
      {page === 'department-income' && <AccountsDepartmentIncome key={pageKey} />}
      {page === 'income-attribution' && <DepartmentIncome />}
      {page === 'customer-revenue' && <CustomerRevenue />}
      {page === 'finance-mails' && <FinanceMails />}
      {page === 'business-reports' && <BusinessReports />}
      {page === 'expenses' && <AccountsExpenses />}
      {page === 'chat' && <ChatRoute />}
      {page === 'raise-issue' && <IssuesRoute />}
      {page === 'work-reports' && <ReportsRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Bell, Building2, LayoutDashboard, LogOut, Menu, ReceiptIndianRupee, TrendingUp, Wallet, WalletCards, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { pipelineApi } from '../../lib/api/endpoints';
import type { AccountsPaymentCounts } from '../../../shared/contracts';
import { PartPaymentsView } from '../payments/PartPaymentsView';
import { useNotifications } from '../../context/NotificationContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { AccountsConfirmations } from './AccountsConfirmations';
import { AccountsOverview } from './finance/AccountsOverview';
import { AccountsIncome } from './finance/AccountsIncome';
import { AccountsDepartmentIncome } from './finance/AccountsDepartmentIncome';
import { AccountsExpenses } from './finance/AccountsExpenses';
import { AccountsAnalytics } from './finance/AccountsAnalytics';
import { AccountsNotifications } from './finance/AccountsNotifications';

type Page = 'overview' | 'income' | 'confirmations' | 'part-payments' | 'department-income' | 'expenses' | 'analytics' | 'notifications';

/**
 * Accounts department staff (members and leads): company finance overview, income,
 * payment confirmation, part-payment follow-ups, department income, expenses, analytics.
 */
export const AccountsDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [page, setPage] = useState<Page>('overview');
  const [counts, setCounts] = useState<AccountsPaymentCounts | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const refreshCounts = () => {
    pipelineApi.accountsCounts().then(setCounts, () => setCounts(null));
  };
  useEffect(refreshCounts, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const displayName = profile?.fullName || user?.name || 'Accounts';

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 antialiased">
      {menuOpen && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-white border-r border-slate-200/80 z-50 flex flex-col justify-between p-4 transition-transform ${
          menuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Accounts navigation"
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <AmuwaLogo size="sm" />
              <div className="leading-tight">
                <span className="block text-sm font-bold text-slate-900">Amuwa Accounts</span>
                <span className="block text-[11px] text-slate-500 font-medium">{profile?.department?.name || 'Accounts Department'}</span>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="lg:hidden p-1.5 text-slate-400 rounded-lg" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="space-y-1" aria-label="Accounts pages">
            {(
              [
                ['overview', 'Account Overview', LayoutDashboard, 0],
                ['income', 'Income', TrendingUp, 0],
                ['confirmations', 'Confirmation', ReceiptIndianRupee, (counts?.requestsPending ?? 0) + (counts?.onboardingPending ?? 0)],
                ['part-payments', 'Part Payment', Wallet, counts?.followUpsDue ?? 0],
                ['department-income', 'Department Income', Building2, 0],
                ['expenses', 'Expenses', WalletCards, 0],
                ['analytics', 'Overall Analytics', BarChart3, 0],
                ['notifications', 'Notification Center', Bell, unreadCount]
              ] as const
            ).map(([key, label, Icon, n]) => (
              <button
                key={key}
                type="button"
                aria-current={page === key ? 'page' : undefined}
                onClick={() => {
                  setPage(key);
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left ${page === key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${page === key ? 'text-blue-600' : 'text-slate-400'}`} aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {n > 0 && <span className="min-w-[20px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold text-center">{n}</span>}
              </button>
            ))}
          </nav>
        </div>
        <button type="button" onClick={() => void logout()} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50">
          <LogOut className="w-[18px] h-[18px]" aria-hidden="true" /> Sign out
        </button>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200/80 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
          <button onClick={() => setMenuOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden lg:block text-xs text-slate-400">{profile?.department?.name || 'Accounts Department'}</div>
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen(o => !o)}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-expanded={bellOpen}
                className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-100 p-4 z-50 text-sm">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <span className="font-bold text-slate-900">Notifications</span>
                    {unreadCount > 0 && (
                      <button type="button" onClick={() => markAllAsRead()} className="text-xs text-blue-600 font-semibold">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="py-8 text-center text-xs text-slate-400">You're all caught up.</p>
                    ) : (
                      notifications.map(n => (
                        <button key={n.id} type="button" onClick={() => !n.isRead && markAsRead(n.id)} className={`w-full text-left py-3 px-1 ${n.isRead ? '' : 'bg-blue-50/40'} hover:bg-slate-50`}>
                          <div className="font-semibold text-slate-800 text-xs">{n.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{n.message}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="pl-3 border-l border-slate-200 text-left">
              <div className="text-xs font-bold text-slate-900 leading-none">{displayName}</div>
              <div className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">Accounts</div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
          {page === 'overview' && <AccountsOverview />}
          {page === 'income' && <AccountsIncome />}
          {page === 'confirmations' && <AccountsConfirmations onCountsChanged={refreshCounts} />}
          {page === 'part-payments' && <PartPaymentsView mode="accounts" onCountsChanged={refreshCounts} />}
          {page === 'department-income' && <AccountsDepartmentIncome />}
          {page === 'expenses' && <AccountsExpenses />}
          {page === 'analytics' && <AccountsAnalytics />}
          {page === 'notifications' && <AccountsNotifications />}
        </main>
      </div>
    </div>
  );
};

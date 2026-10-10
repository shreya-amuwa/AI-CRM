import React, { useEffect, useRef, useState } from 'react';
import { Bell, ClipboardList, FileText, Headset, LayoutDashboard, LogOut, Menu, UserCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { navigateTo } from '../../utils/router';
import { useWorkTasks } from '../../lib/workTasks';
import { useSupportInvoices, useTickets } from '../../lib/support';
import { CustomerProfile, CustomersPage } from './CustomersPage';
import { TasksPage } from './TasksPage';
import { AddCustomerPage } from './AddCustomerPage';
import { TicketsPage } from './TicketsPage';
import { InvoicesPage } from './InvoicesPage';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { HandoverBoard } from '../handover/HandoverBoard';

export type SupportPage = 'customers' | 'my-clients' | 'tasks' | 'add-customer' | 'tickets' | 'invoices' | 'notifications';

/** Sidebar order is fixed: Dashboard, My Clients, Assigned Tasks, Add Customer, Tickets, Invoices. */
const NAV: { id: SupportPage; label: string; icon: React.ElementType }[] = [
  { id: 'customers', label: 'Dashboard - Existing Customers', icon: LayoutDashboard },
  // Clients handed over Technical Consultant -> Department Head -> Support Team Lead -> me.
  { id: 'my-clients', label: 'My Clients', icon: UserCheck },
  { id: 'tasks', label: 'Assigned Tasks', icon: ClipboardList },
  { id: 'add-customer', label: 'Add Customer', icon: UserPlus },
  { id: 'tickets', label: 'Tickets', icon: Headset },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'notifications', label: 'Notification Center', icon: Bell }
];

export const SUPPORT_BASE = (userId: string) => `/support-member/dashboard/${userId}`;

export function parseSupportPage(path: string): SupportPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  return NAV.some(n => n.id === seg) ? (seg as SupportPage) : 'customers';
}

/**
 * Support Team Member dashboard: only for team members of a Support team
 * (not Sales, not Technical Consultants). Every page reads and writes the CRM
 * database; the team lead and department head see the same records.
 */
export const SupportMemberDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<SupportPage>(() => parseSupportPage(window.location.pathname));
  const [profileId, setProfileId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();

  useEffect(() => {
    const onPop = () => setPage(parseSupportPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBellOpen(false);
        setUserMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (next: SupportPage) => {
    setProfileId(null);
    setNotice(null);
    setMenuOpen(false);
    setPage(next);
    navigateTo(next === 'customers' ? SUPPORT_BASE(userId) : `${SUPPORT_BASE(userId)}/${next}`);
  };
  const openCustomer = (id: string) => {
    setMenuOpen(false);
    setProfileId(id);
    window.scrollTo({ top: 0 });
  };

  const displayName = profile?.fullName || user?.name || 'Support Team Member';
  const teamName = profile?.team?.name;

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 antialiased">
      {menuOpen && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-white border-r border-slate-200/80 z-50 flex flex-col justify-between p-4 transition-transform ${
          menuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Support navigation"
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <AmuwaLogo size="sm" />
              <div className="leading-tight">
                <span className="block text-sm font-bold text-slate-900">Amuwa Support</span>
                <span className="block text-[11px] text-slate-500 font-medium">{profile?.department?.name || 'Support'}</span>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="lg:hidden p-1.5 text-slate-400 rounded-lg" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="space-y-1" aria-label="Support pages">
            {NAV.map(item => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50"
        >
          <LogOut className="w-[18px] h-[18px]" aria-hidden="true" /> Sign out
        </button>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200/80 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
          <button onClick={() => setMenuOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden lg:block text-xs text-slate-400">
            {profile?.department?.name || 'Support'}
            {teamName ? ` · ${teamName}` : ''}
          </div>
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
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => !n.isRead && markAsRead(n.id)}
                          className={`w-full text-left py-3 px-1 ${n.isRead ? '' : 'bg-blue-50/40'} hover:bg-slate-50`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 text-xs">{n.title}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{n.message}</div>
                              <div className="text-[10px] text-slate-400 mt-1">{n.timestamp}</div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="relative pl-3 border-l border-slate-200" ref={userRef}>
              <button type="button" onClick={() => setUserMenu(o => !o)} aria-expanded={userMenu} aria-haspopup="menu" className="text-left">
                <div className="text-xs font-bold text-slate-900 leading-none">{displayName}</div>
                <div className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">Support Team Member</div>
              </button>
              {userMenu && (
                <div role="menu" className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-slate-100 mb-1">
                    <div className="font-semibold text-slate-800 truncate">{profile?.email}</div>
                    <div className="text-slate-400">
                      {profile?.department?.name}
                      {teamName ? ` · ${teamName}` : ''}
                    </div>
                  </div>
                  <button role="menuitem" type="button" onClick={() => void logout()} className="w-full text-left px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
          {profileId ? (
            <CustomerProfile
              customerId={profileId}
              tickets={tickets}
              tasks={tasks}
              invoices={invoices.invoices}
              people={tasks.people}
              onBack={() => setProfileId(null)}
            />
          ) : page === 'customers' ? (
            <CustomersPage mode="member" tickets={tickets} tasks={tasks} notice={notice} onOpenCustomer={openCustomer} onAddCustomer={() => go('add-customer')} />
          ) : page === 'my-clients' ? (
            <HandoverBoard role="TEAM_MEMBER" />
          ) : page === 'tasks' ? (
            <TasksPage tasks={tasks} onOpenCustomer={openCustomer} />
          ) : page === 'add-customer' ? (
            <AddCustomerPage
              people={tasks.people}
              onCancel={() => go('customers')}
              onCreated={name => {
                go('customers');
                setNotice(`${name} was added to your customers.`);
              }}
            />
          ) : page === 'tickets' ? (
            <TicketsPage mode="member" data={tickets} people={tasks.people} onOpenCustomer={openCustomer} />
          ) : page === 'notifications' ? (
            <NotificationsPage />
          ) : (
            <InvoicesPage data={invoices} onOpenCustomer={openCustomer} />
          )}
        </main>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Home,
  UserCheck,
  Users,
  Handshake,
  CheckSquare,
  Calendar as CalendarIcon,
  FileText,
  Settings,
  HelpCircle,
  Bell,
  LogOut,
  Menu,
  X,
  Navigation
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';

export type TeamMemberNav =
  | 'home'
  | 'leads'
  | 'field-visits'
  | 'customers'
  | 'deals'
  | 'tasks'
  | 'calendar'
  | 'invoices'
  | 'settings';

interface TeamMemberLayoutProps {
  children: React.ReactNode;
  activeNav?: TeamMemberNav;
  onSelectNav?: (nav: TeamMemberNav) => void;
}

export const TeamMemberLayout: React.FC<TeamMemberLayoutProps> = ({
  children,
  activeNav = 'leads',
  onSelectNav
}) => {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const navItems = [
    { id: 'home' as TeamMemberNav, label: 'Home', icon: Home },
    { id: 'leads' as TeamMemberNav, label: 'My Leads', icon: UserCheck },
    { id: 'field-visits' as TeamMemberNav, label: 'Field Visits (GPS)', icon: Navigation },
    { id: 'customers' as TeamMemberNav, label: 'My Customers', icon: Users },
    { id: 'deals' as TeamMemberNav, label: 'Deals', icon: Handshake },
    { id: 'tasks' as TeamMemberNav, label: 'Tasks & Follow-ups', icon: CheckSquare },
    { id: 'calendar' as TeamMemberNav, label: 'Calendar', icon: CalendarIcon },
    { id: 'invoices' as TeamMemberNav, label: 'Invoices', icon: FileText },
    { id: 'settings' as TeamMemberNav, label: 'Settings', icon: Settings }
  ];

  const [currentNav, setCurrentNav] = useState<TeamMemberNav>(activeNav || 'leads');

  React.useEffect(() => {
    if (activeNav) {
      setCurrentNav(activeNav);
    }
  }, [activeNav]);

  const handleNavClick = (id: TeamMemberNav) => {
    setCurrentNav(id);
    if (onSelectNav) {
      onSelectNav(id);
    }
    setIsMobileMenuOpen(false);
  };

  const displayName = user?.name || 'Team Member';
  const displayRole = user?.position || 'Sales Executive';

  // Close the notification panel on outside click or Escape.
  const bellRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isNotificationsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setIsNotificationsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsNotificationsOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isNotificationsOpen]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex font-sans antialiased">
      
      {/* MOBILE BACKDROP */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 h-screen w-60 bg-white border-r border-slate-200/80 
          z-50 flex flex-col justify-between p-4 transition-transform duration-200 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="space-y-6">
          {/* Logo */}
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white font-bold shadow-xs">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="leading-tight">
                <span className="block text-sm font-bold tracking-tight text-slate-900">Amuwa</span>
                <span className="block text-[11px] text-slate-500 font-medium -mt-0.5">Corporation</span>
              </div>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left
                    ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 font-bold shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }
                  `}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section */}
        <div className="space-y-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => alert('Support team contacted: support@amuwa.com')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors text-left"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-xs font-semibold text-slate-700">Need help?</div>
              <div className="text-[10px] text-slate-400">Contact support</div>
            </div>
          </button>

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP BAR / HEADER */}
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          {/* Mobile hamburger + Search bar */}
          <div className="flex items-center gap-3 flex-1">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>

          </div>

          {/* Right actions: notifications and user profile */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Notification Bell (live notifications from the database) */}
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-expanded={isNotificationsOpen}
                className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-100 p-4 z-50 text-sm animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <span className="font-bold text-slate-900">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllAsRead()}
                        className="text-xs text-blue-600 font-semibold cursor-pointer hover:text-blue-700"
                      >
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
                          className={`w-full text-left py-3 px-1 ${n.isRead ? '' : 'bg-blue-50/40'} hover:bg-slate-50 transition-colors cursor-pointer`}
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

            {/* Profile Info */}
            <div className="flex items-center pl-3 border-l border-slate-200">
              <div className="text-left">
                <div className="text-xs font-bold text-slate-900 leading-none">{displayName}</div>
                <div className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">{displayRole}</div>
              </div>
            </div>
          </div>
        </header>

        {/* MAIN SCROLLABLE VIEW */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Home,
  UserCheck,
  Users,
  Handshake,
  CheckSquare,
  Calendar as CalendarIcon,
  FileText,
  BarChart3,
  Settings,
  HelpCircle,
  Bell,
  Search,
  LogOut,
  Menu,
  X,
  Navigation
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';

export type TeamMemberNav =
  | 'home'
  | 'leads'
  | 'field-visits'
  | 'customers'
  | 'deals'
  | 'tasks'
  | 'calendar'
  | 'invoices'
  | 'reports'
  | 'settings';

interface TeamMemberLayoutProps {
  children: React.ReactNode;
  activeNav?: TeamMemberNav;
  onSelectNav?: (nav: TeamMemberNav) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

export const TeamMemberLayout: React.FC<TeamMemberLayoutProps> = ({
  children,
  activeNav = 'leads',
  onSelectNav,
  searchQuery = '',
  onSearchChange
}) => {
  const { user, logout } = useAuth();
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
    { id: 'reports' as TeamMemberNav, label: 'Reports', icon: BarChart3 },
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

  const displayName = user?.name || 'Priya Nair';
  const displayRole = 'Sales Executive';
  const displayAvatar =
    user?.avatar ||
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80';

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
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="relative w-full max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
                placeholder="Search leads, customers, or anything..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-sans"
              />
            </div>
          </div>

          {/* Right actions: notifications and user profile */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
                  1
                </span>
              </button>

              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 p-3 z-50 text-xs animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <span className="font-bold text-slate-900">Notifications</span>
                    <span className="text-[10px] text-blue-600 font-semibold cursor-pointer">Mark read</span>
                  </div>
                  <div className="py-2.5">
                    <div className="font-semibold text-slate-800">Follow-up due in 30 mins</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Rohan Mehta (Rohan Traders) – Discuss proposal</div>
                    <div className="text-[10px] text-slate-400 mt-1">10:00 AM today</div>
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar & Info */}
            <div className="flex items-center gap-3 pl-2 sm:border-l border-slate-200">
              <img
                src={displayAvatar}
                alt={displayName}
                className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200"
              />
              <div className="hidden sm:block text-left">
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

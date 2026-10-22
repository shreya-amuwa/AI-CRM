import React, { useState } from 'react';
import {
  Home,
  UserCheck,
  Users,
  CheckSquare,
  Calendar as CalendarIcon,
  FileText,
  Settings,
  HelpCircle,
  Bell,
  ChevronDown,
  ClipboardList,
  PackageCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { memberTitle } from '../../lib/auth/roleMapping';
import { NavButton, NavGroupLabel, SidebarBrand, SidebarFrame, TopBar } from '../layout/shell';
import { closeMenu } from '../layout/menuState';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { LeaveCenter } from '../leave/LeaveCenter';

export type TeamMemberNav =
  | 'home'
  | 'leads'
  | 'potential'
  | 'onboarding'
  | 'part-payments'
  | 'customers'
  | 'tasks'
  | 'work-tasks'
  | 'my-clients'
  | 'calendar'
  | 'invoices'
  | 'delivery'
  | 'settings'
  | 'chat'
  | 'notifications';

interface TeamMemberLayoutProps {
  children: React.ReactNode;
  activeNav?: TeamMemberNav;
  onSelectNav?: (nav: TeamMemberNav) => void;
  /** Live counts for the My Leads sub-tree (from the database). */
  pipelineCounts?: { leads: number; potential: number; onboarding: number; partPayments?: number; returned?: number } | null;
}

const PIPELINE_CHILDREN: { id: TeamMemberNav; label: string; step: number; badge: string; activeBadge: string; countKey: 'leads' | 'potential' | 'onboarding' | 'partPayments' }[] = [
  { id: 'leads', label: 'Leads', step: 1, badge: 'bg-indigo-50 text-indigo-700', activeBadge: 'bg-indigo-600 text-white', countKey: 'leads' },
  { id: 'potential', label: 'Potential', step: 2, badge: 'bg-orange-50 text-orange-700', activeBadge: 'bg-orange-700 text-white', countKey: 'potential' },
  { id: 'onboarding', label: 'Customer onboarding', step: 3, badge: 'bg-emerald-50 text-emerald-700', activeBadge: 'bg-emerald-700 text-white', countKey: 'onboarding' },
  { id: 'part-payments', label: 'Part payments', step: 4, badge: 'bg-blue-50 text-blue-700', activeBadge: 'bg-blue-700 text-white', countKey: 'partPayments' }
];
const isPipelineNav = (n: TeamMemberNav) => n === 'leads' || n === 'potential' || n === 'onboarding' || n === 'part-payments';

export const TeamMemberLayout: React.FC<TeamMemberLayoutProps> = ({
  children,
  activeNav = 'leads',
  onSelectNav,
  pipelineCounts
}) => {
  const { user, logout } = useAuth();

  const navItems = [
    { id: 'home' as TeamMemberNav, label: 'Home', icon: Home },
    { id: 'leads' as TeamMemberNav, label: 'My Leads', icon: UserCheck },
    { id: 'customers' as TeamMemberNav, label: 'My Customers', icon: Users },
    { id: 'calendar' as TeamMemberNav, label: 'Calendar', icon: CalendarIcon },
    { id: 'invoices' as TeamMemberNav, label: 'Invoices', icon: FileText },
    { id: 'work-tasks' as TeamMemberNav, label: 'My Tasks', icon: ClipboardList },
    { id: 'tasks' as TeamMemberNav, label: 'Tasks & Follow-ups', icon: CheckSquare },
    // services other departments sent here for delivery (empty for most teams)
    { id: 'delivery' as TeamMemberNav, label: 'Delivery Queue', icon: PackageCheck },
    { id: 'settings' as TeamMemberNav, label: 'Settings', icon: Settings },
    { id: CHAT_NAV.id as TeamMemberNav, label: CHAT_NAV.label, icon: CHAT_NAV.icon },
    { id: 'notifications' as TeamMemberNav, label: 'Notification Center', icon: Bell }
  ];
  // the menu reads in sections, like the Department Head's: the label is shown above the first entry of each
  const SECTION_LABEL: Partial<Record<TeamMemberNav, string>> = { leads: 'Sales', 'work-tasks': 'Work', settings: 'Team' };

  const [currentNav, setCurrentNav] = useState<TeamMemberNav>(activeNav || 'leads');
  const [leadsOpen, setLeadsOpen] = useState(() => isPipelineNav(activeNav || 'leads'));

  React.useEffect(() => {
    if (activeNav) {
      setCurrentNav(activeNav);
      if (isPipelineNav(activeNav)) setLeadsOpen(true);
    }
  }, [activeNav]);

  const handleNavClick = (id: TeamMemberNav) => {
    setCurrentNav(id);
    if (onSelectNav) {
      onSelectNav(id);
    }
    closeMenu();
  };

  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => handleNavClick('chat'), []));
  const displayName = user?.name || 'Team Member';
  const displayRole = memberTitle(user);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex font-sans antialiased">
      <SidebarFrame
        ariaLabel="Team Member navigation"
        footer={
          <>
            <button
              type="button"
              onClick={() => alert('Support team contacted: support@amuwa.com')}
              className="flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm text-slate-700 hover:bg-slate-50 text-left"
            >
              <HelpCircle className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.9} aria-hidden="true" /> Need help?
            </button>
          </>
        }
      >
        <SidebarBrand title="Amuwa" subtitle="Corporation" />
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {navItems.map(item => {
            const sectionLabel = SECTION_LABEL[item.id];
            const Icon = item.icon;
            const entry = (() => {
            if (item.id === 'leads') {
              const inPipeline = isPipelineNav(currentNav);
              return (
                <div key="my-leads">
                  <NavButton
                    label={item.label}
                    icon={Icon}
                    active={inPipeline}
                    onClick={() => {
                      if (!inPipeline) {
                        setLeadsOpen(true);
                        handleNavClick('leads');
                      } else {
                        setLeadsOpen(o => !o);
                      }
                    }}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${leadsOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                  </NavButton>
                  {leadsOpen && (
                    <ul id="my-leads-subtree" role="group" aria-label="My Leads" className="mt-1 ml-4 pl-2.5 border-l border-slate-200 space-y-0.5">
                      {PIPELINE_CHILDREN.map(child => {
                        const active = currentNav === child.id;
                        const count = pipelineCounts?.[child.countKey];
                        return (
                          <li key={child.id}>
                            <button
                              type="button"
                              aria-current={active ? 'page' : undefined}
                              onClick={() => handleNavClick(child.id)}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[13px] text-left transition-colors ${
                                active ? 'bg-blue-50 font-bold text-blue-700' : 'font-medium text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`w-5 h-5 rounded-md inline-flex items-center justify-center text-[10px] font-bold shrink-0 ${active ? child.activeBadge : child.badge}`}
                              >
                                {child.step}
                              </span>
                              <span className="flex-1 leading-tight">{child.label}</span>
                              {child.id === 'onboarding' && (pipelineCounts?.returned ?? 0) > 0 && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-700 text-white"
                                  title="Returned by the Technical Consultant"
                                  aria-label={`${pipelineCounts?.returned} returned by the Technical Consultant`}
                                >
                                  {pipelineCounts?.returned} returned
                                </span>
                              )}
                              {count !== undefined && (
                                <span
                                  className={`text-[11px] font-semibold ${active ? `px-1.5 py-0.5 rounded-md ${child.badge}` : 'text-slate-500'}`}
                                  aria-label={`${count} ${child.label.toLowerCase()}`}
                                >
                                  {count}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            }
            return <NavButton key={item.id} label={item.label} icon={Icon} badge={item.id === 'chat' ? chatUnread : undefined} active={currentNav === item.id} onClick={() => handleNavClick(item.id)} />;
            })();
            return (
              <React.Fragment key={item.id}>
                {sectionLabel ? <div className="pt-3"><NavGroupLabel>{sectionLabel}</NavGroupLabel></div> : null}
                {entry}
              </React.Fragment>
            );
          })}
        </nav>
      </SidebarFrame>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          actions={
            <>
              <LeaveCenter />
              <NotificationBell />
            </>
          }
          user={{ name: displayName, role: displayRole }}
          onSignOut={() => void logout()}
        />
        <main className={currentNav === 'chat' ? 'flex-1 min-w-0' : 'flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-7 overflow-y-auto'}>
          {currentNav === 'chat' && <ChatRoute />}
          <div hidden={currentNav === 'chat'}>{children}</div>
        </main>
      </div>
    </div>
  );
};

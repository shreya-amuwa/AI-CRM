import React from 'react';
import { LayoutDashboard, Users, GraduationCap, Settings, ArrowLeft, Radio, Palette, MessageSquare, Database, Bot, Send, ShoppingBag, ShoppingCart, MessageCircle, UserCheck, PhoneCall, PhoneForwarded, QrCode, BarChart3, Briefcase, ShieldCheck, Headphones, Target, Globe, FileSpreadsheet, Zap, Code, Share2, Phone, UserPlus, Bot as RobotIcon, Building2, HelpCircle, Bell, Edit3, BookOpen, DollarSign, Handshake, Filter, Award, FileText, LifeBuoy, AlertCircle, Clock, CheckCircle2, GitFork, Navigation, TrendingUp, Receipt, Wallet, Megaphone, MessageSquareWarning, CalendarClock, ClipboardCheck, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { SalesLeadsSubNav } from '../departments/wabastore/superadmin/SalesLeadsSubNav';
import { closeMenu, useMenu } from './menuState';
import { DocumentationLink, SidebarToggle, groupNavItems } from './shell';
import { CHAT_NAV, useChatNavBadge } from '../chat/ChatRoute';

export type ActiveTab =
  | 'dashboard'
  | 'hr_ops'
  | 'hrStaff'
  | 'accounts'
  | 'confirmations'
  | 'part_payments'
  | 'income'
  | 'expense'
  | 'invoice'
  | 'training'
  | 'product_training'
  | 'settings'
  | 'leads'
  | 'design_assets'
  | 'revisions'
  | 'chatbot_flows'
  | 'broadcasts'
  | 'product_catalog'
  | 'orders'
  | 'live_inbox'
  | 'contacts'
  | 'call_logs'
  | 'agents'
  | 'aiqr'
  | 'analytics'
  | 'key_accounts'
  | 'sla_reports'
  | 'lead_src_1'
  | 'lead_src_2'
  | 'lead_src_3'
  | 'lead_src_4'
  | 'lead_src_5'
  | 'lead_src_6'
  | 'lead_src_7'
  | 'lead_src_8'
  | 'lead_src_9'
  | 'lead_src_10'
  | 'department_members'
  | 'team_members'
  | 'sales_customers'
  | 'sales_deals'
  | 'sales_follow_ups'
  | 'field_visits'
  | 'sales_revenue'
  | 'sales_conversion'
  | 'sales_team_performance'
  | 'sales_potential'
  | 'sales_onboarding'
  | 'sales_part_payments'
  | 'sales_reports'
  | 'support_tickets'
  | 'support_customers'
  | 'support_issues'
  | 'support_follow_ups'
  | 'support_resolution'
  | 'support_team_performance'
  | 'support_reports'
  | 'support_flow'
  | 'staff_access'
  | 'staff_add'
  | 'hr_requests'
  | 'client_notices'
  | 'hr_probation'
  | 'hr_recruitment'
  | 'hr_training'
  | 'hr_issues'
  | 'hr_meetings'
  | 'hr_reviews'
  | 'hr_field_tracking'
  | 'business_reports'
  | 'chat'
  | 'notifications';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onNavigateHome?: () => void;
  subDept?: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  departmentId?: string;
}

const NOTIFICATION_TAB = { id: 'notifications' as ActiveTab, label: 'Notification Center', icon: Bell };

// Super Admin view of Wabastore Sales: exactly these pages, in this order (Notification Center stays last).
const WABASTORE_SALES_SUPERADMIN_NAV = [
  { id: 'team_members' as ActiveTab, label: 'Team Members', icon: Users },
  { id: 'staff_access' as ActiveTab, label: 'Access Control', icon: ShieldCheck },
  { id: 'sales_team_performance' as ActiveTab, label: 'Team Performance', icon: Award },
  { id: 'leads' as ActiveTab, label: 'Leads', icon: Database },
  NOTIFICATION_TAB // MUST BE LAST!
];

// Super Admin view of Wabastore Support: the same structure as Wabastore Sales, with the Support workflow
// (customers and tickets) in place of leads. Notification Center stays last.
const WABASTORE_SUPPORT_SUPERADMIN_NAV = [
  { id: 'team_members' as ActiveTab, label: 'Team Members', icon: Users },
  { id: 'staff_access' as ActiveTab, label: 'Access Control', icon: ShieldCheck },
  { id: 'support_team_performance' as ActiveTab, label: 'Team Performance', icon: Award },
  { id: 'support_customers' as ActiveTab, label: 'Customers', icon: UserCheck },
  { id: 'support_tickets' as ActiveTab, label: 'Tickets', icon: LifeBuoy },
  NOTIFICATION_TAB // MUST BE LAST!
];

// Wabastore Support Sources (1 to 6 only, removing 7. Website to Accounts & Invoices)
const WABASTORE_SUPPORT_SOURCES = [
  { id: 'dashboard' as ActiveTab, label: 'Support Dashboard', icon: LayoutDashboard },
  { id: 'lead_src_1' as ActiveTab, label: '1. WhatsApp API', icon: MessageSquare },
  { id: 'lead_src_2' as ActiveTab, label: '2. Meta Ads', icon: Target },
  { id: 'lead_src_3' as ActiveTab, label: '3. Telecaller', icon: PhoneCall },
  { id: 'lead_src_4' as ActiveTab, label: '4. Business Developer', icon: UserPlus },
  { id: 'lead_src_5' as ActiveTab, label: '5. AI Calling', icon: RobotIcon },
  { id: 'lead_src_6' as ActiveTab, label: '6. RCS Messages', icon: Send },
  NOTIFICATION_TAB // MUST BE LAST!
];

// 10 Support Lead Sources WITH NOTIFICATION CENTER AS THE VERY LAST ITEM!
const SUPPORT_10_SOURCES = [
  { id: 'dashboard' as ActiveTab, label: 'Support Dashboard', icon: LayoutDashboard },
  { id: 'lead_src_1' as ActiveTab, label: '1. WhatsApp API', icon: MessageSquare },
  { id: 'lead_src_2' as ActiveTab, label: '2. Meta Ads', icon: Target },
  { id: 'lead_src_3' as ActiveTab, label: '3. Telecaller', icon: PhoneCall },
  { id: 'lead_src_4' as ActiveTab, label: '4. Business Developer', icon: UserPlus },
  { id: 'lead_src_5' as ActiveTab, label: '5. AI Calling', icon: RobotIcon },
  { id: 'lead_src_6' as ActiveTab, label: '6. RCS Messages', icon: Send },
  { id: 'lead_src_7' as ActiveTab, label: '7. Website', icon: Globe },
  { id: 'lead_src_8' as ActiveTab, label: '8. References', icon: Share2 },
  { id: 'lead_src_9' as ActiveTab, label: '9. Cold Calling', icon: Phone },
  { id: 'lead_src_10' as ActiveTab, label: '10. Third Party Sources', icon: Building2 },
  NOTIFICATION_TAB // MUST BE LAST!
];

const SUPPORT_10_SOURCES_WITH_ACCOUNTS = [
  ...SUPPORT_10_SOURCES.slice(0, -1),
  { id: 'accounts' as ActiveTab, label: 'Accounts & Invoices', icon: DollarSign },
  NOTIFICATION_TAB
];

// Department Navigation Map - NOTIFICATION CENTER AT THE VERY LAST POSITION FOR ALL!
const DEPARTMENT_NAV_MAP: Record<string, { id: ActiveTab; label: string; icon: any }[]> = {
  // Amuwa Corporation (Accounts excluded per requirement)
  amuwa: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'hr_ops', label: 'HR & Operations', icon: Users },
    { id: 'hrStaff' as ActiveTab, label: 'HR Staff', icon: ShieldCheck },
    { id: 'field_visits' as ActiveTab, label: 'Field Visit GPS Tracking', icon: Navigation },
    { id: 'settings', label: 'Settings', icon: Settings },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  // HR Department (Accounts excluded per requirement)
  hr: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'hr_ops', label: 'HR & Operations', icon: Users },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  // Master Accounts Department (Side panel with Income, Expense, Invoice)
  accounts: [
    { id: 'dashboard', label: 'Accounts Overview', icon: LayoutDashboard },
    // Customers Sales sent to Accounts: business details, then Confirm.
    { id: 'confirmations' as ActiveTab, label: 'Confirmations', icon: CheckCircle2 },
    // Customers who paid part of the amount: balance follow-ups.
    { id: 'part_payments' as ActiveTab, label: 'Part Payments', icon: Wallet },
    { id: 'income', label: 'Department Income', icon: TrendingUp },
    // Sales and Support business, salesperson-wise and Support member-wise
    { id: 'business_reports' as ActiveTab, label: 'Business Reports', icon: BarChart3 },
    { id: 'expense', label: 'Expenses', icon: Receipt },
    { id: 'invoice', label: 'Invoices & Quotations', icon: FileText },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  // Education & Training (Accounts excluded per requirement)
  edutraining_education_training: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'training', label: 'Candidate Training', icon: GraduationCap },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  edutraining_product_training: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'product_training', label: 'Client Product Training', icon: BookOpen },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  // Wabastar (Accounts included)
  wabastar: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'leads', label: 'Leads Ingestion', icon: Database },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  wabastar_sales: [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'leads', label: 'Leads Ingestion', icon: Database },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  wabastar_support: SUPPORT_10_SOURCES_WITH_ACCOUNTS,

  // Whatsbox (Accounts included)
  whatsbox_sales: [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'live_inbox', label: 'Sales WhatsApp Inbox', icon: MessageCircle },
    { id: 'contacts', label: 'Prospect Contact Lists', icon: UserCheck },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  whatsbox_support: SUPPORT_10_SOURCES_WITH_ACCOUNTS,
  
  // Wabastore Sales Sub-department (Accounts included)
  wabastore_sales: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'leads', label: 'Leads', icon: Database },
    { id: 'sales_customers' as ActiveTab, label: 'Customers', icon: Users },
    { id: 'sales_deals' as ActiveTab, label: 'Deals', icon: Briefcase },
    { id: 'sales_follow_ups' as ActiveTab, label: 'Follow-ups', icon: PhoneCall },
    { id: 'field_visits' as ActiveTab, label: 'Field Visit GPS Tracking', icon: Navigation },
    { id: 'sales_revenue' as ActiveTab, label: 'Revenue', icon: DollarSign },
    { id: 'sales_conversion' as ActiveTab, label: 'Conversion', icon: Filter },
    { id: 'department_members' as ActiveTab, label: 'Department Members', icon: Building2 },
    { id: 'team_members' as ActiveTab, label: 'Team Members', icon: UserCheck },
    { id: 'sales_team_performance' as ActiveTab, label: 'Team Performance', icon: Award },
    { id: 'sales_reports' as ActiveTab, label: 'Reports', icon: FileText },
    { id: 'accounts' as ActiveTab, label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  wabastore_support: WABASTORE_SUPPORT_SOURCES,

  // D Talk (Accounts included)
  dtalk_sales: [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'call_logs', label: 'Sales Call Logs', icon: PhoneCall },
    { id: 'agents', label: 'Telephony Agents', icon: PhoneForwarded },
    { id: 'leads', label: 'Leads Ingestion', icon: Database },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  dtalk_support: SUPPORT_10_SOURCES_WITH_ACCOUNTS,

  // Digitree (Accounts included)
  digitree_sales: [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'aiqr', label: 'AIQR Generator', icon: QrCode },
    { id: 'analytics', label: 'Campaign Analytics', icon: BarChart3 },
    { id: 'leads', label: 'Leads Ingestion', icon: Database },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  digitree_support: SUPPORT_10_SOURCES_WITH_ACCOUNTS,

  // M Pillar (Accounts included)
  mpillar_sales: [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'key_accounts', label: 'Key Accounts', icon: Briefcase },
    { id: 'leads', label: 'Leads Ingestion', icon: Database },
    { id: 'accounts', label: 'Accounts & Invoices', icon: DollarSign },
    NOTIFICATION_TAB // MUST BE LAST!
  ],
  mpillar_support: SUPPORT_10_SOURCES_WITH_ACCOUNTS
};

// Generic navigation used by any department that doesn't have a bespoke,
// hand-curated nav config below (i.e. every dynamically created department).
// This must NEVER be a copy of another department's nav (e.g. amuwa) -
// only routes that the generic DepartmentDashboard/LeadsTable/Notifications
// panels actually support for an arbitrary department.
const GENERIC_DEPARTMENT_NAV: { id: ActiveTab; label: string; icon: any }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads Ingestion', icon: Database },
  NOTIFICATION_TAB // MUST BE LAST!
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onNavigateHome,
  subDept,
  departmentId
}) => {
  const { activeDepartment, activeDepartmentId, user } = useAuth();
  const { open, collapsed } = useMenu();
  const { getUnreadCountForUser } = useNotifications();
  
  // Sidebar only ever renders once a department is active, but guard
  // defensively without ever substituting another department's identity.
  const effectiveDeptId = departmentId || activeDepartmentId;
  let key: string = effectiveDeptId || '__no_department__';
  if (subDept) {
    key = `${key}_${subDept}`;
  }

  const unreadCount = getUnreadCountForUser(key, subDept || null);
  const chatUnread = useChatNavBadge();
  // Only departments with a hand-built entry in DEPARTMENT_NAV_MAP get that
  // bespoke nav. Every other department - including all newly created ones -
  // gets the generic nav. It must never fall back to another department's
  // (e.g. amuwa's) nav items, since those route to that department's own
  // dedicated panels.
  const baseNavItems = DEPARTMENT_NAV_MAP[key] || GENERIC_DEPARTMENT_NAV;
  // Managers get "Team Members & Access" directly under the dashboard entry.
  // HR logins can be team members, who add nobody: Add Member / Access Control need a head or a lead.
  const profileRole = user?.profile?.role;
  const canManageStaff = user?.role === 'superadmin' || user?.role === 'admin' || user?.role === 'team-lead'
    || (user?.role === 'hr' && (profileRole === 'DEPARTMENT_HEAD' || profileRole === 'TEAM_HEAD'));
  // Anchored entries stay together under the dashboard (e.g. Accounts: Confirmations, Part Payments).
  const anchored = baseNavItems[1]?.id === 'confirmations' ? (baseNavItems[2]?.id === 'part_payments' ? 3 : 2) : 1;
  const isSalesSuperAdmin = user?.role === 'superadmin' && key === 'wabastore_sales';
  const isSupportSuperAdmin = user?.role === 'superadmin' && key === 'wabastore_support';
  // HR: adding a member and managing access are two separate pages; Client notices sit below HR & Operations.
  // (Only a Department Head, or the Super Admin, can publish a client notice: the database refuses anyone else.)
  const canSendClientNotices = user?.role === 'superadmin' || (user?.role === 'hr' && profileRole === 'DEPARTMENT_HEAD');
  const hrNav: typeof baseNavItems = [
    baseNavItems[0],
    { id: 'hr_requests' as ActiveTab, label: 'Employee Requests', icon: UserPlus },
    ...(user?.role === 'superadmin' ? [{ id: 'staff_add' as ActiveTab, label: 'Add Member', icon: UserPlus }] : []),
    { id: 'staff_access' as ActiveTab, label: 'Access Control', icon: ShieldCheck },
    ...baseNavItems.slice(1, -1),
    { id: 'hr_recruitment' as ActiveTab, label: 'Recruitment Management', icon: Briefcase },
    { id: 'hr_training' as ActiveTab, label: 'Training', icon: GraduationCap },
    // the HR e-mails (birthday, anniversary, confirmation reminders) run on the server by themselves; only the approval is a person's job
    { id: 'hr_probation' as ActiveTab, label: 'Probation Confirmations', icon: ClipboardCheck },
    { id: 'hr_issues' as ActiveTab, label: 'Employee Issues', icon: MessageSquareWarning },
    { id: 'hr_meetings' as ActiveTab, label: 'Meeting Requests', icon: CalendarClock },
    // work-related field visit location records (the database decides: HR staff, not recruiters)
    { id: 'hr_field_tracking' as ActiveTab, label: 'Field Visit Tracking', icon: MapPin },
    // weekly department reports approved by the Operations Head: individual reviews and the consolidated report (the Super Admin has her own page)
    ...(user?.role !== 'superadmin' ? [{ id: 'hr_reviews' as ActiveTab, label: 'Performance Reviews', icon: ClipboardCheck }] : []),
    ...(canSendClientNotices ? [{ id: 'client_notices' as ActiveTab, label: 'Client Notices', icon: Megaphone }] : []),
    baseNavItems[baseNavItems.length - 1]
  ];
  const departmentNav = isSalesSuperAdmin
    ? WABASTORE_SALES_SUPERADMIN_NAV
    : isSupportSuperAdmin
    ? WABASTORE_SUPPORT_SUPERADMIN_NAV
    : key === 'hr'
    ? (canManageStaff ? hrNav : [...hrNav.filter(i => i.id !== 'staff_add' && i.id !== 'staff_access')])
    : canManageStaff
    ? [
        ...baseNavItems.slice(0, anchored),
        { id: 'staff_access' as ActiveTab, label: 'Team Members & Access', icon: UserCheck },
        ...baseNavItems.slice(anchored)
      ]
    : baseNavItems;
  // Chat sits just above the Notification Center in every department's menu
  const chatTab = { id: CHAT_NAV.id as ActiveTab, label: CHAT_NAV.label, icon: CHAT_NAV.icon };
  const lastTab = departmentNav[departmentNav.length - 1];
  const navItems: typeof departmentNav = lastTab?.id === 'notifications' ? [...departmentNav.slice(0, -1), chatTab, lastTab] : [...departmentNav, chatTab];
  // The menu reads in sections, like the Department Head's: the dashboard on top, then Work, then Team (staff, chat, notifications).
  const TEAM_IDS = ['team_members', 'staff_add', 'staff_access', 'client_notices', 'chat', 'notifications'];
  // the HR department (HR Assistant, HR Admin Head) reads like the HR Recruiter's menu: Chat and Notifications in their own Communication section
  const COMMUNICATION_IDS = key === 'hr' ? ['chat', 'notifications'] : [];
  const navSections = groupNavItems(navItems, [
    { ids: navItems.slice(0, 1).map(i => i.id) },
    { label: 'Work', ids: navItems.slice(1).map(i => i.id).filter(id => !TEAM_IDS.includes(id)) },
    { label: 'Team', ids: TEAM_IDS.filter(id => !COMMUNICATION_IDS.includes(id) && navItems.some(i => i.id === id)) },
    ...(COMMUNICATION_IDS.length ? [{ label: 'Communication', ids: COMMUNICATION_IDS.filter(id => navItems.some(i => i.id === id)) }] : [])
  ]);
  const deptTitle = activeDepartment?.name || 'Department';

  return (
    <>
    {open && <div className="fixed inset-0 top-16 bg-slate-900/35 z-30 lg:hidden" onClick={closeMenu} aria-hidden="true" />}
    <aside
      id="app-sidebar"
      // a drawer under the header on small screens (any button inside closes it, except ones that only expand a group)
      onClick={e => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.hasAttribute('aria-expanded')) closeMenu();
      }}
      className={`fixed lg:sticky top-16 left-0 z-40 w-[264px] max-w-[85vw] bg-white border-r border-slate-200 flex flex-col justify-between h-[calc(100vh-4rem)] shrink-0 transition-transform ${
        open ? 'translate-x-0 shadow-xl' : '-translate-x-full'
      } ${collapsed ? 'lg:hidden' : 'lg:translate-x-0'}`}
      aria-label="Department navigation"
    >
      
      {/* Top Nav Section */}
      <div className="p-3.5 space-y-4 overflow-y-auto max-h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between gap-2 pl-1">
          <span className="text-sm font-extrabold text-slate-900 truncate">{deptTitle}</span>
          <SidebarToggle />
        </div>

        {/* Back to the Department Hub: Super Admin only */}
        {onNavigateHome && (
          <button
            onClick={onNavigateHome}
            className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 text-sm font-semibold flex items-center justify-between transition-colors group"
          >
            <span className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4 text-blue-600 group-hover:-translate-x-0.5 transition-transform" />
              <span>Department Hub</span>
            </span>
            <span className="text-[11px] text-slate-500 font-bold">10 Units</span>
          </button>
        )}

        {/* Dedicated Navigation Items for current Department */}
        <div className="space-y-0.5">
          <div className="px-2.5 pb-1.5 text-[11px] text-slate-500 uppercase tracking-[0.08em] font-bold">
            {subDept ? `${deptTitle} (${subDept})` : deptTitle}
          </div>

          {navSections.map(section => (
          <div key={section.label || 'top'} className="space-y-0.5">
          {section.label && <div className="px-2.5 pt-4 pb-1.5 text-[11px] text-slate-500 uppercase tracking-[0.08em] font-bold">{section.label}</div>}
          {section.items.map(item => {
            const Icon = item.icon;
            const isActive = ((isSalesSuperAdmin || isSupportSuperAdmin) && activeTab === 'dashboard' ? 'team_members' : activeTab) === item.id;
            const isNotif = item.id === 'notifications';
            const hasLeadsSteps = isSalesSuperAdmin && item.id === 'leads';
            const highlighted = hasLeadsSteps ? isActive || activeTab === 'sales_potential' || activeTab === 'sales_onboarding' || activeTab === 'sales_part_payments' : isActive;

            return (
              <React.Fragment key={item.id}>
              <button
                onClick={() => onSelectTab(item.id)}
                aria-current={highlighted ? 'page' : undefined}
                className={`w-full px-2.5 py-2.5 rounded-[9px] flex items-center justify-between text-left text-sm transition-colors ${
                  highlighted ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 font-medium hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-[11px] min-w-0">
                  <Icon className={`w-[18px] h-[18px] shrink-0 ${highlighted ? '' : 'text-slate-500'}`} strokeWidth={1.9} />
                  <span className="truncate">{item.label}</span>
                </div>

                {item.id === 'chat' && chatUnread > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold">{chatUnread}</span>
                )}
                {isNotif && unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>
              {hasLeadsSteps && <SalesLeadsSubNav activeTab={activeTab} onSelectTab={onSelectTab} />}
              </React.Fragment>
            );
          })}
          </div>
          ))}
        </div>

      </div>

      <div className="p-3.5 pt-2 border-t border-slate-100">
        <DocumentationLink />
      </div>

    </aside>
    </>
  );
};

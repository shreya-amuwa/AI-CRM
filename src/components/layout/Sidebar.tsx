import React from 'react';
import {
  LayoutDashboard, Users, GraduationCap, Settings,
  ArrowLeft, Radio, Palette, MessageSquare, Database, Bot, Send,
  ShoppingBag, ShoppingCart, MessageCircle, UserCheck, PhoneCall,
  PhoneForwarded, QrCode, BarChart3, Briefcase, ShieldCheck, Headphones,
  Target, Globe, FileSpreadsheet, Zap, Code, Share2, Phone, UserPlus,
  Bot as RobotIcon, Building2, HelpCircle, Bell, Edit3, BookOpen, DollarSign,
  Handshake, Filter, Award, FileText,  LifeBuoy, AlertCircle, Clock, CheckCircle2, GitFork,
  Navigation, TrendingUp, Receipt
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';

export type ActiveTab =
  | 'dashboard'
  | 'hr_ops'
  | 'hrStaff'
  | 'accounts'
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
  | 'notifications';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onNavigateHome: () => void;
  subDept?: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  departmentId?: string;
}

const NOTIFICATION_TAB = { id: 'notifications' as ActiveTab, label: 'Notification Center', icon: Bell };

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
    { id: 'income', label: 'Department Income', icon: TrendingUp },
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
// This must NEVER be a copy of another department's nav (e.g. amuwa) —
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
  const { getUnreadCountForUser } = useNotifications();
  
  // Sidebar only ever renders once a department is active, but guard
  // defensively without ever substituting another department's identity.
  const effectiveDeptId = departmentId || activeDepartmentId;
  let key: string = effectiveDeptId || '__no_department__';
  if (subDept) {
    key = `${key}_${subDept}`;
  }

  const unreadCount = getUnreadCountForUser(key, subDept || null);
  // Only departments with a hand-built entry in DEPARTMENT_NAV_MAP get that
  // bespoke nav. Every other department — including all newly created ones —
  // gets the generic nav. It must never fall back to another department's
  // (e.g. amuwa's) nav items, since those route to that department's own
  // dedicated panels.
  const baseNavItems = DEPARTMENT_NAV_MAP[key] || GENERIC_DEPARTMENT_NAV;
  // Managers get "Team Members & Access" directly under the dashboard entry.
  const canManageStaff = user?.role === 'superadmin' || user?.role === 'admin' || user?.role === 'hr' || user?.role === 'team-lead';
  const navItems = canManageStaff
    ? [baseNavItems[0], { id: 'staff_access' as ActiveTab, label: 'Team Members & Access', icon: UserCheck }, ...baseNavItems.slice(1)]
    : baseNavItems;
  const deptTitle = activeDepartment?.name || 'Department';

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between h-[calc(100vh-4rem)] sticky top-16 shrink-0 font-mono text-xs shadow-sm">
      
      {/* Top Nav Section */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-6rem)]">
        
        {/* Back to Department Selector Button */}
        <button
          onClick={onNavigateHome}
          className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold flex items-center justify-between transition-all group"
        >
          <span className="flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5 text-blue-600 group-hover:-translate-x-1 transition-transform" />
            <span>Department Hub</span>
          </span>
          <span className="text-[10px] text-slate-500 font-bold">10 Units</span>
        </button>

        {/* Dedicated Navigation Items for current Department */}
        <div className="space-y-1">
          <div className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
            {subDept ? `${deptTitle} (${subDept})` : deptTitle}
          </div>

          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isNotif = item.id === 'notifications';

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full py-2.5 px-3 rounded-xl flex items-center justify-between text-left font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="font-sans text-xs font-semibold truncate">{item.label}</span>
                </div>

                {isNotif && unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-mono text-[10px] font-bold animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

      </div>

      {/* Bottom Status */}
      <div className="p-3.5 m-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-600 text-xs shrink-0">
        <div className="flex items-center justify-between font-semibold text-slate-800 font-sans">
          <span className="flex items-center gap-2 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>CRM Network</span>
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold">
            ONLINE
          </span>
        </div>
      </div>

    </aside>
  );
};

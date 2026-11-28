import { Bell, Briefcase, Building2, CalendarCheck, ClipboardCheck, ClipboardList, Clock3, FileSpreadsheet, FileUp, Handshake, Headphones, IndianRupee, LayoutDashboard, LineChart, ListChecks, MapPin, Megaphone, MessageCircle, PhoneCall, PlugZap, ReceiptIndianRupee, SlidersHorizontal, Tag, Target, TrendingUp, Trophy, UserPlus, Users } from 'lucide-react';
import type { ShellNavGroup, ShellNavItem } from '../layout/shell';

/**
 * The side menu of the Sales Department Head and the Sales Operations Head (one dashboard, two roles), in sections like the other dashboards:
 * Overview on top, then Leads, My Sales (the head's own leads and income), Work, Income & Reports, Crocodial (only when the person is connected
 * or oversees connected people), Customers, Team and Communication. Attendance and Meetings are added above by the shell.
 * The shared entries (Reports, Raise an Issue, Chat) are passed in so this stays a plain function that can be tested without the app.
 */
export interface SalesHeadNavOptions {
  operationsHead: boolean;
  crocodialSelf: boolean;
  crocodialTeam: boolean;
  pendingUpdates: number;
  reportsBadge?: number;
  chatUnread?: number;
  reportsNav: Pick<ShellNavItem, 'id' | 'label' | 'icon'>;
  issuesNav: Pick<ShellNavItem, 'id' | 'label' | 'icon'>;
  chatNav: Pick<ShellNavItem, 'id' | 'label' | 'icon'>;
}

export function salesHeadNavGroups(o: SalesHeadNavOptions): ShellNavGroup[] {
  return [
      {
        items: [
          ...(o.operationsHead ? [{ id: 'operations', label: 'Operations Dashboard', icon: Building2 }] : []),
          { id: 'overview', label: 'Overview', icon: LayoutDashboard }
        ]
      },
      {
        label: 'Leads',
        items: [
          { id: 'leads', label: 'Leads', icon: Target, children: [{ id: 'leads-list', label: 'Lead List' }, { id: 'leads-assign', label: 'Lead Assign' }] },
          // upload a lead sheet (.xlsx / .xls / .csv) to a Sales person of the department, with its history and failed rows (the same page as Lead Assign)
          { id: 'sheet-upload', label: 'Sheet Upload', icon: FileUp },
          { id: 'telecaller-sheets', label: 'Telecaller Sheets', icon: FileSpreadsheet },
          ...(o.operationsHead ? [{ id: 'lead-tags', label: 'Lead tags', icon: Tag }] : []),
          // Field visits: the Department Head assigns the leads found on visits; both the head and the Sales Operations Head see visits live
          {
            id: 'field-visits-group', label: 'Field Visits', icon: MapPin,
            children: [...(o.operationsHead ? [] : [{ id: 'field-visit-leads', label: 'Field Visit Leads - Pending Assignment' }]), { id: 'field-tracking', label: 'Active Field Visits' }]
          },
          ...(o.operationsHead ? [] : [{ id: 'lead-whatsapp', label: 'Lead Welcome WhatsApp', icon: MessageCircle }])
        ]
      },
      {
        label: 'My Sales',
        items: [
          // the head's own leads, worked through the same Leads -> Potential -> Customer onboarding steps as a Sales Team Member's
          { id: 'my-leads-group', label: 'My Leads', icon: Briefcase, children: [{ id: 'my-leads', label: 'Leads' }, { id: 'my-potential', label: 'Potential' }, { id: 'my-onboarding', label: 'Customer onboarding' }, { id: 'my-part-payments', label: 'Part payments' }] },
          // sales incentives: what the head earns
          { id: 'my-income', label: 'My Income', icon: IndianRupee }
        ]
      },
      {
        label: 'Work',
        items: [
          { id: 'assign-task', label: 'Assign Task', icon: ClipboardList },
          { id: 'tasks', label: 'Daily Tasks', icon: CalendarCheck },
          { id: 'work-updates', label: 'Work Updates', icon: Clock3, badge: o.pendingUpdates },
          { id: 'performance', label: 'Performance Management', icon: LineChart },
          { id: 'top-performers', label: 'Top Performers & Rankings', icon: Trophy }
        ]
      },
      {
        label: 'Income & Reports',
        items: [
          { id: 'income', label: 'Department Income', icon: TrendingUp },
          // the amounts the head passes to the people below them
          { id: 'incentive-setup', label: 'Incentive setup', icon: SlidersHorizontal },
          { id: 'reports', label: 'Sales Reports', icon: ReceiptIndianRupee },
          { ...o.reportsNav, badge: o.reportsBadge }
        ]
      },
      // Crocodial (read-only calling app): the head's own activity and leads when they are connected, and the connected people they cover;
      // a CEO always has Crocodial Integration (connect the departments they run), so the section is there before anything is connected
      ...(o.crocodialSelf || o.crocodialTeam || o.operationsHead ? [{
        label: 'Crocodial',
        items: [
          ...(o.crocodialSelf ? [{ id: 'crocodial-me', label: 'My Crocodial Activity', icon: PhoneCall }, { id: 'crocodial-leads', label: 'My Crocodial Leads', icon: ListChecks }] : []),
          // a CEO's overview covers every Sales department they are assigned (department, team and employee drill-down, refresh, sync status)
          ...(o.crocodialTeam ? [{ id: 'crocodial', label: o.operationsHead ? 'Crocodial Overview' : 'Department Crocodial Activity', icon: Users }] : []),
          ...(o.operationsHead ? [{ id: 'crocodial-setup', label: 'Crocodial Integration', icon: PlugZap }] : [])
        ]
      }] : []),
      {
        label: 'Customers',
        items: [
          { id: 'service-prices', label: 'Service Prices', icon: ReceiptIndianRupee },
          { id: 'notices', label: 'Client Notices', icon: Megaphone }
        ]
      },
      {
        label: 'Team',
        items: [
          { id: 'team', label: 'Team Members & Access', icon: UserPlus },
          // confirmation / internship reviews assigned to this head or CEO (docs/hr-dashboard-upgrade.md)
          { id: 'employee-reviews', label: 'Employee Confirmation Reviews', icon: ClipboardCheck },
          // role-wise sections (migration 20270117000300): each role's list and one person's full-page dashboard
          { id: 'telecaller-group', label: 'Telecaller', icon: Headphones, children: [{ id: 'telecallers', label: 'Telecaller List' }, { id: 'telecaller-performance', label: 'Telecaller Performance' }] },
          { id: 'business-associate-group', label: 'Business Associate', icon: Handshake, children: [{ id: 'business-associates', label: 'Business Associate List' }] }
        ]
      },
      {
        label: 'Communication',
        items: [
          { ...o.issuesNav },
          { ...o.chatNav, badge: o.chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ];
}

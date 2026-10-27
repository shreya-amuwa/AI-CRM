import React, { useEffect, useState } from 'react';
import { Bell, CalendarPlus, ClipboardList, FileSpreadsheet, FileText, FolderCheck, Gauge, Headset, LineChart, PackageCheck, Target, UserCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { DashboardShell, groupNavItems, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { navigateTo } from '../../utils/router';
import { useWorkTasks } from '../../lib/workTasks';
import { useSupportInvoices, useTickets } from '../../lib/support';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { TeamLeaderDashboard } from '../team-lead/dashboard/TeamLeaderDashboard';
import { TeamLeadTasksView } from '../tasks/TeamLeadTasksView';
import { HandoverBoard } from '../handover/HandoverBoard';
import { SupportLeadCustomers } from '../support-member/SupportLeadViews';
import { CustomerProfile } from '../support-member/CustomersPage';
import { TicketsPage } from '../support-member/TicketsPage';
import { InvoicesPage } from '../support-member/InvoicesPage';
import { InvoiceRequests } from '../support-member/InvoiceRequests';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ClientDocumentsReview } from '../client-portal/ClientDocumentsReview';
import { ClientActivityManager } from '../client-portal/ClientActivityManager';
import { LeaveCenter } from '../leave/LeaveCenter';
import { PipelineWorkspace } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import { DeliveryQueue } from '../delivery/DeliveryQueue';
import { ExistingCustomerImport } from '../support/ExistingCustomerImport';
import { PerformanceManagement } from '../performance/PerformanceManagement';

/** The team's leads: a team lead sees every lead of their team's members (the database decides), without the inbound enquiries strip. */
const SupportTeamLeads: React.FC = () => {
  const { counts } = usePipelineCounts();
  return <PipelineWorkspace section="leads" counts={counts} ownOnly onNavigate={() => undefined} />;
};

export type SupportLeadPage = 'dashboard' | 'customers' | 'import' | 'leads' | 'delivery' | 'client-documents' | 'client-calendar' | 'tasks' | 'performance' | 'tickets' | 'invoices' | 'handovers' | 'team' | 'chat' | 'notifications';

/**
 * Support Team Lead sidebar. Its own configuration: nothing here is shared with
 * the Sales Team Lead sidebar (Pod Command Center, lead distribution, pipeline…).
 */
const NAV: { id: SupportLeadPage; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'import', label: 'Import Customers', icon: FileSpreadsheet },
  // the leads the team's members pitch (referrals and other channels): the same lead pages Sales uses
  { id: 'leads', label: 'Team Leads', icon: Target },
  { id: 'delivery', label: 'Delivery Queue', icon: PackageCheck },
  { id: 'client-documents', label: 'Client documents', icon: FolderCheck },
  { id: 'client-calendar', label: 'Client calendar', icon: CalendarPlus },
  { id: 'tasks', label: 'Assigned Tasks', icon: ClipboardList },
  { id: 'performance', label: 'Performance Management', icon: LineChart },
  { id: 'tickets', label: 'Tickets', icon: Headset },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'handovers', label: 'Client Hand-overs', icon: UserCheck },
  { id: 'team', label: 'Team Members & Access', icon: UserPlus },
  { id: 'chat', label: CHAT_NAV.label, icon: CHAT_NAV.icon },
  { id: 'notifications', label: 'Notification Center', icon: Bell }
];

export const SUPPORT_LEAD_BASE = (userId: string) => `/support-lead/dashboard/${userId}`;

export function parseSupportLeadPage(path: string): SupportLeadPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  return NAV.some(n => n.id === seg) ? (seg as SupportLeadPage) : 'dashboard';
}

/** Tickets of the Support team: assign, reassign, escalate, resolve. */
const LeadTickets: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }
  return <TicketsPage mode="manager" data={tickets} people={tasks.people} teams={tasks.teams} onOpenCustomer={setCustomerId} />;
};

/** Invoices of the Support team's customers (read-only) and the team's invoice requests. */
const LeadInvoices: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }
  return (
    <div className="space-y-6">
      <InvoicesPage data={invoices} onOpenCustomer={setCustomerId} />
      <InvoiceRequests canRequest={false} onOpenCustomer={setCustomerId} />
    </div>
  );
};

/**
 * Support Team Lead dashboard: only for Team Leads of a Support team (resolved
 * from the stored default dashboard / team division, never from a name). Every
 * page reads the CRM database through functions and RLS that limit it to the
 * lead's Support scope.
 */
export const SupportLeadDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<SupportLeadPage>(() => parseSupportLeadPage(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPage(parseSupportLeadPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next: SupportLeadPage) => {
    setPage(next);
    navigateTo(next === 'dashboard' ? SUPPORT_LEAD_BASE(userId) : `${SUPPORT_LEAD_BASE(userId)}/${next}`);
    window.scrollTo({ top: 0 });
  };

  const displayName = profile?.fullName || user?.name || 'Support Team Lead';
  const teamName = profile?.team?.name;
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setPage('chat'), []));
  const groups: ShellNavGroup[] = groupNavItems(
    NAV.map(n => (n.id === 'notifications' ? { ...n, badge: unreadCount } : n.id === 'chat' ? { ...n, badge: chatUnread } : n)),
    [
      { ids: ['dashboard'] },
      { label: 'Work', ids: ['tasks', 'performance', 'tickets', 'delivery', 'invoices'] },
      { label: 'Customers', ids: ['customers', 'handovers', 'import', 'leads', 'client-documents', 'client-calendar'] },
      { label: 'Team', ids: ['team', 'chat', 'notifications'] }
    ]
  );

  return (
    <DashboardShell
      title="Amuwa Support"
      subtitle="Support Team Lead"
      ariaLabel="Support Team Lead navigation"
      groups={groups}
      active={page}
      onSelect={id => go(id as SupportLeadPage)}
      user={{ name: displayName, role: 'Support Team Lead' }}
      onSignOut={() => void logout()}
      topLeft={
        <div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>
          {profile?.department?.name || 'Support'}
          {teamName ? ` · ${teamName}` : ''}
        </div>
      }
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
      wide
      flush={page === 'chat'}
    >
      {page === 'dashboard' && <TeamLeaderDashboard />}
      {page === 'customers' && <SupportLeadCustomers />}
      {page === 'import' && <ExistingCustomerImport />}
      {page === 'leads' && <SupportTeamLeads />}
      {page === 'delivery' && <DeliveryQueue />}
      {page === 'client-documents' && <ClientDocumentsReview />}
      {page === 'client-calendar' && <ClientActivityManager />}
      {page === 'tasks' && <TeamLeadTasksView />}
      {page === 'performance' && <PerformanceManagement mode="TEAM_LEAD" />}
      {page === 'tickets' && <LeadTickets />}
      {page === 'invoices' && <LeadInvoices />}
      {page === 'handovers' && <HandoverBoard role="TEAM_HEAD" />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage />}
      {page === 'team' && <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} subDept="support" />}
    </DashboardShell>
  );
};

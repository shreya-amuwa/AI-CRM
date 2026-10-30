import React, { useEffect, useState } from 'react';
import { Bell, CalendarPlus, ClipboardList, FileSpreadsheet, FileText, FolderCheck, Headset, LayoutDashboard, ListChecks, PackageCheck, Target, UserCheck, UserPlus, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { DashboardShell, groupNavItems, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
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
import { LeaveCenter } from '../leave/LeaveCenter';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import { DeliveryQueue } from '../delivery/DeliveryQueue';
import { ClientDocumentsReview } from '../client-portal/ClientDocumentsReview';
import { ClientActivityManager } from '../client-portal/ClientActivityManager';
import { ExistingCustomerImport } from '../support/ExistingCustomerImport';

export type SupportPage = 'customers' | 'my-clients' | 'tasks' | 'add-customer' | 'import' | 'tickets' | 'invoices' | 'notifications' | 'chat' | 'raise-issue' | PipelineSection | 'delivery' | 'client-documents' | 'client-calendar';

const PIPELINE_PAGES: readonly string[] = ['leads', 'potential', 'onboarding', 'part-payments'];

/** Sidebar order is fixed: Dashboard, My Clients, Assigned Tasks, Add Customer, Import Customers, My Leads (with its stages), Delivery Queue, Tickets, Invoices. */
const NAV: { id: SupportPage; label: string; icon: React.ElementType }[] = [
  { id: 'customers', label: 'Dashboard - Existing Customers', icon: LayoutDashboard },
  // Clients handed over Technical Consultant -> Department Head -> Support Team Lead -> me.
  { id: 'my-clients', label: 'My Clients', icon: UserCheck },
  { id: 'tasks', label: 'Assigned Tasks', icon: ClipboardList },
  { id: 'add-customer', label: 'Add Customer', icon: UserPlus },
  { id: 'import', label: 'Import Customers', icon: FileSpreadsheet },
  // Support also pitches services (referrals and other channels): the same lead pipeline Sales uses, limited to their own records
  { id: 'leads', label: 'My Leads', icon: Target },
  { id: 'potential', label: 'Potential', icon: ListChecks },
  { id: 'onboarding', label: 'Customer Onboarding', icon: Users },
  { id: 'part-payments', label: 'Part Payments', icon: Wallet },
  { id: 'delivery', label: 'Delivery Queue', icon: PackageCheck },
  { id: 'client-documents', label: 'Client documents', icon: FolderCheck },
  { id: 'client-calendar', label: 'Client calendar', icon: CalendarPlus },
  { id: 'tickets', label: 'Tickets', icon: Headset },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'raise-issue', label: ISSUES_NAV.label, icon: ISSUES_NAV.icon },
  { id: 'chat', label: CHAT_NAV.label, icon: CHAT_NAV.icon },
  { id: 'notifications', label: 'Notification Center', icon: Bell }
];

export const SUPPORT_BASE = (userId: string) => `/support-member/dashboard/${userId}`;

export function parseSupportPage(path: string): SupportPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  return NAV.some(n => n.id === seg) ? (seg as SupportPage) : 'customers';
}

/** My Leads and its stages for a Support member: the Sales pipeline, with only their own records and no inbound enquiries. */
const SupportPipelinePage: React.FC<{ section: PipelineSection; onNavigate: (s: PipelineSection) => void }> = ({ section, onNavigate }) => {
  const { counts } = usePipelineCounts();
  return <PipelineWorkspace section={section} counts={counts} ownOnly onNavigate={onNavigate} />;
};

/**
 * Support Team Member dashboard: only for team members of a Support team
 * (not Sales, not Technical Consultants). Every page reads and writes the CRM
 * database; the team lead and department head see the same records.
 */
export const SupportMemberDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<SupportPage>(() => parseSupportPage(window.location.pathname));
  const [profileId, setProfileId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();

  useEffect(() => {
    const onPop = () => setPage(parseSupportPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useOpenChatRequest(React.useCallback(() => { setProfileId(null); setPage('chat'); }, []));
  useOpenIssuesRequest(React.useCallback(() => { setProfileId(null); setPage('raise-issue'); }, []));

  const go = (next: SupportPage) => {
    setProfileId(null);
    setNotice(null);
    setPage(next);
    navigateTo(next === 'customers' ? SUPPORT_BASE(userId) : `${SUPPORT_BASE(userId)}/${next}`);
  };
  const openCustomer = (id: string) => {
    setProfileId(id);
    window.scrollTo({ top: 0 });
  };

  const displayName = profile?.fullName || user?.name || 'Support Team Member';
  const teamName = profile?.team?.name;

  const groups: ShellNavGroup[] = groupNavItems(
    NAV.map(n => (n.id === 'notifications' ? { ...n, badge: unreadCount } : n.id === 'chat' ? { ...n, badge: chatUnread } : n)),
    [
      { ids: ['customers'] },
      { label: 'Work', ids: ['tasks', 'tickets', 'delivery', 'invoices'] },
      { label: 'Customers', ids: ['my-clients', 'add-customer', 'import', 'client-documents', 'client-calendar'] },
      { label: 'My Leads', ids: ['leads', 'potential', 'onboarding', 'part-payments'] },
      { label: 'Team', ids: ['raise-issue', 'chat', 'notifications'] }
    ]
  );

  return (
    <DashboardShell
      title="Amuwa Support"
      subtitle="Support Team Member"
      ariaLabel="Support navigation"
      groups={groups}
      active={profileId ? '' : page}
      onSelect={id => go(id as SupportPage)}
      user={{ name: displayName, role: 'Support Team Member' }}
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
      flush={page === 'chat' && !profileId}
    >
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
      ) : PIPELINE_PAGES.includes(page) ? (
        <SupportPipelinePage section={page as PipelineSection} onNavigate={section => go(section)} />
      ) : page === 'delivery' ? (
        <DeliveryQueue />
      ) : page === 'client-documents' ? (
        <ClientDocumentsReview />
      ) : page === 'client-calendar' ? (
        <ClientActivityManager />
      ) : page === 'my-clients' ? (
        <HandoverBoard role="TEAM_MEMBER" />
      ) : page === 'tasks' ? (
        <TasksPage tasks={tasks} onOpenCustomer={openCustomer} />
      ) : page === 'import' ? (
        <ExistingCustomerImport onDone={() => go('customers')} />
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
        <TicketsPage mode="member" data={tickets} people={tasks.people} teams={tasks.teams} onOpenCustomer={openCustomer} />
      ) : page === 'chat' ? (
        <ChatRoute />
      ) : page === 'raise-issue' ? (
        <IssuesRoute />
      ) : page === 'notifications' ? (
        <NotificationsPage />
      ) : (
        <InvoicesPage data={invoices} onOpenCustomer={openCustomer} />
      )}
    </DashboardShell>
  );
};

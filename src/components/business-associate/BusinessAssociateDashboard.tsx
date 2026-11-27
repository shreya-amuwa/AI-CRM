import React, { useEffect, useState } from 'react';
import {
  Bell, CalendarClock, CalendarDays, ClipboardList, CheckSquare, FileText, FileSignature, Home, LayoutList, MapPinned, MessageCircle, PackageCheck, Receipt,
  Settings, Target, Users
} from 'lucide-react';
import { openWallet } from '../wallet/walletEvents';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { REPORTS_NAV, ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { FIELD_VISIT_GROUP_ID, FIELD_VISIT_NAV, FIELD_VISIT_SEGMENT, FieldVisitWorkspace, fieldVisitPageFromSegment, isFieldVisitPage, type FieldVisitPage } from '../field-visit/FieldVisitWorkspace';
import { AddLeadView } from '../team-member/pipeline/LeadForms';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import { MemberSections, useMemberWorkspace, type MemberSection } from '../team-member/MemberSections';
import { HomePage } from './HomePage';
import { TasksPage } from './TasksPage';
import { QuotationPage } from './QuotationPage';
import { DemoSchedulePage } from './DemoSchedulePage';
import { ScopePage } from './ScopePage';
import { SubscriptionsPage } from './SubscriptionsPage';

export type BaPage = 'home' | 'tasks' | 'leads' | 'quotation' | 'demos' | 'scope';
/** The pages of the Business Associate pages that also take a client (and document) to open. */
type MemberPage = 'customers' | 'follow-ups' | 'work-tasks' | 'calendar' | 'invoices' | 'delivery' | 'settings' | 'notifications';
/** The pages of this dashboard: the Business Associate pages, the Leads group, the member pages (customers, follow-ups, calendar ...), subscriptions and chat. */
type Section = BaPage | Exclude<PipelineSection, 'leads'> | FieldVisitPage | MemberPage | 'subscriptions' | 'chat' | 'raise-issue' | 'work-reports' | 'income';
/** Where a button sends the Business Associate: a page, and optionally the client (and document) to open there. */
export interface BaTarget { contactId?: string; quotationId?: string; scopeId?: string; stage?: string; addLead?: boolean; newDemo?: boolean }
export type BaNavigate = (page: BaPage, target?: BaTarget) => void;

/**
 * The one dashboard of the Sales team: a Business Associate and a Sales Team Member (no other Sales role) work here. The menu reads in sections;
 * each page exists once. The pages come from the two dashboards this one replaced: the Sales Team Member's (My Customers, Tasks & Follow-ups,
 * Calendar, Invoices, Delivery Queue, Settings, Chat, Notification Center) and the Business Associate's (BA Tasks, Quotation, Demo Schedule,
 * Scope of Project), with the Leads group and Field Visit that both had.
 */
const NAV: { id: string; label: string; icon: React.ElementType; children?: { id: string; label: string }[] }[] = [
  { id: 'home', label: 'Dashboard', icon: Home },
  // the same Leads -> Potential -> Customer onboarding pipeline every Sales member works in; one record moves through the steps
  {
    id: 'leads-group',
    label: 'Leads',
    icon: Target,
    children: [
      { id: 'leads', label: 'Leads' },
      { id: 'potential', label: 'Potential' },
      { id: 'onboarding', label: 'Customer onboarding' },
      { id: 'part-payments', label: 'Part payments' }
    ]
  },
  { id: 'customers', label: 'My Customers', icon: Users },
  { id: 'follow-ups', label: 'Tasks & Follow-ups', icon: CheckSquare },
  { id: 'work-tasks', label: 'My Tasks', icon: LayoutList },
  // Field Visit: planning and recording visits to leads, inside this same dashboard
  { id: FIELD_VISIT_GROUP_ID, label: 'Field Visit', icon: MapPinned, children: FIELD_VISIT_NAV },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'tasks', label: 'BA Tasks', icon: ClipboardList },
  { id: 'quotation', label: 'Quotation', icon: FileText },
  { id: 'demos', label: 'Demo Schedule', icon: CalendarClock },
  { id: 'scope', label: 'Scope of Project', icon: FileSignature },
  { id: 'subscriptions', label: 'Subscriptions', icon: Receipt },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'delivery', label: 'Delivery Queue', icon: PackageCheck },
  { id: 'chat', label: CHAT_NAV.label, icon: CHAT_NAV.icon || MessageCircle },
  { id: 'notifications', label: 'Notification Center', icon: Bell },
  { ...REPORTS_NAV },
  { ...ISSUES_NAV },
  { id: 'settings', label: 'Settings', icon: Settings }
];
const SECTIONS_OF_NAV = [
  { label: 'Overview', ids: ['home'] },
  { label: 'Sales & Leads', ids: ['leads-group', 'customers', 'follow-ups', 'work-tasks', FIELD_VISIT_GROUP_ID, 'calendar'] },
  { label: 'Business Associate', ids: ['tasks', 'quotation', 'demos', 'scope'] },
  { label: 'Subscriptions & Services', ids: ['subscriptions', 'invoices', 'delivery'] },
  { label: 'Communication', ids: ['chat', 'notifications', REPORTS_NAV.id, ISSUES_NAV.id] },
  { label: 'Account', ids: ['settings'] }
];
const SEGMENT: Record<Section, string> = {
  ...FIELD_VISIT_SEGMENT,
  home: '', tasks: 'tasks', leads: 'leads', potential: 'potential', onboarding: 'customer-onboarding', 'part-payments': 'part-payments',
  quotation: 'quotation', demos: 'demo-schedule', scope: 'scope-of-project', 'raise-issue': 'raise-issue', 'work-reports': 'work-reports',
  customers: 'customers', 'follow-ups': 'follow-ups', 'work-tasks': 'my-tasks', calendar: 'calendar', invoices: 'invoices', delivery: 'delivery-queue',
  settings: 'settings', notifications: 'notifications', subscriptions: 'subscriptions', chat: 'chat', income: 'income'
};
/** The member page (shared with the Team Member dashboard) behind a menu entry. */
const MEMBER_SECTION: Partial<Record<Section, MemberSection>> = {
  customers: 'customers', 'follow-ups': 'tasks', 'work-tasks': 'work-tasks', calendar: 'calendar', invoices: 'invoices', delivery: 'delivery',
  settings: 'settings', notifications: 'notifications'
};

export const BA_BASE = (userId: string) => `/business-associate/dashboard/${userId}`;
export function parseBaPage(path: string): Section {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  const visit = fieldVisitPageFromSegment(seg);
  if (visit) return visit;
  return (Object.keys(SEGMENT) as Section[]).find(p => SEGMENT[p] && SEGMENT[p] === seg) ?? 'home';
}

export const BusinessAssociateDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<Section>(() => parseBaPage(window.location.pathname));
  const [target, setTarget] = useState<BaTarget & { n: number }>({ n: 0 });

  useEffect(() => {
    const onPop = () => setPage(parseBaPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { counts: pipelineCounts } = usePipelineCounts();
  const workspace = useMemberWorkspace(userId);
  const chatUnread = useChatNavBadge();

  const open = (next: Section, t?: BaTarget) => {
    setTarget(prev => ({ ...t, n: prev.n + 1 }));
    setPage(next);
    navigateTo(next === 'home' ? BA_BASE(userId) : `${BA_BASE(userId)}/${SEGMENT[next]}`);
  };
  const go: BaNavigate = (next, t) => open(next, t);
  // My Income moved into the Wallet (20270223000100): an old /income address opens the Wallet over Home
  useEffect(() => { if (page === 'income') { open('home'); openWallet(); } }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenIssuesRequest(React.useCallback(() => open('raise-issue'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenChatRequest(React.useCallback(() => open('chat'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenReportsRequest(React.useCallback(() => open('work-reports'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  const reportsBadge = useReportsBadge();

  const displayName = profile?.fullName || user?.name || 'Business Associate';
  // a Sales Team Member has no Sales role: they work here too, with the same pages and the same ownership rules
  const roleLabel = profile?.salesSubRole === 'BUSINESS_ASSOCIATE' ? 'Business Associate' : 'Sales Team Member';
  const nav = NAV.map(n => (n.id === 'chat' ? { ...n, badge: chatUnread } : n.id === REPORTS_NAV.id ? { ...n, badge: reportsBadge } : n));
  const groups = groupNavItems(nav, SECTIONS_OF_NAV);
  const key = `${page}-${target.n}`;
  const memberSection = MEMBER_SECTION[page];

  return (
    <DashboardShell
      title="Amuwa Sales"
      subtitle={roleLabel}
      ariaLabel="Sales navigation"
      groups={groups}
      active={page}
      onSelect={id => open(id as Section)}
      user={{ name: displayName, role: roleLabel }}
      onSignOut={() => void logout()}
      topLeft={
        <div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>
          {profile?.department?.name || 'Sales'}
          {profile?.team?.name ? ` · ${profile.team.name}` : ''}
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
      {page === 'chat' ? (
        <ChatRoute />
      ) : (
        <div className="mx-auto w-full max-w-[1400px]">
          {page === 'home' && (
            <HomePage
              go={go}
              workspace={workspace}
              pipelineCounts={pipelineCounts ? { onboarding: { all: pipelineCounts.onboarding.all }, partPayments: pipelineCounts.partPayments ?? 0 } : null}
              open={next => open(next)}
              userName={displayName}
              roleLabel={roleLabel}
            />
          )}
          {page === 'tasks' && <TasksPage key={key} go={go} initialContactId={target.contactId} initialStage={target.stage} />}
          {(page === 'leads' || page === 'potential' || page === 'onboarding' || page === 'part-payments') && (
            <PipelineWorkspace section={page} counts={pipelineCounts} leadFilters startWithAdd={page === 'leads' && !!target.addLead} resetKey={target.n} onNavigate={next => open(next)} />
          )}
          {memberSection && (
            <MemberSections key={key} section={memberSection} currentUserId={userId} userName={displayName} workspace={workspace} onOpenInvoices={() => open('invoices')} />
          )}
          {isFieldVisitPage(page) && (
            <FieldVisitWorkspace
              page={page}
              onNavigate={next => open(next)}
              renderAddLead={a => <AddLeadView defaultSource={a.source} onCancel={a.onCancel} onSaved={a.onSaved} />}
            />
          )}
          {page === 'quotation' && <QuotationPage key={key} go={go} initialContactId={target.contactId} initialQuotationId={target.quotationId} />}
          {page === 'demos' && <DemoSchedulePage key={key} go={go} initialContactId={target.contactId} openNew={!!target.newDemo} />}
          {page === 'scope' && <ScopePage key={key} go={go} initialContactId={target.contactId} initialScopeId={target.scopeId} />}
          {page === 'subscriptions' && <SubscriptionsPage key={key} />}
          {page === 'raise-issue' && <IssuesRoute />}
          {page === 'work-reports' && <ReportsRoute />}
        </div>
      )}
    </DashboardShell>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Building2, Briefcase, MessageCircle, CalendarCheck, ClipboardList, FileSpreadsheet, FileUp, LayoutDashboard, LineChart, MapPin, Megaphone, ReceiptIndianRupee, Target, TrendingUp, Trophy, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ClientNotices } from '../notices/ClientNotices';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { REPORTS_NAV, ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest, useReportsBadge } from '../reports/reportEvents';
import { SalesOverview } from './SalesOverview';
import { LeadWhatsAppSettingsPage } from '../leads/LeadWhatsApp';
import { LeadList } from './LeadList';
import { LeadAssign } from './LeadAssign';
import { SalesDailyTasks } from './SalesDailyTasks';
import { SalesPerformance } from './SalesPerformance';
import { TopPerformersPage } from '../top-performers/TopPerformersPage';
import { SalesIncomePage } from './SalesIncomePage';
import { SalesReports } from './SalesReports';
import { ContactSheets } from '../telecaller/ContactSheets';
import { ServicePrices } from '../business-associate/ServicePrices';
import { OperationsDashboard } from '../operations/OperationsDashboard';
import { ActiveFieldVisits } from '../field-visit/ActiveFieldVisits';
import { FieldVisitLeadQueuePage } from '../field-visit/FieldVisitLeadQueue';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';

import { PATHS, SALES_HEAD_BASE, parseSalesHeadPage, type SalesHeadNavigate, type SalesHeadPage } from './salesHeadPaths';
export { SALES_HEAD_BASE, parseSalesHeadPage };
export type { SalesHeadNavigate, SalesHeadPage };

const MY_SECTION: Record<'my-leads' | 'my-potential' | 'my-onboarding' | 'my-part-payments', PipelineSection> = {
  'my-leads': 'leads', 'my-potential': 'potential', 'my-onboarding': 'onboarding', 'my-part-payments': 'part-payments'
};
const MY_PAGE: Record<PipelineSection, SalesHeadPage> = { leads: 'my-leads', potential: 'my-potential', onboarding: 'my-onboarding', 'part-payments': 'my-part-payments' };

/**
 * The Sales Department Head dashboard: its own navigation, and every page reads the Sales teams of the department only (the database
 * enforces it). It shares the CRM's design pieces with the other dashboards; the Support Department Head keeps the shared Department Head
 * dashboard and its data.
 */
export const SalesHeadDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  // a Sales Operations Head oversees several departments: its own overview is the home page of this dashboard
  const operationsHead = !!profile?.isOperationsHead;
  const home: SalesHeadPage = operationsHead ? 'operations' : 'overview';
  const [page, setPage] = useState<SalesHeadPage>(() => parseSalesHeadPage(window.location.pathname, home));
  // a filter the page being opened should start with (the Overview cards link to the Lead List)
  const [intent, setIntent] = useState<{ filter?: string; n: number }>({ n: 0 });
  const chatUnread = useChatNavBadge();
  const reportsBadge = useReportsBadge();
  const { counts: pipelineCounts } = usePipelineCounts();

  useEffect(() => {
    const onPop = () => setPage(parseSalesHeadPage(window.location.pathname, home));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [home]);

  const go: SalesHeadNavigate = (next, options) => {
    setIntent(i => ({ ...options, n: i.n + 1 }));
    setPage(next);
    // the bare address is the home page; the Overview of an Operations Head therefore has its own address
    const seg = next === 'overview' && operationsHead ? 'overview' : PATHS[next];
    navigateTo(seg ? `${SALES_HEAD_BASE(userId)}/${seg}` : SALES_HEAD_BASE(userId));
  };
  useOpenChatRequest(React.useCallback(() => go('chat'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenIssuesRequest(React.useCallback(() => go('raise-issue'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenReportsRequest(React.useCallback(() => go('work-reports'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: ShellNavGroup[] = useMemo(
    () => [
      {
        items: [
          ...(operationsHead ? [{ id: 'operations', label: 'Operations Dashboard', icon: Building2 }] : []),
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'leads', label: 'Leads', icon: Target, children: [{ id: 'leads-list', label: 'Lead List' }, { id: 'leads-assign', label: 'Lead Assign' }] },
          // upload a lead sheet (.xlsx / .xls / .csv) to a Sales person of the department, with its history and failed rows (the same page as Lead Assign)
          { id: 'sheet-upload', label: 'Sheet Upload', icon: FileUp },
          // the head's own leads, worked through the same Leads -> Potential -> Customer onboarding steps as a Sales Team Member's
          { id: 'my-leads-group', label: 'My Leads', icon: Briefcase, children: [{ id: 'my-leads', label: 'Leads' }, { id: 'my-potential', label: 'Potential' }, { id: 'my-onboarding', label: 'Customer onboarding' }, { id: 'my-part-payments', label: 'Part payments' }] },
          // Field visits: the Department Head assigns the leads found on visits; both the head and the Sales Operations Head see visits live
          {
            id: 'field-visits-group', label: 'Field Visits', icon: MapPin,
            children: [...(operationsHead ? [] : [{ id: 'field-visit-leads', label: 'Field Visit Leads - Pending Assignment' }]), { id: 'field-tracking', label: 'Active Field Visits' }]
          },
          { id: 'tasks', label: 'Daily Tasks', icon: CalendarCheck },
          { id: 'performance', label: 'Performance Management', icon: LineChart },
          { id: 'top-performers', label: 'Top Performers & Rankings', icon: Trophy },
          { id: 'income', label: 'Department Income', icon: TrendingUp },
          { id: 'reports', label: 'Sales Reports', icon: ReceiptIndianRupee },
          { id: REPORTS_NAV.id, label: REPORTS_NAV.label, icon: REPORTS_NAV.icon, badge: reportsBadge },
          { id: 'telecaller-sheets', label: 'Telecaller Sheets', icon: FileSpreadsheet },
          { id: 'service-prices', label: 'Service Prices', icon: ReceiptIndianRupee },
          ...(operationsHead ? [] : [{ id: 'lead-whatsapp', label: 'Lead Welcome WhatsApp', icon: MessageCircle }]),
          { id: 'notices', label: 'Client Notices', icon: Megaphone },
          { id: 'team', label: 'Team Members & Access', icon: UserPlus },
          { ...ISSUES_NAV },
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ],
    [chatUnread, operationsHead, reportsBadge]
  );

  const roleName = operationsHead ? 'Sales Operations Head' : 'Sales Department Head';
  const displayName = profile?.fullName || user?.name || roleName;
  const deptName = profile?.department?.name || 'Sales';

  return (
    <DashboardShell
      title="Amuwa"
      subtitle={`${deptName} · Sales`}
      ariaLabel={`${roleName} navigation`}
      groups={groups}
      active={page}
      onSelect={id => go(id as SalesHeadPage)}
      user={{ name: displayName, role: roleName }}
      onSignOut={() => void logout()}
      flush={page === 'chat'}
      topLeft={
        <div className="hidden lg:flex items-center gap-2 text-sm text-slate-500" title={profile?.email}>
          <ClipboardList className="w-4 h-4" aria-hidden="true" /> {roleName} · {deptName}
        </div>
      }
      topActions={
        <>
          <LeaveCenter />
          <NotificationBell />
        </>
      }
      wide
    >
      {page === 'operations' && operationsHead && <OperationsDashboard />}
      {page === 'overview' && <SalesOverview go={go} />}
      {page === 'leads-list' && <LeadList key={intent.n} initialFilter={intent.filter} go={go} />}
      {page === 'leads-assign' && <LeadAssign />}
      {page === 'sheet-upload' && <LeadAssign title="Sheet Upload" />}
      {(page === 'my-leads' || page === 'my-potential' || page === 'my-onboarding' || page === 'my-part-payments') && (
        <PipelineWorkspace section={MY_SECTION[page]} counts={pipelineCounts} ownOnly resetKey={intent.n} onNavigate={s => go(MY_PAGE[s])} />
      )}
      {page === 'tasks' && <SalesDailyTasks key={intent.n} initialFilter={intent.filter} />}
      {page === 'field-visit-leads' && !operationsHead && <FieldVisitLeadQueuePage />}
      {page === 'field-tracking' && <ActiveFieldVisits audience="manager" />}
      {page === 'performance' && <SalesPerformance />}
      {page === 'top-performers' && <TopPerformersPage mode={operationsHead ? 'COMPANY' : 'DEPARTMENT_HEAD'} />}
      {page === 'income' && <SalesIncomePage />}
      {page === 'reports' && <SalesReports />}
      {page === 'work-reports' && <ReportsRoute />}
      {page === 'telecaller-sheets' && <ContactSheets />}
      {page === 'service-prices' && <ServicePrices />}
      {page === 'lead-whatsapp' && <LeadWhatsAppSettingsPage />}
      {page === 'notices' && <ClientNotices />}
      {page === 'team' && <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} subDept="sales" />}
      {page === 'chat' && <ChatRoute />}
      {page === 'raise-issue' && <IssuesRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, type ShellNavGroup } from '../layout/shell';
import { salesHeadNavGroups } from './salesHeadNav';
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
import { WorkUpdatesPanel, useWorkUpdateCounts } from '../tasks/WorkUpdates';
import { useOpenWorkUpdateRequest } from '../tasks/workUpdateEvents';
import { ActiveFieldVisits } from '../field-visit/ActiveFieldVisits';
import { FieldVisitLeadQueuePage } from '../field-visit/FieldVisitLeadQueue';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';

import { IncomePage } from '../income/IncomePage';
import { IncentiveSetup } from '../income/IncentiveSetup';
import { PATHS, SALES_HEAD_BASE, parseSalesHeadPage, parseSalesHeadPerson, type SalesHeadNavigate, type SalesHeadPage } from './salesHeadPaths';
import { SalesRoleListPage, SalesRolePersonPage } from './roles/SalesRoleSection';
import { CrocodialTeamPanel, useCrocodialNav } from '../crocodial/CrocodialTeamPanel';
import { CrocodialActivityPanel } from '../crocodial/CrocodialActivity';
import { CrocodialLeadsPanel } from '../crocodial/CrocodialLeads';
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
  // the person whose full-page dashboard is open in a role-wise section (".../telecallers/<id>"), from the address so it can be bookmarked
  const [personId, setPersonId] = useState<string | null>(() => parseSalesHeadPerson(window.location.pathname));
  // a filter the page being opened should start with (the Overview cards link to the Lead List)
  const [intent, setIntent] = useState<{ filter?: string; n: number }>({ n: 0 });
  const chatUnread = useChatNavBadge();
  const reportsBadge = useReportsBadge();
  const crocodial = useCrocodialNav();
  const { counts: pipelineCounts } = usePipelineCounts();

  useEffect(() => {
    const onPop = () => { setPage(parseSalesHeadPage(window.location.pathname, home)); setPersonId(parseSalesHeadPerson(window.location.pathname)); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [home]);

  const go: SalesHeadNavigate = (next, options) => {
    setIntent(i => ({ ...options, n: i.n + 1 }));
    setPage(next);
    setPersonId(null);
    // the bare address is the home page; the Overview of an Operations Head therefore has its own address
    const seg = next === 'overview' && operationsHead ? 'overview' : PATHS[next];
    navigateTo(seg ? `${SALES_HEAD_BASE(userId)}/${seg}` : SALES_HEAD_BASE(userId));
  };
  const openPerson = (list: 'telecallers' | 'business-associates', id: string) => {
    setPage(list);
    setPersonId(id);
    navigateTo(`${SALES_HEAD_BASE(userId)}/${PATHS[list]}/${id}`);
  };
  useOpenChatRequest(React.useCallback(() => go('chat'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenIssuesRequest(React.useCallback(() => go('raise-issue'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenReportsRequest(React.useCallback(() => go('work-reports'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOpenWorkUpdateRequest(React.useCallback(() => go('work-updates'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  const updateCounts = useWorkUpdateCounts();

  // the menu reads in sections, like the Department Head's (see salesHeadNav.ts)
  const groups: ShellNavGroup[] = useMemo(
    () => salesHeadNavGroups({
      operationsHead, crocodialSelf: crocodial.self, crocodialTeam: crocodial.team, pendingUpdates: updateCounts?.pending || 0,
      reportsBadge, chatUnread, reportsNav: REPORTS_NAV, issuesNav: ISSUES_NAV, chatNav: CHAT_NAV
    }),
    [chatUnread, operationsHead, reportsBadge, crocodial.self, crocodial.team, updateCounts?.pending]
  );

  const roleName = operationsHead ? 'Sales CEO' : 'Sales Department Head';
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
      {page === 'work-updates' && <WorkUpdatesPanel />}
      {page === 'field-visit-leads' && !operationsHead && <FieldVisitLeadQueuePage />}
      {page === 'field-tracking' && <ActiveFieldVisits audience="manager" />}
      {page === 'performance' && <SalesPerformance />}
      {page === 'telecallers' && (personId
        ? <SalesRolePersonPage key={personId} role="TELECALLER" id={personId} onBack={() => go('telecallers')} />
        : <SalesRoleListPage role="TELECALLER" onOpen={id => openPerson('telecallers', id)} />)}
      {page === 'business-associates' && (personId
        ? <SalesRolePersonPage key={personId} role="BUSINESS_ASSOCIATE" id={personId} onBack={() => go('business-associates')} />
        : <SalesRoleListPage role="BUSINESS_ASSOCIATE" onOpen={id => openPerson('business-associates', id)} />)}
      {page === 'top-performers' && <TopPerformersPage mode={operationsHead ? 'COMPANY' : 'DEPARTMENT_HEAD'} />}
      {page === 'income' && <SalesIncomePage />}
      {page === 'my-income' && <IncomePage />}
      {page === 'incentive-setup' && <IncentiveSetup />}
      {page === 'reports' && <SalesReports />}
      {page === 'work-reports' && <ReportsRoute />}
      {page === 'telecaller-sheets' && <ContactSheets />}
      {page === 'service-prices' && <ServicePrices />}
      {page === 'lead-whatsapp' && <LeadWhatsAppSettingsPage />}
      {page === 'crocodial' && <CrocodialTeamPanel title="Team Crocodial Activity" />}
      {page === 'crocodial-me' && <CrocodialActivityPanel title="My Crocodial Activity" showDemos={false} />}
      {page === 'crocodial-leads' && <CrocodialLeadsPanel title="My Crocodial Leads" hideWhenOff={false} />}
      {page === 'notices' && <ClientNotices />}
      {page === 'team' && <TeamMemberManagement departmentSlug={profile?.department?.slug || ''} subDept="sales" />}
      {page === 'chat' && <ChatRoute />}
      {page === 'raise-issue' && <IssuesRoute />}
      {page === 'notifications' && <NotificationsPage />}
    </DashboardShell>
  );
};

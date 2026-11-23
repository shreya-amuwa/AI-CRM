import React, { Suspense, lazy, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DepartmentProvider, useDepartments } from './context/DepartmentContext';
import { LeadStoreProvider } from './context/LeadStoreContext';
import { NotificationProvider } from './context/NotificationContext';
import { SecureChatProvider } from './lib/chat/useSecureChat';
import { TabProvider, useTabs } from './context/TabContext';
import { LoginForm } from './components/auth/LoginForm';
import { SessionEvictionModal } from './components/auth/SessionEvictionModal';
import { Header } from './components/layout/Header';
import { ClientNotices } from './components/notices/ClientNotices';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { ChatRoute } from './components/chat/ChatRoute';
import { useOpenChatRequest } from './components/chat/chatEvents';
import { useOpenHrCaseRequest, type OpenHrCaseDetail } from './components/issues/issueEvents';
import { useOpenMeetingRequest } from './components/meetings/meetingEvents';
import { TabBar } from './components/layout/TabBar';

// Dedicated Department Panels

import { Sparkles } from 'lucide-react';

// Team Member Dedicated Components & Routing
import { TeamMemberLayout } from './components/team-member/TeamMemberLayout';
import { parseCurrentRoute, navigateTo, validateRouteAccess, getRedirectForRole, lastPathUnder, rememberPath } from './utils/router';
import { clearPanelPage, readPanelPage, writePanelPage } from './lib/rememberedPage';
import { isRestorableTab } from './components/layout/restorableTabs';

// Dashboards and department panels are loaded on demand, so signing in only
// downloads the code for the screen the user actually opens.
// Role- and page-specific screens are loaded when they are opened, not for everyone at sign-in (each pulls in large feature code that a
// Team Member, a Sales user or an Accounts user never uses: staff management, top performers, HR pages, reports).
const SuperAdminDashboard = lazy(() => import('./components/superadmin/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const TrainingWorkspace = lazy(() => import('./components/hr/TrainingWorkspace').then(m => ({ default: m.TrainingWorkspace })));
const RecruitmentManagement = lazy(() => import('./components/hr/RecruitmentManagement').then(m => ({ default: m.RecruitmentManagement })));
const ProbationConfirmations = lazy(() => import('./components/hr/ProbationConfirmations').then(m => ({ default: m.ProbationConfirmations })));
const RechargeReminderCalls = lazy(() => import('./components/hr/RechargeReminderCalls').then(m => ({ default: m.RechargeReminderCalls })));
const PaidLeaveManagement = lazy(() => import('./components/hr/PaidLeaveManagement').then(m => ({ default: m.PaidLeaveManagement })));
const EmployeeIssuesManagement = lazy(() => import('./components/hr/EmployeeIssuesManagement').then(m => ({ default: m.EmployeeIssuesManagement })));
const HrEmployeeRequestsPage = lazy(() => import('./components/employees/HrEmployeeRequestsPage').then(m => ({ default: m.HrEmployeeRequestsPage })));
const MeetingRequestsManagement = lazy(() => import('./components/hr/MeetingRequestsManagement').then(m => ({ default: m.MeetingRequestsManagement })));
const HrLettersPage = lazy(() => import('./components/departments/hr/HrLettersPage').then(m => ({ default: m.HrLettersPage })));
const BusinessReports = lazy(() => import('./components/reports/BusinessReports').then(m => ({ default: m.BusinessReports })));
const SupportMemberDashboard = lazy(() => import('./components/support-member/SupportMemberDashboard').then(m => ({ default: m.SupportMemberDashboard })));
const StaffManagementPanel = lazy(() => import('./components/common/StaffManagementPanel').then(m => ({ default: m.StaffManagementPanel })));
const AmuwaHqPanel = lazy(() => import('./components/departments/amuwa/AmuwaHqPanel').then(m => ({ default: m.AmuwaHqPanel })));
const AmuwaSettingsPanel = lazy(() => import('./components/departments/amuwa/AmuwaSettingsPanel').then(m => ({ default: m.AmuwaSettingsPanel })));
const PerformanceReviews = lazy(() => import('./components/hr/PerformanceReviews'));
// Attendance from the department menu: the same Punch In / Out page as every other dashboard (HR also sees the register, as on its own panel)
const AttendancePage = lazy(() => import('./components/attendance/AttendancePage'));
const MeetingsPage = lazy(() => import('./components/meetings/MeetingsPage'));
const ActiveFieldVisits = lazy(() => import('./components/field-visit/ActiveFieldVisits').then(m => ({ default: m.ActiveFieldVisits })));
const HRDepartmentPanel = lazy(() => import('./components/departments/hr/HRDepartmentPanel').then(m => ({ default: m.HRDepartmentPanel })));
const WhatsboxPanel = lazy(() => import('./components/departments/whatsbox/WhatsboxPanel').then(m => ({ default: m.WhatsboxPanel })));
const SupportSuperAdminDashboard = lazy(() => import('./components/departments/wabastore/superadmin/SupportSuperAdminDashboard').then(m => ({ default: m.SupportSuperAdminDashboard })));
const SalesSuperAdminDashboard = lazy(() => import('./components/departments/wabastore/superadmin/SalesSuperAdminDashboard').then(m => ({ default: m.SalesSuperAdminDashboard })));
const WabastorePanel = lazy(() => import('./components/departments/wabastore/WabastorePanel').then(m => ({ default: m.WabastorePanel })));
const DtalkPanel = lazy(() => import('./components/departments/dtalk/DtalkPanel').then(m => ({ default: m.DtalkPanel })));
const DigitreePanel = lazy(() => import('./components/departments/digitree/DigitreePanel').then(m => ({ default: m.DigitreePanel })));
const MpillarPanel = lazy(() => import('./components/departments/mpillar/MpillarPanel').then(m => ({ default: m.MpillarPanel })));
const EduTrainingPanel = lazy(() => import('./components/departments/edutraining/EduTrainingPanel').then(m => ({ default: m.EduTrainingPanel })));
const AccountsDepartmentPanel = lazy(() => import('./components/departments/accounts/AccountsDepartmentPanel').then(m => ({ default: m.AccountsDepartmentPanel })));
const DepartmentAccountsBillingView = lazy(() => import('./components/departments/shared/DepartmentAccountsBillingView').then(m => ({ default: m.DepartmentAccountsBillingView })));
const TeamMemberDashboard = lazy(() => import('./components/team-member/TeamMemberDashboard').then(m => ({ default: m.TeamMemberDashboard })));
const RecruiterDashboard = lazy(() => import('./components/hr-recruiter/RecruiterDashboard').then(m => ({ default: m.RecruiterDashboard })));
const AiStudioDashboard = lazy(() => import('./components/ai-studio/AiStudioDashboard').then(m => ({ default: m.AiStudioDashboard })));
const AiStudioWorkspace = lazy(() => import('./components/ai-studio/AiStudioWorkspace').then(m => ({ default: m.AiStudioWorkspace })));
const TelecallerDashboard = lazy(() => import('./components/telecaller/TelecallerDashboard').then(m => ({ default: m.TelecallerDashboard })));
const BusinessAssociateDashboard = lazy(() => import('./components/business-associate/BusinessAssociateDashboard').then(m => ({ default: m.BusinessAssociateDashboard })));
import { DepartmentPicker } from './components/scope/DepartmentPicker';
const SalesHeadDashboard = lazy(() => import('./components/sales-head/SalesHeadDashboard').then(m => ({ default: m.SalesHeadDashboard })));
const SalesRolePending = lazy(() => import('./components/telecaller/SalesRolePending').then(m => ({ default: m.SalesRolePending })));
const SupportLeadDashboard = lazy(() => import('./components/support-lead/SupportLeadDashboard').then(m => ({ default: m.SupportLeadDashboard })));
const AccountsDashboard = lazy(() => import('./components/accounts/AccountsDashboard').then(m => ({ default: m.AccountsDashboard })));
const UnifiedDashboard = lazy(() => import('./components/unified/UnifiedDashboard').then(m => ({ default: m.UnifiedDashboard })));
const AiDesignStudioDashboard = lazy(() => import('./components/ai-design-studio/AiDesignStudioDashboard').then(m => ({ default: m.AiDesignStudioDashboard })));
const TeamLeadDashboard = lazy(() => import('./components/team-lead/TeamLeadDashboard').then(m => ({ default: m.TeamLeadDashboard })));
const DepartmentHeadDashboard = lazy(() => import('./components/tasks/DepartmentHeadDashboard').then(m => ({ default: m.DepartmentHeadDashboard })));
const TechnicalSupportDashboard = lazy(() => import('./components/support/TechnicalSupportDashboard').then(m => ({ default: m.TechnicalSupportDashboard })));
const LeadsTable = lazy(() => import('./components/leads/LeadsTable').then(m => ({ default: m.LeadsTable })));
const DepartmentDashboard = lazy(() => import('./components/dashboard/DepartmentDashboard').then(m => ({ default: m.DepartmentDashboard })));
const NotificationCenterPanel = lazy(() => import('./components/notifications/NotificationCenterPanel').then(m => ({ default: m.NotificationCenterPanel })));

const ScreenLoader = () => (
  <div role="status" className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>
);

const MainAppContent: React.FC = () => {
  const { user, authLoading, connectionProblem, retryConnection, activeDepartmentId, activeDepartment, resetDepartmentSelection, selectDepartment, logout, needsDepartmentChoice, scopeKey } = useAuth();
  const { departments } = useDepartments();
  const { tabs, activeTabId, updateTabState, closeAllTabs } = useTabs();
  // a notification can ask for the Chat page of whichever dashboard layout is showing
  const showChat = React.useRef<(() => void) | null>(null);
  useOpenChatRequest(React.useCallback(() => showChat.current?.(), []));
  // and HR's Employee Issues / Meeting Requests section on one case
  const showHrCase = React.useRef<((d: OpenHrCaseDetail) => void) | null>(null);
  useOpenHrCaseRequest(React.useCallback(d => showHrCase.current?.(d), []));
  // a meeting notification opens Meetings in the department panel's side menu
  const showMeetings = React.useRef<(() => void) | null>(null);
  useOpenMeetingRequest(React.useCallback(() => showMeetings.current?.(), []));

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [subDept, setSubDept] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [route, setRoute] = useState(parseCurrentRoute());
  // Department heads land on their own dashboard; only the Super Admin sees the all-departments hub.

  // Listen for browser navigation (popstate)
  React.useEffect(() => {
    const handlePopState = () => {
      setRoute(parseCurrentRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Role-based route guard and URL sync
  React.useEffect(() => {
    // Wait for the session to be restored: redirecting before that sends every
    // refresh to /login and loses the page the user was on.
    if (authLoading) return;
    if (!user) {
      // signed in but the server could not be reached: stay on this address (the sign-in is kept), do not go to /login
      if (connectionProblem) return;
      if (route.type !== 'login') {
        navigateTo('/login');
      }
      return;
    }

    // Role-based security validation
    const validation = validateRouteAccess(user, route);
    if (!validation.allowed && validation.redirectTo) {
      navigateTo(validation.redirectTo);
      setRoute(parseCurrentRoute());
      return;
    }

    if (user.role === 'meta-verifier') {
      const target = '/meta-verifier/dashboard';
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'technical-support') {
      const target = '/technical-support/dashboard';
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'team-member') {
      const target = `/team-member/dashboard/${user.id}`;
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'support-member') {
      // /support-member/dashboard/:id and its pages (…/tasks, …/tickets) stay where they are.
      const base = `/support-member/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'support-lead') {
      // /support-lead/dashboard/:id and its pages (…/tickets, …/tasks) stay where they are.
      const base = `/support-lead/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'design-studio') {
      // /ai-design-studio/dashboard/:id and its pages stay where they are.
      const base = `/ai-design-studio/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'hr-recruiter') {
      // /hr-recruiter/dashboard/:id and its pages (…/applications/:applicationId, …) stay where they are.
      const base = `/hr-recruiter/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'telecaller') {
      // /telecaller/dashboard/:id and its pages (…/tasks, …/leads) stay where they are.
      const base = `/telecaller/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'business-associate') {
      // /business-associate/dashboard/:id and its pages (…/tasks, …/quotation) stay where they are.
      const base = `/business-associate/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'unified') {
      // /unified/dashboard/:id and its pages (…/sales/leads, …/support/tickets) stay where they are.
      const base = `/unified/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'ai-studio') {
      // /ai-studio/dashboard/:id and its pages (…/projects, …/daily-report) stay where they are.
      const base = `/ai-studio/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'sales-head') {
      // /sales-head/dashboard/:id and its pages (…/leads/assign, …/tasks) stay where they are.
      const base = `/sales-head/dashboard/${user.id}`;
      if (window.location.pathname !== base && !window.location.pathname.startsWith(`${base}/`)) {
        navigateTo(lastPathUnder(base) ?? base);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'sales-role') {
      const target = `/sales-role/${user.id}`;
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'accounts-staff') {
      const target = `/accounts/dashboard/${user.id}`;
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else if (user.role === 'team-lead') {
      const target = `/team-lead/dashboard/${user.id}`;
      if (window.location.pathname !== target) {
        navigateTo(target);
        setRoute(parseCurrentRoute());
      }
    } else {
      if (route.type === 'login' || route.type === 'unknown') {
        const target = getRedirectForRole(user);
        navigateTo(target);
        setRoute(parseCurrentRoute());
      } else if (route.type === 'admin' && route.paramId && route.paramId !== activeDepartmentId) {
        selectDepartment(route.paramId as any);
      }
    }
    // departments.length: department list arrives asynchronously from the API.
  }, [authLoading, user, connectionProblem, route.path, activeDepartmentId, departments.length]);

  // Sync route for admin and superadmin when department changes
  React.useEffect(() => {
    if (user?.role === 'hr' && window.location.pathname.startsWith(`/hr-recruiter/dashboard/${user.id}`)) return; // the HR Assistant's Recruitment Portal
    if (user && user.role !== 'team-member' && user.role !== 'support-member' && user.role !== 'team-lead' && user.role !== 'support-lead' && user.role !== 'accounts-staff' && user.role !== 'technical-support' && user.role !== 'meta-verifier' && user.role !== 'telecaller' && user.role !== 'hr-recruiter' && user.role !== 'business-associate' && user.role !== 'sales-role' && user.role !== 'sales-head' && user.role !== 'ai-studio' && user.role !== 'design-studio' && user.role !== 'unified') {
      if (activeDepartmentId) {
        navigateTo(`/admin/dashboard/${activeDepartmentId}`);
      } else {
        navigateTo('/department-hub');
      }
    }
  }, [activeDepartmentId, user]);

  // The HR head has no hub to pick from: open their own department straight away.
  React.useEffect(() => {
    if (user?.role === 'hr' && user.departmentId && activeDepartmentId !== user.departmentId) selectDepartment(user.departmentId as any);
  }, [user, activeDepartmentId]);
  // An HR Assistant in the Recruitment Portal (the HR Recruiter workspace, at their own address); the HR dashboard is one click back
  const inRecruitmentPortal = !!user && user.role === 'hr' && user.profile?.hrSubRole === 'HR_ASSISTANT' && route.type === 'hr-recruiter' && route.paramId === user.id;

  // Reset tab and sub-department whenever active department changes or user session changes
  const prevDeptIdRef = React.useRef(activeDepartmentId);
  const prevUserIdRef = React.useRef(user?.id);

  // A refresh (or opening the installed app again) returns to the page the person was on in that department, not to the dashboard.
  const skipPanelSave = React.useRef(false);
  React.useEffect(() => {
    if (prevDeptIdRef.current !== activeDepartmentId || prevUserIdRef.current !== user?.id) {
      prevDeptIdRef.current = activeDepartmentId;
      prevUserIdRef.current = user?.id;
      const saved = user && activeDepartmentId ? readPanelPage(user.id, activeDepartmentId) : null;
      skipPanelSave.current = true; // this commit still holds the old page: do not store it over the remembered one
      setActiveTab(saved && isRestorableTab(saved.tab) ? saved.tab : 'dashboard');
      setSubDept((saved?.subDept as typeof subDept) ?? null);
    }
  }, [activeDepartmentId, user?.id]);
  React.useEffect(() => {
    if (skipPanelSave.current) { skipPanelSave.current = false; return; }
    if (user && activeDepartmentId) writePanelPage(user.id, activeDepartmentId, { tab: activeTab, subDept });
  }, [user?.id, activeDepartmentId, activeTab, subDept]);
  // The last dashboard address, for the installed app (it always opens at "/")
  React.useEffect(() => {
    if (user) rememberPath(user.id);
  }, [user?.id, route.path]);

  // Step 0: Restoring the Supabase session / loading the profile
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500 font-mono">
        Loading secure session…
      </div>
    );
  }

  // Signed in, but the server did not answer (busy or offline): the session is kept, so say so instead of asking to sign in again
  if (!user && connectionProblem) {
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center space-y-3">
          <h1 className="text-base font-extrabold text-slate-900">The CRM is not answering right now</h1>
          <p className="text-sm text-slate-600">You are still signed in. This is usually a busy server or a weak connection and passes in a moment.</p>
          <button type="button" onClick={() => void retryConnection()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Try again</button>
        </div>
      </div>
    );
  }

  // Step 1: Sign-In Screen if not authenticated
  if (!user) {
    return <LoginForm />;
  }

  // A Department Head authorised for several departments (the shared Sales / Support head) first chooses one of them.
  if (needsDepartmentChoice) return <DepartmentPicker />;

  // Step 1.4: Dedicated Technical Support Dashboard (Wabastore Support Sub-Department)
  if (user.role === 'technical-support') {
    return <TechnicalSupportDashboard currentUserId={user.id} userName={user.name} />;
  }
  // The Meta Verifier does the first WhatsApp verification (same working screens, without the consultant's add-ons and notes).
  if (user.role === 'meta-verifier') {
    return <TechnicalSupportDashboard mode="verifier" currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.5: Dedicated Team Member Dashboard
  // Team members are strictly isolated: no department hub, no admin header, no admin sidebar
  if (user.role === 'team-member') {
    return <TeamMemberDashboard currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.55: Dedicated Support Team Member Dashboard (Support teams only)
  if (user.role === 'support-member') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
        <SupportMemberDashboard />
      </Suspense>
    );
  }

  // Step 1.58: Dedicated Support Team Lead Dashboard (Support teams only; own route and sidebar)
  if (user.role === 'support-lead') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
        <SupportLeadDashboard />
      </Suspense>
    );
  }

  // Step 1.56: AI Design Studio (its own department): one dashboard shell for its Department Head, Team Leads and Team Members
  if (user.role === 'design-studio') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <AiDesignStudioDashboard />
      </Suspense>
    );
  }

  // Step 1.57: Sales Telecaller dashboard (own route and sidebar), or the notice page of a Sales role that has no dashboard yet
  // The HR Assistant's Recruitment Portal: the same Recruiter workspace, with a way back to the HR dashboard
  if (inRecruitmentPortal) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <RecruiterDashboard back={{ label: 'Back to HR dashboard', onClick: () => { navigateTo(`/admin/dashboard/${user.departmentId || 'hr'}`); setRoute(parseCurrentRoute()); } }} />
      </Suspense>
    );
  }
  // The HR Recruiter's own dashboard (vacancies, applications, interviews, selection); the HR Assistant keeps the HR dashboard
  if (user.role === 'hr-recruiter') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <RecruiterDashboard />
      </Suspense>
    );
  }
  if (user.role === 'telecaller') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <TelecallerDashboard />
      </Suspense>
    );
  }
  if (user.role === 'business-associate') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <BusinessAssociateDashboard />
      </Suspense>
    );
  }
  if (user.role === 'ai-studio') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <AiStudioDashboard />
      </Suspense>
    );
  }
  if (user.role === 'unified') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <UnifiedDashboard />
      </Suspense>
    );
  }
  if (user.role === 'sales-head') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <SalesHeadDashboard key={scopeKey} />
      </Suspense>
    );
  }
  if (user.role === 'sales-role') {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <SalesRolePending />
      </Suspense>
    );
  }

  // Step 1.59: Accounts department staff confirm the amount Sales sends
  if (user.role === 'accounts-staff') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
        <AccountsDashboard />
      </Suspense>
    );
  }

  // Step 1.6: Dedicated (Sales) Team Lead Dashboard
  // Team leads supervise a pod of team members, distribute leads, and review EOD reports
  if (user.role === 'team-lead') {
    return <TeamLeadDashboard currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.7: Department Head Dashboard (Assign / Reports / Daily Tasks)
  // A Department Head only ever sees their own department: the all-departments hub is for the Super Admin.
  if (user.role === 'admin') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
        <DepartmentHeadDashboard key={scopeKey} />
      </Suspense>
    );
  }

  // Determine active department and tab info
  let currentDeptId = activeDepartmentId || '';
  let currentDept = activeDepartment;
  let currentActiveTab = activeTab;
  let currentSubDept = subDept;

  // If in multi-tab mode, use tab data instead
  if (tabs.length > 0 && activeTabId) {
    const activeTabData = tabs.find((t: any) => t.id === activeTabId);
    if (activeTabData) {
      currentDeptId = activeTabData.departmentId;
      currentDept = departments.find(d => d.id === activeTabData.departmentId) || null;
      currentActiveTab = activeTabData.activeTab as ActiveTab;
      currentSubDept = activeTabData.subDept;

      setActiveTab(currentActiveTab);
      setSubDept(currentSubDept);
    }
  }

  // Step 2: Home / Department Selector Screen if no department is selected (Super Admin only)
  if ((!currentDeptId || !currentDept) && tabs.length === 0) {
    if (user.role !== 'superadmin') return <ScreenLoader />;
    // the hub's own menu (DashboardShell) shows Meetings for a clicked meeting notification
    showMeetings.current = null;
    return (
      <div className="bg-slate-50 text-slate-900 min-h-screen">
        <Suspense fallback={<ScreenLoader />}><SuperAdminDashboard /></Suspense>
        <SessionEvictionModal />
      </div>
    );
  }

  // Determine whether to show Left Sidebar
  // When inside units with sub-department choice and subDept is null, HIDE the sidebar!
  const hasSubDeptChoice = ['whatsbox', 'wabastore', 'dtalk', 'digitree', 'mpillar', 'edutraining'].includes(currentDeptId);
  const showSidebar = !hasSubDeptChoice || currentSubDept !== null;

  const handleReturnToHub = () => {
    if (tabs.length > 0) {
      // In multi-tab mode: close all tabs and return to selector
      closeAllTabs();
    } else {
      // In single mode: reset state
      if (user && activeDepartmentId) clearPanelPage(user.id, activeDepartmentId); // the next visit starts at the dashboard
      setSubDept(null);
      setActiveTab('dashboard');
      resetDepartmentSelection();
    }
    navigateTo('/department-hub');
  };

  // AI Studio is managed by the Super Admin as its Department Head: its own workspace (the Super Admin dashboard has an AI Studio entry that opens the same one)
  if (user.role === 'superadmin' && currentDeptId === 'ai-studio' && currentDept) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <AiStudioWorkspace onExit={handleReturnToHub} />
      </Suspense>
    );
  }

  const handleTabUpdate = (newActiveTab: ActiveTab, newSubDept?: any) => {
    if (newActiveTab === 'hr_recruitment_portal' && user) {
      navigateTo(`/hr-recruiter/dashboard/${user.id}`);
      setRoute(parseCurrentRoute());
      return;
    }
    if (tabs.length > 0 && activeTabId) {
      updateTabState(activeTabId, newActiveTab, newSubDept);
    } else {
      setActiveTab(newActiveTab);
      if (newSubDept !== undefined) {
        setSubDept(newSubDept);
      }
    }
  };

  showChat.current = () => handleTabUpdate('chat');
  showMeetings.current = () => { if (showSidebar) handleTabUpdate('my_meetings'); };
  showHrCase.current = d => handleTabUpdate(d.section === 'issues' ? 'hr_issues' : d.section === 'reviews' ? 'hr_reviews' : 'hr_meetings');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Persistent Header */}
      <Header
        onNavigateHome={user.role === 'superadmin' ? handleReturnToHub : undefined}
        showMenu={showSidebar}
      />

      {/* Tab Bar - shows when multiple departments are open */}
      {tabs.length > 0 && <TabBar />}

      <div className="flex flex-1">
        {/* Left Persistent Dedicated Sidebar (Hidden when on Sub-Dept Choice screen) */}
        {showSidebar && (
          <Sidebar
            activeTab={currentActiveTab}
            onSelectTab={(tab) => handleTabUpdate(tab)}
            onNavigateHome={user.role === 'superadmin' ? handleReturnToHub : undefined}
            subDept={currentSubDept}
            departmentId={currentDeptId}
          />
        )}

        {/* Main Workspace Panel */}
        <main className={currentActiveTab === 'chat' ? 'flex-1 min-w-0 w-full' : 'flex-1 min-w-0 p-3 sm:p-6 overflow-y-auto max-w-7xl mx-auto w-full'}>
          {currentActiveTab === 'my_attendance' && showSidebar ? (
            <Suspense fallback={<ScreenLoader />}><AttendancePage hrView={currentDeptId === 'hr'} /></Suspense>
          ) : currentActiveTab === 'my_meetings' && showSidebar ? (
            <Suspense fallback={<ScreenLoader />}><MeetingsPage /></Suspense>
          ) : currentDept && currentDeptId ? (
            /* Sub-department selection screen: ALWAYS show choice cards when no sub-department is selected */
            hasSubDeptChoice && currentSubDept === null ? (
              currentDeptId === 'whatsbox' ? (
                <WhatsboxPanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  whatsboxSubDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : currentDeptId === 'wabastore' ? (
                <WabastorePanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  subDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : currentDeptId === 'dtalk' ? (
                <DtalkPanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  subDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : currentDeptId === 'digitree' ? (
                <DigitreePanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  subDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : currentDeptId === 'mpillar' ? (
                <MpillarPanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  subDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : currentDeptId === 'edutraining' ? (
                <EduTrainingPanel
                  activeTab={currentActiveTab}
                  onSelectTab={(tab: any) => handleTabUpdate(tab)}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                  subDept={currentSubDept}
                  onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
                />
              ) : (
                <DepartmentDashboard
                  departmentId={currentDeptId}
                  onNavigateToLeads={() => handleTabUpdate('leads')}
                />
              )
            ) : user?.role === 'superadmin' && currentDeptId === 'wabastore' && currentSubDept === 'sales' && currentActiveTab !== 'notifications' && currentActiveTab !== 'chat' ? (
              /* Super Admin of Wabastore Sales: Team Members, Access Control, Team Performance, Leads */
              <SalesSuperAdminDashboard activeTab={currentActiveTab} onSelectTab={(tab: any) => handleTabUpdate(tab)} />
            ) : user?.role === 'superadmin' && currentDeptId === 'wabastore' && currentSubDept === 'support' && currentActiveTab !== 'notifications' && currentActiveTab !== 'chat' ? (
              /* Super Admin of Wabastore Support: Team Members, Access Control, Team Performance, Customers, Tickets */
              <SupportSuperAdminDashboard activeTab={currentActiveTab} />
            ) : currentActiveTab === 'staff_add' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><StaffManagementPanel departmentSlug={currentDeptId} subDept={currentSubDept} view="add" /></Suspense>
            ) : currentActiveTab === 'hr_requests' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><HrEmployeeRequestsPage /></Suspense>
            ) : currentActiveTab === 'hr_recruitment' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><RecruitmentManagement /></Suspense>
            ) : currentActiveTab === 'hr_training' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><TrainingWorkspace /></Suspense>
            ) : currentActiveTab === 'hr_probation' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><ProbationConfirmations /></Suspense>
            ) : currentActiveTab === 'hr_paid_leave' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><PaidLeaveManagement /></Suspense>
            ) : currentActiveTab === 'hr_issues' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><EmployeeIssuesManagement /></Suspense>
            ) : currentActiveTab === 'hr_meetings' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><MeetingRequestsManagement /></Suspense>
            ) : (currentActiveTab === 'hr_letter_nda' || currentActiveTab === 'hr_letter_offer' || currentActiveTab === 'hr_letter_experience') && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><HrLettersPage initialType={currentActiveTab === 'hr_letter_nda' ? 'NDA' : currentActiveTab === 'hr_letter_offer' ? 'OFFER' : 'EXPERIENCE'} /></Suspense>
            ) : currentActiveTab === 'hr_recharge_calls' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><RechargeReminderCalls /></Suspense>
            ) : currentActiveTab === 'hr_field_tracking' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><ActiveFieldVisits audience="hr" /></Suspense>
            ) : currentActiveTab === 'hr_reviews' && currentDeptId === 'hr' ? (
              <Suspense fallback={<ScreenLoader />}><PerformanceReviews /></Suspense>
            ) : currentActiveTab === 'client_notices' && currentDeptId === 'hr' ? (
              <ClientNotices />
            ) : currentActiveTab === 'business_reports' && currentDeptId === 'accounts' ? (
              <Suspense fallback={<ScreenLoader />}><BusinessReports /></Suspense>
            ) : currentActiveTab === 'staff_access' ? (
              <Suspense fallback={<ScreenLoader />}><StaffManagementPanel departmentSlug={currentDeptId} subDept={currentSubDept} view={currentDeptId === 'hr' ? 'manage' : 'all'} /></Suspense>
            ) : currentActiveTab === 'chat' ? (
              <ChatRoute />
            ) : currentActiveTab === 'notifications' ? (
              <NotificationCenterPanel subDept={currentSubDept} />
            ) : currentActiveTab === 'settings' && currentDeptId === 'amuwa' ? (
              <AmuwaSettingsPanel />
            ) : currentActiveTab === 'leads' && !(currentDeptId === 'wabastore' && currentSubDept === 'sales') ? (
              <LeadsTable
                departmentId={currentDeptId}
              />
            ) : currentDeptId === 'amuwa' ? (
              <AmuwaHqPanel activeTab={currentActiveTab} />
            ) : currentDeptId === 'hr' ? (
              <HRDepartmentPanel activeTab={currentActiveTab} />
            ) : currentDeptId === 'accounts' ? (
              <AccountsDepartmentPanel activeTab={currentActiveTab} />
            ) : currentActiveTab === 'accounts' && !['amuwastudio', 'designstudio', 'hr', 'edutraining', 'amuwa'].includes(currentDeptId) && !(currentDeptId === 'wabastore' && currentSubDept === 'support') ? (
              <DepartmentAccountsBillingView
                departmentId={currentDeptId}
                departmentName={currentDept?.name}
                onNavigateToMasterAccounts={() => selectDepartment('accounts')}
              />
            ) : currentDeptId === 'whatsbox' ? (
              <WhatsboxPanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                whatsboxSubDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentDeptId === 'wabastore' ? (
              <WabastorePanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                subDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentDeptId === 'dtalk' ? (
              <DtalkPanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                subDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentDeptId === 'digitree' ? (
              <DigitreePanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                subDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentDeptId === 'mpillar' ? (
              <MpillarPanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                subDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentDeptId === 'edutraining' ? (
              <EduTrainingPanel
                activeTab={currentActiveTab}
                onSelectTab={(tab: any) => handleTabUpdate(tab)}
                onNavigateToLeads={() => handleTabUpdate('leads')}
                subDept={currentSubDept}
                onSelectSubDept={(dept: any) => handleTabUpdate('dashboard', dept)}
              />
            ) : currentActiveTab === 'dashboard' ? (
              <DepartmentDashboard
                departmentId={currentDeptId}
                onNavigateToLeads={() => handleTabUpdate('leads')}
              />
            ) : (
              /* Dedicated Tab Views for Specific Business Units */
              <div className="p-8 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-4 animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 mx-auto flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-bold font-heading text-slate-900 capitalize">
                  {currentDept.name} &bull; {currentActiveTab.replace('_', ' ')}
                </h2>
                <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
                  Dedicated operational workspace for {currentDept.name} ({currentActiveTab}). Live webhook ingestion active.
                </p>
              </div>
            )
          ) : null}
        </main>
      </div>

      {/* Session Eviction Modal */}
      <SessionEvictionModal />
    </div>
  );
};

/** Secure messaging starts for the signed-in employee as soon as they are in (their key is made on its own the first time). Always the same element, so nothing below it restarts when the profile arrives. */
const EmployeeSecureChat: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  return <SecureChatProvider userId={profile?.id ?? null}>{children}</SecureChatProvider>;
};

export function App() {
  return (
    <DepartmentProvider>
      <AuthProvider>
        <TabProvider>
          <LeadStoreProvider>
            <NotificationProvider>
              <EmployeeSecureChat>
                <Suspense fallback={<ScreenLoader />}>
                  <MainAppContent />
                </Suspense>
              </EmployeeSecureChat>
            </NotificationProvider>
          </LeadStoreProvider>
        </TabProvider>
      </AuthProvider>
    </DepartmentProvider>
  );
}

export default App;

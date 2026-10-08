import React, { Suspense, lazy, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DepartmentProvider, useDepartments } from './context/DepartmentContext';
import { LeadStoreProvider } from './context/LeadStoreContext';
import { NotificationProvider } from './context/NotificationContext';
import { TabProvider, useTabs } from './context/TabContext';
import { LoginForm } from './components/auth/LoginForm';
import { SessionEvictionModal } from './components/auth/SessionEvictionModal';
import { DepartmentSelector } from './components/dashboard/DepartmentSelector';
import { Header } from './components/layout/Header';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { TabBar } from './components/layout/TabBar';

// Dedicated Department Panels

import { Sparkles } from 'lucide-react';

// Team Member Dedicated Components & Routing
import { TeamMemberLayout } from './components/team-member/TeamMemberLayout';
import { parseCurrentRoute, navigateTo, validateRouteAccess, getRedirectForRole } from './utils/router';

// Dashboards and department panels are loaded on demand, so signing in only
// downloads the code for the screen the user actually opens.
const StaffManagementPanel = lazy(() => import('./components/common/StaffManagementPanel').then(m => ({ default: m.StaffManagementPanel })));
const AmuwaHqPanel = lazy(() => import('./components/departments/amuwa/AmuwaHqPanel').then(m => ({ default: m.AmuwaHqPanel })));
const AmuwaSettingsPanel = lazy(() => import('./components/departments/amuwa/AmuwaSettingsPanel').then(m => ({ default: m.AmuwaSettingsPanel })));
const HRDepartmentPanel = lazy(() => import('./components/departments/hr/HRDepartmentPanel').then(m => ({ default: m.HRDepartmentPanel })));
const WhatsboxPanel = lazy(() => import('./components/departments/whatsbox/WhatsboxPanel').then(m => ({ default: m.WhatsboxPanel })));
const WabastorePanel = lazy(() => import('./components/departments/wabastore/WabastorePanel').then(m => ({ default: m.WabastorePanel })));
const DtalkPanel = lazy(() => import('./components/departments/dtalk/DtalkPanel').then(m => ({ default: m.DtalkPanel })));
const DigitreePanel = lazy(() => import('./components/departments/digitree/DigitreePanel').then(m => ({ default: m.DigitreePanel })));
const MpillarPanel = lazy(() => import('./components/departments/mpillar/MpillarPanel').then(m => ({ default: m.MpillarPanel })));
const EduTrainingPanel = lazy(() => import('./components/departments/edutraining/EduTrainingPanel').then(m => ({ default: m.EduTrainingPanel })));
const AccountsDepartmentPanel = lazy(() => import('./components/departments/accounts/AccountsDepartmentPanel').then(m => ({ default: m.AccountsDepartmentPanel })));
const DepartmentAccountsBillingView = lazy(() => import('./components/departments/shared/DepartmentAccountsBillingView').then(m => ({ default: m.DepartmentAccountsBillingView })));
const TeamMemberDashboard = lazy(() => import('./components/team-member/TeamMemberDashboard').then(m => ({ default: m.TeamMemberDashboard })));
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
  const { user, authLoading, activeDepartmentId, activeDepartment, resetDepartmentSelection, selectDepartment, logout } = useAuth();
  const { departments } = useDepartments();
  const { tabs, activeTabId, updateTabState, closeAllTabs } = useTabs();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [subDept, setSubDept] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [route, setRoute] = useState(parseCurrentRoute());
  // Department heads land on their task dashboard; the department hub is one click away.
  const [deptHubOpen, setDeptHubOpen] = useState(false);

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
    if (!user) {
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

    if (user.role === 'technical-support') {
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
  }, [user, route.path, activeDepartmentId, departments.length]);

  // Sync route for admin and superadmin when department changes
  React.useEffect(() => {
    if (user && user.role !== 'team-member' && user.role !== 'team-lead' && user.role !== 'technical-support') {
      if (activeDepartmentId) {
        navigateTo(`/admin/dashboard/${activeDepartmentId}`);
      } else {
        navigateTo('/department-hub');
      }
    }
  }, [activeDepartmentId, user]);

  // Reset tab and sub-department whenever active department changes or user session changes
  const prevDeptIdRef = React.useRef(activeDepartmentId);
  const prevUserIdRef = React.useRef(user?.id);

  React.useEffect(() => {
    if (prevDeptIdRef.current !== activeDepartmentId || prevUserIdRef.current !== user?.id) {
      prevDeptIdRef.current = activeDepartmentId;
      prevUserIdRef.current = user?.id;
      setActiveTab('dashboard');
      setSubDept(null);
    }
  }, [activeDepartmentId, user?.id]);

  // Step 0: Restoring the Supabase session / loading the profile
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500 font-mono">
        Loading secure session…
      </div>
    );
  }

  // Step 1: Sign-In Screen if not authenticated
  if (!user) {
    return <LoginForm />;
  }

  // Step 1.4: Dedicated Technical Support Dashboard (Wabastore Support Sub-Department)
  if (user.role === 'technical-support') {
    return <TechnicalSupportDashboard currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.5: Dedicated Team Member Dashboard
  // Team members are strictly isolated: no department hub, no admin header, no admin sidebar
  if (user.role === 'team-member') {
    return <TeamMemberDashboard currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.6: Dedicated Team Lead Dashboard
  // Team leads supervise a pod of team members, distribute leads, and review EOD reports
  if (user.role === 'team-lead') {
    return <TeamLeadDashboard currentUserId={user.id} userName={user.name} />;
  }

  // Step 1.7: Department Head Dashboard (Assign / Reports / Daily Tasks)
  if (user.role === 'admin' && !deptHubOpen) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
        <DepartmentHeadDashboard onOpenHub={() => setDeptHubOpen(true)} />
      </Suspense>
    );
  }
  const backToDeptHead =
    user.role === 'admin' ? (
      <button
        type="button"
        onClick={() => setDeptHubOpen(false)}
        className="fixed bottom-4 left-4 z-[70] px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-lg hover:bg-slate-800"
      >
        ← Department Head Dashboard
      </button>
    ) : null;

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

  // Step 2: Home / Department Selector Screen if no department is selected
  // SuperAdmin goes directly to dashboard, Admin/HR see locked departments they must unlock
  if ((!currentDeptId || !currentDept) && tabs.length === 0) {
    return (
      <div className="bg-slate-50 text-slate-900 min-h-screen">
        <DepartmentSelector />
        <SessionEvictionModal />
        {backToDeptHead}
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
      setSubDept(null);
      setActiveTab('dashboard');
      resetDepartmentSelection();
    }
    navigateTo('/department-hub');
  };

  const handleTabUpdate = (newActiveTab: ActiveTab, newSubDept?: any) => {
    if (tabs.length > 0 && activeTabId) {
      updateTabState(activeTabId, newActiveTab, newSubDept);
    } else {
      setActiveTab(newActiveTab);
      if (newSubDept !== undefined) {
        setSubDept(newSubDept);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Persistent Header */}
      <Header
        onNavigateHome={handleReturnToHub}
      />

      {/* Tab Bar - shows when multiple departments are open */}
      {tabs.length > 0 && <TabBar />}

      <div className="flex flex-1">
        {/* Left Persistent Dedicated Sidebar (Hidden when on Sub-Dept Choice screen) */}
        {showSidebar && (
          <Sidebar
            activeTab={currentActiveTab}
            onSelectTab={(tab) => handleTabUpdate(tab)}
            onNavigateHome={handleReturnToHub}
            subDept={currentSubDept}
            departmentId={currentDeptId}
          />
        )}

        {/* Main Workspace Panel */}
        <main className="flex-1 p-6 overflow-y-auto max-w-7xl mx-auto w-full">
          {currentDept && currentDeptId ? (
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
            ) : currentActiveTab === 'staff_access' ? (
              <StaffManagementPanel departmentSlug={currentDeptId} subDept={currentSubDept} />
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
      {backToDeptHead}
    </div>
  );
};

export function App() {
  return (
    <DepartmentProvider>
      <AuthProvider>
        <TabProvider>
          <LeadStoreProvider>
            <NotificationProvider>
              <Suspense fallback={<ScreenLoader />}>
                <MainAppContent />
              </Suspense>
            </NotificationProvider>
          </LeadStoreProvider>
        </TabProvider>
      </AuthProvider>
    </DepartmentProvider>
  );
}

export default App;

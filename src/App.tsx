import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DepartmentProvider, useDepartments } from './context/DepartmentContext';
import { LeadStoreProvider } from './context/LeadStoreContext';
import { NotificationProvider } from './context/NotificationContext';
import { TabProvider, useTabs } from './context/TabContext';
import { LoginForm } from './components/auth/LoginForm';
import { SessionEvictionModal } from './components/auth/SessionEvictionModal';
import { DepartmentSelector } from './components/dashboard/DepartmentSelector';
import { DepartmentDashboard } from './components/dashboard/DepartmentDashboard';
import { LeadsTable } from './components/leads/LeadsTable';
import { Header } from './components/layout/Header';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { TabBar } from './components/layout/TabBar';
import { NotificationCenterPanel } from './components/notifications/NotificationCenterPanel';

// Dedicated Department Panels
import { AmuwaHqPanel } from './components/departments/amuwa/AmuwaHqPanel';
import { AmuwaSettingsPanel } from './components/departments/amuwa/AmuwaSettingsPanel';
import { HRDepartmentPanel } from './components/departments/hr/HRDepartmentPanel';
import { WhatsboxPanel } from './components/departments/whatsbox/WhatsboxPanel';
import { WabastorePanel } from './components/departments/wabastore/WabastorePanel';
import { DtalkPanel } from './components/departments/dtalk/DtalkPanel';
import { DigitreePanel } from './components/departments/digitree/DigitreePanel';
import { MpillarPanel } from './components/departments/mpillar/MpillarPanel';
import { EduTrainingPanel } from './components/departments/edutraining/EduTrainingPanel';
import { AccountsDepartmentPanel } from './components/departments/accounts/AccountsDepartmentPanel';
import { DepartmentAccountsBillingView } from './components/departments/shared/DepartmentAccountsBillingView';

import { Sparkles } from 'lucide-react';

// Team Member Dedicated Components & Routing
import { TeamMemberLayout } from './components/team-member/TeamMemberLayout';
import { TeamMemberDashboard } from './components/team-member/TeamMemberDashboard';
import { TeamLeadDashboard } from './components/team-lead/TeamLeadDashboard';
import { TechnicalSupportDashboard } from './components/support/TechnicalSupportDashboard';
import { parseCurrentRoute, navigateTo, validateRouteAccess, getRedirectForRole } from './utils/router';

const MainAppContent: React.FC = () => {
  const { user, activeDepartmentId, activeDepartment, resetDepartmentSelection, selectDepartment, logout } = useAuth();
  const { departments } = useDepartments();
  const { tabs, activeTabId, updateTabState, closeAllTabs } = useTabs();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [subDept, setSubDept] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [route, setRoute] = useState(parseCurrentRoute());

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
  }, [user, route.path, activeDepartmentId]);

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

export function App() {
  return (
    <DepartmentProvider>
      <AuthProvider>
        <TabProvider>
          <LeadStoreProvider>
            <NotificationProvider>
              <MainAppContent />
            </NotificationProvider>
          </LeadStoreProvider>
        </TabProvider>
      </AuthProvider>
    </DepartmentProvider>
  );
}

export default App;

import React, { useMemo, useState } from 'react';
import { BarChart3, Bell, Building2, LayoutDashboard, RotateCcw, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { AddStaffModal } from '../common/AddStaffModal';
import { DepartmentGrid } from '../dashboard/DepartmentSelector';
import { DashboardShell, PageTitle, type ShellNavGroup } from '../layout/shell';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { CHAT_NAV, ChatRoute, useChatNavBadge } from '../chat/ChatRoute';
import { useOpenChatRequest } from '../chat/chatEvents';
import { BusinessReports } from '../reports/BusinessReports';
import { ghostBtn, primaryBtn } from '../tasks/head/headParts';
import { CompanyOverview } from './CompanyOverview';
import { SecurityAuditLogs } from './SecurityAuditLogs';

type Page = 'overview' | 'departments' | 'reports' | 'security' | 'chat' | 'notifications';

/**
 * The Super Admin's dashboard (the only role with a company-wide view). It replaces the old "pick a department" hub:
 *   Overview            the company in one page (figures from the database, see CompanyOverview)
 *   Departments         the department cards: open a department's own panel, lock / unlock, add one (unchanged functions)
 *   Business Reports    the existing company business report
 *   Security & Audit    who did what, and what was refused (read-only)
 * Opening a department still uses the existing department panels; their "home" button brings the Super Admin back here.
 */
export const SuperAdminDashboard: React.FC = () => {
  const { user, logout, selectDepartment } = useAuth();
  const { refreshDepartments } = useDepartments();
  const [page, setPage] = useState<Page>('overview');
  const [adding, setAdding] = useState(false);
  const chatUnread = useChatNavBadge();
  useOpenChatRequest(React.useCallback(() => setPage('chat'), []));

  const groups: ShellNavGroup[] = useMemo(
    () => [
      { items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
      {
        label: 'Company',
        items: [
          { id: 'departments', label: 'Departments', icon: Building2 },
          { id: 'reports', label: 'Business Reports', icon: BarChart3 }
        ]
      },
      { label: 'Governance', items: [{ id: 'security', label: 'Security & Audit Logs', icon: ShieldCheck }] },
      {
        label: 'Communication',
        items: [
          { ...CHAT_NAV, badge: chatUnread },
          { id: 'notifications', label: 'Notification Center', icon: Bell }
        ]
      }
    ],
    [chatUnread]
  );

  return (
    <DashboardShell
      title="Amuwa"
      subtitle="Super Admin"
      ariaLabel="Super Admin navigation"
      groups={groups}
      active={page}
      onSelect={id => setPage(id as Page)}
      user={{ name: user?.name || 'Super Admin', role: 'Super Admin' }}
      onSignOut={() => void logout()}
      showHelp
      wide={page === 'overview' || page === 'security' || page === 'reports'}
      flush={page === 'chat'}
      topActions={
        <>
          <button type="button" className={`${primaryBtn} !h-10 !px-4`} onClick={() => setAdding(true)}>
            <UserPlus className="w-4 h-4" aria-hidden="true" /> Add Team Member
          </button>
          <NotificationBell />
        </>
      }
    >
      {page === 'overview' && <CompanyOverview onOpenDepartment={slug => selectDepartment(slug as never)} />}
      {page === 'departments' && (
        <div className="space-y-6">
          <PageTitle
            title="Departments"
            subtitle="Open a department's own panel, lock or unlock access to it, or add a new department."
            actions={
              <button type="button" className={ghostBtn} onClick={() => void refreshDepartments()}>
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reload departments
              </button>
            }
          />
          <DepartmentGrid />
        </div>
      )}
      {page === 'reports' && <BusinessReports />}
      {page === 'security' && <SecurityAuditLogs />}
      {page === 'chat' && <ChatRoute />}
      {page === 'notifications' && <NotificationsPage />}
      {adding && <AddStaffModal onClose={() => setAdding(false)} />}
    </DashboardShell>
  );
};

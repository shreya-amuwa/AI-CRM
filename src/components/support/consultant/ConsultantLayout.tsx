import React from 'react';
import { Bell, PackagePlus, UserPlus, Users } from 'lucide-react';
import { useNotifications } from '../../../context/NotificationContext';
import { DashboardShell, type ShellNavGroup } from '../../layout/shell';
import { LeaveCenter } from '../../leave/LeaveCenter';

export type ConsultantPage = 'customers' | 'addons' | 'onboarding' | 'notifications';

/** Shell of the Technical Consultant dashboard (sidebar + top bar), responsive. */
export const ConsultantLayout: React.FC<{
  userName: string;
  count?: number;
  /** Customers waiting in the Customers panel. */
  newCount?: number;
  /** Customers in Add-ons Services. */
  addonsCount?: number;
  page: ConsultantPage;
  onSelectPage: (page: ConsultantPage) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}> = ({ userName, count, newCount, addonsCount, page, onSelectPage, onSignOut, children }) => {
  const { unreadCount } = useNotifications();
  const groups: ShellNavGroup[] = [
    {
      items: [
        { id: 'customers', label: 'Customers', icon: Users, count: newCount },
        { id: 'addons', label: 'Add-ons Services', icon: PackagePlus, count: addonsCount },
        { id: 'onboarding', label: 'Onboarding Customers', icon: UserPlus, count },
        { id: 'notifications', label: 'Notification Center', icon: Bell, count: unreadCount > 0 ? unreadCount : undefined }
      ]
    }
  ];
  return (
    <DashboardShell
      title="Amuwa"
      subtitle="Technical Consulting"
      ariaLabel="Technical Consultant navigation"
      groups={groups}
      active={page}
      onSelect={id => onSelectPage(id as ConsultantPage)}
      user={{ name: userName, role: 'Technical Consultant' }}
      onSignOut={onSignOut}
      topActions={<LeaveCenter />}
      showHelp
      wide
    >
      {children}
    </DashboardShell>
  );
};

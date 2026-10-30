import React from 'react';
import { Bell, CalendarClock, CalendarPlus, FolderCheck, PackagePlus, UserPlus, Users } from 'lucide-react';
import { useNotifications } from '../../../context/NotificationContext';
import { DashboardShell, type ShellNavGroup } from '../../layout/shell';
import { LeaveCenter } from '../../leave/LeaveCenter';
import { CHAT_NAV, useChatNavBadge } from '../../chat/ChatRoute';
import { ISSUES_NAV } from '../../issues/IssuesRoute';

export type ConsultantPage = 'customers' | 'addons' | 'followups' | 'onboarding' | 'client-documents' | 'client-calendar' | 'chat' | 'raise-issue' | 'notifications';

/** Shell of the Technical Consultant / Meta Verifier dashboard (sidebar + top bar), responsive. */
export const ConsultantLayout: React.FC<{
  userName: string;
  count?: number;
  /** Customers waiting in the Customers panel. */
  newCount?: number;
  /** Customers in Add-ons Services. */
  addonsCount?: number;
  /** Follow-ups due for consultation. */
  followUpsCount?: number;
  /** The Meta Verifier does the first verification only: no add-ons, no follow-ups. */
  mode?: 'consultant' | 'verifier';
  page: ConsultantPage;
  onSelectPage: (page: ConsultantPage) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}> = ({ userName, count, newCount, addonsCount, followUpsCount, mode = 'consultant', page, onSelectPage, onSignOut, children }) => {
  const verifier = mode === 'verifier';
  const { unreadCount } = useNotifications();
  const chatUnread = useChatNavBadge();
  const groups: ShellNavGroup[] = [
    {
      label: 'Customers',
      items: [
        { id: 'customers', label: 'Customers', icon: Users, count: newCount },
        ...(verifier
          ? []
          : [
              { id: 'addons', label: 'Add-ons Services', icon: PackagePlus, count: addonsCount },
              { id: 'followups', label: 'Follow-ups', icon: CalendarClock, count: followUpsCount }
            ]),
        { id: 'onboarding', label: verifier ? 'Verification Customers' : 'Onboarding Customers', icon: UserPlus, count }
      ]
    },
    {
      label: 'Client portal',
      items: [
        { id: 'client-documents', label: 'Client documents', icon: FolderCheck },
        { id: 'client-calendar', label: 'Client calendar', icon: CalendarPlus }
      ]
    },
    {
      label: 'Team',
      items: [
        { ...ISSUES_NAV },
        { ...CHAT_NAV, count: chatUnread > 0 ? chatUnread : undefined },
        { id: 'notifications', label: 'Notification Center', icon: Bell, count: unreadCount > 0 ? unreadCount : undefined }
      ]
    }
  ];
  return (
    <DashboardShell
      title="Amuwa"
      subtitle={verifier ? 'Meta Verification' : 'Technical Consulting'}
      ariaLabel={verifier ? 'Meta Verifier navigation' : 'Technical Consultant navigation'}
      groups={groups}
      active={page}
      onSelect={id => onSelectPage(id as ConsultantPage)}
      user={{ name: userName, role: verifier ? 'Meta Verifier' : 'Technical Consultant' }}
      onSignOut={onSignOut}
      topActions={<LeaveCenter />}
      wide
      flush={page === 'chat'}
    >
      {children}
    </DashboardShell>
  );
};

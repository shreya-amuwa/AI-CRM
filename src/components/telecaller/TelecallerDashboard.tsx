import React, { useEffect, useState } from 'react';
import { ClipboardList, Home, MapPinned, Target } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, PageTitle, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ISSUES_NAV, IssuesRoute } from '../issues/IssuesRoute';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { FIELD_VISIT_GROUP_ID, FIELD_VISIT_NAV, FIELD_VISIT_SEGMENT, FieldVisitWorkspace, fieldVisitPageFromSegment, isFieldVisitPage, type FieldVisitPage } from '../field-visit/FieldVisitWorkspace';
import { HomePage } from './HomePage';
import { ConvertLead } from './ConvertLead';
import { LeadDialog, LeadsPage, telecallerLeadsApi } from './LeadsPage';
import { TasksPage } from './TasksPage';

export type TelecallerPage = 'home' | 'tasks' | 'leads' | 'raise-issue' | 'notifications' | FieldVisitPage;
export interface TelecallerNavigate {
  (page: TelecallerPage, options?: { status?: string; addLead?: boolean }): void;
}

const NAV: { id: string; label: string; icon: React.ElementType; children?: { id: string; label: string }[] }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'leads', label: 'Leads', icon: Target },
  // Field Visit: planning and recording visits to leads, inside this same dashboard
  { id: FIELD_VISIT_GROUP_ID, label: 'Field Visit', icon: MapPinned, children: FIELD_VISIT_NAV },
  { ...ISSUES_NAV }
];

export const TELECALLER_BASE = (userId: string) => `/telecaller/dashboard/${userId}`;

export function parseTelecallerPage(path: string): TelecallerPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  const visit = fieldVisitPageFromSegment(seg);
  if (visit) return visit;
  return seg === 'tasks' || seg === 'leads' || seg === 'notifications' || seg === 'raise-issue' ? seg : 'home';
}

/**
 * The Telecaller workspace: Home, Tasks (the contact sheets the Department Head assigned) and Leads. Every page reads and writes the CRM
 * database through the API; the database lets a Telecaller see only their own contacts and leads.
 */
export const TelecallerDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<TelecallerPage>(() => parseTelecallerPage(window.location.pathname));
  // a filter or "open the Add Lead form" that the page being opened should start with
  const [intent, setIntent] = useState<{ status?: string; addLead?: boolean; n: number }>({ n: 0 });

  useEffect(() => {
    const onPop = () => setPage(parseTelecallerPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go: TelecallerNavigate = (next, options) => {
    setIntent(i => ({ ...options, n: i.n + 1 }));
    setPage(next);
    navigateTo(next === 'home' ? TELECALLER_BASE(userId) : `${TELECALLER_BASE(userId)}/${isFieldVisitPage(next) ? FIELD_VISIT_SEGMENT[next] : next}`);
  };

  useOpenIssuesRequest(React.useCallback(() => go('raise-issue'), [userId])); // eslint-disable-line react-hooks/exhaustive-deps
  const displayName = profile?.fullName || user?.name || 'Telecaller';
  const groups = groupNavItems(NAV, [{ ids: ['home', 'tasks', 'leads', FIELD_VISIT_GROUP_ID, ISSUES_NAV.id] }]);

  return (
    <DashboardShell
      title="Amuwa Sales"
      subtitle="Telecaller"
      ariaLabel="Telecaller navigation"
      groups={groups}
      active={page === 'notifications' ? '' : page}
      onSelect={id => go(id as TelecallerPage)}
      user={{ name: displayName, role: 'Telecaller' }}
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
    >
      <div className="mx-auto w-full max-w-[1400px]">
        {page === 'home' && <HomePage go={go} />}
        {page === 'tasks' && <TasksPage key={`tasks-${intent.n}`} initialStatus={intent.status} />}
        {page === 'leads' && <LeadsPage key={`leads-${intent.n}`} scopeFilters openAdd={!!intent.addLead} renderRowAction={(lead, reload) => <ConvertLead lead={lead} onDone={reload} />} />}
        {page === 'notifications' && <NotificationsPage />}
        {page === 'raise-issue' && <IssuesRoute />}
        {isFieldVisitPage(page) && (
          <FieldVisitWorkspace
            page={page}
            onNavigate={next => go(next)}
            renderAddLead={a => (
              <>
                <PageTitle title="Add Lead" subtitle="Add a lead you found on a field visit. It joins your leads like any other." />
                <LeadDialog api={telecallerLeadsApi} defaultSource={a.source} onClose={a.onCancel} onSaved={a.onSaved} />
              </>
            )}
          />
        )}
      </div>
    </DashboardShell>
  );
};

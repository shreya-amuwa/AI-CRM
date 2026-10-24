import React, { useEffect, useState } from 'react';
import { CalendarClock, ClipboardList, FileText, FileSignature, Home, Target } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { LeadsPage, type LeadsApi } from '../telecaller/LeadsPage';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { HomePage } from './HomePage';
import { TasksPage } from './TasksPage';
import { QuotationPage } from './QuotationPage';
import { DemoSchedulePage } from './DemoSchedulePage';
import { ScopePage } from './ScopePage';
import { notifyBaChanged } from './ui';

export type BaPage = 'home' | 'tasks' | 'leads' | 'quotation' | 'demos' | 'scope';
/** Where a button sends the Business Associate: a page, and optionally the client (and document) to open there. */
export interface BaTarget { contactId?: string; quotationId?: string; scopeId?: string; stage?: string; addLead?: boolean; newDemo?: boolean }
export type BaNavigate = (page: BaPage, target?: BaTarget) => void;

const NAV: { id: BaPage; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'leads', label: 'Leads', icon: Target },
  { id: 'quotation', label: 'Quotation', icon: FileText },
  { id: 'demos', label: 'Demo Schedule', icon: CalendarClock },
  { id: 'scope', label: 'Scope of Project', icon: FileSignature }
];
const SEGMENT: Record<BaPage, string> = { home: '', tasks: 'tasks', leads: 'leads', quotation: 'quotation', demos: 'demo-schedule', scope: 'scope-of-project' };

export const BA_BASE = (userId: string) => `/business-associate/dashboard/${userId}`;
export function parseBaPage(path: string): BaPage {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  return (Object.keys(SEGMENT) as BaPage[]).find(p => SEGMENT[p] && SEGMENT[p] === seg) ?? 'home';
}

/** This role's own Leads data: the Business Associate's leads, not the Telecaller's. */
const baLeadsApi: LeadsApi = { list: businessAssociateApi.leads, create: businessAssociateApi.createLead, update: businessAssociateApi.updateLead };

/**
 * The Business Associate workspace: Tasks (contacts handed over by Telecallers), Leads, Quotation, Demo Schedule and Scope of Project, all around the
 * same client record. Every page reads and writes through the API; the database lets a Business Associate see only their own contacts and documents.
 */
export const BusinessAssociateDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<BaPage>(() => parseBaPage(window.location.pathname));
  const [target, setTarget] = useState<BaTarget & { n: number }>({ n: 0 });

  useEffect(() => {
    const onPop = () => setPage(parseBaPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go: BaNavigate = (next, t) => {
    setTarget(prev => ({ ...t, n: prev.n + 1 }));
    setPage(next);
    navigateTo(next === 'home' ? BA_BASE(userId) : `${BA_BASE(userId)}/${SEGMENT[next]}`);
  };

  const displayName = profile?.fullName || user?.name || 'Business Associate';
  const groups = groupNavItems(NAV, [{ ids: ['home'] }, { ids: ['tasks', 'leads', 'quotation', 'demos', 'scope'] }]);
  const key = `${page}-${target.n}`;

  return (
    <DashboardShell
      title="Amuwa Sales"
      subtitle="Business Associate"
      ariaLabel="Business Associate navigation"
      groups={groups}
      active={page}
      onSelect={id => go(id as BaPage)}
      user={{ name: displayName, role: 'Business Associate' }}
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
        {page === 'tasks' && <TasksPage key={key} go={go} initialContactId={target.contactId} initialStage={target.stage} />}
        {page === 'leads' && <LeadsPage key={key} openAdd={!!target.addLead} api={baLeadsApi} onChanged={notifyBaChanged} subtitle="Your own leads. Mark each one Hot, Warm or Cold and keep track of the next call." />}
        {page === 'quotation' && <QuotationPage key={key} go={go} initialContactId={target.contactId} initialQuotationId={target.quotationId} />}
        {page === 'demos' && <DemoSchedulePage key={key} go={go} initialContactId={target.contactId} openNew={!!target.newDemo} />}
        {page === 'scope' && <ScopePage key={key} go={go} initialContactId={target.contactId} initialScopeId={target.scopeId} />}
      </div>
    </DashboardShell>
  );
};

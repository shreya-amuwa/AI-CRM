import React, { useEffect, useState } from 'react';
import { CalendarClock, ClipboardList, FileText, FileSignature, Home, MapPinned, Target } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navigateTo } from '../../utils/router';
import { DashboardShell, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { FIELD_VISIT_GROUP_ID, FIELD_VISIT_NAV, FIELD_VISIT_SEGMENT, FieldVisitWorkspace, fieldVisitPageFromSegment, isFieldVisitPage, type FieldVisitPage } from '../field-visit/FieldVisitWorkspace';
import { AddLeadView } from '../team-member/pipeline/LeadForms';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import { HomePage } from './HomePage';
import { TasksPage } from './TasksPage';
import { QuotationPage } from './QuotationPage';
import { DemoSchedulePage } from './DemoSchedulePage';
import { ScopePage } from './ScopePage';

export type BaPage = 'home' | 'tasks' | 'leads' | 'quotation' | 'demos' | 'scope';
/** The pages of this dashboard: the Business Associate pages plus the rest of the Leads group (Leads is the first of its four). */
type Section = BaPage | Exclude<PipelineSection, 'leads'> | FieldVisitPage;
/** Where a button sends the Business Associate: a page, and optionally the client (and document) to open there. */
export interface BaTarget { contactId?: string; quotationId?: string; scopeId?: string; stage?: string; addLead?: boolean; newDemo?: boolean }
export type BaNavigate = (page: BaPage, target?: BaTarget) => void;

const NAV: { id: string; label: string; icon: React.ElementType; children?: { id: string; label: string }[] }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  // the same Leads -> Potential -> Customer onboarding pipeline every Sales member works in; one record moves through the steps
  {
    id: 'leads-group',
    label: 'Leads',
    icon: Target,
    children: [
      { id: 'leads', label: 'Leads' },
      { id: 'potential', label: 'Potential' },
      { id: 'onboarding', label: 'Customer onboarding' },
      { id: 'part-payments', label: 'Part payments' }
    ]
  },
  // Field Visit: planning and recording visits to leads, inside this same dashboard
  { id: FIELD_VISIT_GROUP_ID, label: 'Field Visit', icon: MapPinned, children: FIELD_VISIT_NAV },
  { id: 'quotation', label: 'Quotation', icon: FileText },
  { id: 'demos', label: 'Demo Schedule', icon: CalendarClock },
  { id: 'scope', label: 'Scope of Project', icon: FileSignature }
];
const SEGMENT: Record<Section, string> = {
  ...FIELD_VISIT_SEGMENT,
  home: '', tasks: 'tasks', leads: 'leads', potential: 'potential', onboarding: 'customer-onboarding', 'part-payments': 'part-payments',
  quotation: 'quotation', demos: 'demo-schedule', scope: 'scope-of-project'
};

export const BA_BASE = (userId: string) => `/business-associate/dashboard/${userId}`;
export function parseBaPage(path: string): Section {
  const seg = path.replace(/\/+$/, '').split('/')[4];
  const visit = fieldVisitPageFromSegment(seg);
  if (visit) return visit;
  return (Object.keys(SEGMENT) as Section[]).find(p => SEGMENT[p] && SEGMENT[p] === seg) ?? 'home';
}

/**
 * The Business Associate workspace: Tasks (contacts handed over by Telecallers), Leads, Quotation, Demo Schedule and Scope of Project, all around the
 * same client record. Every page reads and writes through the API; the database lets a Business Associate see only their own contacts and documents.
 */
export const BusinessAssociateDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<Section>(() => parseBaPage(window.location.pathname));
  const [target, setTarget] = useState<BaTarget & { n: number }>({ n: 0 });

  useEffect(() => {
    const onPop = () => setPage(parseBaPage(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { counts: pipelineCounts } = usePipelineCounts();

  const open = (next: Section, t?: BaTarget) => {
    setTarget(prev => ({ ...t, n: prev.n + 1 }));
    setPage(next);
    navigateTo(next === 'home' ? BA_BASE(userId) : `${BA_BASE(userId)}/${SEGMENT[next]}`);
  };
  const go: BaNavigate = (next, t) => open(next, t);

  const displayName = profile?.fullName || user?.name || 'Business Associate';
  const groups = groupNavItems(NAV, [{ ids: ['home'] }, { ids: ['tasks', 'leads-group', FIELD_VISIT_GROUP_ID, 'quotation', 'demos', 'scope'] }]);
  const key = `${page}-${target.n}`;

  return (
    <DashboardShell
      title="Amuwa Sales"
      subtitle="Business Associate"
      ariaLabel="Business Associate navigation"
      groups={groups}
      active={page}
      onSelect={id => open(id as Section)}
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
        {(page === 'leads' || page === 'potential' || page === 'onboarding' || page === 'part-payments') && (
          <PipelineWorkspace section={page} counts={pipelineCounts} leadFilters startWithAdd={page === 'leads' && !!target.addLead} resetKey={target.n} onNavigate={next => open(next)} />
        )}
        {isFieldVisitPage(page) && (
          <FieldVisitWorkspace
            page={page}
            onNavigate={next => open(next)}
            renderAddLead={a => <AddLeadView defaultSource={a.source} onCancel={a.onCancel} onSaved={a.onSaved} />}
          />
        )}
        {page === 'quotation' && <QuotationPage key={key} go={go} initialContactId={target.contactId} initialQuotationId={target.quotationId} />}
        {page === 'demos' && <DemoSchedulePage key={key} go={go} initialContactId={target.contactId} openNew={!!target.newDemo} />}
        {page === 'scope' && <ScopePage key={key} go={go} initialContactId={target.contactId} initialScopeId={target.scopeId} />}
      </div>
    </DashboardShell>
  );
};

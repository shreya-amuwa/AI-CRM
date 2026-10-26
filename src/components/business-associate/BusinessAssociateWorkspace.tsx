import React from 'react';
import { CalendarClock, ClipboardList, FileSignature, FileText, Home } from 'lucide-react';
import { HomePage } from './HomePage';
import { TasksPage } from './TasksPage';
import { QuotationPage } from './QuotationPage';
import { DemoSchedulePage } from './DemoSchedulePage';
import { ScopePage } from './ScopePage';
import type { BaNavigate, BaPage, BaTarget } from './BusinessAssociateDashboard';

/**
 * The Business Associate pages, for a Sales Team Member who works as a Business Associate from the Sales Team Member dashboard. The pages are the
 * same ones the Business Associate dashboard shows; the member's own sidebar decides which one is open. The database lets the member see only
 * their own contacts and documents. The Business Associate's Leads page is not repeated here: a Sales member's leads are the ones in My Leads.
 */
export const BA_WORKSPACE_NAV: { page: Exclude<BaPage, 'leads'>; nav: string; label: string; icon: React.ElementType }[] = [
  { page: 'home', nav: 'ba-home', label: 'BA Overview', icon: Home },
  { page: 'tasks', nav: 'ba-contacts', label: 'BA Tasks', icon: ClipboardList },
  { page: 'quotation', nav: 'ba-quotation', label: 'Quotation', icon: FileText },
  { page: 'demos', nav: 'ba-demos', label: 'Demo Schedule', icon: CalendarClock },
  { page: 'scope', nav: 'ba-scope', label: 'Scope of Project', icon: FileSignature }
];
export const baPageOfNav = (nav: string) => BA_WORKSPACE_NAV.find(n => n.nav === nav)?.page ?? null;
export const isBaNav = (nav: string) => baPageOfNav(nav) !== null;

interface Props {
  /** Any Business Associate page except Leads (see above). */
  page: Exclude<BaPage, 'leads'>;
  target: BaTarget;
  /** Changes whenever the member opens a page, so it starts fresh (or on the client a button pointed to). */
  resetKey: number;
  onGo: BaNavigate;
}

export const BusinessAssociateWorkspace: React.FC<Props> = ({ page, target, resetKey, onGo }) => {
  const key = `${page}-${resetKey}`;
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      {page === 'home' && <HomePage go={onGo} />}
      {page === 'tasks' && <TasksPage key={key} go={onGo} initialContactId={target.contactId} initialStage={target.stage} />}
      {page === 'quotation' && <QuotationPage key={key} go={onGo} initialContactId={target.contactId} initialQuotationId={target.quotationId} />}
      {page === 'demos' && <DemoSchedulePage key={key} go={onGo} initialContactId={target.contactId} openNew={!!target.newDemo} />}
      {page === 'scope' && <ScopePage key={key} go={onGo} initialContactId={target.contactId} initialScopeId={target.scopeId} />}
    </div>
  );
};

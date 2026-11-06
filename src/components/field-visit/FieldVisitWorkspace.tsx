import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  FIELD_VISIT_FILTERS,
  FIELD_VISIT_FILTER_LABELS,
  type FieldVisitAssignedRow,
  type FieldVisitFilter,
  type FieldVisitLeadRow,
  type FieldVisitOverview,
  type LeadVisit,
  type VisitPriority
} from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { listenToTables } from '../../lib/realtimeShared';
import { visitTracker } from '../../services/fieldVisitTracking';
import { PageTitle } from '../layout/shell';
import { WorkflowBadge } from '../payments/PaymentBits';
import { Card, ErrorBanner, Pager, Pill, Spinner, btn, inputCls, selectCls, useDebounced, type Tone } from '../team-member/pipeline/shared';
import { EmptyState, StatCard, dateText } from '../telecaller/ui';
import {
  CancelVisitDialog,
  CompleteVisitDialog,
  LocationLine,
  ScheduleVisitDialog,
  StartVisitDialog,
  VisitHistoryDialog,
  VisitStatusPill,
  timeText,
  type VisitLead
} from './FieldVisitDialogs';
import { VisitTrackingPanel } from './VisitTrackingPanel';

/**
 * Field Visit, inside the Sales member's own dashboard (Sales Team Member, Telecaller, Business Associate): ten pages under one sidebar group.
 *
 *   fv-overview   six numbers + the lead table with all ten filters
 *   fv-assigned   the leads the Department Head assigned to me, with their instructions (read-only for me)
 *   fv-add        the dashboard's own Add Lead form (the host passes it in, so there is one form and one record)
 *   fv-all / fv-mine / fv-department / fv-accounts / fv-returned   the lead table with one filter fixed
 *   fv-my-visits  my scheduled and running visits, with Start / Outcome / Cancel
 *   fv-history    my finished and cancelled visits
 *
 * Every number and row comes from the database through /field-visits (lead_visits, lead_visit_assignments). The screens only ask; the database
 * decides which leads a person may see and plan a visit for, so nothing here widens access.
 */
export type FieldVisitPage = 'fv-overview' | 'fv-assigned' | 'fv-add' | 'fv-all' | 'fv-mine' | 'fv-department' | 'fv-accounts' | 'fv-returned' | 'fv-my-visits' | 'fv-history';

export const FIELD_VISIT_NAV: { id: FieldVisitPage; label: string }[] = [
  { id: 'fv-overview', label: 'Field Visit Overview' },
  { id: 'fv-assigned', label: 'Department Head Assigned Leads' },
  { id: 'fv-add', label: 'Add Lead' },
  { id: 'fv-all', label: 'All Leads' },
  { id: 'fv-mine', label: 'My Leads' },
  { id: 'fv-department', label: 'Department Leads' },
  { id: 'fv-accounts', label: 'To Accounts' },
  { id: 'fv-returned', label: 'Returned by Accounts' },
  { id: 'fv-my-visits', label: 'My Field Visits' },
  { id: 'fv-history', label: 'Visit History' }
];
/** The sidebar group the three dashboards share (the Sales Team Member's own menu draws the same ten pages). */
export const FIELD_VISIT_GROUP_ID = 'field-visit-group';
export const FIELD_VISIT_SEGMENT: Record<FieldVisitPage, string> = {
  'fv-overview': 'field-visit',
  'fv-assigned': 'field-visit-assigned-leads',
  'fv-add': 'field-visit-add-lead',
  'fv-all': 'field-visit-all-leads',
  'fv-mine': 'field-visit-my-leads',
  'fv-department': 'field-visit-department-leads',
  'fv-accounts': 'field-visit-to-accounts',
  'fv-returned': 'field-visit-returned',
  'fv-my-visits': 'field-visit-my-visits',
  'fv-history': 'field-visit-history'
};
export const fieldVisitPageFromSegment = (seg: string | undefined): FieldVisitPage | undefined =>
  (Object.keys(FIELD_VISIT_SEGMENT) as FieldVisitPage[]).find(p => FIELD_VISIT_SEGMENT[p] === seg);
export const isFieldVisitPage = (id: string): id is FieldVisitPage => FIELD_VISIT_NAV.some(n => n.id === id);

const PAGE_FILTER: Partial<Record<FieldVisitPage, FieldVisitFilter>> = {
  'fv-all': 'ALL',
  'fv-mine': 'MINE',
  'fv-department': 'DEPARTMENT',
  'fv-accounts': 'TO_ACCOUNTS',
  'fv-returned': 'RETURNED'
};
const EMPTY_TEXT: Record<FieldVisitFilter, { title: string; text: string }> = {
  ALL: { title: 'No leads yet', text: 'Leads you own, leads of your department and leads your Department Head assigned to you appear here.' },
  MINE: { title: 'No leads of your own', text: 'Leads you add appear here.' },
  DEPARTMENT: { title: 'No department leads', text: 'Leads of the other people in your department appear here, to view.' },
  DH_ASSIGNED: { title: 'Nothing assigned to you', text: 'Leads your Department Head assigns to you for a field visit appear here.' },
  TO_ACCOUNTS: { title: 'Nothing is with Accounts', text: 'Leads sent to Accounts for payment confirmation appear here until Accounts acts on them.' },
  RETURNED: { title: 'Accounts has not returned any lead', text: 'A lead Accounts sends back for correction appears here.' },
  VISIT_PENDING: { title: 'No visit is pending', text: 'Leads your Department Head assigned to you and that have no visit planned yet appear here.' },
  VISIT_SCHEDULED: { title: 'No visit is scheduled', text: 'Visits you planned and have not finished appear here.' },
  VISIT_COMPLETED: { title: 'No visit is completed', text: 'Leads whose visit you finished appear here.' },
  FOLLOW_UP: { title: 'No follow-up is required', text: 'Leads that need another contact after a visit appear here.' }
};
const PRIORITY_TONE: Record<VisitPriority, Tone> = { URGENT: 'red', HIGH: 'orange', NORMAL: 'indigo', LOW: 'slate' };
const PRIORITY_LABEL: Record<VisitPriority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };

/** A change event any Field Visit screen can raise: the open lists and the numbers reload. */
const CHANGED = 'crm:field-visit-changed';
const notifyChanged = () => window.dispatchEvent(new CustomEvent(CHANGED));

/** Bumps when a visit, an assignment or a lead changes (here, in another tab or by another person), so every shown list reloads. */
function useRefreshTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTick(t => t + 1), 400);
    };
    window.addEventListener(CHANGED, bump);
    window.addEventListener('crm:pipeline-changed', bump);
    const stop = listenToTables(['lead_visits', 'lead_visit_assignments', 'customers'], bump);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CHANGED, bump);
      window.removeEventListener('crm:pipeline-changed', bump);
      stop();
    };
  }, []);
  return tick;
}

/** Loads something through the API, ignoring answers that arrive late, and reloads when `deps` or the shared refresh tick change. */
function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[], tick: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    fetcher().then(
      d => mine === seq.current && (setData(d), setLoading(false)),
      err => mine === seq.current && (setError(errorMessage(err)), setLoading(false))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run, tick]);
  return { data, loading, error, reload: run };
}

// ---------------------------------------------------------------------------
// Visit dialogs, shared by every page
// ---------------------------------------------------------------------------
type DialogState =
  | { kind: 'schedule'; lead: VisitLead }
  | { kind: 'edit'; lead: VisitLead; visit: LeadVisit }
  | { kind: 'start' | 'complete' | 'cancel'; visit: LeadVisit }
  | { kind: 'history'; lead: Pick<VisitLead, 'leadId' | 'name'> };

function useVisitDialogs() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string) => {
    setNotice(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  };
  const saved = (text: string) => (v?: LeadVisit) => {
    void v;
    setDialog(null);
    say(text);
    notifyChanged();
  };
  /** The row only knows the visit's id; the dialogs need the whole visit, so it is read first. */
  const openVisit = async (kind: 'start' | 'complete' | 'cancel' | 'edit', leadId: string, visitId: string, lead?: VisitLead) => {
    setBusy(true);
    setError(null);
    try {
      const list = await fieldVisitApi.list({ scope: 'OPEN', leadId, pageSize: 100 });
      const visit = list.items.find(v => v.id === visitId);
      if (!visit) {
        setError('This visit has changed. The list was refreshed.');
        notifyChanged();
      } else if (kind === 'edit') setDialog({ kind, visit, lead: lead ?? { leadId, name: visit.leadName, company: visit.company, address: visit.address } });
      else setDialog({ kind, visit });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // a finished or cancelled visit stops this phone collecting its location at once (the database has already ended tracking)
  const endTracking = (visitId: string, then: (v?: LeadVisit) => void) => (v?: LeadVisit) => {
    if (visitTracker.isCollecting(visitId)) void visitTracker.stop('visit-ended');
    then(v);
  };

  const element = (
    <>
      {notice && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium" data-testid="visit-notice">
          {notice}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {dialog?.kind === 'schedule' && <ScheduleVisitDialog lead={dialog.lead} onClose={() => setDialog(null)} onSaved={saved('The visit was scheduled.')} />}
      {dialog?.kind === 'edit' && <ScheduleVisitDialog lead={dialog.lead} visit={dialog.visit} onClose={() => setDialog(null)} onSaved={saved('The visit plan was updated.')} />}
      {dialog?.kind === 'start' && <StartVisitDialog visit={dialog.visit} onClose={() => setDialog(null)} onSaved={saved('The visit has started.')} />}
      {dialog?.kind === 'complete' && <CompleteVisitDialog visit={dialog.visit} onClose={() => setDialog(null)} onSaved={endTracking(dialog.visit.id, saved('The visit outcome was saved.'))} />}
      {dialog?.kind === 'cancel' && <CancelVisitDialog visit={dialog.visit} onClose={() => setDialog(null)} onSaved={endTracking(dialog.visit.id, saved('The visit was cancelled.'))} />}
      {dialog?.kind === 'history' && <VisitHistoryDialog lead={dialog.lead} onClose={() => setDialog(null)} />}
    </>
  );
  return { element, busy, openVisit, schedule: (lead: VisitLead) => setDialog({ kind: 'schedule', lead }), history: (lead: Pick<VisitLead, 'leadId' | 'name'>) => setDialog({ kind: 'history', lead }), setDialog };
}
type Dialogs = ReturnType<typeof useVisitDialogs>;

const Toolbar: React.FC<{ search: string; onSearch: (v: string) => void; children?: React.ReactNode; label: string }> = ({ search, onSearch, children, label }) => (
  <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
    <div className="relative flex-1 min-w-[14rem] max-w-md">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input className={`${inputCls} pl-9`} value={search} onChange={e => onSearch(e.target.value)} placeholder="Search name, company, phone or source" aria-label={label} />
    </div>
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// Lead table (Overview and the five fixed-filter pages)
// ---------------------------------------------------------------------------
const LeadTable: React.FC<{ filter: FieldVisitFilter; onFilter?: (f: FieldVisitFilter) => void; counts?: FieldVisitOverview['filters']; tick: number; dialogs: Dialogs }> = ({
  filter,
  onFilter,
  counts,
  tick,
  dialogs
}) => {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [sort, setSort] = useState<'visitDate' | 'name' | 'newest' | 'followUp'>('visitDate');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => setPage(1), [filter, query, sort, pageSize]);
  const { data, loading, error, reload } = useLoad(() => fieldVisitApi.leads({ filter, search: query || undefined, sort, page, pageSize }), [filter, query, sort, page, pageSize], tick);

  const actions = (r: FieldVisitLeadRow) => {
    const lead: VisitLead = { leadId: r.leadId, name: r.name, company: r.company };
    const open = r.visitId && (r.visitStatus === 'SCHEDULED' || r.visitStatus === 'IN_PROGRESS');
    return (
      <div className="flex flex-wrap gap-1.5">
        {!open && r.canVisit && (
          <button type="button" className={btn.primary} onClick={() => dialogs.schedule(lead)} data-testid="fv-schedule">
            Schedule visit
          </button>
        )}
        {open && r.visitStatus === 'SCHEDULED' && (
          <>
            <button type="button" className={btn.primary} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('start', r.leadId, r.visitId!)}>
              Start
            </button>
            <button type="button" className={btn.secondary} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('edit', r.leadId, r.visitId!, lead)}>
              Reschedule
            </button>
            <button type="button" className={btn.danger} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('cancel', r.leadId, r.visitId!)}>
              Cancel
            </button>
          </>
        )}
        {open && r.visitStatus === 'IN_PROGRESS' && (
          <button type="button" className={btn.green} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('complete', r.leadId, r.visitId!)}>
            Record outcome
          </button>
        )}
        <button type="button" className={btn.secondary} onClick={() => dialogs.history(lead)}>
          History
        </button>
      </div>
    );
  };

  return (
    <Card className="overflow-hidden" >
      {onFilter && (
        <div role="tablist" aria-label="Field visit filter" className="flex gap-1.5 overflow-x-auto p-3 border-b border-slate-100" data-testid="fv-filter-tabs">
          {FIELD_VISIT_FILTERS.map(f => {
            const on = f === filter;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`fv-filter-${f}`}
                onClick={() => onFilter(f)}
                className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  on ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-200'
                }`}
              >
                {FIELD_VISIT_FILTER_LABELS[f]}
                {counts && (
                  <span className={`min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-bold text-center ${on ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`} data-testid={`fv-count-${f}`}>
                    {counts[f]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <Toolbar search={search} onSearch={setSearch} label="Search leads">
        <select className={selectCls} value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort leads">
          <option value="visitDate">Sort: visit date</option>
          <option value="followUp">Sort: next follow-up</option>
          <option value="name">Sort: name</option>
          <option value="newest">Sort: newest</option>
        </select>
      </Toolbar>
      {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
      {loading && !data ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={query ? 'No lead matches your search' : EMPTY_TEXT[filter].title}>{query ? 'Try a different name, company or number.' : EMPTY_TEXT[filter].text}</EmptyState>
      ) : data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="fv-lead-table">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  {['Lead / Customer', 'Company', 'Contact number', 'Assigned by', 'Lead source', 'Department', 'Visit date', 'Visit status', 'Last visit', 'Next follow-up', 'Actions'].map(h => (
                    <th key={h} scope="col" className="px-2.5 py-2.5 align-bottom">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data.items.map(r => (
                  <tr key={r.leadId} className="border-b border-slate-50 align-top hover:bg-slate-50/60" data-testid="fv-lead-row">
                    <td className="px-2.5 py-3">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      {!r.isMine && r.owner && <div className="text-[11px] text-slate-500">Owner: {r.owner.fullName}</div>}
                      <div className="mt-1">
                        <WorkflowBadge workflow={r.paymentWorkflow} />
                      </div>
                    </td>
                    <td className="px-2.5 py-3 text-slate-700">{r.company || '-'}</td>
                    <td className="px-2.5 py-3 text-slate-700 whitespace-nowrap">{r.phone || '-'}</td>
                    <td className="px-2.5 py-3 text-slate-700">
                      {r.assignment ? (
                        <>
                          {r.assignment.assignedBy || 'Department Head'}
                          <div className="text-[11px] text-slate-500">Department Head assigned</div>
                        </>
                      ) : r.isMine ? (
                        'Self'
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-2.5 py-3 text-slate-700">{r.leadSource || '-'}</td>
                    <td className="px-2.5 py-3 text-slate-700">{r.department || '-'}</td>
                    <td className="px-2.5 py-3 text-slate-700 whitespace-nowrap">
                      {r.visitDate ? dateText(r.visitDate) : '-'}
                      {r.plannedTime && <div className="text-[11px] text-slate-500">{timeText(r.plannedTime)}</div>}
                    </td>
                    <td className="px-2.5 py-3">
                      <VisitStatusPill status={r.visitStatus} />
                    </td>
                    <td className="px-2.5 py-3 text-slate-700 whitespace-nowrap">{r.lastVisit ? dateText(r.lastVisit) : '-'}</td>
                    <td className="px-2.5 py-3 text-slate-700 whitespace-nowrap">{r.nextFollowUp ? dateText(r.nextFollowUp) : '-'}</td>
                    <td className="px-2.5 py-3 min-w-[7.5rem]">{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={data.total} noun="leads" onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const Overview: React.FC<{ tick: number; dialogs: Dialogs }> = ({ tick, dialogs }) => {
  const [filter, setFilter] = useState<FieldVisitFilter>('ALL');
  const { data, error, reload } = useLoad(() => fieldVisitApi.overview(), [], tick);
  const n = (v: number | undefined) => (data ? v ?? 0 : '…');
  return (
    <div className="space-y-5" data-testid="fv-overview">
      <PageTitle title="Field Visit Overview" subtitle="Plan visits to your leads, record how they went and follow up." />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 [&>button]:h-full [&>button>div]:h-full">
        <StatCard label="Total Assigned Leads" value={n(data?.totalAssigned)} tone="blue" hint="From your Department Head" onClick={() => setFilter('DH_ASSIGNED')} />
        <StatCard label="My Leads" value={n(data?.myLeads)} hint="Leads you own" onClick={() => setFilter('MINE')} />
        <StatCard label="Today's Scheduled Visits" value={n(data?.todayScheduled)} tone="amber" hint="Planned for today" onClick={() => setFilter('VISIT_SCHEDULED')} />
        <StatCard label="Completed Field Visits" value={n(data?.completed)} tone="green" onClick={() => setFilter('VISIT_COMPLETED')} />
        <StatCard label="Pending Field Visits" value={n(data?.pending)} tone="red" hint="Assigned, no visit planned" onClick={() => setFilter('VISIT_PENDING')} />
        <StatCard label="Follow-ups Required" value={n(data?.followUps)} tone="amber" onClick={() => setFilter('FOLLOW_UP')} />
      </div>
      <LeadTable filter={filter} onFilter={setFilter} counts={data?.filters} tick={tick} dialogs={dialogs} />
    </div>
  );
};

const Assigned: React.FC<{ tick: number; dialogs: Dialogs }> = ({ tick, dialogs }) => {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => setPage(1), [query, pageSize]);
  const { data, loading, error, reload } = useLoad(() => fieldVisitApi.assigned({ search: query || undefined, page, pageSize }), [query, page, pageSize], tick);
  return (
    <div className="space-y-5" data-testid="fv-assigned">
      <PageTitle title="Department Head Assigned Leads" subtitle="Leads your Department Head gave you for a field visit. The assignment is theirs to change; you plan and record the visits." />
      <Card className="overflow-hidden">
        <Toolbar search={search} onSearch={setSearch} label="Search assigned leads" />
        {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={query ? 'No lead matches your search' : EMPTY_TEXT.DH_ASSIGNED.title}>{query ? 'Try a different name, company or number.' : EMPTY_TEXT.DH_ASSIGNED.text}</EmptyState>
        ) : data ? (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((r: FieldVisitAssignedRow) => {
                const lead: VisitLead = { leadId: r.leadId, name: r.name, company: r.company, address: r.address };
                const open = !!r.openVisitId;
                return (
                  <li key={r.id} className="p-4 space-y-3" data-testid="fv-assigned-row">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{r.name}</span>
                          <Pill tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]} priority</Pill>
                          {r.openVisitStatus && <VisitStatusPill status={r.openVisitStatus} />}
                          <WorkflowBadge workflow={r.paymentWorkflow} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[r.company, r.phone, r.email].filter(Boolean).join(' · ') || '-'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.canVisit && !open && (
                          <button type="button" className={btn.primary} onClick={() => dialogs.schedule(lead)} data-testid="fv-schedule">
                            Schedule visit
                          </button>
                        )}
                        {open && r.openVisitStatus === 'SCHEDULED' && (
                          <button type="button" className={btn.primary} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('start', r.leadId, r.openVisitId!)}>
                            Start
                          </button>
                        )}
                        {open && r.openVisitStatus === 'IN_PROGRESS' && (
                          <button type="button" className={btn.green} disabled={dialogs.busy} onClick={() => void dialogs.openVisit('complete', r.leadId, r.openVisitId!)}>
                            Record outcome
                          </button>
                        )}
                        <button type="button" className={btn.secondary} onClick={() => dialogs.history(lead)}>
                          History
                        </button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                      {(
                        [
                          ['Assigned on', dateText(r.assignedAt)],
                          ['Assigned by', r.assignedBy || '-'],
                          ['Department', r.department || '-'],
                          ['Lead status', r.leadStatus.replace(/_/g, ' ').toLowerCase()],
                          ['Lead source', r.leadSource || '-'],
                          ['Interested service', r.services || '-'],
                          ['Address', [r.address, r.city].filter(Boolean).join(', ') || '-'],
                          ['Lead owner', r.isMine ? 'You' : r.owner?.fullName || '-'],
                          ['Visits made', String(r.visits)]
                        ] as [string, string][]
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt className="font-medium text-slate-500">{k}</dt>
                          <dd className="text-slate-800 break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3 text-xs text-slate-800" data-testid="fv-instructions">
                      <span className="font-semibold text-blue-800">Visit instructions: </span>
                      {r.instructions || 'No instructions were given.'}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} noun="assigned leads" onPage={setPage} onPageSize={setPageSize} />
          </>
        ) : null}
      </Card>
    </div>
  );
};

const VisitList: React.FC<{ mode: 'OPEN' | 'HISTORY'; tick: number; dialogs: Dialogs }> = ({ mode, tick, dialogs }) => {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => setPage(1), [query, status, pageSize]);
  const { data, loading, error, reload } = useLoad(
    () => fieldVisitApi.list({ scope: mode, status: status || undefined, search: query || undefined, page, pageSize }),
    [mode, status, query, page, pageSize],
    tick
  );
  const open = mode === 'OPEN';
  const statuses = open ? (['SCHEDULED', 'IN_PROGRESS'] as const) : (['COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED'] as const);
  const labels: Record<string, string> = { SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', FOLLOW_UP_REQUIRED: 'Follow-up Required', CANCELLED: 'Cancelled' };
  return (
    <div className="space-y-5" data-testid={open ? 'fv-my-visits' : 'fv-history'}>
      <PageTitle
        title={open ? 'My Field Visits' : 'Visit History'}
        subtitle={open ? 'Visits you planned and have not finished. Start a visit when you arrive and record the outcome when you leave.' : 'Visits you finished or cancelled. Nothing here is overwritten: each visit stays as it was recorded.'}
      />
      <Card className="overflow-hidden">
        <Toolbar search={search} onSearch={setSearch} label="Search visits">
          <select className={selectCls} value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by visit status">
            <option value="">All statuses</option>
            {statuses.map(s => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </Toolbar>
        {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={query || status ? 'No visit matches your filters' : open ? 'No visit is planned' : 'No finished visit yet'}>
            {query || status ? 'Try a different search or status.' : open ? 'Schedule a visit from the Overview or from one of your leads.' : 'Finished and cancelled visits appear here.'}
          </EmptyState>
        ) : data ? (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map(v => {
                const lead: VisitLead = { leadId: v.leadId, name: v.leadName, company: v.company, address: v.address };
                return (
                  <li key={v.id} className="p-4 space-y-2" data-testid="fv-visit-row">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{v.leadName}</span>
                          <VisitStatusPill status={v.status} />
                          {v.assignedBy && v.assignmentId && <Pill tone="indigo">Department Head assigned</Pill>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[v.company, v.phone].filter(Boolean).join(' · ') || '-'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {v.status === 'SCHEDULED' && (
                          <>
                            <button type="button" className={btn.primary} onClick={() => dialogs.setDialog({ kind: 'start', visit: v })} data-testid="fv-start">
                              Start
                            </button>
                            <button type="button" className={btn.secondary} onClick={() => dialogs.setDialog({ kind: 'edit', lead, visit: v })}>
                              Reschedule
                            </button>
                            <button type="button" className={btn.danger} onClick={() => dialogs.setDialog({ kind: 'cancel', visit: v })}>
                              Cancel
                            </button>
                          </>
                        )}
                        {v.status === 'IN_PROGRESS' && (
                          <button type="button" className={btn.green} onClick={() => dialogs.setDialog({ kind: 'complete', visit: v })} data-testid="fv-complete">
                            Record outcome
                          </button>
                        )}
                        <button type="button" className={btn.secondary} onClick={() => dialogs.history(lead)}>
                          Lead history
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-slate-800">{v.purpose}</p>
                    {v.status === 'IN_PROGRESS' && <VisitTrackingPanel visit={v} />}
                    <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-1.5 text-xs">
                      {(
                        [
                          ['Visit date', `${dateText(v.visitDate)}${v.plannedTime ? ` · ${timeText(v.plannedTime)}` : ''}`],
                          ['Address', v.address],
                          ['Outcome', v.outcome],
                          ['Requirements', v.requirements],
                          ['Next steps', v.nextSteps],
                          ['Next follow-up', v.nextFollowUp ? dateText(v.nextFollowUp) : null],
                          ['Cancelled because', v.cancelReason]
                        ] as [string, string | null][]
                      )
                        .filter(([, value]) => value)
                        .map(([k, value]) => (
                          <div key={k}>
                            <dt className="font-medium text-slate-500">{k}</dt>
                            <dd className="text-slate-800 whitespace-pre-wrap break-words">{value}</dd>
                          </div>
                        ))}
                      <div className="sm:col-span-2 text-slate-500" data-testid="fv-location">
                        <LocationLine visit={v} />
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} noun="visits" onPage={setPage} onPageSize={setPageSize} />
          </>
        ) : null}
      </Card>
    </div>
  );
};

const FilterPage: React.FC<{ page: FieldVisitPage; tick: number; dialogs: Dialogs }> = ({ page, tick, dialogs }) => {
  const filter = PAGE_FILTER[page]!;
  const readOnly = filter === 'DEPARTMENT';
  const nav = FIELD_VISIT_NAV.find(n => n.id === page)!;
  return (
    <div className="space-y-5" data-testid={`fv-page-${filter}`}>
      <PageTitle
        title={nav.label}
        subtitle={readOnly ? 'Leads of the other people in your department. You can view them; only their owner changes them.' : EMPTY_TEXT[filter].text}
      />
      <LeadTable filter={filter} tick={tick} dialogs={dialogs} />
    </div>
  );
};

export const FieldVisitWorkspace: React.FC<{
  page: FieldVisitPage;
  onNavigate: (page: FieldVisitPage) => void;
  /** The dashboard's own Add Lead form, so a lead is added in one place only. `source` is the lead source to start with. */
  renderAddLead: (a: { onCancel: () => void; onSaved: () => void; source: string }) => React.ReactNode;
}> = ({ page, onNavigate, renderAddLead }) => {
  const tick = useRefreshTick();
  const dialogs = useVisitDialogs();
  return (
    <div className="space-y-5" data-testid="field-visit-workspace">
      {dialogs.element}
      {page === 'fv-overview' && <Overview tick={tick} dialogs={dialogs} />}
      {page === 'fv-assigned' && <Assigned tick={tick} dialogs={dialogs} />}
      {page === 'fv-add' &&
        renderAddLead({
          source: 'Field visit',
          onCancel: () => onNavigate('fv-overview'),
          onSaved: () => {
            notifyChanged();
            onNavigate('fv-mine');
          }
        })}
      {PAGE_FILTER[page] && <FilterPage page={page} tick={tick} dialogs={dialogs} />}
      {page === 'fv-my-visits' && <VisitList mode="OPEN" tick={tick} dialogs={dialogs} />}
      {page === 'fv-history' && <VisitList mode="HISTORY" tick={tick} dialogs={dialogs} />}
    </div>
  );
};

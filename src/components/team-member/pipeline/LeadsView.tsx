import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Inbox, Pencil, Plus, Search } from 'lucide-react';
import type { InboundLead, LeadAccountsFilter, LeadScope, LeadScopeRow, LeadStatus, Paginated, PipelineCounts, PipelineCustomer, TeamDivision } from '../../../../shared/contracts';
import { LEAD_STATUSES } from '../../../../shared/contracts';
import { WorkflowBadge } from '../../payments/PaymentBits';
import { errorMessage } from '../../../lib/api/client';
import { rowOpen } from '../../../lib/rowClick';
import { leadScopeApi, pipelineApi, type PipelineQuery } from '../../../lib/api/endpoints';
import { AccountsDetails, LEAD_SCOPE_EMPTY, LeadOwner, LeadScopeTabs, ReadOnlyLeadDialog, useLeadScopeCounts } from '../../leads/LeadScope';
import {
  Avatar,
  btn,
  Card,
  ErrorBanner,
  formatFollowUp,
  LEAD_SOURCES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_TONE,
  notifyPipelineChanged,
  Pager,
  Pill,
  selectCls,
  ServiceChips,
  Spinner,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from './shared';

type FollowUpFilter = '' | 'TODAY' | 'OVERDUE' | 'THIS_WEEK' | 'NONE';

/** Follow-up windows are computed in the user's own timezone. */
function followUpRange(f: FollowUpFilter): Pick<PipelineQuery, 'followUpFrom' | 'followUpTo' | 'noFollowUp'> {
  if (!f) return {};
  if (f === 'NONE') return { noFollowUp: true };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  if (f === 'TODAY') return { followUpFrom: today.toISOString(), followUpTo: tomorrow.toISOString() };
  if (f === 'OVERDUE') return { followUpTo: now.toISOString() };
  return { followUpFrom: today.toISOString(), followUpTo: new Date(today.getTime() + 7 * 86400000).toISOString() };
}

type Tab = '' | LeadStatus | LeadAccountsFilter;
const TABS: Tab[] = ['', 'NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY', 'RETURNED', 'WITH_ACCOUNTS'];
// with the five lead filters, Returned and With Accounts are filters of their own (Returned by Accounts, To Accounts)
const STATUS_TABS: Tab[] = ['', 'NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'];

/** A row of the filtered list: the lead as the database returns it for the filter, shaped like a pipeline lead for the table. */
type LeadRow = PipelineCustomer & { scopeRow?: LeadScopeRow };
const fromScopeRow = (r: LeadScopeRow): LeadRow =>
  ({
    id: r.id, name: r.name, company: r.company, phone: r.phone, email: r.email, services: r.services, leadSource: r.leadSource, nextFollowUpAt: r.nextFollowUpAt,
    leadStatus: r.leadStatus, paymentWorkflow: r.paymentWorkflow, owner: r.owner, createdBy: r.owner, scopeRow: r
  }) as unknown as LeadRow;
const TAB_LABEL = (t: Tab) => (t === 'WITH_ACCOUNTS' ? 'With Accounts' : t === 'RETURNED' ? 'Returned from Accounts' : t ? LEAD_STATUS_LABEL[t] : 'All');

/**
 * Optional Super Admin / Department Head mode (all props default to the Sales
 * Team Member behaviour): lists the leads of one sub-department, shows who
 * added each lead and cannot add leads.
 */
export interface LeadsViewScope {
  departmentId: string;
  division: TeamDivision;
  /** Start with one team member's leads. */
  initialOwnerId?: string;
  /** Team members offered in the "added by" filter. */
  members?: { id: string; fullName: string }[];
  title?: string;
  subtitle?: string;
  /** Label of the row button (the details are read-only), default "View". */
  actionLabel?: string;
}

export const LeadsView: React.FC<{
  counts: Pick<PipelineCounts, 'leads'> | null;
  showInbound?: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
  scope?: LeadsViewScope;
  /** Only the signed-in person's own leads (a Team Lead's or Department Head's "My Leads"). */
  mine?: boolean;
  /** Business Associate: the five filters (All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts) above the list. */
  leadFilters?: boolean;
}> = ({ counts, showInbound = true, onAdd, onEdit, scope, leadFilters = false, mine = false }) => {
  const [lscope, setLscope] = useState<LeadScope>('ALL');
  const { counts: scopeCounts, error: scopeCountsError, refresh: refreshScopeCounts } = useLeadScopeCounts();
  const [statusCounts, setStatusCounts] = useState<Partial<Record<LeadStatus, number>>>({});
  const [viewRow, setViewRow] = useState<LeadScopeRow | null>(null);
  const [owner, setOwner] = useState(scope?.initialOwnerId || '');
  const { items: services, byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [source, setSource] = useState('');
  const [followUp, setFollowUp] = useState<FollowUpFilter>('');
  const [status, setStatus] = useState<Tab>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<LeadRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    if (leadFilters && !scope) {
      // the five filters: the database decides which leads each one holds and counts them the same way
      leadScopeApi
        .list({
          scope: lscope,
          page,
          pageSize: 10,
          search: debounced || undefined,
          service: service || undefined,
          source: source || undefined,
          status: (LEAD_STATUSES as readonly string[]).includes(status) ? status : undefined,
          sort: followUp ? 'followUp' : 'newest',
          ...followUpRange(followUp)
        })
        .then(
          res => {
            if (seq !== requestSeq.current) return;
            setData({ items: res.items.map(fromScopeRow), page: res.page, pageSize: res.pageSize, total: res.total });
            setStatusCounts(res.statusCounts);
            refreshScopeCounts();
          },
          err => seq === requestSeq.current && setError(errorMessage(err))
        )
        .finally(() => seq === requestSeq.current && setLoading(false));
      return;
    }
    pipelineApi
      .list({
        stage: 'LEAD',
        ...(scope ? { departmentId: scope.departmentId, division: scope.division, ownerId: owner || undefined } : {}),
        mine: mine || undefined,
        page,
        pageSize: 10,
        search: debounced || undefined,
        service: service || undefined,
        source: source || undefined,
        leadStatus: (LEAD_STATUSES as readonly string[]).includes(status) ? (status as LeadStatus) : undefined,
        accounts: status === 'WITH_ACCOUNTS' || status === 'RETURNED' ? status : undefined,
        sort: followUp ? 'followUp' : 'newest',
        ...followUpRange(followUp)
      })
      .then(
        res => seq === requestSeq.current && setData(res),
        err => seq === requestSeq.current && setError(errorMessage(err))
      )
      .finally(() => seq === requestSeq.current && setLoading(false));
  }, [page, debounced, service, source, status, followUp, scope?.departmentId, scope?.division, owner, lscope, leadFilters, mine]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, service, source, status, followUp, owner, lscope]);
  // a lead that is not mine is for reading only; mine opens as before
  const openRow = (l: LeadRow) => (l.scopeRow && !l.scopeRow.isMine ? setViewRow(l.scopeRow) : onEdit(l.id));
  const rowWithAccounts = (l: LeadRow) => leadFilters && !!l.scopeRow?.accounts && (lscope === 'TO_ACCOUNTS' || lscope === 'RETURNED');
  const tabs = leadFilters && !scope ? STATUS_TABS : TABS;
  usePipelineRealtime(load);

  // Ctrl/Cmd+K focuses search, as shown in the design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Pipeline / Leads</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{scope?.title || 'Leads'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{scope?.subtitle || (leadFilters ? 'Customers interested in our services: your own leads, and your department\'s leads to view.' : 'Customers interested in our services. You see only the leads assigned to you.')}</p>
        </div>
        {!scope && (
          <button type="button" className={`${btn.primary} py-2.5`} onClick={onAdd}>
            <Plus className="w-4 h-4" /> Add lead
          </button>
        )}
      </div>

      {showInbound && <InboundStrip onClaimed={id => onEdit(id)} />}

      <Card className="overflow-hidden">
        <div className="p-4 space-y-3">
          {leadFilters && !scope && <LeadScopeTabs scope={lscope} onChange={setLscope} counts={scopeCounts} />}
          {leadFilters && !scope && scopeCountsError && <ErrorBanner message={scopeCountsError} onRetry={refreshScopeCounts} />}
          <div className="flex flex-col lg:flex-row gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search leads</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by customer, business, phone or service"
                className="w-full pl-9 pr-16 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Ctrl K</kbd>
            </label>
            <select aria-label="Filter by service" className={selectCls} value={service} onChange={e => setService(e.target.value)}>
              <option value="">All services</option>
              {services.map(s => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <select aria-label="Filter by source" className={selectCls} value={source} onChange={e => setSource(e.target.value)}>
              <option value="">All sources</option>
              {LEAD_SOURCES.map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {scope?.members && (
              <select aria-label="Filter by team member" className={selectCls} value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="">All team members</option>
                {scope.members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Filter by follow-up" className={selectCls} value={followUp} onChange={e => setFollowUp(e.target.value as FollowUpFilter)}>
              <option value="">Any follow-up</option>
              <option value="TODAY">Due today</option>
              <option value="OVERDUE">Overdue</option>
              <option value="THIS_WEEK">Next 7 days</option>
              <option value="NONE">No follow-up set</option>
            </select>
          </div>
          <div role="tablist" aria-label="Lead status" className="flex flex-wrap gap-1.5">
            {tabs.map(t => {
              const active = status === t;
              const filtered = leadFilters && !scope;
              const n = filtered
                ? t ? statusCounts[t as LeadStatus] ?? 0 : scopeCounts ? scopeCounts[({ ALL: 'all', MINE: 'mine', DEPARTMENT: 'department', TO_ACCOUNTS: 'toAccounts', RETURNED: 'returned' } as const)[lscope]] : null
                : counts ? (t ? counts.leads[t] : counts.leads.all) : null;
              return (
                <button
                  key={t || 'ALL'}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setStatus(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {TAB_LABEL(t)} {n !== null && <span className={active ? 'text-slate-300' : 'text-slate-400'}>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="px-4 pb-4">
            <ErrorBanner message={error} onRetry={load} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[860px]">
            <thead className="text-[11px] text-slate-500 bg-slate-50/60">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Phone</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Services interested</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                {scope && <th scope="col" className="px-4 py-2.5 font-medium">Added by / Owner</th>}
                <th scope="col" className="px-4 py-2.5 font-medium">Follow-up</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" aria-busy={loading}>
              {loading && !data ? (
                <tr>
                  <td colSpan={scope ? 8 : 7}>
                    <Spinner label="Loading leads…" />
                  </td>
                </tr>
              ) : data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={scope ? 8 : 7} className="py-12 text-center text-sm text-slate-500">
                    {debounced || service || source || status || followUp || owner ? 'No leads match these filters.' : leadFilters && !scope ? `${LEAD_SCOPE_EMPTY[lscope].title}. ${LEAD_SCOPE_EMPTY[lscope].text}` : scope ? 'No leads have been added by this team yet.' : 'No leads yet. Add your first lead to get started.'}
                  </td>
                </tr>
              ) : (
                data?.items.map(l => {
                  const f = formatFollowUp(l.nextFollowUpAt);
                  return (
                    <React.Fragment key={l.id}>
                    <tr {...rowOpen(() => openRow(l))} className={`hover:bg-slate-50/60 focus-visible:bg-indigo-50/50 focus-visible:outline-none ${loading ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={l.name} />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 text-[13px] truncate">{l.name}</div>
                            <div className="text-xs text-slate-500 truncate">{l.company}</div>
                            {l.scopeRow && lscope !== 'MINE' && <LeadOwner row={l.scopeRow} />}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">{l.phone}</td>
                      <td className="px-4 py-3">
                        <ServiceChips codes={l.services} catalog={byCode} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{l.leadSource || '-'}</td>
                      {scope && (
                        <td className="px-4 py-3 text-xs text-slate-700">
                          <div className="font-semibold">{l.createdBy?.fullName || '-'}</div>
                          {l.owner && l.owner.id !== l.createdBy?.id && <div className="text-slate-500">Owner: {l.owner.fullName}</div>}
                        </td>
                      )}
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${f.urgent ? 'text-rose-700 font-bold' : 'text-slate-700'}`}>{f.text}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Pill tone={LEAD_STATUS_TONE[l.leadStatus]}>{LEAD_STATUS_LABEL[l.leadStatus]}</Pill>
                          <WorkflowBadge workflow={l.paymentWorkflow} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" className={btn.secondary} onClick={() => openRow(l)} aria-label={`${scope || (l.scopeRow && !l.scopeRow.isMine) ? 'View' : l.paymentWorkflow === 'PENDING_PAYMENT_CONFIRMATION' ? 'Open' : 'Edit'} lead ${l.name}`}>
                          {scope || (l.scopeRow && !l.scopeRow.isMine) ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}{' '}
                          {scope ? scope.actionLabel || 'View' : l.scopeRow && !l.scopeRow.isMine ? 'View' : l.paymentWorkflow === 'PENDING_PAYMENT_CONFIRMATION' ? 'Open' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                    {rowWithAccounts(l) && (
                      <tr>
                        <td colSpan={scope ? 8 : 7} className="px-4 pb-3 pt-0">
                          <AccountsDetails row={l.scopeRow!} scope={lscope} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} pageSize={10} total={data.total} noun="leads" onPage={setPage} />}
      </Card>
      {viewRow && <ReadOnlyLeadDialog row={viewRow} scope={lscope} onClose={() => setViewRow(null)} serviceNames={viewRow.serviceNames} />}
    </div>
  );
};

/** Website/WhatsApp enquiries not yet taken by anyone in the team. */
const InboundStrip: React.FC<{ onClaimed: (customerId: string) => void }> = ({ onClaimed }) => {
  const [items, setItems] = useState<InboundLead[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    pipelineApi.inbound().then(setItems, err => console.warn('[pipeline] inbound failed', errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  if (!items.length) return null;
  const claim = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const c = await pipelineApi.claimInbound(id);
      notifyPipelineChanged();
      onClaimed(c.id);
    } catch (err) {
      setError(errorMessage(err));
      load();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Inbox className="w-4 h-4 text-indigo-600" /> New enquiries ({items.length})
        <span className="text-xs font-normal text-slate-500">From your website and WhatsApp - take one to add it to your leads.</span>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {items.slice(0, 10).map(l => (
          <li key={l.id} className="shrink-0 w-60 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
            <div className="text-[13px] font-semibold text-slate-900 truncate">{l.name}</div>
            <div className="text-xs text-slate-500 truncate">
              {l.company || 'No business name'} · {l.channel || 'Inbound'}
            </div>
            <button type="button" className={`${btn.secondary} mt-2 w-full`} disabled={busy !== null} onClick={() => claim(l.id)}>
              {busy === l.id ? 'Adding…' : 'Take this lead'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
};

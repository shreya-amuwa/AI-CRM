import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import type {
  ChecklistItem,
  CustomerDocument,
  Paginated,
  PipelineCustomer,
  PipelineCustomerDetail,
  ReviewCounts,
  ReviewFilter,
  ServiceCatalogItem
} from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { documentsApi, pipelineApi } from '../../../lib/api/endpoints';
import {
  Dialog,
  ErrorBanner,
  inputCls,
  longDate,
  money,
  notifyPipelineChanged,
  Pager,
  Spinner,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from '../../team-member/pipeline/shared';
import { ClientLoginCard, HandoverBanner, SendToDepartmentHead } from './HandoverPanel';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
type CardStatus = 'REVIEW_PENDING' | 'NEEDS_ATTENTION' | 'AUTHORIZED' | 'AWAITING' | 'WAITING_ON_SALES' | 'HANDED_OVER';
const STATUS_STYLE: Record<CardStatus, { label: string; cls: string }> = {
  REVIEW_PENDING: { label: 'Review pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEEDS_ATTENTION: { label: 'Needs attention', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  AUTHORIZED: { label: 'Authorized', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  AWAITING: { label: 'Awaiting documents', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  WAITING_ON_SALES: { label: 'Waiting for sales team', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  HANDED_OVER: { label: 'Handed over', cls: 'bg-sky-50 text-sky-700 border-sky-200' }
};

/** Same rules as customer_onboarding.review_state; the consultant's own items (WABA ID) count too. */
function statusOf(o: PipelineCustomer['onboarding']): CardStatus {
  const total = o?.itemsTotal || 0;
  const verified = o?.itemsVerified || 0;
  const consultantPending = (o?.consultantItemsTotal || 0) > (o?.consultantItemsDone || 0);
  // Verified and passed on to the Department Head (and on): the consultant's part is done.
  if (o && o.handoverStage && o.handoverStage !== 'CONSULTANT') return 'HANDED_OVER';
  // Sent back for re-verification: read-only until sales sends it again.
  if (o?.returnedAt) return 'WAITING_ON_SALES';
  if ((o?.itemsRejected || 0) > 0) return 'NEEDS_ATTENTION';
  if (total > 0 && verified >= total) return consultantPending ? 'REVIEW_PENDING' : 'AUTHORIZED';
  if ((o?.itemsSaved || 0) > verified) return 'REVIEW_PENDING';
  return 'AWAITING';
}

const StatusPill: React.FC<{ status: CardStatus; size?: 'sm' | 'md' }> = ({ status, size = 'sm' }) => (
  <span
    className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap ${STATUS_STYLE[status].cls} ${
      size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
    }`}
  >
    {STATUS_STYLE[status].label}
  </span>
);

const Chips: React.FC<{ codes: string[]; catalog: Map<string, ServiceCatalogItem>; max?: number }> = ({ codes, catalog, max = 3 }) => (
  <div className="flex flex-wrap gap-1.5">
    {codes.slice(0, max).map(c => (
      <span key={c} className="px-2 py-1 rounded-md bg-slate-100 text-[11px] font-medium text-slate-700">
        {catalog.get(c)?.name || c}
      </span>
    ))}
    {codes.length > max && (
      <span className="px-2 py-1 rounded-md bg-slate-100 text-[11px] font-medium text-slate-500" title={codes.slice(max).map(c => catalog.get(c)?.name || c).join(', ')}>
        +{codes.length - max}
      </span>
    )}
  </div>
);

const IconTile: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = 'bg-blue-50 text-blue-600' }) => (
  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${className}`} aria-hidden="true">
    {children}
  </span>
);

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso)
        .toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        .replace(/\s?(am|pm)$/i, m => m.toLowerCase())
    : '';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
const TABS: { key: ReviewFilter | ''; label: string; countKey: keyof ReviewCounts }[] = [
  { key: '', label: 'All', countKey: 'all' },
  { key: 'TO_REVIEW', label: 'Review pending', countKey: 'TO_REVIEW' },
  { key: 'NEEDS_FIX', label: 'Needs attention', countKey: 'NEEDS_FIX' },
  { key: 'VERIFIED', label: 'Authorized', countKey: 'VERIFIED' },
  { key: 'WAITING_ON_SALES', label: 'Waiting for sales team', countKey: 'WAITING_ON_SALES' }
];
const PAGE_SIZE = 12;

export const ConsultantCustomerList: React.FC<{ counts: ReviewCounts | null; onOpen: (id: string) => void }> = ({ counts, onOpen }) => {
  const { byCode } = useServiceCatalog();
  const [tab, setTab] = useState<ReviewFilter | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    pipelineApi
      .list({ stage: 'ONBOARDING', review: tab || undefined, search: debounced || undefined, page, pageSize: PAGE_SIZE, sort: 'newest' })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [tab, debounced, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [tab, debounced]);
  usePipelineRealtime(load);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Onboarding Customers</h1>
          <p className="text-sm text-slate-500 mt-1">Review each customer's documents, authorize them, and trigger their onboarding automations.</p>
        </div>
        <label className="relative w-full md:w-72 shrink-0">
          <span className="sr-only">Search customer or business</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer or business"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      <div role="tablist" aria-label="Filter customers" className="flex flex-wrap gap-2">
        {TABS.map(t => {
          const active = tab === t.key;
          const n = counts?.[t.countKey];
          return (
            <button
              key={t.key || 'ALL'}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.label} {n !== undefined && <span className={active ? 'text-blue-100 ml-1' : 'text-slate-400 ml-1'}>{n}</span>}
            </button>
          );
        })}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading customers…" />
      ) : data && data.items.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80">
          {debounced || tab ? 'No customers match.' : 'No customers to verify yet. A customer appears here once the salesperson clicks Send to Technical Consultant.'}
        </div>
      ) : (
        <ul className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {data?.items.map(c => {
            const o = c.onboarding;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-blue-200 hover:shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label={`Open ${c.company || c.name}`}
                >
                  <div className="flex items-start gap-3">
                    <IconTile>
                      <Building2 className="w-5 h-5" />
                    </IconTile>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 truncate">{c.company || c.name}</div>
                      <div className="text-sm text-slate-500 truncate">{c.name}</div>
                    </div>
                    <StatusPill status={statusOf(o)} />
                  </div>
                  {o?.returnedAt && (
                    <p className="mt-3 text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5">
                      Sent back on {longDate(o.returnedAt)} · {o.itemsRejected} item{o.itemsRejected === 1 ? '' : 's'} with sales to fix
                    </p>
                  )}
                  <div className="mt-4">
                    <Chips codes={c.services} catalog={byCode} />
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{money(c.dealAmount)}</span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                      {(o?.itemsVerified || 0) + (o?.consultantItemsDone || 0)}/{(o?.itemsTotal || 0) + (o?.consultantItemsTotal || 0)} docs authorized
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.total > PAGE_SIZE && (
        <div className="bg-white rounded-2xl border border-slate-200/80">
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="customers" onPage={setPage} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export const ConsultantCustomerDetail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const { byCode } = useServiceCatalog();
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [authorizingAll, setAuthorizingAll] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');

  const load = useCallback(() => {
    pipelineApi.get(id).then(
      d => {
        setC(d);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [id]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  if (error && !c) return <ErrorBanner message={error} onRetry={load} />;
  if (!c) return <Spinner label="Loading customer…" />;

  const changed = () => {
    notifyPipelineChanged();
    load();
  };
  const consultantItems = c.checklist.filter(i => i.filledBy === 'CONSULTANT');
  // An optional item sales left empty (e.g. Website URL) is not something to review.
  const salesItems = c.checklist.filter(i => i.filledBy !== 'CONSULTANT' && !(i.optional && !i.entry));
  const pending = salesItems.filter(i => i.entry?.status === 'SAVED').length;
  const rejectedItems = c.checklist.filter(i => i.entry?.status === 'REJECTED');
  /** Sent back for re-verification: visible here, read-only until sales sends it again. */
  const waiting = !!c.onboarding?.returnedAt;
  /** Passed on to the Department Head (or further): the consultant's review is closed. */
  const handedOver = !!c.onboarding && c.onboarding.handoverStage !== 'CONSULTANT';
  const locked = waiting || handedOver;
  const canSend = statusOf(c.onboarding) === 'AUTHORIZED' && !!c.handover?.clientAccount;
  const sendReason = !c.handover?.clientAccount
    ? "Create the client's login first"
    : 'Authorize every document and detail first';

  const sendBack = async () => {
    setSendingBack(true);
    setActionError(null);
    try {
      await pipelineApi.returnToSales(c.id, sendBackNote.trim() || null);
      notifyPipelineChanged();
      setSendBackOpen(false);
      onBack();
    } catch (e) {
      setActionError(errorMessage(e));
      setSendBackOpen(false);
    } finally {
      setSendingBack(false);
    }
  };

  const authorizeAll = async () => {
    setAuthorizingAll(true);
    setActionError(null);
    try {
      await pipelineApi.verifyAll(c.id);
      changed();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setAuthorizingAll(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Onboarding Customers
      </button>

      <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <IconTile className="w-12 h-12 bg-blue-50 text-blue-600">
              <Building2 className="w-6 h-6" />
            </IconTile>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{c.company || c.name}</h1>
              <p className="text-sm text-slate-500">Onboarding since {longDate(c.onboarding?.startedAt)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!locked && (
              <SendToDepartmentHead customerId={c.id} businessName={c.company || c.name} ready={canSend} reason={sendReason} onSent={changed} />
            )}
            <StatusPill status={statusOf(c.onboarding)} size="md" />
          </div>
        </div>
        <dl className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Info icon={<User className="w-4 h-4" />} label="Customer Name" value={c.name} sub={c.phone} />
          <Info icon={<Building2 className="w-4 h-4" />} label="Business Name" value={c.company || '—'} sub={c.email} />
          <div className="flex gap-3">
            <InfoIcon>
              <Briefcase className="w-4 h-4" />
            </InfoIcon>
            <div className="min-w-0">
              <dt className="text-xs text-slate-500">Services</dt>
              <dd className="mt-1">
                <Chips codes={c.services} catalog={byCode} max={6} />
              </dd>
            </div>
          </div>
          <div className="flex gap-3">
            <InfoIcon>
              <IndianRupee className="w-4 h-4" />
            </InfoIcon>
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="text-xl font-bold text-slate-900">{money(c.dealAmount)}</dd>
            </div>
          </div>
        </dl>
      </section>

      {actionError && <ErrorBanner message={actionError} />}

      <HandoverBanner info={c.handover} />

      {waiting && (
        <div className="p-4 rounded-2xl border border-violet-200 bg-violet-50 text-sm text-violet-900" role="status">
          <p className="font-bold">Waiting for sales team</p>
          <p className="mt-0.5 text-xs">
            Sent back to {c.owner?.fullName || 'the salesperson'} on {longDate(c.onboarding?.returnedAt)} for re-verification
            {c.onboarding?.returnNote ? ` — “${c.onboarding.returnNote}”` : ''}. You can authorize again once they fix the items and send it back.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby="docs-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <IconTile className="w-9 h-9 bg-slate-100 text-slate-600">
                <FileText className="w-4 h-4" />
              </IconTile>
              <div>
                <h2 id="docs-heading" className="font-bold text-slate-900">
                  Documents
                </h2>
                <p className="text-xs text-slate-500">Submitted by the customer</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {waiting ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-700 text-xs font-bold cursor-not-allowed"
                >
                  <Clock className="w-4 h-4" aria-hidden="true" /> Waiting for sales team
                </button>
              ) : handedOver ? null : (
              <>
              <button
                type="button"
                onClick={() => setSendBackOpen(true)}
                disabled={rejectedItems.length === 0 || sendingBack}
                title={rejectedItems.length === 0 ? 'Mark at least one item as Not authorized first' : undefined}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-300 bg-white text-rose-700 text-xs font-bold hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Send back for re-verification
              </button>
              <button
                type="button"
                onClick={authorizeAll}
                disabled={pending === 0 || authorizingAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" /> {authorizingAll ? 'Authorizing…' : 'Authorize all'}
              </button>
              </>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            {waiting
              ? `${rejectedItems.length} item${rejectedItems.length === 1 ? '' : 's'} with sales to fix. Each one changes to Pending review as soon as sales fixes it.`
              : rejectedItems.length > 0
              ? `${rejectedItems.length} item${rejectedItems.length === 1 ? '' : 's'} marked Not authorized. Click "Send back for re-verification" to return this customer to the salesperson.`
              : 'Wrong, inappropriate or fake document? Mark it Not authorized with a reason, then send it back to the salesperson for re-verification.'}
          </p>
          {sendBackOpen && (
            <Dialog
              title="Send back to sales for re-verification"
              description={`${c.company || c.name} goes back to ${c.owner?.fullName || 'the salesperson'} with these items to fix. It stays in your list as "Waiting for sales team" until they send it again.`}
              onClose={() => !sendingBack && setSendBackOpen(false)}
            >
              <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                {rejectedItems.map(i => (
                  <li key={i.code} className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-900">
                    <strong>{i.label}</strong>
                    {i.entry?.reviewNote ? ` — ${i.entry.reviewNote}` : ''}
                  </li>
                ))}
              </ul>
              <label className="block text-xs font-medium text-slate-600" htmlFor="send-back-note">
                Message to the salesperson (optional)
              </label>
              <textarea
                id="send-back-note"
                rows={2}
                maxLength={1000}
                className={inputCls}
                value={sendBackNote}
                onChange={e => setSendBackNote(e.target.value)}
                placeholder="e.g. Please collect original documents from the client"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSendBackOpen(false)}
                  disabled={sendingBack}
                  className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={sendBack}
                  disabled={sendingBack}
                  className="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white disabled:opacity-40"
                >
                  {sendingBack ? 'Sending…' : 'Send back to sales'}
                </button>
              </div>
            </Dialog>
          )}
          {consultantItems.length > 0 && (
            <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/40">
              <h3 className="text-sm font-bold text-slate-900">To be filled by you</h3>
              <p className="text-xs text-slate-500">Details only the technical team has, e.g. after creating the customer panel.</p>
              <ul className="mt-3 space-y-3">
                {consultantItems.map(item => (
                  <ConsultantItemRow key={item.code} item={item} customerId={c.id} onChanged={changed} readOnly={locked} />
                ))}
              </ul>
            </div>
          )}
          {salesItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No documents requested for this customer.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {salesItems.map(item => (
                <DocumentRow key={item.code} item={item} customer={c} onChanged={changed} readOnly={locked} />
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <ClientLoginCard customerId={c.id} defaultEmail={c.email} account={c.handover?.clientAccount} locked={waiting || handedOver} onChanged={changed} />
        </div>
      </div>
    </div>
  );
};

const InfoIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 flex items-center justify-center shrink-0" aria-hidden="true">
    {children}
  </span>
);
const Info: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string | null }> = ({ icon, label, value, sub }) => (
  <div className="flex gap-3 min-w-0">
    <InfoIcon>{icon}</InfoIcon>
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-bold text-slate-900 truncate">{value}</dd>
      {sub && <dd className="text-xs text-slate-400 truncate">{sub}</dd>}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// One document / detail row
// ---------------------------------------------------------------------------
const ROW_STATUS = {
  VERIFIED: { label: 'Authorized', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  SAVED: { label: 'Pending review', cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Clock },
  REJECTED: { label: 'Not authorized', cls: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle },
  MISSING: { label: 'Awaiting upload', cls: 'bg-slate-100 text-slate-500 border-slate-200', Icon: Clock }
} as const;

const SECTION_LABEL: Record<ChecklistItem['section'], string> = {
  BUSINESS_BASICS: 'Business basics',
  SERVICE: 'Service requirement',
  MANDATORY_DOCUMENTS: 'Mandatory document'
};

const KIND_LABEL: Record<ChecklistItem['kind'], string> = {
  DETAILS: 'Details provided',
  FILE: 'File',
  YES_NO: 'Answer',
  APPROVAL: 'Approval',
  ACCESS: 'Access given',
  AMOUNT: 'Amount',
  CHOICE: 'Selected option'
};

function formatEntryValue(item: ChecklistItem, value: string | null): string {
  if (value == null || value === '') return '—';
  if (item.kind === 'AMOUNT') return money(Number(value));
  if (value === 'YES') return 'Yes';
  if (value === 'NO') return 'No';
  return value;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** An item the consultant fills in (e.g. WABA ID): saved directly as authorized. */
const ConsultantItemRow: React.FC<{ item: ChecklistItem; customerId: string; onChanged: () => void; readOnly?: boolean }> = ({
  item,
  customerId,
  onChanged,
  readOnly
}) => {
  const [value, setValue] = useState(item.entry?.value || '');
  const [editingState, setEditing] = useState(!item.entry);
  const editing = editingState && !readOnly;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `consultant-${item.code}`;
  const isWaba = item.code === 'WABA_ID';
  const save = async () => {
    if (!value.trim()) return setError('Enter a value.');
    if (isWaba && !/^[0-9]{12,20}$/.test(value.replace(/\s/g, ''))) return setError('WABA ID must be numbers only, at least 12 digits.');
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.saveConsultantItem(customerId, item.code, { value: value.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="p-3 rounded-lg bg-white border border-slate-200">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-bold text-slate-900">
          {item.label}
        </label>
        {item.entry ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Saved
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-50 text-amber-700 border-amber-200">
            <Clock className="w-3 h-3" aria-hidden="true" /> To fill in
          </span>
        )}
      </div>
      {item.hint && <p className="text-xs text-slate-500 mt-0.5">{item.hint}</p>}
      {editing ? (
        <div className="mt-2 flex gap-2">
          <input
            id={inputId}
            className={`${inputCls} py-2`}
            value={value}
            onChange={e => {
              setError(null);
              setValue(isWaba ? e.target.value.replace(/[^0-9]/g, '') : e.target.value);
            }}
            maxLength={isWaba ? 20 : 200}
            inputMode={isWaba ? 'numeric' : undefined}
            placeholder={isWaba ? 'At least 12 digits' : undefined}
            aria-describedby={isWaba ? `${inputId}-rule` : undefined}
          />
          <button type="button" onClick={save} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0">
            {busy ? 'Saving…' : 'Save'}
          </button>
          {item.entry && (
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white shrink-0">
              Cancel
            </button>
          )}
        </div>
      ) : null}
      {editing && isWaba && (
        <p id={`${inputId}-rule`} className="text-[11px] text-slate-500 mt-1">
          Numbers only, at least 12 digits ({value.length} entered).
        </p>
      )}
      {!editing && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-sm font-mono text-slate-800 break-all">{item.entry?.value || '—'}</span>
          {!readOnly && (
            <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0" aria-label={`Edit ${item.label}`}>
              Edit
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
};

const DocumentRow: React.FC<{ item: ChecklistItem; customer: PipelineCustomerDetail; onChanged: () => void; readOnly?: boolean }> = ({
  item,
  customer,
  onChanged,
  readOnly
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const entry = item.entry;
  const state = entry?.status ?? 'MISSING';
  const S = ROW_STATUS[state];
  const isFile = item.kind === 'FILE';
  const doc: CustomerDocument | null = isFile ? customer.documents.find(d => d.id === entry?.documentId) || null : null;
  const value = entry ? formatEntryValue(item, entry.value) : null;
  const sub = isFile
    ? doc
      ? `${doc.originalFileName} • ${fmtDateTime(doc.uploadedAt)}`
      : 'Not uploaded yet'
    : entry
      ? `${value} • ${fmtDateTime(entry.savedAt)}`
      : 'Not filled yet';

  const review = async (decision: 'VERIFIED' | 'REJECTED', note?: string) => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.reviewChecklistItem(customer.id, item.code, { decision, note: note || null });
      setRejecting(false);
      setShowDetails(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const viewDocument = async () => {
    if (!doc) return;
    setError(null);
    const win = window.open('', '_blank');
    try {
      const { url } = await documentsApi.url(doc.id, 'view');
      if (win) {
        win.opener = null;
        win.location.href = url;
      }
    } catch (e) {
      win?.close();
      setError(errorMessage(e));
    }
  };

  return (
    <li className="p-4 rounded-xl border border-slate-200 bg-slate-50/40">
      <div className="flex items-start gap-3">
        <IconTile className="w-9 h-9 bg-white border border-slate-200 text-slate-500">
          <FileText className="w-4 h-4" />
        </IconTile>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">{item.label}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${S.cls}`}>
              <S.Icon className="w-3 h-3" aria-hidden="true" /> {S.label}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>
        </div>
      </div>
      {state === 'REJECTED' && entry?.reviewNote && (
        <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5" role="note">
          Reason: {entry.reviewNote}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowDetails(true);
          }}
          disabled={!entry}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-400"
          aria-label={`View details: ${item.label}`}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> View details
        </button>
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            disabled={readOnly || !entry || busy || state === 'REJECTED'}
            onClick={() => setRejecting(true)}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors disabled:cursor-not-allowed ${
              state === 'REJECTED' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-40'
            }`}
            aria-label={`Not authorized: ${item.label}`}
          >
            Not authorized
          </button>
          <button
            type="button"
            disabled={readOnly || !entry || busy || state === 'VERIFIED' || state === 'REJECTED'}
            onClick={() => review('VERIFIED')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors disabled:cursor-not-allowed ${
              state === 'VERIFIED'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-40'
            }`}
            aria-label={`Authorize ${item.label}`}
          >
            {busy ? '…' : 'Authorize'}
          </button>
        </div>
      </div>
      {showDetails && entry && !rejecting && (
        <Dialog title={item.label} description={item.hint || undefined} onClose={() => setShowDetails(false)}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{SECTION_LABEL[item.section]}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${S.cls}`}>
              <S.Icon className="w-3 h-3" aria-hidden="true" /> {S.label}
            </span>
          </div>

          {isFile ? (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
              {doc ? (
                <>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate-500">File</dt>
                    <dd className="font-semibold text-slate-900 break-all">{doc.originalFileName}</dd>
                    <dt className="text-slate-500">Type</dt>
                    <dd className="text-slate-800">{doc.mimeType}</dd>
                    {doc.sizeBytes != null && (
                      <>
                        <dt className="text-slate-500">Size</dt>
                        <dd className="text-slate-800">{fmtSize(doc.sizeBytes)}</dd>
                      </>
                    )}
                    {doc.version != null && (
                      <>
                        <dt className="text-slate-500">Version</dt>
                        <dd className="text-slate-800">{doc.version}</dd>
                      </>
                    )}
                    <dt className="text-slate-500">Uploaded</dt>
                    <dd className="text-slate-800">
                      {fmtDateTime(doc.uploadedAt)}
                      {doc.uploadedBy ? ` by ${doc.uploadedBy.fullName}` : ''}
                    </dd>
                  </dl>
                  <button
                    type="button"
                    onClick={viewDocument}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open document
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-500">The file is not available.</p>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <div className="text-[11px] font-medium text-slate-500 mb-1">{KIND_LABEL[item.kind]}</div>
              <p className="text-sm text-slate-900 whitespace-pre-line break-words">{value}</p>
            </div>
          )}

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-500">Saved by sales</dt>
            <dd className="text-slate-800">{fmtDateTime(entry.savedAt)}</dd>
            {entry.reviewedAt && (
              <>
                <dt className="text-slate-500">Reviewed</dt>
                <dd className="text-slate-800">{fmtDateTime(entry.reviewedAt)}</dd>
              </>
            )}
          </dl>
          {state === 'REJECTED' && entry.reviewNote && (
            <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5" role="note">
              Reason: {entry.reviewNote}
            </p>
          )}
          {error && <ErrorBanner message={error} />}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={() => setShowDetails(false)} className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700">
              Close
            </button>
            <button
              type="button"
              disabled={readOnly || busy || state === 'REJECTED'}
              onClick={() => setRejecting(true)}
              className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Not authorized
            </button>
            <button
              type="button"
              disabled={readOnly || busy || state === 'VERIFIED' || state === 'REJECTED'}
              onClick={() => review('VERIFIED')}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : state === 'VERIFIED' ? 'Authorized' : 'Authorize'}
            </button>
          </div>
        </Dialog>
      )}
      {rejecting && <RejectDialog label={item.label} busy={busy} onClose={() => setRejecting(false)} onConfirm={note => review('REJECTED', note)} />}
    </li>
  );
};

const RejectDialog: React.FC<{ label: string; busy: boolean; onClose: () => void; onConfirm: (note: string) => void }> = ({ label, busy, onClose, onConfirm }) => {
  const [note, setNote] = useState('');
  return (
    <Dialog title={`Not authorized: ${label}`} description="The salesperson sees this reason when you send the customer back for re-verification." onClose={onClose}>
      <label className="block text-xs font-medium text-slate-600" htmlFor="reject-reason">
        Reason
      </label>
      <textarea id="reject-reason" rows={3} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. The certificate is blurred" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => onConfirm(note.trim())}
          className="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Mark not authorized'}
        </button>
      </div>
    </Dialog>
  );
};

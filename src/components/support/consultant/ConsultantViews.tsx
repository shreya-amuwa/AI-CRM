import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  IndianRupee,
  Mail,
  MessageCircle,
  PhoneCall,
  Search,
  ShieldCheck,
  FileSpreadsheet,
  User,
  XCircle,
  Zap
} from 'lucide-react';
import type {
  AutomationCode,
  AutomationStatus,
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

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
type CardStatus = 'REVIEW_PENDING' | 'NEEDS_ATTENTION' | 'AUTHORIZED' | 'AWAITING';
const STATUS_STYLE: Record<CardStatus, { label: string; cls: string }> = {
  REVIEW_PENDING: { label: 'Review pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEEDS_ATTENTION: { label: 'Needs attention', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  AUTHORIZED: { label: 'Authorized', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  AWAITING: { label: 'Awaiting documents', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
};

function statusOf(o: PipelineCustomer['onboarding']): CardStatus {
  const total = o?.itemsTotal || 0;
  const verified = o?.itemsVerified || 0;
  if ((o?.itemsRejected || 0) > 0) return 'NEEDS_ATTENTION';
  if (total > 0 && verified >= total) return 'AUTHORIZED';
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
  { key: 'VERIFIED', label: 'Authorized', countKey: 'VERIFIED' }
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
                  <div className="mt-4">
                    <Chips codes={c.services} catalog={byCode} />
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{money(c.dealAmount)}</span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                      {o?.itemsVerified || 0}/{o?.itemsTotal || 0} docs authorized
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
  const pending = c.checklist.filter(i => i.entry?.status === 'SAVED').length;

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
          <StatusPill status={statusOf(c.onboarding)} size="md" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby="docs-heading">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
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
            <button
              type="button"
              onClick={authorizeAll}
              disabled={pending === 0 || authorizingAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" aria-hidden="true" /> {authorizingAll ? 'Authorizing…' : 'Authorize all'}
            </button>
          </div>
          {c.checklist.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No documents requested for this customer.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {c.checklist.map(item => (
                <DocumentRow key={item.code} item={item} customer={c} onChanged={changed} />
              ))}
            </ul>
          )}
        </section>

        <AutomationsCard customerId={c.id} />
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

const DocumentRow: React.FC<{ item: ChecklistItem; customer: PipelineCustomerDetail; onChanged: () => void }> = ({ item, customer, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const entry = item.entry;
  const state = entry?.status ?? 'MISSING';
  const S = ROW_STATUS[state];
  const isFile = item.kind === 'FILE';
  const doc: CustomerDocument | null = isFile ? customer.documents.find(d => d.id === entry?.documentId) || null : null;
  const sub = isFile
    ? doc
      ? `${doc.originalFileName} • ${fmtDateTime(doc.uploadedAt)}`
      : 'Not uploaded yet'
    : entry
      ? `${item.kind === 'AMOUNT' ? money(Number(entry.value)) : entry.value === 'YES' ? 'Yes' : entry.value === 'NO' ? 'No' : entry.value} • ${fmtDateTime(entry.savedAt)}`
      : 'Not filled yet';

  const review = async (decision: 'VERIFIED' | 'REJECTED', note?: string) => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.reviewChecklistItem(customer.id, item.code, { decision, note: note || null });
      setRejecting(false);
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
          <p className={`text-xs text-slate-500 mt-0.5 ${showValue ? 'whitespace-pre-line break-words' : 'truncate'}`}>{sub}</p>
        </div>
      </div>
      {state === 'REJECTED' && entry?.reviewNote && (
        <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5" role="note">
          Sent back: {entry.reviewNote}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {isFile ? (
          <button
            type="button"
            onClick={viewDocument}
            disabled={!doc}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-400"
            aria-label={`View ${item.label}`}
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> View document
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowValue(v => !v)}
            disabled={!entry}
            aria-expanded={showValue}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-400"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> {showValue ? 'Hide details' : 'View details'}
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            disabled={!entry || busy || state === 'REJECTED'}
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
            disabled={!entry || busy || state === 'VERIFIED' || state === 'REJECTED'}
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
      {rejecting && <RejectDialog label={item.label} busy={busy} onClose={() => setRejecting(false)} onConfirm={note => review('REJECTED', note)} />}
    </li>
  );
};

const RejectDialog: React.FC<{ label: string; busy: boolean; onClose: () => void; onConfirm: (note: string) => void }> = ({ label, busy, onClose, onConfirm }) => {
  const [note, setNote] = useState('');
  return (
    <Dialog title={`Not authorized: ${label}`} description="The salesperson is notified and sees your reason on this document." onClose={onClose}>
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

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------
const AUTOMATION_UI: Record<AutomationCode, { title: string; desc: string; icon: React.ReactNode; tile: string; btn: string }> = {
  EMAIL: {
    title: 'Email Automation',
    desc: 'Send the onboarding email sequence to the customer.',
    icon: <Mail className="w-5 h-5" />,
    tile: 'bg-blue-50 text-blue-600',
    btn: 'bg-blue-600 hover:bg-blue-700'
  },
  WHATSAPP: {
    title: 'WhatsApp Automation',
    desc: 'Send onboarding messages on WhatsApp.',
    icon: <MessageCircle className="w-5 h-5" />,
    tile: 'bg-emerald-50 text-emerald-600',
    btn: 'bg-emerald-600 hover:bg-emerald-700'
  },
  AI_CALLING: {
    title: 'AI Calling',
    desc: 'Place an AI onboarding call to the customer.',
    icon: <PhoneCall className="w-5 h-5" />,
    tile: 'bg-violet-50 text-violet-600',
    btn: 'bg-violet-600 hover:bg-violet-700'
  }
};

const AutomationsCard: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [items, setItems] = useState<AutomationStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    pipelineApi.automations(customerId).then(setItems, e => setError(errorMessage(e)));
  }, [customerId]);
  useEffect(load, [load]);

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby="automations-heading">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <IconTile className="w-9 h-9 bg-amber-50 text-amber-500">
          <Zap className="w-4 h-4" />
        </IconTile>
        <div>
          <h2 id="automations-heading" className="font-bold text-slate-900">
            Automations
          </h2>
          <p className="text-xs text-slate-500">Each automation runs from its connected Google Sheet</p>
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}
      {!items && !error ? (
        <Spinner label="Loading automations…" />
      ) : (
        <ul className="mt-4 space-y-3">
          {items?.map(a => (
            <AutomationRow key={a.code} customerId={customerId} status={a} onDone={next => setItems(list => list?.map(x => (x.code === next.code ? next : x)) || null)} onRefresh={load} />
          ))}
        </ul>
      )}
    </section>
  );
};

const AutomationRow: React.FC<{
  customerId: string;
  status: AutomationStatus;
  onDone: (s: AutomationStatus) => void;
  onRefresh: () => void;
}> = ({ customerId, status, onDone, onRefresh }) => {
  const ui = AUTOMATION_UI[status.code];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = status.lastRun;

  const trigger = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await pipelineApi.triggerAutomation(customerId, status.code));
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="p-4 rounded-xl border border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <IconTile className={`w-10 h-10 ${ui.tile}`}>{ui.icon}</IconTile>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{ui.title}</h3>
            <p className="text-xs text-slate-500">{ui.desc}</p>
          </div>
        </div>
        {confirming ? (
          <div className="flex gap-2 sm:ml-auto self-end sm:self-auto">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={trigger} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Running…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!status.connected}
            title={status.connected ? undefined : 'Connect a Google Sheet to enable this automation'}
            className={`sm:ml-auto self-end sm:self-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ui.btn}`}
            aria-label={`Trigger ${ui.title}`}
          >
            <Zap className="w-4 h-4" aria-hidden="true" /> Trigger
          </button>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 ${status.connected ? 'text-emerald-700' : 'text-slate-400'}`}>
          <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
          {status.connected ? 'Google Sheet connected' : 'Google Sheet not connected'}
        </span>
        <span className={run?.status === 'FAILED' ? 'text-rose-600' : 'text-slate-400'}>
          {run
            ? `${run.status === 'SENT' ? 'Sent' : run.status === 'FAILED' ? 'Failed' : 'Running'} · ${fmtDateTime(run.triggeredAt)}${run.triggeredBy ? ` · ${run.triggeredBy}` : ''}`
            : 'Never run'}
        </span>
      </div>
    </li>
  );
};

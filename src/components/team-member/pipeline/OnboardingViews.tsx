import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Download,
  Eye,
  FileText,
  HelpCircle,
  History,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import type {
  CustomerDocument,
  DocumentType,
  OnboardingFilter,
  OnboardingStage,
  Paginated,
  PipelineCounts,
  PipelineCustomer,
  PipelineCustomerDetail
} from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { documentsApi, pipelineApi, type PipelineQuery } from '../../../lib/api/endpoints';
import { requireSupabase } from '../../../services/supabaseClient';
import { ActivityCard } from './LeadForms';
import {
  Avatar,
  btn,
  Card,
  Dialog,
  ErrorBanner,
  inputCls,
  longDate,
  money,
  notifyPipelineChanged,
  PAYMENT_METHOD_LABEL,
  Pager,
  Pill,
  selectCls,
  ServiceChips,
  shortDate,
  Spinner,
  todayIso,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog,
  type Tone
} from './shared';

const ONBOARDING_STATE: Record<OnboardingFilter, { label: string; tone: Tone }> = {
  COLLECTING: { label: 'Collecting', tone: 'indigo' },
  WAITING_ON_CLIENT: { label: 'Waiting on client', tone: 'orange' },
  READY_FOR_HANDOVER: { label: 'Ready for handover', tone: 'green' }
};
const onboardingState = (saved: number, total: number): OnboardingFilter =>
  saved >= total ? 'READY_FOR_HANDOVER' : saved === 0 ? 'WAITING_ON_CLIENT' : 'COLLECTING';

// ---------------------------------------------------------------------------
// 3 · Customer onboarding (list)
// ---------------------------------------------------------------------------
export const OnboardingListView: React.FC<{ counts: PipelineCounts | null; onOpen: (id: string) => void }> = ({ counts, onOpen }) => {
  const { items: services, byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [sort, setSort] = useState<PipelineQuery['sort']>('newest');
  const [filter, setFilter] = useState<'' | OnboardingFilter>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seqRef = useRef(0);
  const total = counts?.mandatoryDocuments ?? 2;

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    pipelineApi
      .list({ stage: 'ONBOARDING', page, pageSize, search: debounced || undefined, service: service || undefined, onboarding: filter || undefined, sort })
      .then(
        r => seq === seqRef.current && setData(r),
        e => seq === seqRef.current && setError(errorMessage(e))
      )
      .finally(() => seq === seqRef.current && setLoading(false));
  }, [page, pageSize, debounced, service, filter, sort]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, service, filter, sort, pageSize]);
  usePipelineRealtime(load);

  const tabs: ('' | OnboardingFilter)[] = ['', 'COLLECTING', 'WAITING_ON_CLIENT', 'READY_FOR_HANDOVER'];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">Pipeline / Customer onboarding</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Customer onboarding</h1>
        <p className="text-sm text-slate-500 mt-0.5">Paid customers waiting for documents. Open a customer to run their onboarding.</p>
      </div>

      <Card className="p-4 flex flex-col lg:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search onboarding customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by business, contact, phone or service"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </label>
        <select aria-label="Filter by service" className={selectCls} value={service} onChange={e => setService(e.target.value)}>
          <option value="">All services</option>
          {services.map(s => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className={selectCls} value={sort} onChange={e => setSort(e.target.value as PipelineQuery['sort'])}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Business name</option>
        </select>
      </Card>

      <div role="tablist" aria-label="Onboarding status" className="flex flex-wrap gap-1.5">
        {tabs.map(t => {
          const active = filter === t;
          const n = counts ? (t ? counts.onboarding[t] : counts.onboarding.all) : null;
          return (
            <button
              key={t || 'ALL'}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {t ? ONBOARDING_STATE[t].label : 'All'} {n !== null && <span className={active ? 'text-slate-300' : 'text-slate-400'}>{n}</span>}
            </button>
          );
        })}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading onboarding customers…" />
      ) : data && data.items.length === 0 ? (
        <Card className="py-12 text-center text-sm text-slate-500">
          {filter || debounced || service ? 'No customers match these filters.' : 'No customers in onboarding yet. Confirm a payment in Potential to start.'}
        </Card>
      ) : (
        <ul className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {data?.items.map(c => {
            const saved = c.onboarding?.mandatorySaved ?? 0;
            const st = onboardingState(saved, total);
            const done = saved >= total;
            return (
              <li key={c.id}>
                <Card className="p-4 h-full flex flex-col">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.company || c.name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 text-sm">{c.company || c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.name}
                        {c.city ? ` · ${c.city}` : ''}
                      </div>
                    </div>
                    <Pill tone={ONBOARDING_STATE[st].tone}>{ONBOARDING_STATE[st].label}</Pill>
                  </div>
                  <div className="mt-3">
                    <ServiceChips codes={c.services} catalog={byCode} max={3} />
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-slate-600">Documents</span>
                    <span className="font-bold text-slate-900">
                      {saved} of {total}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"
                    role="progressbar"
                    aria-label={`Documents saved for ${c.company || c.name}`}
                    aria-valuenow={saved}
                    aria-valuemin={0}
                    aria-valuemax={total}
                  >
                    <div className={`h-full ${done ? 'bg-emerald-600' : 'bg-indigo-500'}`} style={{ width: `${(saved / total) * 100}%` }} />
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100 mt-4 text-xs text-slate-500">
                    <span>
                      Paid {money(c.amountReceived)} · started {c.onboarding ? shortDate(c.onboarding.startedAt) : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                      aria-label={`Open onboarding for ${c.company || c.name}`}
                    >
                      Open <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.total > 0 && (
        <Card>
          <Pager page={page} pageSize={pageSize} total={data.total} noun="customers" onPage={setPage} onPageSize={setPageSize} sizes={[9, 18, 36]} />
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3b · Onboarding — one customer
// ---------------------------------------------------------------------------
const STAGES: { key: OnboardingStage; label: string; hint: string }[] = [
  { key: 'SALES_CONSULTATION', label: 'Sales consultation', hint: 'Done when payment is confirmed' },
  { key: 'COLLECT_REQUIREMENTS', label: 'Collect requirements', hint: 'Mandatory documents' },
  { key: 'SETUP', label: 'Setup & configuration', hint: 'Support team' },
  { key: 'APPROVAL', label: 'Approval & testing', hint: 'Client sign-off' },
  { key: 'HANDOVER', label: 'Client handover', hint: 'Forward to support' }
];

export const OnboardingCustomerView: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const { byCode } = useServiceCatalog();
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<'all' | 'pending' | 'saved'>('all');
  const [forwarding, setForwarding] = useState(false);
  const [editingHandover, setEditingHandover] = useState(false);

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
  if (!c) return <Spinner label="Loading onboarding…" />;

  const types = c.documentTypes.filter(t => t.isMandatory);
  const current = (code: string) => c.documents.find(d => d.documentType === code && d.status === 'UPLOADED') || null;
  const savedTypes = types.filter(t => current(t.code));
  const missing = types.filter(t => !current(t.code));
  const pct = types.length ? Math.round((savedTypes.length / types.length) * 100) : 0;
  const forwarded = !!c.onboarding?.forwardedToSupportAt;
  const stageIndex = STAGES.findIndex(s => s.key === (c.onboarding?.stage === 'COMPLETED' ? 'HANDOVER' : c.onboarding?.stage));
  const phoneDigits = (c.whatsapp || c.phone || '').replace(/\D/g, '');
  const visibleTypes = types.filter(t => (tab === 'all' ? true : tab === 'saved' ? !!current(t.code) : !current(t.code)));

  const forward = async () => {
    setForwarding(true);
    setActionError(null);
    try {
      await pipelineApi.forwardToSupport(c.id);
      notifyPipelineChanged();
      load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setForwarding(false);
    }
  };

  const askOnWhatsApp = () => {
    const list = missing.map((t, i) => `${i + 1}. ${t.label}`).join('\n');
    const text = `Hello ${c.name}, to complete your onboarding with us please share the following as PDF:\n${list}\nThank you!`;
    window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className={btn.secondary}>
          <ArrowLeft className="w-3.5 h-3.5" /> All onboarding customers
        </button>
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
          Pipeline / Customer onboarding / <span aria-current="page">{c.company || c.name}</span>
        </nav>
      </div>

      <Card className="p-5 flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={c.company || c.name} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{c.company || c.name}</h1>
            <div className="text-xs text-slate-500 mt-0.5">
              {[c.name, c.phone, c.city].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-2">
              <ServiceChips codes={c.services} catalog={byCode} max={6} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <InfoTile label="Payment" value={`${money(c.amountReceived)}${c.onboarding?.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[c.onboarding.paymentMethod]}` : ''}`} />
          <InfoTile label="Sales owner" value={c.owner?.fullName || '—'} />
          <InfoTile label="Started" value={longDate(c.onboarding?.startedAt)} />
          <div className="px-3 py-2 rounded-xl border border-slate-200">
            <dt className="text-[11px] text-slate-500">Target handover</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">
              {editingHandover ? (
                <HandoverEditor
                  customerId={c.id}
                  value={c.onboarding?.targetHandoverDate || ''}
                  onDone={() => {
                    setEditingHandover(false);
                    load();
                  }}
                />
              ) : (
                <button type="button" className="underline decoration-dotted hover:text-indigo-700" onClick={() => setEditingHandover(true)}>
                  {c.onboarding?.targetHandoverDate ? longDate(c.onboarding.targetHandoverDate) : 'Set date'}
                </button>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {actionError && <ErrorBanner message={actionError} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Documents &amp; details</h2>
              <p className="text-xs text-slate-500">Required to complete this customer's onboarding</p>
            </div>
            <div role="tablist" aria-label="Show documents" className="flex p-1 rounded-xl bg-slate-100 text-xs font-semibold">
              {(
                [
                  ['all', `All ${types.length}`],
                  ['pending', `Pending ${missing.length}`],
                  ['saved', `Saved ${savedTypes.length}`]
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  type="button"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-lg ${tab === k ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mandatory Documents — always the last section of this panel. */}
          <section aria-labelledby="mandatory-docs-heading" className="mt-6">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <span className="w-2 h-2 rounded-full bg-indigo-600" aria-hidden="true" />
              <h3 id="mandatory-docs-heading" className="text-sm font-bold text-slate-900">
                Mandatory Documents
              </h3>
              <span className="text-xs text-slate-500">
                {savedTypes.length} of {types.length} saved
              </span>
            </div>
            {visibleTypes.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 text-center">{tab === 'saved' ? 'Nothing saved yet.' : 'All mandatory documents are saved.'}</p>
            ) : (
              <ol className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {visibleTypes.map(t => (
                  <DocumentCard
                    key={t.code}
                    index={types.indexOf(t) + 1}
                    type={t}
                    customerId={c.id}
                    current={current(t.code)}
                    history={c.documents.filter(d => d.documentType === t.code && d.status === 'SUPERSEDED')}
                    locked={forwarded}
                    onChanged={() => {
                      notifyPipelineChanged();
                      load();
                    }}
                  />
                ))}
              </ol>
            )}
          </section>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 text-center">
            <ProgressRing pct={pct} label={`${savedTypes.length} of ${types.length} saved`} />
            {forwarded ? (
              <>
                <div className="mt-3 text-sm font-bold text-emerald-700">Forwarded to support</div>
                <p className="text-xs text-slate-500">on {longDate(c.onboarding?.forwardedToSupportAt)}</p>
              </>
            ) : (
              <>
                <div className="mt-3 text-sm font-bold text-slate-900">
                  {missing.length === 0 ? 'All items saved' : `${missing.length} item${missing.length === 1 ? '' : 's'} still needed`}
                </div>
                {missing.length > 0 && <p className="text-xs text-slate-500">{missing.map(m => m.label).join(', ')}</p>}
              </>
            )}
            <div className="mt-4 space-y-2">
              <button type="button" className={`${btn.primary} w-full py-2.5`} onClick={askOnWhatsApp} disabled={!phoneDigits || missing.length === 0}>
                <MessageCircle className="w-4 h-4" /> Ask client on WhatsApp
              </button>
              <button
                type="button"
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors ${
                  missing.length === 0 && !forwarded ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-slate-100 text-slate-500 cursor-not-allowed'
                }`}
                disabled={missing.length > 0 || forwarded || forwarding}
                aria-describedby="forward-hint"
                onClick={forward}
              >
                {forwarding ? 'Forwarding…' : forwarded ? 'Forwarded to support team' : 'Forward to support team'}
              </button>
              <p id="forward-hint" className="text-[11px] text-slate-500">
                {forwarded ? 'Current documents are locked; upload a replacement if needed.' : 'Unlocks when all items are saved'}
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Onboarding stage</h2>
            <ol className="space-y-0">
              {STAGES.map((s, i) => {
                const done = i < stageIndex || c.onboarding?.stage === 'COMPLETED';
                const now = i === stageIndex && c.onboarding?.stage !== 'COMPLETED';
                return (
                  <li key={s.key} className="flex gap-3" aria-current={now ? 'step' : undefined}>
                    <div className="flex flex-col items-center">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                          done ? 'bg-emerald-700 text-white' : now ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-400'
                        }`}
                      >
                        {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      {i < STAGES.length - 1 && <span className={`w-0.5 flex-1 min-h-4 ${done ? 'bg-emerald-700' : 'bg-slate-200'}`} />}
                    </div>
                    <div className="pb-3">
                      <div className={`text-xs ${now || done ? 'font-bold text-slate-900' : 'font-semibold text-slate-600'}`}>{s.label}</div>
                      <div className="text-[11px] text-slate-500">
                        {s.key === 'COLLECT_REQUIREMENTS' && now ? `In progress · ${savedTypes.length} of ${types.length}` : s.hint}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <ActivityCard
            activities={c.activities}
            footer={
              <div className="mt-4 flex gap-2 p-3 rounded-xl bg-indigo-50/60 text-[11px] text-slate-600">
                <Database className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden="true" />
                Every file is stored on this customer's record with who added it and when.
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
};

const InfoTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-xl border border-slate-200">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="font-semibold text-slate-900 mt-0.5">{value}</dd>
  </div>
);

const HandoverEditor: React.FC<{ customerId: string; value: string; onDone: () => void }> = ({ customerId, value, onDone }) => {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await pipelineApi.updateOnboarding(customerId, { targetHandoverDate: v || null });
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <input type="date" aria-label="Target handover date" min={todayIso()} className={`${inputCls} py-1 text-xs`} value={v} onChange={e => setV(e.target.value)} />
      <div className="flex gap-1">
        <button type="button" className={`${btn.primary} px-2 py-1`} onClick={save} disabled={busy}>
          Save
        </button>
        <button type="button" className={`${btn.secondary} px-2 py-1`} onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
    </div>
  );
};

const ProgressRing: React.FC<{ pct: number; label: string }> = ({ pct, label }) => {
  const r = 42;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative w-28 h-28 mx-auto" role="img" aria-label={`${pct}% — ${label}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E2E8F0" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={pct >= 100 ? '#047857' : '#5B5BD6'}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-900">{pct}%</span>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Document card: upload / view / download / replace / delete + versions
// ---------------------------------------------------------------------------

/** Reads the first bytes: a real PDF starts with "%PDF-" whatever its name. */
async function looksLikePdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.includes('%PDF-');
}

const fmtSize = (n: number | null) => (n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

const DocumentCard: React.FC<{
  index: number;
  type: DocumentType;
  customerId: string;
  current: CustomerDocument | null;
  history: CustomerDocument[];
  locked: boolean;
  onChanged: () => void;
}> = ({ index, type, customerId, current, history, locked, onChanged }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<null | 'checking' | 'uploading' | 'verifying'>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerDocument | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busy = phase !== null;
  const maxMb = Math.round(type.maxSizeBytes / 1048576);

  const upload = async (file: File) => {
    setError(null);
    if (file.size === 0) return setError('This file is empty.');
    if (file.size > type.maxSizeBytes) return setError(`The file is larger than ${maxMb} MB. Please compress it and try again.`);
    setPhase('checking');
    if (!(await looksLikePdf(file))) {
      setPhase(null);
      return setError('Only a single PDF file is accepted. Please combine the documents into one PDF.');
    }
    let documentId: string | null = null;
    try {
      const ticket = await documentsApi.beginUpload(customerId, {
        documentType: type.code,
        fileName: file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: file.size
      });
      documentId = ticket.document.id;
      setPhase('uploading');
      const { error: upErr } = await requireSupabase()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, await file.arrayBuffer(), { contentType: 'application/pdf', upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      setPhase('verifying');
      await documentsApi.complete(documentId);
      documentId = null;
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      // Tell the server the attempt failed so no half-finished file is kept.
      if (documentId) await documentsApi.abort(documentId).catch(() => undefined);
    } finally {
      setPhase(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async (doc: CustomerDocument, action: 'view' | 'download') => {
    setError(null);
    setOpening(`${doc.id}:${action}`);
    // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
    const win = action === 'view' ? window.open('', '_blank') : null;
    try {
      const { url } = await documentsApi.url(doc.id, action);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        a.click();
      }
    } catch (e) {
      win?.close();
      setError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  const phaseLabel = { checking: 'Checking file…', uploading: 'Uploading…', verifying: 'Verifying PDF…' } as const;

  return (
    <li
      className={`p-4 rounded-2xl border ${current ? 'border-slate-200 bg-white' : 'border-dashed border-indigo-200 bg-indigo-50/30'} ${dragging ? 'ring-2 ring-indigo-400' : ''}`}
      onDragOver={e => {
        if (busy) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        const files = e.dataTransfer.files;
        if (busy || !files.length) return;
        if (files.length > 1) return setError('Drop a single PDF file.');
        void upload(files[0]);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${current ? 'bg-indigo-50 text-indigo-600' : 'bg-indigo-100/70 text-indigo-600'}`} aria-hidden="true">
          {current ? <FileText className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
        </span>
        {current ? <Pill tone="green">Saved</Pill> : <Pill tone="orange">Pending</Pill>}
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <h4 className="text-sm font-bold text-slate-900">
          {index}. {type.label}
        </h4>
        {type.code === 'IMPORTANT_DOCUMENTS' && <InfoTip text={type.description} />}
      </div>
      <p className="text-xs text-slate-500 mt-0.5 break-all">
        {current
          ? `${current.originalFileName} · ${fmtSize(current.sizeBytes)} · ${shortDate(current.uploadedAt)}${current.uploadedBy ? ` · ${current.uploadedBy.fullName}` : ''}`
          : `Single PDF, up to ${maxMb} MB. Drop the file here or upload.`}
      </p>
      {current && current.version !== null && current.version > 1 && <p className="text-[11px] text-slate-400">Version {current.version}</p>}

      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-slate-500">FILE · PDF</span>
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          {busy ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {phaseLabel[phase!]}
            </span>
          ) : current ? (
            <>
              <button type="button" className={btn.secondary} onClick={() => open(current, 'view')} disabled={opening !== null} aria-label={`View ${type.label}`}>
                <Eye className="w-3.5 h-3.5" /> View
              </button>
              <button
                type="button"
                className={btn.secondary}
                onClick={() => open(current, 'download')}
                disabled={opening !== null}
                aria-label={`Download ${type.label}`}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button type="button" className={btn.secondary} onClick={() => inputRef.current?.click()} aria-label={`Replace ${type.label}`}>
                <RefreshCw className="w-3.5 h-3.5" /> Replace
              </button>
              {!locked && (
                <button type="button" className={btn.danger} onClick={() => setConfirmDelete(current)} aria-label={`Delete ${type.label}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          ) : (
            <button type="button" className={btn.primary} onClick={() => inputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(v => !v)}
          >
            <History className="w-3.5 h-3.5" /> Previous versions ({history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5">
              {history.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span className="truncate">
                    v{d.version} · {d.originalFileName} · {shortDate(d.uploadedAt)}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="underline" onClick={() => open(d, 'view')}>
                      View
                    </button>
                    <button type="button" className="underline text-rose-700" onClick={() => setConfirmDelete(d)}>
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmDelete && (
        <DeleteDialog
          doc={confirmDelete}
          label={type.label}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => {
            setConfirmDelete(null);
            onChanged();
          }}
        />
      )}
    </li>
  );
};

const DeleteDialog: React.FC<{ doc: CustomerDocument; label: string; onClose: () => void; onDeleted: () => void }> = ({ doc, label, onClose, onDeleted }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={`Delete ${label}?`}
      description={`${doc.originalFileName}${doc.version ? ` (version ${doc.version})` : ''} will be removed from this customer's record. This is logged and cannot be undone.`}
      onClose={onClose}
    >
      {err && <ErrorBanner message={err} />}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await documentsApi.remove(doc.id);
              onDeleted();
            } catch (e) {
              setErr(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Dialog>
  );
};

/** Small "?" help button; tooltip shows on hover and keyboard focus, Escape hides it. */
const InfoTip: React.FC<{ text: string }> = ({ text }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="What should be in this PDF?"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        className="w-5 h-5 rounded-full text-slate-500 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 inline-flex items-center justify-center"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 max-w-[80vw] p-2.5 rounded-lg bg-slate-900 text-white text-[11px] leading-snug font-normal shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
};

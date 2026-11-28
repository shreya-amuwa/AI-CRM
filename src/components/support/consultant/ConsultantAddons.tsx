import { rowOpen } from '../../../lib/rowClick';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FolderOpen, Search, Send } from 'lucide-react';
import type { AddonRequest, ChecklistItem, CustomerOnboarding, Paginated, PipelineCustomer, PipelineCustomerDetail } from '../../../../shared/contracts';
import { addonsApi, pipelineApi } from '../../../lib/api/endpoints';
import { ChecklistPanel } from '../../team-member/pipeline/ChecklistPanel';
import {
  btn,
  Dialog,
  ErrorBanner,
  notifyPipelineChanged,
  Pager,
  Pill,
  selectCls,
  Spinner,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from '../../team-member/pipeline/shared';
import { addonPaymentState, AddonStatusPill, rupees } from '../../invoices/invoiceShared';
import { AddonRequestEditor } from './AddonRequestPanel';
import { OpenClientRequests } from './ClientServiceRequests';
import { ConsultationNotes } from './ConsultationNotes';
import { toast } from '../../feedback/AppFeedback';
import { userMessage } from '../../../lib/feedback/errors';

const PAGE_SIZE = 10;
type Sort = 'newest' | 'oldest' | 'name';

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/** Where the add-on documents stand, from the counts the database keeps. */
export function addonStatus(o: CustomerOnboarding | null): { label: string; tone: 'green' | 'red' | 'indigo' | 'orange' | 'slate' } {
  if (!o) return { label: '-', tone: 'slate' };
  const { addonItemsTotal: total, addonItemsSaved: saved, addonItemsVerified: verified, addonItemsRejected: rejected } = o;
  if (total === 0) return { label: 'No documents required', tone: 'slate' };
  if (rejected > 0) return { label: 'Needs fix', tone: 'red' };
  if (verified >= total) return { label: 'Verified', tone: 'green' };
  if (saved >= total) return { label: 'Ready to verify', tone: 'indigo' };
  return { label: 'Collecting documents', tone: 'orange' };
}

/** Add-on documents are collected only once Accounts has confirmed the add-on payment. */
const COLLECTING = ['IN_PROGRESS', 'COMPLETED'];

/** The customer's add-on request (services, prices, invoice, payment) for one row. */
function useAddonRequest(customerId: string, version: string | null | undefined) {
  const [req, setReq] = useState<AddonRequest | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    addonsApi.request(customerId).then(
      r => live && setReq(r),
      () => live && setReq(null)
    );
    return () => {
      live = false;
    };
  }, [customerId, version]);
  return req;
}

/**
 * Technical Consultant: "Add-ons Services". Customers with an add-on request: the services and the
 * agreed prices, Accounts' verification, the invoice and payment, and - once the payment is confirmed -
 * the add-on documents. Original onboarding continues separately and is never blocked by add-ons.
 */
export const ConsultantAddons: React.FC<{ onCountsChanged: () => void; onGoToOnboarding: () => void }> = ({ onCountsChanged, onGoToOnboarding }) => {
  const { byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    pipelineApi
      .list({ stage: 'ONBOARDING', addons: true, search: debounced || undefined, page, pageSize: PAGE_SIZE, sort })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(userMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [debounced, page, sort]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, sort]);
  usePipelineRealtime(load);

  const sendToOnboarding = async (c: PipelineCustomer) => {
    setError(null);
    try {
      await pipelineApi.consultantStartOnboarding(c.id);
      toast.success(`${c.company || c.name} was sent for onboarding.`);
      notifyPipelineChanged();
      onCountsChanged();
      load();
    } catch (e) {
      setError(userMessage(e));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Add-ons Services</h1>
          <p className="text-sm text-slate-500 mt-1">Add-ons priced for each customer, checked by Accounts, invoiced and paid. Collect the add-on documents once the payment is confirmed.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <label className="relative w-full sm:w-64">
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
          <select aria-label="Sort add-on customers" value={sort} onChange={e => setSort(e.target.value as Sort)} className={selectCls}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Business name</option>
          </select>
        </div>
      </div>

      <OpenClientRequests onOpenCustomer={setOpenId} />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <Spinner label="Loading add-on customers…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="text-sm font-bold text-slate-800">{debounced ? 'No customer matches your search' : 'No customers in Add-ons Services'}</div>
          <p className="text-xs text-slate-500 mt-1">
            {debounced ? 'Try a different name or business.' : 'In Customers, answer Yes for add-on services, enter the add-ons and their prices, and save or submit them for Accounts Verification.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm min-w-[64rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Add-on services</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Verification</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Invoice &amp; payment</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Documents</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data?.items.map(c => (
                  <AddonRow key={c.id} customer={c} onOpen={() => setOpenId(c.id)} onSendToOnboarding={() => void sendToOnboarding(c)} />
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > PAGE_SIZE && (
            <div className="border-t border-slate-100">
              <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="customers" onPage={setPage} />
            </div>
          )}
        </div>
      )}

      {openId && <AddonDetailsDialog id={openId} serviceName={code => byCode.get(code)?.name || code} onClose={() => setOpenId(null)} onChanged={() => { onCountsChanged(); load(); }} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
const AddonRow: React.FC<{ customer: PipelineCustomer; onOpen: () => void; onSendToOnboarding: () => void }> = ({ customer: c, onOpen, onSendToOnboarding }) => {
  const o = c.onboarding;
  const req = useAddonRequest(c.id, `${o?.addonRequestStatus}-${c.updatedAt}-${o?.addonItemsSaved}-${o?.addonItemsVerified}`);
  const label = c.company || c.name;
  const docs = addonStatus(o);
  const pay = req ? addonPaymentState(req) : null;
  return (
    <tr {...rowOpen(onOpen)} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
      <td className="px-5 py-4">
        <div className="font-bold text-slate-900">{c.name}</div>
        <div className="text-xs text-slate-500">{c.company || 'No business name'}</div>
        {c.phone && <div className="text-[11px] text-slate-400 mt-0.5">{c.phone}</div>}
        <div className="text-[11px] text-slate-500 mt-1">{o?.consultantStartedAt ? 'Original services: in onboarding' : 'Original services: not yet sent for onboarding'}</div>
      </td>
      <td className="px-3 py-4">
        {req === undefined ? (
          <span className="text-xs text-slate-400">Loading…</span>
        ) : req ? (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label={`Add-ons of ${label}`}>
              {req.items.map((a, i) => (
                <li key={a.id || i} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-semibold">
                  {a.name}
                </li>
              ))}
            </ul>
            <div className="text-xs font-bold text-slate-900 mt-1">{rupees(req.total)}</div>
          </>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        )}
      </td>
      <td className="px-3 py-4">
        {o?.addonRequestStatus ? <AddonStatusPill status={o.addonRequestStatus} /> : <span className="text-xs text-slate-400">-</span>}
        {req?.submittedAt && <div className="text-[11px] text-slate-500 mt-1">Submitted {day(req.submittedAt)}</div>}
      </td>
      <td className="px-3 py-4 text-xs text-slate-700">
        {req?.invoice ? (
          <>
            <div className="font-semibold">{req.invoice.number}</div>
            {pay && <Pill tone={pay.tone}>{pay.label}</Pill>}
          </>
        ) : (
          <span className="text-slate-400">No invoice yet</span>
        )}
      </td>
      <td className="px-3 py-4 text-xs text-slate-700">
        {o?.addonRequestStatus && COLLECTING.includes(o.addonRequestStatus) ? (
          <>
            <Pill tone={docs.tone}>{docs.label}</Pill>
            {o.addonItemsTotal > 0 && (
              <div className="text-slate-500 mt-1">
                {o.addonItemsSaved} of {o.addonItemsTotal} collected · {o.addonItemsVerified} verified
              </div>
            )}
          </>
        ) : o?.addonRequestStatus === 'PAYMENT_CONFIRMED' ? (
          <span className="font-semibold text-emerald-700">Ready to start</span>
        ) : (
          <span className="text-slate-400">After payment</span>
        )}
      </td>
      <td className="px-5 py-4 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          <button type="button" className={btn.secondary} onClick={onOpen} aria-label={`Open ${label}`}>
            Open
          </button>
          {!o?.consultantStartedAt && (
            <button type="button" className={btn.primary} onClick={onSendToOnboarding} aria-label={`Send ${label} for onboarding`}>
              <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send for onboarding
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// One customer: add-on request, payment, documents, notes
// ---------------------------------------------------------------------------
const AddonDetailsDialog: React.FC<{ id: string; serviceName: (code: string) => string; onClose: () => void; onChanged: () => void }> = ({ id, serviceName, onClose, onChanged }) => {
  const { byCode } = useServiceCatalog();
  const [detail, setDetail] = useState<PipelineCustomerDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const load = useCallback(() => {
    Promise.all([pipelineApi.get(id), pipelineApi.addonChecklist(id)]).then(
      ([d, c]) => {
        setDetail(d);
        setChecklist(c);
        setError(null);
      },
      e => setError(userMessage(e))
    );
  }, [id]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const changed = () => {
    notifyPipelineChanged();
    onChanged();
    load();
  };
  const act = async (fn: () => Promise<AddonRequest>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setEditorKey(k => k + 1);
      changed();
    } catch (e) {
      setActionError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const label = detail ? detail.company || detail.name : 'Add-ons';
  const status = detail?.onboarding?.addonRequestStatus ?? null;
  const docs = addonStatus(detail?.onboarding ?? null);

  return (
    <Dialog title={label} description="Add-ons Services" onClose={onClose} wide>
      {error && !detail && <ErrorBanner message={error} onRetry={load} />}
      {!detail || !checklist ? (
        !error && <Spinner label="Loading customer…" />
      ) : (
        <>
          <section aria-label="Customer" className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <div>
              <div className="text-[11px] font-medium text-slate-500">Customer</div>
              <div className="text-sm font-semibold text-slate-900">{detail.name}</div>
              <div className="text-xs text-slate-500">{[detail.phone, detail.email].filter(Boolean).join(' · ') || '-'}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Original services</div>
              <div className="text-sm text-slate-900">{detail.services.length ? detail.services.map(serviceName).join(', ') : '-'}</div>
              <div className="text-[11px] text-slate-500">{detail.onboarding?.consultantStartedAt ? 'In onboarding' : 'Not yet sent for onboarding'}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Add-ons</div>
              <div className="mt-0.5">{status ? <AddonStatusPill status={status} /> : '-'}</div>
            </div>
          </section>

          <AddonRequestEditor key={editorKey} customerId={detail.id} originalServices={detail.services} onChanged={changed} />

          <section aria-labelledby="addon-docs-heading" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="addon-docs-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Add-on documents {status && COLLECTING.includes(status) && <Pill tone={docs.tone}>{docs.label}</Pill>}
              </h3>
              {status === 'PAYMENT_CONFIRMED' && (
                <button type="button" className={btn.primary} disabled={busy} onClick={() => void act(() => addonsApi.startDocuments(detail.id))}>
                  <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Starting…' : 'Start add-on document collection'}
                </button>
              )}
              {status === 'IN_PROGRESS' && (
                <button
                  type="button"
                  className={btn.green}
                  disabled={busy || (checklist.length > 0 && (detail.onboarding?.addonItemsVerified ?? 0) < checklist.length)}
                  title={checklist.length > 0 && (detail.onboarding?.addonItemsVerified ?? 0) < checklist.length ? 'Verify every add-on item first' : undefined}
                  onClick={() => void act(() => addonsApi.complete(detail.id))}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Mark add-ons complete
                </button>
              )}
            </div>
            {actionError && <ErrorBanner message={actionError} />}
            {!status || !['PAYMENT_CONFIRMED', ...COLLECTING].includes(status) ? (
              <p className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 text-center">
                Add-on documents are collected after Accounts approves the add-ons, issues the invoice and confirms the payment.
              </p>
            ) : status === 'PAYMENT_CONFIRMED' ? (
              <p className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 text-center">
                Accounts confirmed the add-on payment. Start the add-on document collection when you are ready.
              </p>
            ) : checklist.length === 0 ? (
              <p className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 text-center">The add-on services do not need any documents or details.</p>
            ) : (
              <ChecklistPanel customer={{ ...detail, checklist }} catalog={byCode} mode="addon" onChanged={changed} />
            )}
          </section>

          <ConsultationNotes customerId={detail.id} canWrite services={detail.services} />

          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={btn.secondary}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
};

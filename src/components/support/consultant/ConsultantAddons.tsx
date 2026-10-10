import { rowOpen } from '../../../lib/rowClick';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, Send } from 'lucide-react';
import type { ChecklistItem, CustomerOnboarding, Paginated, PipelineCustomer, PipelineCustomerDetail } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
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
import { AddonSelector, type Addon } from './AddonSelector';
import { ConsultationNotes } from './ConsultationNotes';

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

/**
 * Technical Consultant: "Add-ons Services". Customers sent to Add-ons, with the add-on services
 * they chose and where the required documents stand. A customer opens in a pop-up to change the
 * services, collect and verify the documents, and write notes.
 */
export const ConsultantAddons: React.FC<{ onCountsChanged: () => void; onGoToOnboarding: () => void }> = ({ onCountsChanged, onGoToOnboarding }) => {
  const { byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        e => n === seq.current && setError(errorMessage(e))
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
      setNotice(`${c.company || c.name} was sent for onboarding.`);
      notifyPipelineChanged();
      onCountsChanged();
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Add-ons Services</h1>
          <p className="text-sm text-slate-500 mt-1">Customers who need extra services. Choose the services, collect the documents they need and verify them.</p>
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

      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">
          <span>{notice}</span>
          <button type="button" onClick={onGoToOnboarding} className="inline-flex items-center gap-1 font-bold text-emerald-900 hover:underline">
            Open Onboarding Customers <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <Spinner label="Loading add-on customers…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="text-sm font-bold text-slate-800">{debounced ? 'No customer matches your search' : 'No customers in Add-ons Services'}</div>
          <p className="text-xs text-slate-500 mt-1">
            {debounced ? 'Try a different name or business.' : 'In Customers, answer Yes to additional services, choose the add-ons and press Send to Add-ons.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[64rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Add-on services</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Documents</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Sent</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data?.items.map(c => {
                  const o = c.onboarding;
                  const status = addonStatus(o);
                  const label = c.company || c.name;
                  return (
                    <tr key={c.id} {...rowOpen(() => setOpenId(c.id))} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">{c.company || 'No business name'}</div>
                        {c.phone && <div className="text-[11px] text-slate-400 mt-0.5">{c.phone}</div>}
                      </td>
                      <td className="px-3 py-4">
                        <ul className="flex flex-wrap gap-1.5" aria-label={`Add-ons of ${label}`}>
                          {(o?.addons || []).map((a, i) => (
                            <li key={`${a.code || a.name}-${i}`} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-semibold">
                              {a.name}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-4 text-xs text-slate-700">
                        {o && o.addonItemsTotal > 0 ? (
                          <>
                            <div className="font-semibold">
                              {o.addonItemsSaved} of {o.addonItemsTotal} collected
                            </div>
                            <div className="text-slate-500">{o.addonItemsVerified} verified</div>
                          </>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <Pill tone={status.tone}>{status.label}</Pill>
                        {o?.consultantStartedAt && <div className="text-[11px] text-slate-500 mt-1">In onboarding</div>}
                      </td>
                      <td className="px-3 py-4 text-xs text-slate-600">
                        <div>{day(o?.addonsSubmittedAt)}</div>
                        {o?.addonsSubmittedByName && <div className="text-[11px] text-slate-400">by {o.addonsSubmittedByName}</div>}
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button type="button" className={btn.secondary} onClick={() => setOpenId(c.id)} aria-label={`Open ${label}`}>
                            Open
                          </button>
                          {!o?.consultantStartedAt && (
                            <button type="button" className={btn.primary} onClick={() => void sendToOnboarding(c)} aria-label={`Send ${label} for onboarding`}>
                              <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send for onboarding
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
// One customer: services, documents, notes
// ---------------------------------------------------------------------------
const AddonDetailsDialog: React.FC<{ id: string; serviceName: (code: string) => string; onClose: () => void; onChanged: () => void }> = ({ id, serviceName, onClose, onChanged }) => {
  const { items: catalogItems, byCode } = useServiceCatalog();
  const [detail, setDetail] = useState<PipelineCustomerDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([pipelineApi.get(id), pipelineApi.addonChecklist(id)]).then(
      ([d, c]) => {
        setDetail(d);
        setChecklist(c);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [id]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const changed = () => {
    notifyPipelineChanged();
    onChanged();
    load();
  };

  const label = detail ? detail.company || detail.name : 'Add-ons';
  const addons: Addon[] = detail?.onboarding?.addons || [];
  const status = addonStatus(detail?.onboarding ?? null);

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
              <div className="text-[11px] font-medium text-slate-500">Main services</div>
              <div className="text-sm text-slate-900">{detail.services.length ? detail.services.map(serviceName).join(', ') : '-'}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Add-ons status</div>
              <div className="mt-0.5 flex items-center gap-2">
                <Pill tone={status.tone}>{status.label}</Pill>
                <span className="text-xs text-slate-500">sent {day(detail.onboarding?.addonsSubmittedAt)}</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="addon-services-heading" className="space-y-2">
            <h3 id="addon-services-heading" className="text-sm font-bold text-slate-900">
              Add-on services
            </h3>
            <AddonSelector
              customerId={detail.id}
              label={label}
              addons={addons}
              catalog={catalogItems}
              onChanged={() => {
                changed();
              }}
            />
            {addons.some(a => !a.code) && <p className="text-[11px] text-slate-500">Services typed by hand have no standard document list.</p>}
          </section>

          {checklist.length === 0 ? (
            <p className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 text-center">
              The selected add-on services do not need any documents or details.
            </p>
          ) : (
            <ChecklistPanel customer={{ ...detail, checklist }} catalog={byCode} mode="addon" onChanged={changed} />
          )}

          <ConsultationNotes customerId={detail.id} canWrite services={[...detail.services, ...addons.filter(a => a.code).map(a => a.code as string)]} />

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

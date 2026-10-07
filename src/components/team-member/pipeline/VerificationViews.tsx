import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, ShieldCheck } from 'lucide-react';
import type { Paginated, PipelineCustomer, ReviewFilter } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { OnboardingCustomerView } from './OnboardingViews';
import { Avatar, Card, ErrorBanner, Pager, Pill, selectCls, ServiceChips, shortDate, Spinner, useDebounced, usePipelineRealtime, useServiceCatalog } from './shared';

const FILTERS: { key: ReviewFilter | ''; label: string }[] = [
  { key: 'TO_REVIEW', label: 'To verify' },
  { key: 'NEEDS_FIX', label: 'Sent back' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: '', label: 'All' }
];

/**
 * Technical Consultant workspace: customers the sales team forwarded to
 * support, with every collected document and detail to verify or send back.
 */
export const OnboardingVerificationWorkspace: React.FC = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) return <OnboardingCustomerView id={openId} mode="review" onBack={() => setOpenId(null)} />;
  return <VerificationQueue onOpen={setOpenId} />;
};

const VerificationQueue: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { items: services, byCode } = useServiceCatalog();
  const [filter, setFilter] = useState<ReviewFilter | ''>('TO_REVIEW');
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    pipelineApi
      .list({
        stage: 'ONBOARDING',
        forwarded: true,
        review: filter || undefined,
        search: debounced || undefined,
        service: service || undefined,
        page,
        pageSize: 9,
        sort: 'oldest'
      })
      .then(
        r => seq === seqRef.current && setData(r),
        e => seq === seqRef.current && setError(errorMessage(e))
      )
      .finally(() => seq === seqRef.current && setLoading(false));
  }, [filter, debounced, service, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [filter, debounced, service]);
  usePipelineRealtime(load);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-600" aria-hidden="true" /> Onboarding verification
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Customers forwarded by the sales team. Check each document and detail, then verify it or send it back with a note.
        </p>
      </div>

      <Card className="p-4 flex flex-col lg:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by business, contact or phone"
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
      </Card>

      <div role="tablist" aria-label="Verification status" className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <button
            key={f.key || 'ALL'}
            role="tab"
            type="button"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              filter === f.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading customers…" />
      ) : data && data.items.length === 0 ? (
        <Card className="py-12 text-center text-sm text-slate-500">
          {filter === 'TO_REVIEW' ? 'Nothing waiting for verification.' : 'No customers here.'}
        </Card>
      ) : (
        <ul className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {data?.items.map(c => {
            const o = c.onboarding;
            const total = o?.itemsTotal || 0;
            const verified = o?.itemsVerified || 0;
            const rejected = o?.itemsRejected || 0;
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
                    {rejected > 0 ? (
                      <Pill tone="red">Sent back</Pill>
                    ) : total > 0 && verified >= total ? (
                      <Pill tone="green">Verified</Pill>
                    ) : (
                      <Pill tone="indigo">To verify</Pill>
                    )}
                  </div>
                  <div className="mt-3">
                    <ServiceChips codes={c.services} catalog={byCode} max={3} />
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-slate-600">Verified</span>
                    <span className="font-bold text-slate-900">
                      {verified} of {total}
                      {rejected ? ` · ${rejected} sent back` : ''}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"
                    role="progressbar"
                    aria-label={`Items verified for ${c.company || c.name}`}
                    aria-valuenow={verified}
                    aria-valuemin={0}
                    aria-valuemax={total}
                  >
                    <div className="h-full bg-emerald-600" style={{ width: `${total ? (verified / total) * 100 : 0}%` }} />
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100 mt-4 text-xs text-slate-500">
                    <span>
                      Forwarded {shortDate(o?.forwardedToSupportAt)}
                      {c.owner?.fullName ? ` · ${c.owner.fullName}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                      aria-label={`Open ${c.company || c.name} for verification`}
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
          <Pager page={page} pageSize={9} total={data.total} noun="customers" onPage={setPage} />
        </Card>
      )}
    </div>
  );
};

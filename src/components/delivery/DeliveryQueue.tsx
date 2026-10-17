import React, { useCallback, useEffect, useState } from 'react';
import { PackageCheck, Search } from 'lucide-react';
import type { DeliveryQueueItem, Paginated } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { Card, ErrorBanner, longDate, money, Pager, Pill, Spinner, useDebounced, usePipelineRealtime } from '../team-member/pipeline/shared';

const PAGE_SIZE = 20;
const FROM: Record<string, string> = { SALES: 'Sales', SUPPORT: 'Support', GENERAL: 'the team' };

/**
 * A department that delivers services: the customers whose services Sales or Support sent here after the payment was confirmed
 * and the documents were verified. Each service is listed with who sent it and when. Refreshes on any pipeline change.
 */
export const DeliveryQueue: React.FC = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<DeliveryQueueItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const term = useDebounced(search.trim());

  const load = useCallback(() => {
    pipelineApi.deliveryQueue({ search: term || undefined, page, pageSize: PAGE_SIZE }).then(
      d => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      e => {
        setError(errorMessage(e));
        setLoading(false);
      }
    );
  }, [term, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [term]);
  usePipelineRealtime(load);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Delivery queue</h1>
        <p className="text-sm text-slate-500 mt-1">Customers whose services were sent to your department. The payment is confirmed and the documents are verified.</p>
      </div>
      <label className="relative block w-full sm:w-80">
        <span className="sr-only">Search the delivery queue</span>
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Customer, business or customer ID"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading the delivery queue…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <PackageCheck className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" />
          <div className="text-sm font-bold text-slate-800 mt-2">{term ? 'No customer matches' : 'Nothing has been sent to your department yet'}</div>
          <p className="text-xs text-slate-500 mt-1">{term ? 'Try another search.' : 'Services appear here when Sales or Support sends them after verifying the documents.'}</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Customers to deliver to">
          {data?.items.map(c => (
            <li key={c.id}>
              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-900">{c.company || c.name}</h2>
                    <p className="text-xs text-slate-500">
                      {[c.code, c.name, c.phone, c.city].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Referred by {c.referredBy || 'unknown'} ({FROM[c.referredFrom ?? 'GENERAL'] ?? 'the team'})
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={c.balance > 0 ? 'orange' : 'green'}>{c.balance > 0 ? `${money(c.balance)} still due` : 'Fully paid'}</Pill>
                    <Pill tone={c.clientLogin ? 'green' : 'slate'}>{c.clientLogin ? 'Client login ready' : 'No client login'}</Pill>
                  </div>
                </div>
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs" aria-label={`Services of ${c.company || c.name}`}>
                  {c.services.map(s => (
                    <li key={s.code} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-slate-800">{s.name}</span>
                        <span className="text-slate-500">
                          Sent {longDate(s.sentAt)}
                          {s.sentBy ? ` by ${s.sentBy}` : ''}
                        </span>
                      </div>
                      {s.note && <p className="mt-1 text-slate-600 whitespace-pre-line break-words">Note: {s.note}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="customers" onPage={setPage} />}
    </div>
  );
};

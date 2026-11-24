import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import type { CrocodialLeads } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';

/**
 * "My Crocodial leads": the leads Crocodial assigns to the signed-in person's mapped Crocodial user (read-only; croc_leads decides whose
 * leads may be seen). Search, filters (never called, follow-up due), a page at a time; phone numbers are masked. Nothing is shown when the
 * person is not connected to Crocodial. Work on a lead (calls, follow-ups) still happens in the Crocodial app.
 */
type Filter = 'ALL' | 'NEVER_CALLED' | 'FOLLOW_UP_DUE';
const PAGE = 25;
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const CrocodialLeadsPanel: React.FC<{ profileId?: string; title?: string; hideWhenOff?: boolean }> = ({ profileId, title = 'My Crocodial leads', hideWhenOff = true }) => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CrocodialLeads | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // search after a short pause in typing
  useEffect(() => {
    const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [typed]);
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    crocodialApi.leads({ profileId, search: search || undefined, filter, page, pageSize: PAGE })
      .then(setData).catch(e => setError(errText(e))).finally(() => setLoading(false));
  }, [profileId, search, filter, page]);
  useEffect(load, [load]);

  // on a home page: nothing at all until the database says the person is connected (no error box for everyone else, nor before the
  // migration is run)
  if (hideWhenOff && !data?.enabled) return null;
  if (data && !data.enabled) {
    return hideWhenOff ? null : <p className="text-sm text-slate-500" data-testid="croc-leads-off">You are not connected to Crocodial yet. The Managing Director connects your Crocodial login.</p>;
  }
  const counts = data?.counts;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const chips: [Filter, string, number | undefined][] = [['ALL', 'All', counts?.all], ['FOLLOW_UP_DUE', 'Follow-up due', counts?.followUpDue], ['NEVER_CALLED', 'Never called', counts?.neverCalled]];

  return (
    <section aria-label={title} className="space-y-3" data-testid="crocodial-leads">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600" aria-hidden /> {title}</h2>
          <p className="text-xs text-slate-500">Assigned to you in Crocodial · Source: Crocodial (read-only){data?.lastSyncAt ? ` · synced ${when(data.lastSyncAt)}` : ''}. Call and update leads in the Crocodial app.</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search Crocodial leads</span>
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden />
          <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name, company, city, status or phone"
            className="w-full border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-xs" maxLength={100} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        {chips.map(([id, label, n]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {label} <span className="opacity-70">{n ?? ''}</span>
          </button>
        ))}
      </div>
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error} <button type="button" className="underline" onClick={load}>Try again</button></p> : null}
      {!data && !error ? <p className="text-xs text-slate-500" role="status">Loading…</p> : null}
      {data?.enabled ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="croc-leads-table">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>{['Lead', 'Phone', 'Status', 'Calls by you', 'Next follow-up', 'Last activity'].map(h => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data.items ?? []).map(l => (
                <tr key={l.id} data-testid="croc-lead-row">
                  <td className="px-2.5 py-2"><span className="font-semibold text-slate-800">{l.name || '—'}</span>
                    <span className="block text-[11px] text-slate-500">{[l.company, l.city].filter(Boolean).join(' · ') || ' '}</span></td>
                  <td className="px-2.5 py-2 font-mono whitespace-nowrap">{l.phone ?? '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{l.status ?? '—'}{l.called === false ? <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">never called</span> : null}</td>
                  <td className="px-2.5 py-2">{l.calls}</td>
                  <td className={`px-2.5 py-2 whitespace-nowrap ${l.followUpDue ? 'text-rose-700 font-semibold' : ''}`}>{l.nextFollowupAt ? `${when(l.nextFollowupAt)}${l.followUpDue ? ' (due)' : ''}` : '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{when(l.lastInteractionAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(data.items ?? []).length ? <p className="px-3 py-6 text-center text-xs text-slate-500" data-testid="croc-leads-empty">{search || filter !== 'ALL' ? 'No leads match.' : 'No leads are assigned to you in Crocodial.'}</p> : null}
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            <span>{total ? `Showing ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)} of ${total}` : 'Showing 0 of 0'}{loading ? ' · loading…' : ''}</span>
            <span className="flex gap-1">
              <button type="button" className="rounded-md border border-slate-200 p-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" aria-hidden /></button>
              <button type="button" className="rounded-md border border-slate-200 p-1 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" aria-hidden /></button>
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default CrocodialLeadsPanel;

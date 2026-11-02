import React, { useCallback, useEffect, useState } from 'react';
import type { HrReviewLog } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { hrReviewsApi } from '../../lib/api/reportPerformance';
import { btn, Card, ErrorBanner, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';
import { dateLabel, timeLabel } from '../reports/reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const PAGE = 25;

/** Every submitted review, newest first: search by name, filter by department, paged in the database. */
export const HrReviewHistory: React.FC<{ reloadKey: number; departments: { id: string; name: string }[] }> = ({ reloadKey, departments }) => {
  const [data, setData] = useState<HrReviewLog | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    hrReviewsApi.log({ department: department || undefined, search: query || undefined, page }).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [department, query, page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); setQuery(search.trim()); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(load, [load, reloadKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div><h2 className="text-base font-bold text-slate-900">Review History</h2><p className="text-xs text-slate-500">All submitted reviews. A submitted review is never changed.</p></div>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} !w-48 !py-1.5`} placeholder="Search by name" aria-label="Search reviews by name" value={search} onChange={e => setSearch(e.target.value)} />
          <select className={selectCls} aria-label="Filter by department" value={department} onChange={e => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        data.items.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No submitted review matches.</p> : (
          <>
            <ul className="space-y-2" data-testid="review-log">
              {data.items.map(r => (
                <li key={r.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{r.subject} <span className="font-normal text-slate-500">- {r.subjectKind === 'TEAM_LEAD' ? 'Team Lead' : 'Team Member'}, {r.department}</span></span>
                    <span className="text-xs font-semibold text-indigo-700">{r.rating} - {r.ratingLabel}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">{dateLabel(r.periodStart)} to {dateLabel(r.periodEnd)} - reviewed by {r.reviewer}, {timeLabel(r.submittedAt)}</p>
                  {r.comments ? <p className="text-xs text-slate-700 mt-1">{r.comments}</p> : null}
                  {r.recommendations ? <p className="text-xs text-slate-600 mt-0.5"><b>Recommendations:</b> {r.recommendations}</p> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <span>{data.total} review{data.total === 1 ? '' : 's'}</span>
              <span className="flex items-center gap-2">
                <button type="button" className={btn.secondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span>Page {page} of {pages}</span>
                <button type="button" className={btn.secondary} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </span>
            </div>
          </>
        )
      ) : null}
    </Card>
  );
};

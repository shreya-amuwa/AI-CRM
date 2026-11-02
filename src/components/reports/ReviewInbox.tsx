import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReportInbox, WorkReportSummary } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { ReportRow } from './ReportRow';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
type InboxFilter = { id: string; label: string; match: (r: WorkReportSummary) => boolean; count: (c: ReportInbox['counts']) => number };
const FILTERS: InboxFilter[] = [
  { id: 'PENDING', label: 'Pending approval', match: r => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW', count: c => (c.SUBMITTED ?? 0) + (c.UNDER_REVIEW ?? 0) },
  { id: 'APPROVED', label: 'Approved', match: r => r.status === 'APPROVED', count: c => c.APPROVED ?? 0 },
  { id: 'REJECTED', label: 'Rejected', match: r => r.status === 'REJECTED', count: c => c.REJECTED ?? 0 },
  { id: 'REVISION_REQUIRED', label: 'Revision required', match: r => r.status === 'REVISION_REQUIRED', count: c => c.REVISION_REQUIRED ?? 0 },
  { id: 'ALL', label: 'All', match: () => true, count: c => Object.values(c).reduce((a, b) => a + (b ?? 0), 0) }
];

// A Team Lead's inbox of Team Member reports has two approvals behind it: waiting for the Team Lead, then for the Department Head
const MEMBER_FILTERS: InboxFilter[] = [
  { ...FILTERS[0], label: 'Pending Team Lead Approval' },
  { id: 'WITH_DEPARTMENT_HEAD', label: 'Pending Department Head Approval', match: r => r.status === 'PENDING_DEPARTMENT_HEAD', count: c => c.PENDING_DEPARTMENT_HEAD ?? 0 },
  { id: 'APPROVED', label: 'Fully Approved', match: r => r.status === 'APPROVED', count: c => c.APPROVED ?? 0 },
  { ...FILTERS[3], label: 'Revision Required' },
  FILTERS[2],
  FILTERS[4]
];

/**
 * The reports waiting for this person's decision (and the ones already decided): the database lists only the reports this person is the
 * reviewer of. Filter by status, by the author's name and by the reporting period. Opening a report shows the decision buttons.
 */
export const ReviewInbox: React.FC<{
  title: string;
  emptyText: string;
  period?: { from: string; to: string };
  reloadKey: number;
  onOpen: (id: string) => void;
  defaultFilter?: string;
  /** Team Member reports (two approvals): the Team Lead's inbox. */
  member?: boolean;
}> = ({ title, emptyText, period, reloadKey, onOpen, defaultFilter = 'PENDING', member }) => {
  const [data, setData] = useState<ReportInbox | null>(null);
  const [filter, setFilter] = useState(defaultFilter);
  const [author, setAuthor] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    workReportsApi.inbox({ from: period?.from, to: period?.to }).then(d => { setError(''); setData(d); }, e => { setData(prev => prev ?? { items: [], counts: {} }); setError(errText(e)); });
  }, [period?.from, period?.to]);
  useEffect(load, [load, reloadKey]);

  const filters = member ? MEMBER_FILTERS : FILTERS;
  const active = filters.find(f => f.id === filter) ?? filters[0];
  const rows = useMemo(() => (data?.items ?? []).filter(active.match).filter(r => !author.trim() || r.author.toLowerCase().includes(author.trim().toLowerCase())), [data, active, author]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <input className={`${inputCls} !w-52 !py-1.5`} placeholder="Search by name" aria-label="Search reports by author name" value={author} onChange={e => setAuthor(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filter by status">
        {filters.map(f => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${filter === f.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
          >
            {f.label} <span className="tabular-nums opacity-80">{data ? f.count(data.counts) : 0}</span>
          </button>
        ))}
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {data === null ? <Spinner /> : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{filter === 'PENDING' && !author ? emptyText : 'No reports match.'}</p>
      ) : (
        <ul className="space-y-2" data-testid="review-inbox">
          {rows.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} showAuthor /></li>)}
        </ul>
      )}
    </Card>
  );
};

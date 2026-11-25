import React, { useCallback, useEffect, useState } from 'react';
import type { WorkReportSummary } from '../../../shared/contracts';
import { REPORT_STATUSES, reportStatusLabel, type ReportKind } from '../../../shared/reportFields';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { btn, Card, ErrorBanner, selectCls, Spinner } from '../team-member/pipeline/shared';
import { notifyReportsChanged } from './reportEvents';
import { ReportRow } from './ReportRow';
import { dateLabel, timeLabel } from './reportUi';
import { confirmAction } from '../feedback/AppFeedback';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * The person's own reports (drafts included): title, submission date, who it went to, status, the reviewer's comment and when it was last
 * updated. A draft or a report sent back can be opened for editing; a draft can be deleted. Nobody else's reports are ever listed here.
 */
export const MyReports: React.FC<{
  reportsTo: string[];
  reloadKey: number;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  /** A plain list of what was sent (no status filter): a Team Lead's individual report screen. */
  simple?: boolean;
  kind?: ReportKind;
}> = ({ reportsTo, reloadKey, onOpen, onEdit, simple, kind }) => {
  const [items, setItems] = useState<WorkReportSummary[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    workReportsApi.mine(status || undefined).then(setItems, e => { setItems([]); setError(errText(e)); });
  }, [status]);
  useEffect(load, [load, reloadKey]);

  const remove = async (id: string) => {
    if (!(await confirmAction({ title: 'Delete this report draft?', description: 'The draft is removed. This cannot be undone.', confirmLabel: 'Delete draft', cancelLabel: 'Keep draft', variant: 'destructive' }))) return;
    setBusyId(id);
    try { await workReportsApi.deleteDraft(id); notifyReportsChanged(); load(); } catch (e) { setError(errText(e)); } finally { setBusyId(null); }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-bold text-slate-900">{simple ? 'Submitted reports' : 'My reports'}</h2>
        {simple ? null : <label className="flex items-center gap-2 text-xs text-slate-600">
          Status
          <select className={selectCls} value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter my reports by status">
            <option value="">All</option>
            {REPORT_STATUSES.map(s => <option key={s} value={s}>{reportStatusLabel(s, kind)}</option>)}
          </select>
        </label>}
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {items === null ? <Spinner /> : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{status ? 'No reports with this status.' : 'You have not written a report yet.'}</p>
      ) : (
        <ul className="space-y-2" data-testid="my-reports">
          {items.map(r => (
            <li key={r.id}>
              <ReportRow
                r={r}
                onOpen={onOpen}
                extra={
                  <>
                    <span className="text-[11px] text-slate-500 text-right">
                      {r.status === 'DRAFT' ? 'Not submitted' : <>To {(r.kind === 'MEMBER' ? r.teamLead : null) ?? (reportsTo.join(', ') || 'your reviewer')}<br />{dateLabel(r.submittedAt)}</>}
                      <br />Updated {timeLabel(r.updatedAt)}
                    </span>
                    {r.status === 'DRAFT' || r.status === 'REVISION_REQUIRED' ? (
                      <span className="flex gap-1.5">
                        <button type="button" className={btn.primary} onClick={() => onEdit(r.id)} disabled={busyId === r.id}>{r.status === 'DRAFT' ? 'Edit' : 'Revise'}</button>
                        {r.status === 'DRAFT' ? <button type="button" className={btn.danger} onClick={() => void remove(r.id)} disabled={busyId === r.id}>Delete</button> : null}
                      </span>
                    ) : null}
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { WorkReportDetail } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { btn, Dialog, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { ReportContentView, reportAsText } from './ReportContentView';
import { notifyReportsChanged } from './reportEvents';
import { dateLabel, periodLabel, StatusPill, timeLabel } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Draft created', SUBMITTED: 'Submitted', RESUBMITTED: 'Resubmitted', OPENED: 'Opened for review',
  APPROVED: 'Approved', REJECTED: 'Rejected', REVISION_REQUIRED: 'Revision requested', REVISION_REQUESTED: 'Revision requested'
};

/**
 * One report, in full: what was written, who reviewed it and when, the comment, and the history of every step (nothing is overwritten:
 * a resubmission adds a step). The person who may decide on it (the database says so with `canReview`) gets the decision buttons.
 */
export const ReportDetailDialog: React.FC<{ id: string; onClose: () => void; onChanged?: () => void; onEdit?: (r: WorkReportDetail) => void }> = ({ id, onClose, onChanged, onEdit }) => {
  const [report, setReport] = useState<WorkReportDetail | null>(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setError('');
    workReportsApi.get(id).then(r => { setReport(r); }, e => setError(errText(e)));
  }, [id]);
  useEffect(load, [load]);

  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED') => {
    if (decision !== 'APPROVED' && comment.trim().length < 3) { setFormError('Write a comment so the author knows what to do.'); return; }
    setBusy(true);
    setFormError('');
    try {
      const r = await workReportsApi.review(id, decision, comment.trim() || undefined);
      setReport(prev => (prev ? { ...prev, ...r, events: undefined, canReview: false } : r));
      setComment('');
      notifyReportsChanged();
      onChanged?.();
      load();
    } catch (e) {
      setFormError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!report) return;
    const blob = new Blob([reportAsText(report, report.content)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'report'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog title={report?.title ?? 'Report'} description={report ? `${report.author}${report.designation ? ` - ${report.designation}` : ''}` : undefined} onClose={onClose} wide>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!report && !error ? <Spinner /> : null}
      {report ? (
        <div className="space-y-4" data-testid="report-detail">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
            <StatusPill status={report.status} />
            <span>Period: <b>{periodLabel(report.periodStart, report.periodEnd)}</b></span>
            <span>Report date: <b>{dateLabel(report.reportDate)}</b></span>
            {report.department ? <span>{report.department}{report.team ? ` / ${report.team}` : ''}</span> : null}
            {report.revision > 1 ? <span>Revision {report.revision}</span> : null}
            <span>Submitted: <b>{timeLabel(report.submittedAt)}</b></span>
          </div>

          {report.reviewComment || report.reviewedBy ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-sm" data-testid="review-note">
              <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                {report.reviewedBy ? `Reviewed by ${report.reviewedBy}` : 'Review'}{report.reviewedAt ? ` on ${timeLabel(report.reviewedAt)}` : ''}
              </p>
              {report.reviewComment ? <p className="mt-1 text-slate-800 whitespace-pre-wrap">{report.reviewComment}</p> : null}
            </div>
          ) : null}

          <ReportContentView kind={report.kind} content={report.content} />

          {report.events && report.events.length > 0 ? (
            <section aria-label="History">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">History</h3>
              <ol className="space-y-1.5 border-l border-slate-200 pl-4">
                {report.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-xs text-slate-700 relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-300" aria-hidden="true" />
                    <b>{ACTION_LABEL[e.action] ?? e.action}</b> by {e.actor} <span className="text-slate-400">- {timeLabel(e.at)}</span>
                    {e.revision > 1 ? <span className="text-slate-400"> (revision {e.revision})</span> : null}
                    {e.comment ? <span className="block text-slate-600 whitespace-pre-wrap">"{e.comment}"</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {report.canReview ? (
            <section aria-label="Your decision" className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label htmlFor="review-comment" className="block text-xs font-semibold text-slate-700">Review comment <span className="font-normal text-slate-500">(needed to reject or ask for a revision)</span></label>
              <textarea id="review-comment" className={`${inputCls} min-h-20`} value={comment} onChange={e => { setComment(e.target.value); setFormError(''); }} maxLength={2000} disabled={busy} />
              {formError ? <p role="alert" className="text-xs text-rose-700">{formError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.green} onClick={() => decide('APPROVED')} disabled={busy}>Approve</button>
                <button type="button" className={btn.secondary} onClick={() => decide('REVISION_REQUIRED')} disabled={busy}>Request revision</button>
                <button type="button" className={btn.danger} onClick={() => decide('REJECTED')} disabled={busy}>Reject</button>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" className={btn.secondary} onClick={download}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Download</button>
            <div className="flex gap-2">
              {report.canEdit && onEdit ? <button type="button" className={btn.primary} onClick={() => onEdit(report)}>{report.status === 'REVISION_REQUIRED' ? 'Revise and resubmit' : 'Edit draft'}</button> : null}
              <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};

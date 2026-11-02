import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { WorkReportDetail } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { btn, Dialog, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { ReportContentView, reportAsText } from './ReportContentView';
import { notifyReportsChanged } from './reportEvents';
import { ReviewActions } from './ReviewActions';
import { ApprovalSteps, dateLabel, periodLabel, StatusPill, timeLabel } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const STAGE_LABEL = { TEAM_LEAD: 'Team Lead', DEPARTMENT_HEAD: 'Department Head' } as const;
const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Draft created', SUBMITTED: 'Submitted', RESUBMITTED: 'Resubmitted', OPENED: 'Opened for review',
  APPROVED: 'Approved', REJECTED: 'Rejected', REVISION_REQUIRED: 'Revision requested', REVISION_REQUESTED: 'Revision requested'
};

/**
 * One report, in full: what was written, who reviewed it and when, the comment, and the history of every step (nothing is overwritten:
 * a resubmission adds a step). The person who may decide on it (the database says so with `canReview`) gets the decision buttons.
 */
export const ReportDetailDialog: React.FC<{
  id: string;
  onClose: () => void;
  onChanged?: () => void;
  onEdit?: (r: WorkReportDetail) => void;
  /** The author's own submission view (a Team Lead's individual report): no Download and no History, only the report itself. */
  simple?: boolean;
  /** Changes when something happened elsewhere (a live signal): the report is read again. */
  refreshKey?: number;
}> = ({ id, onClose, onChanged, onEdit, simple, refreshKey = 0 }) => {
  const [report, setReport] = useState<WorkReportDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    workReportsApi.get(id).then(r => { setReport(r); }, e => setError(errText(e)));
  }, [id]);
  useEffect(load, [load, refreshKey]);

  const decided = (r: WorkReportDetail) => {
    setReport(prev => (prev ? { ...prev, ...r, events: undefined, canReview: false, reviewStage: null } : r));
    notifyReportsChanged();
    onChanged?.();
    load();
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
            <StatusPill status={report.status} kind={report.kind} />
            {report.kind === 'MEMBER' ? <ApprovalSteps tl={report.tlStatus} dh={report.dhStatus} /> : null}
            <span>Period: <b>{periodLabel(report.periodStart, report.periodEnd)}</b></span>
            <span>Report date: <b>{dateLabel(report.reportDate)}</b></span>
            {report.department ? <span>{report.department}{report.team ? ` / ${report.team}` : ''}</span> : null}
            {report.revision > 1 ? <span>Revision {report.revision}</span> : null}
            <span>Submitted: <b>{timeLabel(report.submittedAt)}</b></span>
          </div>

          {report.kind === 'MEMBER' && report.tlStatus ? (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="approval-stages">
              {([
                ['TEAM_LEAD', report.tlStatus, report.tlReviewer ?? report.teamLead, report.tlReviewedAt, report.tlComment],
                ['DEPARTMENT_HEAD', report.dhStatus ?? null, report.dhReviewer, report.dhReviewedAt, report.dhComment]
              ] as const).map(([stage, st, who, at, note]) => (
                <div key={stage} className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">{STAGE_LABEL[stage]}</p>
                  <p className="mt-0.5 text-slate-800">
                    {!st ? 'Waiting for the earlier approval' : st === 'PENDING' ? `Waiting${who ? ` (${who})` : ''}` : <>{st === 'APPROVED' ? 'Approved' : st === 'REJECTED' ? 'Rejected' : 'Revision requested'} by <b>{who ?? '-'}</b> on {timeLabel(at)}</>}
                  </p>
                  {note ? <p className="mt-1 text-slate-700 whitespace-pre-wrap">{note}</p> : null}
                </div>
              ))}
            </div>
          ) : report.reviewComment || report.reviewedBy ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-sm" data-testid="review-note">
              <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                {report.reviewedBy ? `Reviewed by ${report.reviewedBy}` : 'Review'}{report.reviewedAt ? ` on ${timeLabel(report.reviewedAt)}` : ''}
              </p>
              {report.reviewComment ? <p className="mt-1 text-slate-800 whitespace-pre-wrap">{report.reviewComment}</p> : null}
            </div>
          ) : null}

          <ReportContentView kind={report.kind} content={report.content} />

          {!simple && report.events && report.events.length > 0 ? (
            <section aria-label="History">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">History</h3>
              <ol className="space-y-1.5 border-l border-slate-200 pl-4">
                {report.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-xs text-slate-700 relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-300" aria-hidden="true" />
                    <b>{ACTION_LABEL[e.action] ?? e.action}</b>{e.stage ? ` (${STAGE_LABEL[e.stage]})` : ''} by {e.actor} <span className="text-slate-400">- {timeLabel(e.at)}</span>
                    {e.revision > 1 ? <span className="text-slate-400"> (revision {e.revision})</span> : null}
                    {e.comment ? <span className="block text-slate-600 whitespace-pre-wrap">"{e.comment}"</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {report.canReview ? <ReviewActions id={id} stage={report.reviewStage} onDone={decided} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {simple ? <span /> : <button type="button" className={btn.secondary} onClick={download}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Download</button>}
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

import React from 'react';
import type { ReportPackage } from '../../../shared/contracts';
import { timeLabel, WeeklyStatusPill } from './reportUi';

const ACTION: Record<string, string> = {
  COMPILED: 'Compiled', SAVED: 'Draft saved', SUBMITTED: 'Submitted to the CEO', RESUBMITTED: 'Resubmitted to the CEO',
  APPROVED: 'Approved by the CEO and sent to HR', REVISION_REQUESTED: 'Revision requested', HR_STARTED: 'HR review started',
  HR_COMPLETED: 'HR review completed', SUBMITTED_TO_SUPERADMIN: 'Submitted to the Managing Director'
};

/** The Department Head's weekly summary (title, task overviews, remarks), the Operations Head's decision and every step so far. */
export const WeeklyPackageView: React.FC<{ pkg: ReportPackage; showHistory?: boolean }> = ({ pkg, showHistory = true }) => {
  if (pkg.status === 'NOT_SUBMITTED') return <p className="text-xs text-slate-500">The Department Head has not started the weekly report.</p>;
  const block = (label: string, text?: string | null) => (text ? (
    <div className="rounded-xl bg-slate-50/80 px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{text}</dd>
    </div>
  ) : null);
  return (
    <div className="space-y-3" data-testid="weekly-package">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <WeeklyStatusPill status={pkg.status} />
        {pkg.revision && pkg.revision > 1 ? <span>Revision {pkg.revision}</span> : null}
        {pkg.submittedBy ? <span>Prepared by <b>{pkg.submittedBy}</b></span> : null}
        {pkg.submittedAt ? <span>{timeLabel(pkg.submittedAt)}</span> : null}
      </div>
      {pkg.title ? <h4 className="text-sm font-bold text-slate-900">{pkg.title}</h4> : null}
      <dl className="grid gap-2 sm:grid-cols-2">
        {block('Weekly assigned task overview', pkg.assignedOverview)}
        {block('Weekly completed task overview', pkg.completedOverview)}
        <div className="sm:col-span-2">{block('Remarks / Department summary', pkg.note)}</div>
      </dl>
      {pkg.ohReviewer ? (
        <div className={`rounded-xl border px-3 py-2 text-sm ${pkg.status === 'REVISION_REQUIRED' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-indigo-100 bg-indigo-50/50 text-slate-800'}`} data-testid="weekly-oh-note">
          <p className="text-[11px] font-bold uppercase tracking-wide">{pkg.status === 'REVISION_REQUIRED' ? 'Revision requested' : 'CEO review'} - {pkg.ohReviewer}, {timeLabel(pkg.ohReviewedAt)}</p>
          {pkg.ohComment ? <p className="mt-1 whitespace-pre-wrap">{pkg.ohComment}</p> : null}
        </div>
      ) : null}
      {showHistory && pkg.events && pkg.events.length > 0 ? (
        <ol className="space-y-1 border-l border-slate-200 pl-4" aria-label="Weekly report history">
          {pkg.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="text-xs text-slate-700 relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-300" aria-hidden="true" />
              <b>{ACTION[e.action] ?? e.action}</b> by {e.actor} <span className="text-slate-400">- {timeLabel(e.at)}</span>
              {e.revision > 1 ? <span className="text-slate-400"> (revision {e.revision})</span> : null}
              {e.comment ? <span className="block text-slate-600 whitespace-pre-wrap">"{e.comment}"</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
};

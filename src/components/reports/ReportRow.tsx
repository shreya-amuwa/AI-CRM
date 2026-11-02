import React from 'react';
import type { WorkReportSummary } from '../../../shared/contracts';
import { ApprovalSteps, dateLabel, periodLabel, StatusPill } from './reportUi';

/** One report in a list: a button that opens it. Used wherever reports are listed (my reports, the inbox, the boxes). */
export const ReportRow: React.FC<{
  r: WorkReportSummary;
  onOpen: (id: string) => void;
  showAuthor?: boolean;
  extra?: React.ReactNode;
}> = ({ r, onOpen, showAuthor, extra }) => (
  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-200 transition-colors">
    <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-lg" aria-label={`Open report ${r.title}`}>
      <span className="block text-sm font-semibold text-slate-900 truncate">{r.title}</span>
      <span className="block text-[11px] text-slate-500 mt-0.5">
        {showAuthor ? <>{r.author}{r.designation ? ` (${r.designation})` : ''} - </> : null}
        {periodLabel(r.periodStart, r.periodEnd)}
        {r.submittedAt ? <> - submitted {dateLabel(r.submittedAt)}</> : null}
        {r.revision > 1 ? <> - revision {r.revision}</> : null}
      </span>
      {r.excerpt ? <span className="block text-xs text-slate-600 mt-1 line-clamp-2">{r.excerpt}</span> : null}
      {r.reviewComment && (r.status === 'REVISION_REQUIRED' || r.status === 'REJECTED' || r.kind !== 'MEMBER')
        ? <span className="block text-xs text-indigo-800 mt-1 line-clamp-2">{r.reviewedBy ?? 'Reviewer'}{r.decisionStage === 'DEPARTMENT_HEAD' ? ' (Department Head)' : r.decisionStage === 'TEAM_LEAD' ? ' (Team Lead)' : ''}: {r.reviewComment}</span> : null}
    </button>
    <div className="shrink-0 flex flex-col items-end gap-1.5">
      <StatusPill status={r.status} kind={r.kind} />
      {r.kind === 'MEMBER' && r.status !== 'DRAFT' ? <ApprovalSteps tl={r.tlStatus} dh={r.dhStatus} /> : null}
      {extra}
    </div>
  </div>
);

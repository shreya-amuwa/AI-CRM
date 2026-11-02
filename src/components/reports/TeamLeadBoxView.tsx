import React, { useMemo } from 'react';
import type { TeamLeadBox, WorkReportDetail } from '../../../shared/contracts';
import { ReportRow } from './ReportRow';
import { Box, Chip, dateLabel, StatusPill } from './reportUi';

// The statuses a Team Member report can be in, grouped the way a Department Head and an Operations Head read them
const GROUPS: { id: string; title: string; statuses: string[]; tone: string }[] = [
  { id: 'TL', title: 'Pending Team Lead Approval', statuses: ['SUBMITTED', 'UNDER_REVIEW'], tone: 'text-sky-700' },
  { id: 'DH', title: 'Pending Department Head Approval', statuses: ['PENDING_DEPARTMENT_HEAD'], tone: 'text-violet-700' },
  { id: 'OK', title: 'Fully Approved', statuses: ['APPROVED'], tone: 'text-emerald-700' },
  { id: 'BACK', title: 'Rejected / Revision Required', statuses: ['REJECTED', 'REVISION_REQUIRED'], tone: 'text-amber-800' }
];

/**
 * A Team Lead's box, for the Department Head and the Operations Head: the counts on the header, and inside
 *   A. the Team Lead's own individual report, and
 *   B. the Team Members' reports, grouped by where they are in the two approvals.
 * A report is only "Fully Approved" once the Team Lead and the Department Head both approved it; a Team Lead-approved report that
 * still waits for the Department Head is shown as pending and is never counted as approved. The Department Head sees the reports their
 * Team Leads approved; the Operations Head (`showAll`) also sees the ones still with the Team Lead. Every report keeps its identity.
 */
export const TeamLeadBoxView: React.FC<{
  box: TeamLeadBox;
  onOpen: (id: string) => void;
  /** False when the Operations Head has not been sent the package for this period: only counts are shown. */
  released?: boolean;
  level?: 1 | 2;
  /** The Operations Head also sees the reports still waiting for the Team Lead. */
  showAll?: boolean;
}> = ({ box, onOpen, released = true, level = 2, showAll }) => {
  const groups = useMemo(() => GROUPS.filter(g => showAll || g.id !== 'TL').map(g => ({
    ...g,
    reports: box.memberReports.filter((r: WorkReportDetail) => g.statuses.includes(r.status))
  })), [box.memberReports, showAll]);
  const c = box.counts;
  const leadStatus = box.leadReportStatus ?? box.leadReports[0]?.status ?? null;
  const shown = groups.reduce((n, g) => n + g.reports.length, 0);
  return (
    <Box
      level={level}
      title={box.lead}
      subtitle={<>{box.team ?? 'No team'} - Team Lead{box.lastSubmittedAt ? <> - last submission {dateLabel(box.lastSubmittedAt)}</> : null}</>}
      chips={
        <>
          <Chip label="members" value={box.totalMembers} />
          {showAll && c.pendingTl ? <Chip label="with Team Lead" value={c.pendingTl} tone="info" /> : null}
          <Chip label="pending Dept Head" value={c.pendingDh ?? 0} tone={c.pendingDh ? 'warn' : 'neutral'} />
          <Chip label="fully approved" value={c.approved} tone="good" />
          {c.revision + c.rejected ? <Chip label="rejected / revision" value={c.revision + c.rejected} tone="bad" /> : null}
        </>
      }
      right={<span className="flex flex-col items-end gap-1"><span className="text-[10px] uppercase tracking-wide text-slate-400">Own report</span><StatusPill status={leadStatus} kind="TEAM_LEAD" /></span>}
    >
      {!released ? (
        <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">The reports of this team open once the Department Head sends the department package for this period. The counts above are live.</p>
      ) : (
        <div className="space-y-4">
          <section aria-label={`${box.lead} individual report`}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">A. Team Lead individual report</h4>
            {box.leadReports.length === 0 ? <p className="text-xs text-slate-500">No individual report submitted in this period.</p> : (
              <ul className="space-y-2">{box.leadReports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
            )}
          </section>
          <section aria-label={`${box.lead} team member reports`}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">B. Team Member reports</h4>
            {shown === 0 ? (
              <p className="text-xs text-slate-500">No Team Member report to show in this period{!showAll && c.pendingTl ? ` (${c.pendingTl} still with the Team Lead)` : ''}.</p>
            ) : (
              <div className="space-y-3">
                {groups.filter(g => g.reports.length > 0).map(g => (
                  <div key={g.id} data-testid={`group-${g.id}`}>
                    <h5 className={`text-[11px] font-bold uppercase tracking-wide mb-1.5 ${g.tone}`}>{g.title} <span className="tabular-nums">({g.reports.length})</span></h5>
                    <ul className="space-y-2">{g.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} showAuthor /></li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Box>
  );
};

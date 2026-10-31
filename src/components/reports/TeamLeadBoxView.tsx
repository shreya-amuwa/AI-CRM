import React, { useMemo } from 'react';
import type { TeamLeadBox, WorkReportDetail } from '../../../shared/contracts';
import { ReportContentView } from './ReportContentView';
import { ReportRow } from './ReportRow';
import { Box, Chip, dateLabel, periodLabel, StatusPill } from './reportUi';

/** One member's approved report, open in place: what was done, the Team Lead's decision and the dates. */
const MemberReportCard: React.FC<{ r: WorkReportDetail; onOpen: (id: string) => void }> = ({ r, onOpen }) => (
  <article className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" aria-label={`Report ${r.title}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h5 className="text-sm font-semibold text-slate-900">{r.title}</h5>
        <p className="text-[11px] text-slate-500">
          {periodLabel(r.periodStart, r.periodEnd)} - submitted {dateLabel(r.submittedAt)}
          {r.reviewedAt ? <> - approved {dateLabel(r.reviewedAt)}{r.reviewedBy ? ` by ${r.reviewedBy}` : ''}</> : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill status={r.status} />
        <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => onOpen(r.id)}>Open full report</button>
      </div>
    </div>
    {r.reviewComment ? <p className="text-xs text-indigo-900 bg-indigo-50/60 rounded-lg px-2.5 py-1.5"><b>Team Lead comment:</b> {r.reviewComment}</p> : null}
    <ReportContentView kind={r.kind} content={r.content} compact />
  </article>
);

/**
 * A Team Lead's box, for the Department Head and the Operations Head: the counts on the header, and inside (A) the Team Lead's own
 * individual report(s) and (B) the Team Members' reports their Team Lead APPROVED, one expandable card per member. Pending, rejected
 * and returned reports are only counted: they are never shown as approved. Every report keeps its own identity (nothing is merged).
 */
export const TeamLeadBoxView: React.FC<{
  box: TeamLeadBox;
  onOpen: (id: string) => void;
  /** False when the Operations Head has not been sent the package for this period: only counts are shown. */
  released?: boolean;
  level?: 1 | 2;
}> = ({ box, onOpen, released = true, level = 2 }) => {
  const byMember = useMemo(() => {
    const m = new Map<string, { id: string; name: string; designation: string | null; reports: WorkReportDetail[] }>();
    for (const r of box.memberReports) {
      const k = r.authorId ?? r.author;
      const e = m.get(k) ?? { id: k, name: r.author, designation: r.designation, reports: [] };
      e.reports.push(r);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [box.memberReports]);
  const c = box.counts;
  const leadStatus = box.leadReportStatus ?? box.leadReports[0]?.status ?? null;
  return (
    <Box
      level={level}
      title={box.lead}
      subtitle={<>{box.team ?? 'No team'} - Team Lead{box.lastSubmittedAt ? <> - last submission {dateLabel(box.lastSubmittedAt)}</> : null}</>}
      chips={
        <>
          <Chip label="members" value={box.totalMembers} />
          <Chip label="submitted" value={c.submitted} tone="info" />
          <Chip label="approved" value={c.approved} tone="good" />
          <Chip label="pending" value={c.pending} tone={c.pending ? 'warn' : 'neutral'} />
          {c.revision ? <Chip label="revision" value={c.revision} tone="warn" /> : null}
          {c.rejected ? <Chip label="rejected" value={c.rejected} tone="bad" /> : null}
        </>
      }
      right={<span className="flex flex-col items-end gap-1"><span className="text-[10px] uppercase tracking-wide text-slate-400">Own report</span><StatusPill status={leadStatus} /></span>}
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
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">B. Team Members' approved reports</h4>
            {byMember.length === 0 ? (
              <p className="text-xs text-slate-500">No approved Team Member reports in this period{c.pending ? ` (${c.pending} still waiting for the Team Lead)` : ''}.</p>
            ) : (
              <div className="space-y-2">
                {byMember.map(m => (
                  <Box
                    key={m.id}
                    level={3}
                    title={m.name}
                    subtitle={m.designation ?? 'Team Member'}
                    chips={<Chip label={m.reports.length === 1 ? 'approved report' : 'approved reports'} value={m.reports.length} tone="good" />}
                  >
                    <div className="space-y-2">{m.reports.map(r => <MemberReportCard key={r.id} r={r} onOpen={onOpen} />)}</div>
                  </Box>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Box>
  );
};

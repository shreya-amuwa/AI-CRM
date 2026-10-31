import React, { useCallback, useEffect, useState } from 'react';
import type { TeamReportBox } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { ReportRow } from './ReportRow';
import { Box, Chip, PeriodBar, presetPeriod, StatusPill, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * The Team Lead's collective report box: built live from the members' own reports (nothing is copied): the team, the counts for the
 * period, and one expandable card per member with that member's reports, each opening on its own. Updates when a report is submitted,
 * approved, returned, rejected or resubmitted, because the box is read from the reports every time.
 */
export const TeamCollectiveBox: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('WEEK'));
  const [box, setBox] = useState<TeamReportBox | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    workReportsApi.teamBox(period.from, period.to).then(setBox, e => { setBox(null); setError(errText(e)); });
  }, [period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Team report box</h2>
          <p className="text-xs text-slate-500">{box ? <>{box.team ?? 'Your team'} - Team Lead {box.teamLead}</> : 'Your team, compiled from the members\' own reports.'}</p>
        </div>
        <PeriodBar value={period} onChange={setPeriod} />
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!box && !error ? <Spinner /> : null}
      {box ? (
        <div className="space-y-3" data-testid="team-box">
          <div className="flex flex-wrap gap-1.5">
            <Chip label="team members" value={box.totalMembers} />
            <Chip label="submitted" value={box.counts.submitted} tone="info" />
            <Chip label="pending" value={box.counts.pending} tone={box.counts.pending ? 'warn' : 'neutral'} />
            <Chip label="approved" value={box.counts.approved} tone="good" />
            <Chip label="revision required" value={box.counts.revision} tone={box.counts.revision ? 'warn' : 'neutral'} />
            <Chip label="rejected" value={box.counts.rejected} tone={box.counts.rejected ? 'bad' : 'neutral'} />
          </div>
          {box.members.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No team members are assigned to you yet.</p> : (
            <div className="space-y-2">
              {box.members.map(m => (
                <Box
                  key={m.id}
                  level={2}
                  title={m.name}
                  subtitle={m.designation ?? 'Team Member'}
                  chips={
                    <>
                      <Chip label="submitted" value={m.counts.submitted} tone="info" />
                      <Chip label="approved" value={m.counts.approved} tone="good" />
                      <Chip label="pending" value={m.counts.pending} tone={m.counts.pending ? 'warn' : 'neutral'} />
                      {m.counts.revision ? <Chip label="revision" value={m.counts.revision} tone="warn" /> : null}
                    </>
                  }
                  right={<StatusPill status={m.reports[0]?.status ?? null} />}
                >
                  {m.reports.length === 0 ? <p className="text-xs text-slate-500">No report in this period yet.</p> : (
                    <ul className="space-y-2">{m.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
                  )}
                </Box>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-500">Only reports you approve are passed to your Department Head with your own individual report. Pending, returned and rejected reports stay here.</p>
        </div>
      ) : null}
    </Card>
  );
};

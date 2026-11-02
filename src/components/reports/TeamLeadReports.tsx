import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeamReportBox, WorkReportSummary } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { ReportRow } from './ReportRow';
import { Box, Chip, PeriodBar, presetPeriod, StatusPill, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const sumTasks = (list: WorkReportSummary[]) => list.reduce((t, r) => ({ a: t.a + (r.assignedCount ?? 0), c: t.c + (r.completedCount ?? 0) }), { a: 0, c: 0 });

/**
 * The Team Lead's collective daily reporting box: ONE expandable box for the team, built live from the individual reports (nothing is
 * combined or copied). Opened, it shows the Team Lead's own daily report, then each Team Member's report with the Team Lead approval, the
 * Department Head approval and the task completion. It follows the reports every time they change (submitted, approved, returned,
 * resubmitted) because it is read from them.
 */
export const TeamCollectiveBox: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('TODAY'));
  const [box, setBox] = useState<TeamReportBox | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    workReportsApi.teamBox(period.from, period.to).then(b => { setError(''); setBox(b); }, e => { setError(errText(e)); });
  }, [period.from, period.to]);
  useEffect(() => { setBox(null); }, [period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  const totals = useMemo(() => {
    const all = [...(box?.myReports ?? []), ...(box?.members ?? []).flatMap(m => m.reports)];
    return sumTasks(all);
  }, [box]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Team Reporting Overview</h2>
          <p className="text-xs text-slate-500">{box ? <>{box.team ?? 'Your team'} - Team Lead {box.teamLead}</> : 'Your team, compiled from the individual reports.'}</p>
        </div>
        <PeriodBar value={period} onChange={setPeriod} />
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!box && !error ? <Spinner /> : null}
      {box ? (
        <div data-testid="team-box">
          <Box
            level={1}
            defaultOpen
            title={`${box.team ?? 'Your team'} - daily reporting`}
            subtitle={`Team Lead ${box.teamLead}`}
            chips={
              <>
                <Chip label="team members" value={box.totalMembers} />
                <Chip label="pending your approval" value={box.counts.pendingTl ?? box.counts.pending} tone={(box.counts.pendingTl ?? box.counts.pending) ? 'warn' : 'neutral'} />
                <Chip label="with Department Head" value={box.counts.pendingDh ?? 0} tone="info" />
                <Chip label="fully approved" value={box.counts.approved} tone="good" />
                <Chip label="revision / rejected" value={box.counts.revision + box.counts.rejected} tone={box.counts.revision + box.counts.rejected ? 'bad' : 'neutral'} />
                <Chip label="tasks completed / assigned" value={`${totals.c}/${totals.a}`} />
              </>
            }
          >
            <div className="space-y-4">
              <section aria-label="Team Lead own daily report">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team Lead's own daily report</h4>
                {box.myReports.length === 0 ? <p className="text-xs text-slate-500">You have not submitted your own report for this period.</p> : (
                  <ul className="space-y-2">{box.myReports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
                )}
              </section>
              <section aria-label="Team Member daily reports">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team Member daily reports</h4>
                {box.members.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No team members are assigned to you yet.</p> : (
                  <div className="space-y-2">
                    {box.members.map(m => {
                      const t = sumTasks(m.reports);
                      return (
                        <Box
                          key={m.id}
                          level={2}
                          title={m.name}
                          subtitle={m.designation ?? 'Team Member'}
                          chips={
                            <>
                              <Chip label="fully approved" value={m.counts.approved} tone="good" />
                              <Chip label="pending" value={m.counts.pending} tone={m.counts.pending ? 'warn' : 'neutral'} />
                              {m.counts.revision ? <Chip label="revision" value={m.counts.revision} tone="warn" /> : null}
                              <Chip label="tasks done / assigned" value={`${t.c}/${t.a}`} />
                            </>
                          }
                          right={<StatusPill status={m.reports[0]?.status ?? null} kind="MEMBER" />}
                        >
                          {m.reports.length === 0 ? <p className="text-xs text-slate-500">No report in this period yet.</p> : (
                            <ul className="space-y-2">{m.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
                          )}
                        </Box>
                      );
                    })}
                  </div>
                )}
              </section>
              <p className="text-[11px] text-slate-500">A report you approve goes to your Department Head, whose approval makes it fully approved. Your own report goes straight to the Department Head.</p>
            </div>
          </Box>
        </div>
      ) : null}
    </Card>
  );
};

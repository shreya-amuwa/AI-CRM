import React, { useCallback, useEffect, useState } from 'react';
import { PERFORMANCE_STAGE_LABEL } from '../../../../shared/reportFields';
import type { HrReviewDepartment, SaConsolidated, SaConsolidatedListItem } from '../../../../shared/contracts';
import { ApiError } from '../../../lib/api/client';
import { hrReviewsApi, reportPerformanceApi } from '../../../lib/api/reportPerformance';
import { Card, ErrorBanner, Spinner } from '../../team-member/pipeline/shared';
import { DepartmentReview } from '../../hr/ReviewPeople';
import { StatsGrid } from '../../reports/DailySummary';
import { OperationsReports } from '../../reports/OperationsReports';
import { Box, Chip, dateLabel, pctLabel, timeLabel, WeeklyStatusPill } from '../../reports/reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const DepartmentDetail: React.FC<{ packageId: string; onOpenReport: (id: string) => void }> = ({ packageId, onOpenReport }) => {
  const [d, setD] = useState<HrReviewDepartment | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { hrReviewsApi.department(packageId).then(setD, e => setError(errText(e))); }, [packageId]);
  if (error) return <ErrorBanner message={error} />;
  if (!d) return <Spinner />;
  // read only: the Super Admin sees the HR reviews and the figures; HR writes the reviews
  return <DepartmentReview detail={d} onSaved={() => undefined} onOpenReport={onOpenReport} />;
};

const ConsolidatedBody: React.FC<{ id: string; onOpenReport: (id: string) => void }> = ({ id, onOpenReport }) => {
  const [c, setC] = useState<SaConsolidated | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { reportPerformanceApi.consolidated(id).then(setC, e => setError(errText(e))); }, [id]);
  if (error) return <ErrorBanner message={error} />;
  if (!c) return <Spinner />;
  return (
    <div className="space-y-3">
      {c.note ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800"><b>HR note:</b> {c.note}</p> : null}
      {c.snapshot && (c.snapshot.pending.length > 0 || c.snapshot.notReceived.length > 0) ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          When HR submitted this: {c.snapshot.pending.length} department{c.snapshot.pending.length === 1 ? '' : 's'} still had reviews pending ({c.snapshot.pending.map(d => d.department).join(', ') || 'none'}) and {c.snapshot.notReceived.length} had not sent a weekly report ({c.snapshot.notReceived.map(d => d.department).join(', ') || 'none'}). They are not part of this report.
        </p>
      ) : null}
      {c.departments.map(d => (
        <Box key={d.packageId} level={2} title={d.department} subtitle={<>Department Head: {d.departmentHeads.join(', ') || 'none'}</>}
          chips={<><Chip label="reports submitted" value={`${d.stats.submitted}/${d.stats.expected}`} /><Chip label="compliance" value={pctLabel(d.stats.compliance)} /><Chip label="task completion" value={pctLabel(d.stats.completionRate)} /><Chip label="HR average rating" value={d.avgRating ?? 'none'} tone="info" /></>}
          right={<WeeklyStatusPill status={d.package.status} />}>
          <div className="space-y-3"><StatsGrid stats={d.stats} /><DepartmentDetail packageId={d.packageId} onOpenReport={onOpenReport} /></div>
        </Box>
      ))}
    </div>
  );
};

/**
 * Company Reports: the consolidated performance reports HR submitted (newest first). Opening one shows its departments with the figures, then
 * each department down to its Team Leads and Team Members with the HR reviews. Below, the live weekly reports of every department.
 */
export const CompanyReports: React.FC<{ reloadKey: number; onOpenReport: (id: string) => void }> = ({ reloadKey, onOpenReport }) => {
  const [list, setList] = useState<SaConsolidatedListItem[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { reportPerformanceApi.consolidatedList().then(l => { setError(''); setList(l); }, e => setError(errText(e))); }, []);
  useEffect(load, [load, reloadKey]);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Consolidated Performance Reports from HR</h2>
        <p className="text-xs text-slate-500 mb-3">Each one holds the departments whose weekly report was approved by the CEO and whose every Team Lead and Team Member HR reviewed.</p>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {list === null ? <Spinner /> : list.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">HR has not submitted a consolidated report yet.</p> : (
          <div className="space-y-3" data-testid="consolidated-list">
            {list.map(c => (
              <Box key={c.id} level={1} title={`Week ${dateLabel(c.weekStart)} - ${dateLabel(c.weekEnd)}`} subtitle={<>Submitted by {c.submittedBy ?? '-'}, {timeLabel(c.submittedAt)} - revision {c.revision}</>}
                chips={<><Chip label="departments" value={c.departments} /><Chip label={c.analysis ? `analysis (${c.analysis.source === 'AI' ? 'AI' : 'rules'})` : 'analysis'} value={c.analysis ? 'ready' : 'waiting'} tone={c.analysis ? 'good' : 'warn'} /></>}
                right={<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">{PERFORMANCE_STAGE_LABEL[c.status]}</span>}>
                <ConsolidatedBody id={c.id} onOpenReport={onOpenReport} />
              </Box>
            ))}
          </div>
        )}
      </Card>
      <OperationsReports reloadKey={reloadKey} onOpen={onOpenReport} canDecide={false} withInbox={false} />
    </div>
  );
};

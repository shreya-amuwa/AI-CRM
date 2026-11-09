import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReportsDepartmentDetail, WeeklyBoard, WeeklyBoardDepartment } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { weeklyReportsApi, workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { TeamStatsTable } from './DailySummary';
import { ReportRow } from './ReportRow';
import { ReviewInbox } from './ReviewInbox';
import { TeamLeadBoxView } from './TeamLeadBoxView';
import { Box, Chip, dateLabel, pctLabel, Stat, todayIso, WeekPicker, weekOf, WeeklyStatusPill } from './reportUi';
import { WeeklyPackageView } from './WeeklyPackageView';
import { WeeklyReviewPanel } from './WeeklyApprovals';

const fnLabel = (f?: string) => (f === 'SALES' ? ' - Sales' : f === 'SUPPORT' ? ' - Support' : '');
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * One department opened, as nested boxes:
 *   Level 1  the Department Head: the weekly summary and the Head's own daily reports,
 *   Level 2  a box per Team Lead: the lead's own reports and the team-wise summary,
 *   Level 3  the Team Members' daily reports with both approvals.
 * The daily reports are read from their own records; the weekly summary only points at them.
 */
const DepartmentBody: React.FC<{ row: WeeklyBoardDepartment; weekStart: string; weekEnd: string; reloadKey: number; onOpen: (id: string) => void; canDecide: boolean; onDecided: () => void }> = ({ row, weekStart, weekEnd, reloadKey, onOpen, canDecide, onDecided }) => {
  const [detail, setDetail] = useState<ReportsDepartmentDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    workReportsApi.operationsDepartment(row.id, weekStart, weekEnd).then(d => { setError(''); setDetail(d); }, e => setError(errText(e)));
  }, [row.id, weekStart, weekEnd]);
  useEffect(() => { setDetail(null); }, [row.id, weekStart]);
  useEffect(load, [load, reloadKey]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!detail) return <Spinner />;
  return (
    <div className="space-y-4">
      {!detail.released ? (
        <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900" role="status">
          The Department Head has not submitted the weekly report for this week yet. The daily reports open once it is submitted; the figures are live.
        </p>
      ) : null}
      <section aria-label="Level 1: Department Head">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Level 1 - Department Head</h4>
        <WeeklyPackageView pkg={detail.package} />
        {canDecide && detail.package.status === 'PENDING_OPERATIONS_HEAD' && detail.package.id ? <div className="mt-3"><WeeklyReviewPanel packageId={detail.package.id} onDone={() => { onDecided(); load(); }} /></div> : null}
        <div className="mt-3 space-y-2">
          {detail.departmentHeads.length === 0 ? <p className="text-xs text-slate-500">No active Department Head.</p> : detail.departmentHeads.map(h => (
            <div key={h.id}>
              <p className="text-sm font-semibold text-slate-800 mb-1">{h.name} - daily reports</p>
              {!detail.released ? <p className="text-xs text-slate-500">Opens when the weekly report is submitted.</p> : h.reports.length === 0 ? <p className="text-xs text-slate-500">No daily report in this week.</p> : (
                <ul className="space-y-2">{h.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
              )}
            </div>
          ))}
        </div>
      </section>
      <section aria-label="Level 2: Team Leads">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Level 2 and 3 - Team Leads and Team Members</h4>
        {detail.stats ? <div className="mb-3"><TeamStatsTable stats={detail.stats} /></div> : null}
        {detail.teamLeads.length === 0 ? <p className="text-xs text-slate-500">No Team Leads in this department.</p> : (
          <div className="space-y-2">{detail.teamLeads.map(b => <TeamLeadBoxView key={b.leadId} box={b} onOpen={onOpen} released={detail.released} showAll />)}</div>
        )}
      </section>
    </div>
  );
};

/**
 * The company's weekly reports for the Operations Head (and the Super Admin): one expandable box per department, read from the database.
 * Each box shows the week's figures worked out from the daily reports and the status of the weekly report; opening it drills down from the
 * Department Head to the Team Leads and every Team Member.
 */
export const OperationsReports: React.FC<{ reloadKey: number; onOpen: (id: string) => void; canDecide?: boolean; withInbox?: boolean }> = ({ reloadKey, onOpen, canDecide = true, withInbox = true }) => {
  const [week, setWeek] = useState(() => weekOf(todayIso()).start);
  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [bump, setBump] = useState(0);

  const load = useCallback(() => {
    weeklyReportsApi.board(week).then(b => { setError(''); setBoard(b); }, e => setError(errText(e)));
  }, [week]);
  useEffect(() => { setBoard(null); }, [week]);
  useEffect(load, [load, reloadKey, bump]);

  const rows = useMemo(() => (board?.departments ?? []).filter(d => !search.trim() || d.name.toLowerCase().includes(search.trim().toLowerCase()) || d.departmentHeads.some(h => h.toLowerCase().includes(search.trim().toLowerCase()))), [board, search]);

  return (
    <div className="space-y-4">
      {withInbox ? <ReviewInbox title="Department Head daily reports awaiting your decision" emptyText="No Department Head daily report is waiting for you." period={{ from: week, to: weekOf(week).end }} reloadKey={reloadKey} onOpen={onOpen} /> : null}
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Department reports</h2>
            <p className="text-xs text-slate-500">Open a department to see its Department Head, Team Leads and Team Members.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <input className={`${inputCls} !w-48 !py-1.5`} placeholder="Search department or head" aria-label="Search departments" value={search} onChange={e => setSearch(e.target.value)} />
            <WeekPicker value={week} onChange={setWeek} />
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {!board && !error ? <Spinner /> : null}
        {board ? (
          rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{board.departments.length === 0 ? 'No department is assigned to you yet.' : 'No department matches.'}</p> : (
            <div className="space-y-3" data-testid="operations-boxes">
              {rows.map(d => {
                const s = d.stats;
                const outstanding = s.pendingTl + s.pendingDh + s.pendingOh;
                return (
                  <Box
                    key={d.key ?? d.id}
                    level={1}
                    title={d.name + fnLabel(d.function)}
                    subtitle={<>Department Head: {d.departmentHeads.length ? d.departmentHeads.join(', ') : 'none'} - Week {dateLabel(board.weekStart)} to {dateLabel(board.weekEnd)}{d.routingIssue ? <span className="block text-rose-700 font-semibold" role="note">{d.routingIssue}</span> : null}</>}
                    chips={
                      <>
                        <Chip label="Team Leads" value={s.teamLeads} />
                        <Chip label="Team Members" value={s.members} />
                        <Chip label="reports expected" value={s.expected} />
                        <Chip label="submitted" value={s.submitted} tone="info" />
                        <Chip label="fully approved" value={s.approved} tone="good" />
                        <Chip label="outstanding approvals" value={outstanding} tone={outstanding ? 'warn' : 'neutral'} />
                        <Chip label="task completion" value={pctLabel(s.completionRate)} />
                      </>
                    }
                    right={<span className="flex flex-col items-end gap-1"><span className="text-[10px] uppercase tracking-wide text-slate-400">Weekly report</span><WeeklyStatusPill status={d.package.status} /></span>}
                  >
                    <DepartmentBody row={d} weekStart={board.weekStart} weekEnd={board.weekEnd} reloadKey={reloadKey} onOpen={onOpen} canDecide={canDecide} onDecided={() => setBump(b => b + 1)} />
                  </Box>
                );
              })}
            </div>
          )
        ) : null}
      </Card>
    </div>
  );
};

/** The Reporting Overview: every department's week in one table (compliance, approvals, task completion, weekly status). */
export const ReportingOverview: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [week, setWeek] = useState(() => weekOf(todayIso()).start);
  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { weeklyReportsApi.board(week).then(b => { setError(''); setBoard(b); }, e => setError(errText(e))); }, [week]);
  useEffect(() => { setBoard(null); }, [week]);
  useEffect(load, [load, reloadKey]);
  const totals = useMemo(() => {
    const t = { expected: 0, submitted: 0, approved: 0, outstanding: 0, assigned: 0, completed: 0 };
    for (const d of board?.departments ?? []) { t.expected += d.stats.expected; t.submitted += d.stats.submitted; t.approved += d.stats.approved; t.outstanding += d.stats.pendingTl + d.stats.pendingDh + d.stats.pendingOh; t.assigned += d.stats.assignedTasks; t.completed += d.stats.completedTasks; }
    return t;
  }, [board]);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div><h2 className="text-base font-bold text-slate-900">Reporting Overview</h2><p className="text-xs text-slate-500">All your departments for the week, from the daily reports.</p></div>
        <WeekPicker value={week} onChange={setWeek} />
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!board && !error ? <Spinner /> : null}
      {board ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Reports expected" value={totals.expected} />
            <Stat label="Submitted" value={totals.submitted} tone="info" />
            <Stat label="Fully approved" value={totals.approved} tone="good" />
            <Stat label="Outstanding approvals" value={totals.outstanding} tone={totals.outstanding ? 'warn' : 'neutral'} />
            <Stat label="Tasks completed" value={`${totals.completed}/${totals.assigned}`} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <caption className="sr-only">Departments for the week</caption>
              <thead className="bg-slate-50 text-slate-500"><tr>{['Department', 'Department Head', 'Expected', 'Submitted', 'Approved', 'Outstanding', 'Task completion', 'Compliance', 'Weekly report'].map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {board.departments.map(d => (
                  <tr key={d.key ?? d.id}>
                    <th scope="row" className="px-3 py-2 text-left font-semibold text-slate-800">{d.name + fnLabel(d.function)}</th>
                    <td className="px-3 py-2">{d.departmentHeads.join(', ') || '-'}</td>
                    <td className="px-3 py-2 tabular-nums">{d.stats.expected}</td>
                    <td className="px-3 py-2 tabular-nums">{d.stats.submitted}</td>
                    <td className="px-3 py-2 tabular-nums">{d.stats.approved}</td>
                    <td className="px-3 py-2 tabular-nums">{d.stats.pendingTl + d.stats.pendingDh + d.stats.pendingOh}</td>
                    <td className="px-3 py-2 tabular-nums">{pctLabel(d.stats.completionRate)}</td>
                    <td className="px-3 py-2 tabular-nums">{pctLabel(d.stats.compliance)}</td>
                    <td className="px-3 py-2"><WeeklyStatusPill status={d.package.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {board.departments.length === 0 ? <p className="text-center text-sm text-slate-500">No department is assigned to you yet.</p> : null}
        </div>
      ) : null}
    </Card>
  );
};

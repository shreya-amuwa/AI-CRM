import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperationsDepartmentRow, OperationsReportBoard, ReportsDepartmentDetail } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { ReportRow } from './ReportRow';
import { ReviewInbox } from './ReviewInbox';
import { TeamLeadBoxView } from './TeamLeadBoxView';
import { Box, Chip, dateLabel, PeriodBar, periodLabel, presetPeriod, StatusPill, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** One department opened: Level 1 the Department Head's report, Level 2 a box per Team Lead, Level 3 a card per Team Member. */
const DepartmentBody: React.FC<{ row: OperationsDepartmentRow; period: Period; reloadKey: number; onOpen: (id: string) => void; onPeriod: (p: Period) => void }> = ({ row, period, reloadKey, onOpen, onPeriod }) => {
  const [detail, setDetail] = useState<ReportsDepartmentDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    workReportsApi.operationsDepartment(row.id, period.from, period.to).then(setDetail, e => { setDetail(null); setError(errText(e)); });
  }, [row.id, period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!detail) return <Spinner />;
  return (
    <div className="space-y-4">
      {!detail.released ? (
        <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900" role="status">
          The Department Head has not sent the department package for this period yet. The reports open once it is sent; the counts are live.
          {detail.packages.length > 0 ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              Packages sent:
              {detail.packages.map(k => (
                <button key={k.id} type="button" className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50" onClick={() => onPeriod({ type: k.periodType, from: k.periodStart, to: k.periodEnd })}>
                  {periodLabel(k.periodStart, k.periodEnd)}
                </button>
              ))}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Package sent {dateLabel(detail.package.submittedAt)} by {detail.package.submittedBy}.{detail.package.note ? <> <b>Department observations:</b> {detail.package.note}</> : null}</p>
      )}
      <section aria-label="Department Head individual report">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Level 1 - Department Head individual report</h4>
        {detail.departmentHeads.length === 0 ? <p className="text-xs text-slate-500">No active Department Head.</p> : detail.departmentHeads.map(h => (
          <div key={h.id} className="mb-2">
            <p className="text-sm font-semibold text-slate-800 mb-1">{h.name}</p>
            {!detail.released ? <p className="text-xs text-slate-500">Opens when the package is sent.</p> : h.reports.length === 0 ? <p className="text-xs text-slate-500">No individual report submitted in this period.</p> : (
              <ul className="space-y-2">{h.reports.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
            )}
          </div>
        ))}
      </section>
      <section aria-label="Team Leads">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Level 2 - Team Leads and Level 3 - Team Members</h4>
        {detail.teamLeads.length === 0 ? <p className="text-xs text-slate-500">No Team Leads in this department.</p> : (
          <div className="space-y-2">{detail.teamLeads.map(b => <TeamLeadBoxView key={b.leadId} box={b} onOpen={onOpen} released={detail.released} />)}</div>
        )}
      </section>
    </div>
  );
};

/**
 * The Operations Head's company reports: one expandable box per department the head is accountable for (read from the database, no
 * department is named in the code). Opening a box shows the whole chain in one place: the Department Head, the Team Leads and, inside each,
 * the Team Members' approved reports, as nested expandable boxes.
 */
export const OperationsReports: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('WEEK'));
  const [board, setBoard] = useState<OperationsReportBoard | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setError('');
    workReportsApi.operations(period.from, period.to).then(setBoard, e => { setBoard(null); setError(errText(e)); });
  }, [period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  const rows = useMemo(() => (board?.departments ?? []).filter(d => !search.trim() || d.name.toLowerCase().includes(search.trim().toLowerCase()) || d.departmentHeads.some(h => h.toLowerCase().includes(search.trim().toLowerCase()))), [board, search]);

  return (
    <div className="space-y-4">
      <ReviewInbox title="Department Head reports awaiting your decision" emptyText="No Department Head report is waiting for you." period={period} reloadKey={reloadKey} onOpen={onOpen} />
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Department reports</h2>
            <p className="text-xs text-slate-500">Open a department to see its Department Head, Team Leads and Team Members.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <input className={`${inputCls} !w-48 !py-1.5`} placeholder="Search department or head" aria-label="Search departments" value={search} onChange={e => setSearch(e.target.value)} />
            <PeriodBar value={period} onChange={setPeriod} />
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {!board && !error ? <Spinner /> : null}
        {board ? (
          rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{board.departments.length === 0 ? 'No department is assigned to you yet.' : 'No department matches.'}</p> : (
            <div className="space-y-3" data-testid="operations-boxes">
              {rows.map(d => (
                <Box
                  key={d.id}
                  level={1}
                  title={d.name}
                  subtitle={<>Department Head: {d.departmentHeads.length ? d.departmentHeads.join(', ') : 'none'} - {dateLabel(period.from)}{period.from === period.to ? '' : ` to ${dateLabel(period.to)}`}{d.lastSubmittedAt ? <> - last submitted {dateLabel(d.lastSubmittedAt)}</> : null}</>}
                  chips={
                    <>
                      <Chip label="Team Leads" value={d.teamLeads} />
                      <Chip label="Team Members" value={d.teamMembers} />
                      <Chip label="reports submitted" value={d.counts.submitted} tone="info" />
                      <Chip label="member reports approved" value={d.counts.memberApproved} tone="good" />
                      <Chip label="member reports pending" value={d.counts.memberPending} tone={d.counts.memberPending ? 'warn' : 'neutral'} />
                      <Chip label="Team Lead reports" value={d.counts.teamLeadReports} />
                    </>
                  }
                  right={
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">Head report</span>
                      <StatusPill status={d.headReportStatus} />
                      <span className={`text-[11px] font-semibold ${d.package.status === 'SUBMITTED' ? 'text-emerald-700' : 'text-slate-400'}`}>{d.package.status === 'SUBMITTED' ? 'Package sent' : 'Package not sent'}</span>
                    </span>
                  }
                >
                  <DepartmentBody row={d} period={period} reloadKey={reloadKey} onOpen={onOpen} onPeriod={setPeriod} />
                </Box>
              ))}
            </div>
          )
        ) : null}
      </Card>
    </div>
  );
};

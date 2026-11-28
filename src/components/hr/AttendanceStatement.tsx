import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Download, FileSpreadsheet, RefreshCw, RotateCcw } from 'lucide-react';
import { attendanceStatementApi } from '../../lib/api/endpoints';
import type { AttendanceStatement as Statement, AttendanceStatementOptions } from '../../../shared/hrUpgrade';
import {
  datesOf, DETAIL_HEADER, detailCells, detailCsv, presetRange, PUNCH_HEADER, punchCells, RANGE_PRESETS, rangeProblem, RECON_HEADER, reconCells, REGISTER_LEGEND,
  STATUS_LABEL, SUMMARY_HEADER, summaryCells, summarySheet, type PunchRow, type RangePreset, type RegisterRow, type StatementRow, type SummaryRow
} from '../../lib/attendanceStatement';
import { csvBlob, writeWorkbook, type XCell, type XSheet } from '../../lib/xlsxWorkbook';
import { saveBlob } from '../../lib/xlsxWriter';
import { confirmAction, toast } from '../feedback/AppFeedback';
import { dismissToast } from '../../lib/feedback/feedbackStore';
import { btn, ErrorBanner, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';
import { HrPageHeader } from './hrUi';

const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);
const hm = (min: number | null | undefined) => (min === null || min === undefined ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);
const t = (iso: unknown) => (typeof iso === 'string' ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '–');
const STORE = 'crm.attendanceStatement.filters';
type View = 'DAILY' | 'SUMMARY' | 'REGISTER';
interface Filters {
  preset: RangePreset; from: string; to: string; departmentIds: string[]; teamIds: string[]; profileIds: string[]; designation: string; employmentType: string;
  employeeStatus: 'ACTIVE' | 'INACTIVE' | 'ALL'; shift: string; statuses: string[];
}
const initialFilters = (): Filters => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (saved && saved.from && saved.to) return saved;
  } catch { /* fresh */ }
  return { preset: 'THIS_MONTH', ...presetRange('THIS_MONTH'), departmentIds: [], teamIds: [], profileIds: [], designation: '', employmentType: '', employeeStatus: 'ACTIVE', shift: '', statuses: [] };
};
const STATUS_FILTERS: [string, string][] = [['PRESENT_ANY', 'Present'], ['ABSENT', 'Absent'], ['LATE_ARRIVAL', 'Late'], ['HALF_DAY', 'Half-day'], ['APPROVED_LEAVE', 'Approved leave'],
  ['WEEKLY_OFF', 'Weekly off'], ['HOLIDAY', 'Holiday'], ['MISSING_PUNCH_OUT', 'Missing punch-out'], ['EARLY_DEPARTURE', 'Early departure'], ['DISCREPANCY', 'Attendance discrepancy']];
const REPORTS: [string, string][] = [['DETAILED', 'Detailed attendance statement'], ['SUMMARY', 'Employee-wise attendance summary'], ['REGISTER', 'Monthly attendance register'],
  ['RAW_PUNCHES', 'Raw punch event report'], ['RECONCILIATION', 'Biometric reconciliation report']];

const toApi = (f: Filters) => ({
  from: f.from, to: f.to, departmentIds: f.departmentIds, teamIds: f.teamIds, profileIds: f.profileIds, designation: f.designation || undefined,
  employmentType: f.employmentType || undefined, employeeStatus: f.employeeStatus, shift: f.shift || undefined, statuses: f.statuses
});

/** A compact multi-select: a searchable list of checkboxes in a disclosure (keyboard and screen reader friendly). */
const MultiPick: React.FC<{ label: string; options: { id: string; name: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void; testId?: string }> = ({ label, options, value, onChange, testId }) => {
  const [q, setQ] = useState('');
  const ref = React.useRef<HTMLDetailsElement>(null);
  const shown = options.filter(o => o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  // a click outside closes the list
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  return (
    <details ref={ref} className="relative text-xs" data-testid={testId}>
      <summary className={`${selectCls} cursor-pointer list-none min-w-[9rem]`}>{label}: {value.length ? `${value.length} selected` : 'All'}</summary>
      <div className="fixed inset-x-4 top-24 sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 z-30 sm:mt-1 sm:w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg space-y-1">
        <input className={inputCls} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${label}`} />
        <div className="max-h-56 overflow-y-auto">
          {shown.map(o => (
            <label key={o.id} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(x => x !== o.id))} />
              <span>{o.name}{o.hint ? <span className="text-slate-400"> · {o.hint}</span> : null}</span>
            </label>
          ))}
          {shown.length === 0 && <p className="text-slate-400 py-1">Nothing found.</p>}
        </div>
        {value.length > 0 && <button type="button" className="text-indigo-700 font-semibold" onClick={() => onChange([])}>Clear</button>}
      </div>
    </details>
  );
};

const Card: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p></div>
);

/**
 * HR > Attendance Statement (docs/hr-dashboard-upgrade.md, Phase 2): the attendance of any period (both dates included, India time), filtered by
 * department, team, employee and status, as a daily statement, an employee summary or a monthly register, and exported to Excel or CSV for the
 * biometric reconciliation. The summary covers everything filtered; the export takes every matching row. The database decides who may (HR).
 */
export const AttendanceStatement: React.FC = () => {
  const [opts, setOpts] = useState<AttendanceStatementOptions | null>(null);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [view, setView] = useState<View>('DAILY');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exp, setExp] = useState<{ open: boolean; format: 'XLSX' | 'CSV'; type: string }>({ open: false, format: 'XLSX', type: 'DETAILED' });
  const problem = rangeProblem(draft.from, draft.to, view === 'REGISTER' ? 62 : view === 'SUMMARY' ? 731 : 366);

  useEffect(() => { attendanceStatementApi.options().then(setOpts, e => setError(errText(e, 'The filters could not be loaded.'))); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await attendanceStatementApi.statement({ ...toApi(applied), view, sort: sort.key, dir: sort.dir, page, pageSize: 50 }));
      setError(null);
    } catch (e) { setError(errText(e, 'The attendance could not be loaded.')); } finally { setLoading(false); }
  }, [applied, view, sort, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(applied)); } catch { /* private mode */ } }, [applied]);

  const people = useMemo(() => (opts?.employees ?? []).filter(e =>
    (draft.departmentIds.length === 0 || draft.departmentIds.includes(e.departmentId)) && (draft.teamIds.length === 0 || (e.teamId && draft.teamIds.includes(e.teamId)))
    && (draft.employeeStatus === 'ALL' || (draft.employeeStatus === 'ACTIVE') === e.active || draft.profileIds.includes(e.id))), [opts, draft]);
  const teams = useMemo(() => (opts?.teams ?? []).filter(x => draft.departmentIds.length === 0 || draft.departmentIds.includes(x.departmentId)), [opts, draft.departmentIds]);
  const choosePreset = (p: RangePreset) => setDraft(d => (p === 'CUSTOM' ? { ...d, preset: p } : { ...d, preset: p, ...presetRange(p) }));
  const apply = () => { if (!problem) { setApplied(draft); setPage(1); } };
  const reset = () => { const f = { ...initialFilters(), preset: 'THIS_MONTH' as RangePreset, ...presetRange('THIS_MONTH'), departmentIds: [], teamIds: [], profileIds: [], designation: '', employmentType: '', employeeStatus: 'ACTIVE' as const, shift: '', statuses: [] }; setDraft(f); setApplied(f); setPage(1); };
  const sortBy = (key: string) => { setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1); };
  const selection = () => {
    const n = (ids: string[], list: { id: string; name: string }[] = []) => ids.map(i => list.find(x => x.id === i)?.name ?? i).join(', ');
    return [applied.departmentIds.length ? `Departments: ${n(applied.departmentIds, opts?.departments)}` : 'All departments',
      applied.teamIds.length ? `Teams: ${n(applied.teamIds, opts?.teams)}` : '', applied.profileIds.length ? `Employees: ${n(applied.profileIds, opts?.employees)}` : '',
      applied.statuses.length ? `Statuses: ${applied.statuses.join(', ')}` : '', applied.employeeStatus !== 'ACTIVE' ? `Employee status: ${applied.employeeStatus}` : ''].filter(Boolean).join('; ');
  };

  /** Fetch every row of a report type, page by page (5000 at a time), then build the file in the browser. Nothing is stored on the server. */
  const runExport = async () => {
    const label = REPORTS.find(r => r[0] === exp.type)?.[1] ?? exp.type;
    const ok = await confirmAction({ title: 'Export the attendance?', description: 'Every record matching the applied filters is exported (not only this page). The export is recorded in the audit log.',
      details: [`Report: ${label}`, `Dates: ${applied.from} to ${applied.to} (both included)`, `Selection: ${selection()}`, `Format: ${exp.format === 'XLSX' ? 'Excel (.xlsx)' : 'CSV (.csv)'}`],
      confirmLabel: 'Export' });
    if (!ok) return;
    setExporting(true);
    const id = toast.loading('Generating the attendance report…');
    try {
      const all: Record<string, unknown>[] = [];
      let meta: { generatedAt: string; generatedBy: string; organization: string; timeZone: string } | null = null;
      for (let offset = 0; ; ) {
        const pageData = await attendanceStatementApi.exportPage({ filters: toApi(applied), type: exp.type, format: exp.format, offset, limit: 5000 });
        meta = meta ?? pageData;
        all.push(...pageData.rows);
        offset += exp.type === 'SUMMARY' || exp.type === 'REGISTER' ? 200 : 5000;
        if (pageData.rows.length === 0 || all.length >= pageData.total) break;
      }
      dismissToast(id);
      if (all.length === 0) { toast.info('No attendance records found for the selected dates.'); return; }
      const base = `attendance-${exp.type.toLowerCase()}-${applied.from}-to-${applied.to}`;
      const rm = { organization: meta!.organization, from: applied.from, to: applied.to, selection: selection(), generatedAt: meta!.generatedAt, generatedBy: meta!.generatedBy, timeZone: meta!.timeZone, type: label };
      if (exp.format === 'CSV') {
        let rows: (string | number | null)[][];
        if (exp.type === 'DETAILED') rows = [DETAIL_HEADER, ...(all as unknown as StatementRow[]).map(detailCsv)];
        else if (exp.type === 'RECONCILIATION') rows = [RECON_HEADER, ...(all as unknown as StatementRow[]).map(r => reconCells(r).map(cellText))];
        else if (exp.type === 'SUMMARY') rows = [SUMMARY_HEADER, ...(all as unknown as SummaryRow[]).map(r => summaryCells(r).map(cellText))];
        else if (exp.type === 'RAW_PUNCHES') rows = [PUNCH_HEADER, ...(all as unknown as PunchRow[]).map(r => punchCells(r).map(cellText))];
        else { const days = datesOf(applied.from, applied.to); rows = [['Employee ID', 'Employee Name', 'Department', ...days], ...(all as unknown as RegisterRow[]).map(r => [r.employeeCode, r.name, r.department ?? '', ...days.map(d => r.days[d] ?? '')])]; }
        saveBlob(csvBlob(rows), `${base}.csv`);
      } else {
        const sheets: XSheet[] = [summarySheet(rm, (data?.summary ?? {}) as unknown as Record<string, number>)];
        if (exp.type === 'DETAILED') sheets.push({ name: 'Detailed Attendance', table: true, widths: [12, 11, 14, 24, 18, 18, 14, 12, 10, 10, 10, 10, 10, 10, 10, 10, 9, 9, 18, 16, 10, 12, 30], rows: [DETAIL_HEADER, ...(all as unknown as StatementRow[]).map(detailCells)] });
        if (exp.type === 'RECONCILIATION') sheets.push({ name: 'Biometric Reconciliation', table: true, widths: [14, 16, 24, 12, 11, 11, 12, 18, 12, 12, 12, 12, 12, 16, 30], rows: [RECON_HEADER, ...(all as unknown as StatementRow[]).map(reconCells)] });
        if (exp.type === 'SUMMARY') sheets.push({ name: 'Employee Summary', table: true, widths: [14, 24, 18, 14, 18, 14, 10, 10, 10, 10, 9, 9, 9, 9, 12, 12, 12], rows: [SUMMARY_HEADER, ...(all as unknown as SummaryRow[]).map(summaryCells)] });
        if (exp.type === 'RAW_PUNCHES') sheets.push({ name: 'Raw Punch Events', table: true, widths: [12, 14, 16, 24, 12, 18, 12, 18, 30], rows: [PUNCH_HEADER, ...(all as unknown as PunchRow[]).map(punchCells)] });
        if (exp.type === 'REGISTER') {
          const days = datesOf(applied.from, applied.to);
          sheets.push({ name: 'Monthly Register', table: true, widths: [14, 24, 18, ...days.map(() => 6)], rows: [['Employee ID', 'Employee Name', 'Department', ...days.map(d => d.slice(5))], ...(all as unknown as RegisterRow[]).map(r => [r.employeeCode, r.name, r.department ?? '', ...days.map(d => r.days[d] ?? '')] as XCell[])] });
        }
        saveBlob(await writeWorkbook(sheets), `${base}.xlsx`);
      }
      toast.success(`Attendance statement downloaded successfully (${all.length} rows).`);
      setExp(e => ({ ...e, open: false }));
    } catch (e) {
      dismissToast(id);
      toast.error(errText(e, 'Unable to generate attendance report. Please try again.'));
    } finally { setExporting(false); }
  };

  const s = data?.summary;
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const Th: React.FC<{ k?: string; children: React.ReactNode }> = ({ k, children }) => (
    <th scope="col" className="px-2 py-2 text-left font-semibold whitespace-nowrap" aria-sort={k && sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {k ? <button type="button" className="hover:text-indigo-700" onClick={() => sortBy(k)}>{children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button> : children}
    </th>
  );

  return (
    <div className="space-y-4" data-testid="attendance-statement">
      <HrPageHeader icon={CalendarRange} title="Attendance Statement" subtitle="Any period, any employees: view, summarise and export the CRM attendance (India time, both dates included) to reconcile it with the biometric machine."
        actions={<button type="button" className={btn.primary} onClick={() => setExp(e => ({ ...e, open: true }))} disabled={!data}><Download className="w-3.5 h-3.5" aria-hidden />Export Attendance</button>} />

      <section className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3" aria-label="Filters">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs font-semibold text-slate-600">Period
            <select className={`${selectCls} block mt-1`} value={draft.preset} onChange={e => choosePreset(e.target.value as RangePreset)} data-testid="preset">
              {RANGE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">From Date
            <input type="date" className={`${inputCls} block mt-1`} value={draft.from} max={draft.to} onChange={e => setDraft(d => ({ ...d, preset: 'CUSTOM', from: e.target.value }))} data-testid="from" /></label>
          <label className="text-xs font-semibold text-slate-600">To Date
            <input type="date" className={`${inputCls} block mt-1`} value={draft.to} min={draft.from} onChange={e => setDraft(d => ({ ...d, preset: 'CUSTOM', to: e.target.value }))} data-testid="to" /></label>
          <MultiPick label="Departments" options={(opts?.departments ?? []).map(d => ({ id: d.id, name: d.name }))} value={draft.departmentIds} onChange={v => setDraft(d => ({ ...d, departmentIds: v, teamIds: [], profileIds: [] }))} testId="pick-departments" />
          <MultiPick label="Teams" options={teams.map(x => ({ id: x.id, name: x.name }))} value={draft.teamIds} onChange={v => setDraft(d => ({ ...d, teamIds: v, profileIds: [] }))} />
          <MultiPick label="Employees" options={people.map(p => ({ id: p.id, name: p.name, hint: p.active ? p.designation ?? undefined : 'inactive' }))} value={draft.profileIds} onChange={v => setDraft(d => ({ ...d, profileIds: v }))} testId="pick-employees" />
          <MultiPick label="Status" options={STATUS_FILTERS.map(([id, name]) => ({ id, name }))} value={draft.statuses} onChange={v => setDraft(d => ({ ...d, statuses: v }))} testId="pick-status" />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs font-semibold text-slate-600">Designation
            <select className={`${selectCls} block mt-1`} value={draft.designation} onChange={e => setDraft(d => ({ ...d, designation: e.target.value }))}>
              <option value="">All</option>{(opts?.designations ?? []).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Employment type
            <select className={`${selectCls} block mt-1`} value={draft.employmentType} onChange={e => setDraft(d => ({ ...d, employmentType: e.target.value }))}>
              <option value="">All</option><option>Full-Time</option><option>Training / Probation</option><option>Intern</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Employee status
            <select className={`${selectCls} block mt-1`} value={draft.employeeStatus} onChange={e => setDraft(d => ({ ...d, employeeStatus: e.target.value as Filters['employeeStatus'] }))}>
              <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive / left (history)</option><option value="ALL">All</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Shift (start)
            <select className={`${selectCls} block mt-1`} value={draft.shift} onChange={e => setDraft(d => ({ ...d, shift: e.target.value }))}>
              <option value="">All</option>{(opts?.shifts ?? []).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          <button type="button" className={btn.primary} onClick={apply} disabled={!!problem || loading} data-testid="apply">Apply Filters</button>
          <button type="button" className={btn.secondary} onClick={reset}><RotateCcw className="w-3.5 h-3.5" aria-hidden />Reset Filters</button>
          <button type="button" className={btn.secondary} onClick={() => void load()} disabled={loading}><RefreshCw className="w-3.5 h-3.5" aria-hidden />Refresh</button>
        </div>
        {problem && <p className="text-xs text-rose-700" role="alert" data-testid="range-problem">{problem}</p>}
      </section>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="statement-cards">
          <Card label="Employees (unique)" value={s.employees} /><Card label="Scheduled working days (employee-days)" value={s.scheduledDays} />
          <Card label="Present days" value={s.presentDays} /><Card label="Absent days" value={s.absentDays} /><Card label="Approved leave days" value={s.approvedLeaveDays} />
          <Card label="Half-days" value={s.halfDays} /><Card label="Late arrivals" value={s.lateArrivals} /><Card label="Early departures" value={s.earlyDepartures} />
          <Card label="Missing punch records" value={s.missingPunches} /><Card label="Total working hours" value={hm(s.netMinutes)} /><Card label="Total break duration" value={hm(s.breakMinutes)} />
          <Card label="Average daily working hours" value={hm(s.averageNetMinutes)} />
        </div>
      )}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="View">
        {([['DAILY', 'Daily detailed'], ['SUMMARY', 'Employee summary'], ['REGISTER', 'Monthly register']] as [View, string][]).map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? btn.primary : btn.secondary}
            onClick={() => { setView(v); setPage(1); }}>{l}</button>))}
      </div>
      {view === 'REGISTER' && <p className="text-[11px] text-slate-600" aria-label="Legend">Legend: {REGISTER_LEGEND.map(([c, l]) => `${c} = ${l}`).join(' · ')}</p>}

      {!data ? <Spinner /> : rows.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 p-6 text-center">No attendance records found for the selected dates.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white" data-testid="statement-table">
          {data.view === 'DAILY' && (
            <table className="min-w-full text-xs"><thead className="bg-slate-50 text-slate-600"><tr>
              <Th k="date">Date</Th><Th k="name">Employee</Th><Th k="department">Department</Th><Th>Shift</Th><Th k="punch_in">Punch In</Th><Th>Punch Out</Th>
              <Th>Lunch</Th><Th>Breaks</Th><Th>Gross</Th><Th k="hours">Net</Th><Th>Late / early</Th><Th k="status">Status</Th><Th>Remarks</Th></tr></thead>
              <tbody>{(rows as unknown as StatementRow[]).map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${r.incomplete ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
                  <td className="px-2 py-1.5"><p className="font-semibold text-slate-900">{r.name}</p><p className="text-slate-500">{r.employeeCode}{r.designation ? ` · ${r.designation}` : ''}</p></td>
                  <td className="px-2 py-1.5">{r.department ?? '–'}</td><td className="px-2 py-1.5 whitespace-nowrap">{r.shiftStart}–{r.shiftEnd}</td>
                  <td className="px-2 py-1.5">{t(r.punchIn)}</td><td className="px-2 py-1.5">{r.punchOut ? t(r.punchOut) : r.incomplete ? <span className="text-amber-800 font-semibold">Missing</span> : '–'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.lunchStart ? `${t(r.lunchStart)}–${r.lunchEnd ? t(r.lunchEnd) : '…'}` : '–'}</td>
                  <td className="px-2 py-1.5">{r.breakMinutes === null ? '–' : `${hm(r.breakMinutes)}${r.breaks > 1 ? ` (${r.breaks})` : ''}`}</td>
                  <td className="px-2 py-1.5">{hm(r.grossMinutes)}</td><td className="px-2 py-1.5 font-semibold">{hm(r.netMinutes)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.lateMinutes ? `Late ${r.lateMinutes}m` : ''}{r.lateMinutes && r.earlyMinutes ? ' · ' : ''}{r.earlyMinutes ? `Early ${r.earlyMinutes}m` : ''}{!r.lateMinutes && !r.earlyMinutes ? '–' : ''}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="px-2 py-1.5">{[r.holiday, r.leave ? `Leave: ${r.leave.replace('_', ' ').toLowerCase()}` : '', r.incomplete ? 'Incomplete' : '', r.correction ? `Correction ${r.correction.toLowerCase()}` : ''].filter(Boolean).join('; ') || '–'}</td>
                </tr>))}</tbody></table>
          )}
          {data.view === 'SUMMARY' && (
            <table className="min-w-full text-xs"><thead className="bg-slate-50 text-slate-600"><tr>
              <Th k="name">Employee</Th><Th k="department">Department</Th><Th>Scheduled</Th><Th>Present</Th><Th>Absent</Th><Th>Leave</Th><Th>Half-days</Th><Th>Late</Th><Th>Early</Th>
              <Th>Missing punch</Th><Th k="hours">Working hours</Th><Th>Avg / day</Th></tr></thead>
              <tbody>{(rows as unknown as SummaryRow[]).map((r, i) => (
                <tr key={i} className="border-t border-slate-100"><td className="px-2 py-1.5"><p className="font-semibold text-slate-900">{r.name}</p><p className="text-slate-500">{r.employeeCode}</p></td>
                  <td className="px-2 py-1.5">{r.department ?? '–'}</td><td className="px-2 py-1.5">{r.scheduledDays}</td><td className="px-2 py-1.5">{r.presentDays}</td><td className="px-2 py-1.5">{r.absentDays}</td>
                  <td className="px-2 py-1.5">{r.leaveDays}</td><td className="px-2 py-1.5">{r.halfDays}</td><td className="px-2 py-1.5">{r.lateArrivals}</td><td className="px-2 py-1.5">{r.earlyDepartures}</td>
                  <td className="px-2 py-1.5">{r.missingPunches}</td><td className="px-2 py-1.5 font-semibold">{hm(r.netMinutes)}</td><td className="px-2 py-1.5">{hm(r.averageNetMinutes)}</td></tr>))}</tbody></table>
          )}
          {data.view === 'REGISTER' && (
            <table className="min-w-full text-[11px]"><thead className="bg-slate-50 text-slate-600"><tr><Th>Employee</Th>
              {datesOf(data.from, data.to).map(d => <th key={d} scope="col" className="px-1 py-2 font-semibold text-center">{d.slice(8)}</th>)}</tr></thead>
              <tbody>{(rows as unknown as RegisterRow[]).map((r, i) => (
                <tr key={i} className="border-t border-slate-100"><th scope="row" className="px-2 py-1 text-left font-semibold text-slate-900 whitespace-nowrap">{r.name}</th>
                  {datesOf(data.from, data.to).map(d => { const c = r.days?.[d] ?? ''; return (
                    <td key={d} className={`px-1 py-1 text-center font-semibold ${c === 'A' ? 'text-rose-700' : c === 'MP' ? 'text-amber-700' : c === 'P' ? 'text-emerald-700' : 'text-slate-500'}`}
                      title={`${d}: ${REGISTER_LEGEND.find(x => x[0] === c)?.[1] ?? ''}`} aria-label={`${d}: ${REGISTER_LEGEND.find(x => x[0] === c)?.[1] ?? 'no record'}`}>{c}</td>); })}
                </tr>))}</tbody></table>
          )}
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{view === 'DAILY' ? `${data.total} employee-days` : `${data.total} employees`} · page {data.page} of {pages}</span>
          <div className="flex gap-2"><button type="button" className={btn.secondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button type="button" className={btn.secondary} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div>
        </div>
      )}

      {exp.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Export attendance">
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3" data-testid="export-dialog">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4 text-indigo-600" aria-hidden />Export Attendance</h2>
            <fieldset className="space-y-1"><legend className="text-xs font-semibold text-slate-600">File format</legend>
              {(['XLSX', 'CSV'] as const).map(f => <label key={f} className="flex items-center gap-2 text-sm"><input type="radio" name="fmt" checked={exp.format === f} onChange={() => setExp(e => ({ ...e, format: f }))} />{f === 'XLSX' ? 'Excel (.xlsx)' : 'CSV (.csv)'}</label>)}
            </fieldset>
            <fieldset className="space-y-1"><legend className="text-xs font-semibold text-slate-600">Report type</legend>
              {REPORTS.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="rpt" checked={exp.type === v} onChange={() => setExp(e => ({ ...e, type: v }))} />{l}</label>)}
            </fieldset>
            <p className="text-xs text-slate-600">Dates: <b>{applied.from}</b> to <b>{applied.to}</b> (both included) · {selection()}</p>
            {exp.type === 'REGISTER' && rangeProblem(applied.from, applied.to, 62) && <p className="text-xs text-rose-700">The register covers at most 62 days: choose a shorter period.</p>}
            {exp.type === 'RECONCILIATION' && <p className="text-xs text-slate-500">The biometric columns are left empty for you to fill from the machine's export; nothing is invented.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setExp(e => ({ ...e, open: false }))} disabled={exporting}>Cancel</button>
              <button type="button" className={btn.primary} onClick={() => void runExport()} disabled={exporting || (exp.type === 'REGISTER' && !!rangeProblem(applied.from, applied.to, 62))} data-testid="export-go">
                {exporting ? 'Generating…' : 'Export'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** A cell as plain text for the CSV file (dates as YYYY-MM-DD, times as HH:MM India time, durations as H:MM). */
function cellText(c: XCell): string | number {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string' || typeof c === 'number') return c;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const ist = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000);
  if ('date' in c) return c.date;
  if ('datetime' in c) { if (!c.datetime) return ''; const d = ist(c.datetime); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
  if ('time' in c) { if (!c.time) return ''; const d = ist(c.time); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
  if ('minutes' in c) return c.minutes === null ? '' : `${Math.floor(c.minutes / 60)}:${p2(c.minutes % 60)}`;
  return '';
}

export default AttendanceStatement;

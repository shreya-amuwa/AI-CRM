import React, { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, UserX } from 'lucide-react';
import type { OverviewDepartmentAttendance, OverviewDepartmentPerformance, OverviewDepartments as OverviewDepartmentsData } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { dashboardApi } from '../../lib/api/endpoints';
import { ghostBtn, LoadingLine } from '../tasks/head/headParts';
import { money } from '../accounts/finance/FinanceBits';

/**
 * Super Admin Overview, top of the page: who is absent in each department, then each department's business in a period.
 * Every figure comes from dashboard_overview_departments (supabase/migrations/20270101000100_superadmin_overview_departments.sql), which
 * uses the same rules as HR's attendance register and the Accounts department figures. Nothing here is computed or invented in the browser.
 */

const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);
/** The office day (India), as YYYY-MM-DD: attendance and periods are counted in office days. */
const officeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

type PeriodKey = 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom';
const PERIODS: { id: PeriodKey; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'Last 10 years' },
  { id: 'custom', label: 'Custom' }
];
function periodRange(p: PeriodKey, custom: { from: string; to: string }): { from: string; to: string } {
  const today = officeToday();
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: shiftDays(`${y}-${pad(m)}-01`, -1) };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'all':
      // the database accepts periods of up to about ten years
      return { from: shiftDays(today, -3650), to: today };
    case 'custom':
      return custom;
    default:
      return { from: `${y}-${pad(m)}-01`, to: today };
  }
}

export const OverviewDepartments: React.FC<{ reloadSignal: number }> = ({ reloadSignal }) => {
  const [attendanceDate, setAttendanceDate] = useState(officeToday);
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [custom, setCustom] = useState(() => periodRange('this_month', { from: '', to: '' }));
  const [data, setData] = useState<OverviewDepartmentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = periodRange(period, custom);
  const rangeValid = !!range.from && !!range.to && range.from <= range.to;

  const load = useCallback(() => {
    if (!rangeValid) return;
    setLoading(true);
    let live = true;
    dashboardApi.companyDepartments({ from: range.from, to: range.to, attendanceDate }).then(
      d => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      e => {
        if (!live) return;
        setError(errorMessage(e));
        setLoading(false);
      }
    );
    return () => {
      live = false;
    };
  }, [range.from, range.to, attendanceDate, rangeValid]);

  // the page bumps reloadSignal on mount and on every refresh; a new date or period reloads by itself
  useEffect(() => (reloadSignal ? load() : undefined), [load, reloadSignal]);

  return (
    <>
      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">Attendance and department figures could not be loaded: {error}</span>
          <button type="button" className={ghostBtn} onClick={() => load()}>
            Try again
          </button>
        </div>
      )}
      <AttendanceBand data={data} loading={loading} date={attendanceDate} onDate={setAttendanceDate} />
      <DepartmentBusiness
        data={data}
        loading={loading}
        period={period}
        onPeriod={setPeriod}
        custom={custom}
        onCustom={setCustom}
        rangeValid={rangeValid}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Attendance by department
// ---------------------------------------------------------------------------
const AttendanceBand: React.FC<{ data: OverviewDepartmentsData | null; loading: boolean; date: string; onDate: (d: string) => void }> = ({ data, loading, date, onDate }) => {
  const dateId = useId();
  const today = officeToday();
  const rows = data?.attendance ?? [];
  const totalAbsent = rows.reduce((n, r) => n + r.absentCount, 0);
  const totalStaff = rows.reduce((n, r) => n + r.staff, 0);
  return (
    <section aria-label="Attendance by department" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-[#0B2A5B]">Attendance by department</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {data
              ? `${date === today ? 'Today' : longDate(date)}: ${num(totalAbsent)} of ${num(totalStaff)} employees have not punched in.`
              : 'Who has not punched in, by department.'}
          </p>
        </div>
        <label htmlFor={dateId} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          Date
          <input
            id={dateId}
            type="date"
            value={date}
            max={today}
            min={shiftDays(today, -730)}
            onChange={e => e.target.value && onDate(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
          />
        </label>
      </div>
      {!data && loading && (
        <div className="px-5 pb-5">
          <LoadingLine label="Loading attendance…" />
        </div>
      )}
      {data && rows.length === 0 && <p className="px-5 pb-5 text-sm text-slate-500">No active employees are recorded in any department.</p>}
      {rows.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px bg-slate-100 border-t border-slate-100">
          {rows.map(r => (
            <AttendanceCell key={r.departmentId ?? 'none'} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
};

const AttendanceCell: React.FC<{ row: OverviewDepartmentAttendance }> = ({ row }) => (
  <li className="bg-white px-5 py-4 min-w-0">
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-[13px] font-semibold text-slate-600 truncate" title={row.name}>
        {row.name}
      </h3>
      <span className="text-xs text-slate-500 shrink-0">{num(row.staff)} staff</span>
    </div>
    <p className={`mt-1 text-[26px] leading-none font-extrabold ${row.absentCount ? 'text-[#0B2A5B]' : 'text-emerald-700'}`}>
      {num(row.absentCount)}
      <span className="ml-1.5 text-xs font-semibold text-slate-500">absent</span>
    </p>
    {row.absentCount === 0 ? (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> No Employees Absent
      </p>
    ) : (
      // a long list scrolls inside the card, so one large department never stretches the band
      <ul aria-label={`Absent in ${row.name}`} tabIndex={0} className="mt-2 max-h-28 overflow-y-auto pr-1 space-y-1 focus:outline-none focus:ring-2 focus:ring-blue-600/20 rounded">
        {row.absent.map(p => (
          <li key={p.id} className="flex items-center gap-1.5 text-[13px] text-slate-800 min-w-0">
            <UserX className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span className="truncate" title={p.position ? `${p.name} · ${p.position}` : p.name}>
              {p.name}
            </span>
            {p.onLeave && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">
                {p.leaveType === 'HALF_DAY' ? 'Half-day leave' : 'On leave'}
              </span>
            )}
          </li>
        ))}
      </ul>
    )}
  </li>
);

// ---------------------------------------------------------------------------
// Business by department
// ---------------------------------------------------------------------------
const DepartmentBusiness: React.FC<{
  data: OverviewDepartmentsData | null;
  loading: boolean;
  period: PeriodKey;
  onPeriod: (p: PeriodKey) => void;
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
  rangeValid: boolean;
}> = ({ data, loading, period, onPeriod, custom, onCustom, rangeValid }) => {
  const fromId = useId();
  const toId = useId();
  const today = officeToday();
  const rows = data?.performance ?? [];
  return (
    <section aria-label="Business by department" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-[#0B2A5B]">Business by department</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {data ? `${longDate(data.period.from)} – ${longDate(data.period.to)}. ` : ''}
            Income and expenses are the Accounts figures; Department Income is all verified income to date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Period">
          {PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => onPeriod(p.id)}
              className={`h-8 px-3 rounded-full font-bold ${period === p.id ? 'bg-[#0B2A5B] text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 px-5 pb-3 text-xs font-semibold text-slate-600">
          <label htmlFor={fromId} className="flex flex-col gap-1">
            From
            <input id={fromId} type="date" value={custom.from} max={today} onChange={e => onCustom({ ...custom, from: e.target.value })} className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          </label>
          <label htmlFor={toId} className="flex flex-col gap-1">
            To
            <input id={toId} type="date" value={custom.to} max={today} onChange={e => onCustom({ ...custom, to: e.target.value })} className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          </label>
          {!rangeValid && <p role="alert" className="text-rose-700">Choose a period that ends on or after its start.</p>}
        </div>
      )}
      {!data && loading && (
        <div className="px-5 pb-5">
          <LoadingLine label="Loading department figures…" />
        </div>
      )}
      {data && rows.length === 0 && <p className="px-5 pb-5 text-sm text-slate-500">No revenue departments are set up yet.</p>}
      {rows.length > 0 && (
        <ul className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px bg-slate-100 border-t border-slate-100 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {rows.map(r => (
            <BusinessCell key={r.departmentId} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
};

const Line: React.FC<{ label: string; value: string; foot?: string }> = ({ label, value, foot }) => (
  <div className="flex items-baseline justify-between gap-3 min-w-0">
    <dt className="text-xs text-slate-500 truncate">{label}</dt>
    <dd className="text-sm font-bold text-slate-900 text-right min-w-0 truncate" title={foot ? `${value} · ${foot}` : value}>
      {value}
      {foot && <span className="ml-1 text-[11px] font-semibold text-slate-500">{foot}</span>}
    </dd>
  </div>
);

const BusinessCell: React.FC<{ row: OverviewDepartmentPerformance }> = ({ row }) => (
  <li className="bg-white px-5 py-4 min-w-0">
    <h3 className="text-[13px] font-semibold text-slate-600 truncate" title={row.name}>
      {row.name}
    </h3>
    <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">Department Income</p>
    <p className="text-[24px] leading-tight font-extrabold text-[#0B2A5B] truncate" title={money(row.departmentIncome)}>
      {money(row.departmentIncome)}
    </p>
    <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
      <Line label="Income" value={money(row.income)} foot={`${num(row.incomeCount)} paid`} />
      <Line label="Expenses" value={money(row.expenses)} />
      <Line label="Customers onboarded" value={num(row.onboarded)} />
      <Line label="Recharges" value={num(row.recharges)} foot={row.recharges ? money(row.rechargeAmount) : undefined} />
    </dl>
  </li>
);

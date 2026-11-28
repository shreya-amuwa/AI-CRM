import type { XCell, XSheet } from './xlsxWorkbook';

/**
 * Attendance statement helpers (docs/hr-dashboard-upgrade.md, Phase 2): the date presets on the India calendar and the export sheets.
 * Both dates of a range are included. Pure functions: tested in supabase/tests/attendance_statement.test.ts.
 */
export type RangePreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_7' | 'LAST_30' | 'LAST_90' | 'LAST_6_MONTHS' | 'THIS_YEAR' | 'CUSTOM';
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'TODAY', label: 'Today' }, { value: 'YESTERDAY', label: 'Yesterday' }, { value: 'THIS_WEEK', label: 'This week' }, { value: 'LAST_WEEK', label: 'Last week' },
  { value: 'THIS_MONTH', label: 'This month' }, { value: 'LAST_MONTH', label: 'Last month' }, { value: 'LAST_7', label: 'Last 7 days' }, { value: 'LAST_30', label: 'Last 30 days' },
  { value: 'LAST_90', label: 'Last 90 days' }, { value: 'LAST_6_MONTHS', label: 'Last 6 months' }, { value: 'THIS_YEAR', label: 'This year' }, { value: 'CUSTOM', label: 'Custom date range' }
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Today on the India calendar (Asia/Kolkata), whatever the browser's time zone. */
export function istToday(now: Date = new Date()): string {
  return iso(new Date(now.getTime() + 330 * 60_000));
}
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return utc(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** The From / To dates of a preset (weeks run Monday to Sunday). */
export function presetRange(p: RangePreset, today: string = istToday()): { from: string; to: string } {
  const t = parse(today);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  switch (p) {
    case 'TODAY': return { from: today, to: today };
    case 'YESTERDAY': { const d = addDays(today, -1); return { from: d, to: d }; }
    case 'THIS_WEEK': return { from: addDays(today, -dow), to: today };
    case 'LAST_WEEK': return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
    case 'THIS_MONTH': return { from: iso(utc(y, m, 1)), to: today };
    case 'LAST_MONTH': return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
    case 'LAST_7': return { from: addDays(today, -6), to: today };
    case 'LAST_30': return { from: addDays(today, -29), to: today };
    case 'LAST_90': return { from: addDays(today, -89), to: today };
    case 'LAST_6_MONTHS': {
      // six calendar months back, the same day (or the month's last day when it is shorter), plus one day: both ends are included
      const back = utc(y, m - 6, 1);
      const last = utc(back.getUTCFullYear(), back.getUTCMonth() + 1, 0).getUTCDate();
      return { from: addDays(iso(utc(back.getUTCFullYear(), back.getUTCMonth(), Math.min(t.getUTCDate(), last))), 1), to: today };
    }
    case 'THIS_YEAR': return { from: `${y}-01-01`, to: today };
    default: return { from: today, to: today };
  }
}

/** A From / To pair the server will accept; the message says why not. */
export function rangeProblem(from: string, to: string, maxDays = 366): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose the From and To dates.';
  if (iso(parse(from)) !== from || iso(parse(to)) !== to) return 'That is not a calendar date.';
  if (from > to) return 'From Date must not be later than To Date.';
  if (daysBetween(from, to) > maxDays) return `Choose at most ${maxDays} days.`;
  return null;
}
/** Calendar days from From to To, both included. */
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
/** Every date of the range (for the register's columns). */
export function datesOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', APPROVED_LEAVE: 'Approved leave', WEEKLY_OFF: 'Weekly off', HOLIDAY: 'Holiday', ABSENT: 'Absent',
  MISSING_PUNCH_OUT: 'Missing punch-out', IN_PROGRESS: 'In progress (today)', NOT_STARTED: 'Not started yet (today)', UPCOMING: 'Upcoming', NOT_JOINED: 'Before joining'
};
export const REGISTER_LEGEND: [string, string][] = [['P', 'Present'], ['A', 'Absent'], ['L', 'Leave'], ['H', 'Holiday'], ['WO', 'Weekly Off'], ['HD', 'Half Day'], ['MP', 'Missing Punch'], ['-', 'Before joining']];

export interface StatementRow {
  date: string; employeeCode: string; name: string; department: string | null; team: string | null; designation: string | null; employmentType: string | null;
  biometricId: string | null; status: string; shiftStart: string | null; shiftEnd: string | null; punchIn: string | null; punchOut: string | null;
  lunchStart: string | null; lunchEnd: string | null; breaks: number; breakMinutes: number | null; grossMinutes: number | null; netMinutes: number | null;
  lateMinutes: number; earlyMinutes: number; leave: string | null; holiday: string | null; correction: string | null; incomplete: boolean; source: string | null;
}
export interface SummaryRow {
  employeeCode: string; name: string; department: string | null; team: string | null; designation: string | null; employmentType: string | null; biometricId: string | null;
  scheduledDays: number; presentDays: number; absentDays: number; leaveDays: number; halfDays: number; lateArrivals: number; earlyDepartures: number;
  missingPunches: number; netMinutes: number; breakMinutes: number; averageNetMinutes: number;
}
export interface RegisterRow { employeeCode: string; name: string; department: string | null; days: Record<string, string> }
export interface PunchRow { date: string; employeeCode: string; name: string; biometricId: string | null; event: string; at: string; location: string | null; recordedBy: string; note: string | null }

const dayName = (d: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parse(d).getUTCDay()];
const leaveText = (l: string | null) => (l === 'FULL_DAY' ? 'Full day' : l === 'MORNING' ? 'Half day (morning)' : l === 'AFTERNOON' ? 'Half day (afternoon)' : '');
const remark = (r: StatementRow) => [r.holiday, r.incomplete ? 'Incomplete: no Punch Out recorded' : '', r.correction ? `Correction ${r.correction.toLowerCase()}` : ''].filter(Boolean).join('; ');
const hhmm = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

export const DETAIL_HEADER = ['Date', 'Day', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Employment Type', 'Assigned Shift', 'Scheduled Punch In',
  'Actual Punch In', 'Actual Punch Out', 'Lunch Start', 'Lunch End', 'Total Break', 'Gross Working Hours', 'Net Working Hours', 'Late By', 'Early Departure By',
  'Attendance Status', 'Leave Status', 'Attendance Source', 'Correction Status', 'Remarks'];
export function detailCells(r: StatementRow): XCell[] {
  return [{ date: r.date }, dayName(r.date), r.employeeCode, r.name, r.department ?? '', r.designation ?? '', r.employmentType ?? '',
    r.shiftStart && r.shiftEnd ? `${r.shiftStart}–${r.shiftEnd}` : '', r.shiftStart ?? '', { time: r.punchIn }, { time: r.punchOut }, { time: r.lunchStart }, { time: r.lunchEnd },
    { minutes: r.breakMinutes }, { minutes: r.grossMinutes }, { minutes: r.netMinutes }, { minutes: r.lateMinutes || null }, { minutes: r.earlyMinutes || null },
    STATUS_LABEL[r.status] ?? r.status, leaveText(r.leave), r.source ?? '', r.correction ?? '', remark(r)];
}
export function detailCsv(r: StatementRow): (string | number)[] {
  const m = (n: number | null) => (n === null || n === undefined ? '' : `${Math.floor(n / 60)}:${pad(n % 60)}`);
  return [r.date, dayName(r.date), r.employeeCode, r.name, r.department ?? '', r.designation ?? '', r.employmentType ?? '', r.shiftStart && r.shiftEnd ? `${r.shiftStart}-${r.shiftEnd}` : '',
    r.shiftStart ?? '', hhmm(r.punchIn), hhmm(r.punchOut), hhmm(r.lunchStart), hhmm(r.lunchEnd), m(r.breakMinutes), m(r.grossMinutes), m(r.netMinutes),
    r.lateMinutes ? m(r.lateMinutes) : '', r.earlyMinutes ? m(r.earlyMinutes) : '', STATUS_LABEL[r.status] ?? r.status, leaveText(r.leave), r.source ?? '', r.correction ?? '', remark(r)];
}
export const SUMMARY_HEADER = ['Employee ID', 'Employee Name', 'Department', 'Team', 'Designation', 'Employment Type', 'Scheduled Days', 'Present Days', 'Absent Days',
  'Approved Leave Days', 'Half Days', 'Late Arrivals', 'Early Departures', 'Missing Punches', 'Net Working Hours', 'Total Break', 'Average Daily Hours'];
export const summaryCells = (r: SummaryRow): XCell[] => [r.employeeCode, r.name, r.department ?? '', r.team ?? '', r.designation ?? '', r.employmentType ?? '', r.scheduledDays, r.presentDays,
  r.absentDays, r.leaveDays, r.halfDays, r.lateArrivals, r.earlyDepartures, r.missingPunches, { minutes: r.netMinutes }, { minutes: r.breakMinutes }, { minutes: r.averageNetMinutes }];
export const RECON_HEADER = ['Employee ID', 'Biometric Employee ID', 'Employee Name', 'Date', 'CRM Punch In', 'CRM Punch Out', 'CRM Working Duration', 'CRM Attendance Status',
  'Biometric Punch In', 'Biometric Punch Out', 'Biometric Working Duration', 'Punch In Difference', 'Punch Out Difference', 'Reconciliation Status', 'HR Remarks'];
// the biometric columns are left empty for HR to fill from the machine's export (nothing is invented)
export const reconCells = (r: StatementRow): XCell[] => [r.employeeCode, r.biometricId ?? '', r.name, { date: r.date }, { time: r.punchIn }, { time: r.punchOut },
  { minutes: r.grossMinutes }, STATUS_LABEL[r.status] ?? r.status, '', '', '', '', '', '', ''];
export const PUNCH_HEADER = ['Date', 'Employee ID', 'Biometric Employee ID', 'Employee Name', 'Event', 'Time', 'Location', 'Recorded By', 'Note'];
const EVENT = { PUNCH_IN: 'Punch In', PUNCH_OUT: 'Punch Out', LUNCH_START: 'Lunch start', LUNCH_END: 'Lunch end' } as Record<string, string>;
export const punchCells = (r: PunchRow): XCell[] => [{ date: r.date }, r.employeeCode, r.biometricId ?? '', r.name, EVENT[r.event] ?? r.event, { datetime: r.at }, r.location ?? '', r.recordedBy, r.note ?? ''];

export interface ReportMeta { organization: string; from: string; to: string; selection: string; generatedAt: string; generatedBy: string; timeZone: string; type: string }
export function summarySheet(meta: ReportMeta, totals: Record<string, number>): XSheet {
  return {
    name: 'Report Summary', widths: [30, 40], rows: [
      ['Attendance Report'], [],
      ['Organization', meta.organization], ['Report', meta.type], ['Date range', `${meta.from} to ${meta.to} (both included)`], ['Selection', meta.selection],
      ['Generated on', { datetime: meta.generatedAt }], ['Generated by', meta.generatedBy], ['Time zone', meta.timeZone], [],
      ['Employees', totals.employees ?? 0], ['Employee-days', totals.employeeDays ?? 0], ['Scheduled working days', totals.scheduledDays ?? 0],
      ['Present days', totals.presentDays ?? 0], ['Absent days', totals.absentDays ?? 0], ['Approved leave days', totals.approvedLeaveDays ?? 0],
      ['Half days', totals.halfDays ?? 0], ['Late arrivals', totals.lateArrivals ?? 0], ['Early departures', totals.earlyDepartures ?? 0],
      ['Missing punches', totals.missingPunches ?? 0], ['Total working hours', { minutes: totals.netMinutes ?? 0 }], ['Total break duration', { minutes: totals.breakMinutes ?? 0 }],
      [], ['Status legend'], ...REGISTER_LEGEND.map(([c, l]) => [c, l] as XCell[]),
      [], ['Late = Punch In after the company late time; early departure = Punch Out before the person\'s day end. A missing Punch Out is incomplete: no hours are counted for it.']
    ]
  };
}

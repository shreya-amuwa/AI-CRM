import type { PerformancePeriodKind } from '../../../shared/contracts';
import { officeToday } from '../../lib/officeTime';

/** Dates here are plain calendar dates (YYYY-MM-DD) and never go through a time zone: a week is Monday to Sunday, a month is the whole calendar month. */
const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (iso: string, n: number) => {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
};
export const mondayOf = (iso: string) => {
  const d = fromIso(iso);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return toIso(d);
};
export const monthRange = (ym: string): { start: string; end: string } => {
  const [y, m] = ym.split('-').map(Number);
  return { start: `${y}-${pad(m)}-01`, end: toIso(new Date(y, m, 0)) };
};
/** Today in office time (India), the same day the database uses for "today" and "overdue". */
export const todayIso = () => officeToday();

export interface PeriodChoice {
  kind: PerformancePeriodKind;
  /** WEEK: any date in the week; MONTH: YYYY-MM; CUSTOM: the two dates. */
  weekDate: string;
  month: string;
  from: string;
  to: string;
}
export const defaultPeriod = (): PeriodChoice => {
  const t = todayIso();
  return { kind: 'MONTH', weekDate: t, month: t.slice(0, 7), from: addDays(t, -29), to: t };
};

/** The exact range the API wants, or an error to show instead of calling it. */
export function resolvePeriod(p: PeriodChoice): { kind: PerformancePeriodKind; start: string; end: string } | { error: string } {
  if (p.kind === 'WEEK') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.weekDate)) return { error: 'Choose a day in the week.' };
    const start = mondayOf(p.weekDate);
    return { kind: 'WEEK', start, end: addDays(start, 6) };
  }
  if (p.kind === 'MONTH') {
    if (!/^\d{4}-\d{2}$/.test(p.month)) return { error: 'Choose a month.' };
    return { kind: 'MONTH', ...monthRange(p.month) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to)) return { error: 'Choose both dates.' };
  if (p.to < p.from) return { error: 'The end date is before the start date.' };
  const days = (fromIso(p.to).getTime() - fromIso(p.from).getTime()) / 86_400_000;
  if (days > 366) return { error: 'A report covers at most one year.' };
  return { kind: 'CUSTOM', start: p.from, end: p.to };
}

export const periodLabel = (start: string, end: string) => {
  const f = (iso: string) => fromIso(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(start)} – ${f(end)}`;
};

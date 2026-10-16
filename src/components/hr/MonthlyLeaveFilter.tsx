import React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel, officeMonth } from '../../lib/officeTime';

const shift = (month: string, by: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Month and year selector for the Half Days / Leaves columns. Shows which month the numbers are for. */
export const MonthlyLeaveFilter: React.FC<{
  month: string;
  onChange: (month: string) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** How many employees have leave in the month (to say so when none do). */
  withLeave?: number;
}> = ({ month, onChange, loading, error, onRetry, withLeave }) => (
  <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white text-xs">
    <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
      <CalendarDays className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Half-Days &amp; Leaves for
    </span>
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => onChange(shift(month, -1))} aria-label="Previous month" className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <input
        type="month"
        value={month}
        max={shift(officeMonth(), 12)}
        onChange={e => e.target.value && onChange(e.target.value)}
        aria-label="Month and year"
        className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
      />
      <button type="button" onClick={() => onChange(shift(month, 1))} aria-label="Next month" className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
    <span className="font-semibold text-indigo-700" aria-live="polite">{monthLabel(month)}</span>
    {loading && <span className="text-slate-400">Loading…</span>}
    {!loading && !error && withLeave === 0 && <span className="text-slate-500">No leave or half days in {monthLabel(month)}.</span>}
    {error && (
      <span role="alert" className="text-rose-600">
        {error} {onRetry && <button type="button" onClick={onRetry} className="underline font-semibold cursor-pointer">Try again</button>}
      </span>
    )}
  </div>
);

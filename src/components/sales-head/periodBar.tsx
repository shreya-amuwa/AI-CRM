import React from 'react';
import { tcBtn, tcInput } from '../telecaller/ui';
import { addDays, todayIso } from '../performance/periods';

export interface Range { from: string; to: string }
export const lastDays = (n: number): Range => ({ from: addDays(todayIso(), -(n - 1)), to: todayIso() });
export const thisMonth = (): Range => ({ from: `${todayIso().slice(0, 8)}01`, to: todayIso() });

/** A date range with quick choices (shared by the Sales Reports, Performance and Income pages). */
export const PeriodBar: React.FC<{ value: Range; onChange: (r: Range) => void; extra?: React.ReactNode }> = ({ value, onChange, extra }) => (
  <div className="flex flex-wrap items-end gap-3">
    <label className="text-xs font-semibold text-slate-700">From
      <input type="date" className={`${tcInput} mt-1 w-40`} value={value.from} max={value.to} onChange={e => e.target.value && onChange({ ...value, from: e.target.value })} aria-label="From date" />
    </label>
    <label className="text-xs font-semibold text-slate-700">To
      <input type="date" className={`${tcInput} mt-1 w-40`} value={value.to} min={value.from} onChange={e => e.target.value && onChange({ ...value, to: e.target.value })} aria-label="To date" />
    </label>
    <div className="flex gap-1.5 pb-0.5">
      <button type="button" className={tcBtn.row} onClick={() => onChange(lastDays(7))}>Last 7 days</button>
      <button type="button" className={tcBtn.row} onClick={() => onChange(lastDays(30))}>Last 30 days</button>
      <button type="button" className={tcBtn.row} onClick={() => onChange(thisMonth())}>This month</button>
    </div>
    {extra}
  </div>
);

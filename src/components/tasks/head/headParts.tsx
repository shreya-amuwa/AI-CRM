import React from 'react';
import { initialsOf } from '../../layout/shell';

/** Small building blocks shared by the Department Head pages (the design handoff's card / stat / tab styles). */

export const fieldCls =
  'w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-500';
export const textareaCls = fieldCls.replace('h-11 ', 'py-2.5 ');
export const primaryBtn =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const ghostBtn =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors';

export const Card: React.FC<{ className?: string; children: React.ReactNode; label?: string }> = ({ className = '', children, label }) => (
  <section aria-label={label} className={`bg-white rounded-2xl border border-slate-200 ${className}`}>
    {children}
  </section>
);

export const CardHead: React.FC<{ title: string; hint?: string; right?: React.ReactNode }> = ({ title, hint, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-3">
    <div className="min-w-0">
      <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
      {hint && <p className="text-[13px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
    {right}
  </div>
);

export type StatTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';
const STAT_TONE: Record<StatTone, string> = {
  neutral: 'text-slate-900',
  blue: 'text-blue-700',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-rose-700'
};

export const StatCard: React.FC<{ label: string; value: number | string; foot?: string; tone?: StatTone; testId?: string }> = ({ label, value, foot, tone = 'neutral', testId }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5">
    <div className="text-[13px] font-semibold text-slate-500">{label}</div>
    <div className={`mt-1.5 text-[32px] leading-none font-extrabold ${STAT_TONE[tone]}`} data-testid={testId}>{value}</div>
    {foot && <div className="mt-2 text-xs text-slate-500">{foot}</div>}
  </div>
);

export const Avatar: React.FC<{ name: string; size?: number }> = ({ name, size = 34 }) => (
  <span
    className="shrink-0 rounded-full bg-blue-50 text-blue-700 font-extrabold flex items-center justify-center"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    aria-hidden="true"
  >
    {initialsOf(name)}
  </span>
);

/** Filter / period tabs: a row of pill buttons, the active one filled. */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { id: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-9 px-3.5 rounded-full text-[13px] font-bold transition-colors inline-flex items-center gap-1.5 ${
            value === o.id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={`text-[11px] rounded-full px-1.5 ${value === o.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export type LeadHealth = 'On track' | 'Behind' | 'Just started' | 'No tasks';
const HEALTH_CLS: Record<LeadHealth, string> = {
  'On track': 'bg-emerald-50 text-emerald-700',
  Behind: 'bg-rose-50 text-rose-700',
  'Just started': 'bg-amber-50 text-amber-700',
  'No tasks': 'bg-slate-100 text-slate-700'
};
export const HealthBadge: React.FC<{ health: LeadHealth }> = ({ health }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${HEALTH_CLS[health]}`}>{health}</span>
);

/** Honest status of a person's tasks: behind when anything is overdue, just started when nothing has moved yet. */
export function healthOf(s: { total: number; completed: number; overdue: number; inProgress: number }): LeadHealth {
  if (s.total === 0) return 'No tasks';
  if (s.overdue > 0) return 'Behind';
  if (s.completed === 0 && s.inProgress === 0) return 'Just started';
  return 'On track';
}

export const LoadingLine: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" className="py-10 text-center text-sm text-slate-500">
    {label}
  </div>
);

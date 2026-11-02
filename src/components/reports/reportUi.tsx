import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { reportStatusLabel, WEEKLY_STATUS_LABEL, type ReportKind, type ReportPeriodType, type ReportStatus, type WeeklyReportStatus } from '../../../shared/reportFields';
import type { ReportStageStatus } from '../../../shared/contracts';
import { inputCls, selectCls } from '../team-member/pipeline/shared';

// ---------------------------------------------------------------------------------------------------- dates
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoOf(new Date());
const parseIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

export interface Period { type: ReportPeriodType; from: string; to: string }
/** The usual periods, worked out in the person's own calendar (weeks start on Monday). */
export function presetPeriod(kind: 'TODAY' | 'WEEK' | 'MONTH' | 'LAST_WEEK' | 'LAST_MONTH', now = new Date()): Period {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (kind) {
    case 'TODAY': return { type: 'DAILY', from: isoOf(day), to: isoOf(day) };
    case 'WEEK': { const m = monday(day); return { type: 'WEEKLY', from: isoOf(m), to: isoOf(add(m, 6)) }; }
    case 'LAST_WEEK': { const m = add(monday(day), -7); return { type: 'WEEKLY', from: isoOf(m), to: isoOf(add(m, 6)) }; }
    case 'MONTH': return { type: 'MONTHLY', from: isoOf(new Date(day.getFullYear(), day.getMonth(), 1)), to: isoOf(new Date(day.getFullYear(), day.getMonth() + 1, 0)) };
    case 'LAST_MONTH': return { type: 'MONTHLY', from: isoOf(new Date(day.getFullYear(), day.getMonth() - 1, 1)), to: isoOf(new Date(day.getFullYear(), day.getMonth(), 0)) };
  }
}

const SHORT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const FULL = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const WITH_TIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dateLabel = (iso: string | null | undefined) => (iso ? FULL.format(iso.length > 10 ? new Date(iso) : parseIso(iso)) : '-');
export const timeLabel = (iso: string | null | undefined) => (iso ? WITH_TIME.format(new Date(iso)) : '-');
export const periodLabel = (from: string, to: string) => (from === to ? dateLabel(from) : `${SHORT.format(parseIso(from))} - ${dateLabel(to)}`);

// ---------------------------------------------------------------------------------------------------- status
const STATUS_TONE: Record<ReportStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  SUBMITTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  UNDER_REVIEW: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  PENDING_DEPARTMENT_HEAD: 'bg-violet-50 text-violet-700 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  REVISION_REQUIRED: 'bg-amber-50 text-amber-800 ring-amber-200'
};
/** The status as a small pill. Pass the report's kind so a Team Member report names its approval stage ("Pending Team Lead Approval"). */
export const StatusPill: React.FC<{ status: ReportStatus | string | null | undefined; kind?: ReportKind | null }> = ({ status, kind }) => {
  if (!status) return <span className="text-[11px] text-slate-400">Not submitted</span>;
  const known = status in STATUS_TONE;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${known ? STATUS_TONE[status as ReportStatus] : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
      {known ? reportStatusLabel(status as ReportStatus, kind) : status}
    </span>
  );
};

const WEEKLY_TONE: Record<WeeklyReportStatus | 'NOT_SUBMITTED', string> = {
  NOT_SUBMITTED: 'bg-slate-100 text-slate-500 ring-slate-200',
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  COMPILING: 'bg-slate-100 text-slate-600 ring-slate-200',
  PENDING_OPERATIONS_HEAD: 'bg-violet-50 text-violet-700 ring-violet-200',
  REVISION_REQUIRED: 'bg-amber-50 text-amber-800 ring-amber-200',
  APPROVED_BY_OPERATIONS_HEAD: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SENT_TO_HR: 'bg-sky-50 text-sky-700 ring-sky-200',
  HR_REVIEW_IN_PROGRESS: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  HR_REVIEW_COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SUBMITTED_TO_SUPERADMIN: 'bg-emerald-100 text-emerald-800 ring-emerald-300'
};
/** The status of a weekly department report (kept apart from the daily statuses and from the HR review status). */
export const WeeklyStatusPill: React.FC<{ status: WeeklyReportStatus | 'NOT_SUBMITTED' | string | null | undefined }> = ({ status }) => {
  const key = (status && status in WEEKLY_TONE ? status : 'NOT_SUBMITTED') as WeeklyReportStatus | 'NOT_SUBMITTED';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${WEEKLY_TONE[key]}`}>{WEEKLY_STATUS_LABEL[key]}</span>;
};

/** A figure for a summary: a big number with a small label. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }> = ({ label, value, hint, tone = 'neutral' }) => {
  const cls = { neutral: 'text-slate-900', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700', info: 'text-sky-700' }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-xs">
      <div className={`text-xl font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      {hint ? <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div> : null}
    </div>
  );
};
export const pctLabel = (v: number | null | undefined) => (typeof v === 'number' ? `${v}%` : 'No data');
/** The Monday of the week that contains a date, and the Sunday after it. */
export function weekOf(iso: string): { start: string; end: string } {
  const d = parseIso(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const e = new Date(d);
  e.setDate(e.getDate() + 6);
  return { start: isoOf(d), end: isoOf(e) };
}
export const shiftWeek = (startIso: string, weeks: number) => { const d = parseIso(startIso); d.setDate(d.getDate() + 7 * weeks); return isoOf(d); };

const STEP_TONE: Record<ReportStageStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700',
  REVISION_REQUIRED: 'bg-amber-50 text-amber-800'
};
const STEP_WORD: Record<ReportStageStatus, string> = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', REVISION_REQUIRED: 'revision' };

/** The two approvals of a Team Member report side by side: Team Lead, then Department Head. */
export const ApprovalSteps: React.FC<{ tl?: ReportStageStatus | null; dh?: ReportStageStatus | null }> = ({ tl, dh }) => {
  // a Team Lead's own report has no Team Lead stage: only the Department Head's approval is shown
  if (!tl && !dh) return null;
  if (!tl) {
    const st: ReportStageStatus = dh ?? 'PENDING';
    return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STEP_TONE[st]}`} aria-label="Approval step">Dept Head: {STEP_WORD[st]}</span>;
  }
  const step = (label: string, v: ReportStageStatus | null | undefined) => {
    const st: ReportStageStatus = v ?? 'PENDING';
    return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STEP_TONE[st]}`}>{label}: {v ? STEP_WORD[st] : 'waiting'}</span>;
  };
  return <span className="inline-flex flex-wrap gap-1" aria-label="Approval steps">{step('Team Lead', tl)}{step('Dept Head', dh)}</span>;
};

/** A small number with a label, for the collapsed header of a box. */
export const Chip: React.FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }> = ({ label, value, tone = 'neutral' }) => {
  const cls = { neutral: 'bg-slate-50 text-slate-700', good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-800', bad: 'bg-rose-50 text-rose-700', info: 'bg-sky-50 text-sky-700' }[tone];
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-lg px-2 py-1 text-[11px] ${cls}`}>
      <span className="text-sm font-bold tabular-nums">{value}</span>
      <span className="font-medium">{label}</span>
    </span>
  );
};

// ---------------------------------------------------------------------------------------------------- expandable box
/**
 * An expandable box (accordion). The header stays visible and carries the counts and the status; the body opens with a short height
 * transition. Boxes nest: a body can hold more boxes. `onOpen` runs the first time the box opens (to load its content then).
 */
export const Box: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode;
  right?: React.ReactNode;
  level?: 1 | 2 | 3;
  defaultOpen?: boolean;
  onOpen?: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, chips, right, level = 1, defaultOpen = false, onOpen, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const tone = level === 1 ? 'border-slate-200 bg-white shadow-xs' : level === 2 ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-white';
  const toggle = () => { if (!open) onOpen?.(); setOpen(o => !o); };
  return (
    <div className={`rounded-2xl border ${tone}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-start gap-3 text-left px-4 py-3 rounded-2xl hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-slate-400 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={`block font-bold text-slate-900 ${level === 3 ? 'text-sm' : 'text-sm sm:text-base'}`}>{title}</span>
          {subtitle ? <span className="block text-[11px] text-slate-500 mt-0.5">{subtitle}</span> : null}
          {chips ? <span className="flex flex-wrap gap-1.5 mt-2">{chips}</span> : null}
        </span>
        {right ? <span className="shrink-0 pt-0.5">{right}</span> : null}
      </button>
      <div id={id} className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          {open ? <div className="px-4 pb-4 pt-1">{children}</div> : null}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------------- period bar
const PRESETS: { id: Parameters<typeof presetPeriod>[0]; label: string }[] = [
  { id: 'TODAY', label: 'Today' },
  { id: 'WEEK', label: 'This week' },
  { id: 'LAST_WEEK', label: 'Last week' },
  { id: 'MONTH', label: 'This month' },
  { id: 'LAST_MONTH', label: 'Last month' }
];

/** Choose the reporting period: a daily / weekly / monthly shortcut or a custom range. */
export const PeriodBar: React.FC<{ value: Period; onChange: (p: Period) => void; label?: string }> = ({ value, onChange, label = 'Reporting period' }) => {
  const fromId = useId();
  const toId = useId();
  const sel = PRESETS.find(p => { const x = presetPeriod(p.id); return x.from === value.from && x.to === value.to; })?.id ?? 'CUSTOM';
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label={label}>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor={`${fromId}-p`}>{label}</label>
        <select
          id={`${fromId}-p`}
          className={selectCls}
          value={sel}
          onChange={e => { if (e.target.value !== 'CUSTOM') onChange(presetPeriod(e.target.value as Parameters<typeof presetPeriod>[0])); else onChange({ ...value, type: 'CUSTOM' }); }}
        >
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="CUSTOM">Custom range</option>
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor={fromId}>From</label>
        <input id={fromId} type="date" className={`${inputCls} !py-1.5 !w-auto`} value={value.from} max={value.to} onChange={e => e.target.value && onChange({ type: 'CUSTOM', from: e.target.value, to: value.to })} />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor={toId}>To</label>
        <input id={toId} type="date" className={`${inputCls} !py-1.5 !w-auto`} value={value.to} min={value.from} onChange={e => e.target.value && onChange({ type: 'CUSTOM', from: value.from, to: e.target.value })} />
      </div>
    </div>
  );
};

/** Choose a Monday-to-Sunday week: previous / next buttons and the date range (the weekly reports are always whole weeks). */
export const WeekPicker: React.FC<{ value: string; onChange: (weekStart: string) => void; label?: string; maxFuture?: boolean }> = ({ value, onChange, label = 'Reporting week', maxFuture = false }) => {
  const thisWeek = weekOf(todayIso()).start;
  const end = weekOf(value).end;
  return (
    <div className="flex items-end gap-2" role="group" aria-label={label}>
      <div>
        <span className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</span>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50" onClick={() => onChange(shiftWeek(value, -1))} aria-label="Previous week">&lsaquo;</button>
          <span className="min-w-44 text-center text-sm font-semibold text-slate-800 tabular-nums" aria-live="polite">{dateLabel(value)} - {dateLabel(end)}</span>
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40" onClick={() => onChange(shiftWeek(value, 1))} disabled={!maxFuture && value >= thisWeek} aria-label="Next week">&rsaquo;</button>
        </div>
      </div>
      {value !== thisWeek ? <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline pb-2" onClick={() => onChange(thisWeek)}>This week</button> : null}
    </div>
  );
};

/** Section tabs inside the Reports page. */
export const Tabs: React.FC<{ tabs: { id: string; label: string; badge?: number }[]; value: string; onChange: (id: string) => void }> = ({ tabs, value, onChange }) => (
  <div role="tablist" aria-label="Reports sections" className="flex flex-wrap gap-1 border-b border-slate-200">
    {tabs.map(t => (
      <button
        key={t.id}
        role="tab"
        type="button"
        aria-selected={value === t.id}
        onClick={() => onChange(t.id)}
        className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-t-lg ${value === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
      >
        {t.label}
        {t.badge ? <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{t.badge}</span> : null}
      </button>
    ))}
  </div>
);

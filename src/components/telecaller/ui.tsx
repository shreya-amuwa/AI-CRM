import React from 'react';
import { CALL_STATUSES, CALL_STATUS_LABELS, type CallStatus, type LeadTemperature } from '../../../shared/contracts';

/** Telecaller workspace: small shared pieces (status badges, stat cards, form classes). Business rules stay in the database. */

export const CALL_STATUS_STYLE: Record<CallStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700 ring-slate-200',
  CONTACTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  INTERESTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FOLLOW_UP_REQUIRED: 'bg-amber-50 text-amber-800 ring-amber-200',
  NOT_INTERESTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  COMPLETED: 'bg-indigo-50 text-indigo-700 ring-indigo-200'
};

export const CallStatusBadge: React.FC<{ status: CallStatus | null | undefined }> = ({ status }) =>
  status ? (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${CALL_STATUS_STYLE[status]}`}>{CALL_STATUS_LABELS[status]}</span>
  ) : (
    <span className="text-slate-400">-</span>
  );

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { HOT: 'Hot', WARM: 'Warm', COLD: 'Cold' };
/** Hot is red, Warm amber, Cold blue. */
export const TEMPERATURE_STYLE: Record<LeadTemperature, string> = {
  HOT: 'bg-red-50 text-red-700 ring-red-200',
  WARM: 'bg-amber-50 text-amber-800 ring-amber-200',
  COLD: 'bg-blue-50 text-blue-700 ring-blue-200'
};
export const TEMPERATURE_DOT: Record<LeadTemperature, string> = { HOT: 'bg-red-500', WARM: 'bg-amber-500', COLD: 'bg-blue-500' };

export const TemperatureBadge: React.FC<{ value: LeadTemperature | null | undefined }> = ({ value }) =>
  value ? (
    <span data-temperature={value} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ring-1 ring-inset ${TEMPERATURE_STYLE[value]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${TEMPERATURE_DOT[value]}`} aria-hidden="true" />
      {TEMPERATURE_LABELS[value]}
    </span>
  ) : (
    <span className="text-slate-400">-</span>
  );

export const tcBtn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 transition-colors',
  secondary:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors',
  link: 'text-blue-600 hover:text-blue-700 text-xs font-bold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded'
};
export const tcInput =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 disabled:bg-slate-50';
export const tcSelect =
  'px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400';

export const CALL_STATUS_OPTIONS = CALL_STATUSES.map(s => ({ value: s, label: CALL_STATUS_LABELS[s] }));

/** One number on the Home page. */
export const StatCard: React.FC<{ label: string; value: number | string; icon: React.ElementType; tone: string; hint?: string; onClick?: () => void }> = ({ label, value, icon: Icon, tone, hint, onClick }) => {
  const body = (
    <>
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="w-5 h-5" strokeWidth={1.9} aria-hidden="true" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[13px] font-medium leading-snug text-slate-500">{label}</span>
        <span className="block text-2xl font-extrabold tracking-tight text-slate-900 leading-tight" data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{value}</span>
        {hint && <span className="block text-[11px] text-slate-500 truncate">{hint}</span>}
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm w-full';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:border-blue-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

/** A quiet empty state. */
export const EmptyState: React.FC<{ icon: React.ElementType; title: string; children?: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="flex flex-col items-center justify-center text-center gap-2 px-6 py-14">
    <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
      <Icon className="w-6 h-6" aria-hidden="true" />
    </span>
    <p className="text-sm font-bold text-slate-800">{title}</p>
    {children && <div className="text-sm text-slate-500 max-w-md">{children}</div>}
  </div>
);

/** Tell the other Telecaller pages that a contact or a lead changed (the Home counts reload). */
export const TELECALLER_CHANGED = 'crm:telecaller-changed';
export const notifyTelecallerChanged = () => window.dispatchEvent(new CustomEvent(TELECALLER_CHANGED));

export const dateText = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const dateTimeText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '-';

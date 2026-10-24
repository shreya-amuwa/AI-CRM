import React from 'react';
import { CALL_STATUSES, CALL_STATUS_LABELS, type CallStatus, type LeadTemperature } from '../../../shared/contracts';
import { btn, inputCls, selectCls } from '../team-member/pipeline/shared';
import { StatCard as HeadStatCard, type StatTone } from '../tasks/head/headParts';

/**
 * Telecaller and Business Associate workspaces: thin wrappers over the CRM's own shared pieces (the Department Head's cards and stat tiles, the
 * pipeline's buttons, inputs and table conventions), so these dashboards look like every other one. Only the badges' wording and the helpers are new.
 */

/** A status chip: the shape and sizes of the Department Head's health badges. */
const chip = 'inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap';

export const CALL_STATUS_STYLE: Record<CallStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  CONTACTED: 'bg-sky-50 text-sky-700',
  INTERESTED: 'bg-emerald-50 text-emerald-700',
  FOLLOW_UP_REQUIRED: 'bg-amber-50 text-amber-700',
  NOT_INTERESTED: 'bg-rose-50 text-rose-700',
  COMPLETED: 'bg-blue-50 text-blue-700'
};

export const CallStatusBadge: React.FC<{ status: CallStatus | null | undefined }> = ({ status }) =>
  status ? <span className={`${chip} ${CALL_STATUS_STYLE[status]}`}>{CALL_STATUS_LABELS[status]}</span> : <span className="text-slate-400">-</span>;

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { HOT: 'Hot', WARM: 'Warm', COLD: 'Cold' };
/** Hot is red, Warm amber, Cold blue. */
export const TEMPERATURE_STYLE: Record<LeadTemperature, string> = {
  HOT: 'bg-rose-50 text-rose-700',
  WARM: 'bg-amber-50 text-amber-700',
  COLD: 'bg-blue-50 text-blue-700'
};
export const TEMPERATURE_DOT: Record<LeadTemperature, string> = { HOT: 'bg-rose-500', WARM: 'bg-amber-500', COLD: 'bg-blue-500' };

export const TemperatureBadge: React.FC<{ value: LeadTemperature | null | undefined }> = ({ value }) =>
  value ? (
    <span data-temperature={value} className={`${chip} items-center gap-1.5 ${TEMPERATURE_STYLE[value]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${TEMPERATURE_DOT[value]}`} aria-hidden="true" />
      {TEMPERATURE_LABELS[value]}
    </span>
  ) : (
    <span className="text-slate-400">-</span>
  );

export { chip };

/** Buttons: the Department Head's (page actions, forms, the sticky bars), plus the pipeline's small secondary button for table rows. */
export const tcBtn = {
  primary:
    'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  secondary:
    'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  /** the small button of a table row (the Sales member's Leads table uses it) */
  row: btn.secondary,
  link: 'text-blue-600 hover:text-blue-700 text-xs font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 rounded'
};
export const tcInput = inputCls;
export const tcSelect = selectCls;

export const CALL_STATUS_OPTIONS = CALL_STATUSES.map(s => ({ value: s, label: CALL_STATUS_LABELS[s] }));

/** One number on a Home / Tasks page: the Department Head's stat tile, made clickable when it leads somewhere. */
export const StatCard: React.FC<{ label: string; value: number | string; tone?: StatTone; hint?: string; onClick?: () => void }> = ({ label, value, tone = 'neutral', hint, onClick }) => {
  const tile = <HeadStatCard label={label} value={value} foot={hint} tone={tone} testId={`stat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`} />;
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full text-left rounded-2xl hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 transition-shadow">
      {tile}
    </button>
  ) : (
    tile
  );
};

/** A quiet empty state, as in the other dashboards' tables: centred muted text. */
export const EmptyState: React.FC<{ title: string; children?: React.ReactNode; icon?: React.ElementType }> = ({ title, children }) => (
  <div className="py-12 px-6 text-center">
    <p className="text-sm font-bold text-slate-700">{title}</p>
    {children && <div className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{children}</div>}
  </div>
);

/** Tell the other Telecaller pages that a contact or a lead changed (the Home counts reload). */
export const TELECALLER_CHANGED = 'crm:telecaller-changed';
export const notifyTelecallerChanged = () => window.dispatchEvent(new CustomEvent(TELECALLER_CHANGED));

export const dateText = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const dateTimeText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '-';

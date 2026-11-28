import React from 'react';
import type { ReviewRow } from '../../../../shared/hrUpgrade';
import { Pill, type Tone } from '../../team-member/pipeline/shared';

/** Shared bits of the confirmation / internship review screens (docs/hr-dashboard-upgrade.md). */
export const OPEN_REVIEW_EVENT = 'crm:open-hr-review';
/** Open one review in the review overlay (from a notification, a dashboard card, an e-mail link). */
export function openReview(id: string) { window.dispatchEvent(new CustomEvent<string>(OPEN_REVIEW_EVENT, { detail: id })); }

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
export const hours = (min: number | null | undefined) => (min === null || min === undefined ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);

const REPORT: Record<string, [string, Tone]> = {
  NOT_STARTED: ['Pending', 'slate'], DRAFT: ['Draft', 'indigo'], SUBMITTED: ['Submitted', 'green'], RETURNED: ['Returned for revision', 'orange'],
  OVERDUE: ['Overdue', 'red'], NOT_SUBMITTED: ['Not submitted', 'slate'], CANCELLED: ['Cancelled', 'slate']
};
export const ReportStatus: React.FC<{ status: string }> = ({ status }) => {
  const [label, tone] = REPORT[status] ?? [status.replace(/_/g, ' ').toLowerCase(), 'slate' as Tone];
  return <Pill tone={tone}>{label}</Pill>;
};

const OVERALL: Record<string, [string, Tone]> = {
  UPCOMING: ['Upcoming', 'slate'], IN_REVIEW: ['In review', 'indigo'], AWAITING_HR_DECISION: ['Awaiting HR decision', 'orange'], OVERDUE: ['Overdue', 'red'],
  ON_HOLD: ['On hold', 'orange'], CONFIRMING: ['Confirming (e-mail pending)', 'indigo'], APPROVED: ['Confirmed', 'green'], NOT_CONFIRMED: ['Not confirmed', 'red'],
  DISMISSED: ['Closed', 'slate'], COMPLETED: ['Internship completed', 'green'], CONVERTED: ['Converted to full-time', 'green'], NOT_CONTINUED: ['Not continued', 'red'],
  PENDING: ['Pending', 'slate']
};
export const OverallStatus: React.FC<{ status: string }> = ({ status }) => {
  const [label, tone] = OVERALL[status] ?? [status, 'slate' as Tone];
  return <Pill tone={tone}>{label}</Pill>;
};

export const daysText = (r: Pick<ReviewRow, 'daysLeft' | 'status'>) =>
  r.status !== 'PENDING' ? '–' : r.daysLeft < 0 ? `${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} overdue` : r.daysLeft === 0 ? 'Due today' : `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`;

export const typeLabel = (t: string) => (t === 'INTERNSHIP' ? 'Internship review' : 'Confirmation review');
export const configIssueText = (s: string | null) =>
  s ? s.split(',').map(x => (x === 'NO_DEPARTMENT_HEAD' ? 'No Department Head' : x === 'NO_CEO' ? 'No CEO' : x)).join(', ') : null;

/** A summary card that filters the list when clicked (keyboard accessible). */
export const StatCard: React.FC<{ label: string; value: number | string; active?: boolean; tone?: 'default' | 'warn' | 'danger'; onClick?: () => void; testId?: string }> = ({
  label, value, active, tone = 'default', onClick, testId
}) => {
  const color = tone === 'danger' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  const cls = `text-left rounded-2xl border p-3 bg-white transition-colors ${active ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'} ${onClick ? 'hover:border-indigo-300 cursor-pointer' : ''}`;
  const inner = (<><p className="text-[11px] font-semibold text-slate-500 leading-tight">{label}</p><p className={`mt-1 text-xl font-extrabold ${color}`}>{value}</p></>);
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={!!active} data-testid={testId}>{inner}</button>
    : <div className={cls} data-testid={testId}>{inner}</div>;
};

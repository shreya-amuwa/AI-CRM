import React from 'react';
import { Lock } from 'lucide-react';
import type { CaseEvent, EmployeeIssue, EmployeeMeeting, IssuePriority, IssueStatus, MeetingStatus } from '../../../shared/contracts';
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS, MEETING_STATUS_LABELS } from '../../../shared/contracts';
import { Pill, type Tone } from '../team-member/pipeline/shared';
import { Paged } from '../common/Paged';

/** Shared pieces of the employee page (Raise an Issue) and HR's two sections (Employee Issues, Meeting Requests). */
export const whenLabel = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
/** The date of a moment (for the narrow columns of a table; the time is in the detail). */
export const shortWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const dayLabel = (isoDate: string | null | undefined) =>
  isoDate ? new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
export const timeLabel = (hhmm: string | null | undefined) => {
  if (!hhmm) return '–';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export const todayLocalIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The start of a local day as an instant (for the date range filters the server compares with the submit time). */
export const dayStartIso = (isoDate: string) => new Date(`${isoDate}T00:00:00`).toISOString();
export const dayEndExclusiveIso = (isoDate: string) => new Date(new Date(`${isoDate}T00:00:00`).getTime() + 86400e3).toISOString();

const ISSUE_TONE: Record<IssueStatus, Tone> = { NEW: 'indigo', IN_PROGRESS: 'orange', AWAITING_EMPLOYEE: 'orange', RESOLVED: 'green', CLOSED: 'slate' };
const MEETING_TONE: Record<MeetingStatus, Tone> = { PENDING: 'orange', SCHEDULED: 'green', ALTERNATIVE_PROPOSED: 'indigo', DECLINED: 'red', CANCELLED: 'slate', COMPLETED: 'green' };
const PRIORITY_TONE: Record<IssuePriority, Tone> = { LOW: 'slate', MEDIUM: 'indigo', HIGH: 'orange', URGENT: 'red' };

/** `employee`: the employee's own wording for the one status that waits for them. */
export const IssueStatusPill: React.FC<{ status: IssueStatus; employee?: boolean }> = ({ status, employee }) => (
  <Pill tone={ISSUE_TONE[status]}>{employee && status === 'AWAITING_EMPLOYEE' ? 'Waiting for your reply' : ISSUE_STATUS_LABELS[status]}</Pill>
);
export const MeetingStatusPill: React.FC<{ status: MeetingStatus }> = ({ status }) => <Pill tone={MEETING_TONE[status]}>{MEETING_STATUS_LABELS[status]}</Pill>;
export const PriorityPill: React.FC<{ priority: IssuePriority }> = ({ priority }) => <Pill tone={PRIORITY_TONE[priority]}>{ISSUE_PRIORITY_LABELS[priority]}</Pill>;

/** One summary figure (always a number counted from the database). */
export const Stat: React.FC<{ label: string; value: number | null; alert?: boolean }> = ({ label, value, alert }) => (
  <div className={`rounded-2xl border p-4 bg-white shadow-xs ${alert && (value ?? 0) > 0 ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200/80'}`} data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-extrabold ${alert && (value ?? 0) > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{value === null ? '–' : value.toLocaleString('en-IN')}</div>
  </div>
);

const KIND_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted', ASSIGNED: 'Assigned', STATUS_CHANGED: 'Status changed', RESPONSE: 'HR response', INFO_REQUESTED: 'More information requested', EMPLOYEE_REPLY: 'Employee reply',
  NOTE: 'Internal note', APPROVED: 'Meeting scheduled', DECLINED: 'Declined', ALTERNATIVE_PROPOSED: 'Another time proposed', ALTERNATIVE_ACCEPTED: 'Proposed time accepted',
  ALTERNATIVE_DECLINED: 'Proposed time declined', RESCHEDULED: 'Rescheduled', CANCELLED: 'Cancelled', COMPLETED: 'Completed',
  // issue routing (20270128000200)
  ESCALATED: 'Escalated to the Developer Team', DEV_UPDATE: 'Developer Team update'
};
const ALL_STATUS_LABELS: Record<string, string> = { ...ISSUE_STATUS_LABELS, ...MEETING_STATUS_LABELS };
const statusText = (s: string | null, forEmployee: boolean) => (!s ? '' : forEmployee && s === 'AWAITING_EMPLOYEE' ? 'Waiting for your reply' : ALL_STATUS_LABELS[s] ?? s);

/** The activity history, oldest first. HR-only notes carry a lock so HR never mistakes one for something the employee reads. */
export const CaseTimeline: React.FC<{ events: CaseEvent[]; forEmployee?: boolean }> = ({ events, forEmployee = false }) => (
  <Paged items={events} noun="entries">{rows => (
  <ol className="space-y-3" aria-label="Activity history" data-testid="case-timeline">
    {rows.map(e => (
      <li key={e.id} className={`rounded-xl border p-3 text-xs ${e.visibility === 'HR' ? 'border-amber-200 bg-amber-50/60' : e.side === 'HR' ? 'border-indigo-100 bg-indigo-50/40' : e.side === 'DEVELOPER' ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-white'}`} data-kind={e.kind}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">{KIND_LABEL[e.kind] ?? e.kind}</span>
          {e.visibility === 'HR' && <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><Lock className="w-3 h-3" aria-hidden /> HR only</span>}
          <span>{e.side === 'HR' ? (forEmployee ? 'HR' : e.actorName ?? 'HR') : e.side === 'DEVELOPER' ? 'Developer Team' : e.actorName ?? 'Employee'}</span>
          <span>· {whenLabel(e.createdAt)}</span>
        </div>
        {e.toStatus && e.fromStatus !== e.toStatus && (
          <div className="mt-1 text-slate-600">{e.fromStatus ? `${statusText(e.fromStatus, forEmployee)} → ` : ''}<b>{statusText(e.toStatus, forEmployee)}</b></div>
        )}
        {e.body && <p className="mt-1 whitespace-pre-wrap text-slate-800 text-[13px] leading-relaxed">{e.body}</p>}
      </li>
    ))}
  </ol>
  )}</Paged>
);

export const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-800 break-words">{children || '–'}</dd>
  </div>
);

export const EmployeeBlock: React.FC<{ employee: EmployeeIssue['employee'] | EmployeeMeeting['employee'] }> = ({ employee }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3" aria-label="Employee details">
    <Detail label="Employee">{employee.name}</Detail>
    <Detail label="Department">{employee.department}</Detail>
    <Detail label="Designation">{employee.designation}</Detail>
  </dl>
);

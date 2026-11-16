import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AI_STUDIO_REPORT_STATUS_LABELS,
  type AiStudioPriority,
  type AiStudioProjectStatus,
  type AiStudioReportStatus,
  type AiStudioTaskStatus
} from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';

/**
 * Small pieces of the AI Studio dashboards. They sit on the CRM's own cards, tiles, buttons and fields (tasks/head/headParts and the pipeline's
 * shared inputs); only the wording of the status chips and a few helpers are new.
 */

const chip = 'inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap';

export const TASK_STATUS_LABELS: Record<AiStudioTaskStatus, string> = { ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', COMPLETED: 'Completed' };
const TASK_STATUS_STYLE: Record<AiStudioTaskStatus, string> = {
  ASSIGNED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  ON_HOLD: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700'
};
export const TaskStatusBadge: React.FC<{ status: AiStudioTaskStatus }> = ({ status }) => <span className={`${chip} ${TASK_STATUS_STYLE[status]}`}>{TASK_STATUS_LABELS[status]}</span>;

export const PRIORITY_LABELS: Record<AiStudioPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
const PRIORITY_STYLE: Record<AiStudioPriority, string> = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-sky-50 text-sky-700',
  HIGH: 'bg-amber-50 text-amber-700',
  URGENT: 'bg-rose-50 text-rose-700'
};
export const PriorityBadge: React.FC<{ priority: AiStudioPriority }> = ({ priority }) => <span className={`${chip} ${PRIORITY_STYLE[priority]}`}>{PRIORITY_LABELS[priority]}</span>;

const REPORT_STYLE: Record<AiStudioReportStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-sky-50 text-sky-700',
  PENDING_TL_APPROVAL: 'bg-amber-50 text-amber-700',
  RETURNED_BY_TL: 'bg-rose-50 text-rose-700',
  PENDING_DH_APPROVAL: 'bg-violet-50 text-violet-700',
  RETURNED_BY_DH: 'bg-rose-50 text-rose-700',
  APPROVED: 'bg-emerald-50 text-emerald-700'
};
export const ReportStatusBadge: React.FC<{ status: AiStudioReportStatus }> = ({ status }) => <span className={`${chip} ${REPORT_STYLE[status]}`}>{AI_STUDIO_REPORT_STATUS_LABELS[status]}</span>;

const PROJECT_STYLE: Record<AiStudioProjectStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-blue-50 text-blue-700',
  ARCHIVED: 'bg-slate-100 text-slate-600'
};
export const PROJECT_STATUS_LABELS: Record<AiStudioProjectStatus, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
export const ProjectStatusBadge: React.FC<{ status: AiStudioProjectStatus }> = ({ status }) => <span className={`${chip} ${PROJECT_STYLE[status]}`}>{PROJECT_STATUS_LABELS[status]}</span>;

export const ProgressBar: React.FC<{ value: number; label?: string }> = ({ value, label }) => (
  <div className="flex items-center gap-2 min-w-[7rem]" role="img" aria-label={label ?? `${value}% complete`}>
    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
    <span className="text-xs font-semibold text-slate-600 w-9 text-right">{value}%</span>
  </div>
);

export const dateText = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const dateTimeText = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** A table wrapper: scrolls sideways on a phone instead of breaking the page. */
export const TableWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="overflow-x-auto">{children}</div>;
export const thCls = 'text-left text-[12px] font-bold uppercase tracking-[0.04em] text-slate-500 px-4 py-3 whitespace-nowrap';
export const tdCls = 'px-4 py-3 text-sm text-slate-700 align-top';

/**
 * Reads something from the API: loading, error (with a retry) and the data. `deps` read it again; `reload` is for after a change.
 * A late answer for an old request is ignored.
 */
export function useLoad<T>(load: () => Promise<T>, deps: React.DependencyList): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  const run = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    loader.current().then(
      d => { if (mine === seq.current) { setData(d); setLoading(false); } },
      e => { if (mine === seq.current) { setError(errorMessage(e)); setLoading(false); } }
    );
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  useEffect(() => () => { seq.current += 1; }, []);
  return { data, error, loading, reload: run };
}

/** Today in Indian time as YYYY-MM-DD (the date a report defaults to). */
export const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

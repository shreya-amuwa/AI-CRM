import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { RecruiterStage, VacancyStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { Pill, type Tone } from '../team-member/pipeline/shared';

/** The words and colours the recruiter workspace uses for the pipeline, vacancies, calls and interviews. */
export const STAGE_LABEL: Record<RecruiterStage, string> = {
  NEW_APPLICATION: 'New Application', INITIAL_SCREENING: 'Initial Screening', CALL_SCHEDULED: 'Call Scheduled', CALL_COMPLETED: 'Call Completed',
  TEST_PENDING: 'Test Pending', TEST_COMPLETED: 'Test Completed', INTERVIEW_SCHEDULED: 'Interview Scheduled', INTERVIEW_COMPLETED: 'Interview Completed',
  SELECTION_REVIEW: 'Selection Review', SELECTED: 'Selected', REJECTED: 'Rejected', ON_HOLD: 'On Hold', WITHDRAWN: 'Withdrawn'
};
export const STAGE_ORDER: RecruiterStage[] = [
  'NEW_APPLICATION', 'INITIAL_SCREENING', 'CALL_SCHEDULED', 'CALL_COMPLETED', 'TEST_PENDING', 'TEST_COMPLETED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED',
  'SELECTION_REVIEW', 'SELECTED', 'REJECTED', 'ON_HOLD'
];
export const STAGE_TONE: Record<RecruiterStage, Tone> = {
  NEW_APPLICATION: 'slate', INITIAL_SCREENING: 'indigo', CALL_SCHEDULED: 'indigo', CALL_COMPLETED: 'indigo', TEST_PENDING: 'orange', TEST_COMPLETED: 'orange',
  INTERVIEW_SCHEDULED: 'orange', INTERVIEW_COMPLETED: 'orange', SELECTION_REVIEW: 'indigo', SELECTED: 'green', REJECTED: 'red', ON_HOLD: 'slate', WITHDRAWN: 'slate'
};
export const VACANCY_LABEL: Record<VacancyStatus, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', OPEN: 'Open', ON_HOLD: 'On Hold', CLOSED: 'Closed', FILLED: 'Filled'
};
export const VACANCY_TONE: Record<VacancyStatus, Tone> = { DRAFT: 'slate', PENDING_APPROVAL: 'orange', OPEN: 'green', ON_HOLD: 'orange', CLOSED: 'slate', FILLED: 'indigo' };
export const CALL_OUTCOME_LABEL: Record<string, string> = {
  ANSWERED: 'Answered', NO_ANSWER: 'No answer', CALL_BACK: 'Call back later', NOT_INTERESTED: 'Not interested', WRONG_NUMBER: 'Wrong number', INTERESTED: 'Interested', UNREACHABLE: 'Unreachable'
};
export const ROUND_LABEL: Record<string, string> = { HR: 'HR round', DEPARTMENT_HEAD: 'Department Head round', MANAGEMENT: 'Management round' };
export const MODE_LABEL: Record<string, string> = { IN_PERSON: 'In person', PHONE: 'Phone', VIDEO: 'Video', OTHER: 'Other' };
export const RESULT_LABEL: Record<string, string> = { PROCEED: 'Proceed', SHORTLIST: 'Shortlist', REJECT: 'Reject', HOLD: 'Hold', FURTHER_EVALUATION: 'Further evaluation' };
export const CATEGORY_LABEL: Record<string, string> = {
  SKILLS_MISMATCH: 'Skills mismatch', EXPERIENCE: 'Experience', ASSESSMENT: 'Assessment result', INTERVIEW: 'Interview result', NOT_INTERESTED: 'Candidate not interested',
  POSITION_FILLED: 'Position filled', OTHER: 'Other'
};
export const STEP_LABEL: Record<string, string> = { CALL: 'a completed call', ASSESSMENT: 'a passed assessment', INTERVIEW: 'a completed interview' };

export const StagePill: React.FC<{ stage: RecruiterStage | string }> = ({ stage }) => <Pill tone={STAGE_TONE[stage as RecruiterStage] ?? 'slate'}>{STAGE_LABEL[stage as RecruiterStage] ?? stage}</Pill>;
export const VacancyPill: React.FC<{ status: VacancyStatus }> = ({ status }) => <Pill tone={VACANCY_TONE[status]}>{VACANCY_LABEL[status]}</Pill>;

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (v: string | null | undefined) => (v ? DATE.format(new Date(v.length === 10 ? `${v}T00:00:00` : v)) : '–');
export const fmtDateTime = (v: string | null | undefined) => (v ? DATETIME.format(new Date(v)) : '–');
/** A value for <input type="datetime-local"> (the person's own clock) turned into an ISO string with the offset. */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : '');

/** Loads data from the API and keeps the loading / error / reload state. A newer request wins over an older one. */
export function useLoad<T>(load: () => Promise<T>, deps: React.DependencyList): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useRef(0);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(load, deps);
  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    fn().then(
      d => { if (id === run.current) { setData(d); setError(null); setLoading(false); } },
      e => { if (id === run.current) { setError(errorMessage(e)); setLoading(false); } }
    );
  }, [fn, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

export const Empty: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

export const Field: React.FC<{ label: string; hint?: string; children: (id: string) => React.ReactNode }> = ({ label, hint, children }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
};

/** A modal dialog: closes on Escape, keeps focus inside, labelled for screen readers. */
export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const items = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl focus:outline-none`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 id={titleId} className="text-sm font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export const Kpi: React.FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn'; onClick?: () => void }> = ({ label, value, tone = 'neutral', onClick }) => {
  const color = { neutral: 'text-slate-900', good: 'text-emerald-700', bad: 'text-rose-700', warn: 'text-amber-700' }[tone];
  const body = (<><span className={`block text-2xl font-bold tabular-nums ${color}`}>{value}</span><span className="block text-[11px] font-medium text-slate-500 mt-0.5">{label}</span></>);
  return onClick
    ? <button type="button" onClick={onClick} className="text-left rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">{body}</button>
    : <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs">{body}</div>;
};

/** A simple horizontal bar for a count against the biggest count in the group. */
export const Bar: React.FC<{ label: string; value: number; max: number; tone?: string }> = ({ label, value, max, tone = 'bg-indigo-500' }) => (
  <div className="flex items-center gap-3 text-xs">
    <span className="w-40 shrink-0 truncate text-slate-600" title={label}>{label}</span>
    <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${max ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }} /></span>
    <span className="w-8 text-right font-semibold tabular-nums text-slate-800">{value}</span>
  </div>
);

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AdsContext, AdsLink, AdsPerson } from '../../../shared/contracts';
import { ADS_ASSIGNMENT_STATUS_LABELS, ADS_ISSUE_STATUS_LABELS, ADS_NOTICE_STATUS_LABELS, ADS_PRIORITY_LABELS, ADS_REPORT_STATUS_LABELS } from '../../../shared/contracts';
import { aiDesignStudioApi } from '../../lib/api/aiDesignStudio';
import { errorMessage } from '../../lib/api/client';
import { ADS_CHANGED_EVENT } from './adsEvents';

// The AI Design Studio pages use the same building blocks as the Department Head / Team Lead dashboards (headParts): one look for the CRM.
export { Card, CardHead, StatCard, Tabs, LoadingLine, Avatar, fieldCls, textareaCls, primaryBtn, ghostBtn } from '../tasks/head/headParts';
import { fieldCls, ghostBtn } from '../tasks/head/headParts';

// ---------------------------------------------------------------------------------------------------- who is signed in
interface AdsSession {
  ctx: AdsContext;
  /** The people the caller may assign work to or filter by (Department Head: everyone; Team Lead: own members; Team Member: nobody). */
  people: AdsPerson[];
  reloadPeople: () => void;
}
const SessionContext = createContext<AdsSession | null>(null);
export const AdsSessionProvider = SessionContext.Provider;
export function useAdsSession(): AdsSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useAdsSession must be used inside the Amuwa Design Studio dashboard');
  return s;
}
export const isHead = (c: AdsContext) => c.role === 'DEPARTMENT_HEAD';
export const isLead = (c: AdsContext) => c.role === 'TEAM_HEAD';
export const isMember = (c: AdsContext) => c.role === 'TEAM_MEMBER';
export const ROLE_TITLE: Record<AdsContext['role'], string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

// ---------------------------------------------------------------------------------------------------- loading data
/** Loads something from the API, again whenever the deps change, when a page action says "reload" or when another part of the dashboard changed data. */
export function useAdsData<T>(load: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadRef.current().then(
      d => { if (live) { setData(d); setError(null); setLoading(false); } },
      e => { if (live) { setError(errorMessage(e)); setLoading(false); } }
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  useEffect(() => {
    window.addEventListener(ADS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(ADS_CHANGED_EVENT, reload);
  }, [reload]);
  return { data, loading, error, reload };
}

export { aiDesignStudioApi, errorMessage };

// ---------------------------------------------------------------------------------------------------- small pieces
export const ErrorLine: React.FC<{ message: string | null; onRetry?: () => void }> = ({ message, onRetry }) =>
  message ? (
    <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start justify-between gap-3">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline shrink-0">Retry</button>}
    </div>
  ) : null;

export const Flash: React.FC<{ text: string | null; onClose?: () => void }> = ({ text, onClose }) =>
  text ? (
    <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start justify-between gap-3">
      <span>{text}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0"><X className="w-4 h-4" /></button>}
    </div>
  ) : null;

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="py-10 text-center">
    <div className="text-sm font-semibold text-slate-700">{title}</div>
    {hint && <div className="text-[13px] text-slate-500 mt-1 max-w-md mx-auto">{hint}</div>}
  </div>
);

export const FormField: React.FC<{ label: string; htmlFor: string; required?: boolean; error?: string | null; hint?: string; className?: string; children: React.ReactNode }> = ({
  label, htmlFor, required, error, hint, className = '', children
}) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-slate-700 mb-1">
      {label}{required && <span className="text-rose-600" aria-hidden="true"> *</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    {error && <p id={`${htmlFor}-error`} className="text-xs text-rose-700 mt-1" role="alert">{error}</p>}
  </div>
);

const TONES = {
  slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700', red: 'bg-rose-50 text-rose-700', violet: 'bg-violet-50 text-violet-700'
} as const;
export type BadgeTone = keyof typeof TONES;
export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = ({ tone = 'slate', children }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

const PRIORITY_TONE: Record<string, BadgeTone> = { LOW: 'slate', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' };
export const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => <Badge tone={PRIORITY_TONE[priority] || 'slate'}>{ADS_PRIORITY_LABELS[priority as keyof typeof ADS_PRIORITY_LABELS] || priority}</Badge>;

const ASSIGNMENT_TONE: Record<string, BadgeTone> = { ASSIGNED: 'slate', ACCEPTED: 'blue', IN_PROGRESS: 'blue', PENDING_REVIEW: 'violet', REVISION_REQUIRED: 'amber', COMPLETED: 'green' };
export const AssignmentStatusBadge: React.FC<{ status: string }> = ({ status }) => <Badge tone={ASSIGNMENT_TONE[status] || 'slate'}>{ADS_ASSIGNMENT_STATUS_LABELS[status as keyof typeof ADS_ASSIGNMENT_STATUS_LABELS] || status}</Badge>;

const REPORT_TONE: Record<string, BadgeTone> = { PENDING_TL: 'amber', PENDING_DH: 'violet', APPROVED: 'green', RETURNED: 'red' };
export const ReportStatusBadge: React.FC<{ status: string }> = ({ status }) => <Badge tone={REPORT_TONE[status] || 'slate'}>{ADS_REPORT_STATUS_LABELS[status as keyof typeof ADS_REPORT_STATUS_LABELS] || status}</Badge>;

const ISSUE_TONE: Record<string, BadgeTone> = { OPEN: 'amber', UNDER_REVIEW: 'violet', IN_PROGRESS: 'blue', RESOLVED: 'green', CLOSED: 'slate' };
export const IssueStatusBadge: React.FC<{ status: string }> = ({ status }) => <Badge tone={ISSUE_TONE[status] || 'slate'}>{ADS_ISSUE_STATUS_LABELS[status as keyof typeof ADS_ISSUE_STATUS_LABELS] || status}</Badge>;

const NOTICE_TONE: Record<string, BadgeTone> = { OPEN: 'amber', ACKNOWLEDGED: 'blue', RESOLVED: 'green' };
export const NoticeStatusBadge: React.FC<{ status: string }> = ({ status }) => <Badge tone={NOTICE_TONE[status] || 'slate'}>{ADS_NOTICE_STATUS_LABELS[status as keyof typeof ADS_NOTICE_STATUS_LABELS] || status}</Badge>;

// ---------------------------------------------------------------------------------------------------- dates
export const fmtDate = (v: string | null | undefined) => {
  if (!v) return '–';
  // a plain date (2026-01-31) is shown as that calendar day, never shifted by the time zone
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
export const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** What the history says, in words (the event names the database writes). */
export const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Updated', STATUS: 'Status changed', DELEGATED: 'Passed on to a Team Member', DEADLINE: 'Deadline changed', PRIORITY: 'Priority changed',
  INSTRUCTIONS: 'Instructions changed', REASSIGNED: 'Reassigned', SUBMITTED: 'Submitted', RESUBMITTED: 'Sent again', APPROVED_BY_TEAM_LEAD: 'Approved by the Team Lead',
  APPROVED_BY_DEPARTMENT_HEAD: 'Approved by the Department Head', RETURNED_BY_TEAM_LEAD: 'Returned by the Team Lead', RETURNED_BY_DEPARTMENT_HEAD: 'Returned by the Department Head',
  RESPONSE: 'Response', ESCALATED: 'Escalated to the Department Head'
};

/** The history of a record: who did what and when. */
export const Timeline: React.FC<{ events: { id: number; event: string; fromValue: string | null; toValue: string | null; note: string | null; actorName: string | null; createdAt: string }[] }> = ({ events }) => (
  <ol className="space-y-3" aria-label="History">
    {events.map(e => (
      <li key={e.id} className="border-l-2 border-slate-200 pl-3">
        <div className="text-[13px] font-semibold text-slate-800">{EVENT_LABEL[e.event] || e.event}</div>
        <div className="text-xs text-slate-500">{e.actorName || 'Someone'} · {fmtDateTime(e.createdAt)}</div>
        {e.note && <div className="text-[13px] text-slate-700 mt-1 whitespace-pre-wrap">{e.note}</div>}
      </li>
    ))}
  </ol>
);

// ---------------------------------------------------------------------------------------------------- attachment links
/** Up to 5 attachment links (a name and an http(s) address). Files are not uploaded here: the same link rule as the work reports. */
export const LinksField: React.FC<{ value: AdsLink[]; onChange: (v: AdsLink[]) => void; idPrefix: string; disabled?: boolean }> = ({ value, onChange, idPrefix, disabled }) => (
  <div className="space-y-2">
    {value.map((l, i) => (
      <div key={i} className="flex flex-wrap gap-2 items-center">
        <input aria-label={`Attachment ${i + 1} name`} id={`${idPrefix}-name-${i}`} className={`${fieldCls} sm:w-44 sm:flex-none`} placeholder="Name" maxLength={120} disabled={disabled}
          value={l.name} onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
        <input aria-label={`Attachment ${i + 1} link`} id={`${idPrefix}-url-${i}`} className={`${fieldCls} flex-1 min-w-[12rem]`} placeholder="https://…" maxLength={500} disabled={disabled}
          value={l.url} onChange={e => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
        <button type="button" className={`${ghostBtn} !px-3`} aria-label={`Remove attachment ${i + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
      </div>
    ))}
    {value.length < 5 && (
      <button type="button" className={`${ghostBtn} !h-9 !text-[13px]`} disabled={disabled} onClick={() => onChange([...value, { name: '', url: '' }])}>
        <Plus className="w-4 h-4" /> Add attachment link
      </button>
    )}
  </div>
);
/** Drops empty rows before sending. */
export const cleanLinks = (v: AdsLink[]): AdsLink[] => v.filter(l => l.url.trim()).map(l => ({ name: l.name.trim() || l.url.trim(), url: l.url.trim() }));

export const LinksList: React.FC<{ links: AdsLink[] }> = ({ links }) =>
  links.length ? (
    <ul className="space-y-1">
      {links.map((l, i) => (
        <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-blue-700 underline break-all">{l.name || l.url}</a></li>
      ))}
    </ul>
  ) : <span className="text-slate-400">–</span>;

export const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap break-words">{children || <span className="text-slate-400">–</span>}</dd>
  </div>
);

/** The client picker used by the forms: the clients the caller may see (the database decides). */
export const ClientSelect: React.FC<{ id: string; value: string; onChange: (v: string) => void; clients: { id: string; clientName: string; companyName: string | null }[]; allowEmpty?: boolean; emptyLabel?: string; disabled?: boolean; invalid?: boolean }> = ({
  id, value, onChange, clients, allowEmpty, emptyLabel, disabled, invalid
}) => (
  <select id={id} className={fieldCls} value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={e => onChange(e.target.value)}>
    <option value="">{allowEmpty ? emptyLabel || 'No client' : 'Choose a client'}</option>
    {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}{c.companyName ? ` · ${c.companyName}` : ''}</option>)}
  </select>
);

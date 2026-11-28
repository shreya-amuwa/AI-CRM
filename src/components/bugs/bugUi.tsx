import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { DevBug, DevBugAccess, DevBugRouting, DevBugStatus } from '../../../shared/contracts';
import { DEV_ISSUE_CATEGORY_LABELS } from '../../../shared/validation';
import { bugsApi } from '../../lib/api/bugs';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { Paged } from '../common/Paged';

/** Shared pieces of the bug screens (the employee's report and the developers' Bugs section). */
export const BUG_STATUS_LABEL: Record<DevBugStatus, string> = {
  PENDING: 'Pending', UNDER_REVIEW: 'Under Review', IN_PROGRESS: 'In Progress', NEEDS_INFO: 'Pending Information', RESOLVED: 'Resolved', REJECTED: 'Rejected', CLOSED: 'Closed'
};
const BUG_STATUS_STYLE: Record<DevBugStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200', UNDER_REVIEW: 'bg-sky-50 text-sky-800 border-sky-200', IN_PROGRESS: 'bg-blue-50 text-blue-800 border-blue-200',
  NEEDS_INFO: 'bg-orange-50 text-orange-800 border-orange-200', RESOLVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-slate-100 text-slate-600 border-slate-200', CLOSED: 'bg-slate-100 text-slate-700 border-slate-300'
};
/** still being worked on (the rest are done: resolved, rejected or closed) */
export const bugOpen = (s: DevBugStatus) => s === 'PENDING' || s === 'UNDER_REVIEW' || s === 'IN_PROGRESS' || s === 'NEEDS_INFO';
const SOURCE_LABEL = { EMPLOYEE: null, HR_REPORT: 'Reported by HR', HR_ESCALATION: 'Escalated by HR' } as const;
const PRIORITY_STYLE: Record<string, string> = {
  LOW: 'bg-slate-50 text-slate-600 border-slate-200', MEDIUM: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  HIGH: 'bg-orange-50 text-orange-800 border-orange-200', URGENT: 'bg-rose-50 text-rose-700 border-rose-200'
};
/** category, priority and where it came from (an HR report or escalation, with the employee issue it is linked to) */
export const BugTags: React.FC<{ b: DevBugRouting }> = ({ b }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="bug-tags">
    {b.priority ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[b.priority]}`} data-testid="bug-priority">{b.priority[0] + b.priority.slice(1).toLowerCase()}</span> : null}
    {b.category ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">{DEV_ISSUE_CATEGORY_LABELS[b.category]}</span> : null}
    {b.source && SOURCE_LABEL[b.source] ? (
      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800" data-testid="bug-source">
        {SOURCE_LABEL[b.source]}{b.sourceIssueReference ? ` · ${b.sourceIssueReference}` : ''}
      </span>
    ) : null}
  </span>
);
export const BugStatusPill: React.FC<{ status: DevBugStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${BUG_STATUS_STYLE[status]}`} data-testid="bug-status" data-status={status}>{BUG_STATUS_LABEL[status]}</span>
);
export const bugWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

/** The files of a bug: each opens through a short signed link the server issues after the database allowed it. */
export const BugFiles: React.FC<{ files: DevBug['attachments'] }> = ({ files }) => {
  const [error, setError] = useState('');
  if (!files.length) return <p className="text-xs text-slate-500">No files attached.</p>;
  const open = async (id: string) => {
    setError('');
    try {
      const { url } = await employeeCasesApi.fileUrl(id, 'view');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be opened.');
    }
  };
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {files.map(f => (
          <li key={f.id}><button type="button" onClick={() => void open(f.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
            <Paperclip className="w-3.5 h-3.5" aria-hidden /> {f.name} <span className="font-normal text-slate-400">{Math.max(1, Math.round(f.size / 1024))} KB</span>
            {f.fromIssue ? <span className="font-normal text-violet-700">· from the employee&apos;s issue</span> : null}</button></li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
};

const KIND_TEXT = (h: DevBug['history'][number]) => {
  const d = h.data as Record<string, string | null>;
  if (h.kind === 'SUBMITTED') return 'Reported';
  if (h.kind === 'ASSIGNED') return d.toName ? `Assigned to ${d.toName}` : 'Unassigned';
  if (h.kind === 'STATUS') return `Status: ${BUG_STATUS_LABEL[(d.to as DevBugStatus) ?? 'PENDING'] ?? d.to}`;
  if (h.kind === 'MESSAGE') return d.from === 'REPORTER' ? 'Message from the reporter' : (h.data as { requestInfo?: boolean }).requestInfo ? 'The developers asked for information' : 'Reply from the developers';
  return 'Internal comment';
};
export const BugHistory: React.FC<{ history: DevBug['history'] }> = ({ history }) => (
  <Paged items={history} noun="changes">{rows => (
  <ol className="space-y-2" data-testid="bug-history">
    {rows.map(h => (
      <li key={h.id} data-kind={h.kind} className={`rounded-lg border px-3 py-2 text-xs ${h.internal ? 'border-violet-200 bg-violet-50/60' : h.kind === 'MESSAGE' ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-white'}`}>
        <div className="flex flex-wrap justify-between gap-2"><b className="text-slate-800">{KIND_TEXT(h)}{h.internal ? ' (developers only)' : ''}</b><span className="text-slate-500">{h.by ?? 'System'} · {bugWhen(h.at)}</span></div>
        {h.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{h.note}</p>}
      </li>
    ))}
  </ol>
  )}</Paged>
);

/** Whether the signed-in person is one of the developers (the database decides; asked when the dashboard opens, never cached across users). */
export function useBugAccess(): DevBugAccess | null {
  const [access, setAccess] = useState<DevBugAccess | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // a network or server hiccup must not hide the Bugs section until the next reload: ask again (3 tries) before saying "not a developer"
    const ask = (retriesLeft: number) => bugsApi.access().then(a => { if (alive) setAccess(a); }, () => {
      if (!alive) return;
      if (retriesLeft > 0) timer = setTimeout(() => ask(retriesLeft - 1), 2500);
      else setAccess({ isDeveloper: false, isLead: false, developers: [] });
    });
    ask(2);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);
  return access;
}

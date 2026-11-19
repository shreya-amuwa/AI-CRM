import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, Clock3, MessageSquarePlus, Send } from 'lucide-react';
import {
  useWorkUpdatesLoader, workUpdatesApi, type TaskTimelineEntry, type WorkUpdateFilter, type WorkUpdateRequest
} from '../../lib/workUpdates';
import { fmtDate, fmtDateTime, StatusPill } from './TaskParts';
import { takePendingWorkUpdate, useOpenWorkUpdateTask } from './workUpdateEvents';

/**
 * Work updates inside the existing Task module (migration 20270116000100):
 *   - RequestUpdate          a Department Head / Team Lead asks the person a task is assigned to for an update (the database checks the hierarchy)
 *   - ResponseForm           the employee answers: progress, work done, what remains, blockers, expected date. It never changes the task.
 *   - TaskWorkUpdates        one task's requests, answers and timeline (shown inside the task)
 *   - WorkUpdatesPanel       Department Head / Team Lead: requests sent, pending, received; filters; reminders
 *   - MyUpdateRequests       Team Member: requests received, the answer form and the updates already sent
 * Buttons follow what the database says the signed-in person may do (canRespond / canFollowUp / canRequest); it checks again on every call.
 */

const field = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500';
const primary = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50';
const ghost = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const Pill: React.FC<{ tone: 'amber' | 'emerald' | 'rose' | 'slate'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls = { amber: 'bg-amber-50 text-amber-800 border-amber-200', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200', rose: 'bg-rose-50 text-rose-700 border-rose-200', slate: 'bg-slate-100 text-slate-600 border-slate-200' }[tone];
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>;
};

export const RequestStatusPill: React.FC<{ r: WorkUpdateRequest }> = ({ r }) =>
  r.status === 'RESPONDED' ? <Pill tone="emerald">Responded</Pill> : r.overdue ? <Pill tone="rose">Overdue</Pill> : <Pill tone="amber">Waiting for a response</Pill>;

/** What the employee answered. */
export const ResponseDetails: React.FC<{ r: WorkUpdateRequest }> = ({ r }) => {
  if (!r.response) return null;
  const x = r.response;
  const row = (label: string, value: string | null) => (value ? <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="text-xs text-slate-800 whitespace-pre-line">{value}</dd></div> : null);
  return (
    <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-emerald-50/50 border border-emerald-100 p-3" aria-label="Submitted update">
      {row('Current progress', x.progress)}
      {row('Work completed', x.workCompleted)}
      {row('Remaining work', x.remainingWork)}
      {row('Blockers', x.blockers)}
      {row('Expected completion', x.expectedCompletion ? fmtDate(x.expectedCompletion) : null)}
      <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Submitted</dt><dd className="text-xs text-slate-800">{fmtDateTime(x.submittedAt)}</dd></div>
    </dl>
  );
};

// ---------------------------------------------------------------------------
// Ask for an update
// ---------------------------------------------------------------------------
/** "Request update" on a task: an optional message and an optional reply-by time. The employee is the task's assignee (the database reads it). */
export const RequestUpdate: React.FC<{ taskId: string; employeeName?: string; onDone?: (message: string) => void; label?: string }> = ({ taskId, employeeName, onDone, label = 'Request update' }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await workUpdatesApi.request(taskId, message, due ? new Date(due).toISOString() : null);
      setSent(true);
      setOpen(false);
      setMessage('');
      setDue('');
      onDone?.(`Update requested${employeeName ? ` from ${employeeName}` : ''}. They have been notified.`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" className={ghost} onClick={() => { setOpen(true); setSent(false); }}><MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" /> {label}</button>
        {sent && <span className="text-[11px] text-emerald-700" role="status">Update requested{employeeName ? ` from ${employeeName}` : ''}. They have been notified.</span>}
        {error && <span className="text-[11px] text-rose-700" role="alert">{error}</span>}
      </span>
    );
  }
  return (
    <form onSubmit={send} className="w-full rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-2" aria-label="Request a work update">
      <div className="text-xs font-bold text-slate-800">Request an update{employeeName ? ` from ${employeeName}` : ''}</div>
      <label className="block text-[11px] font-medium text-slate-600">
        Message (optional)
        <textarea className={`${field} mt-1`} rows={3} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)}
          placeholder="e.g. What is the current progress? What is completed? Any blockers? When do you expect to finish?" />
      </label>
      <label className="block text-[11px] font-medium text-slate-600">
        Reply by (optional)
        <input type="datetime-local" className={`${field} mt-1 sm:max-w-xs`} value={due} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDue(e.target.value)} />
      </label>
      {error && <p className="text-[11px] text-rose-700" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send request'}</button>
        <button type="button" className={ghost} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
};

/** A reminder on the open request (the database allows one an hour, five at most). */
export const FollowUpButton: React.FC<{ r: WorkUpdateRequest; onDone?: () => void }> = ({ r, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (r.status !== 'PENDING') return null;
  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await workUpdatesApi.followUp(r.id);
      setMsg({ ok: true, text: 'Reminder sent.' });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={ghost} disabled={busy || !r.canFollowUp} onClick={go}><BellRing className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send a reminder'}</button>
      {!r.canFollowUp && r.followUpAvailableAt && <span className="text-[11px] text-slate-500">Next reminder possible {fmtDateTime(r.followUpAvailableAt)}{r.followupCount ? ` · ${r.followupCount} sent` : ''}</span>}
      {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
    </span>
  );
};

// ---------------------------------------------------------------------------
// The employee answers
// ---------------------------------------------------------------------------
export const ResponseForm: React.FC<{ r: WorkUpdateRequest; onDone: () => void }> = ({ r, onDone }) => {
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState('');
  const [left, setLeft] = useState('');
  const [blockers, setBlockers] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `wur-${r.id}`;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await workUpdatesApi.respond(r.id, { progress, workCompleted: done, remainingWork: left, blockers, expectedCompletion: expected || null });
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5" aria-label={`Submit work update for ${r.taskTitle}`}>
      <div className="text-xs font-bold text-slate-800">Submit your work update</div>
      <p className="text-[11px] text-slate-500">This does not change the task or its status. Mark the task as completed separately when it is.</p>
      <label className="block text-[11px] font-medium text-slate-600" htmlFor={`${id}-p`}>Current progress *
        <textarea id={`${id}-p`} required minLength={3} maxLength={4000} rows={3} className={`${field} mt-1`} value={progress} onChange={e => setProgress(e.target.value)} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-slate-600" htmlFor={`${id}-d`}>Work completed
          <textarea id={`${id}-d`} maxLength={4000} rows={3} className={`${field} mt-1`} value={done} onChange={e => setDone(e.target.value)} />
        </label>
        <label className="block text-[11px] font-medium text-slate-600" htmlFor={`${id}-l`}>Remaining work
          <textarea id={`${id}-l`} maxLength={4000} rows={3} className={`${field} mt-1`} value={left} onChange={e => setLeft(e.target.value)} />
        </label>
      </div>
      <label className="block text-[11px] font-medium text-slate-600" htmlFor={`${id}-b`}>Blockers or issues
        <textarea id={`${id}-b`} maxLength={4000} rows={2} className={`${field} mt-1`} value={blockers} onChange={e => setBlockers(e.target.value)} />
      </label>
      <label className="block text-[11px] font-medium text-slate-600 sm:max-w-xs" htmlFor={`${id}-e`}>Expected completion date
        <input id={`${id}-e`} type="date" className={`${field} mt-1`} value={expected} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)} onChange={e => setExpected(e.target.value)} />
      </label>
      {error && <p className="text-[11px] text-rose-700" role="alert">{error}</p>}
      <button type="submit" disabled={busy || progress.trim().length < 3} className={primary}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Submit update'}</button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// One task: requests, answers and the timeline (inside the task details)
// ---------------------------------------------------------------------------
const TIMELINE_LABEL: Record<TaskTimelineEntry['kind'], string> = {
  TASK_ASSIGNED: 'Task assigned', TASK_UPDATE: 'Progress update', WORK_UPDATE_REQUESTED: 'Work update requested',
  WORK_UPDATE_FOLLOW_UP: 'Reminder sent', WORK_UPDATE_RESPONDED: 'Work update submitted'
};

export const TaskWorkUpdates: React.FC<{ taskId: string; assigneeName?: string; startOpen?: boolean }> = ({ taskId, assigneeName, startOpen = false }) => {
  const [open, setOpen] = useState(startOpen);
  // shown here, not in the form: once a request is waiting the form is gone, and the confirmation must stay
  const [notice, setNotice] = useState<string | null>(null);
  const { data, error, loading, reload } = useWorkUpdatesLoader(() => (open ? workUpdatesApi.forTask(taskId) : Promise.resolve(null)), [taskId, open]);
  return (
    <div className="mt-2">
      <button type="button" className="inline-flex items-center gap-1 text-[12px] font-bold text-blue-700" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" /> Work updates &amp; history
      </button>
      {open && (
        <div className="mt-2 space-y-3" data-testid="task-work-updates">
          {loading && !data ? <p className="text-[11px] text-slate-500">Loading…</p> : null}
          {error && <p className="text-[11px] text-rose-700" role="alert">{error}</p>}
          {data && (
            <>
              {notice && <p className="text-[11px] text-emerald-700" role="status">{notice}</p>}
              {data.canRequest && <RequestUpdate taskId={taskId} employeeName={assigneeName} onDone={m => { setNotice(m); reload(); }} />}
              {data.requests.map(r => (
                <div key={r.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <RequestStatusPill r={r} />
                    <span className="text-slate-600">Requested {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}{r.dueAt ? ` · reply by ${fmtDateTime(r.dueAt)}` : ''}</span>
                  </div>
                  {r.message && <p className="mt-1 text-xs text-slate-700 whitespace-pre-line">{r.message}</p>}
                  <ResponseDetails r={r} />
                  {r.canRespond && <ResponseForm r={r} onDone={reload} />}
                  {r.canFollowUp || (r.status === 'PENDING' && data.canManage) ? <div className="mt-2"><FollowUpButton r={r} onDone={reload} /></div> : null}
                </div>
              ))}
              <ol className="space-y-1 border-l-2 border-slate-100 pl-3" aria-label="Task history">
                {data.timeline.map((t, i) => (
                  <li key={i} className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">{TIMELINE_LABEL[t.kind]}</span>
                    {t.actorName ? ` · ${t.actorName}` : ''} · {fmtDateTime(t.at)}
                    {t.kind === 'TASK_ASSIGNED' && t.data?.assignee ? ` · to ${String(t.data.assignee)}` : ''}
                    {t.kind === 'TASK_UPDATE' && t.data?.progress !== undefined ? ` · ${String(t.data.progress)}%` : ''}
                    {t.note ? <span className="block text-slate-500 whitespace-pre-line">{t.note.length > 240 ? `${t.note.slice(0, 240)}…` : t.note}</span> : null}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Department Head / Team Lead: Work Updates
// ---------------------------------------------------------------------------
const FILTERS: [WorkUpdateFilter, string, 'all' | 'pending' | 'responded' | 'overdue'][] = [
  ['ALL', 'All Updates', 'all'], ['PENDING', 'Pending', 'pending'], ['RESPONDED', 'Responded', 'responded'], ['OVERDUE', 'Overdue', 'overdue']
];

const RequestRow: React.FC<{ r: WorkUpdateRequest; open: boolean; onToggle: () => void; onChanged: () => void }> = ({ r, open, onToggle, onChanged }) => (
  <li className={`rounded-xl border p-3 ${r.overdue ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200 bg-white'}`} data-testid="work-update-row">
    <button type="button" className="w-full text-left" aria-expanded={open} onClick={onToggle}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-slate-900">{r.requestedFromName}</span>
        <RequestStatusPill r={r} />
        <StatusPill status={r.taskStatus} />
      </div>
      <p className="text-xs font-semibold text-slate-800 mt-0.5">{r.taskTitle}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">
        Requested {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}
        {r.dueAt ? ` · reply by ${fmtDateTime(r.dueAt)}` : ''}{r.respondedAt ? ` · responded ${fmtDateTime(r.respondedAt)}` : ''}
      </p>
      {r.response && (
        <p className="text-[11px] text-slate-700 mt-1"><strong>Progress:</strong> {r.response.progress.length > 140 ? `${r.response.progress.slice(0, 140)}…` : r.response.progress}
          {r.response.blockers ? <span className="text-rose-700"> · <strong>Blockers:</strong> {r.response.blockers.length > 80 ? `${r.response.blockers.slice(0, 80)}…` : r.response.blockers}</span> : null}
          {r.response.expectedCompletion ? <span> · expected {fmtDate(r.response.expectedCompletion)}</span> : null}</p>
      )}
    </button>
    {open && (
      <div className="mt-2 space-y-2">
        {r.message && <p className="text-xs text-slate-700 whitespace-pre-line"><strong>Request:</strong> {r.message}</p>}
        <ResponseDetails r={r} />
        {r.status === 'PENDING' && <FollowUpButton r={r} onDone={onChanged} />}
        <TaskWorkUpdates taskId={r.taskId} assigneeName={r.requestedFromName} />
      </div>
    )}
  </li>
);

export const WorkUpdatesPanel: React.FC<{ title?: string; hint?: string }> = ({ title = 'Work Updates', hint = 'Ask the people your tasks are assigned to how the work is going, and follow their answers here.' }) => {
  const [filter, setFilter] = useState<WorkUpdateFilter>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, loading, reload } = useWorkUpdatesLoader(() => workUpdatesApi.list(filter), [filter]);
  const top = useRef<HTMLDivElement | null>(null);
  // a notification asked for a task: show the list that has it, expanded
  useOpenWorkUpdateTask(() => setFilter('ALL'));
  useEffect(() => {
    const p = takePendingWorkUpdate();
    if (p?.taskId && data) {
      const hit = data.items.find(i => i.taskId === p.taskId);
      if (hit) { setOpenId(hit.id); top.current?.scrollIntoView({ block: 'start' }); }
    }
  }, [data]);
  return (
    <section ref={top} className="space-y-3" aria-label={title}>
      <div>
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Clock3 className="w-4 h-4 text-blue-600" aria-hidden="true" /> {title}</h2>
        <p className="text-[11px] text-slate-500">{hint}</p>
      </div>
      <div role="tablist" aria-label="Work update filters" className="flex flex-wrap gap-1.5">
        {FILTERS.map(([id, label, key]) => (
          <button key={id} role="tab" type="button" aria-selected={filter === id} onClick={() => setFilter(id)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
            {label}{data ? ` (${data.counts[key]})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">{error}</p>}
      {loading && !data ? <p className="text-xs text-slate-500">Loading…</p> : data && data.items.length === 0 ? (
        <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-300 p-4">{filter === 'ALL' ? 'No update has been requested yet. Open a task and choose "Request update".' : 'Nothing here.'}</p>
      ) : (
        <ul className="space-y-2">{data?.items.map(r => <RequestRow key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(o => (o === r.id ? null : r.id))} onChanged={reload} />)}</ul>
      )}
    </section>
  );
};

/** Pending and responded counts for a badge or a tile. */
export function useWorkUpdateCounts() {
  const { data } = useWorkUpdatesLoader(() => workUpdatesApi.list('ALL', 1, 0).catch(() => null), []);
  return data?.counts ?? null;
}

// ---------------------------------------------------------------------------
// Team Member: Update Requests
// ---------------------------------------------------------------------------
export const MyUpdateRequests: React.FC = () => {
  const { data, error, loading, reload } = useWorkUpdatesLoader(() => workUpdatesApi.myRequests(), []);
  const [showSent, setShowSent] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const pending = data?.items.filter(i => i.status === 'PENDING') ?? [];
  const sent = data?.items.filter(i => i.status === 'RESPONDED') ?? [];
  useEffect(() => { takePendingWorkUpdate(); }, [data]);
  if (loading && !data) return null;
  if (!error && data && data.items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Update Requests" id="update-requests">
      <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><BellRing className="w-4 h-4 text-amber-600" aria-hidden="true" /> Update Requests{pending.length ? ` (${pending.length})` : ''}</h2>
      {error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">{error}</p>}
      {justSent && <p className="text-xs text-emerald-700 flex items-center gap-1" role="status"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Update sent. Your manager has been notified.</p>}
      {pending.length === 0 && !error ? <p className="text-xs text-slate-500">No one is waiting for an update from you.</p> : null}
      {pending.map(r => (
        <article key={r.id} className={`rounded-2xl border p-4 ${r.overdue ? 'border-rose-200 bg-rose-50/30' : 'border-amber-200 bg-amber-50/30'}`} aria-label={`Update request: ${r.taskTitle}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">{r.taskTitle}</h3>
              {r.taskDescription && <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-line">{r.taskDescription}</p>}
            </div>
            <StatusPill status={r.taskStatus} />
          </div>
          <p className="text-[11px] text-slate-600 mt-2">
            Requested by <strong>{r.requestedByName ?? 'your manager'}</strong> · {fmtDateTime(r.createdAt)}
            {r.dueAt ? <span className={r.overdue ? 'text-rose-700 font-semibold' : ''}> · {r.overdue ? 'was due' : 'reply by'} {fmtDateTime(r.dueAt)}{r.overdue ? <AlertTriangle className="inline w-3 h-3 ml-1" aria-hidden="true" /> : null}</span> : null}
            {r.followupCount ? ` · ${r.followupCount} reminder${r.followupCount === 1 ? '' : 's'}` : ''}
          </p>
          {r.message && <p className="mt-2 text-xs text-slate-800 whitespace-pre-line rounded-lg bg-white border border-slate-200 p-2.5"><strong>Message: </strong>{r.message}</p>}
          {r.canRespond && <ResponseForm r={r} onDone={() => { setJustSent(true); reload(); }} />}
        </article>
      ))}
      {sent.length > 0 && (
        <div>
          <button type="button" className="inline-flex items-center gap-1 text-[12px] font-bold text-blue-700" aria-expanded={showSent} onClick={() => setShowSent(s => !s)}>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSent ? '' : '-rotate-90'}`} aria-hidden="true" /> Updates I sent ({sent.length})
          </button>
          {showSent && (
            <ul className="mt-2 space-y-2">
              {sent.map(r => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-800">{r.taskTitle}</p>
                  <p className="text-[11px] text-slate-500">Asked {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}{r.respondedAt ? ` · answered ${fmtDateTime(r.respondedAt)}` : ''}</p>
                  <ResponseDetails r={r} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { workTasksApi, type TaskStatus, type WorkUpdateInput } from '../../lib/workTasks';
import { notifyWorkUpdatesChanged } from '../../lib/workUpdates';

type UpdateStatus = WorkUpdateInput['status'];

const STATUSES: { id: UpdateStatus; label: string }[] = [
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'BLOCKED', label: 'Blocked' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'NOT_COMPLETED', label: 'Not completed' }
];

const field = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500';
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * "Submit Work Update": the employee's structured progress report. Each one is added to the task's history (nothing is overwritten) and the task
 * then shows the latest. The rules match the database's, so the form says what is missing before it is sent: a real update needs what was done
 * (or, when blocked, what blocks); Completed is 100% and anything else is below 100%; a status change alone never sets the progress.
 */
export const WorkUpdateForm: React.FC<{
  taskId: string;
  currentStatus: TaskStatus;
  currentProgress: number;
  /** The update request this answers, when it does. */
  requestId?: string | null;
  /** Which status the form starts on: "Mark as blocked" opens it on Blocked, "Submit completion" on Completed. Nothing is submitted until the person sends it. */
  initialStatus?: UpdateStatus;
  onDone: (message: string) => void;
  onCancel?: () => void;
}> = ({ taskId, currentStatus, currentProgress, requestId, initialStatus, onDone, onCancel }) => {
  const [status, setStatus] = useState<UpdateStatus>(initialStatus ?? (currentStatus === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS'));
  const [progress, setProgress] = useState(Math.min(99, currentProgress));
  const [done, setDone] = useState('');
  const [left, setLeft] = useState('');
  const [blockers, setBlockers] = useState('');
  const [next, setNext] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `wuf-${taskId}${requestId ? `-${requestId}` : ''}`;

  const completing = status === 'COMPLETED';
  const needsBlocker = status === 'BLOCKED' || status === 'NOT_COMPLETED';
  const effective = completing ? 100 : Math.min(99, progress);
  const missing = needsBlocker
    ? blockers.trim().length < 10 ? (status === 'BLOCKED' ? 'Explain what is blocking the task (at least 10 characters).' : 'Explain why the task could not be completed (at least 10 characters).') : null
    : done.trim().length < 10 ? 'Describe the work completed since your last update (at least 10 characters).' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await workTasksApi.submitWorkUpdate(taskId, {
        status, progress: effective, workCompleted: done, remainingWork: left, blockers, nextSteps: next, expectedCompletion: expected || null, requestId: requestId ?? null
      });
      notifyWorkUpdatesChanged();
      onDone(completing ? 'Final update submitted. The task is completed.' : 'Work update submitted. Your manager has been notified.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the update.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/30 p-3.5" aria-label="Submit work update" data-testid="work-update-form" data-no-open>
      <div>
        <div className="text-[13px] font-bold text-slate-900">{requestId ? 'Respond to the update request' : 'Submit work update'}</div>
        <p className="text-[11px] text-slate-500">Each update is kept in the task history. Your progress is what you report here; changing the status does not change it.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-status`}>Current status
          <select id={`${id}-status`} className={`${field} mt-1`} value={status} onChange={e => setStatus(e.target.value as UpdateStatus)}>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-progress`}>Progress: <span className="text-slate-900">{effective}%</span>
          <input id={`${id}-progress`} type="range" min={0} max={completing ? 100 : 99} step={5} value={effective} disabled={completing} onChange={e => setProgress(Number(e.target.value))}
            className="mt-2.5 w-full accent-blue-600" aria-valuetext={`${effective} percent`} />
          {completing && <span className="font-normal text-slate-500">A completed task is 100%.</span>}
        </label>
      </div>
      {!needsBlocker && (
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-done`}>Work completed since the last update *
          <textarea id={`${id}-done`} className={`${field} mt-1`} rows={3} maxLength={4000} value={done} onChange={e => setDone(e.target.value)} placeholder="What did you finish or move forward?" />
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!completing && (
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-left`}>Remaining work
            <textarea id={`${id}-left`} className={`${field} mt-1`} rows={2} maxLength={4000} value={left} onChange={e => setLeft(e.target.value)} />
          </label>
        )}
        {!completing && (
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-next`}>Next steps
            <textarea id={`${id}-next`} className={`${field} mt-1`} rows={2} maxLength={4000} value={next} onChange={e => setNext(e.target.value)} />
          </label>
        )}
      </div>
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${id}-blockers`}>Blockers or issues{needsBlocker ? ' *' : ''}
        <textarea id={`${id}-blockers`} className={`${field} mt-1`} rows={2} maxLength={4000} value={blockers} onChange={e => setBlockers(e.target.value)}
          placeholder={needsBlocker ? 'What is in the way?' : 'Anything slowing you down? (optional)'} />
      </label>
      {!completing && (
        <label className="block text-[11px] font-semibold text-slate-600 sm:max-w-xs" htmlFor={`${id}-expected`}>Expected completion date (if changed)
          <input id={`${id}-expected`} type="date" className={`${field} mt-1`} min={today()} value={expected} onChange={e => setExpected(e.target.value)} />
        </label>
      )}
      {(missing || error) && <p className={`text-[11px] ${error ? 'text-rose-700' : 'text-slate-500'}`} role={error ? 'alert' : undefined}>{error ?? missing}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !!missing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          <Send className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Sending…' : completing ? 'Submit final update' : 'Submit update'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>}
      </div>
    </form>
  );
};

/** A "Submit work update" button that opens the form in place (a task card). The confirmation stays after the form closes. */
export const SubmitWorkUpdate: React.FC<{ taskId: string; status: TaskStatus; progress: number; onSent?: () => void }> = ({ taskId, status, progress, onSent }) => {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (status === 'COMPLETED') return <p className="text-[11px] font-semibold text-emerald-700">This task is completed.</p>;
  return (
    <div className="space-y-2" data-no-open>
      {!open && (
        <button type="button" onClick={() => { setOpen(true); setNotice(null); }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">Submit work update</button>
      )}
      {notice && <p className="text-[11px] text-emerald-700" role="status">{notice}</p>}
      {open && <WorkUpdateForm taskId={taskId} currentStatus={status} currentProgress={progress} onCancel={() => setOpen(false)} onDone={m => { setOpen(false); setNotice(m); onSent?.(); }} />}
    </div>
  );
};

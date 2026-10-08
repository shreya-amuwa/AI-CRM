import React, { useState } from 'react';
import { AlertTriangle, CalendarDays, Send } from 'lucide-react';
import { isOverdue, type Person, type TaskPriority, type TaskStatus, type WorkTask, type WorkTaskUpdate } from '../../lib/workTasks';

export const STATUS_UI: Record<TaskStatus, { label: string; cls: string }> = {
  ASSIGNED: { label: 'Not started', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NOT_COMPLETED: { label: 'Not completed', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
};

const PRIORITY_UI: Record<TaskPriority, string> = {
  HIGH: 'bg-rose-50 text-rose-700 border-rose-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-slate-50 text-slate-600 border-slate-200'
};

export const StatusPill: React.FC<{ status: TaskStatus }> = ({ status }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_UI[status].cls}`}>
    {STATUS_UI[status].label}
  </span>
);

export const PriorityPill: React.FC<{ priority: TaskPriority }> = ({ priority }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${PRIORITY_UI[priority]}`}>
    {priority.toLowerCase()}
  </span>
);

export const ProgressBar: React.FC<{ value: number; label?: string }> = ({ value, label }) => (
  <div
    className="h-1.5 rounded-full bg-slate-100 overflow-hidden"
    role="progressbar"
    aria-label={label || 'Progress'}
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div className={`h-full rounded-full ${value >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, value)}%` }} />
  </div>
);

export const fmtDate = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

export const DueLabel: React.FC<{ task: WorkTask }> = ({ task }) =>
  task.dueDate ? (
    <span className={`inline-flex items-center gap-1 text-[11px] ${isOverdue(task) ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
      {isOverdue(task) ? <AlertTriangle className="w-3 h-3" aria-hidden="true" /> : <CalendarDays className="w-3 h-3" aria-hidden="true" />}
      {isOverdue(task) ? 'Overdue · ' : 'Due '}
      {fmtDate(task.dueDate)}
    </span>
  ) : (
    <span className="text-[11px] text-slate-400">No due date</span>
  );

export const nameOf = (people: Person[], id: string | null) => people.find(p => p.id === id)?.fullName || 'Unknown';

/** Status + progress + note, sent to whoever assigned the task. */
export const UpdateForm: React.FC<{
  task: WorkTask;
  sendTo: string;
  onSubmit: (input: { status: TaskStatus; progress: number; note?: string }) => Promise<void>;
}> = ({ task, sendTo, onSubmit }) => {
  const [status, setStatus] = useState<TaskStatus>(task.status === 'ASSIGNED' ? 'IN_PROGRESS' : task.status);
  const [progress, setProgress] = useState(task.progress);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await onSubmit({ status, progress: status === 'COMPLETED' ? 100 : progress, note: note.trim() || undefined });
      setNote('');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the update.');
    } finally {
      setBusy(false);
    }
  };

  const id = `upd-${task.id}`;
  return (
    <form onSubmit={submit} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5" aria-label={`Send update to ${sendTo}`}>
      <div className="text-xs font-bold text-slate-800">Send update to {sendTo}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px] font-medium text-slate-600" htmlFor={`${id}-status`}>
          Status
          <select
            id={`${id}-status`}
            value={status}
            onChange={e => setStatus(e.target.value as TaskStatus)}
            className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs"
          >
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="NOT_COMPLETED">Not completed</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-600" htmlFor={`${id}-progress`}>
          Progress: {status === 'COMPLETED' ? 100 : progress}%
          <input
            id={`${id}-progress`}
            type="range"
            min={0}
            max={100}
            step={10}
            value={status === 'COMPLETED' ? 100 : progress}
            disabled={status === 'COMPLETED'}
            onChange={e => setProgress(Number(e.target.value))}
            className="mt-2 w-full accent-blue-600"
          />
        </label>
      </div>
      <label className="block text-[11px] font-medium text-slate-600" htmlFor={`${id}-note`}>
        {status === 'NOT_COMPLETED' ? 'Why could it not be completed? *' : 'Note (optional)'}
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={2000}
          value={note}
          onChange={e => setNote(e.target.value)}
          required={status === 'NOT_COMPLETED'}
          placeholder="What was done, what is pending…"
          className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs"
        />
      </label>
      {error && <p className="text-xs text-rose-700" role="alert">{error}</p>}
      {sent && <p className="text-xs text-emerald-700" role="status">Update sent to {sendTo}.</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send update'}
        </button>
      </div>
    </form>
  );
};

export const UpdateTimeline: React.FC<{ updates: WorkTaskUpdate[]; people: Person[]; empty?: string }> = ({ updates, people, empty }) =>
  updates.length === 0 ? (
    <p className="text-[11px] text-slate-400">{empty || 'No updates yet.'}</p>
  ) : (
    <ol className="space-y-2">
      {updates.map(u => (
        <li key={u.id} className="flex gap-2 text-xs">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-slate-800">{nameOf(people, u.authorId)}</span>
              <StatusPill status={u.status} />
              <span className="text-slate-500">{u.progress}%</span>
              <span className="text-[10px] text-slate-400">{fmtDateTime(u.createdAt)}</span>
            </div>
            {u.note && <p className="text-slate-600 mt-0.5 whitespace-pre-line break-words">{u.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="py-12 px-6 text-center rounded-2xl border border-dashed border-slate-300 bg-white">
    <div className="text-sm font-bold text-slate-800">{title}</div>
    {hint && <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{hint}</p>}
  </div>
);

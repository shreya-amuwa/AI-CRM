import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { SideDrawer } from '../common/SideDrawer';
import type { TaskPriority } from '../../lib/workTasks';
import { PeoplePicker, type PickerPerson } from './PeoplePicker';

export interface AssignValues {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  customerId: string | null;
  assigneeIds: string[];
}

const PRIORITIES: { id: TaskPriority; label: string; on: string }[] = [
  { id: 'LOW', label: 'Low', on: 'border-slate-400 bg-slate-100 text-slate-800' },
  { id: 'MEDIUM', label: 'Medium', on: 'border-amber-300 bg-amber-50 text-amber-800' },
  { id: 'HIGH', label: 'High', on: 'border-rose-300 bg-rose-50 text-rose-700' },
  { id: 'URGENT', label: 'Urgent', on: 'border-rose-600 bg-rose-600 text-white' }
];

const todayKey = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** What is wrong with the form, in the words a person needs. The database checks the same things again (and who may be assigned). */
export function assignProblems(v: Pick<AssignValues, 'title' | 'dueDate' | 'assigneeIds'>, today = todayKey()): Record<'title' | 'due' | 'assignee', string | null> {
  return {
    title: v.title.trim().length < 2 ? 'Give the task a title.' : null,
    due: v.dueDate && v.dueDate < today ? 'The due date cannot be in the past.' : null,
    assignee: v.assigneeIds.length === 0 ? 'Choose who the task is for.' : null
  };
}

/**
 * "Assign task": a button that opens a panel with the task (title, details, priority, due date, optional customer) and the assignment (a searchable
 * list of the people the caller passes in, with their job title and team). One or several people when `multiple`. The people are only those the
 * signed-in user's own screen already offers; the database refuses anyone outside their hierarchy, and that refusal is shown here, not swallowed.
 */
export const TaskAssignPanel: React.FC<{
  people: PickerPerson[];
  /** Pick several people (the Team Lead gives one task to many members; a Department Head gives it to one). */
  multiple?: boolean;
  assigneeLabel: string;
  customers?: { id: string; name: string; code: string }[];
  /** Shown above the list; a short way to narrow big teams. */
  groups?: { id: string; label: string }[];
  loadingPeople?: boolean;
  peopleError?: string | null;
  emptyPeople?: string;
  buttonLabel?: string;
  onSubmit: (v: AssignValues) => Promise<string>;
}> = ({ people, multiple = false, assigneeLabel, customers, groups, loadingPeople, peopleError, emptyPeople, buttonLabel = 'Assign task', onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const problems = assignProblems({ title, dueDate: dueDate || null, assigneeIds: ids });
  const invalid = Object.values(problems).some(Boolean);
  const shown = useMemo(() => (group ? people.filter(p => (p.team ?? p.department) === group) : people), [people, group]);

  const reset = () => { setTitle(''); setDescription(''); setPriority('MEDIUM'); setDueDate(''); setCustomerId(''); setIds([]); setGroup(''); setTried(false); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit({ title: title.trim(), description: description.trim(), priority, dueDate: dueDate || null, customerId: customerId || null, assigneeIds: ids });
      setSuccess(message);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign the task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={() => { setOpen(true); setSuccess(null); }} data-testid="open-assign"
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
        <Plus className="h-4 w-4" aria-hidden="true" /> {buttonLabel}
      </button>
      {success && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700" role="status"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {success}</p>}
      {open && (
        <SideDrawer title="Assign task" subtitle="The person is notified as soon as you assign it." onClose={() => { if (!busy) setOpen(false); }}>
          <form onSubmit={submit} className="space-y-5 p-5" aria-label="Assign task" noValidate>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Task information</legend>
              <div>
                <label htmlFor="ta-title" className="text-[12px] font-semibold text-slate-700">Task title *</label>
                <input id="ta-title" className={`${field} mt-1`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Call back customers with open tickets" aria-invalid={tried && !!problems.title} />
                {tried && problems.title && <p className="mt-1 text-[11px] text-rose-700" role="alert">{problems.title}</p>}
              </div>
              <div>
                <label htmlFor="ta-desc" className="text-[12px] font-semibold text-slate-700">Description</label>
                <textarea id="ta-desc" className={`${field} mt-1`} rows={3} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-slate-700" id="ta-prio">Priority</div>
                <div className="mt-1 grid grid-cols-4 gap-1.5" role="radiogroup" aria-labelledby="ta-prio">
                  {PRIORITIES.map(p => (
                    <button key={p.id} type="button" role="radio" aria-checked={priority === p.id} onClick={() => setPriority(p.id)}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold ${priority === p.id ? p.on : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ta-due" className="text-[12px] font-semibold text-slate-700">Due date</label>
                  <input id="ta-due" type="date" className={`${field} mt-1`} min={todayKey()} value={dueDate} onChange={e => setDueDate(e.target.value)} aria-invalid={tried && !!problems.due} />
                  {problems.due && <p className="mt-1 text-[11px] text-rose-700" role="alert">{problems.due}</p>}
                </div>
                {customers && (
                  <div>
                    <label htmlFor="ta-cust" className="text-[12px] font-semibold text-slate-700">Related customer (optional)</label>
                    <select id="ta-cust" className={`${field} mt-1`} value={customerId} onChange={e => setCustomerId(e.target.value)}>
                      <option value="">No customer</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Assignment</legend>
              {groups && groups.length > 1 && (
                <div>
                  <label htmlFor="ta-group" className="text-[12px] font-semibold text-slate-700">Team / department</label>
                  <select id="ta-group" className={`${field} mt-1`} value={group} onChange={e => setGroup(e.target.value)}>
                    <option value="">All</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </div>
              )}
              {loadingPeople ? <p className="text-xs text-slate-500">Loading people…</p> : peopleError ? <p className="text-xs text-rose-700" role="alert">{peopleError}</p> : (
                <PeoplePicker id="ta-people" label={assigneeLabel} people={shown} value={ids} onChange={setIds} multiple={multiple} required emptyText={emptyPeople} />
              )}
              {tried && problems.assignee && <p className="text-[11px] text-rose-700" role="alert">{problems.assignee}</p>}
            </fieldset>

            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700" role="alert">{error}</p>}
            <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Assigning…' : multiple && ids.length > 1 ? `Assign to ${ids.length} people` : 'Assign task'}
              </button>
            </div>
          </form>
        </SideDrawer>
      )}
    </div>
  );
};

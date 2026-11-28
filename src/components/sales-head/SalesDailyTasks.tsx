import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { SALES_TASK_FILTERS, type SalesTaskAssignee, type SalesTaskFilter, type SalesTaskList, type SalesTaskRow } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { toast } from '../feedback/AppFeedback';
import { userMessage } from '../../lib/feedback/errors';
import { salesHeadApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Avatar, Card, Tabs } from '../tasks/head/headParts';
import { Dialog, ErrorBanner, Pager, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput, tcSelect } from '../telecaller/ui';

const FILTER_LABEL: Record<SalesTaskFilter, string> = { ALL: 'All Tasks', PENDING: 'Pending', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', OVERDUE: 'Overdue' };
const COUNT_KEY: Record<SalesTaskFilter, keyof SalesTaskList['counts']> = { ALL: 'all', PENDING: 'pending', IN_PROGRESS: 'inProgress', COMPLETED: 'completed', OVERDUE: 'overdue' };
const STATUS_LABEL: Record<SalesTaskRow['status'], string> = { ASSIGNED: 'Pending', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', NOT_COMPLETED: 'Not completed', BLOCKED: 'Blocked' };
const STATUS_STYLE: Record<SalesTaskRow['status'], string> = {
  ASSIGNED: 'bg-slate-100 text-slate-700', IN_PROGRESS: 'bg-blue-50 text-blue-700', COMPLETED: 'bg-emerald-50 text-emerald-700', NOT_COMPLETED: 'bg-rose-50 text-rose-700', BLOCKED: 'bg-amber-50 text-amber-700'
};
const PRIORITY_STYLE: Record<SalesTaskRow['priority'], string> = { LOW: 'bg-slate-100 text-slate-700', MEDIUM: 'bg-blue-50 text-blue-700', HIGH: 'bg-rose-50 text-rose-700' };
const chip = 'inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap';
const isFilter = (v: string | undefined): v is SalesTaskFilter => !!v && (SALES_TASK_FILTERS as readonly string[]).includes(v);

/** Daily Tasks: the work given to the Sales teams, with deadlines and progress as the team reports them. */
export const SalesDailyTasks: React.FC<{ initialFilter?: string }> = ({ initialFilter }) => {
  const [filter, setFilter] = useState<SalesTaskFilter>(isFilter(initialFilter) ? initialFilter : 'ALL');
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 300);
  const [assignee, setAssignee] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<SalesTaskList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<SalesTaskAssignee[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => setPage(1), [filter, query, assignee, pageSize]);
  useEffect(() => {
    salesHeadApi.taskAssignees().then(setLeads, () => setLeads([]));
  }, []);
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current; // a slower, older answer must not overwrite a newer one
    setLoading(true);
    setError(null);
    salesHeadApi.tasks({ filter, search: query || undefined, assigneeId: assignee || undefined, page, pageSize }).then(
      d => mine === latest.current && (setData(d), setLoading(false)),
      e => mine === latest.current && (setError(errorMessage(e)), setLoading(false))
    );
  }, [filter, query, assignee, page, pageSize]);
  useEffect(load, [load]);

  const counts = data?.counts;
  return (
    <div className="space-y-5">
      <PageTitle
        title="Daily Tasks"
        subtitle="What the Sales teams have been asked to do, by when, and how far it has got."
        actions={<button type="button" className={tcBtn.primary} onClick={() => setCreating(true)}><Plus className="w-4 h-4" aria-hidden="true" /> New task</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <Tabs label="Task filter" value={filter} onChange={setFilter} options={SALES_TASK_FILTERS.map(f => ({ id: f, label: FILTER_LABEL[f], count: counts ? counts[COUNT_KEY[f]] : undefined }))} />

      <Card className="overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task or person" aria-label="Search tasks" />
          </div>
          <select className={tcSelect} value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Filter by employee">
            <option value="">All Team Leads</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {loading && !data ? <Spinner label="Loading tasks…" /> : !data || data.items.length === 0 ? (
          <EmptyState title={query || assignee || filter !== 'ALL' ? 'No tasks match' : 'No tasks yet'}>
            {query || assignee || filter !== 'ALL' ? 'Try another filter or clear the search.' : 'Create a task for a Sales Team Lead to get started.'}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[1200px]" aria-busy={loading}>
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">
                    {['Task', 'Description', 'Assigned To', 'Assigned By', 'Priority', 'Start', 'Due', 'Status', 'Progress', 'Remarks'].map(h => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(t => (
                    <tr key={t.id} className={t.overdue ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}>
                      <td className="px-4 py-3 font-semibold text-slate-900 min-w-[12rem]">{t.title}{t.subtasks > 0 && <span className="block text-xs font-normal text-slate-500">Split into {t.subtasks} member task{t.subtasks === 1 ? '' : 's'}</span>}{t.level === 'MEMBER' && <span className="block text-xs font-normal text-slate-500">Member task</span>}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[16rem]"><span className="line-clamp-2">{t.description || '-'}</span></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={t.assignee} size={26} /><div><div className="font-medium text-slate-800 whitespace-nowrap">{t.assignee}</div><div className="text-xs text-slate-500">{t.team}</div></div></div></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{t.assignedBy}</td>
                      <td className="px-4 py-3"><span className={`${chip} ${PRIORITY_STYLE[t.priority]}`}>{t.priority.charAt(0) + t.priority.slice(1).toLowerCase()}</span></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(t.startDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.dueDate ? (
                          <span className={t.overdue ? 'font-bold text-rose-700' : t.dueSoon ? 'font-bold text-amber-700' : 'text-slate-600'}>
                            {dateText(t.dueDate)}{t.overdue ? ' · overdue' : t.dueSoon ? ' · due soon' : ''}
                          </span>
                        ) : <span className="text-slate-400">No deadline</span>}
                      </td>
                      <td className="px-4 py-3"><span className={`${chip} ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span></td>
                      <td className="px-4 py-3 min-w-[8rem]">
                        <div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress of ${t.title}`}><div className="h-full bg-blue-600" style={{ width: `${t.progress}%` }} /></div><span className="text-xs font-semibold text-slate-700 w-9 text-right">{t.progress}%</span></div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[14rem]"><span className="line-clamp-2">{t.remarks || '-'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100"><Pager page={page} pageSize={pageSize} total={data.total} noun="tasks" onPage={setPage} onPageSize={setPageSize} /></div>
          </>
        )}
      </Card>

      {creating && (
        <NewTask
          leads={leads}
          onClose={() => setCreating(false)}
          onDone={name => {
            setCreating(false);
            toast.success(`Task assigned successfully to ${name}.`);
            setPage(1);
            load();
          }}
        />
      )}
    </div>
  );
};

const NewTask: React.FC<{ leads: SalesTaskAssignee[]; onClose: () => void; onDone: (name: string) => void }> = ({ leads, onClose, onDone }) => {
  const [who, setWho] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await salesHeadApi.createTask({ assigneeId: who, title: title.trim(), description: description.trim() || null, priority, dueDate: due || null });
      onDone(leads.find(l => l.id === who)?.name ?? 'the Team Lead');
    } catch (err) {
      setError(userMessage(err, 'The task could not be created. Please try again.'));
      setBusy(false);
    }
  };
  return (
    <Dialog title="New task" description="The Team Lead can split it between the members of their team and sends updates back to you." onClose={onClose} persistent={busy}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <label className="block text-xs font-semibold text-slate-700">Assign to (Sales Team Lead) *
          <select className={`${tcInput} mt-1`} value={who} onChange={e => setWho(e.target.value)} required>
            <option value="">Choose…</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.name} · {l.team}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Task title *
          <input className={`${tcInput} mt-1`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Call every Hot lead from the trade fair" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Description
          <textarea className={`${tcInput} mt-1`} rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-700">Priority
            <select className={`${tcInput} mt-1`} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Due date
            <input type="date" className={`${tcInput} mt-1`} value={due} onChange={e => setDue(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={tcBtn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={tcBtn.primary} disabled={busy || !who || !title.trim()}>{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </form>
    </Dialog>
  );
};

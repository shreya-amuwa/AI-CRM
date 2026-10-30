import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { CaseDepartment, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList, EmployeeIssueOverview, HrAssignee, IssueStatus } from '../../../shared/contracts';
import { ISSUE_CATEGORIES, ISSUE_CATEGORY_LABELS, ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, selectCls, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { MessageFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from '../issues/issueFiles';
import { takePendingHrCase } from '../issues/issueEvents';
import { CaseTimeline, dayEndExclusiveIso, dayStartIso, Detail, EmployeeBlock, IssueStatusPill, PriorityPill, Stat, shortWhen, whenLabel } from '../issues/caseUi';

/**
 * HR dashboard > Employee Issues. Every issue raised by a Team Member, Team Lead or Department Head, in every department. The figures,
 * the filters, the search and the pages all come from the database; only HR staff (and the Super Admin) reach it, the API and the database
 * refuse everyone else. Loaded when the page opens and after each change; nothing polls.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const PAGE_SIZES = [10, 20, 50];
const TABS: [string, string][] = [['ALL', 'All Issues'], ['NEW', 'New'], ['IN_PROGRESS', 'In Progress'], ['AWAITING_EMPLOYEE', 'Awaiting Employee Response'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];

const IssueDetail: React.FC<{ id: string; assignees: HrAssignee[]; onClose: () => void; onChanged: () => void }> = ({ id, assignees, onClose, onChanged }) => {
  const [data, setData] = useState<EmployeeIssueDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [status, setStatus] = useState<IssueStatus>('IN_PROGRESS');
  const [statusMessage, setStatusMessage] = useState('');
  const [response, setResponse] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<IssueStatus | null>(null);

  const apply = useCallback((d: EmployeeIssueDetail) => { setData(d); setAssignTo(d.issue.assignedHr?.id ?? ''); setStatus(d.issue.status === 'NEW' ? 'IN_PROGRESS' : d.issue.status); }, []);
  const load = useCallback(async () => {
    setError('');
    try { apply(await employeeCasesApi.hrIssue(id)); } catch (e) { setError(errText(e)); }
  }, [id, apply]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<EmployeeIssueDetail>, after?: () => void) => {
    setBusy(true);
    setError('');
    try { apply(await fn()); after?.(); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); setConfirm(null); }
  };
  const i: EmployeeIssue | undefined = data?.issue;
  const closed = i?.status === 'CLOSED';

  return (
    <Dialog title={i ? `${i.reference} · ${i.title}` : 'Issue'} onClose={onClose} wide>
      {!data && !error ? <Spinner /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {i && data ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5" data-testid="hr-issue-detail">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <IssueStatusPill status={i.status} /> <PriorityPill priority={i.priority} />
              <span className="text-xs text-slate-500">{ISSUE_CATEGORY_LABELS[i.category]} · submitted {whenLabel(i.createdAt)}</span>
            </div>
            <EmployeeBlock employee={i.employee} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800" data-testid="issue-description">{i.description}</p>
              {i.preferredResolution ? <p className="mt-2 text-xs text-slate-600"><b>Preferred resolution:</b> {i.preferredResolution}</p> : null}
            </div>
            {data.attachments.length > 0 ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Attachments</div>
                <MessageFiles items={data.attachments.map(a => ({ id: a.id, name: a.name, mime: a.mime, size: a.size }))} transport={issueFileTransport} />
              </div>
            ) : null}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Activity and status history</h3>
              <CaseTimeline events={data.events} />
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Assigned HR</h3>
              <select aria-label="Assigned HR" className={`${selectCls} w-full`} value={assignTo} onChange={e => setAssignTo(e.target.value)} disabled={busy || closed} data-testid="assign-select">
                <option value="">Not assigned</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.name} · {a.designation}</option>)}
              </select>
              <button type="button" className={btn.secondary} disabled={busy || closed || assignTo === (i.assignedHr?.id ?? '')} onClick={() => void run(() => employeeCasesApi.assignIssue(id, assignTo || null))} data-testid="assign-button">Save assignment</button>
            </Card>

            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</h3>
              <select aria-label="Status" className={`${selectCls} w-full`} value={status} onChange={e => setStatus(e.target.value as IssueStatus)} disabled={busy || closed} data-testid="status-select">
                {ISSUE_STATUSES.filter(s => s !== 'NEW' || i.status === 'NEW').map(s => <option key={s} value={s}>{ISSUE_STATUS_LABELS[s]}</option>)}
              </select>
              <Field label="Message to the employee (optional)" htmlFor="status-message"><input id="status-message" className={inputCls} value={statusMessage} maxLength={4000} onChange={e => setStatusMessage(e.target.value)} /></Field>
              <button type="button" className={btn.primary} disabled={busy || closed || (status === i.status && !statusMessage.trim())}
                onClick={() => (status === 'CLOSED' || status === 'RESOLVED' ? setConfirm(status) : void run(() => employeeCasesApi.setIssueStatus(id, status, statusMessage), () => setStatusMessage('')))} data-testid="status-button">Update status</button>
              {closed ? <p className="text-[11px] text-slate-500">A closed issue cannot be changed.</p> : null}
            </Card>

            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Respond to the employee</h3>
              <p className="text-[11px] text-slate-500">The employee reads this on their Raise an Issue page.</p>
              <textarea aria-label="Response to the employee" rows={3} className={inputCls} value={response} maxLength={4000} onChange={e => setResponse(e.target.value)} disabled={busy || closed} data-testid="response-text" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.primary} disabled={busy || closed || response.trim().length < 2} onClick={() => void run(() => employeeCasesApi.respondToIssue(id, response.trim(), false), () => setResponse(''))} data-testid="send-response">Send response</button>
                <button type="button" className={btn.secondary} disabled={busy || closed || response.trim().length < 2} onClick={() => void run(() => employeeCasesApi.respondToIssue(id, response.trim(), true), () => setResponse(''))} data-testid="request-info">Request more information</button>
              </div>
            </Card>

            <Card className="p-4 space-y-3 border-amber-200 bg-amber-50/40">
              <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800">Internal note (HR only)</h3>
              <p className="text-[11px] text-amber-800/80">Never shown to the employee.</p>
              <textarea aria-label="Internal note" rows={2} className={inputCls} value={note} maxLength={4000} onChange={e => setNote(e.target.value)} disabled={busy} data-testid="note-text" />
              <button type="button" className={btn.secondary} disabled={busy || note.trim().length < 2} onClick={() => void run(() => employeeCasesApi.noteOnIssue(id, note.trim()), () => setNote(''))} data-testid="add-note">Add note</button>
            </Card>
          </div>
        </div>
      ) : null}
      <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
      {confirm ? (
        <Dialog title={confirm === 'CLOSED' ? 'Close this issue?' : 'Mark this issue as resolved?'} description={confirm === 'CLOSED' ? 'A closed issue cannot be reopened or answered. The employee will be told.' : 'The employee will be told. They can still reply, which reopens it.'} onClose={() => setConfirm(null)} persistent>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setConfirm(null)}>Not yet</button>
            <button type="button" className={confirm === 'CLOSED' ? btn.danger : btn.green} disabled={busy} onClick={() => void run(() => employeeCasesApi.setIssueStatus(id, confirm, statusMessage), () => setStatusMessage(''))} data-testid="confirm-status">{confirm === 'CLOSED' ? 'Yes, close it' : 'Yes, resolve it'}</button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
};

export const EmployeeIssuesManagement: React.FC = () => {
  const [overview, setOverview] = useState<EmployeeIssueOverview | null>(null);
  const [list, setList] = useState<EmployeeIssueList | null>(null);
  const [departments, setDepartments] = useState<CaseDepartment[]>([]);
  const [assignees, setAssignees] = useState<HrAssignee[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('ALL');
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [assignee, setAssignee] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => { const id = takePendingHrCase('issues'); if (id) setOpen(id); }, []);

  const loadOverview = useCallback(() => { employeeCasesApi.issueOverview().then(setOverview).catch(e => setError(errText(e))); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setList(await employeeCasesApi.hrIssues({
        status: tab, departmentId: department || undefined, priority: priority || undefined, category: category || undefined,
        assigneeId: assignee && assignee !== 'NONE' ? assignee : undefined, unassigned: assignee === 'NONE', from: from ? dayStartIso(from) : undefined, to: to ? dayEndExclusiveIso(to) : undefined,
        search: q || undefined, limit: pageSize, offset: (page - 1) * pageSize
      }));
    } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [tab, department, priority, category, assignee, from, to, q, page, pageSize]);

  useEffect(() => { loadOverview(); employeeCasesApi.departments().then(setDepartments).catch(() => undefined); employeeCasesApi.assignees().then(setAssignees).catch(() => undefined); }, [loadOverview]);
  useEffect(() => { void load(); }, [load]);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const changed = () => { loadOverview(); void load(); };

  return (
    <div className="space-y-5" data-testid="employee-issues-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Employee Issues</h1>
          <p className="text-sm text-slate-500 mt-0.5">Issues raised by Team Members, Team Leads and Department Heads, across all departments.</p>
        </div>
        <button type="button" className={btn.secondary} onClick={changed} aria-label="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh</button>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total Issues" value={overview?.total ?? null} />
        <Stat label="New Issues" value={overview?.new ?? null} />
        <Stat label="In Progress" value={overview?.inProgress ?? null} />
        <Stat label="Resolved" value={overview?.resolved ?? null} />
        <Stat label="Urgent Issues" value={overview?.urgent ?? null} alert />
      </section>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Issue status">
          {TABS.map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => reset(() => setTab(v))}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tab === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`} data-testid={`tab-${v}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <div className="relative col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input className={`${inputCls} pl-9`} placeholder="Search employee, reference or title" aria-label="Search issues" value={search} onChange={e => reset(() => setSearch(e.target.value))} data-testid="issue-search" />
          </div>
          <select className={selectCls} aria-label="Department" value={department} onChange={e => reset(() => setDepartment(e.target.value))} data-testid="filter-department"><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select className={selectCls} aria-label="Priority" value={priority} onChange={e => reset(() => setPriority(e.target.value))} data-testid="filter-priority"><option value="">All priorities</option>{ISSUE_PRIORITIES.map(p => <option key={p} value={p}>{ISSUE_PRIORITY_LABELS[p]}</option>)}</select>
          <select className={selectCls} aria-label="Issue category" value={category} onChange={e => reset(() => setCategory(e.target.value))} data-testid="filter-category"><option value="">All categories</option>{ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{ISSUE_CATEGORY_LABELS[c]}</option>)}</select>
          <select className={selectCls} aria-label="Assigned HR employee" value={assignee} onChange={e => reset(() => setAssignee(e.target.value))} data-testid="filter-assignee"><option value="">Any HR employee</option><option value="NONE">Not assigned</option>{assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 col-span-1">From<input type="date" className={`${inputCls} !py-1.5`} aria-label="From date" value={from} max={to || undefined} onChange={e => reset(() => setFrom(e.target.value))} data-testid="filter-from" /></label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 col-span-1">To<input type="date" className={`${inputCls} !py-1.5`} aria-label="To date" value={to} min={from || undefined} onChange={e => reset(() => setTo(e.target.value))} data-testid="filter-to" /></label>
        </div>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={changed} /> : null}
      {!list && !error ? <Spinner /> : null}
      {list && list.items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500"><span data-testid="issues-empty">{overview && overview.total === 0 ? 'No employee has raised an issue yet.' : 'No issues match these filters.'}</span></Card>
      ) : null}
      {list && list.items.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="issues-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Reference', 'Employee', 'Department', 'Designation', 'Issue', 'Category', 'Priority', 'Submitted', 'Assigned HR', 'Status', 'Action'].map(h => <th key={h} scope="col" className="px-2.5 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map(i => (
                  <tr key={i.id} className="hover:bg-slate-50/70" data-testid="issue-row">
                    <td className="px-2.5 py-2.5 font-mono text-[11px] whitespace-nowrap">{i.reference}</td>
                    <td className="px-2.5 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{i.employee.name}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{i.employee.department ?? '–'}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{i.employee.designation ?? '–'}</td>
                    <td className="px-2.5 py-2.5 max-w-[11rem] truncate" title={i.title}>{i.title}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{ISSUE_CATEGORY_LABELS[i.category]}</td>
                    <td className="px-2.5 py-2.5"><PriorityPill priority={i.priority} /></td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{shortWhen(i.createdAt)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{i.assignedHr?.name ?? <span className="text-slate-400">Not assigned</span>}</td>
                    <td className="px-2.5 py-2.5"><IssueStatusPill status={i.status} /></td>
                    <td className="px-2.5 py-2.5"><button type="button" className={btn.secondary} onClick={() => setOpen(i.id)} aria-label={`Open ${i.reference}`} data-testid="open-issue">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={list.total} noun="issues" onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} sizes={PAGE_SIZES} />
        </Card>
      ) : null}
      {open ? <IssueDetail id={open} assignees={assignees} onClose={() => setOpen(null)} onChanged={changed} /> : null}
    </div>
  );
};

export default EmployeeIssuesManagement;

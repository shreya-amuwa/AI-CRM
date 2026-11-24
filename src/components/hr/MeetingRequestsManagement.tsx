import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, RefreshCw, Search } from 'lucide-react';
import type { CaseDepartment, EmployeeMeeting, EmployeeMeetingDetail, EmployeeMeetingList, EmployeeMeetingOverview, HrAssignee, MeetingAction, MeetingMode } from '../../../shared/contracts';
import { MEETING_CATEGORIES, MEETING_CATEGORY_LABELS, MEETING_MODES, MEETING_MODE_LABELS } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, selectCls, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { HrPageHeader, hrBtn } from './hrUi';
import { takePendingHrCase } from '../issues/issueEvents';
import { CaseTimeline, dayLabel, Detail, EmployeeBlock, MeetingStatusPill, Stat, timeLabel, todayLocalIso, shortWhen, whenLabel } from '../issues/caseUi';

/**
 * HR dashboard > Meeting Requests. Every meeting an employee asked for through the Raise an Issue page, in every department. A request is
 * NOT a meeting until HR schedules it: HR approves (with the confirmed date, time, mode, place or link), proposes another time, declines
 * with a reason, reschedules or cancels with a reason, and marks it completed with the outcome. The employee sees the confirmed details and
 * HR's response (never the internal notes or the outcome). The figures, filters, search and pages come from the database.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const TABS: [string, string][] = [['ALL', 'All Requests'], ['PENDING', 'Pending'], ['SCHEDULED', 'Approved / Scheduled'], ['COMPLETED', 'Completed'], ['DECLINED', 'Declined'], ['CANCELLED', 'Cancelled']];

const ACTION_LABEL: Record<MeetingAction, string> = {
  APPROVE: 'Approve and schedule', PROPOSE: 'Propose another time', DECLINE: 'Decline the request', RESCHEDULE: 'Reschedule the meeting', CANCEL: 'Cancel the meeting', COMPLETE: 'Mark as completed'
};
/** Which actions the database accepts for each status. */
const ACTIONS_FOR: Record<string, MeetingAction[]> = {
  PENDING: ['APPROVE', 'PROPOSE', 'DECLINE', 'CANCEL'], ALTERNATIVE_PROPOSED: ['APPROVE', 'PROPOSE', 'DECLINE', 'CANCEL'], SCHEDULED: ['RESCHEDULE', 'CANCEL', 'COMPLETE'], DECLINED: [], CANCELLED: [], COMPLETED: []
};

const MeetingDetail: React.FC<{ id: string; assignees: HrAssignee[]; onClose: () => void; onChanged: () => void }> = ({ id, assignees, onClose, onChanged }) => {
  const [data, setData] = useState<EmployeeMeetingDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [action, setAction] = useState<MeetingAction | ''>('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [mode, setMode] = useState<MeetingMode>('IN_PERSON');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [instructions, setInstructions] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);

  const apply = useCallback((d: EmployeeMeetingDetail) => {
    const m = d.meeting;
    setData(d);
    setAssignTo(m.assignedHr?.id ?? '');
    const first = ACTIONS_FOR[m.status]?.[0] ?? '';
    setAction(first);
    setDate(m.confirmedDate ?? m.proposedDate ?? m.preferredDate);
    setTime(m.confirmedTime ?? m.proposedTime ?? m.preferredTime);
    setMode(m.confirmedMode ?? m.mode);
    setLocation(m.location ?? '');
    setLink(m.link ?? '');
    setInstructions(m.instructions ?? '');
    setMessage(''); setReason(''); setOutcome(''); setFollowUp('');
  }, []);
  const load = useCallback(async () => {
    setError('');
    try { apply(await employeeCasesApi.hrMeeting(id)); } catch (e) { setError(errText(e)); }
  }, [id, apply]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<EmployeeMeetingDetail>, after?: () => void) => {
    setBusy(true);
    setError('');
    try { apply(await fn()); after?.(); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); setConfirm(false); }
  };
  const needsDate = action === 'APPROVE' || action === 'PROPOSE' || action === 'RESCHEDULE';
  const needsReason = action === 'DECLINE' || action === 'CANCEL' || action === 'RESCHEDULE';
  const sensitive = action === 'DECLINE' || action === 'CANCEL';
  const valid = !!action && (!needsDate || (!!date && !!time)) && (!needsReason || reason.trim().length >= 3);
  const perform = () => {
    if (!action) return;
    void run(() => employeeCasesApi.decideMeeting(id, {
      action, date: needsDate ? date : undefined, time: needsDate ? time : undefined, mode: needsDate ? mode : undefined, location: needsDate ? location.trim() : undefined,
      link: needsDate ? link.trim() : undefined, instructions: needsDate ? instructions.trim() : undefined, message: message.trim(), reason: needsReason ? reason.trim() : undefined,
      outcome: action === 'COMPLETE' ? outcome.trim() : undefined, followUp: action === 'COMPLETE' ? followUp.trim() : undefined
    }));
  };
  const m: EmployeeMeeting | undefined = data?.meeting;
  const available = m ? ACTIONS_FOR[m.status] ?? [] : [];

  return (
    <Dialog title={m ? `${m.reference} · ${m.subject}` : 'Meeting request'} onClose={onClose} wide>
      {!data && !error ? <Spinner /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {m && data ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5" data-testid="hr-meeting-detail">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <MeetingStatusPill status={m.status} />
              <span className="text-xs text-slate-500">{MEETING_CATEGORY_LABELS[m.category]} · requested {whenLabel(m.createdAt)}</span>
            </div>
            <EmployeeBlock employee={m.employee} />
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Detail label="Preferred date">{dayLabel(m.preferredDate)}</Detail>
              <Detail label="Preferred time">{timeLabel(m.preferredTime)}</Detail>
              <Detail label="Preferred mode">{MEETING_MODE_LABELS[m.mode]}</Detail>
            </dl>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Purpose</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800" data-testid="meeting-description">{m.description}</p>
              {m.notes ? <p className="mt-1 text-xs text-slate-600"><b>Notes:</b> {m.notes}</p> : null}
            </div>
            {m.status === 'SCHEDULED' || m.status === 'COMPLETED' ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3" data-testid="confirmed-details">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Confirmed meeting</div>
                <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Detail label="Date">{dayLabel(m.confirmedDate)}</Detail>
                  <Detail label="Time">{timeLabel(m.confirmedTime)}</Detail>
                  <Detail label="Mode">{m.confirmedMode ? MEETING_MODE_LABELS[m.confirmedMode] : ''}</Detail>
                  <Detail label={m.confirmedMode === 'ONLINE' ? 'Meeting link' : 'Location'}>
                    {m.link ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 underline">Open <ExternalLink className="w-3 h-3" aria-hidden /></a> : m.location}
                  </Detail>
                </dl>
                {m.instructions ? <p className="mt-2 text-xs text-slate-700"><b>Instructions:</b> {m.instructions}</p> : null}
              </div>
            ) : null}
            {m.status === 'ALTERNATIVE_PROPOSED' && m.proposedDate ? <p className="text-xs text-indigo-800 rounded-xl bg-indigo-50 p-3">Waiting for the employee to answer the proposed time: {dayLabel(m.proposedDate)}, {timeLabel(m.proposedTime)}.</p> : null}
            {m.reason ? <p className="text-xs text-slate-700"><b>Reason:</b> {m.reason}</p> : null}
            {m.outcome || m.followUp ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs space-y-1" data-testid="meeting-outcome">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Outcome and follow-up (HR only)</div>
                {m.outcome ? <p><b>Outcome:</b> {m.outcome}</p> : null}
                {m.followUp ? <p><b>Follow-up:</b> {m.followUp}</p> : null}
              </div>
            ) : null}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Activity history</h3>
              <CaseTimeline events={data.events} />
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Responsible HR representative</h3>
              <select aria-label="Responsible HR representative" className={`${selectCls} w-full`} value={assignTo} onChange={e => setAssignTo(e.target.value)} disabled={busy || available.length === 0} data-testid="assign-select">
                <option value="">Not assigned</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.name} · {a.designation}</option>)}
              </select>
              <button type="button" className={btn.secondary} disabled={busy || available.length === 0 || assignTo === (m.assignedHr?.id ?? '')} onClick={() => void run(() => employeeCasesApi.assignMeeting(id, assignTo || null))} data-testid="assign-button">Save assignment</button>
            </Card>

            {available.length > 0 ? (
              <Card className="p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Manage this request</h3>
                <select aria-label="Action" className={`${selectCls} w-full`} value={action} onChange={e => setAction(e.target.value as MeetingAction)} disabled={busy} data-testid="action-select">
                  {available.map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                </select>
                {needsDate ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Date" required htmlFor="m-date"><input id="m-date" type="date" className={inputCls} min={todayLocalIso()} value={date} onChange={e => setDate(e.target.value)} /></Field>
                    <Field label="Time" required htmlFor="m-time"><input id="m-time" type="time" className={inputCls} value={time} onChange={e => setTime(e.target.value)} /></Field>
                    <Field label="Mode" htmlFor="m-mode"><select id="m-mode" className={`${selectCls} w-full`} value={mode} onChange={e => setMode(e.target.value as MeetingMode)}>{MEETING_MODES.map(x => <option key={x} value={x}>{MEETING_MODE_LABELS[x]}</option>)}</select></Field>
                    <Field label="Location" htmlFor="m-location"><input id="m-location" className={inputCls} value={location} maxLength={300} onChange={e => setLocation(e.target.value)} placeholder="Room or office" /></Field>
                    <div className="col-span-2"><Field label="Online meeting link (https)" htmlFor="m-link"><input id="m-link" className={inputCls} value={link} maxLength={500} onChange={e => setLink(e.target.value)} placeholder="https://…" /></Field></div>
                    <div className="col-span-2"><Field label="Meeting instructions" htmlFor="m-instructions"><input id="m-instructions" className={inputCls} value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)} /></Field></div>
                  </div>
                ) : null}
                {needsReason ? <Field label="Reason (the employee will read it)" required htmlFor="m-reason"><input id="m-reason" className={inputCls} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} data-testid="reason-input" /></Field> : null}
                {action === 'COMPLETE' ? (
                  <>
                    <Field label="Meeting outcome (HR only)" htmlFor="m-outcome"><textarea id="m-outcome" rows={2} className={inputCls} value={outcome} maxLength={4000} onChange={e => setOutcome(e.target.value)} /></Field>
                    <Field label="Follow-up actions (HR only)" htmlFor="m-followup"><textarea id="m-followup" rows={2} className={inputCls} value={followUp} maxLength={4000} onChange={e => setFollowUp(e.target.value)} /></Field>
                  </>
                ) : null}
                <Field label="Message to the employee (optional)" htmlFor="m-message"><textarea id="m-message" rows={2} className={inputCls} value={message} maxLength={4000} onChange={e => setMessage(e.target.value)} /></Field>
                <button type="button" className={sensitive ? btn.danger : btn.primary} disabled={busy || !valid} onClick={() => (sensitive ? setConfirm(true) : perform())} data-testid="perform-action">{action ? ACTION_LABEL[action as MeetingAction] : 'Choose an action'}</button>
              </Card>
            ) : <p className="text-xs text-slate-500">This request is {m.status.toLowerCase()}; there is nothing more to do.</p>}

            <Card className="p-4 space-y-3 border-amber-200 bg-amber-50/40">
              <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800">Internal note (HR only)</h3>
              <textarea aria-label="Internal note" rows={2} className={inputCls} value={note} maxLength={4000} onChange={e => setNote(e.target.value)} disabled={busy} data-testid="note-text" />
              <button type="button" className={btn.secondary} disabled={busy || note.trim().length < 2} onClick={() => void run(() => employeeCasesApi.noteOnMeeting(id, note.trim()), () => setNote(''))} data-testid="add-note">Add note</button>
            </Card>
          </div>
        </div>
      ) : null}
      <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
      {confirm && action ? (
        <Dialog title={action === 'DECLINE' ? 'Decline this request?' : 'Cancel this meeting?'} description="The employee will be told, with your reason." onClose={() => setConfirm(false)} persistent>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setConfirm(false)}>Not yet</button>
            <button type="button" className={btn.danger} disabled={busy} onClick={perform} data-testid="confirm-action">{action === 'DECLINE' ? 'Yes, decline' : 'Yes, cancel it'}</button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
};

export const MeetingRequestsManagement: React.FC = () => {
  const [overview, setOverview] = useState<EmployeeMeetingOverview | null>(null);
  const [list, setList] = useState<EmployeeMeetingList | null>(null);
  const [departments, setDepartments] = useState<CaseDepartment[]>([]);
  const [assignees, setAssignees] = useState<HrAssignee[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('ALL');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [assignee, setAssignee] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => { const id = takePendingHrCase('meetings'); if (id) setOpen(id); }, []);

  const loadOverview = useCallback(() => { employeeCasesApi.meetingOverview().then(setOverview).catch(e => setError(errText(e))); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setList(await employeeCasesApi.hrMeetings({
        status: tab, departmentId: department || undefined, category: category || undefined, assigneeId: assignee && assignee !== 'NONE' ? assignee : undefined, unassigned: assignee === 'NONE',
        from: from || undefined, to: to || undefined, search: q || undefined, limit: pageSize, offset: (page - 1) * pageSize
      }));
    } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [tab, department, category, assignee, from, to, q, page, pageSize]);

  useEffect(() => { loadOverview(); employeeCasesApi.departments().then(setDepartments).catch(() => undefined); employeeCasesApi.assignees().then(setAssignees).catch(() => undefined); }, [loadOverview]);
  useEffect(() => { void load(); }, [load]);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const changed = () => { loadOverview(); void load(); };

  return (
    <div className="space-y-5" data-testid="meeting-requests-page">
      <HrPageHeader icon={CalendarClock} title="Meeting Requests"
        subtitle="Meetings employees asked for. A request is only a meeting once you schedule it."
        actions={<button type="button" className={hrBtn.secondary} onClick={changed} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh</button>} />

      <section aria-label="Summary" className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total Requests" value={overview?.total ?? null} />
        <Stat label="Pending Approval" value={overview?.pending ?? null} />
        <Stat label="Approved / Scheduled" value={overview?.scheduled ?? null} />
        <Stat label="Completed" value={overview?.completed ?? null} />
        <Stat label="Declined or Cancelled" value={overview?.declinedOrCancelled ?? null} />
      </section>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Request status">
          {TABS.map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => reset(() => setTab(v))}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tab === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`} data-testid={`tab-${v}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <div className="relative col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input className={`${inputCls} pl-9`} placeholder="Search employee, reference or subject" aria-label="Search meeting requests" value={search} onChange={e => reset(() => setSearch(e.target.value))} data-testid="meeting-search" />
          </div>
          <select className={selectCls} aria-label="Department" value={department} onChange={e => reset(() => setDepartment(e.target.value))} data-testid="filter-department"><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select className={selectCls} aria-label="Meeting category" value={category} onChange={e => reset(() => setCategory(e.target.value))} data-testid="filter-category"><option value="">All categories</option>{MEETING_CATEGORIES.map(c => <option key={c} value={c}>{MEETING_CATEGORY_LABELS[c]}</option>)}</select>
          <select className={selectCls} aria-label="Assigned HR employee" value={assignee} onChange={e => reset(() => setAssignee(e.target.value))} data-testid="filter-assignee"><option value="">Any HR employee</option><option value="NONE">Not assigned</option>{assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">Meeting from<input type="date" className={`${inputCls} !py-1.5`} aria-label="Meeting date from" value={from} max={to || undefined} onChange={e => reset(() => setFrom(e.target.value))} data-testid="filter-from" /></label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">to<input type="date" className={`${inputCls} !py-1.5`} aria-label="Meeting date to" value={to} min={from || undefined} onChange={e => reset(() => setTo(e.target.value))} data-testid="filter-to" /></label>
        </div>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={changed} /> : null}
      {!list && !error ? <Spinner /> : null}
      {list && list.items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500"><span data-testid="meetings-empty">{overview && overview.total === 0 ? 'No employee has asked for a meeting yet.' : 'No meeting requests match these filters.'}</span></Card>
      ) : null}
      {list && list.items.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="meetings-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Reference', 'Employee', 'Department', 'Subject', 'Category', 'Preferred date', 'Preferred time', 'Mode', 'Requested', 'Assigned HR', 'Status', 'Action'].map(h => <th key={h} scope="col" className="px-2.5 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.items.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50/70" data-testid="meeting-row">
                    <td className="px-2.5 py-2.5 font-mono text-[11px] whitespace-nowrap">{m.reference}</td>
                    <td className="px-2.5 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{m.employee.name}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{m.employee.department ?? '–'}</td>
                    <td className="px-2.5 py-2.5 max-w-[11rem] truncate" title={m.subject}>{m.subject}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{MEETING_CATEGORY_LABELS[m.category]}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{dayLabel(m.preferredDate)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{timeLabel(m.preferredTime)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{MEETING_MODE_LABELS[m.mode]}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{shortWhen(m.createdAt)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{m.assignedHr?.name ?? <span className="text-slate-400">Not assigned</span>}</td>
                    <td className="px-2.5 py-2.5"><MeetingStatusPill status={m.status} /></td>
                    <td className="px-2.5 py-2.5"><button type="button" className={btn.secondary} onClick={() => setOpen(m.id)} aria-label={`Open ${m.reference}`} data-testid="open-meeting">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={list.total} noun="requests" onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />
        </Card>
      ) : null}
      {open ? <MeetingDetail id={open} assignees={assignees} onClose={() => setOpen(null)} onChanged={changed} /> : null}
    </div>
  );
};

export default MeetingRequestsManagement;

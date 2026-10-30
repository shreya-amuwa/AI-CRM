import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Send } from 'lucide-react';
import type {
  CaseMyDetails, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList, EmployeeMeeting, EmployeeMeetingDetail, EmployeeMeetingList
} from '../../../shared/contracts';
import {
  ISSUE_CATEGORIES, ISSUE_CATEGORY_LABELS, ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, MEETING_CATEGORIES, MEETING_CATEGORY_LABELS, MEETING_MODES, MEETING_MODE_LABELS
} from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, selectCls, Spinner } from '../team-member/pipeline/shared';
import { MessageFiles, StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from './issueFiles';
import { CaseTimeline, dayLabel, Detail, IssueStatusPill, MeetingStatusPill, PriorityPill, timeLabel, todayLocalIso, whenLabel } from './caseUi';
import { takePendingIssues } from './issueEvents';

/**
 * Raise an Issue: ONE page for Team Members, Team Leads and Department Heads. A selector at the top switches between the two forms (Raise an
 * Issue / Meeting Request); both stay on this page. The employee's name, employee id, department and designation are read from their own
 * profile by the server (shown here, never typed), the reference number and the time of submission are given by the database, and each
 * person sees only their own issues and requests with HR's responses. Loaded when the page opens and after each change; nothing polls.
 */
type Mode = 'ISSUE' | 'MEETING';
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const PAGE = 10;

const Summary: React.FC<{ employee: CaseMyDetails | null; error: string }> = ({ employee, error }) => (
  <Card className="p-4">
    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Your details</h2>
    <p className="text-[11px] text-slate-500 mt-0.5">Taken from your profile. The date and time are recorded when you submit.</p>
    {error ? <p className="mt-2 text-xs text-rose-700" role="alert">{error}</p> : null}
    <dl className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="my-details">
      <Detail label="Name">{employee?.name}</Detail>
      <Detail label="Employee ID">{employee?.code}</Detail>
      <Detail label="Department">{employee?.department}</Detail>
      <Detail label="Designation">{employee?.designation}</Detail>
    </dl>
  </Card>
);

// ---------------------------------------------------------------------------------------------------- the two forms
const IssueFormCard: React.FC<{ onSubmitted: (i: EmployeeIssue) => void }> = ({ onSubmitted }) => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [resolution, setResolution] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** An error goes away as soon as the person starts correcting that field. */
  const clr = (k: string) => setErrors(x => (x[k] ? { ...x, [k]: '' } : x));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const files = useTicketFiles(issueFileTransport, {});

  const check = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = 'Enter an issue title (at least 3 characters).';
    if (!category) e.category = 'Choose an issue category.';
    if (description.trim().length < 10) e.description = 'Describe the issue (at least 10 characters).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || files.busy || !check()) return;
    setBusy(true);
    setProblem('');
    try {
      const issue = await employeeCasesApi.submitIssue({
        clientRequestId: requestId, title: title.trim(), category, description: description.trim(), priority, preferredResolution: resolution.trim() || undefined, attachmentIds: files.ids
      });
      setTitle(''); setCategory(''); setDescription(''); setPriority('MEDIUM'); setResolution(''); files.clear(); setErrors({});
      setRequestId(newRequestId());
      onSubmitted(issue);
    } catch (e2) {
      setProblem(errText(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-4" aria-label="Raise an issue" data-testid="issue-form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Issue Title" required htmlFor="issue-title" error={errors.title}>
              <input id="issue-title" className={inputCls} value={title} maxLength={200} onChange={e => { setTitle(e.target.value); clr('title'); }} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'issue-title-error' : undefined} />
            </Field>
          </div>
          <Field label="Issue Category" required htmlFor="issue-category" error={errors.category}>
            <select id="issue-category" className={`${selectCls} w-full`} value={category} onChange={e => { setCategory(e.target.value); clr('category'); }} aria-invalid={!!errors.category}>
              <option value="">Select a category…</option>
              {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{ISSUE_CATEGORY_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Priority" required htmlFor="issue-priority">
            <select id="issue-priority" className={`${selectCls} w-full`} value={priority} onChange={e => setPriority(e.target.value)}>
              {ISSUE_PRIORITIES.map(p => <option key={p} value={p}>{ISSUE_PRIORITY_LABELS[p]}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Detailed Issue Description" required htmlFor="issue-description" error={errors.description}>
              <textarea id="issue-description" rows={5} className={inputCls} value={description} maxLength={5000} onChange={e => { setDescription(e.target.value); clr('description'); }} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'issue-description-error' : undefined} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Preferred Resolution or Additional Comments (optional)" htmlFor="issue-resolution">
              <textarea id="issue-resolution" rows={2} className={inputCls} value={resolution} maxLength={2000} onChange={e => setResolution(e.target.value)} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-medium text-slate-600 mb-1">Attachment (optional)</div>
            <div className="flex flex-wrap items-center gap-2">
              <TicketFileButton files={files} label disabled={busy} className="tf-attach-btn" />
            </div>
            <StagedFiles files={files} hint />
          </div>
        </div>
        {problem ? <ErrorBanner message={problem} /> : null}
        <div className="flex items-center gap-3">
          <button type="submit" className={btn.primary} disabled={busy || files.busy} data-testid="submit-issue">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} Submit Issue
          </button>
          {files.busy ? <span className="text-xs text-slate-500">Waiting for the file to upload…</span> : null}
        </div>
      </form>
    </Card>
  );
};

const MeetingFormCard: React.FC<{ onSubmitted: (m: EmployeeMeeting) => void }> = ({ onSubmitted }) => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [mode, setMode] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clr = (k: string) => setErrors(x => (x[k] ? { ...x, [k]: '' } : x));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const check = () => {
    const e: Record<string, string> = {};
    if (subject.trim().length < 3) e.subject = 'Enter a meeting subject (at least 3 characters).';
    if (!category) e.category = 'Choose a meeting category.';
    if (description.trim().length < 10) e.description = 'Describe the purpose of the meeting (at least 10 characters).';
    if (!date) e.date = 'Choose a preferred date.';
    else if (date < todayLocalIso()) e.date = 'Choose today or a later date.';
    if (!time) e.time = 'Choose a preferred time.';
    if (!mode) e.mode = 'Choose In Person or Online.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setProblem('');
    try {
      const m = await employeeCasesApi.submitMeeting({
        clientRequestId: requestId, subject: subject.trim(), category, description: description.trim(), preferredDate: date, preferredTime: time, mode, notes: notes.trim() || undefined
      });
      setSubject(''); setCategory(''); setDescription(''); setDate(''); setTime(''); setMode(''); setNotes(''); setErrors({});
      setRequestId(newRequestId());
      onSubmitted(m);
    } catch (e2) {
      setProblem(errText(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-4" aria-label="Request a meeting" data-testid="meeting-form">
        <p className="text-xs text-slate-500">A request is not a confirmed meeting. HR reviews it and confirms the actual date and time.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Meeting Subject" required htmlFor="meeting-subject" error={errors.subject}>
              <input id="meeting-subject" className={inputCls} value={subject} maxLength={200} onChange={e => { setSubject(e.target.value); clr('subject'); }} aria-invalid={!!errors.subject} aria-describedby={errors.subject ? 'meeting-subject-error' : undefined} />
            </Field>
          </div>
          <Field label="Meeting Category" required htmlFor="meeting-category" error={errors.category}>
            <select id="meeting-category" className={`${selectCls} w-full`} value={category} onChange={e => { setCategory(e.target.value); clr('category'); }} aria-invalid={!!errors.category}>
              <option value="">Select a category…</option>
              {MEETING_CATEGORIES.map(c => <option key={c} value={c}>{MEETING_CATEGORY_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Meeting Mode" required htmlFor="meeting-mode" error={errors.mode}>
            <select id="meeting-mode" className={`${selectCls} w-full`} value={mode} onChange={e => { setMode(e.target.value); clr('mode'); }} aria-invalid={!!errors.mode}>
              <option value="">Select…</option>
              {MEETING_MODES.map(m => <option key={m} value={m}>{MEETING_MODE_LABELS[m]}</option>)}
            </select>
          </Field>
          <Field label="Preferred Meeting Date" required htmlFor="meeting-date" error={errors.date}>
            <input id="meeting-date" type="date" min={todayLocalIso()} className={inputCls} value={date} onChange={e => { setDate(e.target.value); clr('date'); }} aria-invalid={!!errors.date} />
          </Field>
          <Field label="Preferred Time" required htmlFor="meeting-time" error={errors.time}>
            <input id="meeting-time" type="time" className={inputCls} value={time} onChange={e => { setTime(e.target.value); clr('time'); }} aria-invalid={!!errors.time} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Meeting Purpose / Description" required htmlFor="meeting-description" error={errors.description}>
              <textarea id="meeting-description" rows={4} className={inputCls} value={description} maxLength={5000} onChange={e => { setDescription(e.target.value); clr('description'); }} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'meeting-description-error' : undefined} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Additional Notes (optional)" htmlFor="meeting-notes">
              <textarea id="meeting-notes" rows={2} className={inputCls} value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>
        {problem ? <ErrorBanner message={problem} /> : null}
        <button type="submit" className={btn.primary} disabled={busy} data-testid="submit-meeting">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} Submit Meeting Request
        </button>
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------------- details
const IssueDetailDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [data, setData] = useState<EmployeeIssueDetail | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const files = useTicketFiles(issueFileTransport, {});
  const load = useCallback(async () => {
    setError('');
    try { setData(await employeeCasesApi.myIssue(id)); } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!data || busy || files.busy || reply.trim().length < 2) return;
    setBusy(true);
    setError('');
    try {
      setData(await employeeCasesApi.replyToIssue(id, reply.trim(), files.ids));
      setReply('');
      files.clear();
      onChanged();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const i = data?.issue;
  return (
    <Dialog title={i ? `${i.reference} · ${i.title}` : 'Issue'} onClose={onClose} wide>
      {!data && !error ? <Spinner /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {i && data ? (
        <div className="space-y-4" data-testid="issue-detail">
          <div className="flex flex-wrap items-center gap-2">
            <IssueStatusPill status={i.status} employee /> <PriorityPill priority={i.priority} />
            <span className="text-xs text-slate-500">{ISSUE_CATEGORY_LABELS[i.category]} · submitted {whenLabel(i.createdAt)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <Detail label="Reference">{i.reference}</Detail>
            <Detail label="Handled by">{i.assignedHr?.name ?? 'Not assigned yet'}</Detail>
          </dl>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your description</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{i.description}</p>
            {i.preferredResolution ? <p className="mt-2 text-xs text-slate-600"><b>Preferred resolution:</b> {i.preferredResolution}</p> : null}
          </div>
          {data.attachments.length > 0 ? <MessageFiles items={data.attachments} transport={issueFileTransport} /> : null}
          {i.hrResponse ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3" data-testid="hr-response">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">HR&apos;s response {i.hrResponseAt ? `· ${whenLabel(i.hrResponseAt)}` : ''}</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{i.hrResponse}</p>
            </div>
          ) : <p className="text-xs text-slate-500">HR has not responded yet.</p>}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">History</h3>
            <CaseTimeline events={data.events} forEmployee />
          </div>
          {i.status === 'CLOSED' ? (
            <p className="text-xs text-slate-500">This issue is closed. If you still need help, raise a new issue.</p>
          ) : (
            <form onSubmit={send} className="space-y-2" aria-label="Reply to HR">
              <Field label={i.status === 'AWAITING_EMPLOYEE' ? 'HR is waiting for your reply' : 'Add a reply (optional)'} htmlFor="issue-reply">
                <textarea id="issue-reply" rows={3} className={inputCls} value={reply} maxLength={4000} onChange={e => setReply(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <TicketFileButton files={files} label disabled={busy} className="tf-attach-btn" />
              </div>
              <StagedFiles files={files} />
              <div className="flex justify-end gap-2">
                <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
                <button type="submit" className={btn.primary} disabled={busy || files.busy || reply.trim().length < 2} data-testid="send-reply">{busy ? 'Sending…' : 'Send reply'}</button>
              </div>
            </form>
          )}
          {i.status === 'CLOSED' ? <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div> : null}
        </div>
      ) : null}
    </Dialog>
  );
};

const MeetingDetailDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [data, setData] = useState<EmployeeMeetingDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await employeeCasesApi.myMeeting(id)); } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<EmployeeMeetingDetail>) => {
    setBusy(true);
    setError('');
    try { setData(await fn()); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); setConfirmCancel(false); }
  };
  const m = data?.meeting;
  const live = m && ['PENDING', 'ALTERNATIVE_PROPOSED', 'SCHEDULED'].includes(m.status);
  return (
    <Dialog title={m ? `${m.reference} · ${m.subject}` : 'Meeting request'} onClose={onClose} wide>
      {!data && !error ? <Spinner /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {m && data ? (
        <div className="space-y-4" data-testid="meeting-detail">
          <div className="flex flex-wrap items-center gap-2">
            <MeetingStatusPill status={m.status} />
            <span className="text-xs text-slate-500">{MEETING_CATEGORY_LABELS[m.category]} · requested {whenLabel(m.createdAt)}</span>
          </div>
          {m.status === 'PENDING' ? <p className="text-xs text-slate-600">HR has not confirmed this meeting yet. It is only a request until HR schedules it.</p> : null}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Detail label="You asked for">{`${dayLabel(m.preferredDate)}, ${timeLabel(m.preferredTime)}`}</Detail>
            <Detail label="Mode you asked for">{MEETING_MODE_LABELS[m.mode]}</Detail>
            <Detail label="HR representative">{m.assignedHr?.name ?? 'Not assigned yet'}</Detail>
            <Detail label="Reference">{m.reference}</Detail>
          </dl>
          {m.status === 'SCHEDULED' || m.status === 'COMPLETED' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3" data-testid="confirmed-details">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">{m.status === 'COMPLETED' ? 'The meeting took place' : 'Confirmed meeting'}</div>
              <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Detail label="Date">{dayLabel(m.confirmedDate)}</Detail>
                <Detail label="Time">{timeLabel(m.confirmedTime)}</Detail>
                <Detail label="Mode">{m.confirmedMode ? MEETING_MODE_LABELS[m.confirmedMode] : ''}</Detail>
                <Detail label={m.confirmedMode === 'ONLINE' ? 'Meeting link' : 'Location'}>
                  {m.link ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 underline">Join <ExternalLink className="w-3 h-3" aria-hidden /></a> : m.location}
                </Detail>
              </dl>
              {m.instructions ? <p className="mt-2 text-xs text-slate-700"><b>Instructions:</b> {m.instructions}</p> : null}
              {m.link && m.location ? <p className="mt-1 text-xs text-slate-700"><b>Location:</b> {m.location}</p> : null}
            </div>
          ) : null}
          {m.status === 'ALTERNATIVE_PROPOSED' && m.proposedDate ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2" data-testid="alternative">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-800">HR proposed another time</div>
              <p className="text-sm text-slate-800">{dayLabel(m.proposedDate)}, {timeLabel(m.proposedTime)}{m.location ? ` · ${m.location}` : ''}</p>
              <Field label="Message to HR (optional)" htmlFor="alt-message"><input id="alt-message" className={inputCls} value={message} maxLength={2000} onChange={e => setMessage(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.green} disabled={busy} onClick={() => void run(() => employeeCasesApi.answerAlternative(id, true, message))} data-testid="accept-alternative">Accept this time</button>
                <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run(() => employeeCasesApi.answerAlternative(id, false, message))} data-testid="decline-alternative">I cannot make it</button>
              </div>
            </div>
          ) : null}
          {m.hrResponse || m.reason ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3" data-testid="hr-response">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">HR&apos;s response {m.hrResponseAt ? `· ${whenLabel(m.hrResponseAt)}` : ''}</div>
              {m.hrResponse ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{m.hrResponse}</p> : null}
              {m.reason ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800"><b>Reason:</b> {m.reason}</p> : null}
            </div>
          ) : null}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your request</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{m.description}</p>
            {m.notes ? <p className="mt-1 text-xs text-slate-600"><b>Notes:</b> {m.notes}</p> : null}
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">History</h3>
            <CaseTimeline events={data.events} forEmployee />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {live ? <button type="button" className={btn.danger} disabled={busy} onClick={() => setConfirmCancel(true)} data-testid="cancel-meeting">{m.status === 'SCHEDULED' ? 'Cancel this meeting' : 'Withdraw request'}</button> : null}
            <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
          </div>
        </div>
      ) : null}
      {confirmCancel ? (
        <Dialog title="Cancel this request?" description="HR will be told. You can send a new request later." onClose={() => setConfirmCancel(false)} persistent>
          <Field label="Reason (optional)" htmlFor="cancel-reason"><input id="cancel-reason" className={inputCls} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setConfirmCancel(false)}>Keep it</button>
            <button type="button" className={btn.danger} disabled={busy} onClick={() => void run(() => employeeCasesApi.cancelMyMeeting(id, reason))} data-testid="confirm-cancel-meeting">Yes, cancel</button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
};

// ---------------------------------------------------------------------------------------------------- the page
const ISSUE_FILTERS: [string, string][] = [['ALL', 'All'], ['NEW', 'New'], ['IN_PROGRESS', 'In progress'], ['AWAITING_EMPLOYEE', 'Waiting for my reply'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];
const MEETING_FILTERS: [string, string][] = [['ALL', 'All'], ['PENDING', 'Pending'], ['ALTERNATIVE_PROPOSED', 'Another time proposed'], ['SCHEDULED', 'Scheduled'], ['COMPLETED', 'Completed'], ['DECLINED', 'Declined'], ['CANCELLED', 'Cancelled']];

const RaiseIssuePage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('ISSUE');
  const [me, setMe] = useState<CaseMyDetails | null>(null);
  const [meError, setMeError] = useState('');
  const [done, setDone] = useState<{ kind: Mode; reference: string; duplicate: boolean } | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [issues, setIssues] = useState<EmployeeIssueList | null>(null);
  const [meetings, setMeetings] = useState<EmployeeMeetingList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ kind: Mode; id: string } | null>(null);

  useEffect(() => {
    const p = takePendingIssues();
    if (p) { setMode(p.kind); if (p.id) setOpen({ kind: p.kind, id: p.id }); }
    employeeCasesApi.details().then(setMe).catch(e => setMeError(errText(e)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = { status: filter, limit: PAGE, offset: (page - 1) * PAGE };
      if (mode === 'ISSUE') setIssues(await employeeCasesApi.myIssues(q)); else setMeetings(await employeeCasesApi.myMeetings(q));
    } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [mode, filter, page]);
  useEffect(() => { void load(); }, [load]);

  const switchMode = (m: Mode) => { setMode(m); setFilter('ALL'); setPage(1); setDone(null); };
  const list = mode === 'ISSUE' ? issues : meetings;
  const filters = useMemo(() => (mode === 'ISSUE' ? ISSUE_FILTERS : MEETING_FILTERS), [mode]);

  return (
    <div className="space-y-5" data-testid="raise-issue-page">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Raise an Issue</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tell HR about a problem, or ask for a meeting. You can follow HR&apos;s response here.</p>
      </div>

      <Card className="p-4">
        <label htmlFor="case-type" className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">What would you like to do?</label>
        <select id="case-type" data-testid="case-type" className={`${selectCls} w-full sm:w-80 !text-sm`} value={mode} onChange={e => switchMode(e.target.value as Mode)}>
          <option value="ISSUE">Raise an Issue</option>
          <option value="MEETING">Meeting Request</option>
        </select>
      </Card>

      <Summary employee={me} error={meError} />

      {done ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="submitted-banner">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-emerald-900">
            <b>{done.kind === 'ISSUE' ? 'Your issue was submitted.' : 'Your meeting request was submitted.'}</b>{' '}
            {done.duplicate ? 'This was already sent, so nothing new was created. ' : ''}
            Your reference number is <span className="font-mono font-bold" data-testid="submitted-reference">{done.reference}</span>.
            {done.kind === 'MEETING' ? ' HR will review it and confirm the date and time.' : ' HR can see it now. You can follow its status below.'}
          </div>
        </div>
      ) : null}

      {mode === 'ISSUE' ? (
        <IssueFormCard onSubmitted={i => { setDone({ kind: 'ISSUE', reference: i.reference, duplicate: !!i.duplicate }); setPage(1); setFilter('ALL'); void load(); }} />
      ) : (
        <MeetingFormCard onSubmitted={m => { setDone({ kind: 'MEETING', reference: m.reference, duplicate: !!m.duplicate }); setPage(1); setFilter('ALL'); void load(); }} />
      )}

      <section aria-label={mode === 'ISSUE' ? 'My issues' : 'My meeting requests'} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">{mode === 'ISSUE' ? 'My issues' : 'My meeting requests'}</h2>
          <div className="flex items-center gap-2">
            <label htmlFor="my-filter" className="sr-only">Filter by status</label>
            <select id="my-filter" className={selectCls} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
              {filters.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className={btn.secondary} onClick={() => void load()} aria-label="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /></button>
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {!list && !error ? <Spinner /> : null}
        {list && list.items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">
            <span data-testid="empty-history">{mode === 'ISSUE' ? 'You have not raised any issues yet.' : 'You have not requested any meetings yet.'}</span>
          </Card>
        ) : null}
        {list && list.items.length > 0 ? (
          <Card>
            <ul className="divide-y divide-slate-100" data-testid="my-cases">
              {mode === 'ISSUE'
                ? (list as EmployeeIssueList).items.map(i => (
                  <li key={i.id}>
                    <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen({ kind: 'ISSUE', id: i.id })} data-testid="my-case-row" aria-label={`Open ${i.reference}: ${i.title}`}>
                      <span className="font-mono text-[11px] text-slate-500">{i.reference}</span>
                      <span className="flex-1 min-w-[10rem] text-sm font-semibold text-slate-800 truncate">{i.title}</span>
                      <span className="text-[11px] text-slate-500">{ISSUE_CATEGORY_LABELS[i.category]}</span>
                      <PriorityPill priority={i.priority} />
                      <IssueStatusPill status={i.status} employee />
                      <span className="text-[11px] text-slate-400">{whenLabel(i.createdAt)}</span>
                      {i.hrResponse ? <span className="basis-full text-xs text-slate-600 truncate"><b>HR:</b> {i.hrResponse}</span> : null}
                    </button>
                  </li>
                ))
                : (list as EmployeeMeetingList).items.map(m => (
                  <li key={m.id}>
                    <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen({ kind: 'MEETING', id: m.id })} data-testid="my-case-row" aria-label={`Open ${m.reference}: ${m.subject}`}>
                      <span className="font-mono text-[11px] text-slate-500">{m.reference}</span>
                      <span className="flex-1 min-w-[10rem] text-sm font-semibold text-slate-800 truncate">{m.subject}</span>
                      <span className="text-[11px] text-slate-500">{MEETING_CATEGORY_LABELS[m.category]}</span>
                      <MeetingStatusPill status={m.status} />
                      <span className="text-[11px] text-slate-600">{m.status === 'SCHEDULED' ? `${dayLabel(m.confirmedDate)}, ${timeLabel(m.confirmedTime)}` : `Asked: ${dayLabel(m.preferredDate)}, ${timeLabel(m.preferredTime)}`}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <Pager page={page} pageSize={PAGE} total={list.total} noun={mode === 'ISSUE' ? 'issues' : 'requests'} onPage={setPage} />
          </Card>
        ) : null}
      </section>

      {open?.kind === 'ISSUE' ? <IssueDetailDialog id={open.id} onClose={() => setOpen(null)} onChanged={() => void load()} /> : null}
      {open?.kind === 'MEETING' ? <MeetingDetailDialog id={open.id} onClose={() => setOpen(null)} onChanged={() => void load()} /> : null}
    </div>
  );
};

export default RaiseIssuePage;

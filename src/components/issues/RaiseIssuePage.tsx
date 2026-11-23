import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Send } from 'lucide-react';
import type { CaseMyDetails, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList } from '../../../shared/contracts';
import { ISSUE_CATEGORIES, ISSUE_CATEGORY_LABELS, ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, selectCls, Spinner } from '../team-member/pipeline/shared';
import { MessageFiles, StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from './issueFiles';
import { CaseTimeline, Detail, IssueStatusPill, PriorityPill, whenLabel } from './caseUi';
import { BUG_STATUS_LABEL } from '../bugs/bugUi';
import { openHrMeetingRequest } from '../meetings/meetingEvents';
import { takePendingIssues } from './issueEvents';
import { BugReportSection } from './BugReport';

/**
 * Raise an Issue: ONE page for Team Members, Team Leads and Department Heads, with two clearly separate recipients (migration 20270128000200):
 * "Raise an Issue to HR" (an employee issue, handled by HR, who may escalate it to the Developer Team) and "Raise an Issue to Developer Team"
 * (goes to the developers' Bugs section only). Nothing is ever sent to both. A meeting request to HR is on the Meetings page. The employee's
 * name, department and designation are read from their own profile by the server (shown here, never typed), the reference number and the
 * time of submission are given by the database, and each person sees only their own issues with the responses. Nothing polls.
 */
type Mode = 'ISSUE' | 'BUG';

/** Where an issue to HR is: with HR, or escalated by HR to the Developer Team (with the developers' status). */
const RoutingBadge: React.FC<{ issue: EmployeeIssue }> = ({ issue }) => (issue.escalation ? (
  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800" data-testid="routing-badge" data-routing="ESCALATED_TO_DEVELOPERS">
    Escalated to Developer Team · {BUG_STATUS_LABEL[issue.escalation.status] ?? issue.escalation.status}
  </span>
) : <span className="text-[11px] font-semibold text-indigo-700" data-testid="routing-badge" data-routing="WITH_HR">To: HR</span>);
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const PAGE = 10;

const Summary: React.FC<{ employee: CaseMyDetails | null; error: string }> = ({ employee, error }) => (
  <Card className="p-4">
    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Your details</h2>
    <p className="text-[11px] text-slate-500 mt-0.5">Taken from your profile. The date and time are recorded when you submit.</p>
    {error ? <p className="mt-2 text-xs text-rose-700" role="alert">{error}</p> : null}
    <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="my-details">
      <Detail label="Name">{employee?.name}</Detail>
      <Detail label="Department">{employee?.department}</Detail>
      <Detail label="Designation">{employee?.designation}</Detail>
    </dl>
  </Card>
);

// ---------------------------------------------------------------------------------------------------- the form to HR
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
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Detail label="Reference">{i.reference}</Detail>
            <Detail label="Sent to">HR</Detail>
            <Detail label="Handled by">{i.assignedHr?.name ?? 'Not assigned yet'}</Detail>
          </dl>
          {i.escalation ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-950" data-testid="escalation">
              <b>HR escalated this issue to the Developer Team</b> ({i.escalation.reference}). Their status: <b>{BUG_STATUS_LABEL[i.escalation.status] ?? i.escalation.status}</b>
              {i.escalation.resolutionNote ? <p className="mt-1 whitespace-pre-wrap text-slate-800">{i.escalation.resolutionNote}</p> : null}
            </div>
          ) : null}
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

// ---------------------------------------------------------------------------------------------------- the page
const ISSUE_FILTERS: [string, string][] = [['ALL', 'All'], ['NEW', 'New'], ['IN_PROGRESS', 'In progress'], ['AWAITING_EMPLOYEE', 'Waiting for my reply'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];
const RECIPIENTS: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'ISSUE', label: 'Raise an Issue to HR', hint: 'Workplace, policy, leave, salary, team or facilities. Only HR receives it.' },
  { mode: 'BUG', label: 'Raise an Issue to Developer Team', hint: 'A problem with the CRM itself: an error, wrong data, access or speed. Only the developers receive it.' }
];

const RaiseIssuePage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('ISSUE');
  const [me, setMe] = useState<CaseMyDetails | null>(null);
  const [meError, setMeError] = useState('');
  const [done, setDone] = useState<{ reference: string; duplicate: boolean } | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [issues, setIssues] = useState<EmployeeIssueList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [openBug, setOpenBug] = useState<string | null>(null);

  useEffect(() => {
    const p = takePendingIssues();
    // a meeting request to HR now lives on the Meetings page (HR meeting requests)
    if (p?.kind === 'MEETING') openHrMeetingRequest(p.id);
    else if (p?.kind === 'BUG') { setMode('BUG'); if (p.id) setOpenBug(p.id); }
    else if (p?.id) setOpen(p.id);
    employeeCasesApi.details().then(setMe).catch(e => setMeError(errText(e)));
  }, []);

  const load = useCallback(async () => {
    if (mode !== 'ISSUE') return;   // the issues to the Developer Team load in their own section
    setLoading(true);
    setError('');
    try { setIssues(await employeeCasesApi.myIssues({ status: filter, limit: PAGE, offset: (page - 1) * PAGE })); } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [mode, filter, page]);
  useEffect(() => { void load(); }, [load]);

  const switchMode = (m: Mode) => { setMode(m); setFilter('ALL'); setPage(1); setDone(null); };

  return (
    <div className="space-y-5" data-testid="raise-issue-page">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Raise an Issue</h1>
        <p className="text-sm text-slate-500 mt-0.5">Choose who should receive it: HR, or the Developer Team. Each issue goes to that one team only, and you follow the response here.</p>
      </div>

      <Card className="p-4">
        <div role="radiogroup" aria-label="Who should receive the issue?" className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="case-type">
          {RECIPIENTS.map(r => (
            <button key={r.mode} type="button" role="radio" aria-checked={mode === r.mode} onClick={() => switchMode(r.mode)} data-testid={`recipient-${r.mode === 'ISSUE' ? 'hr' : 'dev'}`}
              className={`text-left rounded-xl border-2 p-3 transition-colors ${mode === r.mode ? 'border-indigo-600 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <span className="block text-sm font-bold text-slate-900">{r.label}</span>
              <span className="block text-xs text-slate-600 mt-0.5">{r.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Summary employee={me} error={meError} />

      {mode === 'BUG' ? <BugReportSection openId={openBug} /> : (<>
      {done ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="submitted-banner">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-emerald-900">
            <b>Your issue was sent to HR.</b>{' '}
            {done.duplicate ? 'This was already sent, so nothing new was created. ' : ''}
            Your reference number is <span className="font-mono font-bold" data-testid="submitted-reference">{done.reference}</span>. HR can see it now. You can follow its status below.
          </div>
        </div>
      ) : null}

      <IssueFormCard onSubmitted={i => { setDone({ reference: i.reference, duplicate: !!i.duplicate }); setPage(1); setFilter('ALL'); void load(); }} />

      <section aria-label="My issues to HR" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">My issues to HR</h2>
          <div className="flex items-center gap-2">
            <label htmlFor="my-filter" className="sr-only">Filter by status</label>
            <select id="my-filter" className={selectCls} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
              {ISSUE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className={btn.secondary} onClick={() => void load()} aria-label="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /></button>
          </div>
        </div>
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {!issues && !error ? <Spinner /> : null}
        {issues && issues.items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500"><span data-testid="empty-history">You have not raised any issues to HR yet.</span></Card>
        ) : null}
        {issues && issues.items.length > 0 ? (
          <Card>
            <ul className="divide-y divide-slate-100" data-testid="my-cases">
              {issues.items.map(i => (
                <li key={i.id}>
                  {/* the whole row opens the issue */}
                  <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen(i.id)} data-testid="my-case-row" aria-label={`Open ${i.reference}: ${i.title}`}>
                    <span className="font-mono text-[11px] text-slate-500">{i.reference}</span>
                    <span className="flex-1 min-w-[10rem] text-sm font-semibold text-slate-800 truncate">{i.title}</span>
                    <RoutingBadge issue={i} />
                    <span className="text-[11px] text-slate-500">{ISSUE_CATEGORY_LABELS[i.category]}</span>
                    <PriorityPill priority={i.priority} />
                    <IssueStatusPill status={i.status} employee />
                    <span className="text-[11px] text-slate-400">{whenLabel(i.createdAt)}</span>
                    {i.hrResponse ? <span className="basis-full text-xs text-slate-600 truncate"><b>HR:</b> {i.hrResponse}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={PAGE} total={issues.total} noun="issues" onPage={setPage} />
          </Card>
        ) : null}
      </section>
      </>)}

      {open ? <IssueDetailDialog id={open} onClose={() => setOpen(null)} onChanged={() => void load()} /> : null}
    </div>
  );
};

export default RaiseIssuePage;

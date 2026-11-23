import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Search, Send } from 'lucide-react';
import type { Department, DevBug, DevBugRow, MeetingDirectoryEntry } from '../../../shared/contracts';
import { bugFollowUpSchema, bugSubmitSchema, DEV_ISSUE_CATEGORIES, DEV_ISSUE_CATEGORY_LABELS, DEV_ISSUE_PRIORITIES } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { bugsApi } from '../../lib/api/bugs';
import { organizationApi } from '../../lib/api/endpoints';
import { meetingsApi } from '../../lib/api/meetings';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, selectCls, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from './issueFiles';
import { BUG_STATUS_LABEL, BugFiles, BugHistory, BugStatusPill, BugTags, bugOpen, bugWhen } from '../bugs/bugUi';

/**
 * An issue to the Developer Team (migrations 20270122000300, 20270128000200): goes only to the developers' Bugs section, never to HR.
 * Used by every employee ("Raise an Issue to Developer Team") and by HR ("Report to Developer Team", with the affected department and
 * employee). The same file picker, limits and checks as issues; the reporter's name, department and designation come from their profile.
 * Below the form: the person's own issues, filtered in the database, each opening the conversation with the developers (their replies,
 * requests for information, the reporter's follow-ups) and the status.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const PRIORITY_LABEL: Record<(typeof DEV_ISSUE_PRIORITIES)[number], string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
const LIST_FILTERS: [string, string][] = [['', 'All'], ['OPEN', 'Open'], ['NEEDS_INFO', 'Waiting for my reply'], ['DONE', 'Resolved or closed']];

export const BugReportSection: React.FC<{ hr?: boolean; openId?: string | null }> = ({ hr = false, openId = null }) => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [category, setCategory] = useState<(typeof DEV_ISSUE_CATEGORIES)[number]>('BUG');
  const [priority, setPriority] = useState<(typeof DEV_ISSUE_PRIORITIES)[number]>('MEDIUM');
  const [deptId, setDeptId] = useState('');
  const [empId, setEmpId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<MeetingDirectoryEntry[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DevBug | null>(null);
  const files = useTicketFiles(issueFileTransport, {});
  const [mine, setMine] = useState<DevBugRow[] | null>(null);
  const [listError, setListError] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [open, setOpen] = useState<string | null>(openId);
  useEffect(() => { if (openId) setOpen(openId); }, [openId]);

  // HR names the affected department / employee: every department, and the colleagues (the database checks the ids again)
  useEffect(() => {
    if (!hr) return;
    organizationApi.departments().then(setDepartments).catch(() => setDepartments([]));
    meetingsApi.directory().then(setPeople).catch(() => setPeople([]));
  }, [hr]);
  const deptName = departments.find(d => d.id === deptId)?.name;
  const peopleShown = deptName ? people.filter(p => p.department === deptName) : people;

  const load = useCallback(() => {
    setListError('');
    bugsApi.mine({ status: filter || undefined, search: q || undefined }).then(setMine, e => { setListError(errText(e)); setMine(m => m ?? []); });
  }, [filter, q]);
  useEffect(load, [load]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || files.busy) return;
    const body = {
      title: title.trim(), description: description.trim(), steps: steps.trim() || null, attachmentIds: files.ids, clientRequestId: requestId, category, priority,
      ...(hr ? { affectedDepartmentId: deptId || null, affectedEmployeeId: empId || null } : {})
    };
    const checked = bugSubmitSchema.safeParse(body);
    const e: Record<string, string> = {};
    if (!checked.success) for (const i of checked.error.issues) { const k = String(i.path[0] ?? ''); if (k && !e[k]) e[k] = i.message; }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setProblem('');
    try {
      const bug = await bugsApi.submit(body);
      setTitle(''); setDescription(''); setSteps(''); setCategory('BUG'); setPriority('MEDIUM'); setDeptId(''); setEmpId(''); files.clear(); setErrors({});
      setRequestId(newRequestId());
      setDone(bug);
      load();
    } catch (err) {
      setProblem(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="bug-report">
      {done && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="bug-submitted">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-emerald-900">
            <b>Your issue was sent to the Developer Team.</b> {done.duplicate ? 'This was already sent, so nothing new was created. ' : ''}
            Your reference number is <span className="font-mono font-bold">{done.reference}</span>. You can follow its status and the developers&apos; replies below.
          </div>
        </div>
      )}
      <Card className="p-5">
        <form onSubmit={submit} noValidate className="space-y-4" aria-label="Raise an issue to the Developer Team" data-testid="bug-form">
          <p className="text-xs text-slate-500">This goes to the Developer Team only (not to HR).</p>
          <Field label="Issue title" required htmlFor="bug-title" error={errors.title}>
            <input id="bug-title" className={inputCls} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} aria-invalid={!!errors.title}
              placeholder="e.g. The invoice PDF opens blank" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Category" required htmlFor="bug-category" error={errors.category}>
              <select id="bug-category" className={`${selectCls} w-full`} value={category} onChange={e => setCategory(e.target.value as typeof category)}>
                {DEV_ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{DEV_ISSUE_CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
            <Field label="Priority" required htmlFor="bug-priority" error={errors.priority}>
              <select id="bug-priority" className={`${selectCls} w-full`} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
                {DEV_ISSUE_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </Field>
            {hr && (
              <>
                <Field label="Affected department (optional)" htmlFor="bug-dept" error={errors.affectedDepartmentId}>
                  <select id="bug-dept" className={`${selectCls} w-full`} value={deptId} onChange={e => { setDeptId(e.target.value); setEmpId(''); }}>
                    <option value="">Not one department</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Affected employee (optional)" htmlFor="bug-emp" error={errors.affectedEmployeeId}>
                  <select id="bug-emp" className={`${selectCls} w-full`} value={empId} onChange={e => setEmpId(e.target.value)}>
                    <option value="">Not one employee</option>
                    {peopleShown.map(p => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
                  </select>
                </Field>
              </>
            )}
          </div>
          <Field label="What is the problem?" required htmlFor="bug-description" error={errors.description}>
            <textarea id="bug-description" rows={5} className={inputCls} value={description} maxLength={5000} onChange={e => setDescription(e.target.value)} aria-invalid={!!errors.description}
              placeholder="What happened, what you expected, and which page or record it was on." />
          </Field>
          <Field label="Steps to reproduce (optional)" htmlFor="bug-steps" error={errors.steps}>
            <textarea id="bug-steps" rows={3} className={inputCls} value={steps} maxLength={5000} onChange={e => setSteps(e.target.value)} placeholder={'1. Open …\n2. Click …\n3. See …'} />
          </Field>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Screenshots or files (optional)</div>
            <TicketFileButton files={files} label disabled={busy} className="tf-attach-btn" />
            <StagedFiles files={files} hint />
          </div>
          {problem ? <ErrorBanner message={problem} /> : null}
          <div className="flex items-center gap-3">
            <button type="submit" className={btn.primary} disabled={busy || files.busy} data-testid="submit-bug">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} Send to the Developer Team
            </button>
            {files.busy ? <span className="text-xs text-slate-500">Waiting for the file to upload…</span> : null}
          </div>
        </form>
      </Card>

      <section aria-label="My issues to the Developer Team" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">{hr ? 'Issues HR reported or escalated to the Developer Team' : 'My issues to the Developer Team'}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
              <input className={`${inputCls} !py-1.5 pl-8 w-48`} aria-label="Search my issues to the Developer Team" placeholder="Title or reference" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <label htmlFor="bug-filter" className="sr-only">Filter by status</label>
            <select id="bug-filter" className={selectCls} value={filter} onChange={e => setFilter(e.target.value)} data-testid="bug-filter">
              {LIST_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className={btn.secondary} onClick={load} aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" aria-hidden /></button>
          </div>
        </div>
        {listError ? <ErrorBanner message={listError} onRetry={load} /> : null}
        {!mine && !listError ? <Spinner /> : null}
        {mine && mine.length === 0 && !listError ? (
          <Card className="p-8 text-center text-sm text-slate-500">{filter || q ? 'No issues match.' : 'You have not sent an issue to the Developer Team yet.'}</Card>
        ) : null}
        {mine && mine.length > 0 && (
          <Card>
            <ul className="divide-y divide-slate-100" data-testid="my-bugs">
              {mine.map(b => (
                <li key={b.id}>
                  {/* the whole row opens the issue */}
                  <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen(b.id)}
                    data-testid="my-bug-row" aria-label={`Open ${b.reference}: ${b.title}`}>
                    <span className="font-mono text-[11px] text-slate-500">{b.reference}</span>
                    <span className="flex-1 min-w-[10rem] text-sm font-semibold text-slate-800 truncate">{b.title}</span>
                    <span className="text-[11px] font-semibold text-violet-700">To: Developer Team</span>
                    <BugTags b={b} />
                    <BugStatusPill status={b.status} />
                    <span className="text-[11px] text-slate-500">{b.assigneeName ? `Developer: ${b.assigneeName}` : 'Not assigned yet'}</span>
                    <span className="text-[11px] text-slate-400">{bugWhen(b.createdAt)}</span>
                    {b.status === 'NEEDS_INFO' ? <span className="basis-full text-xs font-semibold text-orange-700">The developers are waiting for your reply.</span> : null}
                    {b.lastMessage ? <span className="basis-full text-xs text-slate-600 truncate"><b>{b.lastMessage.from === 'REPORTER' ? 'You' : 'Developers'}:</b> {b.lastMessage.note}</span>
                      : b.resolutionNote ? <span className="basis-full text-xs text-slate-600 truncate"><b>{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}:</b> {b.resolutionNote}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      {open && <MyBugDialog id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
};

const MyBugDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [b, setB] = useState<DevBug | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const files = useTicketFiles(issueFileTransport, {});
  useEffect(() => { bugsApi.myDetail(id).then(setB, e => setError(errText(e))); }, [id]);
  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!b || busy || files.busy) return;
    const checked = bugFollowUpSchema.safeParse({ message: message.trim(), attachmentIds: files.ids });
    if (!checked.success) { setError(checked.error.issues[0]?.message ?? 'Write your message.'); return; }
    setBusy(true);
    setError('');
    setSent('');
    try {
      const x = await bugsApi.followUp(b.id, message.trim(), files.ids);
      setB(x);
      setMessage('');
      files.clear();
      setSent(bugOpen(x.status) ? `Sent. Status: ${BUG_STATUS_LABEL[x.status]}.` : 'Sent.');
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={b ? `${b.reference}: ${b.title}` : 'Issue to the Developer Team'} onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="my-bug-dialog">
        {error ? <ErrorBanner message={error} /> : null}
        {!b && !error ? <Spinner /> : null}
        {b && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <BugStatusPill status={b.status} /><BugTags b={b} />
              <span className="text-xs text-slate-600">{b.assigneeName ? `Developer: ${b.assigneeName}` : 'Not assigned yet'}</span>
            </div>
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">Sent to</dt><dd className="font-semibold text-violet-800">The Developer Team</dd>
              {b.affectedDepartment ? <><dt className="text-slate-500">Affected department</dt><dd>{b.affectedDepartment}</dd></> : null}
              {b.affectedEmployee ? <><dt className="text-slate-500">Affected employee</dt><dd>{b.affectedEmployee}</dd></> : null}
              <dt className="text-slate-500">Sent</dt><dd>{bugWhen(b.createdAt)}</dd>
            </dl>
            {b.status === 'NEEDS_INFO' && <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-900" role="status">The developers asked for more information. Reply below.</p>}
            {b.resolutionNote && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3"><b>{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}:</b> {b.resolutionNote}</p>}
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{b.description}</p>
            {b.steps && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3"><b>Steps:</b> {b.steps}</p>}
            <BugFiles files={b.attachments} />
            <div><h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">Progress and conversation</h3><BugHistory history={b.history} /></div>
            {b.status === 'CLOSED' ? (
              <p className="text-xs text-slate-500">This issue is closed. If the problem comes back, send a new one.</p>
            ) : (
              <form onSubmit={send} className="space-y-2" aria-label="Message the Developer Team" data-testid="bug-follow-up">
                <Field label={b.status === 'NEEDS_INFO' ? 'Your answer to the developers' : 'Follow up with the developers (optional)'} htmlFor="bug-follow-up-text">
                  <textarea id="bug-follow-up-text" rows={3} maxLength={3000} className={inputCls} value={message} onChange={e => setMessage(e.target.value)} />
                </Field>
                <TicketFileButton files={files} label disabled={busy} className="tf-attach-btn" />
                <StagedFiles files={files} />
                {sent ? <p role="status" className="text-xs text-emerald-700">{sent}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
                  <button type="submit" className={btn.primary} disabled={busy || files.busy || message.trim().length < 2} data-testid="send-follow-up">{busy ? 'Sending…' : 'Send'}</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
};

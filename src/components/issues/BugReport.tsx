import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Send } from 'lucide-react';
import type { DevBug, DevBugRow } from '../../../shared/contracts';
import { bugSubmitSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { bugsApi } from '../../lib/api/bugs';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Spinner } from '../team-member/pipeline/shared';
import { StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from './issueFiles';
import { BugFiles, BugHistory, BugStatusPill, bugWhen } from '../bugs/bugUi';

/**
 * Raise an Issue > "Report a bug to the Developers team" (migration 20270122000300): a technical problem goes straight to the developers'
 * Bugs section. The same file picker, limits and checks as issues; the reporter's name, department and designation come from their profile.
 * Below the form: the person's own bug reports with the status, the developer working on it and the resolution note.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

export const BugReportSection: React.FC = () => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DevBug | null>(null);
  const files = useTicketFiles(issueFileTransport, {});
  const [mine, setMine] = useState<DevBugRow[] | null>(null);
  const [listError, setListError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setListError('');
    bugsApi.mine().then(setMine, e => { setListError(errText(e)); setMine(m => m ?? []); });
  }, []);
  useEffect(load, [load]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || files.busy) return;
    const body = { title: title.trim(), description: description.trim(), steps: steps.trim() || null, attachmentIds: files.ids, clientRequestId: requestId };
    const checked = bugSubmitSchema.safeParse(body);
    const e: Record<string, string> = {};
    if (!checked.success) for (const i of checked.error.issues) { const k = String(i.path[0] ?? ''); if (k && !e[k]) e[k] = i.message; }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setProblem('');
    try {
      const bug = await bugsApi.submit(body);
      setTitle(''); setDescription(''); setSteps(''); files.clear(); setErrors({});
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
            <b>Your issue was sent to the Developers team.</b> {done.duplicate ? 'This was already sent, so nothing new was created. ' : ''}
            Your reference number is <span className="font-mono font-bold">{done.reference}</span>. You can follow its status below.
          </div>
        </div>
      )}
      <Card className="p-5">
        <form onSubmit={submit} noValidate className="space-y-4" aria-label="Report a bug to the Developers team" data-testid="bug-form">
          <Field label="Issue title" required htmlFor="bug-title" error={errors.title}>
            <input id="bug-title" className={inputCls} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} aria-invalid={!!errors.title}
              placeholder="e.g. The invoice PDF opens blank" />
          </Field>
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
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} Send to the Developers team
            </button>
            {files.busy ? <span className="text-xs text-slate-500">Waiting for the file to upload…</span> : null}
          </div>
        </form>
      </Card>

      <section aria-label="My bug reports" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">My bug reports</h2>
          <button type="button" className={btn.secondary} onClick={load} aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" aria-hidden /></button>
        </div>
        {listError ? <ErrorBanner message={listError} onRetry={load} /> : null}
        {!mine && !listError ? <Spinner /> : null}
        {mine && mine.length === 0 && !listError ? <Card className="p-8 text-center text-sm text-slate-500">You have not reported any bugs yet.</Card> : null}
        {mine && mine.length > 0 && (
          <Card>
            <ul className="divide-y divide-slate-100" data-testid="my-bugs">
              {mine.map(b => (
                <li key={b.id}>
                  <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen(b.id)}
                    data-testid="my-bug-row" aria-label={`Open ${b.reference}: ${b.title}`}>
                    <span className="font-mono text-[11px] text-slate-500">{b.reference}</span>
                    <span className="flex-1 min-w-[10rem] text-sm font-semibold text-slate-800 truncate">{b.title}</span>
                    <BugStatusPill status={b.status} />
                    <span className="text-[11px] text-slate-500">{b.assigneeName ? `Developer: ${b.assigneeName}` : 'Not assigned yet'}</span>
                    <span className="text-[11px] text-slate-400">{bugWhen(b.createdAt)}</span>
                    {b.resolutionNote ? <span className="basis-full text-xs text-slate-600 truncate"><b>{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}:</b> {b.resolutionNote}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      {open && <MyBugDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const MyBugDialog: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [b, setB] = useState<DevBug | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { bugsApi.myDetail(id).then(setB, e => setError(errText(e))); }, [id]);
  return (
    <Dialog title={b ? `${b.reference}: ${b.title}` : 'Bug report'} onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="my-bug-dialog">
        {error ? <ErrorBanner message={error} /> : null}
        {!b && !error ? <Spinner /> : null}
        {b && (
          <>
            <div className="flex flex-wrap items-center gap-2"><BugStatusPill status={b.status} /><span className="text-xs text-slate-600">{b.assigneeName ? `Developer: ${b.assigneeName}` : 'Not assigned yet'}</span></div>
            {b.resolutionNote && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3"><b>{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}:</b> {b.resolutionNote}</p>}
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{b.description}</p>
            {b.steps && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3"><b>Steps:</b> {b.steps}</p>}
            <BugFiles files={b.attachments} />
            <div><h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">Progress</h3><BugHistory history={b.history} /></div>
          </>
        )}
      </div>
    </Dialog>
  );
};

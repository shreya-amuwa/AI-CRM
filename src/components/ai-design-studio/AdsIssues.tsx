import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import type { AdsIssue, AdsIssueCategory, AdsIssueStatus, AdsPriority } from '../../../shared/contracts';
import { ADS_ISSUE_CATEGORIES, ADS_ISSUE_CATEGORY_LABELS, ADS_ISSUE_STATUSES, ADS_ISSUE_STATUS_LABELS, ADS_PRIORITIES, ADS_PRIORITY_LABELS } from '../../../shared/contracts';
import { adsIssueCreateSchema, adsIssueUpdateSchema } from '../../../shared/validation';
import { SideDrawer } from '../common/SideDrawer';
import { notifyAdsChanged, takePendingAds, useOpenAdsRequest } from './adsEvents';
import {
  aiDesignStudioApi, Card, CardHead, ClientSelect, DetailRow, EmptyState, ErrorLine, errorMessage, fieldCls, Flash, FormField, fmtDate, fmtDateTime, ghostBtn,
  isHead, isLead, isMember, IssueStatusBadge, LinksField, LinksList, LoadingLine, PriorityBadge, primaryBtn, Tabs, textareaCls, Timeline, useAdsData, useAdsSession, cleanLinks
} from './adsUi';
import type { AdsLink } from '../../../shared/contracts';

type View = 'mine' | 'team' | 'all';
type FieldErrors = Record<string, string>;

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const HANDLER_LABEL = { TEAM_LEAD: 'Team Lead', DEPARTMENT_HEAD: 'Department Head' } as const;

/** Maps zod issues to one message per field (the first one wins). */
function fieldErrors(issues: { path: (string | number)[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the form
const IssueForm: React.FC<{ onSaved: (reference: string) => void }> = ({ onSaved }) => {
  const { ctx } = useAdsSession();
  const clients = useAdsData(() => aiDesignStudioApi.clients(), []);
  const assignments = useAdsData(() => aiDesignStudioApi.assignments({ view: 'all' }), []);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AdsIssueCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [priority, setPriority] = useState<AdsPriority>('MEDIUM');
  const [links, setLinks] = useState<AdsLink[]>([]);
  const [requestId, setRequestId] = useState(newRequestId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const goesTo = ctx.role === 'TEAM_MEMBER' && !ctx.unassigned && ctx.leadName ? `Goes to ${ctx.leadName} (your Team Lead).` : 'Goes directly to the Department Head.';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setServerError(null);
    const parsed = adsIssueCreateSchema.safeParse({
      title, category, description, clientId, assignmentId, priority, attachments: cleanLinks(links), clientRequestId: requestId
    });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error.issues)); return; }
    setErrors({});
    setBusy(true);
    try {
      const created = await aiDesignStudioApi.createIssue(parsed.data);
      setTitle(''); setCategory('OTHER'); setDescription(''); setClientId(''); setAssignmentId(''); setPriority('MEDIUM'); setLinks([]);
      setRequestId(newRequestId());
      notifyAdsChanged();
      onSaved(created.reference);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label="Raise an issue">
      <CardHead title="Raise an issue" hint={goesTo} />
      <form onSubmit={submit} noValidate className="px-5 pb-5 space-y-4" aria-label="Raise an issue" data-testid="ads-issue-form">
        <ErrorLine message={serverError} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Issue title" htmlFor="ads-issue-title" required error={errors.title} className="md:col-span-2">
            <input id="ads-issue-title" className={fieldCls} value={title} maxLength={200} disabled={busy} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'ads-issue-title-error' : undefined}
              onChange={e => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Issue category" htmlFor="ads-issue-category" required error={errors.category}>
            <select id="ads-issue-category" className={fieldCls} value={category} disabled={busy} onChange={e => setCategory(e.target.value as AdsIssueCategory)}>
              {ADS_ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{ADS_ISSUE_CATEGORY_LABELS[c]}</option>)}
            </select>
          </FormField>
          <FormField label="Priority" htmlFor="ads-issue-priority" error={errors.priority}>
            <select id="ads-issue-priority" className={fieldCls} value={priority} disabled={busy} onChange={e => setPriority(e.target.value as AdsPriority)}>
              {ADS_PRIORITIES.map(p => <option key={p} value={p}>{ADS_PRIORITY_LABELS[p]}</option>)}
            </select>
          </FormField>
          <FormField label="Description" htmlFor="ads-issue-description" required error={errors.description} className="md:col-span-2">
            <textarea id="ads-issue-description" rows={5} className={textareaCls} value={description} maxLength={4000} disabled={busy} aria-invalid={!!errors.description}
              aria-describedby={errors.description ? 'ads-issue-description-error' : undefined} onChange={e => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Related client (optional)" htmlFor="ads-issue-client" error={errors.clientId} hint={clients.error ? undefined : undefined}>
            <ClientSelect id="ads-issue-client" value={clientId} onChange={setClientId} clients={clients.data ?? []} allowEmpty disabled={busy || !!assignmentId} />
          </FormField>
          <FormField label="Related assignment (optional)" htmlFor="ads-issue-assignment" error={errors.assignmentId} hint={assignmentId ? 'The assignment also names the client.' : undefined}>
            <select id="ads-issue-assignment" className={fieldCls} value={assignmentId} disabled={busy} onChange={e => { setAssignmentId(e.target.value); if (e.target.value) setClientId(''); }}>
              <option value="">No assignment</option>
              {(assignments.data ?? []).map(a => <option key={a.id} value={a.id}>{a.title}{a.clientName ? ` · ${a.clientName}` : ''}</option>)}
            </select>
          </FormField>
          <div className="md:col-span-2">
            <div className="block text-[13px] font-semibold text-slate-700 mb-1">Supporting attachments (links)</div>
            <LinksField value={links} onChange={setLinks} idPrefix="ads-issue-link" disabled={busy} />
            {errors.attachments && <p className="text-xs text-rose-700 mt-1" role="alert">{errors.attachments}</p>}
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className={primaryBtn} disabled={busy}><Send className="w-4 h-4" aria-hidden="true" /> {busy ? 'Sending…' : 'Raise issue'}</button>
        </div>
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------------- the drawer
const IssueDrawer: React.FC<{ id: string; onClose: () => void; onChanged: (text: string) => void }> = ({ id, onClose, onChanged }) => {
  const { ctx } = useAdsSession();
  const { data: issue, loading, error, reload } = useAdsData(() => aiDesignStudioApi.issue(id), [id]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<AdsIssueStatus | ''>('');
  const [escalateNote, setEscalateNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStatus(''); setNote(''); setEscalateNote(''); setErrors({}); setServerError(null); }, [id]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setServerError(null);
    setBusy(true);
    try {
      await action();
      setNote(''); setStatus(''); setEscalateNote('');
      notifyAdsChanged();
      reload();
      onChanged(done);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const update = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issue) return;
    const parsed = adsIssueUpdateSchema.safeParse({ status: status && status !== issue.status ? status : undefined, note });
    if (!parsed.success) { setErrors({ form: parsed.error.issues[0]?.message ?? 'Write a response or choose a status.' }); return; }
    setErrors({});
    void run(() => aiDesignStudioApi.updateIssue(id, parsed.data), 'Issue updated.');
  };

  const raiser = !!issue && issue.raisedBy === ctx.userId;
  const closed = issue?.status === 'CLOSED';
  const canRespond = !!issue && !closed && (issue.canWork || raiser);

  return (
    <SideDrawer title={issue ? `${issue.reference} · ${issue.title}` : 'Issue'} subtitle={issue ? `Raised by ${issue.raisedByName || 'an employee'}` : undefined} onClose={onClose}>
      {loading && !issue ? <LoadingLine /> : null}
      <ErrorLine message={error} onRetry={reload} />
      {issue && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 items-center">
            <IssueStatusBadge status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            <span className="text-xs text-slate-500">With the {HANDLER_LABEL[issue.handlerLevel]}</span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Category">{ADS_ISSUE_CATEGORY_LABELS[issue.category]}</DetailRow>
            <DetailRow label="Raised">{fmtDateTime(issue.createdAt)}</DetailRow>
            <DetailRow label="Client">{issue.clientName}</DetailRow>
            <DetailRow label="Assignment">{issue.assignmentTitle}</DetailRow>
            <DetailRow label="Team Lead">{issue.leadName}</DetailRow>
            <DetailRow label="Escalated">{issue.escalatedAt ? fmtDateTime(issue.escalatedAt) : null}</DetailRow>
            <div className="sm:col-span-2"><DetailRow label="Description">{issue.description}</DetailRow></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Attachments</dt><dd><LinksList links={issue.attachments} /></dd></div>
          </dl>

          <ErrorLine message={serverError} />

          {canRespond ? (
            <form onSubmit={update} noValidate className="space-y-3 border-t border-slate-200 pt-4" aria-label="Respond to the issue">
              <FormField label={issue.canWork ? 'Response' : 'Add a reply'} htmlFor="ads-issue-note" error={errors.form}>
                <textarea id="ads-issue-note" rows={3} className={textareaCls} value={note} maxLength={2000} disabled={busy} onChange={e => setNote(e.target.value)} />
              </FormField>
              {issue.canWork && (
                <FormField label="Status" htmlFor="ads-issue-status">
                  <select id="ads-issue-status" className={fieldCls} value={status || issue.status} disabled={busy} onChange={e => setStatus(e.target.value as AdsIssueStatus)}>
                    {ADS_ISSUE_STATUSES.map(s => <option key={s} value={s}>{ADS_ISSUE_STATUS_LABELS[s]}</option>)}
                  </select>
                </FormField>
              )}
              <div className="flex flex-wrap gap-2 justify-end">
                {raiser && !issue.canWork && issue.status === 'RESOLVED' && (
                  <button type="button" className={ghostBtn} disabled={busy} onClick={() => void run(() => aiDesignStudioApi.updateIssue(id, { status: 'CLOSED', note: note.trim() || null }), 'Issue closed.')}>Close issue</button>
                )}
                <button type="submit" className={primaryBtn} disabled={busy}>{busy ? 'Saving…' : issue.canWork ? 'Save' : 'Send reply'}</button>
              </div>
            </form>
          ) : (
            <p className="text-[13px] text-slate-500 border-t border-slate-200 pt-4">
              {closed ? 'This issue is closed.' : 'You can read this issue. It is handled by the ' + HANDLER_LABEL[issue.handlerLevel] + '.'}
            </p>
          )}

          {issue.canEscalate && (
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <FormField label="Escalate to the Department Head (note)" htmlFor="ads-issue-escalate" hint="Use this when the issue needs a decision above the team.">
                <textarea id="ads-issue-escalate" rows={2} className={textareaCls} value={escalateNote} maxLength={2000} disabled={busy} onChange={e => setEscalateNote(e.target.value)} />
              </FormField>
              <div className="flex justify-end">
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => void run(() => aiDesignStudioApi.escalateIssue(id, escalateNote.trim() || undefined), 'Issue escalated to the Department Head.')}>
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Escalate to Department Head
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-bold text-slate-900 mb-3">History</h3>
            {issue.events.length ? <Timeline events={issue.events} /> : <EmptyState title="No history yet" />}
          </div>
        </div>
      )}
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------------------------------- the page
export const AdsIssues: React.FC = () => {
  const { ctx } = useAdsSession();
  const defaultView: View = isHead(ctx) ? 'all' : 'mine';
  const [view, setView] = useState<View>(defaultView);
  const [statusFilter, setStatusFilter] = useState<AdsIssueStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(() => takePendingAds('ads_issue'));
  const [flash, setFlash] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.issues({ view, status: statusFilter || undefined }), [view, statusFilter]);

  useOpenAdsRequest(useCallback(d => { if (d.entityType === 'ads_issue' && d.id) { takePendingAds('ads_issue'); setOpenId(d.id); } }, []));

  const tabs: { id: View; label: string }[] = isHead(ctx)
    ? [{ id: 'all', label: 'All issues' }]
    : isLead(ctx)
      ? [{ id: 'mine', label: 'My issues' }, { id: 'team', label: 'Team issues' }]
      : [{ id: 'mine', label: 'My issues' }];

  const rows: AdsIssue[] = data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 font-heading">Raise an Issue</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isHead(ctx) ? 'Every issue of AI Design Studio: respond, change the status and resolve.' : 'Tell us what is blocking your work. It reaches the right person and you can follow it here.'}
        </p>
      </div>

      <Flash text={flash} onClose={() => setFlash(null)} />
      {(isMember(ctx) || isLead(ctx)) && <IssueForm onSaved={ref => { setFlash(`Issue ${ref} raised.`); setView('mine'); reload(); }} />}

      <Card label="Issues">
        <CardHead
          title="Issues"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="ads-issue-filter" className="sr-only">Filter by status</label>
              <select id="ads-issue-filter" className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700" value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as AdsIssueStatus | '')}>
                <option value="">All statuses</option>
                {ADS_ISSUE_STATUSES.map(s => <option key={s} value={s}>{ADS_ISSUE_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
          }
        />
        <div className="px-5 pb-5 space-y-4">
          {tabs.length > 1 && <Tabs label="Issue lists" value={view} options={tabs} onChange={setView} />}
          <ErrorLine message={error} onRetry={reload} />
          {loading && !data ? <LoadingLine label="Loading issues…" /> : null}
          {data && rows.length === 0 ? (
            <EmptyState title={statusFilter ? 'No issues with this status' : 'No issues yet'} hint={isHead(ctx) ? 'Issues raised by your Team Leads and Team Members appear here.' : view === 'team' ? 'Issues raised by your Team Members appear here.' : 'Issues you raise appear here.'} />
          ) : null}
          {rows.length > 0 && (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th scope="col" className="py-2 pr-3">Reference</th>
                    <th scope="col" className="py-2 pr-3">Title</th>
                    <th scope="col" className="py-2 pr-3">Category</th>
                    <th scope="col" className="py-2 pr-3">Raised by</th>
                    <th scope="col" className="py-2 pr-3">Priority</th>
                    <th scope="col" className="py-2 pr-3">Status</th>
                    <th scope="col" className="py-2 pr-3">Handled by</th>
                    <th scope="col" className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(i => (
                    <tr key={i.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 whitespace-nowrap font-mono text-xs">
                        <button type="button" className="text-blue-700 underline" onClick={() => setOpenId(i.id)} aria-label={`Open issue ${i.reference}`}>{i.reference}</button>
                      </td>
                      <td className="py-2.5 pr-3 max-w-[16rem] truncate" title={i.title}>{i.title}</td>
                      <td className="py-2.5 pr-3">{ADS_ISSUE_CATEGORY_LABELS[i.category]}</td>
                      <td className="py-2.5 pr-3">{i.raisedByName || '–'}</td>
                      <td className="py-2.5 pr-3"><PriorityBadge priority={i.priority} /></td>
                      <td className="py-2.5 pr-3"><IssueStatusBadge status={i.status} /></td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{HANDLER_LABEL[i.handlerLevel]}</td>
                      <td className="py-2.5 whitespace-nowrap">{fmtDate(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {openId && <IssueDrawer id={openId} onClose={() => setOpenId(null)} onChanged={text => { setFlash(text); reload(); }} />}
    </div>
  );
};

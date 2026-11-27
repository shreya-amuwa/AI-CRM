import React, { useCallback, useState } from 'react';
import type { ZodError } from 'zod';
import { Trash2 } from 'lucide-react';
import type { AdsAssignment, AdsAssignmentDetail, AdsAssignmentStatus, AdsLink, AdsPerson, AdsPriority } from '../../../shared/contracts';
import { ADS_ASSIGNMENT_STATUSES, ADS_ASSIGNMENT_STATUS_LABELS, ADS_PRIORITIES, ADS_PRIORITY_LABELS } from '../../../shared/contracts';
import { adsAssignmentCreateSchema, adsAssignmentStatusSchema, adsAssignmentUpdateSchema } from '../../../shared/validation';
import { SideDrawer } from '../common/SideDrawer';
import { confirmTaskDeletion, countLine } from '../../lib/taskDeletion';
import { toast } from '../../lib/feedback/feedbackStore';
import { notifyAdsChanged, takePendingAds, useOpenAdsRequest } from './adsEvents';
import {
  aiDesignStudioApi, AssignmentStatusBadge, Card, CardHead, ClientSelect, cleanLinks, DetailRow, EmptyState, ErrorLine, errorMessage, FormField, Flash, fieldCls, fmtDate,
  ghostBtn, isHead, isLead, isMember, LinksField, LinksList, LoadingLine, PriorityBadge, primaryBtn, Tabs, textareaCls, Timeline, todayIso, useAdsData, useAdsSession
} from './adsUi';

/** First message of each field of a failed zod check (the same schema the server uses). */
function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

const PriorityOptions: React.FC = () => (
  <>
    {ADS_PRIORITIES.map(p => <option key={p} value={p}>{ADS_PRIORITY_LABELS[p]}</option>)}
  </>
);

// ---------------------------------------------------------------------------------------------------- list
/** Delete straight from the list (20270225000100), shown when the list said canDelete; the same confirmation and API as the drawer, checked again there. */
const deleteFromList = async (r: AdsAssignment) => {
  const ok = await confirmTaskDeletion({
    noun: 'assignment', title: r.title, assigneeName: r.assigneeName, status: ADS_ASSIGNMENT_STATUS_LABELS[r.status] ?? r.status, dueDate: r.dueDate ? fmtDate(r.dueDate) : null,
    alsoRemoved: [countLine(r.memberCount, "Team Member's part", "Team Members' parts")],
    run: () => aiDesignStudioApi.deleteAssignment(r.id)
  });
  if (!ok) return;
  toast.success(`Assignment deleted: ${r.title}`);
  notifyAdsChanged();
};

const AssignmentTable: React.FC<{ rows: AdsAssignment[]; onOpen: (id: string) => void }> = ({ rows, onOpen }) => {
  const anyDeletable = rows.some(r => r.canDelete);
  return (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th scope="col" className="px-5 py-2.5 font-semibold">Client</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Assignment</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Assigned to</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Assigned by</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Deadline</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Priority</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
          <th scope="col" className="px-5 py-2.5 font-semibold">Progress</th>
          {anyDeletable && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/70">
            <td className="px-5 py-3 text-slate-700">{r.clientName || '–'}</td>
            <td className="px-3 py-3 font-semibold text-slate-900">
              <button type="button" className="text-left underline decoration-slate-300 hover:decoration-blue-600" onClick={() => onOpen(r.id)}>{r.title}</button>
              {r.memberCount > 0 && <div className="text-xs font-normal text-slate-500">{r.memberCompleted}/{r.memberCount} team parts completed</div>}
            </td>
            <td className="px-3 py-3 text-slate-700">{r.assigneeName || '–'}</td>
            <td className="px-3 py-3 text-slate-700">{r.assignedByName || '–'}</td>
            <td className={`px-3 py-3 whitespace-nowrap ${r.overdue ? 'text-rose-700 font-bold' : 'text-slate-700'}`}>{fmtDate(r.dueDate)}{r.overdue && <span className="block text-xs">Overdue</span>}</td>
            <td className="px-3 py-3"><PriorityBadge priority={r.priority} /></td>
            <td className="px-3 py-3"><AssignmentStatusBadge status={r.status} /></td>
            <td className="px-5 py-3 text-slate-700">{r.progress}%</td>
            {anyDeletable && (
              <td className="px-3 py-3">
                {r.canDelete && (
                  <button type="button" data-testid="ads-row-delete" aria-label={`Delete assignment: ${r.title}`} title="Delete assignment" onClick={() => void deleteFromList(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  );
};

/** A Team Member's own work as cards (what they need to know about each piece of work). */
const MemberCards: React.FC<{ rows: AdsAssignment[]; onOpen: (id: string) => void }> = ({ rows, onOpen }) => (
  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 sm:p-5">
    {rows.map(r => (
      <li key={r.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{r.clientName || 'Client'}</div>
            <button type="button" className="text-left text-base font-extrabold text-slate-900 underline decoration-slate-300 hover:decoration-blue-600" onClick={() => onOpen(r.id)}>{r.title}</button>
          </div>
          <AssignmentStatusBadge status={r.status} />
        </div>
        {r.description && <p className="text-sm text-slate-700 whitespace-pre-wrap line-clamp-3">{r.description}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <DetailRow label="Assigned by">{r.assignedByName}</DetailRow>
          <DetailRow label="Assigned on">{fmtDate(r.createdAt)}</DetailRow>
          <DetailRow label="Deadline"><span className={r.overdue ? 'text-rose-700 font-bold' : ''}>{fmtDate(r.dueDate)}{r.overdue ? ' · overdue' : ''}</span></DetailRow>
          <DetailRow label="Priority"><PriorityBadge priority={r.priority} /></DetailRow>
          <DetailRow label="Remarks">{r.instructions}</DetailRow>
          <DetailRow label="Attachments"><LinksList links={r.attachments} /></DetailRow>
        </dl>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
            <div className="h-full bg-blue-600" style={{ width: `${r.progress}%` }} />
          </div>
          <span className="text-xs font-semibold text-slate-600">{r.progress}%</span>
          <button type="button" className={`${ghostBtn} !h-9 !text-[13px]`} onClick={() => onOpen(r.id)}>Open</button>
        </div>
      </li>
    ))}
  </ul>
);

/** The assignments of one view, with its own loading / empty / error states. */
const AssignmentList: React.FC<{ view: 'mine' | 'team' | 'all'; status?: AdsAssignmentStatus; clientId?: string; cards?: boolean; emptyTitle: string; emptyHint?: string; onOpen: (id: string) => void }> = ({
  view, status, clientId, cards, emptyTitle, emptyHint, onOpen
}) => {
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.assignments({ view, status, clientId }), [view, status, clientId]);
  if (loading && !data) return <LoadingLine label="Loading assignments…" />;
  if (error) return <div className="p-5"><ErrorLine message={error} onRetry={reload} /></div>;
  if (!data || data.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return cards ? <MemberCards rows={data} onOpen={onOpen} /> : <AssignmentTable rows={data} onOpen={onOpen} />;
};

// ---------------------------------------------------------------------------------------------------- Department Head: new assignment
const NewAssignmentForm: React.FC = () => {
  const { people } = useAdsSession();
  const clients = useAdsData(() => aiDesignStudioApi.clients({ status: 'ACTIVE' }), []);
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<AdsPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [links, setLinks] = useState<AdsLink[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // a Team Lead, or a Team Member who works under no Team Lead; members of a lead are assigned through that lead
  const receivers = people.filter((p: AdsPerson) => p.role === 'TEAM_HEAD' || !p.hasLead);
  const leadMembers = people.filter(p => p.role === 'TEAM_MEMBER' && p.hasLead).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFlash(null);
    const parsed = adsAssignmentCreateSchema.safeParse({
      clientId, assigneeId, title, description, instructions, priority, dueDate, attachments: cleanLinks(links)
    });
    const errs = parsed.success ? {} : fieldErrors(parsed.error);
    if (!clientId) errs.clientId = 'Choose a client.';
    if (!title.trim()) errs.title = 'Enter the assignment title.';
    if (!assigneeId) errs.assigneeId = 'Choose who receives the work.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    setBusy(true);
    try {
      const a = await aiDesignStudioApi.createAssignment(parsed.data);
      setFlash(`Assigned “${a.title}” to ${a.assigneeName || 'the selected person'}.`);
      setClientId(''); setTitle(''); setDescription(''); setInstructions(''); setPriority('MEDIUM'); setDueDate(''); setAssigneeId(''); setLinks([]);
      notifyAdsChanged();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label="New assignment">
      <CardHead title="New assignment" hint="Choose a client, describe the work and give it to a Team Lead." />
      <form onSubmit={submit} noValidate className="px-5 pb-5 space-y-4" aria-label="New assignment">
        <Flash text={flash} onClose={() => setFlash(null)} />
        <ErrorLine message={serverError} />
        {clients.error && <ErrorLine message={clients.error} onRetry={clients.reload} />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Client" htmlFor="asg-client" required error={errors.clientId}>
            <ClientSelect id="asg-client" value={clientId} onChange={setClientId} clients={clients.data ?? []} invalid={!!errors.clientId} disabled={busy} />
          </FormField>
          <FormField label="Assignment title" htmlFor="asg-title" required error={errors.title}>
            <input id="asg-title" className={fieldCls} value={title} maxLength={200} disabled={busy} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'asg-title-error' : undefined} onChange={e => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Assign to" htmlFor="asg-assignee" required error={errors.assigneeId}
            hint={leadMembers > 0 ? 'Team Members who work under a Team Lead are not listed: give the work to their Team Lead, who passes it on.' : 'Team Members with no Team Lead yet can receive work directly.'}>
            <select id="asg-assignee" className={fieldCls} value={assigneeId} disabled={busy} aria-invalid={!!errors.assigneeId} aria-describedby={errors.assigneeId ? 'asg-assignee-error' : undefined} onChange={e => setAssigneeId(e.target.value)}>
              <option value="">Choose a person</option>
              {receivers.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member · no Team Lead yet'}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Priority" htmlFor="asg-priority">
              <select id="asg-priority" className={fieldCls} value={priority} disabled={busy} onChange={e => setPriority(e.target.value as AdsPriority)}><PriorityOptions /></select>
            </FormField>
            <FormField label="Deadline" htmlFor="asg-due" error={errors.dueDate}>
              <input id="asg-due" type="date" className={fieldCls} min={todayIso()} value={dueDate} disabled={busy} onChange={e => setDueDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Details and requirements" htmlFor="asg-desc" error={errors.description} className="md:col-span-2">
            <textarea id="asg-desc" rows={3} className={textareaCls} value={description} maxLength={4000} disabled={busy} onChange={e => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Instructions and remarks" htmlFor="asg-instr" error={errors.instructions} className="md:col-span-2">
            <textarea id="asg-instr" rows={2} className={textareaCls} value={instructions} maxLength={2000} disabled={busy} onChange={e => setInstructions(e.target.value)} />
          </FormField>
          <div className="md:col-span-2">
            <div className="text-[13px] font-semibold text-slate-700 mb-1">Attachments and reference links</div>
            <LinksField idPrefix="asg-link" value={links} onChange={setLinks} disabled={busy} />
            {errors.attachments && <p className="text-xs text-rose-700 mt-1" role="alert">{errors.attachments}</p>}
          </div>
        </div>
        <button type="submit" className={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Save and assign'}</button>
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------------- detail drawer
const DelegateForm: React.FC<{ detail: AdsAssignmentDetail; onDone: (text: string) => void }> = ({ detail, onDone }) => {
  const { people } = useAdsSession();
  const taken = new Set(detail.members.map(m => m.assigneeId));
  const [assigneeId, setAssigneeId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<AdsPriority>(detail.priority);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const free = people.filter(p => p.role === 'TEAM_MEMBER' && !taken.has(p.id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const parsed = adsAssignmentCreateSchema.safeParse({ assigneeId, parentId: detail.id, instructions, dueDate, priority });
    const errs = parsed.success ? {} : fieldErrors(parsed.error);
    if (!assigneeId) errs.assigneeId = 'Choose a Team Member.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    setBusy(true);
    try {
      const a = await aiDesignStudioApi.createAssignment(parsed.data);
      setAssigneeId(''); setInstructions(''); setDueDate('');
      notifyAdsChanged();
      onDone(`Assigned to ${a.assigneeName || 'the Team Member'}.`);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Assign to a Team Member">
      <h3 className="text-sm font-extrabold text-slate-900">Assign to a Team Member</h3>
      <ErrorLine message={serverError} />
      {free.length === 0 ? (
        <p className="text-[13px] text-slate-500">{people.some(p => p.role === 'TEAM_MEMBER') ? 'Every Team Member of yours already has this work.' : 'No Team Members are assigned to you yet.'}</p>
      ) : (
        <>
          <FormField label="Team Member" htmlFor="dlg-member" required error={errors.assigneeId}>
            <select id="dlg-member" className={fieldCls} value={assigneeId} disabled={busy} aria-invalid={!!errors.assigneeId} aria-describedby={errors.assigneeId ? 'dlg-member-error' : undefined} onChange={e => setAssigneeId(e.target.value)}>
              <option value="">Choose a Team Member</option>
              {free.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority" htmlFor="dlg-priority">
              <select id="dlg-priority" className={fieldCls} value={priority} disabled={busy} onChange={e => setPriority(e.target.value as AdsPriority)}><PriorityOptions /></select>
            </FormField>
            <FormField label="Deadline (optional)" htmlFor="dlg-due" error={errors.dueDate}>
              <input id="dlg-due" type="date" className={fieldCls} min={todayIso()} value={dueDate} disabled={busy} onChange={e => setDueDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Instructions" htmlFor="dlg-instr" error={errors.instructions}>
            <textarea id="dlg-instr" rows={2} className={textareaCls} value={instructions} maxLength={2000} disabled={busy} onChange={e => setInstructions(e.target.value)} />
          </FormField>
          <button type="submit" className={primaryBtn} disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
        </>
      )}
    </form>
  );
};

/** The receiver reports their own progress. */
const StatusForm: React.FC<{ detail: AdsAssignmentDetail; onDone: (text: string) => void }> = ({ detail, onDone }) => {
  const options: AdsAssignmentStatus[] = ['ACCEPTED', 'IN_PROGRESS', 'PENDING_REVIEW'];
  const [status, setStatus] = useState<AdsAssignmentStatus>(options.includes(detail.status) ? detail.status : 'IN_PROGRESS');
  const [progress, setProgress] = useState(detail.progress);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const parsed = adsAssignmentStatusSchema.safeParse({ status, progress, note });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({});
    setBusy(true);
    try {
      await aiDesignStudioApi.assignmentStatus(detail.id, parsed.data);
      setNote('');
      notifyAdsChanged();
      onDone('Status updated.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Update my progress">
      <h3 className="text-sm font-extrabold text-slate-900">Update my progress</h3>
      <ErrorLine message={serverError} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Status" htmlFor="st-status" error={errors.status}>
          <select id="st-status" className={fieldCls} value={status} disabled={busy} onChange={e => setStatus(e.target.value as AdsAssignmentStatus)}>
            {options.map(s => <option key={s} value={s}>{ADS_ASSIGNMENT_STATUS_LABELS[s]}</option>)}
          </select>
        </FormField>
        <FormField label={`Progress: ${progress}%`} htmlFor="st-progress" error={errors.progress}>
          <input id="st-progress" type="range" min={0} max={100} step={5} className="w-full h-11" value={progress} disabled={busy} onChange={e => setProgress(Number(e.target.value))} />
        </FormField>
      </div>
      <FormField label="Note (optional)" htmlFor="st-note" error={errors.note}>
        <textarea id="st-note" rows={2} className={textareaCls} value={note} maxLength={2000} disabled={busy} onChange={e => setNote(e.target.value)} />
      </FormField>
      <button type="submit" className={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Update status'}</button>
    </form>
  );
};

/** The assigner (and the Department Head) completes the work or sends it back for a revision. */
const ReviewForm: React.FC<{ detail: AdsAssignmentDetail; onDone: (text: string) => void }> = ({ detail, onDone }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (status: 'COMPLETED' | 'REVISION_REQUIRED') => {
    setServerError(null);
    if (status === 'REVISION_REQUIRED' && !note.trim()) { setError('Say what must be revised.'); return; }
    const parsed = adsAssignmentStatusSchema.safeParse({ status, note });
    if (!parsed.success) { setError(fieldErrors(parsed.error).note || 'Check the note.'); return; }
    setError(null);
    setBusy(true);
    try {
      await aiDesignStudioApi.assignmentStatus(detail.id, parsed.data);
      setNote('');
      notifyAdsChanged();
      onDone(status === 'COMPLETED' ? 'Marked as completed.' : 'Sent back for a revision.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" role="group" aria-label="Review this work">
      <h3 className="text-sm font-extrabold text-slate-900">Review this work</h3>
      <ErrorLine message={serverError} />
      <FormField label="Note (required for a revision)" htmlFor="rv-note" error={error}>
        <textarea id="rv-note" rows={2} className={textareaCls} value={note} maxLength={2000} disabled={busy} aria-invalid={!!error} onChange={e => { setNote(e.target.value); setError(null); }} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void decide('COMPLETED')}>Mark completed</button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={() => void decide('REVISION_REQUIRED')}>Request a revision</button>
      </div>
    </div>
  );
};

/** Deadline, priority and instructions: the assigner and the Department Head. */
const EditForm: React.FC<{ detail: AdsAssignmentDetail; onDone: (text: string) => void }> = ({ detail, onDone }) => {
  const [dueDate, setDueDate] = useState(detail.dueDate ?? '');
  const [priority, setPriority] = useState<AdsPriority>(detail.priority);
  const [instructions, setInstructions] = useState(detail.instructions ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const parsed = adsAssignmentUpdateSchema.safeParse({ dueDate, priority, instructions });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({});
    setBusy(true);
    try {
      await aiDesignStudioApi.updateAssignment(detail.id, parsed.data);
      notifyAdsChanged();
      onDone('Assignment updated.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Change deadline, priority or instructions">
      <h3 className="text-sm font-extrabold text-slate-900">Deadline, priority and instructions</h3>
      <ErrorLine message={serverError} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Deadline" htmlFor="ed-due" error={errors.dueDate}>
          <input id="ed-due" type="date" className={fieldCls} value={dueDate} disabled={busy} onChange={e => setDueDate(e.target.value)} />
        </FormField>
        <FormField label="Priority" htmlFor="ed-priority">
          <select id="ed-priority" className={fieldCls} value={priority} disabled={busy} onChange={e => setPriority(e.target.value as AdsPriority)}><PriorityOptions /></select>
        </FormField>
      </div>
      <FormField label="Instructions and remarks" htmlFor="ed-instr" error={errors.instructions}>
        <textarea id="ed-instr" rows={2} className={textareaCls} value={instructions} maxLength={2000} disabled={busy} onChange={e => setInstructions(e.target.value)} />
      </FormField>
      <button type="submit" className={ghostBtn} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>
  );
};

const ReassignForm: React.FC<{ detail: AdsAssignmentDetail; onDone: (text: string) => void }> = ({ detail, onDone }) => {
  const { ctx, people } = useAdsSession();
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a Team Lead's part goes to the same Team Lead's other members; the Head's own assignment goes to a Team Lead or a member with no lead (the server decides)
  const options = people.filter(p => {
    if (p.id === detail.assigneeId) return false;
    if (detail.parentId) return p.role === 'TEAM_MEMBER' && (isLead(ctx) ? true : p.leadId === detail.assignedBy);
    return isHead(ctx) ? p.role === 'TEAM_HEAD' || !p.hasLead : p.role === 'TEAM_MEMBER';
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!assigneeId) { setError('Choose a person.'); return; }
    setError(null);
    setBusy(true);
    try {
      await aiDesignStudioApi.reassign(detail.id, assigneeId);
      notifyAdsChanged();
      onDone('Assignment reassigned.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Reassign">
      <h3 className="text-sm font-extrabold text-slate-900">Reassign</h3>
      <ErrorLine message={serverError} />
      <FormField label="Give this work to" htmlFor="re-person" error={error}>
        <select id="re-person" className={fieldCls} value={assigneeId} disabled={busy} aria-invalid={!!error} onChange={e => { setAssigneeId(e.target.value); setError(null); }}>
          <option value="">Choose a person</option>
          {options.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member'}</option>)}
        </select>
      </FormField>
      <button type="submit" className={ghostBtn} disabled={busy || options.length === 0}>{busy ? 'Reassigning…' : 'Reassign'}</button>
    </form>
  );
};

const AssignmentDrawer: React.FC<{ id: string; onOpenOther: (id: string) => void; onClose: () => void }> = ({ id, onOpenOther, onClose }) => {
  const { ctx } = useAdsSession();
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.assignment(id), [id]);
  const [flash, setFlash] = useState<string | null>(null);
  const done = (text: string) => { setFlash(text); reload(); };

  const open = data && data.status !== 'COMPLETED';
  const canEdit = !!data && (isHead(ctx) || data.assignedBy === ctx.userId);
  const canDelegate = !!data && isLead(ctx) && data.assigneeId === ctx.userId && !data.parentId;
  // Delete: only when the database says so (the Team Lead who gave it, the Department Head); the delete is checked there again
  const remove = async () => {
    if (!data?.canDelete) return;
    const ok = await confirmTaskDeletion({
      noun: 'assignment', title: data.title, assigneeName: data.assigneeName, status: ADS_ASSIGNMENT_STATUS_LABELS[data.status] ?? data.status, dueDate: data.dueDate ? fmtDate(data.dueDate) : null,
      alsoRemoved: [countLine(data.memberCount, "Team Member's part", "Team Members' parts")],
      run: () => aiDesignStudioApi.deleteAssignment(data.id)
    });
    if (!ok) return;
    toast.success(`Assignment deleted: ${data.title}`);
    notifyAdsChanged();
    onClose();
  };
  // Escape inside the delete confirmation closes only the confirmation
  const close = () => { if (!document.querySelector('[data-testid="app-dialog-layer"]')) onClose(); };

  return (
    <SideDrawer title={data?.title ?? 'Assignment'} subtitle={data ? `${data.clientName ?? 'Client'} · ${ctx.role === 'TEAM_MEMBER' ? 'Assigned by ' + (data.assignedByName ?? '') : 'Assigned to ' + (data.assigneeName ?? '')}` : undefined} onClose={close}>
      <div className="p-5 space-y-6">
        {loading && !data && <LoadingLine label="Loading assignment…" />}
        <ErrorLine message={error} onRetry={reload} />
        <Flash text={flash} onClose={() => setFlash(null)} />
        {data && (
          <>
            <div className="flex flex-wrap gap-2"><AssignmentStatusBadge status={data.status} /><PriorityBadge priority={data.priority} /></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DetailRow label="Client">{data.clientName}</DetailRow>
              <DetailRow label="Assigned to">{data.assigneeName}</DetailRow>
              <DetailRow label="Assigned by">{data.assignedByName}</DetailRow>
              <DetailRow label="Assigned on">{fmtDate(data.createdAt)}</DetailRow>
              <DetailRow label="Deadline"><span className={data.overdue ? 'text-rose-700 font-bold' : ''}>{fmtDate(data.dueDate)}{data.overdue ? ' · overdue' : ''}</span></DetailRow>
              <DetailRow label="Progress">{`${data.progress}%`}</DetailRow>
              <div className="col-span-2"><DetailRow label="Description">{data.description}</DetailRow></div>
              <div className="col-span-2"><DetailRow label="Instructions and remarks">{data.instructions}</DetailRow></div>
              <div className="col-span-2"><DetailRow label="Attachments"><LinksList links={data.attachments} /></DetailRow></div>
            </dl>

            {data.members.length > 0 && (
              <section aria-label="Team Members' parts" className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900">Passed on to Team Members</h3>
                <ul className="space-y-2">
                  {data.members.map(m => (
                    <li key={m.id} className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{m.assigneeName}</div>
                        <div className="text-xs text-slate-500">Deadline {fmtDate(m.dueDate)} · {m.progress}%</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AssignmentStatusBadge status={m.status} />
                        <button type="button" className={`${ghostBtn} !h-9 !text-[13px]`} onClick={() => onOpenOther(m.id)}>Open</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {open && data.canUpdateStatus && <StatusForm key={`${data.id}-${data.updatedAt}`} detail={data} onDone={done} />}
            {open && data.canReview && <ReviewForm detail={data} onDone={done} />}
            {open && canDelegate && <DelegateForm detail={data} onDone={done} />}
            {open && canEdit && <EditForm key={`e-${data.id}-${data.updatedAt}`} detail={data} onDone={done} />}
            {open && canEdit && data.memberCount === 0 && <ReassignForm detail={data} onDone={done} />}
            {data.canDelete && (
              <div className="flex justify-end">
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  onClick={() => void remove()} data-testid="ads-assignment-delete">Delete assignment</button>
              </div>
            )}
            {data.status === 'COMPLETED' && <p className="text-[13px] text-emerald-700 font-semibold">This assignment is completed{data.completedAt ? ` on ${fmtDate(data.completedAt)}` : ''}.</p>}

            <section aria-label="History" className="space-y-2">
              <h3 className="text-sm font-extrabold text-slate-900">History</h3>
              {data.events.length ? <Timeline events={data.events} /> : <p className="text-[13px] text-slate-500">No history yet.</p>}
            </section>
          </>
        )}
      </div>
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------------------------------- the page
const HeadAssign: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [status, setStatus] = useState<'ALL' | AdsAssignmentStatus>('ALL');
  const [clientId, setClientId] = useState('');
  const clients = useAdsData(() => aiDesignStudioApi.clients(), []);
  return (
    <div className="space-y-6">
      <NewAssignmentForm />
      <Card label="All assignments">
        <CardHead title="All assignments" hint="Everything given out in AI Design Studio and how it is going."
          right={
            <div className="w-full sm:w-64">
              <label htmlFor="asg-filter-client" className="sr-only">Filter by client</label>
              <ClientSelect id="asg-filter-client" value={clientId} onChange={setClientId} clients={clients.data ?? []} allowEmpty emptyLabel="All clients" />
            </div>
          } />
        <div className="px-5 pb-3">
          <Tabs label="Status" value={status} onChange={setStatus}
            options={[{ id: 'ALL', label: 'All' }, ...ADS_ASSIGNMENT_STATUSES.map(s => ({ id: s, label: ADS_ASSIGNMENT_STATUS_LABELS[s] }))]} />
        </div>
        <AssignmentList view="all" status={status === 'ALL' ? undefined : status} clientId={clientId || undefined} emptyTitle="No assignments yet" emptyHint="Use the form above to give work to a Team Lead." onOpen={onOpen} />
      </Card>
    </div>
  );
};

const LeadAssign: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [status, setStatus] = useState<'ALL' | AdsAssignmentStatus>('ALL');
  return (
    <Card label="Assignments">
      <CardHead title="Assignments" hint={tab === 'mine' ? 'Work the Department Head gave you. Open one to pass it on to your Team Members.' : 'The parts you gave to your Team Members.'} />
      <div className="px-5 pb-3 space-y-3">
        <Tabs label="Assignments view" value={tab} onChange={setTab} options={[{ id: 'mine', label: 'Received from the Department Head' }, { id: 'team', label: 'Passed on to my team' }]} />
        <Tabs label="Status" value={status} onChange={setStatus}
          options={[{ id: 'ALL', label: 'All' }, ...ADS_ASSIGNMENT_STATUSES.map(s => ({ id: s, label: ADS_ASSIGNMENT_STATUS_LABELS[s] }))]} />
      </div>
      <AssignmentList view={tab} status={status === 'ALL' ? undefined : status}
        emptyTitle={tab === 'mine' ? 'No work received yet' : 'Nothing passed on yet'}
        emptyHint={tab === 'mine' ? 'Work the Department Head assigns to you appears here.' : 'Open work you received and assign it to a Team Member.'} onOpen={onOpen} />
    </Card>
  );
};

const MemberAssign: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [status, setStatus] = useState<'ALL' | AdsAssignmentStatus>('ALL');
  return (
    <Card label="My assignments">
      <CardHead title="My assignments" hint="Your work. Open one to update its status." />
      <div className="px-5 pb-1">
        <Tabs label="Status" value={status} onChange={setStatus}
          options={[{ id: 'ALL', label: 'All' }, ...ADS_ASSIGNMENT_STATUSES.map(s => ({ id: s, label: ADS_ASSIGNMENT_STATUS_LABELS[s] }))]} />
      </div>
      <AssignmentList view="mine" status={status === 'ALL' ? undefined : status} cards emptyTitle="No assignments yet" emptyHint="Work assigned to you appears here." onOpen={onOpen} />
    </Card>
  );
};

export const AdsAssign: React.FC = () => {
  const { ctx } = useAdsSession();
  const [openId, setOpenId] = useState<string | null>(() => takePendingAds('ads_assignment'));
  useOpenAdsRequest(useCallback(d => {
    if (d.entityType !== 'ads_assignment') return;
    const id = takePendingAds('ads_assignment');
    if (id) setOpenId(id);
  }, []));
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 font-heading">Assign</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isHead(ctx) ? 'Give work to your Team Leads and follow it through.' : isLead(ctx) ? 'Pass the work you received on to your Team Members and track it.' : 'The work assigned to you.'}
        </p>
      </div>
      {isHead(ctx) && <HeadAssign onOpen={setOpenId} />}
      {isLead(ctx) && <LeadAssign onOpen={setOpenId} />}
      {isMember(ctx) && <MemberAssign onOpen={setOpenId} />}
      {openId && <AssignmentDrawer key="drawer" id={openId} onOpenOther={setOpenId} onClose={close} />}
    </div>
  );
};

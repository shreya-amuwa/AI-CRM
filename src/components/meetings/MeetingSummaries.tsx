import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardList, Flag, Loader2, MessageSquare, Plus, Trash2, Users, X } from 'lucide-react';
import type {
  MeetingActionPriority, MeetingActionStatus, MeetingBlockerCategory, MeetingDecisionStatus, MeetingReportAction, MeetingReportsOverview,
  MeetingSummaryContent, MeetingSummaryList, MeetingSummaryOwnerMethod, MeetingSummaryRow, MeetingSummaryStatus, MeetingSummaryTab,
  MeetingSummaryView, MyMeetingAction
} from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi, type MeetingReportFilters, type SummaryInput } from '../../lib/api/meetings';
import { SideDrawer } from '../common/SideDrawer';
import { relabelRoles } from '../../../shared/roleNames';

/**
 * Post-meeting summaries (Minutes of Meeting) of internal team meetings, and the CEO's Meeting Decisions (migration 20270124000200).
 * The database decides who is responsible (the most senior leader who attended), who may write, read, confirm attendance or ask for a
 * clarification; these screens only show what it allows (view.can.*) and send what the person typed.
 */

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const sectionTitle = 'text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const when = (s: string, e: string) => `${new Date(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${timeOf(s)} – ${timeOf(e)}`;
const stamp = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dueLabel = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date');
const dueText = (d: string | null) => (d ? `due ${dueLabel(d)}` : 'no due date');

export const SUMMARY_STATUS: Record<MeetingSummaryStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Summary pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  SUBMITTED: { label: 'Submitted', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  REVISION_REQUESTED: { label: 'Clarification requested', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
  REVISED: { label: 'Revised', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
};
const METHOD_LABEL: Record<MeetingSummaryOwnerMethod, string> = {
  SENIORITY: 'most senior leader who attended', HOST: 'host, among leaders of the same rank', CREATOR: 'organiser, among leaders of the same rank',
  SELECTED: 'selected among leaders of the same rank', DELEGATED: 'delegated by the Managing Director', TRANSFERRED: 'responsibility transferred',
  ROUTED: 'routed by the organiser', ESCALATED: 'escalated to a supervisor', NO_LEADER: 'no leader attended', SELECTION_REQUIRED: 'a leader must be selected'
};
const DECISION_STATUS: Record<MeetingDecisionStatus, string> = {
  PROPOSED: 'Proposed', APPROVED: 'Approved', IN_PROGRESS: 'Being implemented', IMPLEMENTED: 'Implemented', ON_HOLD: 'On hold'
};
const ACTION_STATUS: Record<MeetingActionStatus, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', DONE: 'Done', BLOCKED: 'Blocked', CANCELLED: 'Cancelled' };
const ACTION_STATUS_CLS: Record<MeetingActionStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800', IN_PROGRESS: 'bg-sky-50 text-sky-800', DONE: 'bg-emerald-50 text-emerald-800', BLOCKED: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-500'
};
const PRIORITY: Record<MeetingActionPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
const BLOCKER: Record<MeetingBlockerCategory, string> = {
  PENDING_APPROVAL: 'Pending approval', RESOURCE: 'Resource shortage', OPERATIONAL: 'Operational problem', CUSTOMER_ESCALATION: 'Customer escalation',
  DEPENDENCY: 'Dependency', CEO_DECISION: 'Needs a Managing Director decision', OTHER: 'Other'
};

const Alert: React.FC<{ tone?: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }> = ({ tone = 'error', children }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
    tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900'
      : tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`}>
    {tone === 'ok' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

export const SummaryBadge: React.FC<{ status: MeetingSummaryStatus; overdue?: boolean; awaitingAttendance?: boolean }> = ({ status, overdue, awaitingAttendance }) => {
  const s = overdue ? { label: 'Summary overdue', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
    : awaitingAttendance && status === 'PENDING' ? { label: 'Attendance to confirm', cls: 'bg-amber-50 text-amber-800 border-amber-200' } : SUMMARY_STATUS[status];
  return <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap ${s.cls}`}>{s.label}</span>;
};

// ---------------------------------------------------------------------------
// The summary of one meeting: in the meeting drawer, and as the report (CEO / supervisors / attendees)
// ---------------------------------------------------------------------------
export const SummaryPanel: React.FC<{ meetingId: string; source?: 'meeting' | 'report'; onChanged?: (text: string) => void }> = ({ meetingId, source = 'meeting', onChanged }) => {
  const [view, setView] = useState<MeetingSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<null | 'draft' | 'amend'>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    setError(null);
    return (source === 'report' ? meetingsApi.report(meetingId) : meetingsApi.summary(meetingId)).then(setView).catch(e => setError(errorMessage(e)));
  }, [meetingId, source]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<MeetingSummaryView>, text: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      setView(await fn());
      setOk(text);
      onChanged?.(text);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!view) return error ? <Alert>{error}</Alert> : <p className="text-slate-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the summary…</p>;
  if (!view.eligible) return null;
  const s = view.summary;
  const confirmed = !!s?.attendanceConfirmedAt;
  const submitted = !!s && s.revisionNo > 0;

  return (
    <section aria-label="Meeting summary" className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900 flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-indigo-600" /> Meeting summary</h3>
        {s && <SummaryBadge status={s.status} overdue={s.overdue} awaitingAttendance={!confirmed} />}
      </div>
      {error && <Alert>{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}

      {!view.started && <p className="text-sm text-slate-500">After the meeting, the most senior leader who attended documents its decisions and next steps here.</p>}
      {s?.isHistorical && !submitted && <p className="text-xs text-slate-500">This meeting took place before summaries were introduced: a summary is optional.</p>}

      {/* 1. attendance (the organiser) */}
      {view.started && view.can.confirmAttendance && (!confirmed || attendanceOpen) && (
        <AttendanceForm view={view} busy={busy} onCancel={confirmed ? () => setAttendanceOpen(false) : undefined}
          onConfirm={ids => act(() => meetingsApi.confirmAttendance(meetingId, ids, s?.version), 'Attendance confirmed. The responsible leader is told.').then(done => done && setAttendanceOpen(false))} />
      )}
      {view.started && !confirmed && !view.can.confirmAttendance && (
        <p className="text-sm text-slate-600">Waiting for the organiser to confirm who attended; then the responsible leader writes the summary.</p>
      )}

      {/* 2. who is responsible */}
      {s && confirmed && (
        <div className="text-sm space-y-1">
          <p>
            <span className="text-slate-500">Responsible: </span>
            {s.owner ? <span className="font-semibold">{s.owner.name}</span> : <span className="font-semibold text-amber-700">nobody yet</span>}
            {s.owner && <span className="text-slate-500"> · {relabelRoles(s.owner.roleLabel)}</span>}
            {s.ownerMethod && <span className="text-slate-400"> ({METHOD_LABEL[s.ownerMethod]}{s.ownerAssignedBy ? ` by ${s.ownerAssignedBy}` : ''})</span>}
          </p>
          {s.ownerReason && <p className="text-xs text-slate-500">Reason: {s.ownerReason}</p>}
          <p className="text-xs text-slate-500">Attendance confirmed {s.attendanceConfirmedBy ? `by ${s.attendanceConfirmedBy} ` : ''}on {stamp(s.attendanceConfirmedAt!)}
            {view.can.confirmAttendance && !submitted && !attendanceOpen && <> · <button type="button" className="text-indigo-700 font-semibold" onClick={() => setAttendanceOpen(true)}>change</button></>}
          </p>
          {!s.overdue && !submitted && <p className="text-xs text-slate-500">Due {stamp(s.dueAt)}</p>}
          {s.overdue && <p className="text-xs font-semibold text-rose-700">Overdue since {stamp(s.dueAt)}</p>}
        </div>
      )}
      {s && confirmed && view.can.assignOwner && (s.selectionRequired || !s.owner || !s.owner.active || (view.can.submit && s.owner?.rank === 4)) && (
        <OwnerPicker view={view} busy={busy}
          onAssign={(id, reason) => act(() => meetingsApi.assignSummaryOwner(meetingId, id, reason, s.version), 'The responsible leader is set and told.')} />
      )}

      {/* 3. writing */}
      {s && !editing && (view.can.edit || view.can.submit) && !submitted && (
        <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-3 space-y-2">
          {view.ended && <p className="text-sm text-indigo-900">Meeting completed. Please document the decisions and next steps.</p>}
          {!view.can.submit && <p className="text-xs text-indigo-900">You can prepare a draft; the responsible leader submits it.</p>}
          <button type="button" className={btnPrimary} onClick={() => setEditing('draft')}>
            {s.status === 'DRAFT' ? 'Continue the summary' : view.can.submit ? 'Submit Meeting Summary' : 'Prepare a draft'}
          </button>
        </div>
      )}
      {s && !editing && view.can.amend && (
        <div className="flex flex-wrap gap-2 items-center">
          {s.status === 'REVISION_REQUESTED' && <p className="text-sm text-violet-800 flex-1">The Managing Director asked for a clarification. Answer it below, and amend the report if something needs correcting.</p>}
          <button type="button" className={btnGhost} onClick={() => setEditing('amend')}>Amend the report</button>
        </div>
      )}
      {s && editing && (
        <SummaryForm view={view} mode={editing} busy={busy} onCancel={() => setEditing(null)}
          onSave={(body, submit, changeNote) => act(
            () => (submit ? meetingsApi.submitSummary(meetingId, body, s.version, changeNote) : meetingsApi.saveSummaryDraft(meetingId, body, s.version)),
            submit ? (editing === 'amend' ? 'Amendment submitted. The Managing Director is told the report changed.' : 'Summary submitted. The meeting is completed and the Managing Director receives the report.') : 'Draft saved.'
          ).then(done => { if (done && submit) setEditing(null); })} />
      )}

      {/* 4. the report */}
      {s?.content && !editing && (submitted || s.status === 'DRAFT') && (
        <ReportView view={view} busy={busy}
          onFlag={view.can.flag ? (type, id, flag) => {
            const note = flag ? window.prompt('Note for the follow-up (optional)') : null;
            if (flag && note === null) return;
            act(() => meetingsApi.flagSummaryItem(meetingId, type, id, flag, note ?? undefined), flag ? 'Marked for follow-up. The leader is told.' : 'Follow-up mark removed.');
          } : undefined}
          onActionStatus={view.can.updateActions ? (id, status) => {
            setBusy(true);
            meetingsApi.updateSummaryAction(id, status).then(() => load()).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
          } : undefined} />
      )}
      {s && submitted && !s.canRead && <p className="text-sm text-slate-500">The summary is submitted.</p>}

      {/* 5. the CEO's questions and the leader's answers */}
      {s?.comments && s.comments.length > 0 && (
        <div>
          <h4 className={sectionTitle}>Clarifications</h4>
          <ul className="space-y-1.5">
            {s.comments.map(c => (
              <li key={c.id} className={`rounded-lg p-2 text-sm ${c.kind === 'RESPONSE' ? 'bg-slate-50' : 'bg-violet-50'}`}>
                <p className="text-xs text-slate-500">{c.kind === 'CLARIFICATION' ? 'Question' : c.kind === 'FOLLOW_UP' ? 'Follow-up' : 'Answer'} · {c.author ?? '—'} · {stamp(c.createdAt)}</p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(view.can.clarify || view.can.reply) && (
        <div className="space-y-2">
          <label className={labelCls} htmlFor={`mms-msg-${meetingId}`}>{view.can.clarify ? 'Ask for a clarification' : 'Answer the Managing Director'}</label>
          <textarea id={`mms-msg-${meetingId}`} rows={2} maxLength={2000} className={inputCls} value={message} onChange={e => setMessage(e.target.value)}
            placeholder={view.can.clarify ? 'Your question goes to the leader; the report itself is not changed.' : 'Your answer'} />
          <button type="button" className={btnGhost} disabled={busy || message.trim().length < (view.can.clarify ? 5 : 2)}
            onClick={() => act(() => (view.can.clarify ? meetingsApi.clarifySummary(meetingId, message.trim()) : meetingsApi.replySummary(meetingId, message.trim())),
              view.can.clarify ? 'Question sent to the leader.' : 'Answer sent to the Managing Director.').then(done => done && setMessage(''))}>
            <MessageSquare className="w-4 h-4" /> {view.can.clarify ? 'Request clarification' : 'Send answer'}
          </button>
        </div>
      )}
    </section>
  );
};

const AttendanceForm: React.FC<{ view: MeetingSummaryView; busy: boolean; onConfirm: (ids: string[]) => void; onCancel?: () => void }> = ({ view, busy, onConfirm, onCancel }) => {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.attendance
    .filter(a => a.attended ?? (a.response === 'ACCEPTED' || a.id === view.meeting.host?.id)).map(a => a.id)));
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <fieldset className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
      <legend className="px-1 text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Users className="w-4 h-4" /> Who attended?</legend>
      <p className="text-xs text-slate-600">An invitation or an RSVP is not attendance: tick who actually took part. It decides who writes the summary, and it is recorded.</p>
      <ul className="space-y-1">
        {view.attendance.map(a => (
          <li key={a.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} className="rounded border-slate-300" />
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-slate-500">{relabelRoles(a.roleLabel)}{a.department ? ` · ${a.department}` : ''}{a.team ? ` · ${a.team}` : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy || picked.size === 0} onClick={() => onConfirm([...picked])}>Confirm attendance</button>
        {onCancel && <button type="button" className={btnGhost} onClick={onCancel}>Back</button>}
      </div>
    </fieldset>
  );
};

const OwnerPicker: React.FC<{ view: MeetingSummaryView; busy: boolean; onAssign: (id: string, reason?: string) => void }> = ({ view, busy, onAssign }) => {
  const s = view.summary!;
  const delegate = view.can.submit && s.owner?.rank === 4;
  const options = s.selectionRequired ? s.candidates
    : delegate ? view.attendance.filter(a => a.attended && a.id !== s.owner?.id)
      : s.routeTargets ?? [];
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const needsReason = !s.selectionRequired && !delegate;
  const title = s.selectionRequired ? 'Several leaders of the same rank attended: choose who writes the summary'
    : delegate ? 'Delegate the summary to someone who attended'
      : !s.owner ? 'No leader attended: route the summary to a leader of the attendees' : 'The responsible leader is no longer active: transfer the summary';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {options.length === 0 ? <p className="text-xs text-slate-500">Nobody can be chosen. Ask the supervisor of this team or the Managing Director.</p> : (
        <>
          <select aria-label="Responsible leader" className={inputCls} value={id} onChange={e => setId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name} · {relabelRoles(o.roleLabel)}{o.department ? ` · ${o.department}` : ''}</option>)}
          </select>
          {(needsReason || delegate) && <input aria-label="Reason" className={inputCls} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={needsReason ? 'Why this person? (required, recorded)' : 'Note (optional, recorded)'} />}
          <button type="button" className={btnGhost} disabled={busy || !id || (needsReason && reason.trim().length < 3)} onClick={() => onAssign(id, reason.trim() || undefined)}>
            Make responsible
          </button>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The structured form
// ---------------------------------------------------------------------------
const emptyContent = (): SummaryInput => ({
  purposeNote: null, executiveSummary: '', discussionPoints: [], noDecisions: false, decisions: [], actions: [], noBlockers: false, blockers: [],
  nextSteps: '', followUp: { required: false, date: null, outcome: null }
});
const toInput = (c: MeetingSummaryContent | null): SummaryInput => (!c ? emptyContent() : {
  purposeNote: c.purposeNote, executiveSummary: c.executiveSummary ?? '', discussionPoints: c.discussionPoints, noDecisions: c.noDecisions, noBlockers: c.noBlockers,
  nextSteps: c.nextSteps ?? '', followUp: { required: c.followUp.required, date: c.followUp.date, outcome: c.followUp.outcome },
  decisions: c.decisions.map(d => ({ key: d.key, title: d.title, description: d.description, departmentId: d.departmentId, teamId: d.teamId, decidedBy: d.decidedBy, status: d.status })),
  actions: c.actions.map(a => ({ key: a.key, title: a.title, description: a.description, assigneeId: a.assigneeId, dueDate: a.dueDate, priority: a.priority, status: a.status, decisionKey: a.decisionKey })),
  blockers: c.blockers.map(b => ({ key: b.key, category: b.category, description: b.description, needsCeoAttention: b.needsCeoAttention }))
});

const SummaryForm: React.FC<{
  view: MeetingSummaryView; mode: 'draft' | 'amend'; busy: boolean; onCancel: () => void;
  onSave: (body: SummaryInput, submit: boolean, changeNote?: string) => void;
}> = ({ view, mode, busy, onCancel, onSave }) => {
  const s = view.summary!;
  const [f, setF] = useState<SummaryInput>(() => toInput(s.content));
  const [changeNote, setChangeNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const attended = view.attendance.filter(a => a.attended);
  const assignable = s.assignable ?? [];
  const set = <K extends keyof SummaryInput>(k: K, v: SummaryInput[K]) => setF(p => ({ ...p, [k]: v }));
  const m = view.meeting;

  const submit = (final: boolean) => {
    setProblem(null);
    const body: SummaryInput = { ...f, discussionPoints: f.discussionPoints.map(x => x.trim()).filter(Boolean) };
    if (final) {
      if ((body.executiveSummary ?? '').trim().length < 20) return setProblem('Write the executive summary: what happened in the meeting (at least 20 characters).');
      if (!body.decisions.length && !body.noDecisions) return setProblem('Record the decisions taken, or tick "No decisions were made".');
      if (!body.blockers.length && !body.noBlockers) return setProblem('Record the issues or blockers, or tick "No blockers".');
      if (body.actions.some(a => !a.assigneeId)) return setProblem('Choose who is responsible for each action item.');
      if (body.followUp.required && !body.followUp.date) return setProblem('Give the target date of the follow-up.');
      if (mode === 'amend' && changeNote.trim().length < 3) return setProblem('Say what changed in this amendment.');
    }
    onSave(body, final, mode === 'amend' ? changeNote.trim() : undefined);
  };

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit(true); }} aria-label="Meeting summary form">
      {/* A. filled in from the meeting */}
      <div className="rounded-lg bg-slate-50 p-3 text-sm grid grid-cols-[96px_1fr] gap-x-2 gap-y-1">
        <span className="text-slate-500">Meeting</span><span className="font-medium">{m.title} <span className="text-slate-400">· {m.reference}</span></span>
        <span className="text-slate-500">When</span><span>{when(m.startsAt, m.endsAt)}</span>
        <span className="text-slate-500">Department</span><span>{m.department ?? '—'}{m.team ? ` · ${m.team}` : ''}{m.division ? ` · ${m.division === 'SALES' ? 'Sales' : 'Support'}` : ''}</span>
        <span className="text-slate-500">Host</span><span>{m.host?.name ?? '—'}{m.organiser && m.organiser.id !== m.host?.id ? ` · organised by ${m.organiser.name}` : ''}</span>
        <span className="text-slate-500">Attended</span><span>{attended.map(a => a.name).join(', ') || '—'}</span>
        <span className="text-slate-500">Summary by</span><span>{s.owner ? `${s.owner.name} · ${relabelRoles(s.owner.roleLabel)}` : '—'}</span>
      </div>

      {/* B. purpose */}
      <div>
        <p className={labelCls}>Purpose / agenda</p>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.purpose || 'No agenda was given.'}</p>
        <input aria-label="Purpose clarification" className={`${inputCls} mt-1.5`} maxLength={1000} value={f.purposeNote ?? ''}
          onChange={e => set('purposeNote', e.target.value || null)} placeholder="Short clarification of the purpose (optional)" />
      </div>

      {/* C. executive summary */}
      <div>
        <label className={labelCls} htmlFor="mms-exec">Executive summary (required)</label>
        <textarea id="mms-exec" rows={5} maxLength={8000} className={inputCls} value={f.executiveSummary ?? ''} onChange={e => set('executiveSummary', e.target.value)}
          placeholder="What happened in the meeting, in a few sentences: what was reviewed, what was found, what was agreed." />
        <p className="text-[11px] text-slate-400 text-right">{(f.executiveSummary ?? '').length} / 8000</p>
      </div>

      {/* D. discussion points */}
      <div>
        <p className={labelCls}>Discussion points</p>
        <ul className="space-y-1.5">
          {f.discussionPoints.map((p, i) => (
            <li key={i} className="flex gap-2">
              <input aria-label={`Discussion point ${i + 1}`} className={inputCls} maxLength={500} value={p}
                onChange={e => set('discussionPoints', f.discussionPoints.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" aria-label="Remove discussion point" className={btnGhost} onClick={() => set('discussionPoints', f.discussionPoints.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        {f.discussionPoints.length < 50 && <button type="button" className={`${btnGhost} mt-1.5`} onClick={() => set('discussionPoints', [...f.discussionPoints, ''])}><Plus className="w-4 h-4" /> Add a point</button>}
      </div>

      {/* E. decisions */}
      <div>
        <p className={labelCls}>Decisions taken (required)</p>
        <ul className="space-y-2">
          {f.decisions.map((d, i) => (
            <li key={d.key} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              <div className="flex gap-2">
                <span className="text-sm font-bold text-slate-500 pt-2">{i + 1}.</span>
                <input aria-label={`Decision ${i + 1} title`} className={inputCls} maxLength={200} placeholder="Decision" value={d.title}
                  onChange={e => set('decisions', f.decisions.map(x => (x.key === d.key ? { ...x, title: e.target.value } : x)))} />
                <button type="button" aria-label="Remove decision" className={btnGhost} onClick={() => set('decisions', f.decisions.filter(x => x.key !== d.key))}><Trash2 className="w-4 h-4" /></button>
              </div>
              <textarea aria-label={`Decision ${i + 1} description`} rows={2} maxLength={2000} className={inputCls} placeholder="What exactly was decided" value={d.description ?? ''}
                onChange={e => set('decisions', f.decisions.map(x => (x.key === d.key ? { ...x, description: e.target.value || null } : x)))} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select aria-label={`Decision ${i + 1} made by`} className={inputCls} value={d.decidedBy ?? ''}
                  onChange={e => set('decisions', f.decisions.map(x => (x.key === d.key ? { ...x, decidedBy: e.target.value || null } : x)))}>
                  <option value="">Decided by: {s.owner?.name ?? 'the responsible leader'}</option>
                  {attended.filter(a => a.id !== s.owner?.id).map(a => <option key={a.id} value={a.id}>Decided by: {a.name} ({relabelRoles(a.roleLabel)})</option>)}
                </select>
                <select aria-label={`Decision ${i + 1} status`} className={inputCls} value={d.status}
                  onChange={e => set('decisions', f.decisions.map(x => (x.key === d.key ? { ...x, status: e.target.value as MeetingDecisionStatus } : x)))}>
                  {(Object.keys(DECISION_STATUS) as MeetingDecisionStatus[]).map(k => <option key={k} value={k}>{DECISION_STATUS[k]}</option>)}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-1.5">
          {!f.noDecisions && f.decisions.length < 50 && <button type="button" className={btnGhost} onClick={() => set('decisions', [...f.decisions,
            { key: newKey(), title: '', description: null, departmentId: m.departmentId, teamId: null, decidedBy: null, status: 'APPROVED' }])}><Plus className="w-4 h-4" /> Add a decision</button>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.noDecisions} disabled={f.decisions.length > 0} onChange={e => set('noDecisions', e.target.checked)} className="rounded border-slate-300" />
            No decisions were made
          </label>
        </div>
      </div>

      {/* F. action items */}
      <div>
        <p className={labelCls}>Action items</p>
        {!assignable.length && <p className="text-xs text-slate-500">Action items can be given to the people you lead.</p>}
        <ul className="space-y-2">
          {f.actions.map((a, i) => (
            <li key={a.key} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              <div className="flex gap-2">
                <input aria-label={`Action ${i + 1} title`} className={inputCls} maxLength={200} placeholder="Task / action" value={a.title}
                  onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, title: e.target.value } : x)))} />
                <button type="button" aria-label="Remove action item" className={btnGhost} onClick={() => set('actions', f.actions.filter(x => x.key !== a.key))}><Trash2 className="w-4 h-4" /></button>
              </div>
              <textarea aria-label={`Action ${i + 1} description`} rows={2} maxLength={2000} className={inputCls} placeholder="Description (optional)" value={a.description ?? ''}
                onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, description: e.target.value || null } : x)))} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select aria-label={`Action ${i + 1} responsible employee`} className={inputCls} value={a.assigneeId}
                  onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, assigneeId: e.target.value } : x)))}>
                  <option value="">Responsible employee…</option>
                  {assignable.map(p => <option key={p.id} value={p.id}>{p.name} ({relabelRoles(p.roleLabel)})</option>)}
                </select>
                <input aria-label={`Action ${i + 1} due date`} type="date" className={inputCls} value={a.dueDate ?? ''}
                  onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, dueDate: e.target.value || null } : x)))} />
                <select aria-label={`Action ${i + 1} priority`} className={inputCls} value={a.priority}
                  onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, priority: e.target.value as MeetingActionPriority } : x)))}>
                  {(Object.keys(PRIORITY) as MeetingActionPriority[]).map(k => <option key={k} value={k}>Priority: {PRIORITY[k]}</option>)}
                </select>
                <select aria-label={`Action ${i + 1} status`} className={inputCls} value={a.status}
                  onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, status: e.target.value as MeetingActionStatus } : x)))}>
                  {(Object.keys(ACTION_STATUS) as MeetingActionStatus[]).map(k => <option key={k} value={k}>Status: {ACTION_STATUS[k]}</option>)}
                </select>
                {f.decisions.length > 0 && (
                  <select aria-label={`Action ${i + 1} related decision`} className={`${inputCls} sm:col-span-2`} value={a.decisionKey ?? ''}
                    onChange={e => set('actions', f.actions.map(x => (x.key === a.key ? { ...x, decisionKey: e.target.value || null } : x)))}>
                    <option value="">No related decision</option>
                    {f.decisions.map((d, j) => <option key={d.key} value={d.key}>Decision {j + 1}: {d.title || '(untitled)'}</option>)}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
        {f.actions.length < 100 && assignable.length > 0 && <button type="button" className={`${btnGhost} mt-1.5`} onClick={() => set('actions', [...f.actions,
          { key: newKey(), title: '', description: null, assigneeId: '', dueDate: null, priority: 'MEDIUM', status: 'PENDING', decisionKey: null }])}><Plus className="w-4 h-4" /> Add an action item</button>}
      </div>

      {/* G. blockers */}
      <div>
        <p className={labelCls}>Issues / blockers (required)</p>
        <ul className="space-y-2">
          {f.blockers.map((b, i) => (
            <li key={b.key} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              <div className="flex gap-2">
                <select aria-label={`Blocker ${i + 1} type`} className={inputCls} value={b.category}
                  onChange={e => set('blockers', f.blockers.map(x => (x.key === b.key ? { ...x, category: e.target.value as MeetingBlockerCategory } : x)))}>
                  {(Object.keys(BLOCKER) as MeetingBlockerCategory[]).map(k => <option key={k} value={k}>{BLOCKER[k]}</option>)}
                </select>
                <button type="button" aria-label="Remove blocker" className={btnGhost} onClick={() => set('blockers', f.blockers.filter(x => x.key !== b.key))}><Trash2 className="w-4 h-4" /></button>
              </div>
              <textarea aria-label={`Blocker ${i + 1} description`} rows={2} maxLength={2000} className={inputCls} placeholder="What is blocking, and what is needed" value={b.description}
                onChange={e => set('blockers', f.blockers.map(x => (x.key === b.key ? { ...x, description: e.target.value } : x)))} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={b.needsCeoAttention} className="rounded border-slate-300"
                  onChange={e => set('blockers', f.blockers.map(x => (x.key === b.key ? { ...x, needsCeoAttention: e.target.checked } : x)))} />
                Requires the Managing Director's attention
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-1.5">
          {!f.noBlockers && f.blockers.length < 50 && <button type="button" className={btnGhost} onClick={() => set('blockers', [...f.blockers,
            { key: newKey(), category: 'OTHER', description: '', needsCeoAttention: false }])}><Plus className="w-4 h-4" /> Add a blocker</button>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.noBlockers} disabled={f.blockers.length > 0} onChange={e => set('noBlockers', e.target.checked)} className="rounded border-slate-300" />
            No blockers
          </label>
        </div>
      </div>

      {/* H. next steps; I. follow-up */}
      <div>
        <label className={labelCls} htmlFor="mms-next">Next steps and intended outcomes</label>
        <textarea id="mms-next" rows={3} maxLength={4000} className={inputCls} value={f.nextSteps ?? ''} onChange={e => set('nextSteps', e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={f.followUp.required} className="rounded border-slate-300" onChange={e => set('followUp', { ...f.followUp, required: e.target.checked })} />
          A follow-up review is needed
        </label>
        {f.followUp.required && (
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
            <input aria-label="Follow-up target date" type="date" className={inputCls} value={f.followUp.date ?? ''} onChange={e => set('followUp', { ...f.followUp, date: e.target.value || null })} />
            <input aria-label="Expected outcome" className={inputCls} maxLength={1000} placeholder="Expected outcome" value={f.followUp.outcome ?? ''}
              onChange={e => set('followUp', { ...f.followUp, outcome: e.target.value || null })} />
          </div>
        )}
        {f.followUp.required && <p className="text-xs text-slate-500">To book it, use New meeting; it will have its own summary.</p>}
      </div>

      {mode === 'amend' && (
        <div>
          <label className={labelCls} htmlFor="mms-change">What changed in this amendment? (required, the Managing Director sees it)</label>
          <input id="mms-change" className={inputCls} maxLength={1000} value={changeNote} onChange={e => setChangeNote(e.target.value)} />
        </div>
      )}
      {problem && <Alert>{problem}</Alert>}
      <div className="flex flex-wrap gap-2 sticky bottom-0 bg-white py-2">
        {view.can.submit && <button type="submit" className={btnPrimary} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {mode === 'amend' ? 'Submit amendment' : 'Submit summary'}</button>}
        {mode === 'draft' && view.can.edit && <button type="button" className={btnGhost} disabled={busy} onClick={() => submit(false)}>Save draft</button>}
        <button type="button" className={btnGhost} onClick={onCancel}>Close</button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// The executive report (read-only)
// ---------------------------------------------------------------------------
export const ReportView: React.FC<{
  view: MeetingSummaryView; busy?: boolean;
  onFlag?: (type: 'DECISION' | 'BLOCKER', id: string, flag: boolean) => void;
  onActionStatus?: (id: string, status: MeetingActionStatus) => void;
}> = ({ view, busy, onFlag, onActionStatus }) => {
  const s = view.summary!;
  const c = s.content!;
  const m = view.meeting;
  const attended = view.attendance.filter(a => a.attended);
  const decisionNo = (key: string | null) => (key ? c.decisions.findIndex(d => d.key === key) + 1 : 0);
  return (
    <article className="space-y-3 text-sm" aria-label="Meeting report">
      {s.status === 'DRAFT' && <Alert tone="warn">Draft: not submitted yet.</Alert>}
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1">
        <dt className="text-slate-500">Meeting</dt><dd className="font-semibold">{m.title}</dd>
        <dt className="text-slate-500">Department</dt><dd>{m.department ?? '—'}{m.team ? ` · ${m.team}` : ''}</dd>
        <dt className="text-slate-500">Led by</dt><dd>{s.owner ? `${s.owner.name} (${relabelRoles(s.owner.roleLabel)})` : '—'}</dd>
        <dt className="text-slate-500">When</dt><dd>{when(m.startsAt, m.endsAt)}</dd>
        <dt className="text-slate-500">Attended</dt><dd>{attended.length ? `${attended.length}: ${attended.map(a => a.name).join(', ')}` : '—'}</dd>
        <dt className="text-slate-500">Purpose</dt><dd className="whitespace-pre-wrap">{[m.purpose, c.purposeNote].filter(Boolean).join('\n') || '—'}</dd>
      </dl>
      <div>
        <h4 className={sectionTitle}>Executive summary</h4>
        <p className="whitespace-pre-wrap text-slate-800">{c.executiveSummary || '—'}</p>
      </div>
      {c.discussionPoints.length > 0 && (
        <div>
          <h4 className={sectionTitle}>Discussed</h4>
          <ul className="list-disc pl-5 space-y-0.5">{c.discussionPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      <div>
        <h4 className={sectionTitle}>Key decisions</h4>
        {c.noDecisions || !c.decisions.length ? <p className="text-slate-500">No decisions were made.</p> : (
          <ol className="space-y-1.5">
            {c.decisions.map((d, i) => (
              <li key={d.key} className={`rounded-lg p-2 ${d.ceoFollowUp ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{i + 1}. {d.title}</p>
                  <span className="text-xs rounded-full bg-white border border-slate-200 px-2 py-0.5">{DECISION_STATUS[d.status]}</span>
                </div>
                {d.description && <p className="whitespace-pre-wrap text-slate-700">{d.description}</p>}
                <p className="text-xs text-slate-500">Decided by {d.decidedByName ?? '—'}{d.department ? ` · ${d.department}` : ''}{d.team ? ` · ${d.team}` : ''}</p>
                {d.ceoFollowUp && <p className="text-xs font-semibold text-amber-800">Managing Director follow-up{d.ceoFollowUpNote ? `: ${d.ceoFollowUpNote}` : ''}</p>}
                {onFlag && d.id && <button type="button" disabled={busy} className="text-xs font-semibold text-indigo-700 mt-1 inline-flex items-center gap-1" onClick={() => onFlag('DECISION', d.id!, !d.ceoFollowUp)}>
                  <Flag className="w-3 h-3" /> {d.ceoFollowUp ? 'Clear follow-up' : 'Mark for follow-up'}</button>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <h4 className={sectionTitle}>Action items</h4>
        {!c.actions.length ? <p className="text-slate-500">No action items.</p> : (
          <ul className="space-y-1.5">
            {c.actions.map(a => (
              <li key={a.key} className="rounded-lg border border-slate-200 p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{a.title}</p>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${ACTION_STATUS_CLS[a.status]}`}>{ACTION_STATUS[a.status]}</span>
                </div>
                {a.description && <p className="text-slate-700 whitespace-pre-wrap">{a.description}</p>}
                <p className="text-xs text-slate-500">{a.assigneeName ?? '—'} · {dueText(a.dueDate)} · {PRIORITY[a.priority]} priority
                  {decisionNo(a.decisionKey) > 0 ? ` · decision ${decisionNo(a.decisionKey)}` : ''}
                  {a.overdue && <span className="text-rose-700 font-semibold"> · overdue</span>}</p>
                {onActionStatus && a.id && (
                  <select aria-label={`Status of ${a.title}`} className="mt-1 rounded border border-slate-300 text-xs px-2 py-1" value={a.status} disabled={busy}
                    onChange={e => onActionStatus(a.id!, e.target.value as MeetingActionStatus)}>
                    {(Object.keys(ACTION_STATUS) as MeetingActionStatus[]).map(k => <option key={k} value={k}>{ACTION_STATUS[k]}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className={sectionTitle}>Blockers</h4>
        {c.noBlockers || !c.blockers.length ? <p className="text-slate-500">No blockers.</p> : (
          <ul className="space-y-1.5">
            {c.blockers.map(b => (
              <li key={b.key} className={`rounded-lg p-2 ${b.needsCeoAttention || b.ceoFollowUp ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50'}`}>
                <p className="text-xs font-semibold text-slate-600">{BLOCKER[b.category]}{b.needsCeoAttention ? ' · requires Managing Director attention' : ''}</p>
                <p className="whitespace-pre-wrap">{b.description}</p>
                {b.ceoFollowUp && <p className="text-xs font-semibold text-amber-800">Managing Director follow-up{b.ceoFollowUpNote ? `: ${b.ceoFollowUpNote}` : ''}</p>}
                {onFlag && b.id && <button type="button" disabled={busy} className="text-xs font-semibold text-indigo-700 mt-1 inline-flex items-center gap-1" onClick={() => onFlag('BLOCKER', b.id!, !b.ceoFollowUp)}>
                  <Flag className="w-3 h-3" /> {b.ceoFollowUp ? 'Clear follow-up' : 'Mark for follow-up'}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(c.nextSteps || c.followUp.required) && (
        <div>
          <h4 className={sectionTitle}>Next steps</h4>
          {c.nextSteps && <p className="whitespace-pre-wrap">{c.nextSteps}</p>}
          {c.followUp.required && <p className="text-slate-700">Follow-up review {c.followUp.date ? `by ${dueLabel(c.followUp.date)}` : ''}{c.followUp.outcome ? `: ${c.followUp.outcome}` : ''}</p>}
        </div>
      )}
      {s.submittedAt && (
        <p className="text-xs text-slate-500 border-t border-slate-100 pt-2">
          Submitted by {s.submittedBy ?? '—'} on {stamp(s.submittedAt)}{s.revisionNo > 1 ? ` · revision ${s.revisionNo} (first submitted ${stamp(s.firstSubmittedAt!)})` : ''}
        </p>
      )}
      {s.revisions && s.revisions.length > 1 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">Revision history ({s.revisions.length})</summary>
          <ul className="mt-2 space-y-2">
            {s.revisions.map(r => (
              <li key={r.revisionNo} className="rounded border border-slate-200 p-2">
                <p className="font-semibold">Revision {r.revisionNo} · {r.kind === 'SUBMITTED' ? 'original submission' : 'amendment'} · {r.actor ?? '—'} · {stamp(r.createdAt)}</p>
                {r.changeNote && <p>Changed: {r.changeNote}</p>}
                <p className="whitespace-pre-wrap text-slate-500">{r.snapshot.executiveSummary}</p>
                <p className="text-slate-500">{r.snapshot.decisions.length} decision(s), {r.snapshot.actions.length} action item(s), {r.snapshot.blockers.length} blocker(s)</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
};

/** A summary opened from a list or a notification (the CEO's report view, or a supervisor's / attendee's / assignee's). */
export const SummaryReportDrawer: React.FC<{ meetingId: string; ceo: boolean; onClose: () => void; onChanged?: () => void }> = ({ meetingId, ceo, onClose, onChanged }) => (
  <SideDrawer title="Meeting report" onClose={onClose}>
    <div className="p-5">
      <SummaryPanel meetingId={meetingId} source={ceo ? 'report' : 'meeting'} onChanged={() => onChanged?.()} />
    </div>
  </SideDrawer>
);

// ---------------------------------------------------------------------------
// My meeting summaries (every employee; leaders also see their teams')
// ---------------------------------------------------------------------------
const TABS: [Exclude<MeetingSummaryTab, 'ALL'>, string][] = [['PENDING', 'Pending'], ['DRAFT', 'Drafts'], ['SUBMITTED', 'Submitted'], ['OVERDUE', 'Overdue']];

const SummaryRowItem: React.FC<{ r: MeetingSummaryRow; action: string; onOpen: () => void; showCounts?: boolean }> = ({ r, action, onOpen, showCounts }) => (
  <li className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2">
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-slate-900 truncate">{r.title} <span className="text-xs text-slate-400 font-normal">{r.reference}</span></p>
      <p className="text-xs text-slate-500">{when(r.startsAt, r.endsAt)} · {r.department ?? '—'}{r.team ? ` · ${r.team}` : ''}</p>
      <p className="text-xs text-slate-500">Responsible: {r.owner ? `${r.owner.name} (${relabelRoles(r.owner.roleLabel)})` : r.awaitingAttendance ? 'after attendance is confirmed' : 'to be chosen'}
        {showCounts && r.revisionNo > 0 && ` · ${r.decisions} decision(s), ${r.actions} action item(s), ${r.blockers} blocker(s)`}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <SummaryBadge status={r.status} overdue={r.overdue} awaitingAttendance={r.awaitingAttendance} />
      <button type="button" className={btnGhost} onClick={onOpen}>{action}</button>
    </div>
  </li>
);

export const MySummariesTab: React.FC<{ reloadKey: number; onOpenMeeting: (id: string) => void; onOpenReport: (id: string) => void }> = ({ reloadKey, onOpenMeeting, onOpenReport }) => {
  const [scope, setScope] = useState<'MINE' | 'TEAM'>('MINE');
  const [tab, setTab] = useState<Exclude<MeetingSummaryTab, 'ALL'>>('PENDING');
  const [data, setData] = useState<MeetingSummaryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leader, setLeader] = useState(false);
  const [actions, setActions] = useState<MyMeetingAction[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // a leader also sees the summaries of the teams they lead (the database refuses everyone else)
    meetingsApi.summaries('TEAM', 'ALL', 0, 1).then(() => setLeader(true)).catch(() => setLeader(false));
  }, [reloadKey]);
  useEffect(() => {
    let live = true;
    setError(null);
    meetingsApi.summaries(scope, tab, offset).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [scope, tab, offset, reloadKey]);
  const loadActions = useCallback(() => meetingsApi.myActions().then(setActions).catch(() => setActions([])), []);
  useEffect(() => { loadActions(); }, [loadActions, reloadKey]);

  const actionLabel = (r: MeetingSummaryRow) => (scope === 'TEAM' ? 'View' : r.awaitingAttendance ? 'Confirm attendance'
    : r.status === 'SUBMITTED' || r.status === 'REVISED' ? 'View' : r.status === 'DRAFT' ? 'Edit' : r.status === 'REVISION_REQUESTED' ? 'Answer' : 'Submit');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {leader ? (
          <div role="group" aria-label="Whose summaries" className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            {(['MINE', 'TEAM'] as const).map(x => (
              <button key={x} type="button" aria-pressed={scope === x} onClick={() => { setScope(x); setOffset(0); }}
                className={`px-3 py-1.5 font-semibold ${scope === x ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{x === 'MINE' ? 'My summaries' : 'My teams'}</button>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">The summaries of team meetings you lead, organise or attended.</p>}
      </div>
      <div role="tablist" aria-label="Summary status" className="flex flex-wrap gap-1">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => { setTab(id); setOffset(0); }}
            className={`rounded-full px-3 py-1 text-sm font-semibold border ${tab === id ? (id === 'OVERDUE' ? 'bg-rose-600 text-white border-rose-600' : 'bg-indigo-600 text-white border-indigo-600') : 'bg-white text-slate-600 border-slate-300'}`}>
            {label}{data ? ` (${data.counts[id]})` : ''}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {data && !data.items.length && <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-4 text-center">Nothing here.</p>}
      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map(r => <SummaryRowItem key={r.meetingId} r={r} action={actionLabel(r)} showCounts={scope === 'TEAM'}
            onOpen={() => (scope === 'TEAM' ? onOpenReport(r.meetingId) : onOpenMeeting(r.meetingId))} />)}
        </ul>
      )}
      {data && data.total > 50 && (
        <div className="flex gap-2 items-center text-sm">
          <button type="button" className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
          <span className="text-slate-500">{offset + 1}–{Math.min(offset + 50, data.total)} of {data.total}</span>
          <button type="button" className={btnGhost} disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next</button>
        </div>
      )}

      <section aria-label="My action items" className="space-y-2">
        <h3 className="font-bold text-slate-900">My action items from meetings</h3>
        {!actions.length ? <p className="text-sm text-slate-500">No action items given to you.</p> : (
          <ul className="space-y-2">
            {actions.map(a => (
              <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs text-slate-500">From {a.meetingTitle} ({dateOnly(a.meetingStartsAt)}){a.ownerName ? `, given by ${a.ownerName}` : ''} · {dueText(a.dueDate)}
                    {a.overdue && <span className="text-rose-700 font-semibold"> · overdue</span>}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select aria-label={`Status of ${a.title}`} className="rounded-lg border border-slate-300 text-sm px-2 py-1.5" value={a.status} disabled={busy === a.id}
                    onChange={e => {
                      setBusy(a.id);
                      meetingsApi.updateSummaryAction(a.id, e.target.value as MeetingActionStatus).then(loadActions).catch(err => setError(errorMessage(err))).finally(() => setBusy(null));
                    }}>
                    {(['PENDING', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as MeetingActionStatus[]).map(k => <option key={k} value={k}>{ACTION_STATUS[k]}</option>)}
                  </select>
                  <button type="button" className={btnGhost} onClick={() => onOpenReport(a.meetingId)}>Report</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Meeting Decisions: the CEO's view of every internal team meeting's outcome
// ---------------------------------------------------------------------------
type Period = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';
const periodRange = (p: Period, custom: { from: string; to: string }) => {
  const now = new Date();
  if (p === 'TODAY') return { from: ymd(now), to: ymd(now) };
  if (p === 'WEEK') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { from: ymd(d), to: ymd(now) };
  }
  if (p === 'MONTH') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  return custom;
};

const Stat: React.FC<{ label: string; value: number; tone?: 'red' | 'amber' | 'green'; onClick?: () => void }> = ({ label, value, tone, onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick}
    className="text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 disabled:hover:border-slate-200 disabled:cursor-default">
    <span className="block text-xs font-semibold text-slate-500">{label}</span>
    <span className={`block text-2xl font-extrabold ${tone === 'red' && value ? 'text-rose-700' : tone === 'amber' && value ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</span>
  </button>
);

export const MeetingDecisionsTab: React.FC<{ reloadKey: number; onOpenReport: (id: string) => void }> = ({ reloadKey, onOpenReport }) => {
  const [period, setPeriod] = useState<Period>('MONTH');
  const [custom, setCustom] = useState(() => periodRange('MONTH', { from: '', to: '' }));
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [leaderRank, setLeaderRank] = useState('');
  const [status, setStatus] = useState('');
  const [attention, setAttention] = useState(false);
  const [offset, setOffset] = useState(0);
  const [overview, setOverview] = useState<MeetingReportsOverview | null>(null);
  const [reports, setReports] = useState<{ items: MeetingSummaryRow[]; total: number } | null>(null);
  const [actionStatus, setActionStatus] = useState<'OPEN' | 'OVERDUE' | 'DONE' | 'ALL'>('OPEN');
  const [actions, setActions] = useState<{ items: MeetingReportAction[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = periodRange(period, custom);
  const filters: MeetingReportFilters = useMemo(() => ({
    from: range.from || undefined, to: range.to || undefined, departmentId: departmentId || undefined, teamId: teamId || undefined,
    leaderId: leaderId || undefined, leaderRank: leaderRank ? Number(leaderRank) : undefined
  }), [range.from, range.to, departmentId, teamId, leaderId, leaderRank]);
  const validRange = !range.from || !range.to || range.from <= range.to;

  useEffect(() => {
    if (!validRange) return;
    let live = true;
    setError(null);
    meetingsApi.reportsOverview(filters).then(d => { if (live) setOverview(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [filters, validRange, reloadKey]);
  useEffect(() => {
    if (!validRange) return;
    let live = true;
    meetingsApi.reports({ ...filters, status: status || undefined, attention, offset, limit: 25 })
      .then(d => { if (live) setReports(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [filters, status, attention, offset, validRange, reloadKey]);
  useEffect(() => {
    if (!validRange) return;
    let live = true;
    meetingsApi.reportActions({ ...filters, status: actionStatus, limit: 50 }).then(d => { if (live) setActions(d); }).catch(() => { if (live) setActions(null); });
    return () => { live = false; };
  }, [filters, actionStatus, validRange, reloadKey]);
  useEffect(() => { setOffset(0); }, [filters, status, attention]);

  const show = (st: string, att = false) => { setStatus(st); setAttention(att); };
  const teams = (overview?.teams ?? []).filter(t => !departmentId || t.departmentId === departmentId);
  const leaders = (overview?.leaders ?? []).filter(l => !leaderRank || l.rank === Number(leaderRank));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {([['TODAY', 'Today'], ['WEEK', 'This week'], ['MONTH', 'This month'], ['CUSTOM', 'Custom']] as [Period, string][]).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}
              className={`px-3 py-1.5 font-semibold ${period === id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        {period === 'CUSTOM' && <>
          <input aria-label="From" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
          <input aria-label="To" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
        </>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <select aria-label="Department" className={inputCls} value={departmentId} onChange={e => { setDepartmentId(e.target.value); setTeamId(''); }}>
          <option value="">All departments</option>
          {(overview?.departments ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Team" className={inputCls} value={teamId} onChange={e => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Leader role" className={inputCls} value={leaderRank} onChange={e => { setLeaderRank(e.target.value); setLeaderId(''); }}>
          <option value="">Led by anyone</option>
          <option value="3">CEOs</option>
          <option value="2">Department Heads</option>
          <option value="1">Team Leads</option>
          <option value="4">Managing Director</option>
        </select>
        <select aria-label="Leader" className={inputCls} value={leaderId} onChange={e => setLeaderId(e.target.value)}>
          <option value="">Every leader</option>
          {leaders.map(l => <option key={l.id} value={l.id}>{l.name} ({relabelRoles(l.roleLabel)})</option>)}
        </select>
      </div>
      {!validRange && <Alert>Choose a period that ends on or after its start.</Alert>}
      {error && <Alert>{error}</Alert>}

      {/* executive overview */}
      <section aria-label="Executive overview" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Meetings held" value={overview?.held ?? 0} onClick={() => show('')} />
        <Stat label="Summaries submitted" value={overview?.submitted ?? 0} tone="green" onClick={() => show('SUBMITTED')} />
        <Stat label="Summaries pending" value={(overview?.pending ?? 0) + (overview?.revisionRequested ?? 0)} tone="amber" onClick={() => show('PENDING')} />
        <Stat label="Overdue summaries" value={overview?.overdue ?? 0} tone="red" onClick={() => show('OVERDUE')} />
        <Stat label="Decisions recorded" value={overview?.decisions ?? 0} />
        <Stat label="Open action items" value={overview?.openActions ?? 0} onClick={() => setActionStatus('OPEN')} />
        <Stat label="Action items overdue" value={overview?.overdueActions ?? 0} tone="red" onClick={() => setActionStatus('OVERDUE')} />
        <Stat label="Requires your attention" value={overview?.attention ?? 0} tone="red" onClick={() => show('', true)} />
      </section>
      <p className="text-xs text-slate-500">A meeting that took place, a submitted summary and a completed action item are counted separately: a decision is not "implemented" because its summary was submitted. Summaries are due {overview?.overdueHours ?? 24} hours after the meeting.</p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section aria-label="Requires attention" className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="font-bold text-slate-900 mb-2">Requires your attention</h3>
          {!overview?.attentionItems.length ? <p className="text-sm text-slate-500">Nothing flagged for you.</p> : (
            <ul className="space-y-1.5">
              {overview.attentionItems.map(a => (
                <li key={`${a.type}-${a.id}`}>
                  <button type="button" className="w-full text-left rounded-lg bg-rose-50/60 hover:bg-rose-50 p-2 text-sm" onClick={() => onOpenReport(a.meetingId)}>
                    <span className="text-xs font-semibold text-rose-700">{a.type === 'DECISION' ? 'Decision to follow up' : a.category ? BLOCKER[a.category] : 'Blocker'}</span>
                    <span className="block">{a.text}</span>
                    <span className="block text-xs text-slate-500">{a.meetingTitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Latest decisions" className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="font-bold text-slate-900 mb-2">Latest decisions</h3>
          {!overview?.latestDecisions.length ? <p className="text-sm text-slate-500">No decisions recorded in this period.</p> : (
            <ul className="space-y-1.5">
              {overview.latestDecisions.map(d => (
                <li key={d.id}>
                  <button type="button" className="w-full text-left rounded-lg bg-slate-50 hover:bg-slate-100 p-2 text-sm" onClick={() => onOpenReport(d.meetingId)}>
                    <span className="font-semibold">{d.title}</span> <span className="text-xs text-slate-500">· {DECISION_STATUS[d.status]}{d.ceoFollowUp ? ' · following up' : ''}</span>
                    <span className="block text-xs text-slate-500">{d.decidedByName ?? '—'}{d.department ? ` · ${d.department}` : ''} · {d.meetingTitle} ({dateOnly(d.meetingStartsAt)})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Meeting reports" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900">Meeting reports</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Summary status" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Every status</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="PENDING">Pending</option>
              <option value="DRAFT">Draft</option>
              <option value="OVERDUE">Overdue</option>
              <option value="REVISION_REQUESTED">Clarification requested</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={attention} onChange={e => setAttention(e.target.checked)} className="rounded border-slate-300" /> Requires Managing Director attention</label>
          </div>
        </div>
        {!reports ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          : !reports.items.length ? <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-4 text-center">No team meetings match.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-[860px] w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 text-left">
                  <tr><th className="px-3 py-2">Meeting</th><th className="px-3 py-2">Department / team</th><th className="px-3 py-2">Responsible</th>
                    <th className="px-3 py-2 text-right">Attended</th><th className="px-3 py-2">Summary</th><th className="px-3 py-2 text-right">Decisions</th>
                    <th className="px-3 py-2 text-right">Actions</th><th className="px-3 py-2 text-right">Blockers</th><th className="px-3 py-2">Submitted</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody>
                  {reports.items.map(r => (
                    <tr key={r.meetingId} className="border-t border-slate-100">
                      <td className="px-3 py-2"><span className="font-semibold">{r.title}</span>{r.needsAttention && <Flag className="inline w-3.5 h-3.5 ml-1 text-rose-600" aria-label="Requires attention" />}
                        <span className="block text-xs text-slate-500">{when(r.startsAt, r.endsAt)}</span></td>
                      <td className="px-3 py-2">{r.department ?? '—'}{r.team ? <span className="block text-xs text-slate-500">{r.team}</span> : null}</td>
                      <td className="px-3 py-2">{r.owner ? <>{r.owner.name}<span className="block text-xs text-slate-500">{relabelRoles(r.owner.roleLabel)}</span></> : <span className="text-amber-700">Not set</span>}</td>
                      <td className="px-3 py-2 text-right">{r.awaitingAttendance ? '—' : r.attendees}</td>
                      <td className="px-3 py-2"><SummaryBadge status={r.status} overdue={r.overdue} awaitingAttendance={r.awaitingAttendance} /></td>
                      <td className="px-3 py-2 text-right">{r.revisionNo ? r.decisions : '—'}</td>
                      <td className="px-3 py-2 text-right">{r.revisionNo ? `${r.openActions}/${r.actions}` : '—'}</td>
                      <td className="px-3 py-2 text-right">{r.revisionNo ? r.blockers : '—'}</td>
                      <td className="px-3 py-2 text-xs">{r.submittedAt ? stamp(r.submittedAt) : '—'}</td>
                      <td className="px-3 py-2"><button type="button" className={`${btnGhost} whitespace-nowrap`} onClick={() => onOpenReport(r.meetingId)}>View Report</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {reports && reports.total > 25 && (
          <div className="flex gap-2 items-center text-sm">
            <button type="button" className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
            <span className="text-slate-500">{offset + 1}–{Math.min(offset + 25, reports.total)} of {reports.total}</span>
            <button type="button" className={btnGhost} disabled={offset + 25 >= reports.total} onClick={() => setOffset(offset + 25)}>Next</button>
          </div>
        )}
      </section>

      <section aria-label="Action items" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900">Action items</h3>
          <select aria-label="Action item status" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={actionStatus} onChange={e => setActionStatus(e.target.value as typeof actionStatus)}>
            <option value="OPEN">Open</option><option value="OVERDUE">Overdue</option><option value="DONE">Done</option><option value="ALL">All</option>
          </select>
        </div>
        {!actions?.items.length ? <p className="text-sm text-slate-500">No action items.</p> : (
          <ul className="space-y-1.5">
            {actions.items.map(a => (
              <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-sm flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{a.title}{a.decision && <span className="text-xs font-normal text-slate-500"> · for "{a.decision}"</span>}</p>
                  <p className="text-xs text-slate-500">{a.assigneeName ?? '—'} · {dueText(a.dueDate)} · {PRIORITY[a.priority]} · {a.meetingTitle}{a.department ? ` · ${a.department}` : ''}
                    {a.overdue && <span className="text-rose-700 font-semibold"> · overdue</span>}</p>
                </div>
                <span className={`text-xs rounded-full px-2 py-0.5 self-start sm:self-center ${ACTION_STATUS_CLS[a.status]}`}>{ACTION_STATUS[a.status]}</span>
                <button type="button" className={btnGhost} onClick={() => onOpenReport(a.meetingId)}>Report</button>
              </li>
            ))}
          </ul>
        )}
        {actions && actions.total > actions.items.length && <p className="text-xs text-slate-500">Showing {actions.items.length} of {actions.total}; narrow the filters to see the rest.</p>}
      </section>
    </div>
  );
};

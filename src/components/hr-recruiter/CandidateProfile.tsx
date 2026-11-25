import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import type { RecruiterApplicationDetail, RecruiterContext, RecruiterInterview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner, inputCls } from '../team-member/pipeline/shared';
import { CallDialog, CorrectionDialog, DecisionDialog, HoldDialog, InterviewDialog, InterviewResultDialog, InviteDialog } from './Dialogs';
import { CALL_OUTCOME_LABEL, CATEGORY_LABEL, Empty, MODE_LABEL, RESULT_LABEL, ROUND_LABEL, STAGE_LABEL, STEP_LABEL, StagePill, fmtDate, fmtDateTime, useLoad } from './ui';
import { confirmAction } from '../feedback/AppFeedback';

type Tab = 'details' | 'resume' | 'history' | 'calls' | 'assessment' | 'interviews' | 'notes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Candidate Details' }, { id: 'resume', label: 'Resume & Documents' }, { id: 'history', label: 'Application History' }, { id: 'calls', label: 'Call Details' },
  { id: 'assessment', label: 'Assessment Results' }, { id: 'interviews', label: 'Interviews' }, { id: 'notes', label: 'Recruiter Notes' }
];

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div><dt className="text-[11px] font-semibold text-slate-500">{label}</dt><dd className="text-sm text-slate-900 whitespace-pre-wrap break-words">{value || '–'}</dd></div>
);

/**
 * One application in full. Everything the candidate submitted (Candidate Details, Resume) is read-only and kept apart from what the recruiter
 * records (calls, notes, evaluations, interviews). The buttons only appear when the database says the action is allowed.
 */
export const CandidateProfile: React.FC<{ id: string; ctx: RecruiterContext; onBack: () => void; onChanged: () => void }> = ({ id, ctx, onBack, onChanged }) => {
  const { data: d, error, loading, reload } = useLoad<RecruiterApplicationDetail>(() => recruiterApi.application(id), [id]);
  const [tab, setTab] = useState<Tab>('details');
  const [dialog, setDialog] = useState<'call' | 'invite' | 'interview' | 'select' | 'reject' | 'correct' | 'hold' | null>(null);
  const [resultFor, setResultFor] = useState<RecruiterInterview | null>(null);
  const [reschedule, setReschedule] = useState<RecruiterInterview | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteKind, setNoteKind] = useState<'NOTE' | 'EVALUATION'>('NOTE');

  const done = () => { setDialog(null); setResultFor(null); setReschedule(null); reload(); onChanged(); };
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setActionError(null);
    try { await fn(); done(); } catch (e) { setActionError(errorMessage(e)); } finally { setBusy(false); }
  };
  const openResume = async (fileId: string) => {
    setActionError(null);
    try { window.open((await recruiterApi.resumeUrl(fileId)).url, '_blank', 'noopener,noreferrer'); } catch (e) { setActionError(errorMessage(e)); }
  };

  if (loading && !d) return <Spinner />;
  if (error || !d) return <div className="space-y-3"><button type="button" className={btn.secondary} onClick={onBack}>Back to applications</button><ErrorBanner message={error ?? 'Application not found.'} onRetry={reload} /></div>;
  const s = d.summary;
  const closed = s.stage === 'SELECTED' || s.stage === 'REJECTED' || s.stage === 'WITHDRAWN';
  const pendingCall = d.calls.find(c => !c.calledAt);
  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    void act(async () => { await recruiterApi.addNote(id, noteKind, note.trim()); setNote(''); });
  };

  return (
    <div className="space-y-4">
      <button type="button" className={btn.secondary} onClick={onBack}>← All applications</button>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{d.submitted.name}</h2>
            <p className="text-xs text-slate-500">{d.vacancy.title}{d.vacancy.department ? ` · ${d.vacancy.department}` : ''} · applied {fmtDate(d.submitted.appliedAt)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{[s.email, s.phone].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5"><StagePill stage={s.stage} />{s.recruiter && <span className="text-[11px] text-slate-500">Recruiter: {s.recruiter}</span>}</div>
        </div>
        {!closed && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Actions">
            {s.status === 'SUBMITTED' && <button type="button" className={btn.primary} disabled={busy} onClick={() => void act(() => recruiterApi.stage(id, 'SCREEN'))}>Start screening</button>}
            <button type="button" className={btn.secondary} onClick={() => setDialog('call')}>{pendingCall ? 'Record call' : 'Call'}</button>
            <button type="button" className={btn.secondary} onClick={() => setDialog('invite')}>Invite to test</button>
            <button type="button" className={btn.secondary} onClick={() => { setReschedule(null); setDialog('interview'); }}>Schedule interview</button>
            {!d.review.selectionReview ? <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act(() => recruiterApi.stage(id, 'REQUEST_REVIEW'))}>Ready for selection decision</button>
              : <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act(() => recruiterApi.stage(id, 'CLEAR_REVIEW'))}>Not ready yet</button>}
            {s.stage === 'ON_HOLD' ? <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act(() => recruiterApi.stage(id, 'RESUME'))}>Resume</button>
              : <button type="button" className={btn.secondary} disabled={busy} onClick={() => setDialog('hold')}>Put on hold</button>}
            {d.can.decide && <>
              <button type="button" className={btn.green} onClick={() => setDialog('select')}>Select</button>
              <button type="button" className={btn.danger} onClick={() => setDialog('reject')}>Reject</button>
            </>}
          </div>
        )}
        {closed && d.can.current && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className={`text-sm font-semibold ${d.can.current === 'SELECTED' ? 'text-emerald-700' : 'text-rose-700'}`}>Decision recorded: {d.can.current === 'SELECTED' ? 'Selected' : 'Rejected'}</p>
            {d.can.correct && <button type="button" className={btn.danger} onClick={() => setDialog('correct')}>Correct decision</button>}
          </div>
        )}
        {d.review.missingSteps.length > 0 && !closed && <p className="mt-3 text-[11px] text-amber-800">Before a selection this vacancy needs {d.review.missingSteps.map(m => STEP_LABEL[m] ?? m).join(', ')}.</p>}
        {actionError && <div className="mt-3"><ErrorBanner message={actionError} /></div>}
      </Card>

      <div role="tablist" aria-label="Candidate profile" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls="profile-panel" onClick={() => setTab(t.id)}
            className={`px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap -mb-px border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-t-lg ${tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</button>
        ))}
      </div>
      <Card className="p-5"><div id="profile-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'details' && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">Submitted by the candidate in the career portal. This information cannot be edited here.</p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Row label="Name" value={d.submitted.name} /><Row label="E-mail" value={d.submitted.email} /><Row label="Phone" value={d.submitted.phone} />
              <Row label="City" value={d.submitted.city} /><Row label="State" value={d.submitted.state} /><Row label="Education" value={d.submitted.education} />
              <Row label="Experience" value={d.submitted.experience} /><Row label="Skills" value={d.submitted.skills} /><Row label="Application ID" value={<code className="text-xs">{d.submitted.applicationId}</code>} />
              <div className="sm:col-span-2 lg:col-span-3"><Row label="About the candidate" value={d.submitted.bio} /></div>
              <div className="sm:col-span-2 lg:col-span-3"><Row label="Message with the application" value={d.submitted.candidateMessage} /></div>
            </dl>
          </div>
        )}
        {tab === 'resume' && (
          <div className="space-y-4">
            {d.submitted.resume ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <span className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />{d.submitted.resume.fileName}<span className="text-[11px] text-slate-500">({Math.max(1, Math.round(d.submitted.resume.sizeBytes / 1024))} KB)</span></span>
                <button type="button" className={btn.primary} onClick={() => void openResume(d.submitted.resume!.id)}>Open resume</button>
              </div>
            ) : <Empty title="No resume on this application" />}
            <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Documents</h3>
              {d.documents.length === 0 ? <p className="text-xs text-slate-500">No joining documents have been requested for this candidate.</p> : <ul className="space-y-1 text-sm">{d.documents.map(x => <li key={x.id} className="flex justify-between"><span>{x.title}</span><span className="text-xs text-slate-500">{x.status}</span></li>)}</ul>}
            </div>
          </div>
        )}
        {tab === 'history' && (
          d.history.length === 0 ? <Empty title="No history yet" /> : (
            <ol className="space-y-3">{d.history.map((h, i) => (
              <li key={i} className="border-l-2 border-indigo-200 pl-3">
                <p className="text-sm font-semibold text-slate-900">{h.previous ? <>{STAGE_LABEL[h.previous as keyof typeof STAGE_LABEL] ?? h.previous} → </> : null}{STAGE_LABEL[h.new as keyof typeof STAGE_LABEL] ?? h.new.replace(/^CAREER_/, '').replace(/_/g, ' ').toLowerCase()}</p>
                <p className="text-[11px] text-slate-500">{fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}</p>
                {h.comment && <p className="text-xs text-slate-700 mt-0.5">{h.comment}</p>}
              </li>
            ))}</ol>
          )
        )}
        {tab === 'calls' && (
          <div className="space-y-3">
            <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={() => setDialog('call')} disabled={closed}>{pendingCall ? 'Record the scheduled call' : 'Add a call'}</button></div>
            {d.calls.length === 0 ? <Empty title="No calls yet" /> : <ul className="divide-y divide-slate-100">{d.calls.map(c => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="font-semibold">{c.calledAt ? `${fmtDateTime(c.calledAt)} · ${CALL_OUTCOME_LABEL[c.outcome ?? ''] ?? c.outcome}` : `Scheduled for ${fmtDateTime(c.scheduledAt)}`}</p>
                <p className="text-[11px] text-slate-500">{c.recruiter ?? ''}{c.followUpDate ? ` · follow up ${fmtDate(c.followUpDate)}` : ''}</p>{c.note && <p className="text-xs text-slate-700 mt-0.5">{c.note}</p>}
              </li>))}</ul>}
          </div>
        )}
        {tab === 'assessment' && (
          d.assessments.length === 0 ? <Empty title="No assessment yet" hint="Use “Invite to test” to send the candidate an assessment." /> : (
            <ul className="divide-y divide-slate-100">{d.assessments.map(a => (
              <li key={a.id} className="py-2.5 text-sm flex flex-wrap justify-between gap-2">
                <span><span className="font-semibold">{a.title}</span><span className="block text-[11px] text-slate-500">{a.status === 'COMPLETED' ? `Completed ${fmtDateTime(a.completedAt)}` : a.status === 'IN_PROGRESS' ? 'In progress' : `Invited · available until ${fmtDateTime(a.invitedUntil)}`}</span></span>
                <span className="text-right">{a.status === 'COMPLETED' ? <><span className="font-bold tabular-nums">{a.score}</span><span className={`block text-[11px] font-semibold ${a.passed ? 'text-emerald-700' : 'text-rose-700'}`}>{a.passed ? 'Passed' : 'Not passed'} (pass mark {a.passPercent}%)</span></> : <span className="text-xs text-slate-500">Pending</span>}</span>
              </li>))}</ul>
          )
        )}
        {tab === 'interviews' && (
          <div className="space-y-3">
            <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={() => { setReschedule(null); setDialog('interview'); }} disabled={closed}>Schedule interview</button></div>
            {d.interviews.length === 0 ? <Empty title="No interviews yet" /> : <ul className="divide-y divide-slate-100">{d.interviews.map(i => (
              <li key={i.id} className="py-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{ROUND_LABEL[i.round]} · {fmtDateTime(i.scheduledAt)}</p><span className="text-[11px] font-semibold text-slate-600">{i.status === 'SCHEDULED' ? (i.confirmedAt ? 'Confirmed' : 'Scheduled') : i.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}</span></div>
                <p className="text-[11px] text-slate-500">{[i.mode ? MODE_LABEL[i.mode] : null, i.location, i.interviewer, i.bookedBy === 'CANDIDATE' ? 'Booked by the candidate' : null].filter(Boolean).join(' · ')}</p>
                {i.result && <p className="text-xs"><b>Result:</b> {RESULT_LABEL[i.result] ?? i.result}{i.feedback ? ` — ${i.feedback}` : ''}</p>}
                {i.status === 'SCHEDULED' && !closed && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!i.confirmedAt && <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act(() => recruiterApi.saveInterview(id, { action: 'CONFIRM', id: i.id, version: i.version }))}>Confirm</button>}
                    <button type="button" className={btn.secondary} onClick={() => { setReschedule(i); setDialog('interview'); }}>Reschedule</button>
                    <button type="button" className={btn.secondary} onClick={() => setResultFor(i)}>Complete</button>
                    <button type="button" className={btn.danger} disabled={busy} onClick={async () => { if (await confirmAction({ title: 'Cancel this interview?', description: 'The interview is cancelled for the candidate and the interviewers.', confirmLabel: 'Cancel interview', cancelLabel: 'Keep interview', variant: 'destructive' })) void act(() => recruiterApi.saveInterview(id, { action: 'CANCEL', id: i.id, version: i.version })); }}>Cancel</button>
                  </div>
                )}
              </li>))}</ul>}
          </div>
        )}
        {tab === 'notes' && (
          <div className="space-y-4">
            <p className="text-[11px] text-slate-500">Internal notes and evaluations. The candidate never sees them and they never change the candidate's submitted data.</p>
            <form onSubmit={addNote} className="space-y-2">
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="note-kind">Type</label>
                <select id="note-kind" className={`${inputCls} !w-auto`} value={noteKind} onChange={e => setNoteKind(e.target.value as 'NOTE' | 'EVALUATION')}><option value="NOTE">Note</option><option value="EVALUATION">Evaluation</option></select>
              </div>
              <label className="sr-only" htmlFor="note-body">Write a note</label>
              <textarea id="note-body" className={`${inputCls} min-h-24`} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Write a note or evaluation" />
              <div className="flex justify-end"><button type="submit" className={btn.primary} disabled={busy || !note.trim()}>Add</button></div>
            </form>
            {d.notes.length === 0 ? <Empty title="No notes yet" /> : <ul className="space-y-3">{d.notes.map(n => (
              <li key={n.id} className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">{n.kind === 'EVALUATION' ? 'Evaluation' : 'Note'} · {n.author ?? 'Recruiter'} · {fmtDateTime(n.at)}</p><p className="text-sm whitespace-pre-wrap mt-1">{n.body}</p></li>))}</ul>}
            {d.decisions.length > 0 && (
              <div><h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Decision history</h3>
                <ul className="space-y-2">{d.decisions.map(x => (
                  <li key={x.id} className={`rounded-xl border p-3 text-sm ${x.current ? 'border-slate-300 bg-slate-50' : 'border-slate-200 opacity-75'}`}>
                    <p className="font-semibold">{x.decision === 'SELECTED' ? 'Selected' : 'Rejected'}{x.current ? '' : ' (superseded)'} <span className="font-normal text-slate-500">· {fmtDateTime(x.at)}{x.by ? ` · ${x.by}` : ''}</span></p>
                    {x.category && <p className="text-xs text-slate-600">{CATEGORY_LABEL[x.category] ?? x.category}</p>}{x.reason && <p className="text-xs text-slate-700">{x.reason}</p>}
                    {x.correctionReason && <p className="text-xs text-slate-700"><b>Correction:</b> {x.correctionReason}</p>}
                  </li>))}</ul></div>
            )}
          </div>
        )}
      </div></Card>

      {dialog === 'call' && <CallDialog applicationId={id} pendingCallId={pendingCall?.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'hold' && <HoldDialog applicationId={id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'invite' && <InviteDialog applicationId={id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'interview' && <InterviewDialog applicationId={id} reschedule={reschedule ?? undefined} onClose={() => { setDialog(null); setReschedule(null); }} onDone={done} />}
      {resultFor && <InterviewResultDialog applicationId={id} interview={resultFor} onClose={() => setResultFor(null)} onDone={done} />}
      {(dialog === 'select' || dialog === 'reject') && (
        <DecisionDialog applicationId={id} candidate={d.submitted.name} vacancy={d.vacancy.title} decision={dialog === 'select' ? 'SELECTED' : 'REJECTED'} remaining={d.review.remaining}
          missingSteps={d.review.missingSteps.map(m => STEP_LABEL[m] ?? m)} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'correct' && d.can.current && <CorrectionDialog applicationId={id} current={d.can.current} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
};

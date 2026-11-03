import React, { useState } from 'react';
import type { RecruiterInterview } from '../../../shared/contracts';
import { CALL_OUTCOMES, INTERVIEW_MODES, INTERVIEW_ROUNDS, INTERVIEW_RESULTS, REJECTION_CATEGORIES, recruiterCallSchema, recruiterDecisionSchema, recruiterInterviewSchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, ErrorBanner, inputCls, selectCls } from '../team-member/pipeline/shared';
import { CALL_OUTCOME_LABEL, CATEGORY_LABEL, Field, MODE_LABEL, Modal, RESULT_LABEL, ROUND_LABEL, localToIso, useLoad } from './ui';

/** The small forms of the recruiter workspace. Each validates with the same Zod schema the server uses; the database checks again. */
const Footer: React.FC<{ error: string | null; saving: boolean; onClose: () => void; label: string; tone?: 'primary' | 'green' | 'danger' }> = ({ error, saving, onClose, label, tone = 'primary' }) => (
  <>
    {error && <ErrorBanner message={error} />}
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" className={btn.secondary} onClick={onClose}>Cancel</button>
      <button type="submit" className={tone === 'green' ? btn.green : tone === 'danger' ? btn.danger : btn.primary} disabled={saving}>{saving ? 'Saving…' : label}</button>
    </div>
  </>
);

function useSubmit(onDone: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    if (saving) return; // a double click sends once
    setSaving(true); setError(null);
    try { await fn(); onDone(); } catch (e) { setError(errorMessage(e)); setSaving(false); }
  };
  return { saving, error, setError, run };
}

export const CallDialog: React.FC<{ applicationId: string; pendingCallId?: string; onClose: () => void; onDone: () => void }> = ({ applicationId, pendingCallId, onClose, onDone }) => {
  const [mode, setMode] = useState<'RECORD' | 'SCHEDULE'>(pendingCallId ? 'RECORD' : 'RECORD');
  const [when, setWhen] = useState('');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [follow, setFollow] = useState('');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = mode === 'SCHEDULE'
      ? { action: 'SCHEDULE', scheduledAt: localToIso(when), note: note || undefined }
      : { action: 'RECORD', callId: pendingCallId, outcome: outcome || undefined, note: note || undefined, followUpDate: follow || undefined };
    const parsed = recruiterCallSchema.safeParse(body);
    if (!parsed.success) return s.setError(parsed.error.issues[0]?.message ?? 'Check the form.');
    void s.run(() => recruiterApi.saveCall(applicationId, parsed.data));
  };
  return (
    <Modal title={mode === 'SCHEDULE' ? 'Schedule a call' : 'Record a call'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {!pendingCallId && (
          <div role="radiogroup" aria-label="What to do" className="flex gap-2">
            {(['RECORD', 'SCHEDULE'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === m ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>{m === 'RECORD' ? 'Record a call made' : 'Schedule a call'}</button>
            ))}
          </div>
        )}
        {mode === 'SCHEDULE' ? (
          <Field label="Date and time">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} required />}</Field>
        ) : (
          <>
            <Field label="Call outcome" hint="A call is completed only with its outcome.">
              {id => <select id={id} className={selectCls} value={outcome} onChange={e => setOutcome(e.target.value)} required><option value="">Choose the outcome</option>{CALL_OUTCOMES.map(o => <option key={o} value={o}>{CALL_OUTCOME_LABEL[o]}</option>)}</select>}
            </Field>
            {(outcome === 'CALL_BACK' || outcome === 'NO_ANSWER' || outcome === 'UNREACHABLE') && (
              <Field label={outcome === 'CALL_BACK' ? 'Follow-up date (required)' : 'Follow-up date (optional)'}>{id => <input id={id} type="date" className={inputCls} value={follow} onChange={e => setFollow(e.target.value)} required={outcome === 'CALL_BACK'} />}</Field>
            )}
          </>
        )}
        <Field label="Notes (optional)">{id => <textarea id={id} className={`${inputCls} min-h-20`} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label={mode === 'SCHEDULE' ? 'Schedule call' : 'Save call'} />
      </form>
    </Modal>
  );
};

export const InterviewDialog: React.FC<{ applicationId: string; reschedule?: RecruiterInterview; onClose: () => void; onDone: () => void }> = ({ applicationId, reschedule, onClose, onDone }) => {
  const [round, setRound] = useState<string>(reschedule?.round ?? 'HR');
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState(reschedule?.location ?? '');
  const [mode, setMode] = useState(reschedule?.mode ?? '');
  const [interviewer, setInterviewer] = useState(reschedule?.interviewer ?? '');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = recruiterInterviewSchema.safeParse({
      action: reschedule ? 'RESCHEDULE' : 'SCHEDULE', id: reschedule?.id, round, scheduledAt: localToIso(when), location, mode: mode || undefined, interviewer: interviewer || undefined
    });
    if (!parsed.success) return s.setError(parsed.error.issues[0]?.message ?? 'Check the form.');
    void s.run(() => recruiterApi.saveInterview(applicationId, parsed.data));
  };
  return (
    <Modal title={reschedule ? 'Reschedule interview' : 'Schedule interview'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Round">{id => <select id={id} className={selectCls} value={round} onChange={e => setRound(e.target.value)}>{INTERVIEW_ROUNDS.map(r => <option key={r} value={r}>{ROUND_LABEL[r]}</option>)}</select>}</Field>
        <Field label="Date and time">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} required />}</Field>
        <Field label="Mode">{id => <select id={id} className={selectCls} value={mode} onChange={e => setMode(e.target.value)}><option value="">Not specified</option>{INTERVIEW_MODES.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>}</Field>
        <Field label="Location or meeting details">{id => <input id={id} className={inputCls} value={location} onChange={e => setLocation(e.target.value)} maxLength={1000} required placeholder="Office, room, or video link" />}</Field>
        <Field label="Interviewer">{id => <input id={id} className={inputCls} value={interviewer} onChange={e => setInterviewer(e.target.value)} maxLength={120} />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label={reschedule ? 'Reschedule' : 'Schedule interview'} />
      </form>
    </Modal>
  );
};

export const InterviewResultDialog: React.FC<{ applicationId: string; interview: RecruiterInterview; onClose: () => void; onDone: () => void }> = ({ applicationId, interview, onClose, onDone }) => {
  const [result, setResult] = useState('');
  const [feedback, setFeedback] = useState('');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = recruiterInterviewSchema.safeParse({ action: 'COMPLETE', id: interview.id, version: interview.version, result: result || undefined, feedback: feedback || undefined });
    if (!parsed.success) return s.setError(parsed.error.issues[0]?.message ?? 'Check the form.');
    void s.run(() => recruiterApi.saveInterview(applicationId, parsed.data));
  };
  return (
    <Modal title={`Complete ${ROUND_LABEL[interview.round] ?? 'interview'}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Interview result">{id => <select id={id} className={selectCls} value={result} onChange={e => setResult(e.target.value)} required><option value="">Choose the result</option>{INTERVIEW_RESULTS.map(r => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}</select>}</Field>
        <Field label="Feedback">{id => <textarea id={id} className={`${inputCls} min-h-28`} value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={3000} />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label="Complete interview" />
      </form>
    </Modal>
  );
};

export const InviteDialog: React.FC<{ applicationId: string; onClose: () => void; onDone: () => void }> = ({ applicationId, onClose, onDone }) => {
  const tests = useLoad(() => recruiterApi.tests(), []);
  const [testId, setTestId] = useState('');
  const [until, setUntil] = useState('');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testId || !until) return s.setError('Choose the test and the last date to take it.');
    void s.run(() => recruiterApi.invite(applicationId, testId, localToIso(until)));
  };
  return (
    <Modal title="Invite to an assessment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {tests.error && <ErrorBanner message={tests.error} />}
        <Field label="Test" hint={tests.data && tests.data.length === 0 ? 'No tests exist yet. HR creates tests in Recruitment Management.' : undefined}>
          {id => <select id={id} className={selectCls} value={testId} onChange={e => setTestId(e.target.value)} required><option value="">Choose a test</option>{(tests.data ?? []).map(t => <option key={t.id} value={t.id}>{t.title} · {t.durationMinutes} min · pass {t.passPercent}%</option>)}</select>}
        </Field>
        <Field label="Available until">{id => <input id={id} type="datetime-local" className={inputCls} value={until} onChange={e => setUntil(e.target.value)} required />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label="Send invitation" />
      </form>
    </Modal>
  );
};

/** Selection / Rejection. The confirmation names the consequence for the application; the decision is final until HR leadership corrects it. */
export const DecisionDialog: React.FC<{ applicationId: string; candidate: string; vacancy: string; decision: 'SELECTED' | 'REJECTED'; remaining: number; missingSteps: string[]; onClose: () => void; onDone: () => void }> = ({ applicationId, candidate, vacancy, decision, remaining, missingSteps, onClose, onDone }) => {
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const s = useSubmit(onDone);
  const selecting = decision === 'SELECTED';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = recruiterDecisionSchema.safeParse({ decision, category: category || undefined, reason: reason || undefined });
    if (!parsed.success) return s.setError(parsed.error.issues[0]?.message ?? 'Check the form.');
    void s.run(() => recruiterApi.decide(applicationId, parsed.data));
  };
  return (
    <Modal title={selecting ? `Select ${candidate}` : `Reject ${candidate}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-700">
          {selecting ? <>You are selecting <b>{candidate}</b> for <b>{vacancy}</b>. {remaining} position{remaining === 1 ? '' : 's'} remain{remaining === 1 ? 's' : ''} for this vacancy.</> : <>You are rejecting <b>{candidate}</b>'s application for <b>{vacancy}</b>. Applications to other vacancies are not affected.</>}
        </p>
        <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">This is a final decision for this application. Only HR leadership can correct it afterwards, with a reason.</p>
        {selecting && missingSteps.length > 0 && <p role="alert" className="text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">This vacancy still needs {missingSteps.join(', ')} before a selection.</p>}
        {!selecting && (
          <>
            <Field label="Rejection category">{id => <select id={id} className={selectCls} value={category} onChange={e => setCategory(e.target.value)}><option value="">Choose a category</option>{REJECTION_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>}</Field>
            <Field label="Reason (internal)" hint="Kept in the application history. Choose a category, or write the reason.">{id => <textarea id={id} className={`${inputCls} min-h-20`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />}</Field>
          </>
        )}
        <Footer error={s.error} saving={s.saving} onClose={onClose} label={selecting ? 'Confirm selection' : 'Confirm rejection'} tone={selecting ? 'green' : 'danger'} />
      </form>
    </Modal>
  );
};

export const CorrectionDialog: React.FC<{ applicationId: string; current: 'SELECTED' | 'REJECTED'; onClose: () => void; onDone: () => void }> = ({ applicationId, current, onClose, onDone }) => {
  const next = current === 'SELECTED' ? 'REJECTED' : 'SELECTED';
  const [reason, setReason] = useState('');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return s.setError('Write why the decision is corrected (at least 5 characters).');
    void s.run(() => recruiterApi.correct(applicationId, { decision: next, reason: reason.trim() }));
  };
  return (
    <Modal title="Correct the decision" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-700">The recorded decision is <b>{current === 'SELECTED' ? 'Selected' : 'Rejected'}</b>. You are changing it to <b>{next === 'SELECTED' ? 'Selected' : 'Rejected'}</b>. The earlier decision stays in the history.</p>
        <Field label="Reason for the correction">{id => <textarea id={id} className={`${inputCls} min-h-24`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label="Record correction" tone="danger" />
      </form>
    </Modal>
  );
};

export const HoldDialog: React.FC<{ applicationId: string; onClose: () => void; onDone: () => void }> = ({ applicationId, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const s = useSubmit(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return s.setError('Write the reason for putting the application on hold.');
    void s.run(() => recruiterApi.stage(applicationId, 'HOLD', reason.trim()));
  };
  return (
    <Modal title="Put the application on hold" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Reason">{id => <textarea id={id} className={`${inputCls} min-h-20`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required />}</Field>
        <Footer error={s.error} saving={s.saving} onClose={onClose} label="Put on hold" />
      </form>
    </Modal>
  );
};

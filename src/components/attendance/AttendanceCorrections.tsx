import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { BottomSheet } from '../common/BottomSheet';
import {
  attendanceApi, CORRECTION_KIND_LABEL, istClock, istLongDate, istToday, newPunchRequestId, shiftDate,
  type AttendanceCorrection, type CorrectionKind
} from '../../lib/attendance';

/**
 * Attendance corrections (Task 02, migration 20270205000200): the employee asks, never edits. HR, the Managing Director, or the CEO /
 * Department Head in charge of the employee decide; approving applies the correction in the database, which keeps the original record,
 * the change, who decided, when and why.
 */
const STATUS_TONE: Record<AttendanceCorrection['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-800', APPROVED: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-700', CANCELLED: 'bg-slate-100 text-slate-600'
};
const btn = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold disabled:opacity-50';
const field = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm';

const describe = (c: AttendanceCorrection) =>
  c.kind === 'RESUME_DAY' ? 'Set aside the Punch Out and resume the day'
    : c.kind === 'SET_PUNCH_OUT' ? `Punch Out at ${c.requestedTime}` : `Punch In at ${c.requestedTime}`;

export const CorrectionRequestForm: React.FC<{ date?: string; kind?: CorrectionKind; onClose: () => void; onSent: (c: AttendanceCorrection) => void }> = ({
  date: initialDate, kind: initialKind, onClose, onSent
}) => {
  const today = istToday();
  const [date, setDate] = useState(initialDate ?? today);
  const [kind, setKind] = useState<CorrectionKind>(initialKind ?? 'SET_PUNCH_OUT');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one request id per form: a second press or a retry is the same request
  const [request] = useState(newPunchRequestId);
  const needsTime = kind !== 'RESUME_DAY';
  const valid = reason.trim().length >= 5 && (!needsTime || !!time) && !!date;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onSent(await attendanceApi.requestCorrection({ date, kind, time: needsTime ? time : null, reason: reason.trim(), details: details.trim() || null }, request));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet title="Request an attendance correction" subtitle="Your manager or HR decides. Your attendance is not changed until it is approved."
      onClose={onClose} dismissible={!busy} size="sm" testId="correction-form"
      footer={<>
        <button type="button" className={`${btn} border border-slate-200 bg-white text-slate-700`} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`} onClick={() => void send()} disabled={busy || !valid} data-testid="send-correction">
          {busy ? 'Sending…' : 'Send request'}</button>
      </>}>
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-slate-600">Day
          <input type="date" className={`${field} mt-1`} value={date} max={today} min={shiftDate(today, -30)} onChange={e => setDate(e.target.value)} /></label>
        <label className="block text-xs font-semibold text-slate-600">What should be corrected
          <select className={`${field} mt-1`} value={kind} onChange={e => setKind(e.target.value as CorrectionKind)}>
            {(Object.keys(CORRECTION_KIND_LABEL) as CorrectionKind[]).map(k => <option key={k} value={k}>{CORRECTION_KIND_LABEL[k]}</option>)}
          </select></label>
        {needsTime ? <label className="block text-xs font-semibold text-slate-600">Correct time (IST)
          <input type="time" className={`${field} mt-1`} value={time} onChange={e => setTime(e.target.value)} required /></label> : null}
        <label className="block text-xs font-semibold text-slate-600">Reason (required)
          <textarea rows={3} maxLength={1000} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="What happened" /></label>
        <label className="block text-xs font-semibold text-slate-600">Supporting information (optional)
          <textarea rows={2} maxLength={2000} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={details} onChange={e => setDetails(e.target.value)}
            placeholder="e.g. who saw you at the office" /></label>
        {error ? <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">{error}</p> : null}
      </div>
    </BottomSheet>
  );
};

const CorrectionItem: React.FC<{ c: AttendanceCorrection; mine: boolean; onChanged: () => void }> = ({ c, mine, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <li className="px-4 py-3 text-sm" data-testid="correction-item">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{mine ? istLongDate(c.date) : `${c.employee} · ${istLongDate(c.date)}`}</p>
          <p className="text-slate-600">{describe(c)}</p>
          <p className="text-xs text-slate-500">Reason: {c.reason}{c.details ? ` · ${c.details}` : ''}</p>
          <p className="text-xs text-slate-500">Recorded: Punch In {istClock(c.original.punchInAt)} · Punch Out {istClock(c.original.punchOutAt)}</p>
          {c.decidedAt ? <p className="text-xs text-slate-500">{c.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {c.decidedBy ?? '-'}{c.decisionNote ? `: ${c.decisionNote}` : ''}</p> : null}
        </div>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.status]}`}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</span>
      </div>
      {c.canDecide && !rejecting ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={busy} onClick={() => void act(() => attendanceApi.decideCorrection(c.id, true, null))} data-testid="approve-correction">
            <Check className="h-4 w-4" aria-hidden="true" /> Approve</button>
          <button type="button" className={`${btn} border border-slate-200 bg-white text-rose-700`} disabled={busy} onClick={() => setRejecting(true)}>
            <X className="h-4 w-4" aria-hidden="true" /> Reject</button>
        </div>
      ) : null}
      {rejecting ? (
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-semibold text-slate-600">Reason for rejecting (the employee sees it)
            <input className={`${field} mt-1`} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></label>
          <div className="flex gap-2">
            <button type="button" className={`${btn} bg-rose-600 text-white`} disabled={busy || note.trim().length < 3} onClick={() => void act(() => attendanceApi.decideCorrection(c.id, false, note.trim()))}>Reject</button>
            <button type="button" className={`${btn} border border-slate-200 bg-white text-slate-700`} onClick={() => setRejecting(false)}>Back</button>
          </div>
        </div>
      ) : null}
      {c.canCancel ? <button type="button" className="mt-2 text-xs font-semibold text-slate-600 hover:underline" disabled={busy} onClick={() => void act(() => attendanceApi.cancelCorrection(c.id))}>Withdraw request</button> : null}
      {error ? <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}
    </li>
  );
};

/** Attendance → Corrections: my requests, and (for managers and HR) the requests waiting for my decision. */
export const AttendanceCorrections: React.FC<{ canDecide: boolean }> = ({ canDecide }) => {
  const [mine, setMine] = useState<AttendanceCorrection[] | null>(null);
  const [decide, setDecide] = useState<AttendanceCorrection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const load = useCallback(() => {
    attendanceApi.corrections('MINE').then(r => setMine(r.items), e => setError(e instanceof Error ? e.message : String(e)));
    if (canDecide) attendanceApi.corrections('DECIDE').then(r => setDecide(r.items), () => setDecide([]));
  }, [canDecide]);
  useEffect(load, [load]);
  const section = 'rounded-xl border border-slate-200 bg-white';
  return (
    <div className="space-y-4" data-testid="attendance-corrections">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Punched out by mistake, or missed a punch? Ask for a correction; nobody can change attendance directly.</p>
        <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`} onClick={() => { setSent(null); setForm(true); }} data-testid="new-correction">
          <Plus className="h-4 w-4" aria-hidden="true" /> Request a correction</button>
      </div>
      {sent ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{sent}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {canDecide ? (
        <section className={section} aria-label="Waiting for my decision">
          <h3 className="px-4 pt-3 text-sm font-semibold text-slate-900">Waiting for my decision</h3>
          {decide === null ? <p className="px-4 py-3 text-xs text-slate-500" role="status">Loading…</p>
            : !decide.length ? <p className="px-4 py-3 text-sm text-slate-500">Nothing to decide.</p>
              : <ul className="divide-y divide-slate-100">{decide.map(c => <CorrectionItem key={c.id} c={c} mine={false} onChanged={load} />)}</ul>}
        </section>
      ) : null}
      <section className={section} aria-label="My correction requests">
        <h3 className="px-4 pt-3 text-sm font-semibold text-slate-900">My requests</h3>
        {mine === null ? <p className="px-4 py-3 text-xs text-slate-500" role="status">Loading…</p>
          : !mine.length ? <p className="px-4 py-3 text-sm text-slate-500">You have not asked for a correction.</p>
            : <ul className="divide-y divide-slate-100">{mine.map(c => <CorrectionItem key={c.id} c={c} mine onChanged={load} />)}</ul>}
      </section>
      {form ? <CorrectionRequestForm onClose={() => setForm(false)} onSent={() => { setForm(false); setSent('Correction requested. You are told when it is decided.'); load(); }} /> : null}
    </div>
  );
};

export default AttendanceCorrections;

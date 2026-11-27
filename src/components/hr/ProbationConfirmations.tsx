import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, ClipboardCheck, Mail, RotateCcw, XCircle } from 'lucide-react';
import { hrApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { fmtDay } from '../../lib/support';
import type { HrProbationCycle } from '../../../shared/contracts';
import { btn, Card, ErrorBanner, inputCls, Pill, Spinner } from '../team-member/pipeline/shared';
import { HrPageHeader } from './hrUi';

/**
 * HR dashboard > Probation Confirmations. The approval step of the six-month confirmation: HR (the HR lead, or the department's own HR), the
 * employee's Department Head or the Super Admin confirms or closes it (the database decides who may, and which departments each person sees).
 *
 * Confirm starts the existing confirmation process: the database records the decision and queues the confirmation e-mails, the server sends them at
 * once, and the employee becomes Confirmed ONLY when their confirmation e-mail is recorded as sent. Until then the record stays in the list (and stays
 * overdue when the end date has passed) with the e-mail's status and a Retry button. A retry reuses the same e-mail, so nobody gets it twice.
 * The birthday / anniversary / reminder e-mails still run on the server by themselves every morning at 9:00 AM India time.
 */
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
// servers without migration 20270223000100 send no `overdue`: derive it the same way
const isOverdue = (c: HrProbationCycle) => c.overdue ?? ((c.status === 'PENDING' || c.status === 'CONFIRMING') && c.daysLeft < 0);
const emailFailed = (c: HrProbationCycle) => !!c.email && (c.email.status === 'FAILED' || c.email.status === 'SKIPPED' || c.email.status === 'DRY_RUN');
const scheduledLater = (c: HrProbationCycle) => !!c.email && c.email.status === 'PENDING' && new Date(c.email.sendAfter).getTime() > Date.now();

/** What to tell HR after Confirm / Retry, from the cycle the server read back (never from the click alone). */
function outcomeOf(c: HrProbationCycle): { ok: boolean; text: string } {
  if (c.status === 'APPROVED') return { ok: true, text: `${c.employeeName} is confirmed. The confirmation e-mail was sent${c.email?.sentAt ? ` (${when(c.email.sentAt)})` : ''}.` };
  if (scheduledLater(c)) return { ok: true, text: `${c.employeeName}'s confirmation is approved. The confirmation e-mail goes out on ${fmtDay(c.probationEnd)}, and they are marked Confirmed once it is sent.` };
  const reason = c.email?.error || c.notice;
  return { ok: false, text: `${c.employeeName} is NOT confirmed yet: the confirmation e-mail was not sent${reason ? ` (${reason})` : ''}. The record stays in the list; retry the e-mail.` };
}

export const ProbationConfirmations: React.FC = () => {
  const [cycles, setCycles] = useState<HrProbationCycle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'overdue'>('all');

  const load = useCallback(
    () => hrApi.probation().then(c => setCycles(c), e => { setCycles(prev => prev ?? []); setError(errText(e, 'Could not load the probation confirmations.')); }),
    []
  );
  useEffect(() => { void load(); }, [load]);

  /** Runs one action for one record (its buttons are disabled meanwhile, so a double click sends nothing twice), then reloads the list and counts. */
  const act: Act = async (key, fn, done) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      const msg = typeof done === 'function' ? done(result) : { ok: true, text: done };
      if (msg.ok) setNotice(msg.text); else setError(msg.text);
      await load();
      return true;
    } catch (e) {
      setError(errText(e, 'That did not work. Please try again.'));
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const list = cycles ?? [];
    return {
      overdue: list.filter(isOverdue).length,
      due: list.filter(c => c.status === 'PENDING' && c.daysLeft >= 0 && c.daysLeft <= 7).length,
      awaitingEmail: list.filter(c => c.status === 'CONFIRMING').length,
      confirmed: list.filter(c => c.status === 'APPROVED').length
    };
  }, [cycles]);
  const shown = useMemo(() => (cycles ? (filter === 'overdue' ? cycles.filter(isOverdue) : cycles) : null), [cycles, filter]);

  return (
    <section className="space-y-5" aria-label="Probation confirmations">
      <HrPageHeader as="h2" icon={ClipboardCheck} title="Probation Confirmations"
        subtitle="Employees whose six-month probation is ending. Nobody is confirmed automatically, and nobody is confirmed before the confirmation e-mail is sent." />
      {cycles && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="probation-counts">
          <Count label="Overdue" value={counts.overdue} tone="text-rose-700" testId="probation-count-overdue" />
          <Count label="Due in 7 days" value={counts.due} tone="text-orange-700" testId="probation-count-due" />
          <Count label="E-mail pending" value={counts.awaitingEmail} tone="text-indigo-700" testId="probation-count-email" />
          <Count label="Confirmed (90 days)" value={counts.confirmed} tone="text-emerald-700" testId="probation-count-confirmed" />
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => { setError(null); void load(); }} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}
      {cycles && cycles.length > 0 && (
        <div className="flex gap-2" role="group" aria-label="Show">
          <button type="button" className={filter === 'all' ? btn.primary : btn.secondary} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({cycles.length})</button>
          <button type="button" className={filter === 'overdue' ? btn.primary : btn.secondary} aria-pressed={filter === 'overdue'} onClick={() => setFilter('overdue')} data-testid="probation-filter-overdue">Overdue ({counts.overdue})</button>
        </div>
      )}
      <ConfirmationsList cycles={shown} empty={filter === 'overdue' ? 'No overdue probation confirmations.' : undefined} busy={busy} act={act} />
    </section>
  );
};

const Count: React.FC<{ label: string; value: number; tone: string; testId: string }> = ({ label, value, tone, testId }) => (
  <Card className="p-3">
    <div className="text-[11px] font-semibold text-slate-500">{label}</div>
    <div className={`text-xl font-bold ${tone}`} data-testid={testId}>{value}</div>
  </Card>
);

type Outcome = { ok: boolean; text: string };
type Act = (key: string, fn: () => Promise<unknown>, done: string | ((result: unknown) => Outcome)) => Promise<boolean>;

const ConfirmationsList: React.FC<{ cycles: HrProbationCycle[] | null; empty?: string; busy: string | null; act: Act }> = ({ cycles, empty, busy, act }) => {
  const [open, setOpen] = useState<{ id: string; mode: 'approve' | 'close' | 'date' } | null>(null);
  const [effective, setEffective] = useState('');
  const [note, setNote] = useState('');
  if (!cycles) return <Spinner />;
  const rows = cycles;
  if (!rows.length) {
    return <Card className="p-8 text-center text-xs text-slate-500">{empty ?? 'No probation confirmations right now. They appear here for employees who joined in the last six months.'}</Card>;
  }
  const dueText = (c: HrProbationCycle) =>
    c.daysLeft > 1 ? `in ${c.daysLeft} days` : c.daysLeft === 1 ? 'tomorrow' : c.daysLeft === 0 ? 'today' : `${-c.daysLeft} day${c.daysLeft === -1 ? '' : 's'} overdue`;
  const start = (c: HrProbationCycle, mode: 'approve' | 'close' | 'date') => { setOpen({ id: c.id, mode }); setEffective(mode === 'date' ? c.effectiveDate ?? c.probationEnd : c.probationEnd); setNote(''); };
  const undecided = (c: HrProbationCycle) => c.status === 'PENDING' || c.status === 'CONFIRMING';

  return (
    <Card className="overflow-hidden">
      <p className="px-4 py-3 text-[11px] text-slate-500 border-b border-slate-100">
        Probation is six months from the joining date. A reminder goes to the employee and HR seven days before it ends. Confirm sends the confirmation
        e-mail to the employee; they are marked Confirmed, and leave the overdue list, only once that e-mail has been sent.
      </p>
      <ul className="divide-y divide-slate-100">
        {rows.map(c => (
          <li key={c.id} className="px-4 py-3 text-xs" data-testid="probation-row" data-status={c.status} data-overdue={isOverdue(c) ? 'true' : 'false'}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[12rem] flex-1">
                <div className="font-bold text-slate-900 text-sm">{c.employeeName}</div>
                <div className="text-slate-500">{c.employeeCode}{c.department ? ` · ${c.department}` : ''}</div>
              </div>
              <div className="text-slate-600 w-28"><div className="text-[11px] text-slate-400">Joined</div>{fmtDay(c.joiningDate)}</div>
              <div className="text-slate-600 w-48"><div className="text-[11px] text-slate-400">Probation ends</div>{fmtDay(c.probationEnd)}{undecided(c) && <span className={`ml-1.5 font-semibold ${c.daysLeft < 0 ? 'text-rose-700' : c.daysLeft <= 7 ? 'text-orange-700' : 'text-slate-500'}`}>({dueText(c)})</span>}</div>
              <div className="w-52">
                {c.status === 'PENDING' ? <Pill tone={isOverdue(c) ? 'red' : c.daysLeft <= 7 ? 'orange' : 'indigo'}>{isOverdue(c) ? 'Overdue' : 'Confirmation due'}</Pill>
                  : c.status === 'CONFIRMING' ? (
                    <Pill tone={emailFailed(c) ? 'red' : 'orange'}>{emailFailed(c) ? 'E-mail not sent' : scheduledLater(c) ? `E-mail on ${fmtDay(c.probationEnd)}` : 'Sending e-mail'}{isOverdue(c) ? ' · Overdue' : ''}</Pill>
                  )
                  : c.status === 'APPROVED' ? <Pill tone="green">Confirmed {c.effectiveDate ? `· ${fmtDay(c.effectiveDate)}` : ''}</Pill> : <Pill tone="slate">Closed</Pill>}
                {c.status !== 'PENDING' && <div className="text-[11px] text-slate-400 mt-0.5">{c.approvedBy ? `${c.approvedBy}, ` : ''}{c.approvedAt ? when(c.approvedAt) : ''}</div>}
                {c.status === 'CONFIRMING' && c.email?.error && <div className="text-[11px] text-rose-700 mt-0.5" data-testid="probation-email-error">{c.email.error}</div>}
                {c.overdueRemindedAt && undecided(c) && <div className="text-[11px] text-slate-400 mt-0.5">Reminder sent {when(c.overdueRemindedAt)}</div>}
              </div>
              {undecided(c) && (
                <div className="flex flex-wrap gap-2">
                  {c.canDecide && c.status === 'PENDING' && (
                    <button type="button" className={btn.green} disabled={busy === c.id} onClick={() => start(c, 'approve')} data-testid="probation-confirm">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                    </button>
                  )}
                  {c.canDecide && c.status === 'CONFIRMING' && !scheduledLater(c) && (
                    <button type="button" className={btn.green} disabled={busy === c.id} data-testid="probation-retry-email"
                      onClick={() => void act(c.id, () => hrApi.retryProbationEmail(c.id), r => outcomeOf(r as HrProbationCycle))}>
                      <RotateCcw className="w-3.5 h-3.5" /> Retry e-mail
                    </button>
                  )}
                  {isOverdue(c) && (
                    // the overdue action: reminds the approvers; it never confirms anybody
                    <button type="button" className={btn.secondary} disabled={busy === c.id} data-testid="probation-remind-overdue"
                      onClick={() => void act(c.id, () => hrApi.remindOverdueProbation(c.id), r => {
                        const n = (r as { reminded?: number }).reminded ?? 0;
                        return { ok: true, text: `Overdue reminder sent to ${n} ${n === 1 ? 'person' : 'people'} (the Department Head${n === 1 ? '' : 's'} and the department's HR). ${c.employeeName} is still not confirmed.` };
                      })}>
                      <BellRing className="w-3.5 h-3.5" /> Overdue reminder
                    </button>
                  )}
                  {c.canDecide ? (
                    <button type="button" className={btn.secondary} disabled={busy === c.id} onClick={() => start(c, 'close')}><XCircle className="w-3.5 h-3.5" /> Close</button>
                  ) : <span className="text-[11px] text-slate-400 self-center">Confirmed by the HR lead, the department's HR or the Department Head</span>}
                </div>
              )}
              {c.status === 'APPROVED' && c.canDecide && (
                // paid leave is earned from this date: a correction is audited and changes only future credits (HR adjusts past ones if needed)
                <button type="button" className={btn.secondary} onClick={() => start(c, 'date')} data-testid="confirmation-date-correct">Correct date</button>
              )}
            </div>
            {c.status === 'CONFIRMING' && (
              <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" aria-hidden="true" />
                {scheduledLater(c) ? `Approved. The confirmation e-mail goes out on ${fmtDay(c.probationEnd)}; the employee is marked Confirmed once it is sent.`
                  : `Confirmation e-mail: ${c.email ? c.email.status.toLowerCase().replace('_', ' ') : 'not queued'}${c.email?.attempts ? `, ${c.email.attempts} attempt${c.email.attempts === 1 ? '' : 's'}` : ''}. The employee is confirmed once it is sent.`}
              </div>
            )}
            {c.note && c.status !== 'PENDING' && <div className="mt-1 text-[11px] text-slate-500">Note: {c.note}</div>}
            {open?.id === c.id && (
              <form
                className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 grid gap-3 sm:grid-cols-[auto_1fr_auto] items-end"
                onSubmit={e => {
                  e.preventDefault();
                  if (busy === c.id) return;
                  const mode = open.mode;
                  const run = mode === 'approve'
                    ? () => hrApi.confirmProbation(c.id, { effectiveDate: effective || undefined, note: note.trim() || undefined })
                    : mode === 'date'
                      ? () => hrApi.confirmationDate(c.id, { effectiveDate: effective, note: note.trim() })
                      : () => hrApi.dismissProbation(c.id, note.trim());
                  void act(c.id, run, mode === 'approve'
                    ? r => outcomeOf(r as HrProbationCycle)
                    : mode === 'date'
                      ? `${c.employeeName}'s confirmation date is now ${fmtDay(effective)}. Paid leave credits from now on follow it; earlier credits are unchanged.`
                      : `${c.employeeName}'s confirmation was closed without e-mails.`).then(ok => { if (ok) setOpen(null); });
                }}
              >
                {open.mode !== 'close' && (
                  <label className="text-[11px] font-semibold text-slate-600">{open.mode === 'date' ? 'Corrected effective date' : 'Effective date'}
                    <input type="date" className={`${inputCls} mt-1`} value={effective} min={c.joiningDate} onChange={e => setEffective(e.target.value)} required />
                  </label>
                )}
                <label className="text-[11px] font-semibold text-slate-600">{open.mode === 'approve' ? 'Note (optional)' : 'Reason (required)'}
                  <input className={`${inputCls} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} required={open.mode !== 'approve'} minLength={open.mode === 'close' ? 3 : open.mode === 'date' ? 5 : undefined}
                    placeholder={open.mode === 'approve' ? 'e.g. reviewed with the Department Head' : 'e.g. confirmed earlier, on paper'} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className={open.mode === 'approve' ? btn.green : btn.primary} disabled={busy === c.id} data-testid="probation-submit">
                    {busy === c.id ? 'Working…' : open.mode === 'approve' ? 'Confirm and send e-mail' : open.mode === 'date' ? 'Save the date' : 'Close it'}
                  </button>
                  <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { hrApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { fmtDay } from '../../lib/support';
import type { HrProbationCycle } from '../../../shared/contracts';
import { btn, Card, ErrorBanner, inputCls, Pill, Spinner } from '../team-member/pipeline/shared';

/**
 * HR dashboard > Probation Confirmations. The approval step of the six-month confirmation: HR (the HR lead), the employee's
 * Department Head or the Super Admin approves or closes it (the database decides who may). The e-mails themselves (birthday,
 * work anniversary, the 7-day confirmation reminders and the confirmation e-mails after an approval) run on the server by
 * themselves every morning at 9:00 AM India time; there is nothing to run, refresh or monitor here.
 */
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

export const ProbationConfirmations: React.FC = () => {
  const [cycles, setCycles] = useState<HrProbationCycle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () => hrApi.probation().then(c => setCycles(c), e => { setCycles(prev => prev ?? []); setError(errText(e, 'Could not load the probation confirmations.')); }),
    []
  );
  useEffect(() => { void load(); }, [load]);

  const act: Act = async (key, fn, done) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errText(e, 'That did not work. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-5" aria-label="Probation confirmations">
      <header>
        <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-600" /> Probation Confirmations</h2>
        <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">Employees whose six-month probation is ending. Nobody is confirmed automatically.</p>
      </header>
      {error && <ErrorBanner message={error} onRetry={() => { setError(null); void load(); }} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}
      <ConfirmationsList cycles={cycles} busy={busy} act={act} />
    </section>
  );
};

type Act = (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;

const ConfirmationsList: React.FC<{ cycles: HrProbationCycle[] | null; busy: string | null; act: Act }> = ({ cycles, busy, act }) => {
  const [open, setOpen] = useState<{ id: string; mode: 'approve' | 'close' } | null>(null);
  const [effective, setEffective] = useState('');
  const [note, setNote] = useState('');
  if (!cycles) return <Spinner />;
  const rows = cycles;
  if (!rows.length) {
    return <Card className="p-8 text-center text-xs text-slate-500">No probation confirmations right now. They appear here for employees who joined in the last six months.</Card>;
  }
  const dueText = (c: HrProbationCycle) =>
    c.daysLeft > 1 ? `in ${c.daysLeft} days` : c.daysLeft === 1 ? 'tomorrow' : c.daysLeft === 0 ? 'today' : `${-c.daysLeft} day${c.daysLeft === -1 ? '' : 's'} overdue`;
  const start = (c: HrProbationCycle, mode: 'approve' | 'close') => { setOpen({ id: c.id, mode }); setEffective(c.probationEnd); setNote(''); };

  return (
    <Card className="overflow-hidden">
      <p className="px-4 py-3 text-[11px] text-slate-500 border-b border-slate-100">
        Probation is six months from the joining date. A reminder goes to the employee and HR seven days before it ends. The employee is confirmed only when
        HR (the HR lead), their Department Head or the Super Admin approves it here; the confirmation e-mails are sent after that approval.
      </p>
      <ul className="divide-y divide-slate-100">
        {rows.map(c => (
          <li key={c.id} className="px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[12rem] flex-1">
                <div className="font-bold text-slate-900 text-sm">{c.employeeName}</div>
                <div className="text-slate-500">{c.employeeCode}{c.department ? ` · ${c.department}` : ''}</div>
              </div>
              <div className="text-slate-600 w-28"><div className="text-[11px] text-slate-400">Joined</div>{fmtDay(c.joiningDate)}</div>
              <div className="text-slate-600 w-48"><div className="text-[11px] text-slate-400">Probation ends</div>{fmtDay(c.probationEnd)}{c.status === 'PENDING' && <span className={`ml-1.5 font-semibold ${c.daysLeft < 0 ? 'text-rose-700' : c.daysLeft <= 7 ? 'text-orange-700' : 'text-slate-500'}`}>({dueText(c)})</span>}</div>
              <div className="w-44">
                {c.status === 'PENDING' ? <Pill tone={c.daysLeft < 0 ? 'red' : c.daysLeft <= 7 ? 'orange' : 'indigo'}>{c.daysLeft < 0 ? 'Overdue' : 'Confirmation due'}</Pill>
                  : c.status === 'APPROVED' ? <Pill tone="green">Confirmed {c.effectiveDate ? `· ${fmtDay(c.effectiveDate)}` : ''}</Pill> : <Pill tone="slate">Closed</Pill>}
                {c.status !== 'PENDING' && <div className="text-[11px] text-slate-400 mt-0.5">{c.approvedBy ? `${c.approvedBy}, ` : ''}{c.approvedAt ? when(c.approvedAt) : ''}</div>}
              </div>
              {c.status === 'PENDING' && (
                <div className="flex gap-2">
                  {c.canDecide ? (
                    <>
                      <button type="button" className={btn.green} onClick={() => start(c, 'approve')}><CheckCircle2 className="w-3.5 h-3.5" /> Approve confirmation</button>
                      <button type="button" className={btn.secondary} onClick={() => start(c, 'close')}><XCircle className="w-3.5 h-3.5" /> Close</button>
                    </>
                  ) : <span className="text-[11px] text-slate-400">Approved by the HR lead or the Department Head</span>}
                </div>
              )}
            </div>
            {c.note && c.status !== 'PENDING' && <div className="mt-1 text-[11px] text-slate-500">Note: {c.note}</div>}
            {open?.id === c.id && (
              <form
                className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 grid gap-3 sm:grid-cols-[auto_1fr_auto] items-end"
                onSubmit={e => {
                  e.preventDefault();
                  const run = open.mode === 'approve'
                    ? () => hrApi.confirmProbation(c.id, { effectiveDate: effective || undefined, note: note.trim() || undefined })
                    : () => hrApi.dismissProbation(c.id, note.trim());
                  void act(c.id, run, open.mode === 'approve'
                    ? `${c.employeeName} is confirmed. The confirmation e-mails are sent to the employee and HR${c.daysLeft > 0 ? ` on ${fmtDay(c.probationEnd)}` : ''}.`
                    : `${c.employeeName}'s confirmation was closed without e-mails.`).then(() => setOpen(null));
                }}
              >
                {open.mode === 'approve' && (
                  <label className="text-[11px] font-semibold text-slate-600">Effective date
                    <input type="date" className={`${inputCls} mt-1`} value={effective} min={c.joiningDate} onChange={e => setEffective(e.target.value)} required />
                  </label>
                )}
                <label className="text-[11px] font-semibold text-slate-600">{open.mode === 'approve' ? 'Note (optional)' : 'Reason (required)'}
                  <input className={`${inputCls} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} required={open.mode === 'close'} minLength={open.mode === 'close' ? 3 : undefined}
                    placeholder={open.mode === 'approve' ? 'e.g. reviewed with the Department Head' : 'e.g. confirmed earlier, on paper'} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className={open.mode === 'approve' ? btn.green : btn.primary} disabled={busy === c.id}>{open.mode === 'approve' ? 'Confirm employee' : 'Close it'}</button>
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

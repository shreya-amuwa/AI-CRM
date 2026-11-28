import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { EmploymentStatus, LeaveRequest, LeaveReview, PaidLeaveBalance } from '../../../shared/contracts';
import { hrApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { useNotifications } from '../../context/NotificationContext';
import { formatDay, officeToday } from '../../lib/officeTime';
import { SideDrawer } from '../common/SideDrawer';
import { LeaveStatusBadge } from './LeaveStatusBadge';
import { Paged } from '../common/Paged';

const inputCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs bg-white';

const dates = (r: LeaveRequest) => (r.endDate === r.startDate ? formatDay(r.startDate) : `${formatDay(r.startDate)} to ${formatDay(r.endDate)}`);
const length = (r: LeaveRequest) => (r.leaveType === 'HALF_DAY' ? `Half day (${r.halfDayShift === 'AFTERNOON' ? 'afternoon' : 'morning'})` : `${r.days} day${r.days === 1 ? '' : 's'}`);

const STAGE_LABEL: Record<string, string> = { TEAM_LEAD: 'Team Lead', DEPARTMENT_HEAD: 'Department Head', OPERATIONS_HEAD: 'CEO', HR: 'HR', SUPER_ADMIN: 'Managing Director', SUBMITTED: 'Requested', RESUBMITTED: 'Changed and sent again' };
const DECISION_LABEL: Record<string, string> = { APPROVED: 'approved', REJECTED: 'rejected', REVISION_REQUESTED: 'asked for changes', SUBMITTED: '' };
const when = (at: string) => new Date(at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const EMPLOYMENT_LABEL: Record<EmploymentStatus, string> = {
  PROBATION: 'On probation', CONFIRMATION_PENDING: 'Probation completed - confirmation pending', FULL_TIME: 'Full-time (confirmed)',
  NOT_CONFIRMED: 'Not confirmed', UNKNOWN: 'Not recorded by HR'
};
const fmtDays = (n: number) => `${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(1)} day${Number(n) === 1 ? '' : 's'}`;

/** The paid leave balance, as the database computes it from the ledger (credits, approved leave, HR corrections). */
export const PaidLeaveCard: React.FC<{ b: PaidLeaveBalance }> = ({ b }) => {
  const confirmed = b.employment.status === 'FULL_TIME';
  return (
    <section className="m-4 p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 space-y-2" aria-labelledby="paid-leave-heading" data-testid="paid-leave-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="paid-leave-heading" className="text-xs font-bold text-slate-900">Paid leave</h3>
          <p className="text-[11px] text-slate-600">{EMPLOYMENT_LABEL[b.employment.status]}{b.employment.confirmedFrom ? ` from ${formatDay(b.employment.confirmedFrom)}` : ''}</p>
        </div>
        <p className="text-right">
          <span className="block text-lg font-extrabold text-emerald-800" data-testid="paid-leave-available">{fmtDays(b.available)}</span>
          <span className="text-[10px] text-slate-500">available</span>
        </p>
      </div>
      {!b.policy.enabled && b.balance === 0 ? (
        <p className="text-[11px] text-slate-600">Paid leave ({b.policy.monthlyDays} days a month after confirmation as a full-time employee) has not started yet. Unpaid leave is available as always.</p>
      ) : !confirmed && b.balance === 0 ? (
        <p className="text-[11px] text-slate-600">Paid leave ({b.policy.monthlyDays} days a month) starts once HR confirms you as a full-time employee after your probation. Unpaid leave is available as always.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]" data-testid="paid-leave-breakdown">
          <dt className="text-slate-500">Previous balance (carried forward)</dt><dd className="text-right font-semibold text-slate-800">{fmtDays(b.carriedForward)}</dd>
          <dt className="text-slate-500">Credited this month</dt><dd className="text-right font-semibold text-slate-800">+{fmtDays(b.creditedThisMonth)}</dd>
          {Number(b.adjustedThisMonth) !== 0 && (<><dt className="text-slate-500">HR adjustment this month</dt><dd className="text-right font-semibold text-slate-800">{Number(b.adjustedThisMonth) > 0 ? '+' : ''}{fmtDays(b.adjustedThisMonth)}</dd></>)}
          <dt className="text-slate-500">Approved leave used this month</dt><dd className="text-right font-semibold text-slate-800">-{fmtDays(b.usedThisMonth)}</dd>
          <dt className="text-slate-700 font-semibold border-t border-emerald-200 pt-1">Remaining balance</dt><dd className="text-right font-bold text-slate-900 border-t border-emerald-200 pt-1">{fmtDays(b.balance)}</dd>
          <dt className="text-slate-500">Waiting for approval (reserved)</dt><dd className="text-right font-semibold text-slate-800">{fmtDays(b.pendingPaidDays)}</dd>
          <dt className="text-slate-500">Paid leave used in total</dt><dd className="text-right font-semibold text-slate-800">{fmtDays(b.totalUsed)}</dd>
          <dt className="text-slate-500">Requests waiting</dt><dd className="text-right font-semibold text-slate-800">{b.pendingRequests}</dd>
        </dl>
      )}
    </section>
  );
};

/** Who decided what, in order: the audit trail shown on each request (the multi-level chain has a full timeline). */
const Trail: React.FC<{ r: LeaveRequest }> = ({ r }) => (r.timeline && r.timeline.length > 0 ? (
  <Paged items={r.timeline} noun="entries">{rows => (
  <ol className="mt-2 space-y-0.5 text-[11px] text-slate-500" aria-label="Approval timeline">
    {rows.map((t, i) => (
      <li key={i}>
        {when(t.at)} · {STAGE_LABEL[t.stage] ?? t.stage}{t.by ? ` (${t.by})` : ''}{DECISION_LABEL[t.decision] ? `: ${DECISION_LABEL[t.decision]}` : ''}
        {t.onBehalf ? ' (Managing Director, nobody else could decide this step)' : ''}{t.note ? ` - "${t.note}"` : ''}
      </li>
    ))}
    {r.currentStage && <li className="font-semibold text-slate-600">Waiting for {STAGE_LABEL[r.currentStage]}{r.waitingFor?.length ? ` (${r.waitingFor.join(', ')})` : ''}</li>}
  </ol>
  )}</Paged>
) : (
  <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
    <li>Requested {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</li>
    {r.departmentHead && (
      <li>
        Department Head{r.departmentHead.name ? ` (${r.departmentHead.name})` : ''}: {r.status === 'REJECTED_BY_DEPARTMENT_HEAD' ? 'rejected' : 'approved'}
        {r.departmentHead.note ? ` - "${r.departmentHead.note}"` : ''}
      </li>
    )}
    {r.hr && (
      <li>
        HR{r.hr.name ? ` (${r.hr.name})` : ''}: {r.status === 'REJECTED_BY_HR' ? 'rejected' : 'approved'}
        {r.hr.note ? ` - "${r.hr.note}"` : ''}
      </li>
    )}
  </ul>
));

const RequestForm: React.FC<{ onDone: () => void; paid?: PaidLeaveBalance | null }> = ({ onDone, paid }) => {
  // paid leave is offered to an employee who has a balance (the database checks it again and reserves the days)
  const canPay = !!paid && Number(paid.available) > 0;
  const [pay, setPay] = useState<'PAID' | 'UNPAID' | null>(null);
  const kind = pay ?? (canPay ? 'PAID' : 'UNPAID');
  const [leaveType, setLeaveType] = useState<'FULL_DAY' | 'HALF_DAY'>('FULL_DAY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [shift, setShift] = useState<'MORNING' | 'AFTERNOON'>('MORNING');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await (kind === 'PAID' && canPay ? hrApi.submitPaidLeave : hrApi.submitLeave)({
        leaveType,
        startDate,
        endDate: leaveType === 'FULL_DAY' && endDate ? endDate : undefined,
        halfDayShift: leaveType === 'HALF_DAY' ? shift : undefined,
        reason
      });
      setStartDate(''); setEndDate(''); setReason('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-5 space-y-3 border-b border-slate-100">
      <h3 className="text-sm font-bold text-slate-900">Request leave</h3>
      <p className="text-[11px] text-slate-500">It goes up your reporting line (your Team Lead, Department Head and CEO, as they apply to you), then HR gives the final approval.</p>
      {error && <div role="alert" className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-700 col-span-2">
          Type
          <select className={`${inputCls} mt-1`} value={leaveType} onChange={e => setLeaveType(e.target.value as 'FULL_DAY' | 'HALF_DAY')}>
            <option value="FULL_DAY">Full-day leave</option>
            <option value="HALF_DAY">Half day</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          {leaveType === 'HALF_DAY' ? 'Date *' : 'From *'}
          <input type="date" className={`${inputCls} mt-1`} value={startDate} onChange={e => setStartDate(e.target.value)} min={officeToday()} required />
        </label>
        {leaveType === 'FULL_DAY' ? (
          <label className="text-xs font-semibold text-slate-700">
            To
            <input type="date" className={`${inputCls} mt-1`} value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate || officeToday()} />
          </label>
        ) : (
          <label className="text-xs font-semibold text-slate-700">
            Which half *
            <select className={`${inputCls} mt-1`} value={shift} onChange={e => setShift(e.target.value as 'MORNING' | 'AFTERNOON')}>
              <option value="MORNING">Morning</option>
              <option value="AFTERNOON">Afternoon</option>
            </select>
          </label>
        )}
      </div>
      {canPay && (
        <fieldset className="text-xs" data-testid="leave-pay">
          <legend className="font-semibold text-slate-700">Paid or unpaid</legend>
          <div className="mt-1 flex gap-2">
            {(['PAID', 'UNPAID'] as const).map(k => (
              <label key={k} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer ${kind === k ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                <input type="radio" name="leave-pay" value={k} checked={kind === k} onChange={() => setPay(k)} />
                {k === 'PAID' ? `Paid (${fmtDays(paid!.available)} available)` : 'Unpaid'}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Paid days are reserved now and taken from your balance only when HR gives the final approval.</p>
        </fieldset>
      )}
      <label className="block text-xs font-semibold text-slate-700">
        Reason *
        <textarea className={`${inputCls} mt-1`} rows={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} required minLength={3} />
      </label>
      <button type="submit" disabled={busy} className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-60 cursor-pointer">
        {busy ? 'Sending…' : 'Send for approval'}
      </button>
    </form>
  );
};

/** A request sent back for changes: the employee rewrites the reason and it starts the chain again. */
const Resubmit: React.FC<{ r: LeaveRequest; onDone: () => void }> = ({ r, onDone }) => {
  const [reason, setReason] = useState(r.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try { await hrApi.resubmitLeave(r.id, reason); onDone(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-1.5">
      {r.revisionNote && <p className="text-[11px] text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1">Asked to change: {r.revisionNote}</p>}
      <label className="block text-[11px] font-semibold text-slate-700">
        Reason
        <textarea className={`${inputCls} mt-1`} rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-[11px] text-rose-600">{error}</p>}
      <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void send()} className="w-full py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50 cursor-pointer">
        {busy ? 'Sending…' : 'Send again'}
      </button>
    </div>
  );
};

const ReviewCard: React.FC<{ r: LeaveRequest; onChanged: () => void }> = ({ r, onChanged }) => {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const asHr = r.status === 'PENDING_HR';
  const chain = (r.workflowVersion ?? 1) >= 2;
  // the last step of the chain (HR, or the Super Admin for HR's own leave) gives the final approval
  const isFinal = chain ? !!r.currentStage && r.stages?.[r.stages.length - 1] === r.currentStage : asHr;
  const [mode, setMode] = useState<'REJECT' | 'REVISE'>('REJECT');

  const decide = async (approve: boolean) => {
    setError('');
    setBusy(true);
    try {
      if (chain) await hrApi.decideLeave(r.id, approve ? 'APPROVE' : mode, note);
      else if (asHr) await hrApi.decideAsHr(r.id, approve, note);
      else await hrApi.decideAsDepartmentHead(r.id, approve, note);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      onChanged(); // the request may have been decided by someone else meanwhile
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{r.employeeName}</p>
          <p className="text-[11px] text-slate-500">{r.departmentName || '-'}</p>
        </div>
        <LeaveStatusBadge status={r.status} />
      </div>
      <p className="text-xs text-slate-700 mt-2">{dates(r)} <span className="text-slate-400">·</span> {length(r)}{r.paid ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">Paid leave</span> : <span className="ml-1.5 text-[10px] text-slate-500">Unpaid</span>}</p>
      <p className="text-[11px] text-slate-500 mt-1 break-words">{r.reason}</p>
      <Trail r={r} />
      {error && <p role="alert" className="mt-2 text-[11px] text-rose-600">{error}</p>}
      {r.status.startsWith('PENDING_') && (
        rejecting ? (
          <div className="mt-3 space-y-2">
            {chain && (
              <div className="flex gap-3 text-[11px] text-slate-700" role="radiogroup" aria-label="What to do">
                <label className="inline-flex items-center gap-1"><input type="radio" checked={mode === 'REJECT'} onChange={() => setMode('REJECT')} /> Reject</label>
                <label className="inline-flex items-center gap-1"><input type="radio" checked={mode === 'REVISE'} onChange={() => setMode('REVISE')} /> Send back for changes</label>
              </div>
            )}
            <label className="block text-[11px] font-semibold text-slate-700">
              {mode === 'REVISE' && chain ? 'What should be changed *' : 'Reason for rejecting *'}
              <textarea className={`${inputCls} mt-1`} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || note.trim().length < 3} onClick={() => void decide(false)} className="flex-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer">{mode === 'REVISE' && chain ? 'Send back' : 'Reject'}</button>
              <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void decide(true)} className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer">
              {isFinal ? 'Give final approval' : chain ? `Approve (${STAGE_LABEL[r.currentStage ?? ''] ?? 'your step'})` : 'Approve and send to HR'}
            </button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="flex-1 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50 cursor-pointer">Reject</button>
          </div>
        )
      )}
    </li>
  );
};

/** Own requests and the requests that wait for the signed-in person. Reloads when a notification arrives. */
export function useLeaveData(active = true) {
  const { unreadCount } = useNotifications();
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [review, setReview] = useState<LeaveReview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([hrApi.myLeave(), hrApi.leaveToReview()]);
      setMine(m);
      setReview(r);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (active) void load(); }, [load, unreadCount, active]);
  return { mine, review, error, loading, reload: load };
}

/** The requests waiting for me (approve / reject) and the ones I decided recently. */
export const LeaveReviewList: React.FC<{ review: LeaveReview | null; onChanged: () => void }> = ({ review, onChanged }) => (
  <>
    <div className="px-5 pt-4 pb-1 text-xs font-bold text-slate-900">Waiting for your decision</div>
    {!review || review.awaiting.length === 0 ? (
      <p className="px-5 py-6 text-xs text-slate-400">Nothing is waiting for you.</p>
    ) : (
      <ul className="divide-y divide-slate-100">{review.awaiting.map(r => <ReviewCard key={r.id} r={r} onChanged={onChanged} />)}</ul>
    )}
    {review && review.decided.length > 0 && (
      <>
        <div className="px-5 pt-5 pb-1 text-xs font-bold text-slate-900">Recently decided</div>
        <ul className="divide-y divide-slate-100">{review.decided.map(r => <ReviewCard key={r.id} r={r} onChanged={onChanged} />)}</ul>
      </>
    )}
  </>
);

/**
 * "Leave" in the header: request leave, follow your requests, and (for Department Heads and HR) the requests that
 * wait for you. The chain depends on who asks (Team Lead, Department Head, Operations Head, HR; HR's own leave: the Super Admin); the database enforces the order and who may decide.
 */
export const LeaveCenter: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'mine' | 'review'>('mine');
  const { mine, review, error, loading, reload } = useLeaveData();
  const [paid, setPaid] = useState<PaidLeaveBalance | null>(null);
  // the paid leave balance (absent until its migration runs: the drawer works as before without it)
  const load = useCallback(async () => {
    await reload();
    hrApi.myPaidLeave().then(setPaid, () => setPaid(null));
  }, [reload]);

  const canReview = !!review && (review.canReviewAsDepartmentHead || review.canReviewAsHr || !!review.canReview || review.awaiting.length > 0);
  const waiting = review?.awaiting.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { setTab(waiting > 0 ? 'review' : 'mine'); setOpen(true); void load(); }}
        aria-label={`Leave${waiting > 0 ? ` (${waiting} waiting for your decision)` : ''}`}
        aria-haspopup="dialog"
        className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
      >
        <CalendarDays className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">Leave</span>
        {waiting > 0 && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">{waiting}</span>
        )}
      </button>
      {open && (
        <SideDrawer title="Leave" subtitle="Approved step by step up your reporting line, then HR" onClose={() => setOpen(false)}>
          {canReview && (
            <div className="flex gap-1 p-2 border-b border-slate-100" role="tablist">
              {([['mine', 'My leave'], ['review', `To review${waiting ? ` (${waiting})` : ''}`]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && <div role="alert" className="m-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error} <button type="button" className="underline font-semibold" onClick={() => void load()}>Try again</button></div>}
          {tab === 'mine' || !canReview ? (
            <>
              {paid && <PaidLeaveCard b={paid} />}
              <RequestForm onDone={() => void load()} paid={paid} />
              <div className="px-5 pt-4 pb-1 text-xs font-bold text-slate-900">My requests</div>
              {loading ? (
                <p className="px-5 py-6 text-xs text-slate-400">Loading…</p>
              ) : mine.length === 0 ? (
                <p className="px-5 py-6 text-xs text-slate-400">You have not requested any leave yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {mine.map(r => (
                    <li key={r.id} className="px-5 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">{dates(r)} <span className="text-slate-400">·</span> {length(r)}{r.paid ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">Paid</span> : null}</p>
                        <LeaveStatusBadge status={r.status} />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 break-words">{r.reason}</p>
                      <Trail r={r} />
                      {r.status === 'REVISION_REQUIRED' && <Resubmit r={r} onDone={() => void load()} />}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <LeaveReviewList review={review} onChanged={() => void load()} />
          )}
        </SideDrawer>
      )}
    </>
  );
};

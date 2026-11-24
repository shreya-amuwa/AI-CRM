import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle2, Search } from 'lucide-react';
import type { PaidLeaveDetail, PaidLeaveList, PaidLeavePolicy } from '../../../shared/contracts';
import { paidLeaveAdjustSchema, paidLeavePolicySchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { hrApi } from '../../lib/api/endpoints';
import { fmtDay } from '../../lib/support';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pill, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { HrPageHeader, hrBtn } from './hrUi';

/**
 * HR dashboard > Paid Leave. Confirmed full-time employees earn paid leave every month (unused days carry forward). Every figure here is the
 * database's ledger: monthly credits, approved paid leave, opening balances and corrections. HR records opening balances and corrections (with a
 * reason, audited); the HR Department Head or the Super Admin sets the policy and switches the monthly credit on.
 */
const days = (n: number) => `${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(1)}`;
const STATUS: Record<string, { label: string; tone: 'green' | 'orange' | 'indigo' | 'slate' | 'red' }> = {
  FULL_TIME: { label: 'Full-time', tone: 'green' },
  CONFIRMATION_PENDING: { label: 'Confirmation pending', tone: 'orange' },
  PROBATION: { label: 'Probation', tone: 'indigo' },
  NOT_CONFIRMED: { label: 'Not confirmed', tone: 'red' },
  UNKNOWN: { label: 'Not recorded', tone: 'slate' }
};
const ENTRY: Record<string, string> = { MONTHLY_CREDIT: 'Monthly credit', LEAVE_DEBIT: 'Approved paid leave', LEAVE_REVERSAL: 'Returned', OPENING_BALANCE: 'Opening balance', CORRECTION: 'Correction' };
const monthText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const PaidLeaveManagement: React.FC = () => {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [data, setData] = useState<PaidLeaveList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const load = useCallback(() => {
    hrApi.paidLeaveList(q || undefined).then(d => { setData(d); setError(null); }, e => setError(errorMessage(e)));
  }, [q]);
  useEffect(load, [load]);

  const p = data?.policy;
  return (
    <section className="space-y-5" aria-label="Paid leave" data-testid="hr-paid-leave">
      <HrPageHeader as="h2" icon={CalendarCheck} title="Paid Leave"
        subtitle="Confirmed full-time employees earn paid leave every month; unused days carry forward. Employees on probation, or waiting for their confirmation, earn none. A paid request reserves its days and is deducted once, at HR's final approval."
        actions={data?.canChangePolicy && <button type="button" className={hrBtn.secondary} onClick={() => setPolicyOpen(true)}>Policy settings</button>} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}
      {p && (
        <Card className={`p-4 text-xs ${p.enabled ? '' : 'border-amber-300 bg-amber-50/60'}`}>
          {p.enabled ? (
            <p>
              <b>On:</b> {days(p.monthlyDays)} days a month, credited on day {p.creditDay}, from {p.partialMonthRule === 'NEXT_FULL_MONTH' ? 'the first full month after' : 'the month of'} the confirmation date
              {p.accrualStartMonth ? `, nothing before ${monthText(p.accrualStartMonth)}` : ''}.
            </p>
          ) : (
            <p data-testid="paid-leave-off">
              <b>Not switched on yet.</b> Before the monthly credit starts, HR confirms the credit day, how the month of the confirmation is counted, the first month to
              credit and any opening balances. {data?.canChangePolicy ? 'Use Policy settings.' : 'The HR Department Head or the Super Admin switches it on.'}
            </p>
          )}
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search employees</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className={`${inputCls} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or e-mail" />
          </label>
        </div>
        {!data ? <Spinner /> : data.items.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">No employee with a probation record matches.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-2 font-semibold">Employee</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Carried forward</th>
                  <th className="px-4 py-2 font-semibold text-right">This month</th>
                  <th className="px-4 py-2 font-semibold text-right">Used</th>
                  <th className="px-4 py-2 font-semibold text-right">Reserved</th>
                  <th className="px-4 py-2 font-semibold text-right">Balance</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map(i => (
                  <tr key={i.profileId} data-testid="paid-leave-row">
                    <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{i.fullName}</div><div className="text-slate-500">{i.department ?? ''}</div></td>
                    <td className="px-4 py-2.5"><Pill tone={STATUS[i.employment.status].tone}>{STATUS[i.employment.status].label}</Pill>
                      {i.employment.confirmedFrom && <div className="text-[11px] text-slate-500 mt-0.5">from {fmtDay(i.employment.confirmedFrom)}</div>}</td>
                    <td className="px-4 py-2.5 text-right">{days(i.carriedForward)}</td>
                    <td className="px-4 py-2.5 text-right">+{days(i.creditedThisMonth)}</td>
                    <td className="px-4 py-2.5 text-right">{days(i.totalUsed)}</td>
                    <td className="px-4 py-2.5 text-right">{days(i.pendingPaidDays)}</td>
                    <td className="px-4 py-2.5 text-right font-bold">{days(i.balance)}</td>
                    <td className="px-4 py-2.5 text-right"><button type="button" className={btn.secondary} onClick={() => setDetail(i.profileId)}>Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {detail && <DetailDialog profileId={detail} onClose={() => setDetail(null)} onChanged={m => { setNotice(m); load(); }} />}
      {policyOpen && p && <PolicyDialog policy={p} onClose={() => setPolicyOpen(false)} onSaved={() => { setPolicyOpen(false); setNotice('The paid leave policy was saved.'); load(); }} />}
    </section>
  );
};

const DetailDialog: React.FC<{ profileId: string; onClose: () => void; onChanged: (message: string) => void }> = ({ profileId, onClose, onChanged }) => {
  const [d, setD] = useState<PaidLeaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'CORRECTION' | 'OPENING_BALANCE'>('CORRECTION');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrApi.paidLeaveDetail(profileId).then(setD, e => setError(errorMessage(e))); }, [profileId]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = paidLeaveAdjustSchema.safeParse({ kind, days: amount, note });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the values.'); return; }
    setBusy(true);
    setError(null);
    try {
      setD(await hrApi.paidLeaveAdjust(profileId, parsed.data));
      setAmount(''); setNote('');
      onChanged(`${kind === 'CORRECTION' ? 'The correction' : 'The opening balance'} was recorded.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={d ? `Paid leave: ${d.fullName}` : 'Paid leave'} description="Every entry is kept; a mistake is corrected with a new entry." onClose={onClose} wide>
      {error && <ErrorBanner message={error} />}
      {!d ? <Spinner /> : (
        <div className="space-y-4 text-xs">
          <p><b>Balance {days(d.balance)}</b> · reserved for waiting requests {days(d.pendingPaidDays)} · available {days(d.available)}</p>
          <ol className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl" aria-label="Ledger">
            {d.entries.length === 0 ? <li className="p-3 text-slate-500">No entry yet.</li> : d.entries.map((x, i) => (
              <li key={i} className="px-3 py-2 flex justify-between gap-3">
                <span><b>{ENTRY[x.type] ?? x.type}</b> · {monthText(x.month)}{x.note ? ` · ${x.note}` : ''}{x.by ? ` · ${x.by}` : ''}</span>
                <span className={`font-bold ${Number(x.days) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{Number(x.days) > 0 ? '+' : ''}{days(x.days)}</span>
              </li>
            ))}
          </ol>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-[auto_8rem_1fr_auto] items-end" noValidate>
            <Field label="Entry" htmlFor="pl-kind">
              <select id="pl-kind" className={inputCls} value={kind} onChange={e => setKind(e.target.value as 'CORRECTION' | 'OPENING_BALANCE')}>
                <option value="CORRECTION">Correction (+ or -)</option>
                <option value="OPENING_BALANCE">Opening balance</option>
              </select>
            </Field>
            <Field label="Days" htmlFor="pl-days"><input id="pl-days" className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 1 or -0.5" /></Field>
            <Field label="Reason" htmlFor="pl-note"><input id="pl-note" className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Why (kept with the entry)" /></Field>
            <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : 'Record'}</button>
          </form>
        </div>
      )}
    </Dialog>
  );
};

const PolicyDialog: React.FC<{ policy: PaidLeavePolicy; onClose: () => void; onSaved: () => void }> = ({ policy, onClose, onSaved }) => {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [monthlyDays, setMonthlyDays] = useState(String(policy.monthlyDays));
  const [creditDay, setCreditDay] = useState(String(policy.creditDay));
  const [rule, setRule] = useState(policy.partialMonthRule);
  const [start, setStart] = useState(policy.accrualStartMonth ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = paidLeavePolicySchema.safeParse({ enabled, monthlyDays, creditDay, partialMonthRule: rule, startMonth: start || null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the values.'); return; }
    setBusy(true);
    setError(null);
    try { await hrApi.paidLeavePolicy(parsed.data); onSaved(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Paid leave policy" description="Confirm these with HR before switching the monthly credit on. Nothing is credited for a month before the first month you choose." onClose={onClose}>
      <form onSubmit={save} className="space-y-3 text-xs" noValidate>
        {error && <ErrorBanner message={error} />}
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Monthly credit switched on</label>
        <Field label="Days a month" htmlFor="pp-days"><input id="pp-days" className={inputCls} inputMode="decimal" value={monthlyDays} onChange={e => setMonthlyDays(e.target.value)} /></Field>
        <Field label="Credit day of the month (1-28, India time)" htmlFor="pp-day"><input id="pp-day" className={inputCls} inputMode="numeric" value={creditDay} onChange={e => setCreditDay(e.target.value)} /></Field>
        <Field label="The month in which the confirmation takes effect" htmlFor="pp-rule">
          <select id="pp-rule" className={inputCls} value={rule} onChange={e => setRule(e.target.value as typeof rule)}>
            <option value="NEXT_FULL_MONTH">Not counted unless it starts on the 1st (credit from the next full month)</option>
            <option value="EFFECTIVE_MONTH">Counted (credit for that month too)</option>
          </select>
        </Field>
        <Field label="First month to credit (no credit before it)" htmlFor="pp-start"><input id="pp-start" type="month" className={inputCls} value={start.slice(0, 7)} onChange={e => setStart(e.target.value ? `${e.target.value}-01` : '')} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button>
        </div>
      </form>
    </Dialog>
  );
};

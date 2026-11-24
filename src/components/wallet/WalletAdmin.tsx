import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { rupees } from '../../lib/income';
import { CREDIT_KIND_LABEL, monthLabel, walletApi, type CreditKind, type CreditStatus, type WalletCredit, type WalletPerson, type WalletReport } from '../../lib/wallet';
import { PageTitle } from '../layout/shell';
import { Dialog } from '../team-member/pipeline/shared';
import { Empty, Notice, Section, Tile, dayText, timeText } from './walletParts';

/**
 * Wallet administration for Accounts (and the Super Admin): enter a bonus, adjustment or refund for an employee, approve or reject the ones a colleague entered,
 * and read the wallet report (Accounts, HR and the Super Admin). A credit enters the wallet only when a DIFFERENT Accounts person approves it, and never the
 * employee's own; the database enforces both. See docs/EMPLOYEE_WALLET.md.
 */
type Tab = 'credits' | 'report';
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const field = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm';
const STATUS_TONE: Record<CreditStatus, string> = { PENDING_APPROVAL: 'bg-amber-50 text-amber-800', CREDITED: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-700' };
const STATUS_TEXT: Record<CreditStatus, string> = { PENDING_APPROVAL: 'Waiting for approval', CREDITED: 'Credited', REJECTED: 'Rejected' };

export const WalletAdmin: React.FC<{ title?: string }> = ({ title = 'Wallet' }) => {
  const [tab, setTab] = useState<Tab>('credits');
  return (
    <div className="space-y-5" data-testid="wallet-admin">
      <PageTitle title={title} subtitle="Bonuses, adjustments and refunds for employees' wallets, and the wallet report." />
      <div role="tablist" aria-label="Wallet administration" className="flex gap-1.5">
        {([['credits', 'Wallet credits'], ['report', 'Report']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`wallet-admin-tab-${id}`}
            className={`h-9 rounded-xl border px-3.5 text-sm font-semibold ${tab === id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>
      {tab === 'credits' ? <Credits /> : <Report />}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ credits
const Credits: React.FC = () => {
  const [pending, setPending] = useState<WalletCredit[] | null>(null);
  const [recent, setRecent] = useState<WalletCredit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ credit: WalletCredit; approve: boolean } | null>(null);
  const load = useCallback(() => {
    setError(null);
    Promise.all([walletApi.credits('PENDING_APPROVAL'), walletApi.credits(null)])
      .then(([p, all]) => { setPending(p); setRecent(all.filter(c => c.status !== 'PENDING_APPROVAL').slice(0, 20)); })
      .catch(e => setError(errText(e, 'The wallet credits could not be loaded.')));
  }, []);
  useEffect(load, [load]);
  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      <CreditForm onSaved={() => { setNotice('Saved. A different Accounts person approves it before it reaches the wallet.'); load(); }} />
      <Section title="Waiting for approval" hint="You cannot approve a credit you entered, or one for your own wallet.">
        {pending === null ? <Empty>Loading…</Empty> : pending.length === 0 ? <Empty>Nothing is waiting.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {pending.map(c => (
              <li key={c.id} data-testid="credit-row" className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{c.name} <span className="font-normal text-slate-500">· {c.department ?? 'No department'}</span></p>
                  <p className="text-sm text-slate-700 break-words">{CREDIT_KIND_LABEL[c.kind]} <strong className={c.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}>{c.amount < 0 ? '-' : '+'}{rupees(Math.abs(c.amount))}</strong> · {c.description}</p>
                  <p className="text-xs text-slate-500">Entered by {c.createdBy ?? '–'} · {timeText(c.createdAt)}{c.reference ? ` · ref ${c.reference}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDeciding({ credit: c, approve: false })} className="h-9 px-3 rounded-xl border border-rose-200 bg-white text-xs font-semibold text-rose-700" data-testid="credit-reject">Reject</button>
                  <button type="button" onClick={() => setDeciding({ credit: c, approve: true })} className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700" data-testid="credit-approve">Approve</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Decided">
        {recent.length === 0 ? <Empty>Nothing decided yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {recent.map(c => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{c.name} <span className="font-normal text-slate-500">· {CREDIT_KIND_LABEL[c.kind]} {c.amount < 0 ? '-' : '+'}{rupees(Math.abs(c.amount))}</span></p>
                  <p className="text-xs text-slate-500 break-words">{c.description}{c.decisionNote ? ` · ${c.decisionNote}` : ''}</p>
                  <p className="text-xs text-slate-400">{c.decidedAt ? `${timeText(c.decidedAt)} by ${c.decidedBy ?? '–'}` : ''}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.status]}`}>{STATUS_TEXT[c.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {deciding && <DecideDialog credit={deciding.credit} approve={deciding.approve} onClose={() => setDeciding(null)}
        onDone={() => { setNotice(deciding.approve ? 'Approved. It is in the employee’s wallet.' : 'Rejected.'); setDeciding(null); load(); }} />}
    </div>
  );
};

const DecideDialog: React.FC<{ credit: WalletCredit; approve: boolean; onClose: () => void; onDone: () => void }> = ({ credit, approve, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!approve && note.trim().length < 3) { setError('Say why you reject it.'); return; }
    setBusy(true); setError(null);
    try { await walletApi.decideCredit(credit.id, approve, note.trim() || undefined); onDone(); } catch (err) { setError(errText(err, 'It could not be saved.')); setBusy(false); }
  };
  return (
    <Dialog title={approve ? 'Approve this credit?' : 'Reject this credit?'} description={`${credit.name}: ${CREDIT_KIND_LABEL[credit.kind]} ${credit.amount < 0 ? '-' : '+'}${rupees(Math.abs(credit.amount))}`} onClose={() => { if (!busy) onClose(); }} persistent>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block text-sm font-medium text-slate-700">{approve ? 'Note (optional)' : 'Reason'}
          <textarea className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} aria-label={approve ? 'Note' : 'Reason'} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={busy} data-testid="credit-confirm" className={`h-10 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-60 ${approve ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button>
        </div>
      </form>
    </Dialog>
  );
};

const CreditForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<WalletPerson[]>([]);
  const [person, setPerson] = useState<WalletPerson | null>(null);
  const [kind, setKind] = useState<CreditKind>('BONUS');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newId());
  useEffect(() => {
    if (person || search.trim().length < 2) { setPeople([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => { walletApi.people(search.trim()).then(p => { if (alive) setPeople(p); }, () => { if (alive) setPeople([]); }); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [search, person]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = Math.round(Number(amount) * 100) / 100;
    if (!person) { setError('Choose the employee.'); return; }
    if (!Number.isFinite(n) || n === 0) { setError('Enter an amount.'); return; }
    if (kind !== 'ADJUSTMENT' && n < 0) { setError('A bonus or a refund is a positive amount. Use an Adjustment to take money off.'); return; }
    if (description.trim().length < 3) { setError('Say what it is for.'); return; }
    setBusy(true); setError(null);
    try {
      await walletApi.createCredit({ profileId: person.id, kind, amount: n, description: description.trim(), reference: reference.trim() || undefined, requestId: requestId.current });
      requestId.current = newId();   // the next credit is a new one; a retry of THIS one reused the same id
      setPerson(null); setSearch(''); setAmount(''); setDescription(''); setReference(''); setBusy(false);
      onSaved();
    } catch (err) { setError(errText(err, 'It could not be saved.')); setBusy(false); }
  };
  return (
    <Section title="Add a wallet credit" hint="A bonus, an adjustment (up or down) or a refund. It reaches the wallet only after a different Accounts person approves it.">
      <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2" noValidate data-testid="credit-form">
        <div className="sm:col-span-2 relative">
          <label className="block text-sm font-medium text-slate-700" htmlFor="wc-person">Employee</label>
          {person ? (
            <div className="mt-1 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span><strong>{person.name}</strong> <span className="text-slate-500">· {person.department ?? 'No department'}</span></span>
              <button type="button" onClick={() => { setPerson(null); setSearch(''); }} className="text-xs font-semibold text-blue-700 hover:underline">Change</button>
            </div>
          ) : (
            <>
              <input id="wc-person" className={`${field} mt-1`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Type at least 2 letters of the name or e-mail" autoComplete="off" />
              {people.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" role="listbox" aria-label="Employees">
                  {people.map(p => (
                    <li key={p.id}><button type="button" role="option" aria-selected={false} onClick={() => setPerson(p)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className="font-semibold text-slate-900">{p.name}</span> <span className="text-slate-500">· {p.department ?? 'No department'} · {p.email}</span></button></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <label className="block text-sm font-medium text-slate-700">Type
          <select className={`${field} mt-1`} value={kind} onChange={e => setKind(e.target.value as CreditKind)}>{(Object.keys(CREDIT_KIND_LABEL) as CreditKind[]).map(k => <option key={k} value={k}>{CREDIT_KIND_LABEL[k]}</option>)}</select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Amount (₹){kind === 'ADJUSTMENT' ? ' (negative takes money off)' : ''}
          <input aria-label="Amount (₹)" type="number" inputMode="decimal" step="0.01" className={`${field} mt-1`} value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">What it is for
          <input aria-label="What it is for" className={`${field} mt-1`} value={description} maxLength={300} onChange={e => setDescription(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">Reference (optional: the same reference is never credited twice to one person)
          <input aria-label="Reference" className={`${field} mt-1`} value={reference} maxLength={120} onChange={e => setReference(e.target.value)} />
        </label>
        {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
        <div className="sm:col-span-2 flex justify-end">
          <button type="submit" disabled={busy} data-testid="credit-submit" className="h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60">{busy ? 'Saving…' : 'Send for approval'}</button>
        </div>
      </form>
    </Section>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ report
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const Report: React.FC = () => {
  const now = new Date();
  const [from, setFrom] = useState(`${ymd(now).slice(0, 8)}01`);
  const [to, setTo] = useState(ymd(now));
  const [data, setData] = useState<WalletReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    walletApi.report(from, to).then(setData, e => setError(errText(e, 'The report could not be loaded.'))).finally(() => setLoading(false));
  }, [from, to]);
  useEffect(load, [load]);
  const d = data;
  return (
    <div className="space-y-4" data-testid="wallet-report">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">From<input type="date" className={`${field} mt-1`} value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="Report from" /></label>
        <label className="text-xs text-slate-500">To<input type="date" className={`${field} mt-1`} value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="Report to" /></label>
        <button type="button" onClick={load} disabled={loading} aria-label="Refresh the report" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Salary payable a month" value={rupees(d.salary.monthlyPayable)} hint={`From HR records · ${d.salary.employeesWithoutSalary} without a figure · payroll not tracked`} testId="report-salary" />
            <Tile label="Incentives generated" value={rupees(d.incentives.generated)} hint={`${rupees(d.incentives.reversed)} reversed`} testId="report-generated" />
            <Tile label="Pending incentive approvals" value={rupees(d.incentives.pendingApproval)} hint="Incentives are credited at once" tone="muted" />
            <Tile label="Credited (net of reversals)" value={rupees(d.incentives.credited)} tone="strong" />
            <Tile label="Wallet credits credited" value={rupees(d.credits.credited)} hint={`${d.credits.pendingCount} waiting · ${rupees(d.credits.pendingAmount)}`} />
            <Tile label="Withdrawal requests" value={d.withdrawals.requestedCount} hint={rupees(d.withdrawals.requestedAmount)} />
            <Tile label="Pending withdrawals" value={d.withdrawals.pendingCount} hint={rupees(d.withdrawals.pendingAmount)} />
            <Tile label="Paid withdrawals" value={rupees(d.withdrawals.paidAmount)} hint={`${d.withdrawals.paidCount} paid · ${d.withdrawals.rejectedCount} rejected or cancelled`} />
          </div>
          <Section title="Department-wise">
            {d.departments.length === 0 ? <Empty>No data.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="report-departments">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th scope="col" className="px-4 py-2 font-semibold">Department</th><th scope="col" className="px-4 py-2 font-semibold text-right">Employees</th>
                  <th scope="col" className="px-4 py-2 font-semibold text-right">Incentives</th><th scope="col" className="px-4 py-2 font-semibold text-right">Credits</th><th scope="col" className="px-4 py-2 font-semibold text-right">Withdrawn</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.departments.map(r => (
                  <tr key={r.departmentId ?? 'none'}><td className="px-4 py-2.5 font-semibold text-slate-900">{r.department}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.employees}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.incentives)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.credits)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.withdrawn)}</td></tr>
                ))}</tbody></table></div>
            )}
          </Section>
          <Section title="Employee-wise earnings" hint={`${dayText(d.from)} to ${dayText(d.to)}; people with no activity are left out (at most 200).`}>
            {d.employees.length === 0 ? <Empty>No earnings in this period.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="report-employees">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th scope="col" className="px-4 py-2 font-semibold">Employee</th><th scope="col" className="px-4 py-2 font-semibold">Department</th>
                  <th scope="col" className="px-4 py-2 font-semibold text-right">Incentives</th><th scope="col" className="px-4 py-2 font-semibold text-right">Credits</th><th scope="col" className="px-4 py-2 font-semibold text-right">Withdrawn</th><th scope="col" className="px-4 py-2 font-semibold text-right">Available</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.employees.map(r => (
                  <tr key={r.profileId}><td className="px-4 py-2.5 font-semibold text-slate-900">{r.name}</td><td className="px-4 py-2.5 text-slate-600">{r.department ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.incentives)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.credits)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.withdrawn)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.available)}</td></tr>
                ))}</tbody></table></div>
            )}
          </Section>
          <Section title="Monthly financial summary" hint="The last twelve months, all employees.">
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="report-months">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th scope="col" className="px-4 py-2 font-semibold">Month</th><th scope="col" className="px-4 py-2 font-semibold text-right">Incentives</th>
                <th scope="col" className="px-4 py-2 font-semibold text-right">Wallet credits</th><th scope="col" className="px-4 py-2 font-semibold text-right">Withdrawn</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.months.map(m => (
                <tr key={m.month}><td className="px-4 py-2.5 font-semibold text-slate-900">{monthLabel(m.month)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(m.incentives)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(m.credits)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(m.withdrawn)}</td></tr>
              ))}</tbody></table></div>
          </Section>
        </>
      )}
    </div>
  );
};

export default WalletAdmin;

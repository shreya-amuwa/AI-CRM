import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Wallet } from 'lucide-react';
import { rupees } from '../../lib/income';
import { payoutsApi, STATUS_LABEL as PAYOUT_LABEL, STATUS_TONE as PAYOUT_TONE, methodLine, type PayoutRequest } from '../../lib/payouts';
import { TYPE_LABEL, monthLabel, walletApi, type TransactionType, type WalletMonth, type WalletSummary, type WalletTransaction } from '../../lib/wallet';
import { PageTitle } from '../layout/shell';
import { WithdrawDialog } from '../income/WithdrawDialog';
import { Empty, Notice, Section, Tile, TransactionList, dayText, timeText } from './walletParts';
import { confirmAction } from '../feedback/AppFeedback';
import { WalletPinGate } from './WalletPinGate';

/**
 * The Wallet, in the side panel of every employee dashboard (20270207000100; docs/EMPLOYEE_WALLET.md). Every figure is read from the database for the
 * signed-in person only. It is a view over what already exists: incentives are credited when their rule triggers, withdrawals go to Accounts, bonuses and
 * adjustments are entered by Accounts and approved by a second person. Salary is shown as EXPECTED only until payroll is recorded in the CRM; it is never
 * part of what can be withdrawn.
 */
/** The wallet behind its PIN (20270220000100): nothing below is loaded until the PIN was entered in this sign-in. */
export const WalletPage: React.FC = () => <WalletPinGate><WalletContent /></WalletPinGate>;

type Tab = 'overview' | 'earnings' | 'incentives' | 'salary' | 'withdrawals' | 'transactions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'earnings', label: 'Earnings' }, { id: 'incentives', label: 'Incentives' },
  { id: 'salary', label: 'Salary' }, { id: 'withdrawals', label: 'Withdrawals' }, { id: 'transactions', label: 'Transactions' }
];
const TYPES = Object.keys(TYPE_LABEL) as TransactionType[];
const PAGE = 20;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const money = (n: number | null | undefined) => (n == null ? 'Not recorded' : rupees(n));

const WalletContent: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [months, setMonths] = useState<WalletMonth[] | null>(null);
  const [recent, setRecent] = useState<WalletTransaction[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<PayoutRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'withdraw' | 'details' | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;   // a slower, older answer never replaces a newer one
    setLoading(true); setError(null);
    try {
      const [s, m, t, w] = await Promise.all([
        walletApi.summary(), walletApi.monthly(12), walletApi.transactions({ limit: 6 }), payoutsApi.mine().catch(() => [] as PayoutRequest[])
      ]);
      if (mine !== seq.current) return;
      setSummary(s); setMonths(m ?? []); setRecent(t.items); setWithdrawals(w ?? []);
    } catch (e) {
      if (mine === seq.current) setError(errText(e, 'Your wallet could not be loaded.'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const s = summary;
  const w = s?.withdrawals;
  const available = s?.availableToWithdraw ?? 0;
  const openReq = w?.openRequest ?? null;
  const canWithdraw = !!s && !!w && w.open && !openReq && available >= w.minimum;
  const withdrawNote = !s || !w ? null
    : w.opensOn == null ? `Withdrawals open ${w.startAfterDays} days after HR records your joining date.`
    : !w.open ? `Withdrawals open on ${dayText(w.opensOn)}.`
    : openReq ? `Your withdrawal of ${rupees(openReq.amount)} is waiting for Accounts. It is set aside, so it is not in the amount you can withdraw.`
    : available < w.minimum ? `You can withdraw once at least ${rupees(w.minimum)} is available.`
    : null;

  const cancel = async (id: string) => {
    if (!(await confirmAction({ title: 'Cancel this withdrawal request?', description: 'The amount goes back to your available balance.', confirmLabel: 'Cancel withdrawal', cancelLabel: 'Keep request', variant: 'destructive' }))) return;
    try { await payoutsApi.cancel(id); setNotice('Withdrawal cancelled.'); void load(); } catch (e) { setError(errText(e, 'It could not be cancelled.')); }
  };
  const slip = (id: string) => { payoutsApi.downloadSlip(id).catch(e => setError(errText(e, 'The slip could not be downloaded.'))); };

  if (s && !s.eligible) {
    return <div className="space-y-6"><PageTitle title="Wallet" /><Notice tone="info">There is no wallet for this account.</Notice></div>;
  }
  return (
    <div className="space-y-5" data-testid="wallet-page">
      <PageTitle
        title="Wallet"
        subtitle="Your earnings and what you can withdraw. Only you see this page."
        actions={<button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh the wallet"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {/* the main wallet card */}
      <section aria-label="Wallet balance" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="wallet-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Wallet className="w-5 h-5" aria-hidden /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total wallet balance</p>
              <p className="text-3xl font-extrabold tabular-nums text-slate-900" data-testid="wallet-balance">{s ? rupees(s.balance) : '…'}</p>
            </div>
          </div>
          <button type="button" onClick={() => setTab('withdrawals')} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">Withdraw</button>
        </div>
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Available for withdrawal" tone="strong" testId="wallet-available" value={s ? rupees(s.availableToWithdraw) : '…'}
            hint={s && s.toRecover > 0 ? `${rupees(s.toRecover)} to be recovered from future earnings` : 'Credited incentives and bonuses'} />
          <Tile label="Pending earnings" testId="wallet-pending" value={s ? rupees(s.pending.credits) : '…'} hint={s && s.pending.creditCount > 0 ? `${s.pending.creditCount} waiting for approval` : 'Nothing waiting'} />
          <Tile label="This month's salary" testId="wallet-salary-month" value={s ? money(s.thisMonth.salaryExpected) : '…'} hint="Expected, not yet credited" />
          <Tile label="This month's incentives" testId="wallet-incentives-month" value={s ? rupees(s.thisMonth.incentives) : '…'} hint={s && s.thisMonth.bonuses > 0 ? `plus ${rupees(s.thisMonth.bonuses)} bonus` : undefined} />
        </div>
      </section>

      <div role="tablist" aria-label="Wallet sections" className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`wallet-tab-${t.id}`}
            className={`h-9 shrink-0 rounded-xl border px-3.5 text-sm font-semibold ${tab === t.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && s && (
        <div className="space-y-4" role="tabpanel" aria-label="Overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="What is in your wallet" hint="Credited money only. Nothing pending counts until it is credited.">
              <dl className="divide-y divide-slate-100 text-sm">
                {([
                  ['Incentives credited', s.incentives.credited], ['Incentives reversed', -s.incentives.reversed], ['Bonuses credited', s.bonuses.credited],
                  ['Adjustments and refunds', s.adjustments.net + s.adjustments.refunds], ['Withdrawn (paid out)', -s.withdrawals.total]
                ] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">{k}</dt><dd className="font-semibold tabular-nums text-slate-900">{rupees(v || 0)}</dd></div>
                ))}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50"><dt className="font-bold text-slate-900">Wallet balance</dt><dd className="font-extrabold tabular-nums text-slate-900">{rupees(s.balance)}</dd></div>
                {s.reserved > 0 && <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Set aside for your open withdrawal</dt><dd className="font-semibold tabular-nums text-slate-900">-{rupees(s.reserved)}</dd></div>}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-50"><dt className="font-bold text-emerald-900">Available for withdrawal</dt><dd className="font-extrabold tabular-nums text-emerald-800">{rupees(s.availableToWithdraw)}</dd></div>
              </dl>
            </Section>
            <Section title="Salary and what counts" hint="Your salary is paid through payroll. It is shown here as expected and is not withdrawable.">
              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Expected monthly salary</dt><dd className="font-semibold tabular-nums text-slate-900">{money(s.salary.expected)}</dd></div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Approved / credited salary</dt><dd className="text-slate-500">Not recorded yet</dd></div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-slate-600">Withdrawable salary</dt><dd className="font-semibold tabular-nums text-slate-900">{rupees(0)}</dd></div>
              </dl>
            </Section>
          </div>
          <Section title="Last six months" right={<button type="button" onClick={() => setTab('earnings')} className="text-xs font-semibold text-blue-700 hover:underline">All months</button>}>
            <MonthTable months={(months ?? []).slice(0, 6)} />
          </Section>
          <Section title="Recent transactions" right={<button type="button" onClick={() => setTab('transactions')} className="text-xs font-semibold text-blue-700 hover:underline">All transactions</button>}>
            <TransactionList items={recent ?? []} />
          </Section>
        </div>
      )}

      {tab === 'earnings' && (
        <div className="space-y-4" role="tabpanel" aria-label="Earnings">
          <Section title="Monthly earnings" hint="Incentives and bonuses credited in each month, and what you withdrew."><MonthTable months={months ?? []} /></Section>
        </div>
      )}

      {tab === 'incentives' && s && (
        <div className="space-y-4" role="tabpanel" aria-label="Incentives">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile label="Pending incentives" value={rupees(s.incentives.pendingApproval)} hint="None wait for approval" tone="muted" />
            <Tile label="Approved incentives" value={rupees(s.incentives.approved)} hint="Approved and credited at once" tone="muted" />
            <Tile label="Credited incentives" value={rupees(s.incentives.credited)} tone="strong" testId="wallet-incentives-credited" />
            <Tile label="Paid incentives" value={rupees(s.incentives.paidOut)} hint="Withdrawn so far" />
            <Tile label="Reversed" value={rupees(s.incentives.reversed)} hint="Taken back when a payment is reversed" />
          </div>
          <Notice tone="info">An incentive is credited to your wallet as soon as its rule is met (for example when Accounts verifies a customer's payment). If that payment is reversed, the incentive is reversed too and you are told.</Notice>
          <IncentiveLedger />
        </div>
      )}

      {tab === 'salary' && s && (
        <div className="space-y-4" role="tabpanel" aria-label="Salary">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Monthly salary" testId="wallet-salary" value={money(s.salary.monthly)} hint={s.salary.monthlyText && s.salary.monthly == null ? `HR record: ${s.salary.monthlyText}` : s.salary.source ? 'From your HR record' : 'HR has not recorded it'} />
            <Tile label="Expected salary" value={money(s.salary.expected)} hint="For this month" tone="muted" />
            <Tile label="Approved salary" value="Not recorded" hint="Payroll is not in the CRM yet" tone="muted" />
            <Tile label="Salary credited" value="Not recorded" hint="Nothing is credited to the wallet" tone="muted" />
          </div>
          <Section title="How your salary and your wallet fit together">
            <ul className="list-disc space-y-1.5 px-8 py-4 text-sm text-slate-600">
              <li><strong>Expected</strong> is the monthly salary HR recorded for you. It is not money in your wallet.</li>
              <li><strong>Approved</strong> and <strong>credited</strong> salary will appear here when payroll is recorded in the CRM. Until a salary is credited it is never withdrawable.</li>
              <li><strong>Withdrawable</strong> money is only credited incentives and bonuses (shown under Withdrawals).</li>
              <li>Basic pay, fixed and variable components, the payment date and the salary history are not recorded in the CRM yet.</li>
            </ul>
          </Section>
          <Section title="Salary history"><Empty>No salary credits yet.</Empty></Section>
        </div>
      )}

      {tab === 'withdrawals' && s && w && (
        <div className="space-y-4" role="tabpanel" aria-label="Withdrawals">
          <section aria-label="Withdraw" className="rounded-2xl border border-emerald-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available to withdraw</p>
                <p className="text-3xl font-extrabold tabular-nums text-emerald-800" data-testid="withdraw-available">{rupees(available)}</p>
                {s.toRecover > 0 && <p className="text-xs text-slate-500">{rupees(s.toRecover)} to be recovered from future earnings</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDialog('details')} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50">Payout details</button>
                <button type="button" onClick={() => setDialog('withdraw')} disabled={!canWithdraw} data-testid="wallet-withdraw"
                  className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">Withdraw</button>
              </div>
            </div>
            {withdrawNote && <p className="mt-3 text-xs text-slate-600" role="status" data-testid="withdraw-note">{withdrawNote}</p>}
            <p className="mt-2 text-xs text-slate-500">Only credited incentives and bonuses can be withdrawn: not pending items and not uncredited salary. At least {rupees(w.minimum)} at a time, one request at a time. Accounts approves and pays it.</p>
          </section>
          <Section title="Withdrawal history" hint="Each request, its status, and when Accounts processed it.">
            {withdrawals.length === 0 ? <Empty>You have not withdrawn anything yet.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {withdrawals.map(r => (
                  <li key={r.id} data-testid="withdrawal-row" className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{rupees(r.amount)} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAYOUT_TONE[r.status]}`}>{PAYOUT_LABEL[r.status]}</span></p>
                      <p className="text-xs text-slate-500 break-words">Requested {timeText(r.requestedAt)} · {methodLine(r.method)}</p>
                      {r.decidedAt && <p className="text-xs text-slate-500">{r.status === 'REJECTED' ? 'Rejected' : r.status === 'CANCELLED' ? 'Cancelled' : 'Processed'} {timeText(r.decidedAt)}{r.decidedBy ? ` by ${r.decidedBy}` : ''}</p>}
                      {r.status === 'PAID' && <p className="text-xs text-slate-600">Paid {r.paidOn ? dayText(r.paidOn) : ''}{r.reference ? ` · ref ${r.reference}` : ''}{r.tdsAmount ? ` · TDS ${rupees(r.tdsAmount)} · net ${rupees(r.netAmount ?? 0)}` : ''}</p>}
                      {r.reason && <p className="text-xs text-rose-700" data-testid="withdrawal-reason">Reason: {r.reason}</p>}
                    </div>
                    <div className="flex gap-2">
                      {(r.status === 'PAID' || r.status === 'REVERSED') && <button type="button" onClick={() => slip(r.id)} className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold">Download slip</button>}
                      {r.status === 'REQUESTED' && <button type="button" onClick={() => void cancel(r.id)} className="h-9 px-3 rounded-xl border border-rose-200 bg-white text-xs font-semibold text-rose-700">Cancel withdrawal</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {tab === 'transactions' && <div role="tabpanel" aria-label="Transactions"><Transactions /></div>}

      {dialog && <WithdrawDialog available={available} editOnly={dialog === 'details'} onClose={() => setDialog(null)}
        onDone={() => { setNotice(dialog === 'details' ? 'Payout details saved.' : 'Withdrawal requested. Accounts will review it; you will be notified.'); setDialog(null); void load(); }} />}
    </div>
  );
};

const MonthTable: React.FC<{ months: WalletMonth[] }> = ({ months }) => {
  if (months.length === 0) return <Empty>No earnings yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="wallet-months">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <th scope="col" className="px-4 py-2 font-semibold">Month</th><th scope="col" className="px-4 py-2 font-semibold text-right">Incentives</th><th scope="col" className="px-4 py-2 font-semibold text-right">Bonuses</th>
          <th scope="col" className="px-4 py-2 font-semibold text-right">Adjustments</th><th scope="col" className="px-4 py-2 font-semibold text-right">Reversed</th><th scope="col" className="px-4 py-2 font-semibold text-right">Withdrawn</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {months.map(m => (
            <tr key={m.month} data-testid="wallet-month-row">
              <td className="px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{monthLabel(m.month)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{rupees(m.incentives)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{rupees(m.bonuses)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{rupees(m.adjustments)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">{m.reversed ? `-${rupees(m.reversed)}` : rupees(0)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{rupees(m.withdrawn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** The incentive credits and their reversals (the ledger rows of those two types). */
const IncentiveLedger: React.FC = () => {
  const [items, setItems] = useState<WalletTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([walletApi.transactions({ type: 'INCENTIVE_CREDIT', limit: 50 }), walletApi.transactions({ type: 'REVERSAL', limit: 50 })])
      .then(([a, b]) => { if (alive) setItems([...a.items, ...b.items].sort((x, y) => y.date.localeCompare(x.date))); })
      .catch(e => { if (alive) setError(errText(e, 'The incentives could not be loaded.')); });
    return () => { alive = false; };
  }, []);
  return (
    <Section title="Your incentives" hint="Each incentive credited to your wallet, and any reversal.">
      {error ? <div className="p-4"><Notice tone="error">{error}</Notice></div> : items === null ? <Empty>Loading…</Empty> : <TransactionList items={items} empty="No incentive has been credited yet." />}
    </Section>
  );
};

/** All transactions, with a type and date filter and pages. */
const Transactions: React.FC = () => {
  const [type, setType] = useState<TransactionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: WalletTransaction[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setError(null);
    walletApi.transactions({ type, from, to, limit: PAGE, offset: page * PAGE })
      .then(d => { if (mine === seq.current) setData({ items: d.items, total: d.total }); })
      .catch(e => { if (mine === seq.current) setError(errText(e, 'The transactions could not be loaded.')); });
  }, [type, from, to, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const field = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm';
  return (
    <Section title="Transaction history" hint="Every credit and debit, newest first. The ledger is built from your earnings, credits and withdrawals; it cannot be edited."
      right={(
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="wallet-type">Type</label>
          <select id="wallet-type" className={field} value={type} onChange={e => { setType(e.target.value as TransactionType | ''); setPage(0); }} data-testid="wallet-filter-type">
            <option value="">All types</option>{TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <label className="text-xs text-slate-500 flex items-center gap-1">From<input type="date" className={field} value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPage(0); }} aria-label="From date" /></label>
          <label className="text-xs text-slate-500 flex items-center gap-1">To<input type="date" className={field} value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPage(0); }} aria-label="To date" /></label>
        </div>
      )}>
      {error ? <div className="p-4"><Notice tone="error">{error}</Notice></div> : data === null ? <Empty>Loading…</Empty> : <TransactionList items={data.items} empty={type || from || to ? 'No transactions match these filters.' : 'No transactions yet.'} />}
      {data && data.total > PAGE && (
        <nav aria-label="Pages" className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 text-xs">
          <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-8 rounded-lg border border-slate-200 bg-white px-3 font-semibold disabled:opacity-40">Previous</button>
          <span className="tabular-nums text-slate-500">Page {page + 1} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="h-8 rounded-lg border border-slate-200 bg-white px-3 font-semibold disabled:opacity-40">Next</button>
        </nav>
      )}
    </Section>
  );
};

export default WalletPage;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';
import type { CompanyDepartmentRow, CompanyOverview as CompanyOverviewData, DashboardAlert } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { dashboardApi } from '../../lib/api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { Card, CardHead, ghostBtn, LoadingLine } from '../tasks/head/headParts';
import { money } from '../accounts/finance/FinanceBits';

/**
 * Super Admin: the company in one page. Everything shown is a figure the database worked out from the real records
 * (supabase/migrations/20261110000100_dashboards_overview.sql): this page adds nothing of its own and invents nothing.
 *   1. how is the company doing (a compact KPI strip)  2. income vs expense, month by month
 *   3. how is each department doing                      4. what needs attention, and what just happened
 */

const monthShort = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const monthLong = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);
/** Axis labels: 1.2L, 3.4Cr ... (Indian grouping), whole numbers below a thousand. */
const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};
/** A round number at or above `max`, so the axis ends on a tidy value. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}
const change = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100));
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const ACTIVITY_LABEL: Record<string, string> = {
  CALL: 'Call', MEETING: 'Meeting', EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', NOTE: 'Note', STAGE_CHANGE: 'Stage change', LEAD_NOTE: 'Lead note',
  SENT_TO_ACCOUNTS: 'Sent to Accounts', PAYMENT_RECORDED: 'Payment recorded', PAYMENT_VERIFIED: 'Payment verified'
};
const activityLabel = (t: string) => ACTIVITY_LABEL[t] ?? t.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const SEVERITY: Record<DashboardAlert['severity'], { dot: string; label: string }> = {
  high: { dot: 'bg-rose-500', label: 'Urgent' },
  medium: { dot: 'bg-amber-500', label: 'Soon' },
  low: { dot: 'bg-slate-400', label: 'Watch' }
};

export const CompanyOverview: React.FC<{ onOpenDepartment: (id: string) => void }> = ({ onOpenDepartment }) => {
  const { user } = useAuth();
  const [data, setData] = useState<CompanyOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    dashboardApi.company().then(
      d => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      e => {
        setError(errorMessage(e));
        setLoading(false);
      }
    );
  }, []);
  useEffect(() => {
    load();
    // Money and customers change all day: refresh when something changes in this tab, and when the tab is shown again.
    const run = () => load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    window.addEventListener('crm:pipeline-changed', run);
    window.addEventListener('crm:finance-changed', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('crm:pipeline-changed', run);
      window.removeEventListener('crm:finance-changed', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  return (
    <div className="space-y-7">
      <PageTitle
        title={`${greeting}, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle="How the company is doing, how each department is doing, and what needs your attention."
        actions={
          <>
            {data && <span className="text-xs text-slate-500">Updated {new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button type="button" className={ghostBtn} onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
            </button>
          </>
        }
      />

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">The company figures could not be loaded: {error}. Nothing below is guessed; it appears when the records can be read.</span>
          <button type="button" className={ghostBtn} onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!data && !error && <LoadingLine label="Loading the company figures…" />}

      {data && (
        <>
          <KpiStrip d={data} />
          <TrendCard d={data} />
          <DepartmentPerformance rows={data.departments} onOpen={onOpenDepartment} />
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
            <Attention alerts={data.alerts.filter(a => a.key !== 'locked_departments')} />
            <Recent d={data} />
          </div>
          <Operations d={data} />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 1. KPI strip
// ---------------------------------------------------------------------------
const Kpi: React.FC<{ label: string; value: string; foot?: string; tone?: 'neutral' | 'red' | 'green' }> = ({ label, value, foot, tone = 'neutral' }) => (
  <div className="px-5 py-4 min-w-0 bg-white">
    <dt className="text-[13px] font-semibold text-slate-500 truncate">{label}</dt>
    <dd className={`mt-1 text-[26px] leading-none font-extrabold truncate ${tone === 'red' ? 'text-rose-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</dd>
    {foot && <p className="mt-1.5 text-xs text-slate-500">{foot}</p>}
  </div>
);

const KpiStrip: React.FC<{ d: CompanyOverviewData }> = ({ d }) => {
  const m = d.money;
  const inc = change(m.incomeThisMonth, m.incomeLastMonth);
  const net = m.incomeThisMonth - m.expensesThisMonth;
  return (
    <section aria-label="Company summary" className="rounded-2xl border border-slate-200 overflow-hidden">
      <dl className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-px bg-slate-100">
        <Kpi
          label="Customers and leads"
          value={num(d.customers.total - d.customers.lost)}
          foot={`${num(d.customers.leads)} leads · ${num(d.customers.potential)} potential · ${num(d.customers.onboarding)} onboarding · ${num(d.customers.customers)} customers`}
        />
        <Kpi
          label="Income this month"
          value={money(m.incomeThisMonth)}
          foot={inc === null ? 'Verified payments (none last month to compare)' : `${inc >= 0 ? '+' : ''}${inc}% on last month (${money(m.incomeLastMonth)})`}
          tone="green"
        />
        <Kpi label="Expenses this month" value={money(m.expensesThisMonth)} foot={m.expensesPending > 0 ? `${money(m.expensesPending)} still to be paid` : 'Recorded expenses'} />
        <Kpi label="Net this month" value={money(net)} foot="Income minus expenses" tone={net < 0 ? 'red' : 'neutral'} />
        <Kpi
          label="Outstanding balance"
          value={money(m.outstandingBalance)}
          foot={`${num(m.customersWithBalance)} customer${m.customersWithBalance === 1 ? '' : 's'} still owe a balance`}
        />
        <Kpi
          label="Awaiting confirmation"
          value={num(m.pendingConfirmations)}
          foot={m.pendingConfirmations ? `${money(m.pendingConfirmationsAmount)} agreed, with Accounts` : 'Nothing waiting for Accounts'}
          tone={m.pendingConfirmations ? 'red' : 'neutral'}
        />
      </dl>
    </section>
  );
};

// ---------------------------------------------------------------------------
// 2. Income vs expense (full width)
// ---------------------------------------------------------------------------
const TrendCard: React.FC<{ d: CompanyOverviewData }> = ({ d }) => {
  const months = d.trend;
  const [hover, setHover] = useState<number | null>(null);
  const top = useMemo(() => niceMax(Math.max(...months.flatMap(x => [x.income, x.expenses]), 0)), [months]);
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const has = months.some(x => x.income > 0 || x.expenses > 0);
  const totalIncome = months.reduce((n, x) => n + x.income, 0);
  const totalExpenses = months.reduce((n, x) => n + x.expenses, 0);
  const shown = hover === null ? null : months[hover];

  return (
    <Card label="Income vs expense trend">
      <CardHead
        title="Income vs Expense Trend"
        hint="Verified payments received, and expenses recorded, month by month (the same figures Accounts reports)."
        right={
          <div className="flex items-center gap-4 text-xs text-slate-600" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Income</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-rose-400" /> Expenses</span>
          </div>
        }
      />
      <div className="px-5 pb-5">
        {!has ? (
          <p className="py-14 text-center text-sm text-slate-500" role="status">
            No income or expenses recorded in the last {months.length} months. Income appears when Accounts verifies a payment; expenses when they are recorded.
          </p>
        ) : (
          <>
            <div className="flex gap-3">
              <div className="w-12 shrink-0 flex flex-col justify-between h-60 text-[11px] text-slate-500 text-right pb-6" aria-hidden="true">
                {ticks.map(t => (
                  <span key={t}>{t === 0 ? '0' : compact(top * t)}</span>
                ))}
              </div>
              <div className="flex-1 min-w-0 overflow-x-auto">
                <div className="relative h-60 min-w-[34rem]" role="img" aria-label={`Income ${money(totalIncome)} and expenses ${money(totalExpenses)} over the last ${months.length} months`}>
                  <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between pointer-events-none" aria-hidden="true">
                    {ticks.map(t => (
                      <div key={t} className={`border-t ${t === 0 ? 'border-slate-300' : 'border-slate-100'}`} />
                    ))}
                  </div>
                  <ul className="absolute inset-0 flex items-stretch gap-1.5 sm:gap-3">
                    {months.map((x, i) => (
                      <li
                        key={x.month}
                        className="flex-1 min-w-0 flex flex-col"
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(i)}
                        onBlur={() => setHover(null)}
                        tabIndex={0}
                        aria-label={`${monthLong(x.month)}: income ${money(x.income)}, expenses ${money(x.expenses)}, net ${money(x.net)}`}
                      >
                        <div className={`flex-1 flex items-end justify-center gap-1 pb-0 ${hover === i ? 'bg-slate-50 rounded-t-lg' : ''}`}>
                          <div className="w-1/2 max-w-[26px] rounded-t-md bg-emerald-500" style={{ height: `${(x.income / top) * 100}%`, minHeight: x.income > 0 ? 3 : 0 }} />
                          <div className="w-1/2 max-w-[26px] rounded-t-md bg-rose-400" style={{ height: `${(x.expenses / top) * 100}%`, minHeight: x.expenses > 0 ? 3 : 0 }} />
                        </div>
                        <span className={`h-6 pt-1.5 text-center text-[11px] ${i === months.length - 1 ? 'font-extrabold text-slate-900' : 'text-slate-500'}`}>{monthShort(x.month)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm min-h-[2.25rem]" aria-live="polite">
              {shown ? (
                <>
                  <strong className="text-slate-900">{monthLong(shown.month)}</strong>
                  <span className="text-emerald-700">Income {money(shown.income)}</span>
                  <span className="text-rose-700">Expenses {money(shown.expenses)}</span>
                  <span className={shown.net < 0 ? 'text-rose-700 font-bold' : 'text-slate-900 font-bold'}>Net {money(shown.net)}</span>
                </>
              ) : (
                <>
                  <span className="text-slate-600">Last {months.length} months:</span>
                  <span className="text-emerald-700">Income {money(totalIncome)}</span>
                  <span className="text-rose-700">Expenses {money(totalExpenses)}</span>
                  <span className={totalIncome - totalExpenses < 0 ? 'text-rose-700 font-bold' : 'text-slate-900 font-bold'}>Net {money(totalIncome - totalExpenses)}</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 3. Department performance
// ---------------------------------------------------------------------------
type SortKey = 'income' | 'records' | 'outstanding' | 'tickets';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'income', label: 'Income' },
  { id: 'records', label: 'Customers' },
  { id: 'outstanding', label: 'Balance due' },
  { id: 'tickets', label: 'Open tickets' }
];

const DepartmentPerformance: React.FC<{ rows: CompanyDepartmentRow[]; onOpen: (id: string) => void }> = ({ rows, onOpen }) => {
  const [sort, setSort] = useState<SortKey>('income');
  const active = rows.filter(r => r.records > 0 || r.income > 0 || r.expenses > 0 || r.openTickets > 0);
  const quiet = rows.length - active.length;
  const sorted = [...active].sort((a, b) => {
    const k = (r: CompanyDepartmentRow) => (sort === 'income' ? r.income : sort === 'records' ? r.records - r.lost : sort === 'outstanding' ? r.outstanding : r.openTickets);
    return k(b) - k(a) || a.name.localeCompare(b.name);
  });
  const maxRecords = Math.max(1, ...sorted.map(r => r.records - r.lost));

  return (
    <Card label="Department performance">
      <CardHead
        title="Department Performance"
        hint="Each department's customers, income and open work. Conversion is customers in onboarding or won, out of everyone not lost."
        right={
          <div className="flex items-center gap-1.5 text-xs" role="group" aria-label="Sort departments by">
            <span className="text-slate-500 mr-1">Sort by</span>
            {SORTS.map(s => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                className={`h-8 px-3 rounded-full font-bold ${sort === s.id ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      />
      {sorted.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-slate-500" role="status">No department has customer records, income or tickets yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[56rem]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                <th className="py-2.5 pl-5 pr-3 font-semibold">Department</th>
                <th className="py-2.5 px-3 font-semibold w-56">Leads → onboarding → customers</th>
                <th className="py-2.5 px-3 font-semibold text-right">Conversion</th>
                <th className="py-2.5 px-3 font-semibold text-right">Income</th>
                <th className="py-2.5 px-3 font-semibold text-right">Expenses</th>
                <th className="py-2.5 px-3 font-semibold text-right">Balance due</th>
                <th className="py-2.5 px-3 font-semibold text-right">Open tickets</th>
                <th className="py-2.5 pl-3 pr-5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const live = r.records - r.lost;
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="py-3 pl-5 pr-3">
                      <div className="font-bold text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        {r.staff} staff
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {live > 0 ? (
                        <>
                          <div className="flex h-2 rounded-full overflow-hidden bg-slate-100" style={{ width: `${Math.max(12, (live / maxRecords) * 100)}%` }} role="img" aria-label={`${r.leads + r.potential} leads, ${r.onboarding} in onboarding, ${r.customers} customers`}>
                            <i className="bg-slate-300" style={{ width: `${((r.leads + r.potential) / live) * 100}%` }} />
                            <i className="bg-blue-500" style={{ width: `${(r.onboarding / live) * 100}%` }} />
                            <i className="bg-emerald-500" style={{ width: `${(r.customers / live) * 100}%` }} />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {num(r.leads + r.potential)} · {num(r.onboarding)} · {num(r.customers)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">No customer records</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">{r.conversionPct === null ? '-' : `${r.conversionPct}%`}</td>
                    <td className="py-3 px-3 text-right">
                      <div className="font-semibold text-slate-900">{money(r.income)}</div>
                      <div className="text-xs text-slate-500">{money(r.incomeThisMonth)} this month</div>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700">{money(r.expenses)}</td>
                    <td className={`py-3 px-3 text-right ${r.outstanding > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{money(r.outstanding)}</td>
                    <td className="py-3 px-3 text-right">
                      <span className={r.pastSla > 0 ? 'font-bold text-rose-700' : 'text-slate-700'}>{num(r.openTickets)}</span>
                      {r.pastSla > 0 && <div className="text-xs text-rose-700">{r.pastSla} past SLA</div>}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right">
                      <button type="button" onClick={() => onOpen(r.slug)} className="inline-flex items-center gap-1 text-[13px] font-bold text-blue-700 hover:text-blue-800" aria-label={`Open ${r.name}`}>
                        Open <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {quiet > 0 && <p className="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">{quiet} other department{quiet === 1 ? ' has' : 's have'} no customer records, income or tickets yet.</p>}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 4. What needs attention, and what just happened
// ---------------------------------------------------------------------------
const Attention: React.FC<{ alerts: DashboardAlert[] }> = ({ alerts }) => (
  <Card label="Needs attention">
    <CardHead title="Needs your attention" hint="Exceptions found in the records right now." />
    {alerts.length === 0 ? (
      <p className="px-5 pb-7 text-sm text-slate-500" role="status">Nothing needs attention: no late confirmations, tickets past their SLA, overdue invoices or failed deliveries.</p>
    ) : (
      <ul className="px-3 pb-3 divide-y divide-slate-100">
        {alerts.map(a => (
          <li key={a.key} className="flex items-start gap-3 px-2.5 py-3">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${SEVERITY[a.severity].dot}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900">{a.title}</div>
              <div className="text-xs text-slate-500">{a.hint}</div>
            </div>
            <span className="text-right shrink-0">
              <span className="block text-lg font-extrabold text-slate-900 leading-none">{num(a.count)}</span>
              <span className="text-[11px] text-slate-500">{SEVERITY[a.severity].label}</span>
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const Recent: React.FC<{ d: CompanyOverviewData }> = ({ d }) => (
  <Card label="Recent activity">
    <CardHead title="Recent activity" hint="The latest notes, calls and updates logged on customers, across the company." />
    {d.recentActivity.length === 0 ? (
      <p className="px-5 pb-7 text-sm text-slate-500" role="status">No customer activity has been logged yet.</p>
    ) : (
      <ul className="px-3 pb-3 divide-y divide-slate-100">
        {d.recentActivity.map((a, i) => (
          <li key={`${a.at}-${i}`} className="px-2.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-slate-900 truncate">{a.customer}</span>
              <span className="text-xs text-slate-500 shrink-0">{ago(a.at)}</span>
            </div>
            <div className="text-xs text-slate-500">
              {activityLabel(a.type)}
              {a.department ? ` · ${a.department}` : ''}
              {a.actor ? ` · ${a.actor}` : ''}
            </div>
            {a.note && <p className="mt-1 text-[13px] text-slate-700 line-clamp-2">{a.note}</p>}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

// ---------------------------------------------------------------------------
// Operations: invoices, onboarding and support in one quiet row
// ---------------------------------------------------------------------------
const Operations: React.FC<{ d: CompanyOverviewData }> = ({ d }) => {
  const i = d.invoices;
  const o = d.onboarding;
  const t = d.tickets;
  const docs = o.itemsTotal > 0 ? Math.round((o.itemsVerified / o.itemsTotal) * 100) : null;
  return (
    <section aria-label="Operations" className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-6 px-1">
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">Invoices</h3>
        <dl className="mt-2 text-sm space-y-1">
          <Line k={`Paid (${num(i.paid)})`} v={money(i.paidAmount)} />
          <Line k={`Pending (${num(i.pending)})`} v={money(i.pendingAmount)} />
          <Line k={`Overdue (${num(i.overdue)})`} v={money(i.overdueAmount)} tone={i.overdue ? 'red' : undefined} />
          <Line k="Payments awaiting verification" v={`${num(d.money.unverifiedPayments)} · ${money(d.money.unverifiedPaymentsAmount)}`} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">Customer onboarding</h3>
        <dl className="mt-2 text-sm space-y-1">
          <Line k="In onboarding" v={num(o.inProgress)} />
          <Line k="With a Technical Consultant" v={num(o.withConsultant)} />
          <Line k="Onboarding items verified" v={docs === null ? '-' : `${num(o.itemsVerified)} of ${num(o.itemsTotal)} (${docs}%)`} />
          <Line k="No progress for 14 days" v={num(o.stalled)} tone={o.stalled ? 'red' : undefined} />
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">Support tickets</h3>
        <dl className="mt-2 text-sm space-y-1">
          <Line k="Open" v={num(t.open)} />
          <Line k="Escalated" v={num(t.escalated)} />
          <Line k="Nobody assigned" v={num(t.unassigned)} />
          <Line k="Past their SLA" v={num(t.pastSla)} tone={t.pastSla ? 'red' : undefined} />
        </dl>
      </div>
    </section>
  );
};

const Line: React.FC<{ k: string; v: string; tone?: 'red' }> = ({ k, v, tone }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="text-slate-600">{k}</dt>
    <dd className={`font-bold ${tone === 'red' ? 'text-rose-700' : 'text-slate-900'}`}>{v}</dd>
  </div>
);

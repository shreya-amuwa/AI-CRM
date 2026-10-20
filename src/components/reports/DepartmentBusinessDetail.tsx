import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, Info, Search, TriangleAlert } from 'lucide-react';
import type { BusinessDivision, BusinessOrder, BusinessOrdersPage, BusinessReport, BusinessSection, BusinessOrderState, DepartmentFinance } from '../../../shared/contracts';
import { businessReportApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { ErrorBanner, money, Pager, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { Card, CardHead, fieldCls, StatCard, Tabs } from '../tasks/head/headParts';
import { DEFINITIONS, EmployeeTable, presetRange, TransactionTable, TYPE_LABEL, when, type Preset } from './BusinessReports';

/**
 * Accounts → Department Income → one department: its Sales team's business and its Support team's business, apart.
 * Every figure comes from the database (business_report / _orders / _transactions) for this department; the browser adds nothing up
 * except to show how the pieces reconcile with the department's Earnings.
 */
export const DepartmentBusinessDetail: React.FC<{
  department: DepartmentFinance;
  accent?: string;
  logoUrl?: string | null;
  onBack: () => void;
}> = ({ department, accent = '#64748b', logoUrl, onBack }) => {
  const [preset, setPreset] = useState<Preset>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const range = useMemo(() => (preset === 'CUSTOM' ? { from: from || undefined, to: to || undefined } : presetRange(preset)), [preset, from, to]);
  const rangeError = range.from && range.to && range.to < range.from ? 'The end date is before the start date.' : null;
  const filters = useMemo(() => ({ ...range, departmentId: department.departmentId }), [range, department.departmentId]);

  const load = useCallback(() => {
    if (rangeError) return;
    const n = ++seq.current;
    setLoading(true);
    businessReportApi
      .report(filters)
      .then(r => {
        if (n !== seq.current) return;
        setReport(r);
        setError(null);
      })
      .catch(e => n === seq.current && setError(errorMessage(e)))
      .finally(() => n === seq.current && setLoading(false));
  }, [filters, rangeError]);
  useEffect(load, [load]);

  const net = department.income - department.expenses;
  return (
    <div className="space-y-6">
      <div>
        <button type="button" onClick={onBack} data-testid="back-to-departments" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-blue-700 hover:text-blue-800">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Department Income
        </button>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {logoUrl ? (
            <div className="w-12 h-12 rounded-xl bg-white p-1 border border-slate-200 flex items-center justify-center shrink-0">
              <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: accent }} aria-hidden="true">
              <Building2 className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900 truncate">{department.name}</h1>
            <p className="text-[15px] text-slate-600">Business by the Sales team and the Support team, from the real payment records.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Department overview">
        <StatCard label="Earnings" value={money(department.income)} tone="green" foot={`${department.incomeCount} verified payment${department.incomeCount === 1 ? '' : 's'} · all time`} />
        <StatCard label="Expenses" value={money(department.expenses)} tone="red" foot={`${department.expenseCount} record${department.expenseCount === 1 ? '' : 's'}${department.expensesPending > 0 ? ` · ${money(department.expensesPending)} pending` : ''}`} />
        <StatCard label="Net" value={money(net)} tone={net < 0 ? 'red' : 'neutral'} foot="Earnings minus expenses" />
        <StatCard label="Outstanding" value={money(report?.organization.outstanding ?? 0)} tone={report?.organization.outstanding ? 'amber' : 'neutral'} foot="Still to collect on the orders below" />
      </div>

      <Card className="p-4 space-y-3" label="Period">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            label="Period"
            value={preset}
            onChange={setPreset}
            options={[
              { id: 'ALL', label: 'All time' },
              { id: 'TODAY', label: 'Today' },
              { id: '7', label: 'Last 7 Days' },
              { id: '30', label: 'Last 30 Days' },
              { id: 'MONTH', label: 'This month' },
              { id: 'CUSTOM', label: 'Custom Range' }
            ]}
          />
          {preset === 'CUSTOM' && (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="dbd-from">From</label>
              <input id="dbd-from" type="date" className={`${fieldCls} w-40`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
              <span className="text-slate-500 text-sm">to</span>
              <label className="sr-only" htmlFor="dbd-to">To</label>
              <input id="dbd-to" type="date" className={`${fieldCls} w-40`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            </div>
          )}
        </div>
        {rangeError && <p role="alert" className="text-sm font-semibold text-rose-700">{rangeError}</p>}
      </Card>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !report ? (
        <Spinner label="Loading the department's business…" />
      ) : report ? (
        <div className={`space-y-8 ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading}>
          <Reconciliation report={report} earnings={department} allTime={preset === 'ALL'} />
          <DivisionSection division="SALES" section={report.sections.sales} filters={filters} />
          <DivisionSection division="SUPPORT" section={report.sections.support} filters={filters} />
        </div>
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <summary className="cursor-pointer font-bold text-slate-900 inline-flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600" aria-hidden="true" /> How these numbers are calculated
        </summary>
        <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          {DEFINITIONS.map(([k, v]) => (
            <div key={k}>
              <dt className="font-bold text-slate-900">{k}</dt>
              <dd className="text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
};

/** Shows that Sales + Support (+ anything not yet classified) is exactly what the department's Earnings are made of. */
const Reconciliation: React.FC<{ report: BusinessReport; earnings: DepartmentFinance; allTime: boolean }> = ({ report, earnings, allTime }) => {
  const byType = (t: string) => report.sections.support?.byType.find(x => x.type === t)?.collected ?? 0;
  const sales = report.sections.sales?.collected ?? 0;
  const addon = byType('ADDON');
  const renewal = byType('RENEWAL');
  const plans = byType('SUBSCRIPTION');
  const unclassified = report.unclassified.collected;
  const parts = sales + addon + renewal + unclassified;
  const matches = Math.abs(parts - earnings.income) < 0.005;
  return (
    <div className="p-4 rounded-2xl bg-white border border-slate-200 text-sm text-slate-700 space-y-1" role="status" aria-label="Reconciliation with Earnings">
      <div className="font-extrabold text-slate-900">In this period, collected payments</div>
      <div>
        <b>{money(parts)}</b> = Sales {money(sales)} + Support add-ons {money(addon)} + Support renewals {money(renewal)}
        {unclassified > 0 ? ` + not yet classified ${money(unclassified)}` : ''}
        {plans > 0 && <span className="text-slate-500"> (monthly plans {money(plans)} are shown under Support and are not part of Earnings)</span>}
      </div>
      {allTime &&
        (matches ? (
          <div className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Matches this department's Earnings ({money(earnings.income)}).
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-amber-700 font-semibold">
            <TriangleAlert className="w-4 h-4" aria-hidden="true" /> Differs from Earnings ({money(earnings.income)}); the cards were loaded at different moments. Refresh to compare again.
          </div>
        ))}
    </div>
  );
};

const DivisionSection: React.FC<{
  division: BusinessDivision;
  section?: BusinessSection;
  filters: { from?: string; to?: string; departmentId?: string };
}> = ({ division, section: s, filters }) => {
  const sales = division === 'SALES';
  const title = sales ? 'Sales Team Business' : 'Support Team Business';
  const byType = (t: string) => s?.byType.find(x => x.type === t);
  const addon = byType('ADDON');
  const renewal = byType('RENEWAL');
  const plan = byType('SUBSCRIPTION');
  const empty = !s || (s.collected === 0 && s.pending === 0 && s.refunded === 0 && s.billed === 0 && s.transactions === 0);
  return (
    <section aria-label={title} className={`rounded-2xl border p-4 sm:p-6 space-y-5 ${sales ? 'border-blue-100 bg-blue-50/30' : 'border-emerald-100 bg-emerald-50/30'}`} data-testid={`section-${division.toLowerCase()}`}>
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">{title}</h2>
        <p className="text-[13px] text-slate-600">
          {sales ? 'Initial customer sales, credited to the salesperson who made them.' : 'Add-on purchases and renewals, credited to the Support team member responsible.'}
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={sales ? 'Total business generated' : 'Total Support business'} value={money(s?.collected ?? 0)} tone="green" foot="Collected (verified payments)" />
        <StatCard label="Billed" value={money(s?.billed ?? 0)} foot={`${s?.orders ?? 0} order${s?.orders === 1 ? '' : 's'} in this period`} />
        <StatCard label="Pending" value={money(s?.pending ?? 0)} tone="amber" foot="Recorded, not yet verified" />
        <StatCard label="Outstanding" value={money(s?.outstanding ?? 0)} tone={s?.outstanding ? 'amber' : 'neutral'} foot="Billed minus collected" />
      </div>
      <p className="text-xs text-slate-500">
        {s?.transactions ?? 0} collected payment{s?.transactions === 1 ? '' : 's'} · {s?.customers ?? 0} customer{s?.customers === 1 ? '' : 's'} · refunded {money(s?.refunded ?? 0)}
      </p>
      {!sales && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Add-on service revenue" value={money(addon?.collected ?? 0)} foot={`${addon?.transactions ?? 0} payments · pending ${money(addon?.pending ?? 0)} · outstanding ${money(addon?.outstanding ?? 0)}`} />
          <StatCard label="Renewal revenue" value={money(renewal?.collected ?? 0)} foot={`${renewal?.transactions ?? 0} payments · pending ${money(renewal?.pending ?? 0)} · outstanding ${money(renewal?.outstanding ?? 0)}`} />
          <StatCard label="Add-ons + renewals" value={money((addon?.collected ?? 0) + (renewal?.collected ?? 0))} tone="green" foot={plan ? `Monthly plans ${money(plan.collected)} counted separately` : 'Combined eligible business'} />
        </div>
      )}
      {empty && <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-4 text-center">No {sales ? 'Sales' : 'Support'} business recorded for this department in this period.</p>}
      <EmployeeTable title={sales ? 'Salesperson-wise business' : 'Support team member-wise business'} rows={s?.employees ?? []} />
      <OrdersTable title={sales ? 'Sales orders and invoices' : 'Support orders and invoices'} division={division} filters={filters} />
      <TransactionTable title={sales ? 'Sales transactions' : 'Support transactions'} division={division} filters={filters} />
    </section>
  );
};

const STATE_UI: Record<BusinessOrderState, { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  PARTLY_PAID: { label: 'Partly paid', cls: 'bg-amber-50 text-amber-700' },
  UNPAID: { label: 'Unpaid', cls: 'bg-rose-50 text-rose-700' }
};
const ORDERS_PAGE = 10;

const OrdersTable: React.FC<{ title: string; division: BusinessDivision; filters: { from?: string; to?: string; departmentId?: string } }> = ({ title, division, filters }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BusinessOrdersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);
  const key = JSON.stringify([filters, division, debounced]);
  useEffect(() => setPage(1), [key]);
  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    businessReportApi
      .orders({ ...filters, division, search: debounced || undefined, page, pageSize: ORDERS_PAGE })
      .then(d => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch(e => n === seq.current && setError(errorMessage(e)))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page]);
  useEffect(load, [load]);

  return (
    <Card label={title}>
      <CardHead
        title={title}
        hint="What each order was billed for, what is collected, pending and outstanding, and its invoices."
        right={
          <label className="relative">
            <span className="sr-only">Search orders</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer or employee" className={`${fieldCls} pl-9 w-52 h-9 text-[13px]`} />
          </label>
        }
      />
      {error && <div className="px-5 pb-3"><ErrorBanner message={error} onRetry={load} /></div>}
      {loading && !data ? (
        <Spinner label="Loading orders…" />
      ) : data && data.items.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-slate-500">No orders for these filters.</p>
      ) : (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                  <th className="py-2.5 pl-5 pr-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Employee</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Billed</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Collected</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Pending</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Outstanding</th>
                  <th className="py-2.5 px-3 font-semibold">Payment</th>
                  <th className="py-2.5 pl-3 pr-5 font-semibold">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((o: BusinessOrder) => (
                  <tr key={o.key} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap text-slate-600">{when(o.billedAt)}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{o.company || o.customerName}</div>
                      <div className="text-xs text-slate-500">{o.customerName}{o.customerCode ? ` · ${o.customerCode}` : ''}</div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800">{TYPE_LABEL[o.type]}</td>
                    <td className={`py-3 px-3 ${o.employeeName ? 'text-slate-800 font-semibold' : 'text-slate-400 italic'}`}>{o.employeeName ?? 'Not recorded'}</td>
                    <td className="py-3 px-3 text-right font-bold">{money(o.billed)}</td>
                    <td className="py-3 px-3 text-right text-emerald-700 font-bold">{money(o.collected)}</td>
                    <td className="py-3 px-3 text-right">{money(o.pending)}</td>
                    <td className="py-3 px-3 text-right">{money(o.outstanding)}</td>
                    <td className="py-3 px-3"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${STATE_UI[o.state].cls}`}>{STATE_UI[o.state].label}</span></td>
                    <td className="py-3 pl-3 pr-5 text-xs">
                      {o.invoices.length === 0 ? (
                        <span className="text-slate-400">No invoice yet</span>
                      ) : (
                        <ul className="space-y-1">
                          {o.invoices.map(i => (
                            <li key={i.invoiceId} className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-800">{i.number}</span>
                              <span className={`px-1.5 rounded-full font-bold ${i.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{i.paid ? 'Paid' : 'Pending'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > ORDERS_PAGE && <Pager page={page} pageSize={ORDERS_PAGE} total={data.total} noun="orders" onPage={setPage} />}
        </div>
      )}
    </Card>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, Info, Search } from 'lucide-react';
import type {
  BusinessDivision,
  BusinessEmployeeRow,
  BusinessPayStatus,
  BusinessPerson,
  BusinessReport,
  BusinessSection,
  BusinessTransaction,
  BusinessTransactionsPage,
  BusinessTxType,
  Department
} from '../../../shared/contracts';
import { businessReportApi, organizationApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { ErrorBanner, money, Pager, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { Card, CardHead, fieldCls, ghostBtn, StatCard, Tabs } from '../tasks/head/headParts';

/**
 * HR: Sales and Support business, by department and by employee, read from the real payment records.
 * Every number comes from the database (business_report / business_report_transactions); nothing is added up here.
 */

type Page = 'OVERVIEW' | BusinessDivision;
type Preset = 'TODAY' | '7' | '30' | 'MONTH' | 'ALL' | 'CUSTOM';

const TYPE_LABEL: Record<BusinessTxType, string> = {
  INITIAL_SALE: 'Initial sale',
  ADDON: 'Add-on service',
  RENEWAL: 'Renewal',
  SUBSCRIPTION: 'Subscription (plan)',
  UNCLASSIFIED: 'Not classified yet'
};
const STATUS_LABEL: Record<BusinessPayStatus, string> = { COLLECTED: 'Collected', PENDING: 'Pending', REFUNDED: 'Refunded' };
const STATUS_CLS: Record<BusinessPayStatus, string> = {
  COLLECTED: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  REFUNDED: 'bg-rose-50 text-rose-700'
};
const SOURCE_TYPES: Record<BusinessDivision, BusinessTxType[]> = { SALES: ['INITIAL_SALE'], SUPPORT: ['ADDON', 'RENEWAL', 'SUBSCRIPTION'] };

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateKey(d);
};
function presetRange(p: Preset): { from?: string; to?: string } {
  const today = dateKey(new Date());
  if (p === 'TODAY') return { from: today, to: today };
  if (p === '7') return { from: daysAgo(6), to: today };
  if (p === '30') return { from: daysAgo(29), to: today };
  if (p === 'MONTH') return { from: `${today.slice(0, 8)}01`, to: today };
  return {};
}
const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const DEFINITIONS: [string, string][] = [
  ['Collected', 'Payments Accounts has verified (money received). This is the same cash basis Accounts uses for income.'],
  ['Pending', 'Payments recorded but not yet verified. They are not collected revenue.'],
  ['Refunded', 'Payments that were reversed. They are taken out of collected.'],
  ['Billed', 'What was agreed or invoiced for the orders in the period: the agreed amount of a sale, the total of an add-on, the total of a renewal invoice.'],
  ['Outstanding', 'Billed minus collected for those orders, as of now (never below zero). An unpaid invoice is outstanding, never collected.'],
  ['Initial sale → Sales', 'The first sale of the services Sales agreed with the customer. It stays with Sales and the salesperson who submitted it, even if the customer is reassigned later.'],
  ['Add-on → Support', 'Every add-on a customer buys later is Support business, whichever department onboarded the customer.'],
  ['Renewal → Support', 'An additional invoice Accounts marks as a renewal. The Support member whose invoice request it answers is credited.'],
  ['Subscription → Support', 'A monthly plan Accounts activated as paid. The workflow does not record who is responsible, so it is listed under "Not recorded".'],
  ['Not counted', 'Rejected payments, support tickets without a payment, and additional invoices not yet classified (shown separately for review).']
];

export const BusinessReports: React.FC = () => {
  const [page, setPage] = useState<Page>('OVERVIEW');
  const [preset, setPreset] = useState<Preset>('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<BusinessPerson[]>([]);
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    organizationApi.departments().then(setDepartments, () => undefined);
    businessReportApi.people().then(setPeople, () => undefined);
  }, []);

  const range = useMemo(() => (preset === 'CUSTOM' ? { from: from || undefined, to: to || undefined } : presetRange(preset)), [preset, from, to]);
  const rangeError = range.from && range.to && range.to < range.from ? 'The end date is before the start date.' : null;
  const division = page === 'OVERVIEW' ? undefined : page;
  const filters = useMemo(
    () => ({
      ...range,
      departmentId: departmentId || undefined,
      employeeId: employeeId || undefined,
      type: (type || undefined) as BusinessTxType | undefined,
      status: (status || undefined) as BusinessPayStatus | undefined
    }),
    [range, departmentId, employeeId, type, status]
  );

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

  const peopleHere = people.filter(p => !division || (division === 'SALES' ? p.division === 'SALES' : p.division === 'SUPPORT') || p.division === null);
  const typeChoices = (division ? SOURCE_TYPES[division] : (Object.keys(TYPE_LABEL) as BusinessTxType[]).filter(t => t !== 'UNCLASSIFIED')) as BusinessTxType[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Business Reports</h1>
          <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">
            What Sales and Support brought in, by department and by employee, from the real payment records.
          </p>
        </div>
        <Tabs
          label="Report"
          value={page}
          onChange={v => {
            setPage(v);
            setType('');
          }}
          options={[
            { id: 'OVERVIEW', label: 'Overview' },
            { id: 'SALES', label: 'Sales' },
            { id: 'SUPPORT', label: 'Support' }
          ]}
        />
      </div>

      <Card className="p-4 space-y-3" label="Filters">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            label="Period"
            value={preset}
            onChange={setPreset}
            options={[
              { id: 'TODAY', label: 'Today' },
              { id: '7', label: 'Last 7 Days' },
              { id: '30', label: 'Last 30 Days' },
              { id: 'MONTH', label: 'This month' },
              { id: 'ALL', label: 'All time' },
              { id: 'CUSTOM', label: 'Custom Range' }
            ]}
          />
          {preset === 'CUSTOM' && (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="br-from">From</label>
              <input id="br-from" type="date" className={`${fieldCls} w-40`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
              <span className="text-slate-500 text-sm">to</span>
              <label className="sr-only" htmlFor="br-to">To</label>
              <input id="br-to" type="date" className={`${fieldCls} w-40`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            </div>
          )}
        </div>
        {rangeError && <p role="alert" className="text-sm font-semibold text-rose-700">{rangeError}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-[13px] font-bold text-slate-700">
            Department
            <select className={`${fieldCls} mt-1.5 font-medium`} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-bold text-slate-700">
            Employee
            <select className={`${fieldCls} mt-1.5 font-medium`} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {peopleHere.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-bold text-slate-700">
            Transaction type
            <select className={`${fieldCls} mt-1.5 font-medium`} value={type} onChange={e => setType(e.target.value)}>
              <option value="">All types</option>
              {typeChoices.map(t => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </label>
          <label className="text-[13px] font-bold text-slate-700">
            Payment status
            <select className={`${fieldCls} mt-1.5 font-medium`} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as BusinessPayStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {report && report.review.unclassifiedInvoices + report.review.withoutEmployee > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-800 space-y-1" role="status">
          <div className="font-extrabold">Needs manual review</div>
          {report.review.unclassifiedInvoices > 0 && (
            <div>
              {report.review.unclassifiedInvoices} payment{report.review.unclassifiedInvoices === 1 ? '' : 's'} ({money(report.unclassified.collected)} collected, {money(report.unclassified.pending)} pending) on
              additional invoices that Accounts has not marked as a renewal or an add-on. They are credited to neither department until it does.
            </div>
          )}
          {report.review.withoutEmployee > 0 && (
            <div>
              {report.review.withoutEmployee} transaction{report.review.withoutEmployee === 1 ? '' : 's'} ({money(report.review.withoutEmployeeAmount)} collected) do not record who was responsible. They are listed under “Not recorded”.
            </div>
          )}
        </div>
      )}

      {loading && !report ? (
        <Spinner label="Loading the business report…" />
      ) : report ? (
        <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
          {page === 'OVERVIEW' && <Overview report={report} onOpen={setPage} />}
          {page === 'SALES' && <DivisionView division="SALES" section={report.sections.sales} filters={filters} />}
          {page === 'SUPPORT' && <DivisionView division="SUPPORT" section={report.sections.support} filters={filters} />}
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
        <p className="mt-3 text-xs text-slate-500">Amounts are as invoiced and received, GST included. Dates are India time.</p>
      </details>
    </div>
  );
};

// ---------------------------------------------------------------------------
const Overview: React.FC<{ report: BusinessReport; onOpen: (p: Page) => void }> = ({ report, onOpen }) => {
  const o = report.organization;
  const rows: { id: BusinessDivision; label: string; s?: BusinessSection }[] = [
    { id: 'SALES', label: 'Sales Department', s: report.sections.sales },
    { id: 'SUPPORT', label: 'Support Department', s: report.sections.support }
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Collected" value={money(o.collected)} tone="green" foot="Sales + Support" />
        <StatCard label="Pending" value={money(o.pending)} tone="amber" foot="Waiting for verification" />
        <StatCard label="Refunded" value={money(o.refunded)} tone={o.refunded ? 'red' : 'neutral'} />
        <StatCard label="Billed" value={money(o.billed)} foot="Orders in this period" />
        <StatCard label="Outstanding" value={money(o.outstanding)} tone={o.outstanding ? 'amber' : 'neutral'} foot="Still to collect" />
      </div>
      <Card label="Departments">
        <CardHead title="Sales and Support" hint="Each payment is counted once, in the department its type belongs to." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                <th className="py-2.5 pl-5 pr-3 font-semibold">Department</th>
                <th className="py-2.5 px-3 font-semibold text-right">Collected</th>
                <th className="py-2.5 px-3 font-semibold text-right">Pending</th>
                <th className="py-2.5 px-3 font-semibold text-right">Refunded</th>
                <th className="py-2.5 px-3 font-semibold text-right">Payments</th>
                <th className="py-2.5 px-3 font-semibold text-right">Outstanding</th>
                <th className="py-2.5 pl-3 pr-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pl-5 pr-3 font-bold text-slate-900">{r.label}</td>
                  <td className="py-3 px-3 text-right font-bold text-emerald-700">{money(r.s?.collected ?? 0)}</td>
                  <td className="py-3 px-3 text-right">{money(r.s?.pending ?? 0)}</td>
                  <td className="py-3 px-3 text-right text-rose-700">{money(r.s?.refunded ?? 0)}</td>
                  <td className="py-3 px-3 text-right">{r.s?.transactions ?? 0}</td>
                  <td className="py-3 px-3 text-right">{money(r.s?.outstanding ?? 0)}</td>
                  <td className="py-3 pl-3 pr-5 text-right">
                    <button type="button" onClick={() => onOpen(r.id)} className="text-[13px] font-bold text-blue-700 hover:text-blue-800">Open report</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
const DivisionView: React.FC<{
  division: BusinessDivision;
  section?: BusinessSection;
  filters: { from?: string; to?: string; departmentId?: string; employeeId?: string; type?: BusinessTxType; status?: BusinessPayStatus };
}> = ({ division, section, filters }) => {
  const s = section;
  const title = division === 'SALES' ? 'Sales Department' : 'Support Department';
  const byType = (t: BusinessTxType) => s?.byType.find(x => x.type === t);
  const combined = division === 'SUPPORT' ? s?.collected ?? 0 : null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={division === 'SALES' ? 'Total Sales business' : 'Combined Support business'} value={money(s?.collected ?? 0)} tone="green" foot="Collected (verified payments)" />
        <StatCard label="Pending" value={money(s?.pending ?? 0)} tone="amber" foot="Not yet verified" />
        <StatCard label="Outstanding" value={money(s?.outstanding ?? 0)} tone={s?.outstanding ? 'amber' : 'neutral'} foot={`of ${money(s?.billed ?? 0)} billed`} />
        <StatCard label="Refunded" value={money(s?.refunded ?? 0)} tone={s?.refunded ? 'red' : 'neutral'} foot={`${s?.transactions ?? 0} payments · ${s?.customers ?? 0} customers`} />
      </div>

      {division === 'SUPPORT' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Add-on service revenue" value={money(byType('ADDON')?.collected ?? 0)} foot={`${byType('ADDON')?.transactions ?? 0} payments · pending ${money(byType('ADDON')?.pending ?? 0)}`} />
          <StatCard label="Renewal revenue" value={money(byType('RENEWAL')?.collected ?? 0)} foot={`${byType('RENEWAL')?.transactions ?? 0} payments · pending ${money(byType('RENEWAL')?.pending ?? 0)}`} />
          <StatCard label="Subscription (monthly plan) revenue" value={money(byType('SUBSCRIPTION')?.collected ?? 0)} foot={`${byType('SUBSCRIPTION')?.transactions ?? 0} plans activated`} />
        </div>
      )}
      {division === 'SUPPORT' && combined !== null && (
        <p className="text-xs text-slate-500">Combined Support business = add-ons + renewals + subscriptions = {money(combined)}.</p>
      )}

      <EmployeeTable title={division === 'SALES' ? 'Salesperson-wise business' : 'Support Team Member-wise business'} rows={s?.employees ?? []} />
      <TransactionTable title={`${title} transactions`} division={division} filters={filters} />
    </div>
  );
};

const EmployeeTable: React.FC<{ title: string; rows: BusinessEmployeeRow[] }> = ({ title, rows }) => (
  <Card label={title}>
    <CardHead title={title} hint="Credited from the records that name who was responsible." />
    {rows.length === 0 ? (
      <p className="px-5 pb-6 text-sm text-slate-500">No business recorded for these filters.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
              <th className="py-2.5 pl-5 pr-3 font-semibold">Employee</th>
              <th className="py-2.5 px-3 font-semibold text-right">Collected</th>
              <th className="py-2.5 px-3 font-semibold text-right">Pending</th>
              <th className="py-2.5 px-3 font-semibold text-right">Refunded</th>
              <th className="py-2.5 px-3 font-semibold text-right">Payments</th>
              <th className="py-2.5 px-3 font-semibold text-right">Customers</th>
              <th className="py-2.5 px-3 font-semibold text-right">Billed</th>
              <th className="py-2.5 pl-3 pr-5 font-semibold text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.employeeId ?? 'none'} className="border-b border-slate-100 last:border-0">
                <td className={`py-3 pl-5 pr-3 font-bold ${r.employeeId ? 'text-slate-900' : 'text-slate-500 italic'}`}>{r.name}</td>
                <td className="py-3 px-3 text-right font-bold text-emerald-700">{money(r.collected)}</td>
                <td className="py-3 px-3 text-right">{money(r.pending)}</td>
                <td className="py-3 px-3 text-right text-rose-700">{money(r.refunded)}</td>
                <td className="py-3 px-3 text-right">{r.transactions}</td>
                <td className="py-3 px-3 text-right">{r.customers}</td>
                <td className="py-3 px-3 text-right">{money(r.billed)}</td>
                <td className="py-3 pl-3 pr-5 text-right">{money(r.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

const PAGE_SIZE = 25;
const TransactionTable: React.FC<{
  title: string;
  division: BusinessDivision;
  filters: { from?: string; to?: string; departmentId?: string; employeeId?: string; type?: BusinessTxType; status?: BusinessPayStatus };
}> = ({ title, division, filters }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BusinessTransactionsPage | null>(null);
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
      .transactions({ ...filters, division, search: debounced || undefined, page, pageSize: PAGE_SIZE })
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

  const exportCsv = () => {
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Date', 'Customer', 'Business', 'Department', 'Type', 'Service', 'Employee', 'Amount', 'Status', 'Method', 'Reference'];
    const lines = [head, ...(data?.items ?? []).map(t => [when(t.occurredAt), t.customerName, t.company, t.department, TYPE_LABEL[t.type], t.service, t.employeeName ?? 'Not recorded', t.amount, STATUS_LABEL[t.status], t.method, t.reference])];
    const blob = new Blob([lines.map(l => l.map(c => esc(c as string)).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${division.toLowerCase()}-transactions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card label={title}>
      <CardHead
        title={title}
        hint="Every payment behind the figures above, with the employee responsible."
        right={
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search transactions</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, employee, reference" className={`${fieldCls} pl-9 w-60 h-9 text-[13px]`} />
            </label>
            <button type="button" className={`${ghostBtn} h-9 px-3 text-[13px]`} onClick={exportCsv} disabled={!data?.items.length}>
              <Download className="w-4 h-4" aria-hidden="true" /> Export page
            </button>
          </div>
        }
      />
      {error && <div className="px-5 pb-3"><ErrorBanner message={error} onRetry={load} /></div>}
      {loading && !data ? (
        <Spinner label="Loading transactions…" />
      ) : data && data.items.length === 0 ? (
        <div className="px-5 pb-8 pt-2 text-center text-sm text-slate-500">
          <BarChart3 className="w-6 h-6 mx-auto mb-2 text-slate-300" aria-hidden="true" />
          No transactions for these filters.
        </div>
      ) : (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                  <th className="py-2.5 pl-5 pr-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Employee</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 pl-3 pr-5 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((t: BusinessTransaction) => (
                  <tr key={t.key} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap text-slate-600">{when(t.occurredAt)}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{t.company || t.customerName}</div>
                      <div className="text-xs text-slate-500">{t.customerName}{t.customerCode ? ` · ${t.customerCode}` : ''}{t.department ? ` · ${t.department}` : ''}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{TYPE_LABEL[t.type]}</div>
                      {t.service && <div className="text-xs text-slate-500">{t.service}</div>}
                    </td>
                    <td className={`py-3 px-3 ${t.employeeName ? 'text-slate-800 font-semibold' : 'text-slate-400 italic'}`}>{t.employeeName ?? 'Not recorded'}</td>
                    <td className="py-3 px-3 text-right font-bold">{money(t.amount)}</td>
                    <td className="py-3 px-3"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span></td>
                    <td className="py-3 pl-3 pr-5 text-xs text-slate-500">{[t.method, t.reference].filter(Boolean).join(' · ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="transactions" onPage={setPage} />}
        </div>
      )}
    </Card>
  );
};

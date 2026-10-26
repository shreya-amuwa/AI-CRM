import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { SalesIncome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, CardHead, StatCard, Tabs } from '../tasks/head/headParts';
import { ErrorBanner, Spinner, money } from '../team-member/pipeline/shared';
import { EmptyState, dateText } from '../telecaller/ui';
import { presetRange, type Preset } from '../reports/BusinessReports';

const PRESETS: { id: Preset; label: string }[] = [{ id: 'MONTH', label: 'This month' }, { id: '30', label: 'Last 30 days' }, { id: 'ALL', label: 'All time' }];
const STATUS_STYLE: Record<string, string> = { COLLECTED: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', REFUNDED: 'bg-rose-50 text-rose-700' };
const STATUS_LABEL: Record<string, string> = { COLLECTED: 'Paid', PENDING: 'Awaiting verification', REFUNDED: 'Refunded' };
const TYPE_LABEL: Record<string, string> = { INITIAL_SALE: 'Sale', ADDON: 'Add-on', RENEWAL: 'Renewal', SUBSCRIPTION: 'Monthly plan', UNCLASSIFIED: 'Other' };

/**
 * Department Income of the Sales side. Collected money is what Accounts has verified; a quotation or an unpaid invoice is not income.
 * The figures are the department income report's Sales division; nothing is added up here.
 */
export const SalesIncomePage: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('MONTH');
  const [data, setData] = useState<SalesIncome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current; // a slower, older answer must not overwrite a newer one
    setError(null);
    const r = presetRange(preset);
    salesHeadApi.income({ from: r.from, to: r.to }).then(d => mine === latest.current && setData(d), e => mine === latest.current && setError(errorMessage(e)));
  }, [preset]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const f = data?.figures ?? {};
  return (
    <div className="space-y-5">
      <PageTitle title="Department Income" subtitle="Money collected by the Sales side, from payments Accounts has verified." />
      <Tabs label="Period" value={preset} onChange={setPreset} options={PRESETS} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data ? (error ? null : <Spinner label="Loading income…" />) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Total Gross Income" value={money(f.collected ?? 0)} tone="green" foot="Collected: payments Accounts verified" testId="income-gross" />
            <StatCard label="Awaiting verification" value={money(f.pending ?? 0)} tone="amber" foot="Recorded, not yet verified" />
            <StatCard label="Refunded" value={money(f.refunded ?? 0)} tone="red" />
            <StatCard label="Outstanding" value={money(f.outstanding ?? 0)} foot="Billed and not yet paid" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5" label="Total Expenses">
              <div className="text-[13px] font-semibold text-slate-500">Total Expenses</div>
              <div className="mt-1.5 text-lg font-extrabold text-slate-400" data-testid="income-expenses">Not recorded for Sales</div>
              <p className="mt-2 text-xs text-slate-500">Accounts records expenses for the whole department, not for the Sales side, so there is no Sales-only expense figure to show.</p>
            </Card>
            <Card className="p-5" label="Total Net Earnings">
              <div className="text-[13px] font-semibold text-slate-500">Total Net Earnings</div>
              <div className="mt-1.5 text-lg font-extrabold text-slate-400" data-testid="income-net">Not available</div>
              <p className="mt-2 text-xs text-slate-500">Net earnings need Sales expenses. Gross income above is the figure that can be stated from the records.</p>
            </Card>
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-500"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{data.basis}</span></div>
          <Card className="overflow-hidden">
            <CardHead title="Transactions" hint="The latest 200 payments of the Sales side" />
            {data.transactions.length === 0 ? <EmptyState title="No payments in this period" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[860px]">
                  <thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">{['Date', 'Client', 'Invoice / reference', 'Type', 'Income amount', 'Payment status', 'Source'].map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.transactions.map((t, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{dateText(t.date)}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-900">{t.customer}</td>
                        <td className="px-4 py-2.5 text-slate-600">{t.reference || '-'}{t.service ? <span className="block text-xs text-slate-500">{t.service}</span> : null}</td>
                        <td className="px-4 py-2.5 text-slate-600">{TYPE_LABEL[t.type] ?? t.type}</td>
                        <td className="px-4 py-2.5 font-bold text-slate-900">{money(t.amount)}</td>
                        <td className="px-4 py-2.5"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLE[t.status] ?? 'bg-slate-100 text-slate-700'}`}>{STATUS_LABEL[t.status] ?? t.status}</span></td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{t.source.toLowerCase().replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

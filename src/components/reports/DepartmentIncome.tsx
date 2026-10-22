import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import type { AttributionReconciliation, BusinessDivision, ClientPurchaseRule, Department, DepartmentIncomeReport, IncomeFigures, RevenueSource } from '../../../shared/contracts';
import { departmentIncomeApi, organizationApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { useAuth } from '../../context/AuthContext';
import { ErrorBanner, money, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead, fieldCls, ghostBtn, primaryBtn, StatCard } from '../tasks/head/headParts';
import { FormField, Modal } from '../support-member/SupportParts';
import { presetRange, TYPE_LABEL, type Preset, when } from './BusinessReports';

/**
 * Department income, read from the recorded attribution of each order (see docs/DEPARTMENT_INCOME.md).
 * Every number comes from the database (department_income_report); nothing is added up here.
 * The Super Admin and Accounts see every department (and can reconcile); a Department Head sees only their own.
 */
const SOURCE_LABEL: Record<RevenueSource, string> = {
  ACQUISITION: 'Sale of an acquired customer',
  DEFAULT_SALES: 'Sale (acquisition not recorded, Sales)',
  SUPPORT_ADDON: 'Add-on sold through Support',
  CLIENT_DASHBOARD: 'Bought in the Client Dashboard',
  SUPPORT_INVOICE: 'Renewal / add-on invoice',
  LEGACY: 'Before attribution was recorded',
  MANUAL: 'Corrected by Accounts',
  UNRECORDED: 'Not recorded'
};
const RULE_LABEL: Record<ClientPurchaseRule, string> = {
  SUPPORT: 'Support (the team that looks after the account)',
  ACQUISITION: 'The division that acquired the customer',
  SALES: 'Sales'
};
const DIVISION_LABEL: Record<BusinessDivision, string> = { SALES: 'Sales', SUPPORT: 'Support' };

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'MONTH', label: 'This month' },
  { id: '30', label: 'Last 30 days' },
  { id: 'ALL', label: 'All time' }
];

const Figures: React.FC<{ f: IncomeFigures | undefined; title: string; hint?: string }> = ({ f, title, hint }) => (
  <div className="rounded-xl border border-slate-200 p-4">
    <div className="text-[13px] font-bold text-slate-800">{title}</div>
    {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <dt className="text-slate-500">Collected</dt>
      <dd className="text-right font-bold text-emerald-700">{money(f?.collected ?? 0)}</dd>
      <dt className="text-slate-500">Pending</dt>
      <dd className="text-right text-amber-700">{money(f?.pending ?? 0)}</dd>
      <dt className="text-slate-500">Refunded</dt>
      <dd className="text-right text-rose-700">{money(f?.refunded ?? 0)}</dd>
      <dt className="text-slate-500">Outstanding</dt>
      <dd className="text-right font-semibold text-slate-800">{money(f?.outstanding ?? 0)}</dd>
      <dt className="text-slate-500">Orders</dt>
      <dd className="text-right text-slate-800">{f?.orders ?? 0}</dd>
    </dl>
  </div>
);

export const DepartmentIncome: React.FC<{ own?: boolean }> = ({ own = false }) => {
  const { profile } = useAuth();
  const superAdmin = profile?.role === 'SUPER_ADMIN';
  const [preset, setPreset] = useState<Preset>('30');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [report, setReport] = useState<DepartmentIncomeReport | null>(null);
  const [recon, setRecon] = useState<AttributionReconciliation | null>(null);
  const [rule, setRule] = useState<ClientPurchaseRule | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState<AttributionReconciliation['items'][number] | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!own) organizationApi.departments().then(setDepartments, () => undefined);
  }, [own]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const r = presetRange(preset);
    departmentIncomeApi.report({ departmentId: own || !departmentId ? undefined : departmentId, from: r.from, to: r.to }).then(
      d => { if (live) { setReport(d); setLoading(false); } },
      e => { if (live) { setError(errorMessage(e)); setLoading(false); } }
    );
    if (!own) {
      departmentIncomeApi.reconciliation().then(d => { if (live) setRecon(d); }, () => undefined);
      departmentIncomeApi.settings().then(d => { if (live) setRule(d.clientPurchaseAttribution); }, () => undefined);
    }
    return () => { live = false; };
  }, [preset, departmentId, own, tick]);

  const revenueDepartments = useMemo(() => departments.filter(d => (d as Department & { generatesRevenue?: boolean }).generatesRevenue !== false), [departments]);
  const t = report?.totals;
  const orders = report?.orders ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Department income</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {own ? 'Income of your department, by who earned it: Sales, Support, add-ons and Client Dashboard purchases.' : 'Income by department and by who earned it: Sales, Support, add-ons and Client Dashboard purchases.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!own && (
            <select className={`${fieldCls} !w-56`} value={departmentId} onChange={e => setDepartmentId(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {revenueDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Period">
            {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => setPreset(p.id)} aria-pressed={preset === p.id}
                className={`px-3 h-9 rounded-lg text-xs font-bold ${preset === p.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{p.label}</button>
            ))}
          </div>
          <button type="button" className={ghostBtn} onClick={reload}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Reload</button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !report && <Spinner />}

      {report && (
        <>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{report.basis} Taxable value and GST are shown where the order's tax split is known.</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Collected" value={money(t?.collected ?? 0)} tone="green" foot={`${t?.payments ?? 0} confirmed payments (GST included)`} />
            <StatCard label="Taxable value collected" value={money(t?.collectedTaxable ?? 0)} foot={`GST ${money(t?.collectedGst ?? 0)}${(t?.collectedTaxSplitUnknown ?? 0) > 0 ? `, split not known for ${money(t?.collectedTaxSplitUnknown)}` : ''}`} />
            <StatCard label="Pending" value={money(t?.pending ?? 0)} tone="amber" foot="Recorded, not yet verified" />
            <StatCard label="Outstanding" value={money(t?.outstanding ?? 0)} tone="red" foot={`Receivable on ${money(t?.billed ?? 0)} billed; refunded ${money(t?.refunded ?? 0)}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Figures f={report.byDivision.sales} title="Sales" hint="First sales of customers Sales acquired" />
            <Figures f={report.byDivision.support} title="Support" hint="Add-ons, renewals, plans, Support-acquired customers" />
            <Figures f={report.highlights.supportAddOns} title="Add-ons attributed to Support" hint="Sold to existing customers" />
            <Figures f={report.highlights.supportReferrals} title="Support referrals" hint="First sales of customers Support got through a referral" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Figures f={report.highlights.clientDashboard} title="Bought in the Client Dashboard" hint={`Attributed by the rule in force: ${RULE_LABEL[report.rule]}`} />
            <Figures f={report.highlights.supportAcquired} title="All sales of Support-acquired customers" hint="Referrals and other Support channels" />
          </div>

          {!own && report.departments.length > 0 && (
            <Card label="By department">
              <CardHead title="By department" hint="Each order counts for the department it was made in, even if the customer moved later." />
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500"><th className="py-2">Department</th><th className="text-right">Sales</th><th className="text-right">Support</th><th className="text-right">Collected</th><th className="text-right">Outstanding</th></tr></thead>
                  <tbody>
                    {report.departments.map(d => (
                      <tr key={d.departmentId} className="border-t border-slate-100">
                        <td className="py-2 font-semibold text-slate-800">{d.name}</td>
                        <td className="text-right">{money(d.sales.collected)}</td>
                        <td className="text-right">{money(d.support.collected)}</td>
                        <td className="text-right font-bold text-emerald-700">{money(d.collected)}</td>
                        <td className="text-right text-slate-700">{money(d.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card label="By source">
            <CardHead title="Why each order belongs where it does" hint="The reason is recorded once, when the order appears." />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="py-2">Source</th><th className="text-right">Orders</th><th className="text-right">Collected</th><th className="text-right">Pending</th><th className="text-right">Outstanding</th></tr></thead>
                <tbody>
                  {report.bySource.map(s => (
                    <tr key={s.source} className="border-t border-slate-100">
                      <td className="py-2 text-slate-800">{SOURCE_LABEL[s.source]}</td>
                      <td className="text-right">{s.orders}</td>
                      <td className="text-right font-semibold text-emerald-700">{money(s.collected)}</td>
                      <td className="text-right text-amber-700">{money(s.pending)}</td>
                      <td className="text-right">{money(s.outstanding)}</td>
                    </tr>
                  ))}
                  {report.bySource.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No income in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card label="Orders">
            <CardHead title="Orders" hint="One line per order. A part payment counts only what was confirmed; the rest stays outstanding." />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2">Customer</th><th>Order</th><th>Earned by</th><th className="text-right">Order value</th><th className="text-right">Taxable</th><th className="text-right">GST</th>
                    <th className="text-right">Collected</th><th className="text-right">Pending</th><th className="text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.orderKey} className="border-t border-slate-100 align-top">
                      <td className="py-2"><div className="font-semibold text-slate-800">{o.customer}</div><div className="text-slate-400">{o.customerCode}{o.department ? ` · ${o.department}` : ''}</div></td>
                      <td>
                        <div className="text-slate-800">{TYPE_LABEL[o.type]}</div>
                        <div className="text-slate-400 max-w-[220px] truncate" title={o.services ?? ''}>{o.services ?? ''}</div>
                        <div className="text-slate-400">{o.lastPaymentAt ? `Last paid ${when(o.lastPaymentAt)}` : 'No payment yet'}</div>
                      </td>
                      <td>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${o.division === 'SALES' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{DIVISION_LABEL[o.division]}</span>
                        <div className="text-slate-500">{SOURCE_LABEL[o.source]}</div>
                        {o.needsReview && <div className="text-amber-700 font-semibold">Needs review</div>}
                      </td>
                      <td className="text-right">{money(o.billed)}</td>
                      <td className="text-right">{o.taxSplitKnown ? money(o.billedTaxable) : 'not recorded'}</td>
                      <td className="text-right">{o.taxSplitKnown ? money(o.billedGst) : 'not recorded'}</td>
                      <td className="text-right font-semibold text-emerald-700">{money(o.collected)}{o.partPaid && <div className="text-[11px] font-normal text-amber-700">part paid</div>}</td>
                      <td className="text-right text-amber-700">{money(o.pending)}</td>
                      <td className="text-right">{money(o.outstanding)}{o.refunded > 0 && <div className="text-[11px] text-rose-700">refunded {money(o.refunded)}</div>}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-slate-500">No orders in this period.</td></tr>}
                </tbody>
              </table>
              {orders.length >= 200 && <p className="mt-2 text-[11px] text-slate-500">The 200 most recent orders are listed; the totals above cover all of them.</p>}
            </div>
          </Card>

          {!own && recon && (
            <Card label="Reconciliation">
              <CardHead title="Orders to reconcile" hint="Income from before attribution was recorded is counted exactly as it was. These might belong to Support: confirm each one." />
              <div className="px-5 pb-5 space-y-2">
                <p className="text-xs text-slate-500">{recon.legacyOrders} orders from before attribution was recorded; {recon.withoutAcquisition} customers with no recorded acquisition.</p>
                {recon.items.length === 0 && <p className="text-xs text-emerald-700">Nothing is waiting for review.</p>}
                {recon.items.map(i => (
                  <div key={i.orderKey} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-slate-800">{i.customer} <span className="font-normal text-slate-500">{i.customerCode}</span></div>
                      <div className="text-xs text-slate-600">Counted as {DIVISION_LABEL[i.division]}, collected {money(i.collected)}. {i.note}</div>
                    </div>
                    <button type="button" className={ghostBtn} onClick={() => setFixing(i)}>Decide</button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!own && superAdmin && rule && <RuleCard rule={rule} onChanged={r => { setRule(r); reload(); }} />}
        </>
      )}

      {fixing && <ReconcileModal item={fixing} onClose={() => setFixing(null)} onDone={() => { setFixing(null); reload(); }} />}
    </div>
  );
};

const RuleCard: React.FC<{ rule: ClientPurchaseRule; onChanged: (r: ClientPurchaseRule) => void }> = ({ rule, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async (r: ClientPurchaseRule) => {
    if (r === rule) return;
    setBusy(true); setError('');
    try { await departmentIncomeApi.setSettings(r); onChanged(r); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card label="Client Dashboard purchases">
      <CardHead title="What a client buys in the Client Dashboard" hint="Which division earns an add-on or plan the client requests themselves. It applies to new orders only; existing orders keep what was recorded." />
      <div className="px-5 pb-5 space-y-2">
        {(Object.keys(RULE_LABEL) as ClientPurchaseRule[]).map(r => (
          <label key={r} className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="client-purchase-rule" checked={rule === r} disabled={busy} onChange={() => void choose(r)} /> {RULE_LABEL[r]}{r === 'SUPPORT' ? ' (default)' : ''}
          </label>
        ))}
        {error && <ErrorBanner message={error} />}
      </div>
    </Card>
  );
};

const ReconcileModal: React.FC<{ item: AttributionReconciliation['items'][number]; onClose: () => void; onDone: () => void }> = ({ item, onClose, onDone }) => {
  const [division, setDivision] = useState<BusinessDivision>(item.division);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await departmentIncomeApi.setOrderAttribution({ orderKey: item.orderKey, division, reason: reason.trim() }); onDone(); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={`Who earned this order? ${item.customer}`} onClose={onClose}>
      <div className="p-5 space-y-3">
        <p className="text-xs text-slate-600">{item.note}</p>
        <FormField label="Earned by" htmlFor="rc-division">
          <select id="rc-division" className={fieldCls} value={division} onChange={e => setDivision(e.target.value as BusinessDivision)}>
            <option value="SALES">Sales</option>
            <option value="SUPPORT">Support</option>
          </select>
        </FormField>
        <FormField label="Why (kept in the audit history)" htmlFor="rc-reason" required>
          <textarea id="rc-reason" rows={3} className={fieldCls.replace('h-11 ', 'py-2.5 ')} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
            placeholder="For example: confirmed with the Support lead that Support acquired this customer" />
        </FormField>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || reason.trim().length < 3} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
};

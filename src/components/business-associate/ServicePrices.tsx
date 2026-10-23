import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeIndianRupee } from 'lucide-react';
import type { ServicePrice } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, tcBtn, tcInput } from '../telecaller/ui';

interface Row { unitLabel: string; unitPrice: string; gstRate: string; maxDiscountPct: string; isActive: boolean }
const toRow = (p: ServicePrice): Row => ({ unitLabel: p.unitLabel || 'one time', unitPrice: p.priced ? String(p.unitPrice) : '', gstRate: p.priced ? String(p.gstRate) : '18', maxDiscountPct: p.priced ? String(p.maxDiscountPct) : '0', isActive: p.priced ? p.isActive : true });

/**
 * The approved price list (Department Head). Business Associates start every quotation line from these figures; a different price is flagged, and a
 * discount above the limit set here is refused. Nothing is priced by default: a service with no price here has none.
 */
export const ServicePrices: React.FC = () => {
  const [items, setItems] = useState<ServicePrice[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const lock = useRef(false);
  const load = useCallback(() => {
    setError(null);
    businessAssociateApi.prices().then(p => { setItems(p); setRows(Object.fromEntries(p.map(x => [x.serviceCode, toRow(x)]))); }, err => (setError(errorMessage(err)), setItems([])));
  }, []);
  useEffect(load, [load]);
  const set = (code: string, patch: Partial<Row>) => setRows(r => ({ ...r, [code]: { ...r[code], ...patch } }));
  const save = async (p: ServicePrice) => {
    if (lock.current) return;
    const r = rows[p.serviceCode];
    if (r.unitPrice === '' || Number(r.unitPrice) < 0) return setError(`Enter the price of ${p.name}.`);
    lock.current = true; setSaving(p.serviceCode); setError(null);
    try {
      await businessAssociateApi.savePrice(p.serviceCode, { unitLabel: r.unitLabel.trim() || 'one time', unitPrice: Number(r.unitPrice), gstRate: Number(r.gstRate || 0), maxDiscountPct: Number(r.maxDiscountPct || 0), isActive: r.isActive });
      setNotice(`${p.name}: price saved.`); setTimeout(() => setNotice(null), 4000); load();
    } catch (err) { setError(errorMessage(err)); } finally { lock.current = false; setSaving(null); }
  };
  return (
    <div className="space-y-5">
      <PageTitle title="Service prices" subtitle="The approved prices Business Associates quote from. Set the price, the GST rate and the largest discount allowed for each service." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {items === null ? <Spinner /> : items.length === 0 ? <EmptyState icon={BadgeIndianRupee} title="No services in the catalogue" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">{['Service', 'Charged', 'Unit price (INR)', 'GST %', 'Max discount %', 'Active', ''].map(h => <th key={h} scope="col" className="px-3 py-3 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(p => {
                  const r = rows[p.serviceCode];
                  if (!r) return null;
                  return (
                    <tr key={p.serviceCode}>
                      <td className="px-3 py-2"><div className="font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-500">{p.category}{p.priced ? '' : ' · no price yet'}</div></td>
                      <td className="px-3 py-2"><input className={`${tcInput} w-28`} maxLength={40} value={r.unitLabel} onChange={e => set(p.serviceCode, { unitLabel: e.target.value })} aria-label={`Charged per, ${p.name}`} /></td>
                      <td className="px-3 py-2"><input type="number" min="0" step="0.01" className={`${tcInput} w-32`} value={r.unitPrice} onChange={e => set(p.serviceCode, { unitPrice: e.target.value })} aria-label={`Unit price, ${p.name}`} /></td>
                      <td className="px-3 py-2"><input type="number" min="0" max="100" step="0.01" className={`${tcInput} w-20`} value={r.gstRate} onChange={e => set(p.serviceCode, { gstRate: e.target.value })} aria-label={`GST rate, ${p.name}`} /></td>
                      <td className="px-3 py-2"><input type="number" min="0" max="100" step="0.01" className={`${tcInput} w-20`} value={r.maxDiscountPct} onChange={e => set(p.serviceCode, { maxDiscountPct: e.target.value })} aria-label={`Largest discount, ${p.name}`} /></td>
                      <td className="px-3 py-2"><input type="checkbox" checked={r.isActive} onChange={e => set(p.serviceCode, { isActive: e.target.checked })} aria-label={`Active, ${p.name}`} className="rounded border-slate-300" /></td>
                      <td className="px-3 py-2"><button type="button" className={tcBtn.secondary} disabled={saving !== null} onClick={() => void save(p)} aria-label={`Save the price of ${p.name}`}>{saving === p.serviceCode ? 'Saving…' : 'Save'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

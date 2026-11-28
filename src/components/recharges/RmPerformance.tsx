import React, { useEffect, useState } from 'react';
import type { RechargeRmPerformance } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { Card, ErrorBanner, Field, Spinner, inputCls } from '../team-member/pipeline/shared';
import { rechargeMoney } from './rechargeParts';

/** Verified Panel and Message recharges per Relationship Manager. Only payments Accounts confirmed are counted; money still waiting is shown apart and never added. */
export const RmPerformance: React.FC = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<RechargeRmPerformance[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    rechargesApi.performance({ from, to }).then(setRows).catch(e => setError(errorMessage(e)));
  };
  useEffect(load, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (k: keyof RechargeRmPerformance) => (rows ?? []).reduce((s, r) => s + Number(r[k]), 0);
  return (
    <div className="space-y-4" data-testid="rm-performance">
      <p className="text-xs text-slate-500">Counted only after Accounts confirms the payment. Pending recharges are shown separately and are not part of the totals.</p>
      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="From date" htmlFor="rp-from"><input id="rp-from" type="date" className={inputCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="To date" htmlFor="rp-to"><input id="rp-to" type="date" className={inputCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!rows && !error && <Spinner label="Loading the performance…" />}
      {rows && rows.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600" data-testid="rm-empty">No recharges to show yet.</div>}
      {rows && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" data-testid="rm-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="text-left px-3 py-2 font-semibold">Relationship Manager</th><th className="text-right px-3 py-2 font-semibold">Panel</th><th className="text-right px-3 py-2 font-semibold">Message</th>
                  <th className="text-right px-3 py-2 font-semibold">Total verified</th><th className="text-right px-3 py-2 font-semibold">Recharges</th><th className="text-right px-3 py-2 font-semibold">Pending (not counted)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => (
                  <tr key={r.rmId} data-testid="rm-row">
                    <td className="px-3 py-2 font-medium text-slate-900">{r.rmName}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{rechargeMoney(r.panelAmount)} <span className="text-xs text-slate-500">· {r.panelCount}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{rechargeMoney(r.messageAmount)} <span className="text-xs text-slate-500">· {r.messageCount}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-bold">{rechargeMoney(r.totalAmount)}</td>
                    <td className="px-3 py-2 text-right">{r.totalCount}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500">{rechargeMoney(r.pendingAmount)} · {r.pendingCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold text-slate-900"><tr><td className="px-3 py-2">All</td><td className="px-3 py-2 text-right">{rechargeMoney(sum('panelAmount'))} · {sum('panelCount')}</td><td className="px-3 py-2 text-right">{rechargeMoney(sum('messageAmount'))} · {sum('messageCount')}</td>
                <td className="px-3 py-2 text-right">{rechargeMoney(sum('totalAmount'))}</td><td className="px-3 py-2 text-right">{sum('totalCount')}</td><td className="px-3 py-2 text-right text-slate-500">{rechargeMoney(sum('pendingAmount'))} · {sum('pendingCount')}</td></tr></tfoot>
            </table>
          </div>
          <ul className="md:hidden divide-y divide-slate-100">
            {rows.map(r => (
              <li key={r.rmId} className="p-3 space-y-1" data-testid="rm-card">
                <div className="font-semibold text-slate-900 break-words">{r.rmName}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><div className="text-slate-500">Panel</div><div className="font-semibold">{rechargeMoney(r.panelAmount)} · {r.panelCount}</div></div>
                  <div><div className="text-slate-500">Message</div><div className="font-semibold">{rechargeMoney(r.messageAmount)} · {r.messageCount}</div></div>
                  <div><div className="text-slate-500">Total verified</div><div className="font-extrabold">{rechargeMoney(r.totalAmount)} · {r.totalCount}</div></div>
                  <div><div className="text-slate-500">Pending (not counted)</div><div>{rechargeMoney(r.pendingAmount)} · {r.pendingCount}</div></div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

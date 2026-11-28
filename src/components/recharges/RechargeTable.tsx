import React from 'react';
import { Eye, Pencil } from 'lucide-react';
import type { SupportRecharge } from '../../../shared/contracts';
import { btn } from '../team-member/pipeline/shared';
import { BILLING_LABEL, InvoicePill, KIND_LABEL, PaymentPill, rechargeDay, rechargeMoney } from './rechargeParts';

/** The records as a table on desktop and as cards on a phone (the same content). */
export const RechargeTable: React.FC<{ items: SupportRecharge[]; showKind?: boolean; showRecorder?: boolean; onView: (id: string) => void; onEdit?: (r: SupportRecharge) => void }> = ({ items, showKind, showRecorder, onView, onEdit }) => (
  <>
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm" data-testid="recharge-table">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Reference</th>
            <th className="text-left px-3 py-2 font-semibold">Customer</th>
            {showKind && <th className="text-left px-3 py-2 font-semibold">Type</th>}
            <th className="text-left px-3 py-2 font-semibold">RM</th>
            <th className="text-left px-3 py-2 font-semibold">Date</th>
            <th className="text-left px-3 py-2 font-semibold">Billing</th>
            <th className="text-right px-3 py-2 font-semibold">Total</th>
            <th className="text-left px-3 py-2 font-semibold">Payment</th>
            <th className="text-left px-3 py-2 font-semibold">Invoice</th>
            {showRecorder && <th className="text-left px-3 py-2 font-semibold">Submitted by</th>}
            <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map(r => (
            <tr key={r.id} className="hover:bg-slate-50/60" data-testid="recharge-row">
              <td className="px-3 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{r.reference}</td>
              <td className="px-3 py-2 font-medium text-slate-900 max-w-[15rem] truncate" title={r.customerName}>{r.customerName}</td>
              {showKind && <td className="px-3 py-2 whitespace-nowrap text-slate-600">{KIND_LABEL[r.kind]}</td>}
              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.rmName ?? '-'}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{rechargeDay(r.rechargeDate)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{BILLING_LABEL[r.billingType]}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap font-bold">{rechargeMoney(r.totalAmount)}</td>
              <td className="px-3 py-2"><PaymentPill status={r.paymentStatus} /></td>
              <td className="px-3 py-2"><InvoicePill status={r.invoiceStatus} /></td>
              {showRecorder && <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.createdByName ?? '-'}</td>}
              <td className="px-3 py-2 whitespace-nowrap text-right">
                <button type="button" className={btn.secondary} onClick={() => onView(r.id)} aria-label={`View ${r.reference}`}><Eye className="w-3.5 h-3.5" aria-hidden /> View</button>
                {r.canEdit && onEdit && <button type="button" className={`${btn.secondary} ml-1`} onClick={() => onEdit(r)} aria-label={`Edit ${r.reference}`}><Pencil className="w-3.5 h-3.5" aria-hidden /></button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ul className="md:hidden divide-y divide-slate-100" data-testid="recharge-cards">
      {items.map(r => (
        <li key={r.id} className="p-3 space-y-2" data-testid="recharge-card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><div className="font-semibold text-slate-900 break-words">{r.customerName}</div><div className="text-[11px] text-slate-500">{r.reference} · {rechargeDay(r.rechargeDate)}{showKind ? ` · ${KIND_LABEL[r.kind]}` : ''}</div></div>
            <div className="shrink-0 font-extrabold text-slate-900">{rechargeMoney(r.totalAmount)}</div>
          </div>
          <div className="flex flex-wrap gap-1.5"><PaymentPill status={r.paymentStatus} /><InvoicePill status={r.invoiceStatus} /></div>
          <div className="text-[11px] text-slate-500 break-words">{BILLING_LABEL[r.billingType]} · RM {r.rmName ?? '-'}{showRecorder ? ` · by ${r.createdByName ?? '-'}` : ''}</div>
          <div className="flex gap-2">
            <button type="button" className={`${btn.secondary} flex-1`} onClick={() => onView(r.id)} aria-label={`View ${r.reference}`}><Eye className="w-3.5 h-3.5" aria-hidden /> View</button>
            {r.canEdit && onEdit && <button type="button" className={`${btn.secondary} flex-1`} onClick={() => onEdit(r)} aria-label={`Edit ${r.reference}`}><Pencil className="w-3.5 h-3.5" aria-hidden /> Edit</button>}
          </div>
        </li>
      ))}
    </ul>
  </>
);

export const Stat: React.FC<{ label: string; value: string; testId: string; hint?: string }> = ({ label, value, testId, hint }) => (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4 min-w-0" data-testid={testId}>
    <div className="text-[11px] font-medium text-slate-500 truncate">{label}</div>
    <div className="mt-1 text-base sm:text-lg font-extrabold text-slate-900 break-words">{value}</div>
    {hint && <div className="text-[10px] text-slate-400 truncate">{hint}</div>}
  </div>
);

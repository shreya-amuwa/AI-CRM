import React from 'react';
import type {
  FollowUpStatus,
  LedgerPayment,
  LedgerPaymentStatus,
  PaymentStatus,
  PaymentWorkflow
} from '../../../shared/contracts';

/** Shared labels, badges and the payment-history list for Sales and Accounts screens. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const rupees = (n: number | null | undefined) => (n === null || n === undefined ? '—' : inr.format(n));

/** "10 Oct 2026, 11:30 AM" */
export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, m => m.toUpperCase())
    : '—';
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const METHOD_LABEL: Record<string, string> = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' };
export const TYPE_LABEL: Record<string, string> = { PART: 'Part payment', FULL: 'Full payment' };

const TONES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200'
} as const;
type Tone = keyof typeof TONES;

export const Badge: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  NO_PAYMENT: { label: 'No payment yet', tone: 'slate' },
  PENDING_VERIFICATION: { label: 'Payment pending', tone: 'amber' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'blue' },
  FULLY_PAID: { label: 'Fully paid', tone: 'green' }
};
export const PaymentStatusBadge: React.FC<{ status: PaymentStatus }> = ({ status }) => (
  <Badge tone={PAYMENT_STATUS[status].tone}>{PAYMENT_STATUS[status].label}</Badge>
);

const WORKFLOW: Record<PaymentWorkflow, { label: string; tone: Tone } | null> = {
  NONE: null,
  PENDING_PAYMENT_CONFIRMATION: { label: 'With Accounts', tone: 'amber' },
  RETURNED_FROM_ACCOUNTS: { label: 'Returned from Accounts', tone: 'red' },
  PAYMENT_CONFIRMED: { label: 'Payment confirmed', tone: 'green' }
};
export const WorkflowBadge: React.FC<{ workflow: PaymentWorkflow }> = ({ workflow }) => {
  const w = WORKFLOW[workflow];
  return w ? <Badge tone={w.tone}>{w.label}</Badge> : null;
};

const LEDGER_STATUS: Record<LedgerPaymentStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending verification', tone: 'amber' },
  VERIFIED: { label: 'Verified', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  REVERSED: { label: 'Reversed', tone: 'violet' }
};
export const LedgerStatusBadge: React.FC<{ status: LedgerPaymentStatus }> = ({ status }) => (
  <Badge tone={LEDGER_STATUS[status].tone}>{LEDGER_STATUS[status].label}</Badge>
);

export const FOLLOWUP_LABEL: Record<FollowUpStatus, { label: string; tone: Tone }> = {
  FOLLOW_UP_REQUIRED: { label: 'Follow-up required', tone: 'red' },
  CONTACTED: { label: 'Contacted', tone: 'blue' },
  AWAITING_PAYMENT: { label: 'Awaiting payment', tone: 'amber' },
  FULLY_PAID: { label: 'Fully paid', tone: 'green' }
};
export const FollowUpBadge: React.FC<{ status: FollowUpStatus }> = ({ status }) => (
  <Badge tone={FOLLOWUP_LABEL[status].tone}>{FOLLOWUP_LABEL[status].label}</Badge>
);

/** Money summary: agreed · verified · pending · balance. */
export const MoneyTiles: React.FC<{ deal: number | null; verified: number; pending: number; balance: number }> = ({ deal, verified, pending, balance }) => (
  <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {(
      [
        ['Agreed amount', rupees(deal)],
        ['Verified received', rupees(verified)],
        ['Pending verification', rupees(pending)],
        ['Outstanding balance', rupees(balance)]
      ] as const
    ).map(([k, v]) => (
      <div key={k} className="rounded-xl bg-slate-50 p-3">
        <dt className="text-[11px] text-slate-500">{k}</dt>
        <dd className="text-base font-bold text-slate-900 mt-0.5">{v}</dd>
      </div>
    ))}
  </dl>
);

/** Every payment on record, newest first. `actions` adds per-row buttons (Accounts). */
export const PaymentHistory: React.FC<{
  payments: LedgerPayment[];
  actions?: (p: LedgerPayment) => React.ReactNode;
  empty?: string;
}> = ({ payments, actions, empty = 'No payments recorded yet.' }) => {
  if (payments.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Payment history">
      {payments.map(p => (
        <li key={p.id} className="p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900">{rupees(p.amount)}</span>
              <Badge tone={p.type === 'PART' ? 'blue' : 'green'}>{TYPE_LABEL[p.type]}</Badge>
              <LedgerStatusBadge status={p.status} />
              {p.source !== 'ACCOUNTS' && <Badge tone="slate">{p.source === 'SALES' ? 'Recorded by Sales' : 'Earlier record'}</Badge>}
            </div>
            <p className="text-[11px] text-slate-500">
              {fmtDateTime(p.paidAt)}
              {p.method ? ` · ${METHOD_LABEL[p.method] || p.method}` : ''}
              {p.reference ? ` · Ref ${p.reference}` : ''}
            </p>
            <p className="text-[11px] text-slate-500">
              {p.recordedBy ? `Recorded by ${p.recordedBy}` : 'Recorded'}
              {p.status === 'VERIFIED' && p.verifiedBy ? ` · Verified by ${p.verifiedBy} on ${fmtDateTime(p.verifiedAt)}` : ''}
            </p>
            {p.note && <p className="text-xs text-slate-600 break-words">{p.note}</p>}
            {p.statusReason && (p.status === 'REJECTED' || p.status === 'REVERSED') && <p className="text-xs text-rose-700 break-words">Reason: {p.statusReason}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-1.5 shrink-0">{actions(p)}</div>}
        </li>
      ))}
    </ul>
  );
};

import React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  CUSTOMER_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type CustomerStatusValue,
  type SupportInvoice,
  type TicketPriority,
  type TicketStatus
} from '../../lib/support';

export const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500';

export const PageHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div>
      <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">{title}</h1>
      {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-2xl">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export const KpiCard: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: string; icon?: React.ElementType }> = ({
  label,
  value,
  hint,
  tone = 'text-slate-900',
  icon: Icon
}) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-500">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
        {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
      {Icon && (
        <span className="p-2 rounded-xl bg-slate-50 text-slate-500 shrink-0">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </span>
      )}
    </div>
  </div>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500" role="status">
    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {label}
  </div>
);

export const ErrorBanner: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3" role="alert">
    <span className="flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {message}
    </span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="font-bold underline shrink-0">
        Retry
      </button>
    )}
  </div>
);

export const Empty: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="py-12 px-6 text-center rounded-2xl border border-dashed border-slate-300 bg-white">
    <div className="text-sm font-bold text-slate-800">{title}</div>
    {hint && <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

const pill = 'inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap';

const TICKET_STATUS_CLS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  WAITING_CUSTOMER: 'bg-amber-50 text-amber-800 border-amber-200',
  ESCALATED: 'bg-rose-50 text-rose-700 border-rose-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 border-slate-200'
};
export const TicketStatusPill: React.FC<{ status: TicketStatus }> = ({ status }) => (
  <span className={`${pill} ${TICKET_STATUS_CLS[status]}`}>{TICKET_STATUS_LABELS[status]}</span>
);

const TICKET_PRIORITY_CLS: Record<TicketPriority, string> = {
  LOW: 'bg-slate-50 text-slate-600 border-slate-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
  URGENT: 'bg-rose-50 text-rose-700 border-rose-200'
};
export const TicketPriorityPill: React.FC<{ priority: TicketPriority }> = ({ priority }) => (
  <span className={`${pill} ${TICKET_PRIORITY_CLS[priority]}`}>{TICKET_PRIORITY_LABELS[priority]}</span>
);

const CUSTOMER_STATUS_CLS: Record<CustomerStatusValue, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-slate-100 text-slate-600 border-slate-200',
  PROSPECT: 'bg-blue-50 text-blue-700 border-blue-200'
};
export const CustomerStatusPill: React.FC<{ status: CustomerStatusValue }> = ({ status }) => (
  <span className={`${pill} ${CUSTOMER_STATUS_CLS[status]}`}>{CUSTOMER_STATUS_LABELS[status]}</span>
);

/**
 * Payment status as recorded. "Pending" is an issued invoice; an invoice that
 * is past its due date and not paid is shown as Overdue even if nobody has
 * flipped the stored status yet.
 */
export function paymentStatus(inv: Pick<SupportInvoice, 'status' | 'dueDate'>): 'Paid' | 'Issued' | 'Overdue' {
  if (inv.status === 'Paid') return 'Paid';
  if (inv.status === 'Overdue') return 'Overdue';
  const due = new Date(inv.dueDate.length === 10 ? `${inv.dueDate}T23:59:59` : inv.dueDate);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now() ? 'Overdue' : 'Issued';
}
export const outstandingOf = (inv: Pick<SupportInvoice, 'status' | 'amount'>) => (inv.status === 'Paid' ? 0 : inv.amount);

const PAYMENT_CLS = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Issued: 'bg-blue-50 text-blue-700 border-blue-200',
  Overdue: 'bg-rose-50 text-rose-700 border-rose-200'
};
export const PaymentPill: React.FC<{ invoice: Pick<SupportInvoice, 'status' | 'dueDate'> }> = ({ invoice }) => {
  const s = paymentStatus(invoice);
  return <span className={`${pill} ${PAYMENT_CLS[s]}`}>{s}</span>;
};

export const Pager: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void }> = ({ page, pageSize, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const FormField: React.FC<{ label: string; htmlFor: string; required?: boolean; hint?: string; error?: string | null; children: React.ReactNode }> = ({
  label,
  htmlFor,
  required,
  hint,
  error,
  children
}) => (
  <div>
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700 mb-1">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
    {hint && !error && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    {error && (
      <p className="text-[11px] text-rose-600 mt-1" role="alert">
        {error}
      </p>
    )}
  </div>
);

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

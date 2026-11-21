import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { invoicesApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import type { Invoice } from '../../../shared/contracts';
import { InvoiceDetail } from '../invoices/invoiceShared';
import { Dialog } from '../team-member/pipeline/shared';
import { ghostBtn, LoadingLine } from '../tasks/head/headParts';
import type { AttendanceState, InvoiceRow, LeadState } from '../../lib/headDashboard';

/** Shared bits of the Department Head's Leads, Customers, Invoices and Team Attendance pages. */

const TONE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200'
};
export const Badge: React.FC<{ tone: keyof typeof TONE; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-bold whitespace-nowrap ${TONE[tone]}`}>{children}</span>
);

export const ATTENDANCE_BADGE: Record<AttendanceState, { label: string; tone: keyof typeof TONE }> = {
  PRESENT: { label: 'Present', tone: 'green' }, ABSENT: { label: 'Absent', tone: 'red' }, ON_LEAVE: { label: 'On leave', tone: 'amber' }
};
export const LEAD_BADGE: Record<LeadState, { label: string; tone: keyof typeof TONE }> = {
  NEW: { label: 'New', tone: 'blue' }, IN_PROGRESS: { label: 'In progress', tone: 'amber' }, CONVERTED: { label: 'Converted', tone: 'green' }, LOST: { label: 'Lost', tone: 'slate' }
};
export const CUSTOMER_BADGE: Record<string, { label: string; tone: keyof typeof TONE }> = {
  ACTIVE: { label: 'Active', tone: 'green' }, INACTIVE: { label: 'Inactive', tone: 'slate' }, PROSPECT: { label: 'Prospect', tone: 'violet' }
};
export const InvoiceBadge: React.FC<{ status: InvoiceRow['status']; overdue: boolean }> = ({ status, overdue }) =>
  status === 'Paid' ? <Badge tone="green">Paid</Badge> : status === 'Cancelled' ? <Badge tone="slate">Cancelled</Badge> : overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Pending</Badge>;

/** A page-level message with a way to try again. */
export const PageError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex flex-wrap items-center justify-between gap-2" role="alert">
    <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {message}</span>
    {onRetry && <button type="button" className={`${ghostBtn} !h-9`} onClick={onRetry}>Try again</button>}
  </div>
);

export const EmptyRow: React.FC<{ cols: number; title: string; hint?: string }> = ({ cols, title, hint }) => (
  <tr>
    <td colSpan={cols} className="px-4 py-12 text-center">
      <div className="text-sm font-bold text-slate-800">{title}</div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </td>
  </tr>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th scope="col" className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

/** The existing read-only invoice detail (and its PDF, where the existing invoice permissions allow it), opened by invoice id. */
export const OpenInvoice: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    invoicesApi.get(id).then(i => live && setInvoice(i), e => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [id]);
  if (invoice) return <InvoiceDetail invoice={invoice} onClose={onClose} />;
  return (
    <Dialog title="Invoice" onClose={onClose}>
      {error ? <PageError message={error} /> : <LoadingLine label="Loading the invoice…" />}
    </Dialog>
  );
};

/** Today in India as a yyyy-mm-dd string (the office day attendance is kept in). */
export const officeToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

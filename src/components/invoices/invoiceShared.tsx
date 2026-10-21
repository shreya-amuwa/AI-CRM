import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import type { AddonRequestStatus, Invoice, PricedLine, ServiceCatalogItem } from '../../../shared/contracts';
import type { PricedLineInput } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { invoicesApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, inputCls, longDate, Pill, Spinner, todayIso, type Tone, usePipelineRealtime } from '../team-member/pipeline/shared';
import { InvoiceFileButtons, InvoiceFilePanel, openStoredFile } from './invoiceFiles';
import { GeneratedInvoicePanel, openGeneratedPdf } from './GeneratedInvoicePanel';

// ---------------------------------------------------------------------------
// Formatting and status labels
// ---------------------------------------------------------------------------
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Rupees with paise when there are any (invoices carry tax, so amounts are not always whole). */
export const rupees = (n: number | null | undefined) => (n === null || n === undefined ? '-' : inr2.format(n));

export const ADDON_STATUS_LABEL: Record<AddonRequestStatus, string> = {
  DRAFT: 'Draft',
  PENDING_VERIFICATION: 'Pending Accounts Verification',
  CHANGES_REQUESTED: 'Changes Requested',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  INVOICE_GENERATED: 'Invoice Uploaded',
  PAYMENT_CONFIRMED: 'Payment Confirmed',
  IN_PROGRESS: 'Technical Onboarding In Progress',
  COMPLETED: 'Completed'
};
const ADDON_STATUS_TONE: Record<AddonRequestStatus, Tone> = {
  DRAFT: 'slate',
  PENDING_VERIFICATION: 'orange',
  CHANGES_REQUESTED: 'orange',
  REJECTED: 'red',
  APPROVED: 'indigo',
  INVOICE_GENERATED: 'indigo',
  PAYMENT_CONFIRMED: 'green',
  IN_PROGRESS: 'green',
  COMPLETED: 'green'
};
export const AddonStatusPill: React.FC<{ status: AddonRequestStatus }> = ({ status }) => <Pill tone={ADDON_STATUS_TONE[status]}>{ADDON_STATUS_LABEL[status]}</Pill>;

/** Payment state of an add-on request, kept apart from its verification state. */
export function addonPaymentState(r: { status: AddonRequestStatus; total: number; paid: number; pendingPayments: number; invoice: Invoice | null }): { label: string; tone: Tone } {
  if (!r.invoice) return { label: 'No invoice yet', tone: 'slate' };
  if (r.invoice.status === 'Paid' || ['PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status)) return { label: 'Payment Confirmed', tone: 'green' };
  if (r.pendingPayments > 0) return { label: 'Payment awaiting verification', tone: 'orange' };
  if (r.paid >= r.total) return { label: 'Paid - awaiting confirmation', tone: 'indigo' };
  if (r.paid > 0) return { label: `Part paid (${rupees(r.paid)} of ${rupees(r.total)})`, tone: 'orange' };
  return { label: 'Pending Payment', tone: 'orange' };
}

const isOverdue = (i: Invoice) => i.status !== 'Paid' && !!i.dueDate && i.dueDate < todayIso();
export const InvoiceStatusPill: React.FC<{ invoice: Invoice }> = ({ invoice }) =>
  invoice.status === 'Paid' ? (
    <Pill tone="green">Paid</Pill>
  ) : invoice.generated?.paymentSummary?.state === 'PARTIALLY_PAID' ? (
    <Pill tone="indigo">Partially paid</Pill>
  ) : isOverdue(invoice) || invoice.status === 'Overdue' ? (
    <Pill tone="red">Overdue</Pill>
  ) : (
    <Pill tone="orange">Pending</Pill>
  );

export const INVOICE_KIND_LABEL: Record<Invoice['kind'], string> = { SERVICE: 'Services', ADDON: 'Add-on services', MANUAL: 'Earlier invoice', UPLOADED: 'Uploaded PDF', GENERATED: 'Generated invoice' };

// ---------------------------------------------------------------------------
// PDF (generated in the browser from the invoice record; text only, standard fonts)
// ---------------------------------------------------------------------------
const pdfText = (s: string) =>
  s
    .replace(/₹/g, 'Rs. ')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
const pdfAmount = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Helvetica glyph widths (1/1000 em) for the characters right-aligned columns use.
const W: Record<string, number> = { ' ': 278, ',': 278, '.': 278, '%': 889, '-': 333, R: 722, s: 500 };
const width = (s: string, size: number) => ([...s].reduce((w, ch) => w + (W[ch] ?? 556), 0) * size) / 1000;

export function invoicePdf(inv: Invoice): Blob {
  const ops: string[] = [];
  const text = (x: number, y: number, s: string, size = 10, bold = false, align: 'left' | 'right' = 'left') => {
    const px = align === 'right' ? x - width(s, size) : x;
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(s)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  let y = 790;
  text(50, y, 'INVOICE', 22, true);
  text(545, y, inv.number, 12, true, 'right');
  y -= 18;
  text(545, y, `Status: ${inv.status === 'Paid' ? 'Paid' : isOverdue(inv) ? 'Overdue' : 'Pending'}`, 10, false, 'right');
  text(50, y, `Amuwa${inv.department ? ` - ${inv.department}` : ''}`, 10);
  y -= 30;
  text(50, y, 'Billed to', 9, true);
  text(330, y, 'Issue date', 9, true);
  text(440, y, 'Due date', 9, true);
  y -= 14;
  text(50, y, inv.customer, 11, true);
  text(330, y, longDate(inv.issueDate), 10);
  text(440, y, inv.dueDate ? longDate(inv.dueDate) : '-', 10);
  y -= 14;
  if (inv.contact && inv.contact !== inv.customer) {
    text(50, y, inv.contact, 10);
    y -= 14;
  }
  if (inv.customerCode) {
    text(50, y, `Customer ID: ${inv.customerCode}`, 9);
    y -= 14;
  }
  text(50, y, `For: ${INVOICE_KIND_LABEL[inv.kind]}`, 9);
  y -= 26;
  // table
  const cols = { desc: 50, qty: 300, price: 375, disc: 440, tax: 480, amt: 545 };
  text(cols.desc, y, 'Description', 9, true);
  text(cols.qty, y, 'Qty', 9, true, 'right');
  text(cols.price, y, 'Unit price', 9, true, 'right');
  text(cols.disc, y, 'Discount', 9, true, 'right');
  text(cols.tax, y, 'Tax', 9, true, 'right');
  text(cols.amt, y, 'Amount', 9, true, 'right');
  y -= 6;
  line(50, y, 545, y);
  y -= 14;
  for (const it of inv.items) {
    const name = it.name.length > 48 ? `${it.name.slice(0, 47)}...` : it.name;
    text(cols.desc, y, name, 9);
    text(cols.qty, y, String(it.quantity), 9, false, 'right');
    text(cols.price, y, pdfAmount(it.unitPrice), 9, false, 'right');
    text(cols.disc, y, it.discount ? pdfAmount(it.discount) : '-', 9, false, 'right');
    text(cols.tax, y, `${it.taxPercent}%`, 9, false, 'right');
    text(cols.amt, y, pdfAmount(it.lineTotal ?? it.quantity * it.unitPrice - it.discount + (it.tax ?? 0)), 9, false, 'right');
    y -= 16;
  }
  line(50, y + 8, 545, y + 8);
  y -= 6;
  for (const [label, value, bold] of [
    ['Subtotal', inv.subtotal ?? 0, false],
    ['Discount', -inv.discount, false],
    ['Tax', inv.tax, false],
    ['Total', inv.total ?? 0, true]
  ] as const) {
    text(440, y, label, bold ? 11 : 10, bold, 'right');
    text(545, y, value < 0 ? `- ${pdfAmount(-value)}` : pdfAmount(value), bold ? 11 : 10, bold, 'right');
    y -= bold ? 18 : 15;
  }
  if (inv.note) {
    y -= 10;
    text(50, y, `Note: ${inv.note.slice(0, 110)}`, 9);
    y -= 14;
  }
  text(50, 60, `Issued by the Accounts department${inv.issuedBy ? ` (${inv.issuedBy})` : ''} on ${longDate(inv.issuedAt)}.`, 8);
  if (inv.paidAt) text(50, 48, `Paid on ${longDate(inv.paidAt)}.`, 8);

  const content = `0.6 G 0.5 w\n${ops.join('\n')}`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}

export function downloadInvoice(inv: Invoice) {
  // An uploaded invoice is the original PDF Accounts stored: download that file, never a regenerated one.
  if (inv.kind === 'UPLOADED' && inv.file) {
    void openStoredFile(inv.file.documentId, 'download').catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(invoicePdf(inv));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv.number}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Invoice detail (read-only everywhere; Accounts adds its own actions through `actions`)
// ---------------------------------------------------------------------------
export const InvoiceDetail: React.FC<{
  invoice: Invoice;
  onClose: () => void;
  actions?: React.ReactNode;
  /** Accounts only: replace the PDF / edit the details of an uploaded invoice. */
  canManage?: boolean;
  onChanged?: (invoice: Invoice) => void;
}> = ({ invoice: given, onClose, actions, canManage, onChanged }) => {
  const [i, setI] = useState(given);
  useEffect(() => setI(given), [given]);
  const uploaded = i.kind === 'UPLOADED';
  const generated = i.kind === 'GENERATED';
  return (
    <Dialog title={`Invoice ${i.number}`} description={`${INVOICE_KIND_LABEL[i.kind]} · ${i.customer}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {(
          [
            ['Customer', `${i.customer}${i.customerCode ? ` (${i.customerCode})` : ''}`],
            ['Issue date', longDate(i.issueDate)],
            ['Due date', i.dueDate ? longDate(i.dueDate) : '-'],
            ['Department', i.department || '-'],
            ...(uploaded ? ([['Invoice total', i.total === null ? '-' : rupees(i.total)], ['Reference', i.reference || '-']] as const) : [])
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-[11px] text-slate-500">{k}</div>
            <div className="mt-0.5 font-semibold text-slate-800 break-words">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <InvoiceStatusPill invoice={i} />
        {i.paidAt && <span>Paid on {longDate(i.paidAt)}</span>}
        <span>
          · {uploaded ? 'Uploaded' : 'Issued'} by {i.issuedBy || 'Accounts'} on {longDate(i.issuedAt)}
        </span>
      </div>
      {generated ? (
        <GeneratedInvoicePanel
          invoice={i}
          canManage={canManage}
          onChanged={inv => {
            setI(inv);
            onChanged?.(inv);
          }}
        />
      ) : uploaded ? (
        <InvoiceFilePanel
          invoice={i}
          canManage={canManage}
          onChanged={inv => {
            setI(inv);
            onChanged?.(inv);
          }}
        />
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Service</th>
                  <th className="text-right font-semibold px-3 py-2">Qty</th>
                  <th className="text-right font-semibold px-3 py-2">Unit price</th>
                  <th className="text-right font-semibold px-3 py-2">Discount</th>
                  <th className="text-right font-semibold px-3 py-2">Tax</th>
                  <th className="text-right font-semibold px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {i.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                      This invoice has no line details.
                    </td>
                  </tr>
                ) : (
                  i.items.map((it, n) => (
                    <tr key={it.id || n}>
                      <td className="px-3 py-2 text-slate-800">{it.name}</td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{rupees(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right">{it.discount ? rupees(it.discount) : '-'}</td>
                      <td className="px-3 py-2 text-right">{it.taxPercent}%</td>
                      <td className="px-3 py-2 text-right font-semibold">{rupees(it.lineTotal ?? null)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Totals subtotal={i.subtotal ?? 0} discount={i.discount} tax={i.tax} total={i.total ?? 0} />
        </>
      )}
      {i.note && <p className="text-xs text-slate-600 whitespace-pre-line">Note: {i.note}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
        {actions}
        {!uploaded && !generated && (
          <button type="button" className={btn.secondary} onClick={() => downloadInvoice(i)}>
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download PDF
          </button>
        )}
        <button type="button" className={btn.primary} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
};

/** Per-row actions: the stored PDF (Preview / Download) for an uploaded invoice, a generated PDF otherwise. */
export const InvoiceRowActions: React.FC<{ invoice: Invoice }> = ({ invoice: i }) => {
  // A generated invoice has a file only once the paid invoice is stored (older invoices may still have their unpaid file).
  const stage = i.kind === 'GENERATED' ? (i.generated?.paid.pdfStatus === 'STORED' ? 'PAID' : i.generated?.unpaid.pdfStatus === 'STORED' ? 'UNPAID' : null) : null;
  return i.kind === 'GENERATED' ? (
    stage ? (
      <button
        type="button"
        className={btn.secondary}
        onClick={e => {
          e.stopPropagation();
          void openGeneratedPdf(i.id, stage, 'download').catch(() => undefined);
        }}
        aria-label={`Download ${i.number}`}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF
      </button>
    ) : (
      <span className="text-[11px] text-slate-400">Paid copy after payment</span>
    )
  ) : i.kind === 'UPLOADED' && i.file ? (
    <InvoiceFileButtons file={i.file} number={i.number} compact />
  ) : (
    <button type="button" className={btn.secondary} onClick={e => { e.stopPropagation(); downloadInvoice(i); }} aria-label={`Download ${i.number}`}>
      <Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF
    </button>
  );
};

export const Totals: React.FC<{ subtotal: number; discount: number; tax: number; total: number; label?: string }> = ({ subtotal, discount, tax, total, label = 'Total' }) => (
  <dl className="ml-auto w-full sm:w-72 text-xs space-y-1">
    <div className="flex justify-between text-slate-600">
      <dt>Subtotal</dt>
      <dd>{rupees(subtotal)}</dd>
    </div>
    <div className="flex justify-between text-slate-600">
      <dt>Discount</dt>
      <dd>{discount ? `- ${rupees(discount)}` : rupees(0)}</dd>
    </div>
    <div className="flex justify-between text-slate-600">
      <dt>Tax</dt>
      <dd>{rupees(tax)}</dd>
    </div>
    <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-bold text-slate-900">
      <dt>{label}</dt>
      <dd>{rupees(total)}</dd>
    </div>
  </dl>
);

/** Read-only list of one customer's invoices (Sales, Technical Consultant, Support, heads). */
export const CustomerInvoices: React.FC<{ customerId: string; compact?: boolean; kind?: Invoice['kind']; /** Accounts: replace the PDF / edit details from the opened invoice. */ canManage?: boolean }> = ({ customerId, compact, kind, canManage }) => {
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const load = useCallback(() => {
    invoicesApi.forCustomer(customerId).then(
      v => {
        setItems(kind ? v.filter(i => i.kind === kind) : v);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [customerId, kind]);
  useEffect(load, [load]);
  usePipelineRealtime(load);
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!items) return <Spinner label="Loading invoices…" />;
  return (
    <div>
      {items.length === 0 ? (
        <p className={`${compact ? 'py-2' : 'py-6 text-center'} text-xs text-slate-500`}>No invoice has been issued by Accounts yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden" aria-label="Invoices">
          {items.map(i => (
            <li key={i.id}>
              <button type="button" onClick={() => setOpen(i)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-xs hover:bg-slate-50">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <span className="font-semibold text-slate-800">{i.number}</span>
                <span className="text-slate-500">{INVOICE_KIND_LABEL[i.kind]}</span>
                <span className="text-slate-500">Issued {longDate(i.issueDate)}</span>
                {i.dueDate && <span className="text-slate-500">Due {longDate(i.dueDate)}</span>}
                {i.file && <span className="text-slate-600 truncate max-w-[14rem]" title={i.file.fileName}>{i.file.fileName}</span>}
                <span className="ml-auto font-bold text-slate-900">{rupees(i.total)}</span>
                <InvoiceStatusPill invoice={i} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <InvoiceDetail invoice={open} canManage={canManage} onChanged={inv => { setOpen(inv); load(); }} onClose={() => setOpen(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Priced lines editor (Technical Consultant add-on request, Accounts invoice)
// ---------------------------------------------------------------------------
export interface LineDraft {
  key: string;
  serviceCode: string;
  name: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxPercent: string;
}
let seq = 0;
export const newLine = (serviceCode = '', name = ''): LineDraft => ({ key: `l${++seq}`, serviceCode, name, quantity: '1', unitPrice: '', discount: '0', taxPercent: '18' });
export const linesFrom = (items: PricedLine[]): LineDraft[] =>
  items.map(i => ({
    key: `l${++seq}`,
    serviceCode: i.serviceCode || '',
    name: i.serviceCode ? '' : i.name,
    quantity: String(i.quantity),
    unitPrice: String(i.unitPrice),
    discount: String(i.discount || 0),
    taxPercent: String(i.taxPercent || 0)
  }));
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const round2 = (n: number) => Math.round(n * 100) / 100;
export function lineTotals(l: LineDraft) {
  const qty = num(l.quantity), price = num(l.unitPrice), disc = num(l.discount || '0'), tax = num(l.taxPercent || '0');
  if ([qty, price, disc, tax].some(n => Number.isNaN(n))) return null;
  const base = round2(qty * price - disc);
  const t = round2((base * tax) / 100);
  return { subtotal: round2(qty * price), discount: disc, tax: t, total: round2(base + t) };
}
export function draftTotals(lines: LineDraft[]) {
  return lines.reduce(
    (a, l) => {
      const t = lineTotals(l);
      return t ? { subtotal: a.subtotal + t.subtotal, discount: a.discount + t.discount, tax: a.tax + t.tax, total: round2(a.total + t.total) } : a;
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );
}
/** Checks what the database will also check, so the user sees the problem on the right line. */
export function validateLines(lines: LineDraft[]): string | null {
  if (lines.length === 0) return 'Add at least one service.';
  for (const [n, l] of lines.entries()) {
    const at = `Line ${n + 1}`;
    if (!l.serviceCode && l.name.trim().length < 2) return `${at}: choose a service or type its name.`;
    const qty = num(l.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return `${at}: the quantity must be a whole number from 1 to 1000.`;
    const price = num(l.unitPrice);
    if (Number.isNaN(price) || price < 0 || round2(price) !== price) return `${at}: enter the agreed price in rupees (up to 2 decimals).`;
    const disc = num(l.discount || '0');
    if (Number.isNaN(disc) || disc < 0 || round2(disc) !== disc) return `${at}: enter the discount in rupees (up to 2 decimals).`;
    if (disc > qty * price) return `${at}: the discount cannot be more than the line amount.`;
    const tax = num(l.taxPercent || '0');
    if (Number.isNaN(tax) || tax < 0 || tax > 100) return `${at}: tax is 0 to 100 %.`;
  }
  return null;
}
export const toInput = (lines: LineDraft[]): PricedLineInput[] =>
  lines.map(l => ({
    serviceCode: l.serviceCode || null,
    name: l.serviceCode ? undefined : l.name.trim(),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discount: Number(l.discount || 0),
    taxPercent: Number(l.taxPercent || 0)
  }));

export const PricedLinesEditor: React.FC<{
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  catalog: ServiceCatalogItem[];
  disabled?: boolean;
  idPrefix: string;
}> = ({ lines, onChange, catalog, disabled, idPrefix }) => {
  const set = (key: string, patch: Partial<LineDraft>) => onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const cell = 'px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 w-full';
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-semibold px-2 py-2 w-[34%]">Service</th>
              <th className="text-left font-semibold px-2 py-2">Qty</th>
              <th className="text-left font-semibold px-2 py-2">Unit price (Rs.)</th>
              <th className="text-left font-semibold px-2 py-2">Discount (Rs.)</th>
              <th className="text-left font-semibold px-2 py-2">Tax %</th>
              <th className="text-right font-semibold px-2 py-2">Amount</th>
              <th className="px-2 py-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, n) => {
              const t = lineTotals(l);
              const id = `${idPrefix}-${l.key}`;
              return (
                <tr key={l.key}>
                  <td className="px-2 py-1.5 space-y-1">
                    <label htmlFor={`${id}-svc`} className="sr-only">
                      Line {n + 1} service
                    </label>
                    <select id={`${id}-svc`} className={cell} value={l.serviceCode || '__other'} disabled={disabled} onChange={e => set(l.key, { serviceCode: e.target.value === '__other' ? '' : e.target.value })}>
                      {catalog.map(s => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                      <option value="__other">Other (type the name)</option>
                    </select>
                    {!l.serviceCode && (
                      <input aria-label={`Line ${n + 1} service name`} className={cell} value={l.name} maxLength={120} disabled={disabled} placeholder="Service name" onChange={e => set(l.key, { name: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input aria-label={`Line ${n + 1} quantity`} className={cell} inputMode="numeric" value={l.quantity} disabled={disabled} onChange={e => set(l.key, { quantity: e.target.value.replace(/[^\d]/g, '') })} />
                  </td>
                  <td className="px-2 py-1.5 w-32">
                    <input aria-label={`Line ${n + 1} unit price`} className={cell} inputMode="decimal" value={l.unitPrice} disabled={disabled} placeholder="0" onChange={e => set(l.key, { unitPrice: e.target.value.replace(/[^\d.]/g, '') })} />
                  </td>
                  <td className="px-2 py-1.5 w-28">
                    <input aria-label={`Line ${n + 1} discount`} className={cell} inputMode="decimal" value={l.discount} disabled={disabled} onChange={e => set(l.key, { discount: e.target.value.replace(/[^\d.]/g, '') })} />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input aria-label={`Line ${n + 1} tax percent`} className={cell} inputMode="decimal" value={l.taxPercent} disabled={disabled} onChange={e => set(l.key, { taxPercent: e.target.value.replace(/[^\d.]/g, '') })} />
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap">{t ? rupees(t.total) : '-'}</td>
                  <td className="px-2 py-1.5 text-right">
                    {!disabled && lines.length > 1 && (
                      <button type="button" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label={`Remove line ${n + 1}`} onClick={() => onChange(lines.filter(x => x.key !== l.key))}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {!disabled && lines.length < 30 ? (
          <button type="button" className={btn.secondary} onClick={() => onChange([...lines, newLine(catalog[0]?.code || '')])}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a line
          </button>
        ) : (
          <span />
        )}
        <Totals {...draftTotals(lines)} label="Total (preview)" />
      </div>
    </div>
  );
};

export { inputCls };

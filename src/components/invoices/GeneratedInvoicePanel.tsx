import React, { useRef, useState } from 'react';
import { BadgeCheck, Download, Eye, FileText, Mail, RefreshCw } from 'lucide-react';
import { PAYMENT_METHODS, type GeneratedInvoice, type InvoicePaymentState, type InvoicePaymentSummary, type GeneratedInvoiceStageState, type Invoice, type InvoiceRunResult, type InvoiceStage, type InvoiceStep, type PaymentMethod } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { generatedInvoicesApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, Field, inputCls, longDate, notifyPipelineChanged, Pill, selectCls, todayIso, type Tone } from '../team-member/pipeline/shared';
import { rupees } from './invoiceShared';
import { toPaise } from '../../../shared/invoiceCalc';
import { InvoiceBusinessCard } from './InvoiceBusinessCard';

const METHOD_LABEL: Record<PaymentMethod, string> = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' };
const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-');

/** Opens a stored PDF: the tab is opened inside the click (so pop-up blockers allow it), then pointed at the short-lived link. */
export async function openGeneratedPdf(invoiceId: string, stage: InvoiceStage, action: 'view' | 'download'): Promise<void> {
  const win = action === 'view' ? window.open('', '_blank') : null;
  try {
    const { url } = await generatedInvoicesApi.fileUrl(invoiceId, stage, action);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.click();
    }
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Says what a step did, in words Accounts can act on. */
export const StepList: React.FC<{ steps: InvoiceStep[] }> = ({ steps }) => {
  const label = (s: InvoiceStep) =>
    ({
      ISSUE: 'Invoice saved',
      PAYMENT: 'Payment confirmed',
      PDF: s.stage === 'PAID' ? 'Paid invoice PDF created and stored' : 'Invoice PDF created and stored',
      EMAIL: s.stage === 'PAID' ? 'Paid invoice e-mailed to the customer' : 'Invoice e-mailed to the customer'
    })[s.step];
  const tone = (s: InvoiceStep): string =>
    s.status === 'DONE' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : s.status === 'FAILED' ? 'text-rose-800 bg-rose-50 border-rose-200' : 'text-amber-900 bg-amber-50 border-amber-200';
  const word = (s: InvoiceStep) => ({ DONE: 'Done', FAILED: 'Failed', NOT_SENT: 'Not sent', BUSY: 'In progress elsewhere' })[s.status];
  return (
    <ul className="space-y-1.5" aria-label="What happened" role="status">
      {steps.map((s, i) => (
        <li key={i} className={`flex flex-wrap items-baseline gap-x-2 text-xs rounded-lg border px-3 py-2 ${tone(s)}`}>
          <b>{label(s)}</b>
          <span>{word(s)}</span>
          {s.message && <span className="basis-full opacity-90">{s.message}</span>}
        </li>
      ))}
    </ul>
  );
};

const pdfPill = (st: GeneratedInvoiceStageState): { tone: Tone; text: string } =>
  st.pdfStatus === 'STORED' ? { tone: 'green', text: 'PDF stored' } : st.pdfStatus === 'FAILED' ? { tone: 'red', text: 'PDF failed' } : st.pdfStatus === 'NOT_DUE' ? { tone: 'slate', text: 'Not due yet' } : { tone: 'orange', text: 'PDF not created yet' };
const mailPill = (st: GeneratedInvoiceStageState): { tone: Tone; text: string } =>
  st.emailStatus === 'SENT' ? { tone: 'green', text: 'E-mail sent' }
  : st.emailStatus === 'FAILED' ? { tone: 'red', text: 'E-mail failed' }
  : st.emailStatus === 'NOT_SENT' ? { tone: 'orange', text: 'E-mail not sent' }
  : st.emailStatus === 'NOT_DUE' ? { tone: 'slate', text: 'Not due yet' }
  : { tone: 'orange', text: 'E-mail not sent yet' };

// ---------------------------------------------------------------------------
// Confirm payment
// ---------------------------------------------------------------------------
const STATE_LABEL: Record<InvoicePaymentState, string> = { UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially paid', FULLY_PAID: 'Fully paid' };
const STATE_TONE: Record<InvoicePaymentState, Tone> = { UNPAID: 'orange', PARTIALLY_PAID: 'indigo', FULLY_PAID: 'green' };

/** What the invoice came to, what was confirmed, what is left. All of it comes from the database's payment records. */
export const PaymentSummaryCard: React.FC<{ summary: InvoicePaymentSummary }> = ({ summary: s }) => (
  <section aria-label="Payment summary" className="rounded-xl border border-slate-200 p-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-xs font-bold text-slate-800">Payment</h4>
      <Pill tone={STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</Pill>
    </div>
    <dl className="grid grid-cols-3 gap-3 text-xs">
      <div>
        <dt className="text-[11px] text-slate-500">Invoice total</dt>
        <dd className="font-semibold text-slate-900">{rupees(s.total)}</dd>
      </div>
      <div>
        <dt className="text-[11px] text-slate-500">Confirmed payments</dt>
        <dd className="font-semibold text-slate-900">{rupees(s.confirmed)}</dd>
      </div>
      <div>
        <dt className="text-[11px] text-slate-500">{s.order ? 'Balance due on this invoice' : 'Balance outstanding'}</dt>
        <dd className={`font-bold ${s.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{rupees(s.balance)}</dd>
      </div>
    </dl>
    {s.order && (
      <dl className="grid grid-cols-3 gap-3 text-xs rounded-lg bg-slate-50 border border-slate-100 p-2.5" aria-label="Whole order">
        <div>
          <dt className="text-[11px] text-slate-500">Total order value (incl. GST)</dt>
          <dd className="font-semibold text-slate-900">{rupees(s.order.totalPayable)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Total confirmed payments</dt>
          <dd className="font-semibold text-slate-900">{rupees(s.order.confirmed)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Total order balance outstanding</dt>
          <dd className={`font-bold ${s.order.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{rupees(s.order.balance)}</dd>
        </div>
      </dl>
    )}
    {s.pending > 0 && <p className="text-[11px] text-amber-800">{rupees(s.pending)} is recorded but not verified yet. It is not counted until it is verified.</p>}
    {s.payments.length > 0 && (
      <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg text-[11px]" aria-label="Confirmed payments">
        {s.payments.map((p, i) => (
          <li key={i} className="px-2.5 py-1.5 flex flex-wrap gap-x-3">
            <span className="font-semibold text-slate-800">{rupees(p.amount)}</span>
            <span className="text-slate-500">
              {[p.method ? METHOD_LABEL[p.method] : null, p.reference, longDate(p.paidAt)].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    )}
    <p className="text-[11px] text-slate-500">
      {s.ledger === 'CUSTOMER'
        ? 'Payments of the agreed services are recorded and verified in Payments.'
        : s.ledger === 'ADDON'
          ? 'Add-on payments are recorded and verified in Business Verification.'
          : 'Payments are recorded on this invoice.'}
    </p>
  </section>
);

// ---------------------------------------------------------------------------
// Confirm payment: the one workflow for the paid invoice
// ---------------------------------------------------------------------------
export const ConfirmPaymentDialog: React.FC<{ invoice: Invoice; onClose: () => void; onDone: (r: InvoiceRunResult) => void }> = ({ invoice, onClose, onDone }) => {
  const summary = invoice.generated?.paymentSummary ?? null;
  const onInvoice = summary?.ledger === 'INVOICE';
  const balancePaise = summary ? Math.round(summary.balance * 100) : 0;
  const [amount, setAmount] = useState(summary && onInvoice ? String(summary.balance) : '');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvoiceRunResult | null>(null);
  // One id per dialog: a double click or a retry after a timeout records the payment once.
  const requestId = useRef(crypto.randomUUID());
  const amountPaise = toPaise(amount);
  const partial = onInvoice && amountPaise !== null && amountPaise > 0 && amountPaise < balancePaise;
  const needsMoney = !!summary && !onInvoice && summary.balance > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || result || needsMoney) return;
    if (onInvoice) {
      if (amountPaise === null || amountPaise <= 0) return setError('Enter the amount received in rupees (more than zero, up to 2 decimals).');
      if (amountPaise > balancePaise) return setError(`The amount is more than the balance of this invoice (${rupees(summary?.balance)}).`);
      if (!method) return setError('Choose how the payment was received.');
    }
    setBusy(true);
    setError(null);
    try {
      const r = await generatedInvoicesApi.confirmPayment(invoice.id, {
        ...(onInvoice ? { method: method as PaymentMethod, reference: reference.trim() || null, paidOn: paidOn || null, amount: amount.trim() } : {}),
        note: note.trim() || null,
        requestId: requestId.current
      });
      setResult(r);
      notifyPipelineChanged();
      onDone(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={partial ? 'Record a part payment' : 'Confirm Payment & Send Paid Invoice'}
      description={`Invoice ${invoice.number} for ${rupees(invoice.total)}. ${
        partial
          ? 'The part payment is recorded and the invoice stays open with its balance. The paid invoice is made when the balance is zero.'
          : 'Confirming marks the invoice paid, creates the paid invoice with the PAID stamp (same number and amounts) and e-mails it to the customer.'
      }`}
      onClose={onClose}
      persistent
    >
      {result ? (
        <div className="space-y-3">
          <StepList steps={result.steps} />
          <div className="flex justify-end">
            <button type="button" className={btn.primary} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" aria-label="Confirm payment">
          {summary && <PaymentSummaryCard summary={summary} />}
          {needsMoney && (
            <p role="alert" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {rupees(summary?.confirmed)} of {rupees(summary?.total)} is confirmed. Record and verify the remaining {rupees(summary?.balance)} in{' '}
              {summary?.ledger === 'ADDON' ? 'Business Verification' : 'Payments'}, then confirm the payment here.
            </p>
          )}
          {onInvoice && (
            <>
              <Field label="Amount received now (Rs.)" required htmlFor="cp-amount">
                <input id="cp-amount" className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} />
              </Field>
              <Field label="How was the payment received?" required htmlFor="cp-method">
                <select id="cp-method" className={`${inputCls}`} value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
                  <option value="">Choose…</option>
                  {PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Transaction reference" htmlFor="cp-ref">
                  <input id="cp-ref" className={inputCls} value={reference} maxLength={120} onChange={e => setReference(e.target.value)} disabled={busy} />
                </Field>
                <Field label="Payment date" htmlFor="cp-date">
                  <input id="cp-date" type="date" className={inputCls} value={paidOn} max={todayIso()} onChange={e => setPaidOn(e.target.value)} disabled={busy} />
                </Field>
              </div>
            </>
          )}
          <Field label="Note" htmlFor="cp-note">
            <input id="cp-note" className={inputCls} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} disabled={busy} />
          </Field>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={btn.green} disabled={busy || needsMoney}>
              <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Saving…' : partial ? 'Record part payment' : 'Confirm Payment & Send Paid Invoice'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// One document (unpaid or paid): its PDF, its e-mail, the buttons
// ---------------------------------------------------------------------------
const StageCard: React.FC<{ invoice: Invoice; stage: InvoiceStage; state: GeneratedInvoiceStageState; canManage: boolean; onRun: (r: InvoiceRunResult) => void }> = ({ invoice, stage, state, canManage, onRun }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdf = pdfPill(state);
  const mail = mailPill(state);
  const title = stage === 'UNPAID' ? 'Unpaid invoice' : 'Paid invoice (with the PAID stamp)';
  const notDue = state.pdfStatus === 'NOT_DUE';
  const open = async (action: 'view' | 'download') => {
    setBusy(action);
    setError(null);
    try {
      await openGeneratedPdf(invoice.id, stage, action);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const retry = async () => {
    setBusy('retry');
    setError(null);
    try {
      const r = await generatedInvoicesApi.deliver(invoice.id, stage);
      onRun(r);
      notifyPipelineChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const incomplete = !notDue && (state.pdfStatus !== 'STORED' || state.emailStatus !== 'SENT');
  return (
    <section className="rounded-xl border border-slate-200 p-3 space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h4 className="text-xs font-bold text-slate-800">{title}</h4>
        <Pill tone={pdf.tone}>{pdf.text}</Pill>
        <Pill tone={mail.tone}>{mail.text}</Pill>
        {state.busy && <Pill tone="indigo">Being processed</Pill>}
      </div>
      <p className="text-[11px] text-slate-500">
        {notDue
          ? 'Created when the payment is confirmed.'
          : [
              state.storedAt ? `Stored ${stamp(state.storedAt)}${state.sizeBytes ? ` (${Math.round(state.sizeBytes / 1024)} KB)` : ''}` : null,
              state.emailSentAt ? `e-mailed to ${state.emailTo} on ${stamp(state.emailSentAt)}` : null
            ]
              .filter(Boolean)
              .join(' · ') || 'Nothing stored or sent yet.'}
      </p>
      {state.pdfError && state.pdfStatus !== 'STORED' && <p role="alert" className="text-[11px] text-rose-700">PDF: {state.pdfError}</p>}
      {state.emailError && state.emailStatus !== 'SENT' && <p role="alert" className="text-[11px] text-rose-700">E-mail: {state.emailError}</p>}
      <div className="flex flex-wrap gap-2">
        {state.pdfStatus === 'STORED' && (
          <>
            <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void open('view')} aria-label={`Preview the ${stage === 'PAID' ? 'paid' : 'unpaid'} PDF of invoice ${invoice.number}`}>
              <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Preview
            </button>
            <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void open('download')} aria-label={`Download the ${stage === 'PAID' ? 'paid' : 'unpaid'} PDF of invoice ${invoice.number}`}>
              <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download
            </button>
          </>
        )}
        {canManage && incomplete && (
          <button type="button" className={btn.primary} disabled={!!busy || state.busy} onClick={() => void retry()}>
            {state.pdfStatus !== 'STORED' ? <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> : <Mail className="w-3.5 h-3.5" aria-hidden="true" />}
            {busy === 'retry' ? 'Working…' : state.pdfStatus !== 'STORED' ? 'Create PDF and send again' : 'Send the e-mail again'}
          </button>
        )}
      </div>
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

// ---------------------------------------------------------------------------
// The whole generated invoice
// ---------------------------------------------------------------------------
export const GeneratedInvoicePanel: React.FC<{ invoice: Invoice; canManage?: boolean; onChanged?: (invoice: Invoice) => void; steps?: InvoiceStep[] }> = ({ invoice, canManage = false, onChanged, steps: given }) => {
  const g: GeneratedInvoice | null | undefined = invoice.generated;
  const [steps, setSteps] = useState<InvoiceStep[] | null>(given ?? null);
  const [confirming, setConfirming] = useState(false);
  if (!g) return <p className="text-xs text-slate-500">The details of this invoice are not available.</p>;
  const t = g.totals;
  const run = (r: InvoiceRunResult) => {
    setSteps(r.steps);
    onChanged?.(r.invoice);
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {(
          [
            ['Invoice date', longDate(g.invoiceDate)],
            ['Order No.', g.orderNumber],
            ['Billed to', g.customer.businessName || g.customer.name],
            ['GST No.', g.customer.gstin || '-'],
            ['State', `${g.customer.state} (${g.customer.stateCode})`],
            ['Contact', [g.customer.contactPerson, g.customer.contactNumber].filter(Boolean).join(' · ') || '-'],
            ['Tax', g.taxTreatment === 'INTRA_STATE' ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)'],
            ['Payment', g.lifecycle === 'PAID' && g.payment ? `Confirmed ${stamp(g.payment.confirmedAt)}${g.payment.method ? ` · ${METHOD_LABEL[g.payment.method]}` : ''}${g.payment.reference ? ` · ${g.payment.reference}` : ''}` : 'Not confirmed yet']
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-[11px] text-slate-500">{k}</div>
            <div className="mt-0.5 font-semibold text-slate-800 break-words">{v}</div>
          </div>
        ))}
      </div>
      {g.taxTreatmentOverridden && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Tax treatment set by Accounts: {g.taxOverrideReason}</p>}
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Sr.</th>
              <th className="text-left font-semibold px-3 py-2">Particulars</th>
              <th className="text-left font-semibold px-3 py-2">HSN/SAC</th>
              <th className="text-right font-semibold px-3 py-2">Tax rate</th>
              <th className="text-left font-semibold px-3 py-2">Qty.</th>
              <th className="text-right font-semibold px-3 py-2">Invoice amount</th>
              <th className="text-right font-semibold px-3 py-2">GST</th>
              <th className="text-right font-semibold px-3 py-2">Total with tax</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {g.lines.map(l => (
              <tr key={l.position}>
                <td className="px-3 py-2">{l.position}</td>
                <td className="px-3 py-2 text-slate-800">{l.particulars}</td>
                <td className="px-3 py-2">{l.hsnSac}</td>
                <td className="px-3 py-2 text-right">{l.taxRate}%</td>
                <td className="px-3 py-2">{l.quantity}</td>
                <td className="px-3 py-2 text-right">{rupees(l.baseAmount)}</td>
                <td className="px-3 py-2 text-right">{rupees(l.gstAmount)}</td>
                <td className="px-3 py-2 text-right font-semibold">{rupees(l.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto w-full sm:w-80 text-xs space-y-1">
        <div className="flex justify-between text-slate-600"><dt>Total amount before tax</dt><dd>{rupees(t.subtotal)}</dd></div>
        {t.breakdown.map(b =>
          g.taxTreatment === 'INTRA_STATE' ? (
            <React.Fragment key={b.rate}>
              <div className="flex justify-between text-slate-600"><dt>CGST @ {b.rate / 2}%</dt><dd>{rupees(b.cgst)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>SGST @ {b.rate / 2}%</dt><dd>{rupees(b.sgst)}</dd></div>
            </React.Fragment>
          ) : (
            <div key={b.rate} className="flex justify-between text-slate-600"><dt>IGST @ {b.rate}%</dt><dd>{rupees(b.igst)}</dd></div>
          )
        )}
        <div className="flex justify-between text-slate-600"><dt>Tax amount GST</dt><dd>{rupees(t.totalGst)}</dd></div>
        <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-bold text-slate-900"><dt>Final amount after tax</dt><dd>{rupees(t.total)}</dd></div>
        <div className="text-[11px] text-slate-500 text-right">{t.inWords}</div>
      </dl>
      {g.paymentSummary && <PaymentSummaryCard summary={g.paymentSummary} />}
      {canManage && g.purpose === 'ADDITIONAL' && <InvoiceBusinessCard invoiceId={invoice.id} />}
      {steps && <StepList steps={steps} />}
      <div className="grid sm:grid-cols-2 gap-3">
        <StageCard invoice={invoice} stage="UNPAID" state={g.unpaid} canManage={canManage} onRun={run} />
        <StageCard invoice={invoice} stage="PAID" state={g.paid} canManage={canManage && g.lifecycle === 'PAID'} onRun={run} />
      </div>
      {canManage && g.lifecycle === 'ISSUED' && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <p className="text-xs text-emerald-900">Payment received? Confirm it here. Once the balance is zero the paid invoice (the same invoice with the PAID stamp) is created and e-mailed to the customer.</p>
          <button type="button" className={btn.green} onClick={() => setConfirming(true)}>
            <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Confirm Payment &amp; Send Paid Invoice
          </button>
        </div>
      )}
      {confirming && (
        <ConfirmPaymentDialog
          invoice={invoice}
          onClose={() => setConfirming(false)}
          onDone={r => {
            run(r);
          }}
        />
      )}
    </div>
  );
};

export { selectCls };

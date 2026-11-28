import React, { useEffect, useState } from 'react';
import { FileText, Loader2, Mail, MessageCircle, RefreshCw, Send } from 'lucide-react';
import type { RechargeDelivery, RechargeDeliveryChannel, RechargeInvoice, RechargeInvoicePlan, RechargeSendResult, SupportRecharge } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { ErrorBanner, Field, Pill, Spinner, btn, inputCls, selectCls, type Tone } from '../team-member/pipeline/shared';
import { rechargeDateTime, rechargeDay, rechargeMoney } from './rechargeParts';

const CHANNEL_LABEL: Record<RechargeDeliveryChannel, string> = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp' };
const DELIVERY_TONE: Record<RechargeDelivery['status'], Tone> = { SENDING: 'indigo', SENT: 'green', NOT_SENT: 'orange', FAILED: 'red' };
const DELIVERY_LABEL: Record<RechargeDelivery['status'], string> = { SENDING: 'Sending…', SENT: 'Sent', NOT_SENT: 'Not sent', FAILED: 'Failed' };
const TREATMENT_LABEL: Record<string, string> = { INTRA_STATE: 'Same state: CGST + SGST', INTER_STATE: 'Another state: IGST', NONE: 'No GST' };

/** Each channel's state: the latest send of the channel, and whether it ever went (a channel that went needs "send again" to go twice). */
const channelState = (inv: RechargeInvoice, ch: RechargeDeliveryChannel) => {
  const list = inv.deliveries.filter(d => d.channel === ch);
  return { latest: list[0] ?? null, sent: list.some(d => d.status === 'SENT'), history: list };
};

/** What Support see of an invoice: the number, the date, the total and how each channel went (never the customer's contact or the provider's answer). */
export const InvoiceSummary: React.FC<{ inv: RechargeInvoice }> = ({ inv }) => (
  <div className="space-y-2" data-testid="recharge-invoice-summary">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-bold text-slate-900">{inv.number}</span>
      <span className="text-slate-600">{rechargeDay(inv.invoiceDate)}</span>
      <span className="font-bold">{rechargeMoney(inv.totalAmount)}</span>
    </div>
    {inv.deliveries.length === 0 ? <p className="text-xs text-slate-500">Not sent to the customer yet.</p> : (
      <ul className="space-y-1">
        {inv.deliveries.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="recharge-delivery">
            <b className="text-slate-800">{CHANNEL_LABEL[d.channel]}</b><Pill tone={DELIVERY_TONE[d.status]}>{DELIVERY_LABEL[d.status]}{d.isResend ? ' (again)' : ''}</Pill>
            <span>{rechargeDateTime(d.requestedAt)}{d.requestedByName ? ` · ${d.requestedByName}` : ''}</span>
            {d.detail && <span className="break-words text-slate-500">· {d.detail}</span>}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** Accounts: the contact the invoice is sent to (an e-mail typed wrongly can be fixed after the invoice exists; the billing details on the invoice cannot). */
const ContactForm: React.FC<{ r: SupportRecharge; inv: RechargeInvoice; onDone: () => void }> = ({ r, inv, onDone }) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(inv.customerEmail ?? r.customerEmail ?? '');
  const [phone, setPhone] = useState(inv.customerPhone ?? r.customerPhone ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  if (!open) return <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>Update contact</button>;
  const save = async () => {
    setBusy(true); setProblem('');
    try { await rechargesApi.setContact(r.id, { note: note.trim(), customerEmail: email.trim() || null, customerPhone: phone.trim() || null }); setOpen(false); onDone(); }
    catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2" role="group" aria-label="Update the customer's contact" data-testid="recharge-contact">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Customer e-mail" htmlFor="rc-ct-mail"><input id="rc-ct-mail" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Customer mobile (WhatsApp)" htmlFor="rc-ct-phone"><input id="rc-ct-phone" className={inputCls} value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="What was corrected, and why" htmlFor="rc-ct-note" required><input id="rc-ct-note" className={inputCls} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
      </div>
      {problem && <ErrorBanner message={problem} />}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Save contact</button>
      </div>
    </div>
  );
};

/** Accounts: before the invoice exists, what it will hold (and what is missing) with the button that makes it. */
const GeneratePanel: React.FC<{ r: SupportRecharge; onDone: (message: string) => void }> = ({ r, onDone }) => {
  const [plan, setPlan] = useState<RechargeInvoicePlan | null>(null);
  const [hsn, setHsn] = useState('998313');
  const [treatment, setTreatment] = useState<'' | 'INTRA_STATE' | 'INTER_STATE'>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setError('');
    rechargesApi.invoicePlan(r.id, { hsnSac: hsn, taxTreatment: treatment || undefined }).then(p => { if (live) setPlan(p); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [r.id, hsn, treatment]);
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const out = await rechargesApi.generateInvoice(r.id, { hsnSac: hsn, ...(treatment ? { taxTreatment: treatment } : {}) });
      onDone(out.pdf.status === 'READY' ? `Invoice ${out.invoice.number} was generated.` : `Invoice ${out.invoice.number} was generated, but its PDF could not be made: ${out.pdf.message ?? ''} Retry the PDF.`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-3" role="group" aria-label="Generate the invoice" data-testid="recharge-generate">
      <div>
        <h3 className="text-xs font-bold text-slate-800">Invoice</h3>
        <p className="text-[11px] text-slate-600">The payment is confirmed. The invoice number is given by the system when you generate it; nothing is sent to the customer until you press Send.</p>
      </div>
      {!plan && !error && <Spinner label="Preparing the invoice…" />}
      {plan && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs" data-testid="recharge-plan">
          <div><dt className="text-slate-500">Invoice type</dt><dd className="font-semibold text-slate-800">{plan.invoiceType === 'GST' ? 'GST (tax invoice)' : 'Non-GST'}</dd></div>
          <div><dt className="text-slate-500">Particulars</dt><dd className="font-semibold text-slate-800 break-words">{plan.particulars}</dd></div>
          <div><dt className="text-slate-500">Taxable amount</dt><dd className="font-semibold text-slate-800">{rechargeMoney(plan.taxableAmount)}</dd></div>
          <div><dt className="text-slate-500">GST{plan.invoiceType === 'GST' ? ` (${plan.gstRate}%)` : ''}</dt><dd className="font-semibold text-slate-800">{rechargeMoney(plan.totalGst)}{plan.cgstAmount > 0 ? ` · CGST ${rechargeMoney(plan.cgstAmount)} + SGST ${rechargeMoney(plan.sgstAmount)}` : plan.igstAmount > 0 ? ` · IGST ${rechargeMoney(plan.igstAmount)}` : ''}</dd></div>
          <div><dt className="text-slate-500">Total</dt><dd className="font-extrabold text-slate-900">{rechargeMoney(plan.totalAmount)}</dd></div>
          <div><dt className="text-slate-500">Tax treatment</dt><dd className="font-semibold text-slate-800">{TREATMENT_LABEL[plan.taxTreatment]}</dd></div>
        </dl>
      )}
      {r.billingType === 'GST' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="HSN / SAC code" htmlFor="rc-g-hsn"><input id="rc-g-hsn" className={inputCls} value={hsn} maxLength={8} inputMode="numeric" onChange={e => setHsn(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Tax treatment" htmlFor="rc-g-tax">
            <select id="rc-g-tax" className={`${selectCls} w-full`} value={treatment} onChange={e => setTreatment(e.target.value as typeof treatment)}>
              <option value="">From the customer&apos;s GST number</option><option value="INTRA_STATE">Same state (CGST + SGST)</option><option value="INTER_STATE">Another state (IGST)</option>
            </select>
          </Field>
        </div>
      )}
      {plan && plan.missing.length > 0 && <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2" data-testid="recharge-missing">The invoice needs {plan.missing.join(' and ')}. Use “Correct billing details” below, then generate it.</div>}
      {error && <ErrorBanner message={error} />}
      <button type="button" className={btn.primary} disabled={busy || !plan || plan.missing.length > 0} onClick={() => void generate()}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileText className="w-3.5 h-3.5" aria-hidden />} Generate invoice
      </button>
    </div>
  );
};

/** Accounts: the generated invoice. Review the PDF, then send it by e-mail and / or WhatsApp; nothing is sent by itself. */
const InvoiceControls: React.FC<{ r: SupportRecharge; inv: RechargeInvoice; onChanged: (message: string) => void }> = ({ r, inv, onChanged }) => {
  const mail = channelState(inv, 'EMAIL');
  const wa = channelState(inv, 'WHATSAPP');
  const [pick, setPick] = useState<Record<RechargeDeliveryChannel, boolean>>({ EMAIL: !mail.sent, WHATSAPP: !wa.sent });
  const [busy, setBusy] = useState<'send' | 'pdf' | 'view' | null>(null);
  const [problem, setProblem] = useState('');
  const [results, setResults] = useState<RechargeSendResult[]>([]);
  const channels = (['EMAIL', 'WHATSAPP'] as const).filter(c => pick[c]);
  const resend = channels.some(c => (c === 'EMAIL' ? mail.sent : wa.sent));
  const review = async () => {
    setBusy('view'); setProblem('');
    // opened before the answer arrives, so the browser does not take it for a pop-up
    const win = window.open('', '_blank');
    try {
      const { url } = await rechargesApi.invoiceFileUrl(r.id, 'view');
      if (win) { win.opener = null; win.location.href = url; } else window.location.assign(url);
    } catch (e) { win?.close(); setProblem(errorMessage(e)); } finally { setBusy(null); }
  };
  const retryPdf = async () => {
    setBusy('pdf'); setProblem('');
    try { const out = await rechargesApi.retryInvoicePdf(r.id); onChanged(out.pdf.status === 'READY' ? 'The invoice PDF is ready.' : `The PDF could not be made: ${out.pdf.message ?? ''}`); }
    catch (e) { setProblem(errorMessage(e)); } finally { setBusy(null); }
  };
  const send = async () => {
    setBusy('send'); setProblem(''); setResults([]);
    try {
      const out = await rechargesApi.sendInvoice(r.id, channels, resend);
      setResults(out.results);
      // a channel that went is not ticked again: a second press must be a deliberate choice
      setPick(p => ({ ...p, ...Object.fromEntries(out.results.filter(x => x.status === 'SENT').map(x => [x.channel, false])) }));
      onChanged('');
    }
    catch (e) { setProblem(errorMessage(e)); } finally { setBusy(null); }
  };
  const row = (ch: RechargeDeliveryChannel, st: ReturnType<typeof channelState>, to: string | null | undefined, Icon: React.ElementType) => (
    <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs cursor-pointer" data-testid={`channel-${ch}`}>
      <input type="checkbox" className="mt-0.5" checked={pick[ch]} onChange={e => setPick(p => ({ ...p, [ch]: e.target.checked }))} aria-label={`Send by ${CHANNEL_LABEL[ch]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><Icon className="w-3.5 h-3.5 text-slate-500" aria-hidden /><b className="text-slate-800">{CHANNEL_LABEL[ch]}</b>
          {st.latest ? <Pill tone={DELIVERY_TONE[st.latest.status]}>{DELIVERY_LABEL[st.latest.status]}</Pill> : <span className="text-slate-500">not sent yet</span>}
          {st.sent && <span className="text-amber-700">will be sent again</span>}</span>
        <span className="block text-slate-500 break-words">{to || <span className="text-rose-700">no {ch === 'EMAIL' ? 'e-mail address' : 'mobile number'} on record: use Update contact</span>}</span>
        {st.latest?.detail && st.latest.status !== 'SENT' && <span className="block text-slate-600 break-words">{st.latest.detail}</span>}
      </span>
    </label>
  );
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3" role="group" aria-label="The invoice" data-testid="recharge-invoice-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h3 className="text-xs font-bold text-slate-800">Invoice {inv.number}</h3><p className="text-[11px] text-slate-500">{rechargeDay(inv.invoiceDate)} · {rechargeMoney(inv.totalAmount)} · {inv.taxTreatment ? TREATMENT_LABEL[inv.taxTreatment] : ''}</p></div>
        <div className="flex flex-wrap gap-2">
          {inv.pdfStatus === 'READY'
            ? <button type="button" className={btn.secondary} onClick={() => void review()} disabled={busy !== null}>{busy === 'view' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileText className="w-3.5 h-3.5" aria-hidden />} Review invoice (PDF)</button>
            : <button type="button" className={btn.secondary} onClick={() => void retryPdf()} disabled={busy !== null}>{busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />} Retry the PDF</button>}
        </div>
      </div>
      {inv.pdfStatus !== 'READY' && <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2" data-testid="recharge-pdf-problem">The invoice PDF is not ready{inv.pdfError ? `: ${inv.pdfError}` : ''}. Retry it before sending.</div>}
      {inv.pdfStatus === 'READY' && (
        <>
          <div className="space-y-2">{row('EMAIL', mail, inv.customerEmail, Mail)}{row('WHATSAPP', wa, inv.customerPhone, MessageCircle)}</div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button type="button" className={btn.primary} onClick={() => void send()} disabled={busy !== null || channels.length === 0} data-testid="recharge-send">
              {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Send className="w-3.5 h-3.5" aria-hidden />} {resend ? 'Send again' : 'Send invoice'}
            </button>
            <span className="text-[11px] text-slate-500">Nothing is sent until you press this. {resend ? 'A channel that already went is sent once more on purpose.' : ''}</span>
          </div>
        </>
      )}
      {results.length > 0 && (
        <ul className="space-y-1" role="status" data-testid="recharge-send-results">
          {results.map(x => <li key={x.channel} className={`text-xs rounded-lg px-3 py-2 break-words ${x.status === 'SENT' ? 'bg-emerald-50 text-emerald-800' : x.status === 'FAILED' || x.status === 'REFUSED' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}><b>{CHANNEL_LABEL[x.channel]}:</b> {x.status === 'SENT' ? 'sent. ' : x.status === 'NOT_SENT' ? 'not sent. ' : x.status === 'FAILED' ? 'failed. ' : 'not done. '}{x.message}</li>)}
        </ul>
      )}
      {problem && <ErrorBanner message={problem} />}
      <ContactForm r={r} inv={inv} onDone={() => onChanged('The contact was updated.')} />
      <InvoiceSummary inv={{ ...inv, deliveries: inv.deliveries }} />
    </div>
  );
};

/** The invoice section of a recharge: Accounts generate, review and send it; Support see its number and how it went. */
export const RechargeInvoicePanel: React.FC<{ r: SupportRecharge; onChanged: (message: string) => void }> = ({ r, onChanged }) => {
  if (r.isAccounts) {
    if (r.invoice) return <InvoiceControls r={r} inv={r.invoice} onChanged={onChanged} />;
    if (r.paymentStatus === 'PAYMENT_RECEIVED') return <GeneratePanel r={r} onDone={onChanged} />;
    return <p className="text-xs text-slate-500" data-testid="recharge-no-invoice">An invoice can be generated once the payment is confirmed as received.</p>;
  }
  if (r.invoice) return <div><h3 className="text-xs font-bold text-slate-700 mb-2">Invoice</h3><InvoiceSummary inv={r.invoice} /></div>;
  return <p className="text-xs text-slate-500" data-testid="recharge-no-invoice">{r.paymentStatus === 'PAYMENT_RECEIVED' ? 'Accounts will generate the invoice.' : 'The invoice is made by Accounts after they confirm the payment.'}</p>;
};

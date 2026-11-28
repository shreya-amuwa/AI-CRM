import React, { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Pencil, XCircle } from 'lucide-react';
import type { RechargeBillingType, RechargeVerifyDecision, SupportRecharge } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { Dialog, ErrorBanner, Field, Spinner, btn, inputCls, selectCls } from '../team-member/pipeline/shared';
import { RechargeInvoicePanel } from './RechargeInvoicePanel';
import { BILLING_LABEL, EVENT_LABEL, InvoicePill, KIND_LABEL, PaymentPill, amountNumber, cleanAmount, rechargeDateTime, rechargeDay, rechargeMoney } from './rechargeParts';

/** The payment screenshot, fetched through a short-lived link only when somebody asks for it (never stored in the page). */
const ScreenshotView: React.FC<{ fileId: string; name: string; mime: string }> = ({ fileId, name, mime }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setUrl(''); setError('');
    rechargesApi.fileUrl(fileId, 'view').then(r => { if (live) setUrl(r.url); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [fileId]);
  if (error) return <ErrorBanner message={error} />;
  if (!url) return <Spinner label="Opening the screenshot…" />;
  if (mime === 'application/pdf') {
    return <a className={btn.secondary} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" aria-hidden /> Open {name} (PDF)</a>;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex justify-center" data-testid="recharge-shot">
      <img src={url} alt={`Payment screenshot ${name}`} className="max-w-full max-h-[55dvh] object-contain rounded-lg" referrerPolicy="no-referrer" />
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0"><dt className="text-[11px] font-medium text-slate-500">{label}</dt><dd className="text-sm text-slate-800 break-words">{children}</dd></div>
);

/** Accounts: confirm that the money arrived (or did not), or reject the recharge. The screenshot proves nothing by itself. */
const VerifyPanel: React.FC<{ r: SupportRecharge; onDone: (r: SupportRecharge) => void }> = ({ r, onDone }) => {
  const [note, setNote] = useState('');
  const [received, setReceived] = useState(String(r.totalAmount));
  const [busy, setBusy] = useState<RechargeVerifyDecision | null>(null);
  const [problem, setProblem] = useState('');
  const go = async (d: RechargeVerifyDecision) => {
    setProblem('');
    if (d !== 'RECEIVED' && note.trim().length < 3) { setProblem('Say why (a short note is required).'); return; }
    setBusy(d);
    try {
      onDone(await rechargesApi.verify(r.id, d, note.trim() || undefined, d === 'RECEIVED' && received !== '' ? amountNumber(received) : undefined));
      setNote('');
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(null); }
  };
  const can = (d: RechargeVerifyDecision) => r.verifyActions.includes(d);
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-3" role="group" aria-label="Verify the payment" data-testid="recharge-verify">
      <div>
        <h3 className="text-xs font-bold text-slate-800">Verify the payment</h3>
        <p className="text-[11px] text-slate-600">Check your bank / gateway for this payment. The screenshot is only the proof Support submitted; it is not confirmation.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-2">
        {can('RECEIVED') && (
          <Field label="Amount received (₹)" htmlFor="rv-received">
            <input id="rv-received" className={inputCls} inputMode="decimal" value={received} onChange={e => setReceived(cleanAmount(e.target.value))} />
          </Field>
        )}
        <Field label="Verification note" htmlFor="rv-note">
          <input id="rv-note" className={inputCls} maxLength={500} placeholder="Required if not received or rejected" value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
      {problem && <ErrorBanner message={problem} />}
      <div className="flex flex-col sm:flex-row gap-2">
        {can('RECEIVED') && <button type="button" className={btn.green} disabled={busy !== null} onClick={() => void go('RECEIVED')}>{busy === 'RECEIVED' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />} Payment received</button>}
        {can('NOT_RECEIVED') && <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => void go('NOT_RECEIVED')}>{busy === 'NOT_RECEIVED' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Payment not received</button>}
        {can('REJECTED') && <button type="button" className={btn.danger} disabled={busy !== null} onClick={() => void go('REJECTED')}><XCircle className="w-3.5 h-3.5" aria-hidden /> Reject</button>}
      </div>
    </div>
  );
};

/** Accounts: correct the billing details (with the reason) until an invoice exists. The customer and the Relationship Manager cannot be changed. */
const CorrectPanel: React.FC<{ r: SupportRecharge; onDone: (r: SupportRecharge) => void }> = ({ r, onDone }) => {
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState<RechargeBillingType>(r.billingType);
  const [amount, setAmount] = useState(String(r.rechargeAmount));
  const [gst, setGst] = useState(String(r.gstAmount));
  const [gstin, setGstin] = useState(r.customerGstin ?? '');
  const [email, setEmail] = useState(r.customerEmail ?? '');
  const [phone, setPhone] = useState(r.customerPhone ?? '');
  const [address, setAddress] = useState(r.customerAddress ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    setProblem('');
    if (note.trim().length < 3) { setProblem('Say what was corrected and why.'); return; }
    setBusy(true);
    try {
      onDone(await rechargesApi.correct(r.id, {
        note: note.trim(), billingType: billing, rechargeAmount: amountNumber(amount), gstAmount: billing === 'GST' ? amountNumber(gst) : 0, gstNumber: billing === 'GST' ? gstin : null,
        customerEmail: email.trim() || null, customerPhone: phone.trim() || null, customerAddress: address.trim() || null
      }));
      setOpen(false); setNote('');
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" className={btn.secondary} onClick={() => setOpen(true)}><Pencil className="w-3.5 h-3.5" aria-hidden /> Correct billing details</button>;
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3" role="group" aria-label="Correct the billing details" data-testid="recharge-correct">
      <h3 className="text-xs font-bold text-slate-800">Correct the billing details</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Billing" htmlFor="rc-c-bill"><select id="rc-c-bill" className={`${selectCls} w-full`} value={billing} onChange={e => setBilling(e.target.value as RechargeBillingType)}><option value="GST">GST</option><option value="NON_GST">Non-GST</option></select></Field>
        <Field label="Amount before GST (₹)" htmlFor="rc-c-amt"><input id="rc-c-amt" className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(cleanAmount(e.target.value))} /></Field>
        {billing === 'GST' && <Field label="GST amount (₹)" htmlFor="rc-c-gst"><input id="rc-c-gst" className={inputCls} inputMode="decimal" value={gst} onChange={e => setGst(cleanAmount(e.target.value))} /></Field>}
        {billing === 'GST' && <Field label="Customer GST number" htmlFor="rc-c-gstin"><input id="rc-c-gstin" className={`${inputCls} uppercase`} value={gstin} maxLength={20} onChange={e => setGstin(e.target.value.toUpperCase())} /></Field>}
        <Field label="Customer e-mail" htmlFor="rc-c-mail"><input id="rc-c-mail" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Customer phone" htmlFor="rc-c-phone"><input id="rc-c-phone" className={inputCls} value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Billing address" htmlFor="rc-c-addr"><textarea id="rc-c-addr" className={inputCls} rows={2} maxLength={500} value={address} onChange={e => setAddress(e.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="What was corrected, and why" htmlFor="rc-c-note" required><input id="rc-c-note" className={inputCls} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
      </div>
      {problem && <ErrorBanner message={problem} />}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Save correction</button>
      </div>
    </div>
  );
};

/** One recharge in full: customer, Relationship Manager, billing, payment and invoice status, the screenshot, the timeline, and what the signed-in person may do. */
export const RechargeDetail: React.FC<{ id: string; onClose: () => void; onEdit: (r: SupportRecharge) => void; onChanged: () => void }> = ({ id, onClose, onEdit, onChanged }) => {
  const [r, setR] = useState<SupportRecharge | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = () => rechargesApi.get(id).then(setR).catch(e => setError(errorMessage(e)));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = (message: string) => { if (message) setNotice(message); onChanged(); void load(); };
  return (
    <Dialog title={r ? `${KIND_LABEL[r.kind]} · ${r.reference}` : 'Recharge'} description={r ? `${r.customerName} · ${rechargeDay(r.rechargeDate)}` : undefined} onClose={onClose} size="xl">
      {error && <ErrorBanner message={error} />}
      {!r && !error && <Spinner label="Loading the recharge…" />}
      {r && (
        <div className="space-y-4" data-testid="recharge-detail">
          {notice && <div role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2" data-testid="recharge-detail-notice">{notice}</div>}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Row label="Payment verification"><PaymentPill status={r.paymentStatus} /></Row>
            <Row label="Invoice"><InvoicePill status={r.invoiceStatus} /></Row>
            <Row label="Customer">{r.customerName}</Row>
            <Row label="Relationship Manager"><span data-testid="recharge-detail-rm">{r.rmName ?? 'Not recorded'}</span></Row>
            <Row label="Customer contact">{[r.customerPhone, r.customerEmail].filter(Boolean).join(' · ') || '-'}</Row>
            <Row label="Billing address">{r.customerAddress || '-'}</Row>
            <Row label="Billing">{BILLING_LABEL[r.billingType]}{r.billingType === 'GST' && r.customerGstin ? ` · GST no. ${r.customerGstin}` : ''}</Row>
            <Row label="Payment reference">{r.paymentReference || '-'}</Row>
            <Row label={r.billingType === 'GST' ? 'Recharge amount (before GST)' : 'Recharge amount'}>{rechargeMoney(r.rechargeAmount)}</Row>
            <Row label="GST amount">{rechargeMoney(r.gstAmount)}</Row>
            <Row label="Total"><b>{rechargeMoney(r.totalAmount)}</b></Row>
            <Row label="Submitted by">{r.createdByName ?? '-'}{r.teamName ? ` · ${r.teamName}` : ''} · {rechargeDateTime(r.submittedAt)}</Row>
            {r.remarks && <div className="sm:col-span-2"><Row label="Remarks"><span className="whitespace-pre-wrap">{r.remarks}</span></Row></div>}
            {r.paymentVerifiedAt && <div className="sm:col-span-2"><Row label="Accounts' decision">{r.paymentVerifiedByName ?? 'Accounts'} · {rechargeDateTime(r.paymentVerifiedAt)}{r.paymentNote ? ` · “${r.paymentNote}”` : ''}</Row></div>}
          </dl>
          <div>
            <h3 className="text-xs font-bold text-slate-700 mb-2">Payment screenshot</h3>
            {r.screenshot ? <ScreenshotView fileId={r.screenshot.id} name={r.screenshot.name} mime={r.screenshot.mime} /> : <p className="text-sm text-slate-500">No screenshot.</p>}
          </div>
          {r.verifyActions.length > 0 && <VerifyPanel r={r} onDone={n => changed(`Saved: ${n.paymentStatus === 'PAYMENT_RECEIVED' ? 'payment received' : n.paymentStatus === 'PAYMENT_NOT_RECEIVED' ? 'payment not received' : 'rejected'}.`)} />}
          {r.canCorrect && <CorrectPanel key={`${r.updatedAt}`} r={r} onDone={() => changed('The billing details were corrected.')} />}
          <RechargeInvoicePanel r={r} onChanged={m => changed(m)} />
          <div>
            <h3 className="text-xs font-bold text-slate-700 mb-2">Status timeline</h3>
            <ol className="space-y-2" data-testid="recharge-timeline">
              {(r.timeline ?? []).map((e, i) => (
                <li key={i} className="text-xs border-l-2 border-slate-200 pl-3">
                  <div className="font-semibold text-slate-800">{EVENT_LABEL[e.action] ?? e.action}</div>
                  <div className="text-slate-500">{e.actorName ?? 'Someone'} · {rechargeDateTime(e.at)}</div>
                  {e.note && <div className="text-slate-600 break-words">“{e.note}”</div>}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
            {r.canEdit && <button type="button" className={btn.primary} onClick={() => onEdit(r)}><Pencil className="w-3.5 h-3.5" aria-hidden /> Edit</button>}
          </div>
        </div>
      )}
    </Dialog>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Search, Upload, X } from 'lucide-react';
import type { RechargeBillingType, RechargeCustomer, RechargeKind, SupportRecharge } from '../../../shared/contracts';
import { RECHARGE_MAX_FILE_BYTES, rechargeBodySchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { looksLike } from '../../lib/checklistUpload';
import { uploadToTicket } from '../../lib/uploadToTicket';
import { Dialog, ErrorBanner, Field, btn, inputCls, useDebounced } from '../team-member/pipeline/shared';
import { BILLING_LABEL, KIND_LABEL, amountNumber, cleanAmount, rechargeMoney, sumAmounts, todayIndia } from './rechargeParts';

const PROOF_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const ACCEPT = Object.keys(PROOF_TYPES).map(e => `.${e}`).join(',');
const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12));

interface Shot { id: string; name: string; size: number }

/** Choose the customer: typed search over the customers this person may see. The Relationship Manager is shown, never chosen. */
const CustomerPicker: React.FC<{ value: RechargeCustomer | null; onPick: (c: RechargeCustomer | null) => void; error?: string }> = ({ value, onPick, error }) => {
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const [items, setItems] = useState<RechargeCustomer[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (value) return;
    let live = true;
    setItems(null); setProblem('');
    rechargesApi.customers(q).then(r => { if (live) setItems(r); }).catch(e => { if (live) setProblem(errorMessage(e)); });
    return () => { live = false; };
  }, [q, value]);
  if (value) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1" data-testid="recharge-customer">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><div className="text-sm font-bold text-slate-900 break-words">{value.company || value.name}</div>{value.company && <div className="text-xs text-slate-500">{value.name}</div>}</div>
          <button type="button" className={btn.secondary} onClick={() => onPick(null)}>Change</button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
          <div className="min-w-0"><dt className="text-slate-500">Email</dt><dd className="text-slate-800 break-words">{value.email || <span className="text-amber-700">Not on record (Accounts will complete it)</span>}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">Phone</dt><dd className="text-slate-800 break-words">{value.phone || '-'}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">Relationship Manager</dt><dd className="text-slate-800 font-semibold break-words" data-testid="recharge-rm">{value.rmName || 'None assigned'}</dd></div>
        </dl>
        {!value.rmId && <p className="text-xs text-rose-700">This customer has no Relationship Manager yet. Ask your Team Lead to assign one before recording a recharge.</p>}
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input id="rc-cust" className={`${inputCls} pl-8`} placeholder="Search the customer by name, company, email or phone" value={text} onChange={e => setText(e.target.value)} autoComplete="off" aria-invalid={!!error} />
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
      {problem && <p className="mt-1 text-[11px] text-rose-600" role="alert">{problem}</p>}
      <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100" aria-label="Customers" data-testid="recharge-customer-list">
        {items === null && !problem && <li className="px-3 py-2 text-xs text-slate-500">Loading customers…</li>}
        {items?.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No customer matches.</li>}
        {items?.map(c => (
          <li key={c.id}>
            <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 focus-visible:bg-indigo-50 outline-none" onClick={() => onPick(c)}>
              <span className="block text-sm font-semibold text-slate-900 break-words">{c.company || c.name}</span>
              <span className="block text-[11px] text-slate-500 break-words">{[c.name !== c.company ? c.name : null, c.phone, c.email].filter(Boolean).join(' · ')}{c.rmName ? ` · RM ${c.rmName}` : ' · no RM'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Create (existing absent) or edit (existing present) one recharge. The server checks everything again and reads the Relationship Manager from the customer. */
export const RechargeForm: React.FC<{ kind: RechargeKind; existing?: SupportRecharge; onClose: () => void; onSaved: (r: SupportRecharge) => void }> = ({ kind, existing, onClose, onSaved }) => {
  const [customer, setCustomer] = useState<RechargeCustomer | null>(null);
  const [billing, setBilling] = useState<RechargeBillingType>(existing?.billingType ?? 'NON_GST');
  const [rechargeDate, setRechargeDate] = useState(existing?.rechargeDate?.slice(0, 10) ?? todayIndia());
  const [amount, setAmount] = useState(existing ? String(existing.rechargeAmount) : '');
  const [gst, setGst] = useState(existing && existing.gstAmount > 0 ? String(existing.gstAmount) : '');
  const [gstin, setGstin] = useState(existing?.customerGstin ?? '');
  const [ref, setRef] = useState(existing?.paymentReference ?? '');
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [shot, setShot] = useState<Shot | null>(existing?.screenshot ? { id: existing.screenshot.id, name: existing.screenshot.name, size: existing.screenshot.size } : null);
  const [newShot, setNewShot] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestId = useRef(newRequestId());
  const pick = useRef<HTMLInputElement>(null);
  const gstAmount = billing === 'GST' ? gst : '';
  const total = sumAmounts(amount, gstAmount);

  const choose = (c: RechargeCustomer | null) => { setCustomer(c); if (c?.gstin && !gstin) setGstin(c.gstin); setErrors(e => ({ ...e, customerId: '' })); };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    setErrors(e => ({ ...e, screenshot: '' }));
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = PROOF_TYPES[ext];
    if (!mime) { setErrors(e => ({ ...e, screenshot: 'The payment proof must be an image (PNG, JPEG or WebP) or a PDF.' })); return; }
    if (file.size === 0) { setErrors(e => ({ ...e, screenshot: 'This file is empty.' })); return; }
    if (file.size > RECHARGE_MAX_FILE_BYTES) { setErrors(e => ({ ...e, screenshot: 'The file is larger than 5 MB.' })); return; }
    setUploading(true);
    let id: string | null = null;
    try {
      if (!(await looksLike(file, mime))) throw new Error(`${file.name} is not a real ${ext.toUpperCase()} file.`);
      const ticket = await rechargesApi.beginUpload({ fileName: file.name, mimeType: mime, sizeBytes: file.size });
      id = ticket.attachment.id;
      await uploadToTicket(ticket, file, mime);
      const done = await rechargesApi.completeUpload(id);
      id = null;
      setShot({ id: done.id, name: done.name, size: done.size });
      setNewShot(true);
    } catch (e) {
      setErrors(x => ({ ...x, screenshot: errorMessage(e) }));
      if (id) void rechargesApi.abortUpload(id).catch(() => undefined);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploading) return;
    setProblem('');
    const body = {
      rechargeDate, billingType: billing, rechargeAmount: amountNumber(amount), gstAmount: amountNumber(gstAmount), gstNumber: billing === 'GST' ? gstin : null, totalAmount: total,
      paymentReference: ref, remarks, screenshotId: existing && !newShot ? existing.screenshot?.id ?? null : shot?.id ?? null
    };
    const parsed = rechargeBodySchema.safeParse(body);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) { const k = i.path[0] === 'screenshotId' ? 'screenshot' : String(i.path[0] ?? 'form'); next[k] = next[k] ?? i.message; }
    if (!existing && !customer) next.customerId = 'Choose the customer.';
    if (!existing && customer && !customer.rmId) next.customerId = 'This customer has no Relationship Manager yet.';
    if (billing === 'GST' && !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(gstin.replace(/\s+/g, '').toUpperCase())) next.gstNumber = "Enter the customer's valid 15-character GST number.";
    if (!shot) next.screenshot = 'Upload the screenshot of the payment.';
    if (rechargeDate > todayIndia()) next.rechargeDate = 'The recharge date cannot be in the future.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    setSaving(true);
    try {
      const saved = existing
        ? await rechargesApi.update(existing.id, { ...parsed.data, screenshotId: newShot ? shot?.id : undefined })
        : await rechargesApi.create(kind, customer!.id, parsed.data, requestId.current);
      onSaved(saved);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const err = (k: string) => errors[k] || undefined;
  return (
    <Dialog title={existing ? `Edit ${KIND_LABEL[kind]} · ${existing.reference}` : `New ${KIND_LABEL[kind]}`} onClose={onClose} size="xl" persistent>
      <form onSubmit={e => void submit(e)} className="space-y-4" noValidate data-testid="recharge-form">
        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1">Customer<span aria-hidden="true"> *</span></span>
          {existing ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-0.5" data-testid="recharge-customer">
              <div className="text-sm font-bold text-slate-900 break-words">{existing.customerName}</div>
              <div className="text-slate-600 break-words">{[existing.customerPhone, existing.customerEmail].filter(Boolean).join(' · ') || '-'}</div>
              <div className="text-slate-600">Relationship Manager: <b data-testid="recharge-rm">{existing.rmName ?? 'Not recorded'}</b></div>
            </div>
          ) : <CustomerPicker value={customer} onPick={choose} error={err('customerId')} />}
        </div>

        <fieldset className="space-y-2">
          <legend className="block text-xs font-medium text-slate-600 mb-1">Billing<span aria-hidden="true"> *</span></legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="GST or Non-GST">
            {(['GST', 'NON_GST'] as const).map(t => (
              <label key={t} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold cursor-pointer ${billing === t ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-700'}`}>
                <input type="radio" name="rc-billing" value={t} checked={billing === t} onChange={() => setBilling(t)} className="sr-only" />
                {BILLING_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Recharge date" htmlFor="rc-date" required error={err('rechargeDate')}>
            <input id="rc-date" type="date" className={inputCls} value={rechargeDate} max={todayIndia()} onChange={e => setRechargeDate(e.target.value)} aria-invalid={!!err('rechargeDate')} />
          </Field>
          <Field label={billing === 'GST' ? 'Recharge amount before GST (₹)' : 'Recharge amount (₹)'} htmlFor="rc-amount" required error={err('rechargeAmount')}>
            <input id="rc-amount" className={inputCls} inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(cleanAmount(e.target.value))} aria-invalid={!!err('rechargeAmount')} />
          </Field>
          {billing === 'GST' && (
            <>
              <Field label="GST amount (₹)" htmlFor="rc-gst" required error={err('gstAmount')}>
                <input id="rc-gst" className={inputCls} inputMode="decimal" placeholder="0.00" value={gst} onChange={e => setGst(cleanAmount(e.target.value))} aria-invalid={!!err('gstAmount')} />
              </Field>
              <Field label="Customer GST number" htmlFor="rc-gstin" required error={err('gstNumber')}>
                <input id="rc-gstin" className={`${inputCls} uppercase`} value={gstin} maxLength={20} placeholder="15-character GSTIN" autoComplete="off" onChange={e => setGstin(e.target.value.toUpperCase())} aria-invalid={!!err('gstNumber')} />
              </Field>
            </>
          )}
          <Field label="Payment reference / transaction ID" htmlFor="rc-ref" error={err('paymentReference')}>
            <input id="rc-ref" className={inputCls} value={ref} maxLength={100} placeholder="UTR / UPI reference (if available)" autoComplete="off" onChange={e => setRef(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2" data-testid="recharge-total">
          <span className="text-xs font-medium text-slate-600">Total ({billing === 'GST' ? 'amount + GST' : 'no GST'})</span>
          <span className="text-sm font-extrabold text-slate-900">{rechargeMoney(total)}</span>
        </div>
        {errors.totalAmount && <p className="text-[11px] text-rose-600">{errors.totalAmount}</p>}

        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1">Screenshot of the payment<span aria-hidden="true"> *</span></span>
          <input ref={pick} type="file" accept={ACCEPT} hidden data-testid="recharge-file" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn.secondary} onClick={() => pick.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Upload className="w-3.5 h-3.5" aria-hidden />}
              {shot ? 'Replace screenshot' : 'Upload screenshot'}
            </button>
            {shot && (
              <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700">
                <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden /><span className="truncate" title={shot.name}>{shot.name}</span>
                {!existing && <button type="button" onClick={() => setShot(null)} aria-label={`Remove ${shot.name}`}><X className="w-3 h-3" /></button>}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">PNG, JPEG, WebP or PDF, up to 5 MB. It is only proof for Accounts, who check the payment themselves. Stored privately.</p>
          {errors.screenshot && <p className="mt-1 text-[11px] text-rose-600" role="alert">{errors.screenshot}</p>}
        </div>

        <Field label="Remarks / notes" htmlFor="rc-rem" error={err('remarks')}>
          <textarea id="rc-rem" className={inputCls} rows={3} maxLength={1000} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field>
        {existing && (existing.paymentStatus === 'REJECTED' || existing.paymentStatus === 'PAYMENT_NOT_RECEIVED') && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Saving the corrected recharge submits it to Accounts again.</p>}
        {problem && <ErrorBanner message={problem} />}
        {/* the buttons stay in view while a long form scrolls */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 px-4 sm:px-5 py-3 bg-white border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2" data-testid="recharge-form-actions">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={saving || uploading}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            {existing ? 'Save changes' : 'Submit to Accounts'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

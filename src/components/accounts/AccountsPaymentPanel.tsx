import { AccountsCustomerInvoices } from '../invoices/AccountsCustomerInvoices';
import { StepList } from '../invoices/GeneratedInvoicePanel';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FilePlus2, Plus } from 'lucide-react';
import type { FollowUpOutcome, LedgerPayment, PaymentInvoiceBilling, PaymentInvoiceOutcome, PaymentOverview, PaymentType } from '../../../shared/contracts';
import { GST_STATES, inferStateFromAddress, isValidGstinFormat, normalizeGstin } from '../../../shared/gst';
import { FOLLOWUP_OUTCOMES, PAYMENT_METHODS } from '../../../shared/contracts';
import { accountsRecordPaymentSchema, accountsUpdatePaymentSchema, paymentFollowUpSchema } from '../../../shared/validation';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { generatedInvoicesApi, pipelineApi, type AccountsPaymentInput } from '../../lib/api/endpoints';
import { ErrorBanner, FormField, inputClass, Loading, Modal } from '../support-member/SupportParts';
import { Badge, fmtDateTime, METHOD_LABEL, MoneyTiles, PaymentHistory, PaymentStatusBadge, rupees, rupeesExact, TYPE_LABEL } from '../payments/PaymentBits';

const primaryBtn = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50';
const ghostBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50';
const greenBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50';
const dangerBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-[11px] font-semibold hover:bg-rose-50 disabled:opacity-50';

/** datetime-local value ⇄ ISO with the user's offset. */
const nowLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const OUTCOME_LABEL: Record<FollowUpOutcome, string> = {
  CONTACTED: 'Contacted the customer',
  AWAITING_PAYMENT: 'Awaiting payment',
  NO_RESPONSE: 'No response',
  OTHER: 'Other'
};

// ---------------------------------------------------------------------------
// Record / edit a payment
// ---------------------------------------------------------------------------
const PaymentFormDialog: React.FC<{
  customerId: string;
  overview: PaymentOverview;
  editing: LedgerPayment | null;
  onClose: () => void;
  onSaved: (o: PaymentOverview) => void;
}> = ({ customerId, overview, editing, onClose, onSaved }) => {
  // What is still to be received: the total payable (GST included) minus the money already on record (verified + pending), excluding the payment being edited.
  const payable = overview.dealAmount ?? 0;
  const open = Math.max(payable - (overview.recorded - (editing && editing.status === 'PENDING' ? editing.amount : 0)), 0);
  const gst = overview.order && overview.order.gstSelected && overview.order.gstRate != null ? overview.order : null;
  const [type, setType] = useState<PaymentType>(editing?.type ?? 'PART');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [method, setMethod] = useState<string>(editing?.method ?? 'UPI');
  const [reference, setReference] = useState(editing?.reference ?? '');
  const [paidAt, setPaidAt] = useState(editing ? toLocalInput(editing.paidAt) : nowLocal());
  const [note, setNote] = useState(editing?.note ?? '');
  const [verify, setVerify] = useState(false);
  const [invoice, setInvoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // A full payment is always the whole outstanding amount, GST included: it is filled in and cannot be typed over.
  const full = type === 'FULL';
  const shownAmount = full ? String(open) : amount;
  const pickType = (t: PaymentType) => {
    setType(t);
    setFieldErrors(f => ({ ...f, amount: '' }));
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: AccountsPaymentInput = { type, amount: Number(shownAmount), method: method as AccountsPaymentInput['method'], reference: reference.trim() || null, paidAt: fromLocalInput(paidAt), note: note.trim() || null };
    const parsed = editing ? accountsUpdatePaymentSchema.safeParse(body) : accountsRecordPaymentSchema.safeParse({ ...body, verify, invoice });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? '')] ||= i.message;
      setFieldErrors(next);
      return setError('Please fix the highlighted fields.');
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = editing
        ? await pipelineApi.updateAccountsPayment(customerId, editing.id, body)
        : await pipelineApi.recordAccountsPayment(customerId, { ...body, verify, invoice });
      onSaved(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit payment' : 'Record payment'} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <dl className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-700 grid grid-cols-2 gap-y-1" aria-label="Amounts">
          {gst && (
            <>
              <dt>Agreed amount (before GST)</dt>
              <dd className="text-right" data-testid="pay-agreed">{rupees(overview.agreedAmount)}</dd>
              <dt>GST ({gst.gstRate}%)</dt>
              <dd className="text-right">{rupeesExact(gst.gstTotal)}</dd>
              {!!gst.roundOff && (
                <>
                  <dt>Rounded to whole rupees</dt>
                  <dd className="text-right">{rupeesExact(gst.roundOff)}</dd>
                </>
              )}
            </>
          )}
          <dt>Total payable{gst ? ' (including GST)' : ''}</dt>
          <dd className="text-right font-semibold" data-testid="pay-payable">{rupees(payable)}</dd>
          <dt className="font-bold text-slate-900">Still to receive</dt>
          <dd className="text-right font-bold text-slate-900" data-testid="pay-open">{rupees(open)}</dd>
        </dl>
        <fieldset>
          <legend className="block text-xs font-semibold text-slate-700 mb-1">Payment type</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['PART', 'FULL'] as const).map(t => (
              <label key={t} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer ${type === t ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>
                <input type="radio" name="payment-type" className="accent-blue-600" checked={type === t} onChange={() => pickType(t)} />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          {fieldErrors.type && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.type}</p>}
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Amount received (₹)" htmlFor="pay-amount" required error={fieldErrors.amount} hint={full ? 'A full payment is the whole outstanding amount, GST included.' : `Whole rupees, GST included. At most ${rupees(open)}; less than that for a part payment.`}>
            <input
              id="pay-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className={`${inputClass} ${full ? '!bg-slate-100 text-slate-700' : ''}`}
              value={shownAmount}
              readOnly={full}
              onChange={e => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Payment method" htmlFor="pay-method" required error={fieldErrors.method}>
            <select id="pay-method" className={inputClass} value={method} onChange={e => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Transaction / reference no." htmlFor="pay-ref" error={fieldErrors.reference} hint={['CASH', 'OTHER'].includes(method) ? 'Optional for cash.' : 'Required for this method.'}>
            <input id="pay-ref" className={inputClass} value={reference} maxLength={120} onChange={e => setReference(e.target.value)} />
          </FormField>
          <FormField label="Payment date & time" htmlFor="pay-date" error={fieldErrors.paidAt}>
            <input id="pay-date" type="datetime-local" className={inputClass} value={paidAt} max={nowLocal()} onChange={e => setPaidAt(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Note (optional)" htmlFor="pay-note" error={fieldErrors.note}>
          <textarea id="pay-note" rows={2} maxLength={1000} className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Seen in the HDFC account" />
        </FormField>
        {!editing && (
          <label className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5 accent-emerald-600" checked={verify} onChange={e => setVerify(e.target.checked)} />
            <span>
              <strong className="text-slate-900">I have received this money and verified it.</strong>
              <span className="block text-[11px] text-slate-500">Leave unticked to record it as pending; only a verified payment counts as received.</span>
            </span>
          </label>
        )}
        {!editing && verify && (
          <label className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5 accent-emerald-600" checked={invoice} onChange={e => setInvoice(e.target.checked)} />
            <span>
              <strong className="text-slate-900">Make the paid invoice for this payment.</strong>
              <span className="block text-[11px] text-slate-500">One invoice for exactly this payment, with the order&apos;s GST. It is stored as a PDF and sent to the customer by e-mail and WhatsApp.</span>
            </span>
          </label>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : verify ? 'Record & verify' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// The GST of the order: chosen once by Accounts, saved in the database
// ---------------------------------------------------------------------------
const OrderGstCard: React.FC<{ customerId: string; overview: PaymentOverview; readOnly: boolean; onSaved: (o: PaymentOverview) => void }> = ({ customerId, overview, readOnly, onSaved }) => {
  const g = overview.orderGst;
  const order = overview.order;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!g?.applies || !order) return null;
  const choose = async (value: string) => {
    if (value === '') return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await pipelineApi.setOrderGst(customerId, Number(value)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const disabled = readOnly || busy || !!g.locked;
  const value = g.rate != null ? String(g.rate) : '';
  return (
    <section aria-labelledby="order-gst-heading" className="rounded-xl border border-slate-200 p-4 space-y-3" data-testid="order-gst">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="order-gst-heading" className="text-xs font-bold text-slate-800">
            GST for this order
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Sales agreed {rupees(g.agreedAmount)} before GST. Choose the GST rate that applies; the total payable is worked out from it.</p>
        </div>
        <label className="text-xs">
          <span className="block text-[11px] font-semibold text-slate-700 mb-1">GST rate</span>
          <select aria-label="GST rate" data-testid="order-gst-rate" className={`${inputClass} !py-1.5 !text-xs min-w-[11rem]`} value={value} disabled={disabled} onChange={e => void choose(e.target.value)}>
            {g.rate == null && <option value="">Choose the GST rate</option>}
            {(g.rates ?? []).map(r => (
              <option key={r.rate} value={String(r.rate)}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {order.gstSelected && order.gstRate != null ? (
        <dl className="grid grid-cols-2 gap-y-1 text-xs text-slate-700" aria-live="polite">
          <dt>Agreed amount (before GST)</dt>
          <dd className="text-right">{rupees(order.taxableTotal ?? g.agreedAmount)}</dd>
          <dt>GST ({order.gstRate}%)</dt>
          <dd className="text-right">{rupeesExact(order.gstTotal)}</dd>
          {!!order.roundOff && (
            <>
              <dt>Rounded to whole rupees</dt>
              <dd className="text-right">{rupeesExact(order.roundOff)}</dd>
            </>
          )}
          <dt className="font-bold text-slate-900">Total payable (including GST)</dt>
          <dd className="text-right font-bold text-slate-900" data-testid="order-gst-payable">{rupees(order.totalPayable)}</dd>
        </dl>
      ) : g.legacy ? (
        <p className="text-xs text-slate-600">GST on this older order is already recorded on its payments or invoices and is left as it is. Total payable {rupees(order.totalPayable)}.</p>
      ) : (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="order-gst-pending">
          Final payable amount not calculated yet. Choose the GST rate before recording a payment or making an invoice.
        </p>
      )}
      {g.locked && g.lockReason && <p className="text-[11px] text-slate-500">{g.lockReason}</p>}
      {g.setAt && g.rate != null && <p className="text-[11px] text-slate-500">Chosen {fmtDateTime(g.setAt)}{g.setBy ? ` by ${g.setBy}` : ''}.</p>}
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

// ---------------------------------------------------------------------------
// The billing details an invoice needs and the customer record lacks (asked once, with the click)
// ---------------------------------------------------------------------------
const BillingDetailsDialog: React.FC<{
  billing: PaymentInvoiceBilling;
  amount: number;
  onClose: () => void;
  onSubmit: (customer: Record<string, string | undefined>) => Promise<void>;
}> = ({ billing, amount, onClose, onSubmit }) => {
  const c = billing.customer;
  const [businessName, setBusinessName] = useState(c.businessName || c.name || '');
  const [address, setAddress] = useState(c.address || '');
  const [stateCode, setStateCode] = useState(c.stateCode || '');
  const [gstin, setGstin] = useState(c.gstin || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onAddressBlur = () => {
    if (stateCode) return;
    const st = inferStateFromAddress(address);
    if (st) setStateCode(st.code);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!address.trim()) next.address = 'Enter the business address.';
    if (!stateCode) next.state = 'Choose the customer\'s state.';
    if (gstin.trim() && !isValidGstinFormat(gstin)) next.gstin = 'The GSTIN is not valid. Check it against the customer\'s GST certificate.';
    setFieldErrors(next);
    if (Object.keys(next).length) return setError('Please fix the highlighted fields.');
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ businessName: businessName.trim() || undefined, address: address.trim(), stateCode, gstin: gstin.trim() ? normalizeGstin(gstin) : undefined });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Billing details for the invoice" onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-xs text-slate-600">
          The invoice for this {rupees(amount)} payment needs the customer&apos;s billing {billing.missing.join(' and ')}, which the customer record does not have yet. Enter it once: it goes on this invoice and the customer&apos;s next invoices use it. The customer record itself is not changed.
        </p>
        <FormField label="Business name" htmlFor="bill-name">
          <input id="bill-name" className={inputClass} value={businessName} maxLength={200} onChange={e => setBusinessName(e.target.value)} />
        </FormField>
        <FormField label="Business address" htmlFor="bill-address" required error={fieldErrors.address}>
          <textarea id="bill-address" rows={3} className={inputClass} value={address} maxLength={500} onChange={e => setAddress(e.target.value)} onBlur={onAddressBlur} placeholder="Shop, street, city, PIN code" />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="State" htmlFor="bill-state" required error={fieldErrors.state} hint="Decides CGST + SGST or IGST.">
            <select id="bill-state" className={inputClass} value={stateCode} onChange={e => setStateCode(e.target.value)}>
              <option value="">Choose the state</option>
              {GST_STATES.map(st => (
                <option key={st.code} value={st.code}>
                  {st.name} ({st.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="GSTIN (if the customer has one)" htmlFor="bill-gstin" error={fieldErrors.gstin}>
            <input id="bill-gstin" className={inputClass} value={gstin} maxLength={20} onChange={e => setGstin(e.target.value.toUpperCase())} />
          </FormField>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? 'Making the invoice…' : 'Make the invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const ReasonDialog: React.FC<{
  title: string;
  label: string;
  action: string;
  danger?: boolean;
  /** Default true. When false the text may be left empty. */
  required?: boolean;
  description?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}> = ({ title, label, action, danger, required = true, description, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (required && !reason.trim()) return setError('Give the reason.');
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {description && <p className="text-xs text-slate-500">{description}</p>}
        <FormField label={label} htmlFor="reason-text" required={required}>
          <textarea id="reason-text" rows={3} maxLength={500} className={inputClass} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
        </FormField>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={danger ? 'inline-flex items-center px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50' : primaryBtn} disabled={busy}>
            {busy ? 'Saving…' : action}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------
/**
 * One customer's money for Accounts: totals, every payment with verify / reject /
 * edit / reverse, "Record payment", the responsible accountant and the dated
 * follow-up notes. Every action is checked again by the database (Accounts only).
 */
export const AccountsPaymentPanel: React.FC<{
  customerId: string;
  /** Show the accountant and follow-up notes (balance follow-up screens). */
  followUps?: boolean;
  /** Called after any change so the list behind the pop-up can refresh. */
  onChanged?: (o: PaymentOverview) => void;
  /** Lets the parent read the latest overview (e.g. to enable "Confirm & return"). */
  onLoaded?: (o: PaymentOverview) => void;
  /** History only: no recording, verifying or editing (e.g. a lead Accounts already returned). */
  readOnly?: boolean;
  /** Shown in the Upload Invoice PDF dialog. */
  customerLabel?: string;
}> = ({ customerId, followUps = false, onChanged, onLoaded, readOnly = false, customerLabel = 'This customer' }) => {
  const { profile } = useAuth();
  const isManager = profile?.role === 'SUPER_ADMIN' || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'TEAM_HEAD';
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoiceOutcome, setInvoiceOutcome] = useState<PaymentInvoiceOutcome | null>(null);
  const [invoicesKey, setInvoicesKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: LedgerPayment | null } | null>(null);
  const [reject, setReject] = useState<LedgerPayment | null>(null);
  const [reverse, setReverse] = useState<LedgerPayment | null>(null);
  const [team, setTeam] = useState<{ id: string; fullName: string; role: string }[]>([]);
  const [billing, setBilling] = useState<{ paymentId: string; data: PaymentInvoiceBilling } | null>(null);

  // The parent passes new callbacks on every render. If `apply` (and so `load`) changed with them, the panel would reload itself after every
  // render of the parent in an endless loop, and every reload clears the message on screen (an error flashed and was gone). The latest
  // callbacks are kept in refs, so `apply` and `load` stay the same function and the panel loads once per customer.
  const onChangedRef = useRef(onChanged);
  const onLoadedRef = useRef(onLoaded);
  onChangedRef.current = onChanged;
  onLoadedRef.current = onLoaded;
  const apply = useCallback((o: PaymentOverview, changed = true) => {
    setOverview(o);
    onLoadedRef.current?.(o);
    if (changed) {
      onChangedRef.current?.(o);
      // verified / reversed payments change the finance totals
      window.dispatchEvent(new CustomEvent('crm:pipeline-changed'));
    }
  }, []);

  const load = useCallback(() => {
    setError(null);
    pipelineApi.paymentOverview(customerId).then(o => apply(o, false), e => setError(errorMessage(e)));
  }, [customerId, apply]);
  useEffect(load, [load]);
  useEffect(() => {
    if (followUps) pipelineApi.accountsTeam().then(setTeam, () => setTeam([]));
  }, [followUps]);

  /** The answer to "record" / "verify" carries what happened to the payment's paid invoice: say it, and refresh the invoice list. */
  const showInvoice = (o: PaymentOverview) => {
    setInvoiceOutcome(o.paymentInvoice ?? null);
    if (o.paymentInvoice) setInvoicesKey(n => n + 1);
  };

  const run = async (key: string, fn: () => Promise<PaymentOverview>, done: string) => {
    setBusyId(key);
    setError(null);
    setNotice(null);
    setInvoiceOutcome(null);
    try {
      const next = await fn();
      apply(next);
      showInvoice(next);
      setNotice(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  /** Makes the paid invoice of a verified payment (billing details typed by Accounts when the record lacks them) and shows the result. */
  const makeInvoice = async (paymentId: string, customer?: Record<string, string | undefined>) => {
    const outcome = await generatedInvoicesApi.invoiceForPayment(paymentId, customer ? { customer } : {});
    setInvoiceOutcome(outcome);
    setInvoicesKey(n => n + 1);
    apply(await pipelineApi.paymentOverview(customerId));
    setNotice(outcome.status === 'EXISTS' ? `The paid invoice ${outcome.number} was already made for this payment.` : `Paid invoice ${outcome.number} made for this payment.`);
  };

  /** "Generate invoice" on a verified payment: also the retry when the automatic one could not be made. Asks for the billing details only when the customer record lacks them. */
  const generateInvoice = async (paymentId: string) => {
    setBusyId(paymentId);
    setError(null);
    setNotice(null);
    setInvoiceOutcome(null);
    try {
      const b = await generatedInvoicesApi.paymentInvoiceBilling(paymentId);
      if (b.missing.length > 0) {
        setBilling({ paymentId, data: b });
        return;
      }
      await makeInvoice(paymentId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!overview) return error ? <ErrorBanner message={error} onRetry={load} /> : <Loading label="Loading payments…" />;
  const o = overview;
  const myId = profile?.id;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-800">Payments</h3>
          <PaymentStatusBadge status={o.paymentStatus} />
        </div>
        {!readOnly && (
          <button type="button" className={primaryBtn} onClick={() => setForm({ editing: null })} disabled={(o.dealAmount ?? 0) <= 0 || !!o.order?.gstRequired} title={o.order?.gstRequired ? 'Choose the GST rate of the order first.' : undefined}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Record payment
          </button>
        )}
      </div>
      <OrderGstCard customerId={customerId} overview={o} readOnly={readOnly} onSaved={next => { apply(next); setNotice('GST saved for the order.'); }} />
      <MoneyTiles pendingGst={!!o.order?.gstRequired} deal={o.dealAmount} agreed={o.agreedAmount} basis={o.taxBasis} verified={o.verified} pending={o.pending} balance={o.balance} />
      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
      {invoiceOutcome?.status === 'FAILED' && (
        <p role="alert" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          The payment is saved, but its paid invoice could not be made: {invoiceOutcome.message} Use &quot;Generate invoice&quot; on the payment to try again.
          {invoiceOutcome.paymentId && (
            <button type="button" className={`${ghostBtn} ml-2`} disabled={busyId !== null} onClick={() => void generateInvoice(invoiceOutcome.paymentId!)}>
              <FilePlus2 className="w-3 h-3" aria-hidden="true" /> Generate invoice
            </button>
          )}
        </p>
      )}
      {invoiceOutcome && invoiceOutcome.status !== 'FAILED' && invoiceOutcome.steps && invoiceOutcome.steps.length > 0 && <StepList steps={invoiceOutcome.steps} />}
      {error && <ErrorBanner message={error} />}
      <PaymentHistory
        payments={o.payments}
        actions={readOnly ? undefined : p => (
          <>
            {p.status === 'PENDING' && (
              <>
                <button type="button" className={greenBtn} disabled={busyId !== null} onClick={() => void run(p.id, () => pipelineApi.verifyAccountsPayment(customerId, p.id), 'Payment verified.')}>
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> {busyId === p.id ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button" className={ghostBtn} disabled={busyId !== null} onClick={() => setForm({ editing: p })}>
                  Edit
                </button>
                <button type="button" className={dangerBtn} disabled={busyId !== null} onClick={() => setReject(p)}>
                  Reject
                </button>
              </>
            )}
            {p.status === 'VERIFIED' && !p.invoice && (
              <button type="button" className={ghostBtn} disabled={busyId !== null} onClick={() => void generateInvoice(p.id)}>
                <FilePlus2 className="w-3 h-3" aria-hidden="true" /> {busyId === p.id ? 'Making invoice…' : 'Generate invoice'}
              </button>
            )}
            {p.status === 'VERIFIED' && isManager && (
              <button type="button" className={dangerBtn} disabled={busyId !== null} onClick={() => setReverse(p)}>
                Reverse
              </button>
            )}
          </>
        )}
      />

      <AccountsCustomerInvoices key={invoicesKey} customerId={customerId} customerLabel={customerLabel} canUpload={!readOnly} onChanged={load} />

      {followUps && !readOnly && (
        <>
          <OwnerRow overview={o} team={team} isManager={isManager} myId={myId} busy={busyId === 'owner'} onAssign={ownerId => void run('owner', () => pipelineApi.assignPaymentOwner(customerId, ownerId), 'Accountant updated.')} />
          <FollowUpSection customerId={customerId} overview={o} onSaved={next => { apply(next); setNotice('Follow-up saved.'); }} />
        </>
      )}

      {form && (
        <PaymentFormDialog
          customerId={customerId}
          overview={o}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={next => {
            apply(next);
            showInvoice(next);
            setNotice(form.editing ? 'Payment updated.' : 'Payment recorded.');
            setForm(null);
          }}
        />
      )}
      {billing && (
        <BillingDetailsDialog
          billing={billing.data}
          amount={o.payments.find(p => p.id === billing.paymentId)?.amount ?? 0}
          onClose={() => setBilling(null)}
          onSubmit={async customer => {
            await makeInvoice(billing.paymentId, customer);
            setBilling(null);
          }}
        />
      )}
      {reject && (
        <ReasonDialog
          title="Reject this payment"
          label="Why is it rejected?"
          action="Reject payment"
          danger
          onClose={() => setReject(null)}
          onConfirm={async reason => {
            apply(await pipelineApi.rejectAccountsPayment(customerId, reject.id, reason));
            setNotice('Payment rejected.');
            setReject(null);
          }}
        />
      )}
      {reverse && (
        <ReasonDialog
          title="Reverse a verified payment"
          label="Why is it being reversed?"
          action="Reverse payment"
          danger
          onClose={() => setReverse(null)}
          onConfirm={async reason => {
            apply(await pipelineApi.reverseAccountsPayment(customerId, reverse.id, reason));
            setNotice('Payment reversed. The balance was restored.');
            setReverse(null);
          }}
        />
      )}
    </div>
  );
};

const OwnerRow: React.FC<{
  overview: PaymentOverview;
  team: { id: string; fullName: string; role: string }[];
  isManager: boolean;
  myId?: string;
  busy: boolean;
  onAssign: (ownerId: string | null) => void;
}> = ({ overview, team, isManager, myId, busy, onAssign }) => {
  const owner = overview.accountsOwner;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
      <div className="text-xs">
        <div className="text-[11px] text-slate-500">Accountant responsible for the balance</div>
        <div className="font-bold text-slate-900">{owner ? owner.fullName : 'Not assigned'}</div>
      </div>
      {isManager ? (
        <label className="text-xs">
          <span className="sr-only">Assign accountant</span>
          <select className={`${inputClass} !py-1.5 !text-xs`} value={owner?.id ?? ''} disabled={busy} onChange={e => onAssign(e.target.value || null)}>
            <option value="">Not assigned</option>
            {team.map(t => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : !owner && myId ? (
        <button type="button" className={ghostBtn} disabled={busy} onClick={() => onAssign(myId)}>
          Take this customer
        </button>
      ) : null}
    </div>
  );
};

const FollowUpSection: React.FC<{ customerId: string; overview: PaymentOverview; onSaved: (o: PaymentOverview) => void }> = ({ customerId, overview, onSaved }) => {
  const [outcome, setOutcome] = useState<FollowUpOutcome>('CONTACTED');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = overview.followUps ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { outcome, note: note.trim(), nextFollowUpAt: fromLocalInput(next) };
    const parsed = paymentFollowUpSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the follow-up.');
    setBusy(true);
    setError(null);
    try {
      const nextOverview = await pipelineApi.addPaymentFollowUp(customerId, body);
      setNote('');
      setNext('');
      onSaved(nextOverview);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="followup-heading" className="space-y-3">
      <h3 id="followup-heading" className="text-xs font-bold text-slate-800">
        Payment follow-up notes <span className="font-normal text-slate-500">(Accounts only - not shown to Sales)</span>
      </h3>
      <form onSubmit={submit} className="rounded-xl border border-slate-200 p-3 space-y-3" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Outcome" htmlFor="fu-outcome">
            <select id="fu-outcome" className={inputClass} value={outcome} onChange={e => setOutcome(e.target.value as FollowUpOutcome)}>
              {FOLLOWUP_OUTCOMES.map(o => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Next follow-up (optional)" htmlFor="fu-next">
            <input id="fu-next" type="datetime-local" className={inputClass} value={next} min={nowLocal()} onChange={e => setNext(e.target.value)} />
          </FormField>
        </div>
        <FormField label="What happened?" htmlFor="fu-note" required>
          <textarea id="fu-note" rows={2} maxLength={2000} className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called the owner; will pay the balance on the 20th." />
        </FormField>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end">
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? 'Saving…' : 'Save follow-up'}
          </button>
        </div>
      </form>
      {list.length === 0 ? (
        <p className="text-xs text-slate-500">No follow-up recorded yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Follow-up history">
          {list.map(f => (
            <li key={f.id} className="rounded-xl bg-slate-50 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{fmtDateTime(f.contactedAt)}</span>
                <Badge tone={f.outcome === 'NO_RESPONSE' ? 'red' : f.outcome === 'AWAITING_PAYMENT' ? 'amber' : 'blue'}>{OUTCOME_LABEL[f.outcome]}</Badge>
                {f.author && <span className="text-slate-500">· {f.author}</span>}
              </div>
              <p className="mt-1 text-slate-700 whitespace-pre-line break-words">{f.note}</p>
              {f.nextFollowUpAt && <p className="mt-1 text-[11px] text-slate-500">Next follow-up {fmtDateTime(f.nextFollowUpAt)}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};


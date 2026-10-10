import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import type { FollowUpOutcome, LedgerPayment, PaymentOverview, PaymentType } from '../../../shared/contracts';
import { FOLLOWUP_OUTCOMES, PAYMENT_METHODS } from '../../../shared/contracts';
import { accountsRecordPaymentSchema, accountsUpdatePaymentSchema, paymentFollowUpSchema } from '../../../shared/validation';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi, type AccountsPaymentInput } from '../../lib/api/endpoints';
import { ErrorBanner, FormField, inputClass, Loading, Modal } from '../support-member/SupportParts';
import { Badge, fmtDateTime, METHOD_LABEL, MoneyTiles, PaymentHistory, PaymentStatusBadge, rupees, TYPE_LABEL } from '../payments/PaymentBits';

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
  // Balance still unaccounted for (verified + pending are both counted), excluding the payment being edited.
  const open = Math.max((overview.dealAmount ?? 0) - (overview.recorded - (editing && editing.status === 'PENDING' ? editing.amount : 0)), 0);
  const [type, setType] = useState<PaymentType>(editing?.type ?? 'PART');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [method, setMethod] = useState<string>(editing?.method ?? 'UPI');
  const [reference, setReference] = useState(editing?.reference ?? '');
  const [paidAt, setPaidAt] = useState(editing ? toLocalInput(editing.paidAt) : nowLocal());
  const [note, setNote] = useState(editing?.note ?? '');
  const [verify, setVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const pickType = (t: PaymentType) => {
    setType(t);
    if (t === 'FULL') setAmount(String(open)); // a full payment settles the whole open balance
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: AccountsPaymentInput = { type, amount: Number(amount), method: method as AccountsPaymentInput['method'], reference: reference.trim() || null, paidAt: fromLocalInput(paidAt), note: note.trim() || null };
    const parsed = editing ? accountsUpdatePaymentSchema.safeParse(body) : accountsRecordPaymentSchema.safeParse({ ...body, verify });
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
        : await pipelineApi.recordAccountsPayment(customerId, { ...body, verify });
      onSaved(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit payment' : 'Record payment'} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-xs text-slate-500">
          Agreed {rupees(overview.dealAmount)} · balance to account for <strong className="text-slate-800">{rupees(open)}</strong>
        </p>
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
          <FormField label="Amount (₹)" htmlFor="pay-amount" required error={fieldErrors.amount} hint={type === 'FULL' ? 'A full payment settles the whole balance.' : 'Whole rupees. Less than the balance.'}>
            <input id="pay-amount" type="number" min={1} step={1} inputMode="numeric" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} />
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
}> = ({ customerId, followUps = false, onChanged, onLoaded, readOnly = false }) => {
  const { profile } = useAuth();
  const isManager = profile?.role === 'SUPER_ADMIN' || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'TEAM_HEAD';
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: LedgerPayment | null } | null>(null);
  const [reject, setReject] = useState<LedgerPayment | null>(null);
  const [reverse, setReverse] = useState<LedgerPayment | null>(null);
  const [team, setTeam] = useState<{ id: string; fullName: string; role: string }[]>([]);

  const apply = useCallback(
    (o: PaymentOverview, changed = true) => {
      setOverview(o);
      onLoaded?.(o);
      if (changed) {
        onChanged?.(o);
        // verified / reversed payments change the finance totals
        window.dispatchEvent(new CustomEvent('crm:pipeline-changed'));
      }
    },
    [onChanged, onLoaded]
  );

  const load = useCallback(() => {
    setError(null);
    pipelineApi.paymentOverview(customerId).then(o => apply(o, false), e => setError(errorMessage(e)));
  }, [customerId, apply]);
  useEffect(load, [load]);
  useEffect(() => {
    if (followUps) pipelineApi.accountsTeam().then(setTeam, () => setTeam([]));
  }, [followUps]);

  const run = async (key: string, fn: () => Promise<PaymentOverview>, done: string) => {
    setBusyId(key);
    setError(null);
    setNotice(null);
    try {
      apply(await fn());
      setNotice(done);
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
          <button type="button" className={primaryBtn} onClick={() => setForm({ editing: null })} disabled={(o.dealAmount ?? 0) <= 0}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Record payment
          </button>
        )}
      </div>
      <MoneyTiles deal={o.dealAmount} verified={o.verified} pending={o.pending} balance={o.balance} />
      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
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
            {p.status === 'VERIFIED' && isManager && (
              <button type="button" className={dangerBtn} disabled={busyId !== null} onClick={() => setReverse(p)}>
                Reverse
              </button>
            )}
          </>
        )}
      />

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
            setNotice(form.editing ? 'Payment updated.' : 'Payment recorded.');
            setForm(null);
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


import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, RefreshCw, Send, Wand2 } from 'lucide-react';
import type { ClientLoginStatus, CustomerJourneyInfo, JourneyKind, JourneyStep } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { btn, Card, ErrorBanner, Field, inputCls, longDate, money, notifyPipelineChanged, Pill, usePipelineRealtime, type Tone } from '../team-member/pipeline/shared';

export const JOURNEY_LABEL: Record<JourneyKind, string> = {
  TECHNICAL: 'Technical Consultant journey',
  DIRECT: 'Direct journey (no Technical Consultant)',
  MIXED: 'Mixed order (Technical Consultant journey)',
  NONE: 'No service selected'
};

export const STEP_LABEL: Record<JourneyStep, string> = {
  LEAD: 'Lead',
  PENDING_PAYMENT: 'With Accounts: payment to be verified',
  PAYMENT_PARTIAL: 'Part payment verified',
  PAYMENT_CONFIRMED: 'Payment verified',
  LOGIN_PENDING: 'Payment verified: client login to be created',
  LOGIN_FAILED: 'Client login failed: try again',
  LOGIN_CREATED: 'Client login created: ready to return to Sales',
  RETURNED_TO_SALES: 'Returned to Sales: collect the documents',
  DOCUMENTS_PENDING: 'Documents waiting for verification',
  DOCUMENTS_VERIFIED: 'Documents verified: send to the department',
  PARTLY_SENT_TO_DELIVERY: 'Partly sent to the delivery department',
  SENT_TO_DELIVERY: 'Sent to the delivery department',
  TECHNICAL_CONSULTANT: 'With the Technical Consultant journey',
  CUSTOMER: 'Customer',
  LOST: 'Lost'
};

const LOGIN_TONE: Record<ClientLoginStatus, Tone> = { NOT_STARTED: 'slate', PENDING: 'orange', CREATED: 'green', FAILED: 'red' };
const LOGIN_LABEL: Record<ClientLoginStatus, string> = { NOT_STARTED: 'Not created', PENDING: 'Being created', CREATED: 'Created', FAILED: 'Failed' };
const PAY_LABEL: Record<string, string> = { NO_PAYMENT: 'No payment', PENDING_VERIFICATION: 'Awaiting verification', PARTIALLY_PAID: 'Partially paid', FULLY_PAID: 'Fully paid' };
const PAY_TONE: Record<string, Tone> = { NO_PAYMENT: 'slate', PENDING_VERIFICATION: 'orange', PARTIALLY_PAID: 'indigo', FULLY_PAID: 'green' };

/** Loads where a customer is; refreshes on any pipeline change (Realtime, focus, or an action in this tab). No timers. */
export function useJourney(customerId: string | null) {
  const [journey, setJourney] = useState<CustomerJourneyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!customerId) return;
    pipelineApi.customerJourney(customerId).then(
      j => {
        setJourney(j);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [customerId]);
  useEffect(() => {
    setJourney(null);
    load();
  }, [load]);
  usePipelineRealtime(load);
  return { journey, error, reload: load };
}

/** The four facts that are tracked apart (payment, client login, documents, delivery) plus the label for where the customer is. */
export const JourneyStrip: React.FC<{ journey: CustomerJourneyInfo }> = ({ journey: j }) => (
  <div className="space-y-2" aria-label="Where this customer is">
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={j.journey === 'DIRECT' ? 'green' : j.journey === 'MIXED' ? 'orange' : 'indigo'}>{JOURNEY_LABEL[j.journey]}</Pill>
      <span className="text-xs font-semibold text-slate-800">{STEP_LABEL[j.step]}</span>
    </div>
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
      <div className="px-3 py-2 rounded-xl border border-slate-200">
        <dt className="text-[11px] text-slate-500">Payment</dt>
        <dd className="mt-0.5 font-semibold text-slate-900">{money(j.payment.verified)} verified</dd>
        <dd className="mt-1">
          <Pill tone={PAY_TONE[j.payment.status] ?? 'slate'}>{PAY_LABEL[j.payment.status] ?? j.payment.status}</Pill>
        </dd>
        {j.payment.dealAmount !== null && j.payment.balance > 0 && <dd className="text-[11px] text-orange-700 mt-0.5">{money(j.payment.balance)} still due</dd>}
      </div>
      <div className="px-3 py-2 rounded-xl border border-slate-200">
        <dt className="text-[11px] text-slate-500">Client dashboard login</dt>
        <dd className="mt-1">
          <Pill tone={LOGIN_TONE[j.clientLogin.status]}>{LOGIN_LABEL[j.clientLogin.status]}</Pill>
        </dd>
        {j.clientLogin.email && <dd className="text-[11px] text-slate-500 mt-0.5 break-all">{j.clientLogin.email}</dd>}
      </div>
      <div className="px-3 py-2 rounded-xl border border-slate-200">
        <dt className="text-[11px] text-slate-500">Documents</dt>
        <dd className="mt-0.5 font-semibold text-slate-900">
          {j.documents.verified} of {j.documents.total} verified
        </dd>
        {j.documents.rejected > 0 && <dd className="text-[11px] text-rose-700 mt-0.5">{j.documents.rejected} sent back</dd>}
      </div>
      <div className="px-3 py-2 rounded-xl border border-slate-200">
        <dt className="text-[11px] text-slate-500">Delivery departments</dt>
        <dd className="mt-0.5 font-semibold text-slate-900">
          {j.delivery.sent} of {j.delivery.total} services sent
        </dd>
      </div>
    </dl>
  </div>
);

/** A strong password the person can read out or paste. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('') + '#7';
}

/**
 * Accounts: creates the client's dashboard login (customers whose services need no Technical Consultant). The password is hashed by
 * the sign-in service; the CRM does not store or e-mail it. A failure stays visible with its reason and can be tried again.
 */
export const ClientLoginCard: React.FC<{ journey: CustomerJourneyInfo; customerId: string; defaultEmail?: string | null; onChanged: () => void }> = ({
  journey: j,
  customerId,
  defaultEmail,
  onChanged
}) => {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const login = j.clientLogin;
  const staleAttempt = login.status === 'PENDING' && login.updatedAt && Date.now() - new Date(login.updatedAt).getTime() > 2 * 60_000;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 10) return setError('The password must be at least 10 characters.');
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.accountsCreateClientLogin(customerId, { email: email.trim(), password });
      setCreated({ email: email.trim().toLowerCase(), password });
      setPassword('');
      notifyPipelineChanged();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`${created.email}\n${created.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="client-login-title" className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <KeyRound className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 id="client-login-title" className="text-sm font-bold text-slate-900">
            Client dashboard login
          </h3>
          <p className="text-xs text-slate-500">
            These services need no Technical Consultant, so Accounts creates the customer&apos;s login before returning the customer to Sales. The password is not stored or e-mailed by the CRM: give it to the customer through a safe channel.
          </p>
        </div>
      </div>

      {login.status === 'CREATED' ? (
        <div className="text-xs rounded-xl px-3 py-2 border text-emerald-800 bg-emerald-50 border-emerald-200 flex flex-wrap items-center gap-2">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>
            Login created for <b>{login.email}</b>
            {login.createdAt ? ` on ${longDate(login.createdAt)}` : ''}
            {login.createdBy ? ` by ${login.createdBy}` : ''}.
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" aria-label="Create the client login">
          {login.status === 'FAILED' && login.lastError && <ErrorBanner message={`The last attempt failed: ${login.lastError} You can try again.`} />}
          {login.status === 'PENDING' && !staleAttempt && (
            <p role="status" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              A login is being created. This page updates when it is done.
            </p>
          )}
          {!j.can.createLogin && login.status !== 'PENDING' && (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">Verify a payment first. The login can be created once the money is verified.</p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Customer e-mail (the login)" htmlFor="cl-email" required>
              <input id="cl-email" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" disabled={busy || !j.can.createLogin} />
            </Field>
            <Field label="Password (at least 10 characters)" htmlFor="cl-password" required>
              <div className="flex gap-2">
                <input
                  id="cl-password"
                  type={show ? 'text' : 'password'}
                  className={inputCls}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={busy || !j.can.createLogin}
                />
                <button type="button" className={btn.secondary} onClick={() => { setPassword(generatePassword()); setShow(true); }} disabled={busy || !j.can.createLogin} aria-label="Generate a password">
                  <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </Field>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end">
            <button type="submit" className={btn.primary} disabled={busy || !j.can.createLogin || (login.status === 'PENDING' && !staleAttempt)}>
              {login.status === 'FAILED' || staleAttempt ? <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> : <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />}
              {busy ? 'Creating…' : login.status === 'FAILED' || staleAttempt ? 'Try again' : 'Create client login'}
            </button>
          </div>
        </form>
      )}

      {created && (
        <div role="status" className="text-xs rounded-xl px-3 py-2 border text-emerald-900 bg-emerald-50 border-emerald-200 space-y-1">
          <div className="font-bold">The login is ready. Note the password now: it is shown only here.</div>
          <div className="font-mono break-all">
            {created.email} / {created.password}
          </div>
          <button type="button" className={btn.secondary} onClick={() => void copy()}>
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </section>
  );
};

/** Sales / Support: sends every verified service to the department that delivers it (each service to its own). */
export const SendToDeliveryCard: React.FC<{ journey: CustomerJourneyInfo; customerId: string; onChanged: () => void }> = ({ journey: j, customerId, onChanged }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await pipelineApi.sendToDelivery(customerId, note.trim() || null);
      setDone(`${r.sent} service${r.sent === 1 ? '' : 's'} sent${r.departments ? ` to ${r.departments}` : ''}.`);
      notifyPipelineChanged();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="delivery-title" className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
      <div>
        <h3 id="delivery-title" className="text-sm font-bold text-slate-900">
          Send to the delivery department
        </h3>
        <p className="text-xs text-slate-500">
          Once the payment is confirmed and every document is verified, each service goes to the department that delivers it.
          {j.journey === 'MIXED' && ' Services that need a Technical Consultant stay with that journey.'}
        </p>
      </div>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs" aria-label="Services">
        {j.services.map(s => (
          <li key={s.code} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-slate-800">{s.name}</span>
            {s.requiresTechnicalConsultant ? (
              <Pill tone="indigo">Technical Consultant</Pill>
            ) : s.sentToDeliveryAt ? (
              <Pill tone="green">Sent to {s.deliveryDepartment?.name ?? 'the department'}</Pill>
            ) : s.deliveryDepartment ? (
              <Pill tone="orange">Goes to {s.deliveryDepartment.name}</Pill>
            ) : (
              <Pill tone="red">No department set</Pill>
            )}
            {s.sentToDeliveryAt && (
              <span className="text-slate-500">
                {longDate(s.sentToDeliveryAt)}
                {s.sentToDeliveryBy ? ` by ${s.sentToDeliveryBy}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <ErrorBanner message={error} />}
      {done && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {done}
        </p>
      )}
      {j.can.sendToDelivery ? (
        <div className="space-y-2">
          <Field label="Note for the department (optional)" htmlFor="delivery-note">
            <textarea id="delivery-note" rows={2} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex justify-end">
            <button type="button" className={btn.green} onClick={() => void send()} disabled={busy}>
              <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send to the department'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          {j.delivery.unsentDirect === 0
            ? 'Nothing is waiting to be sent.'
            : j.journey === 'DIRECT' && j.clientLogin.status !== 'CREATED'
              ? 'The client login has not been created yet.'
              : j.documents.verified < j.documents.total || j.documents.rejected > 0
                ? 'Verify every document first. Sending unlocks when all of them are verified.'
                : 'Not available for you right now.'}
        </p>
      )}
    </section>
  );
};

/** Everything the direct journey shows to Sales / Support on the onboarding page. */
export const DirectJourneyCard: React.FC<{ journey: CustomerJourneyInfo; customerId: string; onChanged: () => void }> = ({ journey, customerId, onChanged }) => (
  <Card className="p-4 sm:p-5 space-y-4">
    <JourneyStrip journey={journey} />
    <SendToDeliveryCard journey={journey} customerId={customerId} onChanged={onChanged} />
  </Card>
);

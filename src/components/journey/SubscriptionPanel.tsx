import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, History, Loader2, Mail, RefreshCw } from 'lucide-react';
import type { SubscriptionHistoryItem, SubscriptionInfo, SubscriptionOverview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { btn, Field, inputCls, todayIso } from '../team-member/pipeline/shared';
import { checkTerms, emptyTerms, TermsFields, termsFrom, type TermsDraft, type TermsErrors } from './SubscriptionTerms';
import { Paged } from '../common/Paged';

/**
 * The subscription of each service, as the team works with it:
 *  - Sales names the plan, duration, amount and credits (never a date);
 *  - the team that creates the panel confirms the activation (panel creation date + activation date; "activated by" is recorded from the sign-in);
 *  - the expiry date is always calculated by the server from the confirmed date and the duration;
 *  - the heads can correct a confirmed date (with a reason), the team confirms a renewal against a verified payment.
 * Every button is a request the server checks again; this screen only offers what is likely to work and shows the server's reason when it is not.
 */
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtAt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const STATUS_TONE: Record<string, string> = {
  NOT_STARTED: 'bg-amber-50 text-amber-800 border-amber-200', ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRED: 'bg-rose-50 text-rose-700 border-rose-200', PAUSED: 'bg-slate-100 text-slate-600 border-slate-200', CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200'
};
const STATUS_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', ACTIVE: 'Active', EXPIRED: 'Expired', PAUSED: 'Paused', CANCELLED: 'Cancelled' };
const ACTION: Record<SubscriptionHistoryItem['action'], string> = {
  TERMS_SET: 'Terms set', ACTIVATED: 'Subscription started', DATES_CORRECTED: 'Dates corrected', RENEWED: 'Renewed', EMAIL_RESENT: 'Activation e-mail sent again'
};
const pill = (cls: string, text: string) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold ${cls}`}>{text}</span>;

type Open = { service: string; kind: 'terms' | 'activate' | 'correct' | 'renew' } | null;

const ServiceCard: React.FC<{
  s: SubscriptionInfo;
  payments: SubscriptionOverview['payments'];
  busy: string | null;
  open: Open;
  setOpen: (o: Open) => void;
  run: (key: string, fn: () => Promise<unknown>, done?: () => void) => Promise<boolean>;
  customerId: string;
}> = ({ s, payments, busy, open, setOpen, run, customerId }) => {
  const id = `sub-${customerId}-${s.service}`;
  const mine = open?.service === s.service ? open.kind : null;
  const [terms, setTerms] = useState<TermsDraft>(termsFrom(s));
  const [termErrors, setTermErrors] = useState<TermsErrors>({});
  const [panelOn, setPanelOn] = useState(todayIso());
  const [startOn, setStartOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [payment, setPayment] = useState('');
  const [renewStart, setRenewStart] = useState('');
  const [renewTerms, setRenewTerms] = useState<TermsDraft>(emptyTerms());
  const [sameTerms, setSameTerms] = useState(true);
  const freePayments = payments.filter(p => !p.used);

  const openForm = (kind: NonNullable<Open>['kind']) => {
    if (kind === 'terms') { setTerms(termsFrom(s)); setTermErrors({}); }
    if (kind === 'correct') { setStartOn(s.startedOn ?? todayIso()); setPanelOn(s.panelCreatedOn ?? s.startedOn ?? todayIso()); setReason(''); }
    if (kind === 'activate') { setStartOn(todayIso()); setPanelOn(todayIso()); setNote(''); }
    setOpen({ service: s.service, kind });
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3" data-testid={`subscription-${s.service}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900">{s.serviceName}</h3>
        {pill(STATUS_TONE[s.status] ?? STATUS_TONE.NOT_STARTED, STATUS_LABEL[s.status] ?? s.status)}
        {s.cycle > 1 && <span className="text-[11px] text-slate-500">renewal cycle {s.cycle}</span>}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-slate-500">Plan</dt><dd className="font-semibold text-slate-800">{s.plan ?? '—'}</dd></div>
        <div><dt className="text-slate-500">Duration</dt><dd className="font-semibold text-slate-800">{s.durationLabel ?? 'not set'}</dd></div>
        <div><dt className="text-slate-500">Amount</dt><dd className="font-semibold text-slate-800">{s.amount !== null ? `₹${s.amount.toLocaleString('en-IN')}` : '—'}</dd></div>
        <div><dt className="text-slate-500">Message credits</dt><dd className="font-semibold text-slate-800">{s.messageCredits !== null ? s.messageCredits.toLocaleString('en-IN') : '—'}</dd></div>
        <div><dt className="text-slate-500">Panel</dt><dd className="font-semibold text-slate-800">{s.panel ?? '—'}</dd></div>
        <div><dt className="text-slate-500">Panel creation date</dt><dd className="font-semibold text-slate-800" data-testid="panel-created">{fmt(s.panelCreatedOn)}</dd></div>
        <div><dt className="text-slate-500">Subscription activation date</dt><dd className="font-semibold text-slate-800" data-testid="started-on">{fmt(s.startedOn)}</dd></div>
        <div><dt className="text-slate-500">Subscription expiry date</dt><dd className="font-semibold text-slate-800" data-testid="expires-on">{s.expiresOn ? fmt(s.expiresOn) : 'calculated at activation'}</dd></div>
        <div><dt className="text-slate-500">Activated by</dt><dd className="font-semibold text-slate-800">{s.activatedBy ?? '—'}{s.activatedAt ? <span className="font-normal text-slate-500"> · {fmtAt(s.activatedAt)}</span> : null}</dd></div>
      </dl>

      {s.status === 'NOT_STARTED' && (
        <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2">
          The start and expiry dates stay empty until the panel is created and activated. {s.blocker ? <b>Waiting for: {s.blocker}</b> : s.canActivate ? 'Everything is in place: confirm the activation below.' : ''}
        </p>
      )}
      {s.status === 'ACTIVE' && s.daysLeft !== null && <p className="text-xs text-slate-600">{s.daysLeft} day{s.daysLeft === 1 ? '' : 's'} left.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {s.canSetTerms && <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => openForm('terms')}>{s.termsComplete ? 'Edit plan & duration' : 'Set plan & duration'}</button>}
        {s.canActivate && s.termsComplete && <button type="button" className={btn.green} disabled={busy !== null} onClick={() => openForm('activate')}><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Confirm panel activation</button>}
        {s.canCorrect && s.status !== 'NOT_STARTED' && <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => openForm('correct')}>Correct dates</button>}
        {s.canRenew && s.status !== 'NOT_STARTED' && <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => openForm('renew')}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Confirm renewal</button>}
      </div>

      {s.email && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="activation-email">
          <Mail className="w-4 h-4 text-slate-400" aria-hidden="true" /> Panel activation e-mail: <b>{s.email.status === 'SENT' ? 'sent' : s.email.status === 'QUEUED' ? 'queued' : s.email.status === 'SKIPPED' ? 'not sent (dry run or test mode)' : s.email.status === 'FAILED' ? 'failed' : s.email.status.toLowerCase()}</b>
          {s.email.sentAt && <span className="text-slate-500">· {fmtAt(s.email.sentAt)}</span>}
          {s.email.detail && s.email.status !== 'SENT' && <span className="text-slate-500">· {s.email.detail}</span>}
          {s.canResendEmail && s.email.status !== 'QUEUED' && (
            <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => void run(`${id}-mail`, () => pipelineApi.resendActivationEmail(customerId, s.service))}>
              {busy === `${id}-mail` ? 'Sending…' : s.email.status === 'SENT' ? 'Send again' : 'Retry sending'}
            </button>
          )}
        </div>
      )}

      {mine === 'terms' && (
        <form className="space-y-3 border-t border-slate-100 pt-3" onSubmit={e => {
          e.preventDefault();
          const c = checkTerms(terms);
          if (!c.ok) { setTermErrors(c.errors); return; }
          setTermErrors({});
          void run(`${id}-terms`, () => pipelineApi.setSubscriptionTerms(customerId, s.service, c.body), () => setOpen(null));
        }}>
          <p className="text-xs text-slate-500">Choose the agreed duration. You do not enter a start or an expiry date: they come from the panel activation.</p>
          <TermsFields idPrefix={id} value={terms} onChange={setTerms} errors={termErrors} />
          <div className="flex gap-2">
            <button type="submit" className={btn.primary} disabled={busy !== null}>{busy === `${id}-terms` ? 'Saving…' : 'Save'}</button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {mine === 'activate' && (
        <form className="space-y-3 border-t border-slate-100 pt-3" onSubmit={e => {
          e.preventDefault();
          void run(`${id}-act`, () => pipelineApi.confirmSubscriptionActivation(customerId, s.service, { activationDate: startOn, panelCreatedOn: panelOn || null, note: note.trim() || null }), () => setOpen(null));
        }}>
          <p className="text-xs text-slate-600">Confirm only when the panel has really been created <b>and</b> activated. The subscription starts on the activation date below and the expiry is calculated from it ({s.durationLabel}). Doing this twice changes nothing.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Panel creation date" required htmlFor={`${id}-panel`}><input id={`${id}-panel`} type="date" className={inputCls} value={panelOn} max={todayIso()} onChange={e => setPanelOn(e.target.value)} required /></Field>
            <Field label="Subscription activation date" required htmlFor={`${id}-start`}><input id={`${id}-start`} type="date" className={inputCls} value={startOn} max={todayIso()} onChange={e => setStartOn(e.target.value)} required /></Field>
            <Field label="Activated by" htmlFor={`${id}-by`}><input id={`${id}-by`} className={inputCls} value="You (recorded from your sign-in)" disabled readOnly /></Field>
          </div>
          <Field label="Note (optional)" htmlFor={`${id}-note`}><input id={`${id}-note`} className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></Field>
          <div className="flex gap-2">
            <button type="submit" className={btn.green} disabled={busy !== null}>{busy === `${id}-act` ? 'Confirming…' : 'Confirm activation'}</button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {mine === 'correct' && (
        <form className="space-y-3 border-t border-slate-100 pt-3" onSubmit={e => {
          e.preventDefault();
          void run(`${id}-fix`, () => pipelineApi.correctSubscriptionDates(customerId, s.service, { activationDate: startOn, panelCreatedOn: panelOn || null, reason: reason.trim() }), () => setOpen(null));
        }}>
          <p className="text-xs text-slate-600">The expiry date is recalculated from the corrected activation date. The old and the new dates are kept in the history with your reason.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Panel creation date" required htmlFor={`${id}-cpanel`}><input id={`${id}-cpanel`} type="date" className={inputCls} value={panelOn} max={todayIso()} onChange={e => setPanelOn(e.target.value)} required /></Field>
            <Field label="Subscription activation date" required htmlFor={`${id}-cstart`}><input id={`${id}-cstart`} type="date" className={inputCls} value={startOn} max={todayIso()} onChange={e => setStartOn(e.target.value)} required /></Field>
          </div>
          <Field label="Reason for the correction" required htmlFor={`${id}-reason`}><input id={`${id}-reason`} className={inputCls} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} required /></Field>
          <div className="flex gap-2">
            <button type="submit" className={btn.primary} disabled={busy !== null || reason.trim().length < 5}>{busy === `${id}-fix` ? 'Saving…' : 'Correct dates'}</button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {mine === 'renew' && (
        <form className="space-y-3 border-t border-slate-100 pt-3" onSubmit={e => {
          e.preventDefault();
          let terms: Record<string, unknown> | null = null;
          if (!sameTerms) {
            const c = checkTerms({ ...renewTerms, plan: renewTerms.plan || s.plan || '', amount: renewTerms.amount || String(s.amount ?? 0) });
            if (!c.ok) { setTermErrors(c.errors); return; }
            terms = c.body;
          }
          void run(`${id}-renew`, () => pipelineApi.confirmSubscriptionRenewal(customerId, s.service, { paymentId: payment, startDate: renewStart || null, terms, note: null }), () => setOpen(null));
        }}>
          <p className="text-xs text-slate-600">A renewal needs a payment Accounts has verified. While the subscription is running it continues from its expiry date ({fmt(s.expiresOn)}); after it has lapsed it starts on the date you enter. The previous term stays in the history.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Verified payment" required htmlFor={`${id}-pay`}>
              <select id={`${id}-pay`} className={inputCls} value={payment} onChange={e => setPayment(e.target.value)} required>
                <option value="">Choose…</option>
                {freePayments.map(p => <option key={p.id} value={p.id}>₹{p.amount.toLocaleString('en-IN')} · {fmt(p.paidAt)}{p.method ? ` · ${p.method}` : ''}</option>)}
              </select>
              {freePayments.length === 0 && <span className="text-[11px] text-rose-600">There is no verified payment that has not been used for a renewal yet.</span>}
            </Field>
            {s.expiresOn && new Date(`${s.expiresOn}T00:00:00`).getTime() < Date.now() - 86_400_000 && (
              <Field label="Renewed panel activation date" required htmlFor={`${id}-rs`}><input id={`${id}-rs`} type="date" className={inputCls} value={renewStart} max={todayIso()} onChange={e => setRenewStart(e.target.value)} required /></Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={sameTerms} onChange={e => setSameTerms(e.target.checked)} /> Same plan and duration ({s.durationLabel})</label>
          {!sameTerms && <TermsFields idPrefix={`${id}-r`} value={renewTerms} onChange={setRenewTerms} errors={termErrors} />}
          <div className="flex gap-2">
            <button type="submit" className={btn.primary} disabled={busy !== null || !payment}>{busy === `${id}-renew` ? 'Confirming…' : 'Confirm renewal'}</button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
};

export const SubscriptionPanel: React.FC<{ customerId: string; onChanged?: () => void }> = ({ customerId, onChanged }) => {
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    pipelineApi.subscriptions(customerId).then(d => { setData(d); setHidden(false); }, () => setHidden(true));
  }, [customerId]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: () => void): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'services' in (r as object)) setData(r as SubscriptionOverview);
      else load();
      done?.();
      setNotice('Saved.');
      onChanged?.();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (hidden) return null;
  if (!data) return <div className="bg-white rounded-2xl border border-slate-200/80 p-5 text-xs text-slate-500" role="status"><Loader2 className="inline w-4 h-4 animate-spin mr-1" aria-hidden="true" />Loading the subscription…</div>;
  if (data.services.length === 0) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-labelledby={`sub-${customerId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h2 id={`sub-${customerId}`} className="font-bold text-slate-900">Subscription</h2>
      </div>
      <p className="text-xs text-slate-500">Sales chooses the plan and duration. The subscription starts on the date the team confirms the panel was created and activated; the expiry date is calculated automatically.</p>
      {error && <p role="alert" className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {notice && !error && <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}
      <div className="space-y-3">
        {data.services.map(s => <ServiceCard key={s.service} s={s} payments={data.payments} busy={busy} open={open} setOpen={setOpen} run={run} customerId={customerId} />)}
      </div>
      {data.history.length > 0 && (
        <div>
          <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}>
            <History className="w-4 h-4" aria-hidden="true" /> History ({data.history.length})
          </button>
          {showHistory && (
            <Paged items={data.history} noun="entries">{rows => (
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              {rows.map(h => (
                <li key={h.id} className="border border-slate-100 rounded-lg px-3 py-2">
                  <b className="text-slate-800">{ACTION[h.action]}</b> · {h.service} · {h.by ?? 'system'} · {fmtAt(h.at)}
                  {h.action === 'DATES_CORRECTED' && <> — {fmt(String(h.old?.startedOn ?? ''))} → {fmt(String(h.new?.startedOn ?? ''))} (expiry {fmt(String(h.old?.expiresOn ?? ''))} → {fmt(String(h.new?.expiresOn ?? ''))})</>}
                  {(h.action === 'ACTIVATED' || h.action === 'RENEWED') && <> — {fmt(String(h.new?.startedOn ?? ''))} to {fmt(String(h.new?.expiresOn ?? ''))}</>}
                  {h.reason && <> — “{h.reason}”</>}
                </li>
              ))}
            </ul>
            )}</Paged>
          )}
        </div>
      )}
    </section>
  );
};

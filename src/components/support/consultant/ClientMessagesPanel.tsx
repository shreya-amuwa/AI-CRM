import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Globe, Mail, MessageCircle, Send, XCircle } from 'lucide-react';
import type { ChecklistItem, ClientMessage, ClientMessages, ClientStage } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { btn, ErrorBanner, inputCls } from '../../team-member/pipeline/shared';

/**
 * The customer's onboarding emails and WhatsApp messages (Wabastore, WhatsApp API + Blue Tick).
 * They are sent automatically from the Technical Consultant's work:
 *   reaches you -> Under Review / Website Pending, website link + every item authorized -> Meta Verification,
 *   client login created -> Status Completed.
 */
const STAGES: { code: ClientStage; label: string }[] = [
  { code: 'UNDER_REVIEW', label: 'Under Review' },
  { code: 'META_VERIFICATION', label: 'Meta Verification' },
  { code: 'COMPLETED', label: 'Status Completed' }
];
const STAGE_LABEL: Record<ClientStage, string> = {
  WEBSITE_PENDING: 'Website Pending',
  UNDER_REVIEW: 'Under Review',
  META_VERIFICATION: 'Meta Verification',
  COMPLETED: 'Status Completed'
};
const RANK: Record<ClientStage, number> = { WEBSITE_PENDING: 0, UNDER_REVIEW: 0, META_VERIFICATION: 1, COMPLETED: 2 };

const STATUS: Record<ClientMessage['status'], { label: string; cls: string }> = {
  QUEUED: { label: 'Queued', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  SENDING: { label: 'Sending', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  SENT: { label: 'Sent', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  FAILED: { label: 'Failed', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  SKIPPED: { label: 'Not sent', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-slate-50 text-slate-500 border-slate-200' }
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';

function nextStep(stage: ClientStage | null, hasSite: boolean): string {
  switch (stage) {
    case 'WEBSITE_PENDING':
      return hasSite
        ? 'Authorize every document: the Meta Verification email (about 2-3 weeks) goes out.'
        : 'Create the website, save its link below and authorize every document: the Meta Verification email (about 2-3 weeks) goes out.';
    case 'UNDER_REVIEW':
      return 'Authorize every document: the Meta Verification email (about 2-3 weeks) goes out.';
    case 'META_VERIFICATION':
      return 'When Meta verification is done, create the client login: the panel access email (with the login) goes out.';
    case 'COMPLETED':
      return 'All onboarding messages are done.';
    default:
      return 'Messages start when the customer reaches you.';
  }
}

export const ClientMessagesPanel: React.FC<{
  customerId: string;
  data: ClientMessages | null;
  websiteItem: ChecklistItem | undefined;
  locked: boolean;
  onChanged: () => void;
}> = ({ customerId, data, websiteItem, locked, onChanged }) => {
  const current = websiteItem?.entry?.value || '';
  const site = current && current !== 'NO_WEBSITE' ? current : '';
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(site);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  useEffect(() => setUrl(site), [site]);

  if (!data?.automated) return null;
  const stage = data.stage;
  const startLabel = stage === 'WEBSITE_PENDING' ? 'Website Pending' : 'Under Review';
  const steps = STAGES.map(s => (s.code === 'UNDER_REVIEW' ? { ...s, label: startLabel } : s));

  const resend = async () => {
    setResending(true);
    setError(null);
    setResendNote(null);
    try {
      await pipelineApi.resendClientMessages(customerId);
      setResendNote('The messages are being sent.');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };
  const waiting = data.messages.some(m => m.status === 'QUEUED' || m.status === 'SENDING');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setError('Enter the website address.');
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.setWebsite(customerId, url.trim());
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-labelledby="client-messages-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="client-messages-heading" className="font-bold text-slate-900">
            Customer emails &amp; WhatsApp
          </h2>
          <p className="text-xs text-slate-500">Sent automatically at each step of your work. Each step is sent once.</p>
        </div>
        {data.mode !== 'live' ? (
          <span className="px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-50 text-amber-800 border-amber-200">
            {data.mode === 'off' ? 'Sending switched off' : 'Test mode: nothing is sent'}
          </span>
        ) : data.testMode ? (
          <span className="px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-50 text-amber-800 border-amber-200">Test recipients only</span>
        ) : null}
      </div>

      {data.mode === 'live' && (!data.emailReady || !data.whatsappReady) && (
        <p role="alert" className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {!data.emailReady && !data.whatsappReady
            ? 'Email and WhatsApp sending are not set up on the server yet, so these messages are waiting.'
            : !data.emailReady
              ? 'Email sending is not set up on the server yet (email provider settings), so emails are waiting.'
              : 'WhatsApp sending is not set up on the server yet (webhook link), so WhatsApp messages are waiting.'}{' '}
          Ask your administrator to finish the setup; the waiting messages then go out by themselves.
        </p>
      )}

      <ol className="grid grid-cols-3 gap-2" aria-label="Customer onboarding steps">
        {steps.map(s => {
          const done = stage !== null && RANK[stage] >= RANK[s.code];
          const isCurrent = stage !== null && RANK[stage] === RANK[s.code];
          return (
            <li
              key={s.code}
              aria-current={isCurrent ? 'step' : undefined}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
            >
              <span className="inline-flex items-center gap-1">
                {done ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Clock className="w-3.5 h-3.5" aria-hidden="true" />}
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-slate-600">{nextStep(stage, !!site)}</p>

      {websiteItem && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Globe className="w-4 h-4 text-slate-500" aria-hidden="true" /> Website
            </span>
            {!editing && !locked && (
              <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700" onClick={() => setEditing(true)}>
                {site ? 'Edit link' : 'Add website link'}
              </button>
            )}
          </div>
          {editing ? (
            <form onSubmit={save} className="mt-2 flex flex-col sm:flex-row gap-2" noValidate>
              <label className="sr-only" htmlFor="tc-website">
                Website address
              </label>
              <input
                id="tc-website"
                type="url"
                inputMode="url"
                maxLength={500}
                placeholder="https://www.example.com"
                className={`${inputCls} py-2`}
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
              <div className="flex gap-2 shrink-0">
                <button type="submit" className={btn.primary} disabled={busy}>
                  {busy ? 'Saving…' : 'Save link'}
                </button>
                <button type="button" className={btn.secondary} disabled={busy} onClick={() => { setEditing(false); setUrl(site); setError(null); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-1 text-sm text-slate-700 break-all">
              {site ? (
                <a href={site} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline">
                  {site}
                </a>
              ) : current === 'NO_WEBSITE' ? (
                'The customer has no website yet.'
              ) : (
                'No website entered.'
              )}
            </p>
          )}
          {error && (
            <div className="mt-2">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>
      )}

      {stage && !locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn.secondary} onClick={resend} disabled={resending || waiting}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> {resending ? 'Sending…' : `Send ${STAGE_LABEL[stage]} messages`}
          </button>
          <span className="text-[11px] text-slate-500">
            {waiting
              ? 'Messages for this step are waiting to be sent.'
              : stage === 'COMPLETED'
                ? 'Sends the panel access email and WhatsApp again (without the password).'
                : 'Sends the email and WhatsApp of the step the customer is at.'}
          </span>
          {resendNote && <span role="status" className="text-xs font-semibold text-emerald-700">{resendNote}</span>}
        </div>
      )}
      {stage && data.messages.length === 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Nothing was sent for this step. The customer reached you before the automatic messages were switched on. Use the button above to send them now.
        </p>
      )}

      {data.messages.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Messages">
          {[...data.messages].reverse().map(m => {
            const S = STATUS[m.status];
            const Icon = m.channel === 'EMAIL' ? Mail : MessageCircle;
            return (
              <li key={m.id} className="px-3 py-2.5 flex items-start gap-3">
                <Icon className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {STAGE_LABEL[m.stage]} {m.channel === 'EMAIL' ? 'email' : 'WhatsApp'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${S.cls}`}>
                      {m.status === 'FAILED' && <XCircle className="w-3 h-3 inline -mt-0.5 mr-0.5" aria-hidden="true" />}
                      {S.label}
                    </span>
                    <span className="text-[11px] text-slate-500">{when(m.sentAt || m.createdAt)}</span>
                  </div>
                  {m.detail && <p className="text-xs text-slate-600 mt-0.5 break-words">{m.detail}</p>}
                  {m.status === 'QUEUED' && m.attempts > 0 && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Attempt {m.attempts} failed; trying again {when(m.nextAttemptAt)}.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No messages yet.</p>
      )}
    </section>
  );
};

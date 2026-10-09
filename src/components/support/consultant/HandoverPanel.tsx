import React, { useState } from 'react';
import { CheckCircle2, Copy, Eye, EyeOff, KeyRound, Send } from 'lucide-react';
import type { HandoverInfo, HandoverStage } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { Dialog, ErrorBanner, inputCls, longDate } from '../../team-member/pipeline/shared';

export const HANDOVER_LABEL: Record<HandoverStage, string> = {
  CONSULTANT: 'With the Technical Consultant',
  DEPARTMENT_HEAD: 'With the Department Head',
  TEAM_LEAD: 'With the Team Lead',
  TEAM_MEMBER: 'With the Team Member'
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/** Where the verified customer is in the hand-over, shown to the consultant once it has left them. */
export const HandoverBanner: React.FC<{ info: HandoverInfo | null; audience?: 'consultant' | 'sales' }> = ({ info, audience = 'consultant' }) => {
  if (!info || info.stage === 'CONSULTANT') return null;
  const steps: { label: string; at: string | null; who: string | null }[] = [
    { label: 'Department Head', at: info.toDepartmentHeadAt, who: info.sentBy ? `sent by ${info.sentBy}` : null },
    { label: 'Team Lead', at: info.passedToTeamLeadAt, who: info.teamLead?.fullName ?? null },
    { label: 'Team Member', at: info.assignedToMemberAt, who: info.teamMember?.fullName ?? null }
  ];
  return (
    <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900" role="status">
      <p className="font-bold">{HANDOVER_LABEL[info.stage]}</p>
      <p className="mt-0.5 text-xs">
        {audience === 'sales'
          ? 'Verified by the Technical Consultant and handed over. The Department Head, Team Lead and Team Member continue from here.'
          : 'Verified and handed over. Your review is closed; the team continues from here.'}
      </p>
      <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {steps.map(s => (
          <li key={s.label} className={s.at ? 'font-semibold' : 'text-emerald-700/60'}>
            {s.at ? '✓ ' : '○ '}
            {s.label}
            {s.at ? ` · ${longDate(s.at)}` : ''}
            {s.at && s.who ? ` · ${s.who}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
};

/**
 * The client's panel login. The consultant enters the same e-mail and password
 * they set in the internal platform; the password goes to Supabase Auth only.
 */
export const ClientLoginCard: React.FC<{
  customerId: string;
  defaultEmail: string | null;
  account: HandoverInfo['clientAccount'] | undefined;
  locked: boolean;
  onChanged: () => void;
}> = ({ customerId, defaultEmail, account, locked, onChanged }) => {
  const [email, setEmail] = useState(defaultEmail || '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError('The password must be at least 10 characters.');
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.createClientAccount(customerId, { email: email.trim(), password });
      setJustCreated({ email: email.trim().toLowerCase(), password });
      setPassword('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(`${justCreated.email}\n${justCreated.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby="client-login-heading">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <KeyRound className="w-4 h-4" />
        </span>
        <div>
          <h2 id="client-login-heading" className="font-bold text-slate-900">
            Client panel login
          </h2>
          <p className="text-xs text-slate-500">The e-mail and password the client uses in the app. Use the same ones you set in the internal platform.</p>
        </div>
      </div>

      {account ? (
        <div className="mt-4 space-y-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Login created
          </p>
          <dl className="text-sm">
            <dt className="text-xs text-slate-500">E-mail</dt>
            <dd className="font-mono text-slate-900 break-all">{account.email}</dd>
            <dt className="text-xs text-slate-500 mt-2">Created</dt>
            <dd className="text-slate-800">{longDate(account.createdAt)}</dd>
          </dl>
          {justCreated && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2" role="status">
              <p className="font-semibold">Save the password now — it is not stored and cannot be shown again.</p>
              <p className="font-mono break-all">{justCreated.password}</p>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white font-bold">
                <Copy className="w-3.5 h-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy e-mail & password'}
              </button>
            </div>
          )}
        </div>
      ) : locked ? (
        <p className="mt-4 text-sm text-slate-500">The login can be created once the customer is back with you.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="client-login-email">
            Client e-mail (login)
            <input id="client-login-email" type="email" className={`${inputCls} mt-1`} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="client-login-password">
            Password (min. 10 characters)
            <div className="mt-1 flex gap-2">
              <div className="relative flex-1">
                <input
                  id="client-login-password"
                  type={show ? 'text' : 'password'}
                  className={`${inputCls} pr-10 font-mono`}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPassword(generatePassword());
                  setShow(true);
                }}
                className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 shrink-0"
              >
                Generate
              </button>
            </div>
          </label>
          {error && <ErrorBanner message={error} />}
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="w-full px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create client login'}
          </button>
        </form>
      )}
    </section>
  );
};

/** "Send to Department Head" with a confirmation. Enabled once everything is authorized and the client login exists. */
export const SendToDepartmentHead: React.FC<{
  customerId: string;
  businessName: string;
  ready: boolean;
  reason: string;
  onSent: () => void;
}> = ({ customerId, businessName, ready, reason, onSent }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.sendToDepartmentHead(customerId, note.trim() || null);
      setOpen(false);
      onSent();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={!ready}
        title={ready ? undefined : reason}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send className="w-4 h-4" aria-hidden="true" /> Send to Department Head
      </button>
      {!ready && <span className="sr-only">{reason}</span>}
      {open && (
        <Dialog
          title="Send to Department Head"
          description={`${businessName} is verified and its client login is ready. The Department Head passes it to a Team Lead, who assigns it to a Team Member. Your review closes once you send it.`}
          onClose={() => !busy && setOpen(false)}
        >
          <label className="block text-xs font-medium text-slate-600" htmlFor="handover-note">
            Note for the Department Head (optional)
          </label>
          <textarea id="handover-note" rows={2} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white">
              Cancel
            </button>
            <button type="button" onClick={send} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-40">
              {busy ? 'Sending…' : 'Yes, send'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};

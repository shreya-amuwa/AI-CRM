import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Send } from 'lucide-react';
import { ApiError, api } from '../../lib/api/client';

/**
 * "Client login" on the customer's page (the relationship manager, their Team Lead and Accounts; 20270212000100): whether the client has
 * chosen a password, the last set-password link and until when it works (24 hours), and "Send password link" for a client who missed
 * it or forgot their password. The database limits it to one every 2 minutes and 5 a day per customer.
 */
type Status = {
  hasLogin: boolean; email?: string; passwordSet?: boolean; passwordSetAt?: string | null; lastLinkSentAt?: string | null;
  linkExpiresAt?: string | null; sendsToday?: number; perDay?: number; canSend: boolean; nextSendAt?: string | null;
  /** No login yet: whether this person (the Support team member who looks after the customer) may create it, and the customer's e-mail. */
  canCreate?: boolean; suggestedEmail?: string | null;
};
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';

export const ClientLoginCard: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [loginEmail, setLoginEmail] = useState('');

  const load = useCallback(() => {
    api.get<Status>(`/customers/${customerId}/client-login`).then(
      st => { setStatus(st); setLoadError(false); },
      // not this person's customer to manage: no card; anything else (network, server): say so and offer a retry
      e => { if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setHidden(true); else setLoadError(true); });
  }, [customerId]);
  useEffect(() => { setStatus(null); setHidden(false); setLoadError(false); setNote(null); load(); }, [load]);
  useEffect(() => { if (status && !status.hasLogin) setLoginEmail(status.suggestedEmail ?? ''); }, [status]);

  if (hidden) return null; // not this person's customer to manage
  const send = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await api.post<{ sent: boolean; email: string; detail?: string }>(`/customers/${customerId}/client-password-email`);
      setNote(r.sent ? { ok: true, text: `Sent to ${r.email}. The link works once and for 24 hours.` } : { ok: false, text: r.detail || 'The e-mail could not be sent. Try again later.' });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'The link could not be sent.' });
    } finally {
      setBusy(false);
      load();
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await api.post<{ email: string; mail: 'SENT' | 'NOT_SENT'; detail?: string }>(`/customers/${customerId}/client-login`, { email: loginEmail.trim() || undefined });
      setNote(r.mail === 'SENT'
        ? { ok: true, text: `Login created for ${r.email}. The client was e-mailed a link to set their password (it works once, for 24 hours).` }
        : { ok: false, text: `Login created for ${r.email}, but the e-mail was not sent${r.detail ? ` (${r.detail})` : ''}. Use "Send password link" below.` });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'The login could not be created.' });
    } finally {
      setBusy(false);
      load();
    }
  };
  const expired = !!status?.linkExpiresAt && new Date(status.linkExpiresAt).getTime() < Date.now();
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" data-testid="client-login-card">
      <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-500" aria-hidden="true" /> Client login</h2>
      {!status && loadError ? (
        <p role="alert" className="text-xs text-rose-700">Could not load the client login. <button type="button" className="underline font-semibold" onClick={load}>Try again</button></p>
      ) : !status ? <p role="status" className="text-xs text-slate-500">Loading…</p>
        : !status.hasLogin ? (status.canCreate ? (
          <form onSubmit={e => void create(e)} className="space-y-2" data-testid="create-client-login">
            <p className="text-xs text-slate-600">No client login yet. Create it here: the client gets an e-mail to set their own password.</p>
            <label htmlFor={`cl-email-${customerId}`} className="block text-xs font-semibold text-slate-700">Login e-mail</label>
            <input id={`cl-email-${customerId}`} type="email" required maxLength={254} value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
              placeholder="client@example.com" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button type="submit" disabled={busy || !loginEmail.trim()}
              className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Creating…' : 'Create login'}
            </button>
            {note && <p role={note.ok ? 'status' : 'alert'} className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</p>}
          </form>
        ) : <p className="text-xs text-slate-600">No client login yet. Accounts creates it once the payment is verified.</p>)
        : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div><dt className="text-slate-400">Login e-mail</dt><dd className="font-semibold text-slate-800 mt-0.5 break-all">{status.email}</dd></div>
              <div><dt className="text-slate-400">Password</dt>
                <dd className={`font-semibold mt-0.5 ${status.passwordSet ? 'text-emerald-700' : 'text-amber-700'}`} data-testid="client-password-state">
                  {status.passwordSet ? `Set${status.passwordSetAt ? ` (${when(status.passwordSetAt)})` : ''}` : 'Not set yet'}</dd></div>
              <div><dt className="text-slate-400">Last link from the team</dt>
                <dd className="font-semibold text-slate-800 mt-0.5">{status.lastLinkSentAt ? when(status.lastLinkSentAt) : 'None in the last 24 hours'}</dd></div>
              <div><dt className="text-slate-400">Works until</dt>
                <dd className={`font-semibold mt-0.5 ${expired ? 'text-rose-700' : 'text-slate-800'}`}>{status.linkExpiresAt ? `${when(status.linkExpiresAt)}${expired ? ' (expired)' : ''}` : '-'}</dd></div>
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void send()} disabled={busy || !status.canSend} data-testid="send-client-link"
                className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : status.passwordSet ? 'Send password reset link' : 'Send password link'}
              </button>
              {!status.canSend && status.nextSendAt && (
                <span className="text-xs text-slate-500">Next link possible at {when(status.nextSendAt)} ({status.sendsToday}/{status.perDay} today)</span>
              )}
            </div>
            {note && <p role={note.ok ? 'status' : 'alert'} className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</p>}
          </>
        )}
    </div>
  );
};

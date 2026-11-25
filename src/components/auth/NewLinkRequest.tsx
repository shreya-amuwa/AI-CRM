import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api/client';
import { useBotCheck } from './useBotCheck';

/**
 * "Send me a new link": on an expired set-password / reset link (staff and clients). Asks the same endpoint as "Forgot password?", so
 * the answer is the same whatever the address, the same limits apply (a few per address per hour, per caller per quarter hour) and the
 * robot check when it is switched on.
 */
export const NewLinkRequest: React.FC<{ endpoint: '/auth/forgot-password' | '/client-auth/forgot-password'; hours?: number }> = ({ endpoint, hours = 24 }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const bot = useBotCheck('reset');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError('Enter the e-mail address you sign in with.'); return; }
    if (!bot.ready) { setError('Please complete the robot check first.'); return; }
    setBusy(true);
    try {
      await apiRequest<{ ok: true }>('POST', endpoint, { body: { email: value }, headers: bot.headers });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429
        ? 'Too many requests. Please wait a few minutes and try again.'
        : err instanceof Error ? err.message : 'The request could not be sent. Please try again.');
    } finally {
      bot.renew();
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" data-testid="new-link-sent" className="flex gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
        <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span>If <strong>{email.trim().toLowerCase()}</strong> has an account, a new link is on its way. It works once and for {hours} hours. Check your spam folder too.</span>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Send me a new link" data-testid="new-link-form">
      {error && <div role="alert" className="flex gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" /><span>{error}</span></div>}
      <label className="block text-xs font-semibold text-slate-700">
        Your e-mail address
        <div className="relative mt-1">
          <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" />
          <input type="email" autoComplete="username" inputMode="email" autoCapitalize="none" value={email} data-testid="new-link-email"
            onChange={e => { setEmail(e.target.value); setError(''); }}
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
      </label>
      {bot.element}
      <button type="submit" disabled={busy} data-testid="new-link-submit" className="w-full min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
        {busy ? 'Sending…' : 'Send me a new link'}
      </button>
    </form>
  );
};

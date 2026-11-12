import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api/client';

/**
 * "Forgot password?" on the staff sign-in page. The server answers the same way whatever the address (so nobody can find out who works
 * here) and e-mails a one-time link only to an active employee's account. The link opens /set-password, where they choose a new password.
 */
export const StaffForgotPassword: React.FC<{ initialEmail?: string; onBack: () => void }> = ({ initialEmail = '', onBack }) => {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError('Enter a valid e-mail address.'); return; }
    setBusy(true);
    try {
      await apiRequest<{ ok: true }>('POST', '/auth/forgot-password', { body: { email: value } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429
        ? 'Too many requests. Please wait a few minutes and try again.'
        : err instanceof Error ? err.message : 'The request could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="staff-forgot">
      <h2 className="text-base font-bold text-slate-900">Forgot your password?</h2>
      {sent ? (
        <div role="status" className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>If <strong>{email.trim().toLowerCase()}</strong> belongs to an active Amuwa CRM account, we have sent it a link to choose a new password. The link works once and for a limited time. Check your spam folder too. Not received in a few minutes? Ask HR or your Department Head.</span>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-2 space-y-3" aria-label="Reset your password">
          <p className="text-xs text-slate-600">Enter the e-mail address you sign in with. We will send you a link to choose a new password.</p>
          {error && (
            <div role="alert" className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{error}</span>
            </div>
          )}
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider font-mono">
            Email address
            <div className="relative mt-1">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="email" autoComplete="username" inputMode="email" autoCapitalize="none" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="name@amuwa.com" data-testid="forgot-email"
                className="w-full pl-10 pr-4 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs normal-case font-sans tracking-normal font-normal focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15" />
            </div>
          </label>
          <button type="submit" disabled={busy} data-testid="forgot-submit"
            className="w-full py-2.5 px-4 rounded-xl disabled:opacity-60 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs">
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <button type="button" onClick={onBack} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to sign in
      </button>
    </div>
  );
};

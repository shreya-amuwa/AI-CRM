import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api/client';
import { getSupabase } from '../../services/supabaseClient';
import { NewLinkRequest } from './NewLinkRequest';

/**
 * /set-password: opened from the welcome e-mail a new employee receives. The link carries a one-time token (/set-password?token_hash=...&type=recovery).
 * Nothing is verified when the page opens (an e-mail scanner that only opens the link cannot use the token up): it is exchanged for a session
 * when the employee saves their password. The same page serves "Forgot password?" (?purpose=reset): only the wording differs. The server puts the password on the sign-in, so only the employee knows it, and then they continue
 * to the dashboard their role belongs to. No password is ever sent in the e-mail, shown to HR or stored by the CRM.
 */
export const StaffSetPassword: React.FC = () => {
  const tokenHash = useRef<string | null>(new URLSearchParams(window.location.search).get('token_hash'));
  // "Forgot password?" (the staff sign-in page) or the welcome e-mail of a new employee
  const reset = useRef(new URLSearchParams(window.location.search).get('purpose') === 'reset').current;
  const [state, setState] = useState<'ready' | 'expired' | 'done'>(tokenHash.current ? 'ready' : 'expired');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 10) { setError('Use at least 10 characters.'); return; }
    if (password.length > 72) { setError('Use at most 72 characters.'); return; }
    if (password !== confirm) { setError('The two passwords are not the same.'); return; }
    const supabase = getSupabase();
    if (!supabase || !tokenHash.current) { setState('expired'); return; }
    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash.current, type: 'recovery' });
    if (verifyError) { setBusy(false); setState('expired'); return; }
    tokenHash.current = null; // the token is used up; from here the sign-in it made carries the request
    window.history.replaceState(null, '', reset ? '/set-password?purpose=reset' : '/set-password');
    try {
      await apiRequest<{ changed: true }>('POST', '/me/password', { body: { password } });
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.status === 401 ? 'This link has expired. Refresh the page to ask for a new one.' : err instanceof Error ? err.message : 'The password could not be saved. Please try again.');
      return;
    }
    setBusy(false);
    setState('done');
  };

  const input = 'w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 p-7 space-y-5">
        <div className="flex items-center gap-3">
          <img src="/amuwa-logo.png" alt="Amuwa Corporation" className="h-11 w-11 object-contain" />
          <span className="font-extrabold text-slate-900">Amuwa Corporation</span>
        </div>
        {state === 'expired' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">This link has expired</h1>
            <div role="alert" className="flex gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{reset
                ? 'A reset link works once and for 24 hours. Enter your e-mail address below and we will send you a new one.'
                : 'A set-password link works once and for 24 hours. Enter your work e-mail address below and we will send you a new one (or ask HR). If you already chose your password, sign in instead.'}</span>
            </div>
            <NewLinkRequest endpoint="/auth/forgot-password" />
            <a href="/" className="inline-flex text-sm font-bold text-blue-700 underline">Go to sign in</a>
          </>
        )}
        {state === 'ready' && (
          <form onSubmit={submit} noValidate className="space-y-4" aria-label="Set your password">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{reset ? 'Choose a new password' : 'Welcome! Set your password'}</h1>
              <p className="text-sm text-slate-600 mt-1">{reset
                ? 'Choose the new password for your Amuwa CRM account. Only you will know it; your old password stops working.'
                : 'Choose the password you will use to sign in to the Amuwa CRM. Only you will know it. It is required before you can sign in.'}</p>
            </div>
            {error && <div role="alert" className="flex gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" /><span>{error}</span></div>}
            <label className="block text-xs font-semibold text-slate-700">
              New password <span className="font-normal text-slate-500">(at least 10 characters)</span>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" />
                <input className={input} type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-2 p-1.5 text-slate-500">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Type it again
              <div className="relative mt-1">
                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" />
                <input className={input} type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>
            </label>
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Saving...' : 'Save password and continue'}</button>
          </form>
        )}
        {state === 'done' && (
          <>
            <div role="status" className="flex gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{reset ? 'Your new password is saved. Use it from now on to sign in.' : 'Your password is saved. From now on sign in with your login e-mail and this password.'}</span>
            </div>
            <button type="button" onClick={() => window.location.assign('/')} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">Open my dashboard</button>
          </>
        )}
      </div>
    </div>
  );
};

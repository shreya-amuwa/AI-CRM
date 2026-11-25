import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { ApiError } from '../lib/api/client';
import { clientApi } from './api';
import { Button, Field, LoadingBlock } from './ui';
import { dashboardPath } from './shell';
import { NewLinkRequest } from '../components/auth/NewLinkRequest';

/**
 * /client/set-password: opened from the "Set your password" e-mail (new login or "Forgot password?").
 * The link signs the client in for this one step; they choose their own password here.
 */
export const SetPassword: React.FC<{ forced?: boolean; onChanged?: () => void }> = ({ forced = false, onChanged }) => {
  const [state, setState] = useState<'checking' | 'ready' | 'expired' | 'done'>(forced ? 'ready' : 'checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The e-mail link is /client/set-password?token_hash=...&type=recovery. Nothing is verified when the page opens (an e-mail scanner
  // that only opens the link cannot use the one-time token up): it is exchanged for a session when the client saves their password.
  const tokenHash = useRef<string | null>(forced ? null : new URLSearchParams(window.location.search).get('token_hash'));

  useEffect(() => {
    if (forced) return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const supabase = getSupabase();
    if (hash.get('error') || !supabase) { setState('expired'); return; }
    if (tokenHash.current) { setState('ready'); return; }
    // an older link: the Supabase client reads the link's sign-in from the address bar while it starts
    supabase.auth.getSession().then(({ data }) => setState(data.session ? 'ready' : 'expired'), () => setState('expired'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 10) { setError('Use at least 10 characters.'); return; }
    if (password.length > 72) { setError('Use at most 72 characters.'); return; }
    if (password !== confirm) { setError('The two passwords are not the same.'); return; }
    setBusy(true);
    if (tokenHash.current) {
      const supabase = getSupabase();
      const { error: verifyError } = supabase ? await supabase.auth.verifyOtp({ token_hash: tokenHash.current, type: 'recovery' }) : { error: new Error('no client') };
      if (verifyError) { setBusy(false); setState('expired'); return; }
      tokenHash.current = null; // the token is used up; from here the sign-in it made carries the request
      window.history.replaceState(null, '', '/client/set-password');
    }
    // the server puts the password on the sign-in (so a temporary one cannot be kept) and records that the client has chosen their own
    try {
      await clientApi.changePassword(password);
    } catch (e) {
      setBusy(false);
      const message = e instanceof Error ? e.message : '';
      setError(e instanceof ApiError && e.status === 401 ? 'The link has expired. Use "Forgot password?" on the sign-in page to get a new one.' : message || 'The password could not be saved. Please try again.');
      return;
    }
    setBusy(false);
    if (forced) { onChanged?.(); return; }
    window.history.replaceState(null, '', '/client/set-password');
    setState('done');
  };

  return (
    <div className="cd-login" style={{ gridTemplateColumns: '1fr' }}>
      <div className="cd-login-form">
        <div className="cd-login-card">
          <span style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: 14, padding: 6, display: 'inline-flex' }}><img src="/amuwa-logo.png" alt="Amuwa" style={{ height: 40, width: 40, objectFit: 'contain' }} /></span>
          {state === 'checking' && <LoadingBlock rows={2} />}
          {state === 'expired' && (
            <>
              <h2 style={{ fontSize: 26 }}>This link has expired</h2>
              <div className="cd-banner danger" role="alert"><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} /><span>A set-password link works once and for 24 hours. Enter your login e-mail below and we will send you a new one, or ask your Relationship Manager.</span></div>
              <NewLinkRequest endpoint="/client-auth/forgot-password" />
              <button type="button" className="cd-link" style={{ alignSelf: 'center' }} onClick={() => window.location.assign('/client/login')}>Go to sign in</button>
            </>
          )}
          {state === 'ready' && (
            <>
            <form onSubmit={submit} noValidate className="cd-stack" style={{ gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 26 }}>{forced ? 'Choose your own password' : 'Set your password'}</h2>
                <p className="cd-sub">{forced
                  ? 'You signed in with a temporary password. Choose the password you will use from now on - the temporary one stops working. Only you will know it.'
                  : 'Choose the password you will use to sign in to your Amuwa dashboard. Only you will know it.'}</p>
              </div>
              {error && <div className="cd-banner danger" role="alert"><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
              <Field label="New password" htmlFor="cd-new-password" hint="At least 10 characters.">
                <div style={{ position: 'relative' }}>
                  <Lock size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--placeholder)' }} />
                  <input id="cd-new-password" className="cd-input" style={{ paddingLeft: 42, paddingRight: 46 }} type={show ? 'text' : 'password'} autoComplete="new-password"
                    value={password} onChange={e => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 6, top: 4, width: 40, height: 40, border: 0, background: 'transparent', color: 'var(--muted)' }}>
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              <Field label="Type it again" htmlFor="cd-confirm-password">
                <input id="cd-confirm-password" className="cd-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
              </Field>
              <Button type="submit" loading={busy}>Save password</Button>
            </form>
            {!forced && <button type="button" className="cd-link" style={{ alignSelf: 'center' }} data-testid="link-expired" onClick={() => setState('expired')}>Link expired? Send me a new one</button>}
            </>
          )}
          {state === 'done' && (
            <>
              <div className="cd-banner info" role="status"><CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 1 }} /><span>Your password is saved. From now on, sign in with your login e-mail and this password.</span></div>
              <Button onClick={() => window.location.assign(dashboardPath('overview'))}>Open my dashboard</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

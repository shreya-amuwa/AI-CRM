import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientProfile } from '../../shared/contracts';
import { ApiError } from '../lib/api/client';
import { getSupabase } from '../services/supabaseClient';
import { clientApi } from './api';

/**
 * The client's own sign-in. Independent of the staff AuthProvider (which is never mounted on /client):
 * the customer signs in with the e-mail and password the Technical Consultant set in the Client Panel (Supabase Auth),
 * and the server maps that login to their customer record. Staff logins are refused here.
 */
type Status = 'loading' | 'signedOut' | 'ready';
interface ClientAuth {
  status: Status;
  me: ClientProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Reads the profile again (after the client chose their own password in place of a temporary one). */
  refreshMe: () => Promise<void>;
  /** Shown on the login page after a forced sign-out ("session expired"). */
  notice: string;
  clearNotice: () => void;
}
const Ctx = createContext<ClientAuth | null>(null);

export const useClientAuth = (): ClientAuth => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientAuth must be used inside ClientAuthProvider');
  return v;
};

export const ClientAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<ClientProfile | null>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);

  const forceSignOut = useCallback(async (message: string) => {
    try { await getSupabase()?.auth.signOut(); } catch { /* ignore */ }
    if (!mounted.current) return;
    setMe(null);
    setNotice(message);
    setStatus('signedOut');
  }, []);

  // Restore a saved session (a refresh keeps the client signed in).
  useEffect(() => {
    mounted.current = true;
    const supabase = getSupabase();
    if (!supabase) { setStatus('signedOut'); setNotice('The app is not connected to its database yet. Please contact Amuwa.'); return; }
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { if (mounted.current) setStatus('signedOut'); return; }
      try {
        const profile = await clientApi.me();
        if (!mounted.current) return;
        setMe(profile); setStatus('ready');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NETWORK_ERROR') { setNotice(e.message); setStatus('signedOut'); return; }
        await forceSignOut(e instanceof ApiError && e.status === 403 ? 'This sign-in is not a client account. Staff sign in on the main CRM page.' : '');
      }
    })();
    const onUnauthenticated = () => { void forceSignOut('Your session has expired. Please sign in again.'); };
    window.addEventListener('crm:unauthenticated', onUnauthenticated);
    return () => { mounted.current = false; window.removeEventListener('crm:unauthenticated', onUnauthenticated); };
  }, [forceSignOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('The app is not connected to its database yet. Please contact Amuwa.');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (error.status === 429 || /too many|rate limit/i.test(error.message)) throw new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
      if (error.status === 400 || error.status === 401 || error.code === 'invalid_credentials' || /invalid/i.test(error.message)) throw new Error('The e-mail or password is not correct.');
      if (/fetch|network/i.test(error.message)) throw new Error('Cannot reach the server. Check your connection and try again.');
      throw new Error(error.message);
    }
    try {
      const profile = await clientApi.me();
      setMe(profile); setNotice(''); setStatus('ready');
    } catch (e) {
      await supabase.auth.signOut();
      if (e instanceof ApiError && e.status === 403) throw new Error('This sign-in is not a client account. Staff sign in on the main CRM page.');
      if (e instanceof ApiError && e.code === 'NETWORK_ERROR') throw new Error(e.message);
      throw new Error('We could not open your dashboard. Please try again, or contact your Amuwa consultant.');
    }
  }, []);

  const signOut = useCallback(async () => {
    try { await getSupabase()?.auth.signOut(); } catch { /* ignore */ }
    setMe(null); setNotice(''); setStatus('signedOut');
  }, []);

  const refreshMe = useCallback(async () => {
    try { setMe(await clientApi.me()); } catch { /* the next screen shows its own error; the session is still valid */ }
  }, []);

  const value = useMemo(() => ({ status, me, signIn, signOut, refreshMe, notice, clearNotice: () => setNotice('') }), [status, me, signIn, signOut, refreshMe, notice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

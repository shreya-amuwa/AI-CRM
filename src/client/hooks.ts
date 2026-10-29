import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';
import { ApiError, errorMessage } from '../lib/api/client';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string;
  /** The server said this client may not see it (permission denied / not theirs). */
  forbidden: boolean;
  /** The request reached the server but it failed on its side (5xx) or the server could not be reached. */
  unavailable: boolean;
  reload: () => void;
}

/** Load once (and again on reload()). Stale responses are ignored. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(() => {
    const id = ++run.current;
    setLoading(true); setError(''); setForbidden(false); setUnavailable(false);
    fnRef.current().then(
      d => { if (id === run.current) { setData(d); setLoading(false); } },
      e => {
        if (id !== run.current) return;
        setError(errorMessage(e));
        setForbidden(e instanceof ApiError && (e.status === 403 || e.status === 404));
        setUnavailable(!(e instanceof ApiError) || e.status === 0 || e.status >= 500);
        setLoading(false);
      }
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { run.current++; }; }, deps);
  return { data, loading, error, forbidden, unavailable, reload: load };
}

/** Minimal path router for /client/*. */
export function usePath(): [string, (to: string, replace?: boolean) => void] {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, '') || '/');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, '') || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState({}, '', to); else window.history.pushState({}, '', to);
    setPath(to.split('?')[0].replace(/\/+$/, '') || '/');
    window.scrollTo({ top: 0 });
  }, []);
  return [path, go];
}

/**
 * Live updates without a timer: calls onChange when a new notification for this client arrives (Supabase Realtime;
 * the database only lets a client read their own rows) and when the tab comes back into view.
 */
export function useClientLive(onChange: () => void, entityId?: string, enabled = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!enabled) return undefined;
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    };
    const channel = supabase
      ?.channel(`client-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_notifications' }, payload => {
        const row = payload.new as { entity_id?: string | null } | undefined;
        if (!entityId || row?.entity_id === entityId) fire();
      })
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && fire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [entityId, enabled]);
}

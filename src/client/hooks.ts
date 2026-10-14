import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '../lib/api/client';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string;
  /** The server said this client may not see it (permission denied / not theirs). */
  forbidden: boolean;
  reload: () => void;
}

/** Load once (and again on reload()). Stale responses are ignored. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(() => {
    const id = ++run.current;
    setLoading(true); setError(''); setForbidden(false);
    fnRef.current().then(
      d => { if (id === run.current) { setData(d); setLoading(false); } },
      e => {
        if (id !== run.current) return;
        setError(errorMessage(e));
        setForbidden(e instanceof ApiError && (e.status === 403 || e.status === 404));
        setLoading(false);
      }
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { run.current++; }; }, deps);
  return { data, loading, error, forbidden, reload: load };
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

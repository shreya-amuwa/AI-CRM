import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Confirm you are not a robot" (Cloudflare Turnstile) on the CRM's public forms: staff and client "Forgot password" and "Send me a new
 * link". Shown only when VITE_TURNSTILE_SITE_KEY is set (docs/PASSWORD_LINKS.md); without it nothing is shown or sent and the server's
 * TURNSTILE_CRM_MODE must stay off. Most people see a small box that ticks itself; a suspicious visitor gets a challenge.
 * Each token works once, so the box is renewed after every request.
 */
type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile | null> | null = null;
function loadTurnstile(): Promise<Turnstile | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(s);
  });
  return loading;
}

export const botCheckSiteKey = (): string => (import.meta.env?.VITE_TURNSTILE_SITE_KEY ?? '').trim();

export function useBotCheck(action: 'reset') {
  const siteKey = botCheckSiteKey();
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    void loadTurnstile().then(t => {
      if (gone || !box.current) return;
      if (!t) { setFailed(true); return; }
      widget.current = t.render(box.current, {
        sitekey: siteKey, action,
        callback: (v: string) => { setToken(v); setFailed(false); },
        'expired-callback': () => setToken(null),
        'error-callback': () => { setToken(null); setFailed(true); }
      });
    });
    return () => {
      gone = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  /** After a request: a token works once. */
  const renew = useCallback(() => {
    setToken(null);
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, []);

  const required = !!siteKey;
  return {
    /** Ready to send: no robot check configured, or it was passed. */
    ready: !required || !!token,
    headers: (token ? { 'x-turnstile-token': token } : {}) as Record<string, string>,
    renew,
    element: required ? (
      <div className="space-y-1" data-testid="bot-check">
        <div ref={box} />
        {failed && <p role="alert" className="text-xs text-rose-700">The robot check could not load. Check your connection and refresh the page.</p>}
      </div>
    ) : null
  };
}

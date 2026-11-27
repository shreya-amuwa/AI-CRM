import { postToParent } from './bridge';

/**
 * Installed before any CRM module loads (boot.ts). The frame's origin is opaque, so the browser already refuses it the Managing Director's
 * storage, cookies, IndexedDB and service worker, and the Content-Security-Policy (connect-src 'none') refuses every network request.
 * These guards make that refusal CLEAR instead of a crash:
 *  - localStorage / sessionStorage become in-memory stores that live only as long as this preview (remembered pages, filters, drafts);
 *  - IndexedDB and the service worker read as "not available" (no push registration, no offline cache, no chat keys);
 *  - fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon fail immediately and tell Dashboard Explorer what was attempted.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const blocked = (what: string) => {
  postToParent({ type: 'crm-preview:unavailable', what: `network: ${what}`.slice(0, 300) });
  return new TypeError(`Dashboard preview: ${what} is not available. The preview never contacts the live CRM.`);
};

export function installGuards(): void {
  const define = (target: object, key: string, value: unknown) => {
    try { Object.defineProperty(target, key, { value, configurable: true, writable: true }); } catch { /* already a plain value */ }
  };
  define(window, 'localStorage', new MemoryStorage());
  define(window, 'sessionStorage', new MemoryStorage());
  define(window, 'indexedDB', undefined);
  // removed, not just emptied: pages test `'serviceWorker' in navigator` / `'PushManager' in window` and then show push as "not supported"
  // (no misleading "notifications are blocked" banner, no registration attempt)
  for (const [target, key] of [[Navigator.prototype, 'serviceWorker'], [window, 'PushManager'], [window, 'Notification']] as const) {
    try { delete (target as unknown as Record<string, unknown>)[key]; } catch { /* not configurable */ }
    if (key in target) define(target, key, undefined);
  }
  define(window, 'fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.reject(blocked(`fetch ${url}`));
  });
  define(navigator, 'sendBeacon', () => { blocked('sendBeacon'); return false; });
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource'] as const) {
    define(window, name, function Blocked() { throw blocked(name); });
  }
}

/**
 * The CRM's service worker (public/sw.js): attendance reminders only, it caches nothing. Registered once for signed-in staff (the
 * dashboard shell), never on the client or candidate portals. Returns null where the browser has no service workers.
 */
let registering: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registering ??= navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
  return registering;
}

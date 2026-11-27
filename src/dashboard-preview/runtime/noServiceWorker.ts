/** Replaces src/lib/push/registerServiceWorker.ts in the preview bundle: the preview never installs a service worker or registers push. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  return Promise.resolve(null);
}

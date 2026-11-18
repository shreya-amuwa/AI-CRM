/*
 * Amuwa CRM service worker: attendance reminders only (docs/ATTENDANCE_PUNCH.md, "Reminders and the app").
 * It shows the reminders the server pushes and opens the Attendance page when one is tapped. It deliberately has NO fetch handler and
 * caches nothing: every page and API call goes to the network exactly as without it, so it can never serve an old version of the CRM.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Amuwa CRM', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Amuwa CRM';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'amuwa-crm',
    renotify: true,                       // the follow-up replaces the first reminder and still alerts
    icon: '/icons/icon-192.png',
    badge: '/favicon-192.png',
    data: { url: data.url || '/?open=attendance' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/?open=attendance', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'open-attendance' });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// The browser replaced the subscription (new address and keys): tell the CRM so the same person keeps getting their reminders.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    if (!old) return;
    const fresh = event.newSubscription || await self.registration.pushManager.subscribe(old.options);
    const json = fresh.toJSON();
    await fetch('/api/v1/attendance/push-resubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldEndpoint: old.endpoint, endpoint: json.endpoint, keys: json.keys })
    });
  })());
});

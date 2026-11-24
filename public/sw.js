/*
 * Amuwa CRM service worker: attendance reminders and chat messages (docs/ATTENDANCE_PUNCH.md, docs/CHAT.md "Push notifications").
 * It shows what the server pushes and, when one is tapped, opens Attendance or that chat conversation. It deliberately has NO fetch handler and
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
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'amuwa-crm',
      renotify: true,                     // the follow-up replaces the first reminder and still alerts
      silent: false,                      // an alert: the device's own notification sound and Do Not Disturb rules apply
      timestamp: Date.now(),
      icon: '/icons/icon-192.png',
      badge: '/favicon-192.png',
      data: { url: data.url || '/?open=attendance' }
    });
    // an open CRM window reads its notifications again at once (in case its live connection is asleep)
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) w.postMessage({ type: 'push-received' });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/?open=attendance', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      // a chat message opens its conversation; a reminder opens Attendance
      const q = new URL(url).searchParams;
      if (q.get('open') === 'notice') {
        // a company notice (20270131000200) opens that notice on the Notice Board
        open.postMessage({ type: 'open-notice', id: q.get('id') });
      } else if (q.get('open') === 'chat') {
        open.postMessage(q.get('client') ? { type: 'open-chat', clientConversationId: q.get('client') } : { type: 'open-chat', conversationId: q.get('conversation') });
      } else {
        open.postMessage({ type: 'open-attendance', view: q.get('view') || 'mine' });
      }
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

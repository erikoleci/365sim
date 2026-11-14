// Service worker for Web Push notifications ONLY: no caching, no fetch handling, so it can never serve a stale page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || '365sim', {
    body: d.body || '',
    tag: d.tag || 'support',
    renotify: true,
    data: { url: d.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: Boolean(d.important),
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

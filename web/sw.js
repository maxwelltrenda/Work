// Service worker: only shows push notifications (no offline caching).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Inventory', {
    body: d.body || '',
    tag: d.tag,
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  // Stay on this app's own address.
  const target = url.origin === self.location.origin ? url.href : self.location.origin + '/' + url.hash;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    for (const c of list) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.navigate(target); } catch { /* not controlled yet */ }
      return c.focus();
    }
    return self.clients.openWindow(target);
  }));
});

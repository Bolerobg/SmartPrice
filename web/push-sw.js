/* 🔔 Service worker за Web Push на SmartPrice.
   Показва известието и при клик отваря приложението на правилния екран. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'SmartPrice', body: (event.data && event.data.text()) || '' }; }
  var title = data.title || 'SmartPrice';
  var options = {
    body: data.body || '',
    tag: data.tag || 'smartprice',
    renotify: false,
    icon: '/favicon.ico',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { if ('navigate' in c) { c.navigate(url); } return c.focus(); }
      }
      if (self.clients.openWindow) { return self.clients.openWindow(url); }
    })
  );
});

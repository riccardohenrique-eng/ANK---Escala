// Service worker do Escala ANK — só o mínimo pra tornar o app instalável (PWA) e
// receber notificações Web Push nativas do navegador (sem serviço terceiro).
// Sem cache de assets de propósito: o app já sincroniza dados via /api/state,
// cache agressivo aqui só criaria risco de mostrar escala desatualizada.

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// Handler de fetch vazio (passthrough) — presença dele é um dos critérios que os
// navegadores checam pra considerar o site instalável como PWA.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'Escala ANK', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Escala ANK';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.registration.scope) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

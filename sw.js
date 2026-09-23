// Service worker do Escala ANK — só o mínimo pra tornar o app instalável (PWA),
// sem notificações push (removidas em 2026-09-22 — a equipe não usa o app, o dono
// só compartilha a escala pronta por WhatsApp).
// Sem cache de assets de propósito: o app já sincroniza dados via /api/state,
// cache agressivo aqui só criaria risco de mostrar escala desatualizada.

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// Handler de fetch vazio (passthrough) — presença dele é um dos critérios que os
// navegadores checam pra considerar o site instalável como PWA.
self.addEventListener('fetch', () => {});

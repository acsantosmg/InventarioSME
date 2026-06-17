const CACHE_VERSION = 'inventario-v17';
const urlsToCache = [
  './', './index.html', './manifest.json', './css/style.css',
  './js/app.js', './js/db.js', './js/utils.js', './js/sync.js',
  './config.js'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // ativa imediatamente, sem esperar o tab fechar
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.filter(cn => cn !== CACHE_VERSION).map(cn => caches.delete(cn))
    ))
  );
  self.clients.claim(); // assume controle de todas as abas abertas imediatamente
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request).catch(() => {
      if (event.request.mode === 'navigate') return caches.match('./index.html');
    }))
  );
});

// Notifica todas as abas abertas quando uma nova versão estiver ativa
self.addEventListener('activate', event => {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
  });
});

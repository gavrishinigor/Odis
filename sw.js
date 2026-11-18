// Service worker ODIS: кэш оболочки приложения для работы без сети.
// Запросы к API (другие адреса) НЕ кэшируются и не трогаются.
const VERSION = '0.1.0'; // держать равным js/version.js (проверяется тестом)
const CACHE = `odis-shell-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/settings.js',
  'js/howto.js',
  'js/voice.js',
  'js/version.js',
  'js/core/assistant.js',
  'js/core/brain.js',
  'js/core/dates.js',
  'js/core/rules.js',
  'js/core/store.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('odis-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API провайдера и прочее — мимо кэша

  // Страница: сначала сеть (чтобы обновления приходили), без сети — из кэша.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Файлы оболочки: из кэша сразу, в фоне — обновление.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || net;
    }),
  );
});

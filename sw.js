/* ============================================================================
   Work Hub — service worker.

   Стратегія (важливо для встановленого на телефон застосунку):
   - HTML/навігація → network-first: спершу мережа, кеш лише як запас офлайн.
     Тому нова версія сторінки приходить одразу, як є інтернет.
   - Інші свої файли (JS/CSS/іконки) → stale-while-revalidate: віддаємо з кешу
     миттєво (швидко + працює офлайн) і паралельно тягнемо свіжу версію в кеш.
   - Разом із перезавантаженням у app.js це дає автоматичне оновлення
     застосунку без жодних дій з боку користувача.
   ========================================================================== */

const VERSION = 'v10';
const CACHE = `work-hub-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './assets/css/styles.css',
  './assets/js/store.js',
  './assets/js/app.js',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // не валимо встановлення, якщо якийсь файл раптом недоступний
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Дозволяє сторінці попросити воркер активуватися негайно
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function isNavigation(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // чужі домени не торкаємось

  // --- HTML: спершу мережа, офлайн — з кешу ---
  if (isNavigation(req)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // --- Решта: віддаємо з кешу і одразу освіжаємо його з мережі ---
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached); // офлайн — лишаємо, що є

      return cached || fresh;
    })
  );
});

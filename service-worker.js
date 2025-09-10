/* Memory Cue — Service Worker (improved, CORS-safe for Apps Script)
   Strategy:
   - HTML navigations: network-first with offline fallback to /index.html
   - Static assets (JS/CSS/icons/images): stale-while-revalidate
   - Google Fonts: runtime caching
   - Safe updates: skipWaiting + clients.claim + nav preload (when supported)
   NOTE: v22 bump to force clients to update; bypass script.google.com so requests are untouched.
*/

const VERSION = 'v22';
const APP_CACHE = `memory-cue-app-${VERSION}`;
const STATIC_CACHE = `memory-cue-static-${VERSION}`;
const FONTS_CACHE = `memory-cue-fonts-${VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

// ---- Install: pre-cache app shell (bypass HTTP cache to ensure fresh install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then(async (cache) => {
      await cache.addAll(
        PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' }))
      );
    })
  );
  self.skipWaiting();
});

// ---- Activate: cleanup old caches + enable navigation preload
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![APP_CACHE, STATIC_CACHE, FONTS_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

// Optional: allow page to trigger skipWaiting immediately after an update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---- Fetch: route by request type
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass Apps Script requests entirely (avoid caching / potential header mutation).
  if (url.hostname === 'script.google.com') {
    return; // allow default browser handling
  }

  // 1) HTML navigations → network-first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // If nav preload is available, it returns a fresh response quickly
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;

        const net = await fetch(req);
        // Cache a copy of the latest index for offline use
        const cache = await caches.open(APP_CACHE);
        cache.put('./index.html', net.clone());
        return net;
      } catch {
        // Offline fallback to cached index.html
        const cached = await caches.match('./index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) Google Fonts (stylesheet & files) → runtime caching
  if (url.origin.includes('fonts.googleapis.com')) {
    // Stylesheets: SWR
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }
  if (url.origin.includes('fonts.gstatic.com')) {
    // Font files: cache-first (they’re immutable)
    event.respondWith(cacheFirst(req, FONTS_CACHE));
    return;
  }

  // 3) Same-origin static assets (icons, images, css, js) → SWR
  if (url.origin === self.location.origin &&
      (/
        .(?:js|css|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname) ||
        url.pathname.startsWith('/icons/')
      )) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // 4) Default: try cache, then network (very safe fallback)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

// ---- Helpers: caching strategies
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((res) => {
    // Only cache valid (basic/opaques ok for fonts css) 200 responses
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => undefined);

  // Return cached immediately if present; otherwise wait for network
  return cached || networkPromise || new Response('Offline', { status: 503 });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
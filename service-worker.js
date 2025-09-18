/* service-worker.js
 *
 * Memory Cue — robust SW with:
 * - No regex pitfalls (uses pathname.endsWith for extensions)
 * - Cache versioning & cleanup
 * - Precache minimal app shell
 * - Network-first (with timeout) for navigations + offline fallback
 * - Stale-while-revalidate for static assets
 * - Explicit bypass for Apps Script domain
 *
 * UPDATE APP_PATH if your site path is different.
 */

'use strict';

const APP_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '/') || '/';
const CACHE_PREFIX = 'mc-static-';
const CACHE_VERSION = 'v9'; // bump this to force clients to update
const RUNTIME_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const TAILWIND_CDN = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';

const SHELL_URLS = [
  `${APP_PATH}index.html`,
  `${APP_PATH}mobile.html`,
  `${APP_PATH}manifest.webmanifest`,
  // Add your real icons below if present; missing files are skipped.
  `${APP_PATH}icons/icon-192.svg`,
  `${APP_PATH}icons/icon-512.svg`,
  TAILWIND_CDN,
];

// File extensions treated as static assets for SWR caching
const STATIC_EXTS = [
  '.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.json', '.webmanifest'
];

// Domains we never want to intercept (bypass to network)
const BYPASS_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
  'script.google.com'
]);

self.addEventListener('install', (event) => {
  // Activate this SW immediately on install
  self.skipWaiting();

  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);

    // Precache shell, but don’t fail the whole install if one URL 404s.
    await Promise.allSettled(
      SHELL_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res && res.ok) {
            await cache.put(url, res.clone());
          }
        } catch (_) {
          // ignore missing/failed entries
        }
      })
    );
  })());
});

self.addEventListener('activate', (event) => {
  // Become active immediately on clients
  event.waitUntil((async () => {
    // Clean up old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Always bypass certain hosts (Apps Script, etc.)
  if (BYPASS_HOSTS.has(url.hostname)) {
    event.respondWith(fetch(req));
    return; // Let the browser handle it (goes to network)
  }

  // Handle same-origin navigations with network-first + timeout, fallback to offline shell
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstWithTimeout(req, 4500, `${APP_PATH}index.html`));
    return;
  }

  // Only consider same-origin requests for runtime caching to avoid opaque responses
  const isSameOrigin = url.origin === self.location.origin;

  // Use SWR for static assets (by extension check), same-origin only
  if (isSameOrigin && isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // For everything else, just pass-through to network (and fall back to cache if available)
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ---------- Helpers ----------

function isStaticAsset(pathname) {
  // Safe extension check (no regex parsing issues)
  return STATIC_EXTS.some((ext) => pathname.endsWith(ext));
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);

  // Return cached immediately if present; otherwise use network
  return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Gateway Timeout' });
}

async function networkFirstWithTimeout(req, timeoutMs, offlineFallbackUrl) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(req, { signal: controller.signal });
    clearTimeout(t);
    if (res && res.ok) return res;

    // Non-ok -> try cache fallback for offline shell on navigations
    const cached = await caches.match(offlineFallbackUrl, { ignoreSearch: true });
    if (cached) return cached;

    // As a last resort, return the original (even if non-ok) to surface correct status
    return res;
  } catch (_) {
    clearTimeout(t);
    // On timeout or network error, serve cached offline shell if we have it
    const cached = await caches.match(offlineFallbackUrl, { ignoreSearch: true });
    if (cached) return cached;

    // Fallback to any cached version of the request
    const alt = await caches.match(req);
    if (alt) return alt;

    // Final hard failure
    return new Response('Offline and no cached content available.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); }
  catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Memory Cue Reminder';
  const options = { body: data.body || '', data };
  event.waitUntil(self.registration.showNotification(title, options));
});

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
const CACHE_VERSION = 'v14'; // bump this to force clients to update
const RUNTIME_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

const REMINDER_DB_NAME = 'memory-cue-reminders';
const REMINDER_DB_VERSION = 1;
const REMINDER_STORE_NAME = 'scheduled';
const REMINDER_PERIODIC_SYNC_TAG = 'memory-cue-reminder-sync';
const DEFAULT_REMINDER_CATEGORY = 'General';
const DEFAULT_REMINDER_URL_PATH = 'mobile.html';

let reminderDbPromise = null;

const SHELL_URLS = [
  `${APP_PATH}index.html`,
  `${APP_PATH}mobile.html`,
  `${APP_PATH}manifest.webmanifest`,
  `${APP_PATH}styles/tokens.css`,
  `${APP_PATH}styles/a11y.css`,
  // Add your real icons below if present; missing files are skipped.
  `${APP_PATH}icons/icon-192.svg`,
  `${APP_PATH}icons/icon-512.svg`,
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

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Only handle http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Always bypass certain hosts (Apps Script, etc.)
  if (BYPASS_HOSTS.has(url.hostname)) {
    // Ensure we handle network failures gracefully even for bypassed hosts
    event.respondWith(
      fetch(req).catch(async () => {
        // Try to return a cached matching request as a fallback
        const cached = await caches.match(req);
        if (cached) return cached;
        // Final fallback: return a generic offline response
        return new Response('Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return; // Let the service worker provide a graceful fallback
  }

  // Handle same-origin navigations with network-first + timeout, fallback to offline shell
  if (req.mode === 'navigate') {
    const fallbacks = getNavigationFallbacks(url.pathname);
    event.respondWith(networkFirstWithTimeout(req, 4500, fallbacks));
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
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (e) {
        // Try cache match first
        try {
          const cached = await caches.match(req);
          if (cached) return cached;
        } catch (_) {
          /* ignore cache lookup errors */
        }
        // Final fallback: return a generic offline response so respondWith always resolves to a Response
        return new Response('Offline and no cached response', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

// ---------- Helpers ----------

function isStaticAsset(pathname) {
  // Safe extension check (no regex parsing issues)
  return STATIC_EXTS.some((ext) => pathname.endsWith(ext));
}

async function staleWhileRevalidate(req) {
  if (req.method !== 'GET') {
    return fetch(req);
  }

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

function getNavigationFallbacks(pathname) {
  const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const fallbacks = [`${APP_PATH}index.html`];
  if (normalizedPath.endsWith('mobile') || normalizedPath.endsWith('mobile.html')) {
    fallbacks.unshift(`${APP_PATH}mobile.html`);
  }
  return [...new Set(fallbacks)];
}

async function networkFirstWithTimeout(req, timeoutMs, offlineFallbackUrls) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const fallbacks = Array.isArray(offlineFallbackUrls)
    ? offlineFallbackUrls.filter(Boolean)
    : offlineFallbackUrls
    ? [offlineFallbackUrls]
    : [];

  try {
    const res = await fetch(req, { signal: controller.signal });
    clearTimeout(t);
    if (res && res.ok) return res;

    // Non-ok -> try cache fallback for offline shell on navigations
    const cached = await matchFirstAvailable(fallbacks);
    if (cached) return cached;

    // As a last resort, return the original (even if non-ok) to surface correct status
    return res;
  } catch (_) {
    clearTimeout(t);
    // On timeout or network error, serve cached offline shell if we have it
    const cached = await matchFirstAvailable(fallbacks);
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

async function matchFirstAvailable(fallbackUrls) {
  for (const url of fallbackUrls) {
    try {
      const cached = await caches.match(url, { ignoreSearch: true });
      if (cached) return cached;
    } catch (_) {
      // ignore lookup errors
    }
  }
  return null;
}

function getReminderDb() {
  if (!('indexedDB' in self)) {
    return Promise.resolve(null);
  }
  if (!reminderDbPromise) {
    reminderDbPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(REMINDER_DB_NAME, REMINDER_DB_VERSION);
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            if (!db.objectStoreNames.contains(REMINDER_STORE_NAME)) {
              db.createObjectStore(REMINDER_STORE_NAME, { keyPath: 'id' });
            }
          } catch (error) {
            reject(error);
          }
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error || new Error('IndexedDB open failed'));
        };
        request.onblocked = () => {
          // Another context is holding the database open; wait for it.
        };
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      console.warn('Failed to open reminder database', error);
      reminderDbPromise = null;
      return null;
    });
  }
  return reminderDbPromise;
}

function idbRequestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function sanitizeReminderEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.id) {
    return null;
  }
  const sanitized = {
    id: entry.id,
    title: typeof entry.title === 'string' ? entry.title : 'Reminder',
    body: typeof entry.body === 'string' && entry.body ? entry.body : 'Due now',
    due: typeof entry.due === 'string' ? entry.due : null,
    priority: entry.priority || 'Medium',
    category:
      typeof entry.category === 'string' && entry.category.trim()
        ? entry.category.trim()
        : DEFAULT_REMINDER_CATEGORY,
    notes: typeof entry.notes === 'string' ? entry.notes : '',
    urlPath:
      typeof entry.urlPath === 'string' && entry.urlPath
        ? entry.urlPath
        : DEFAULT_REMINDER_URL_PATH,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
    notifiedAt: Number.isFinite(entry.notifiedAt) ? entry.notifiedAt : null,
  };
  if (sanitized.due) {
    const dueTime = Date.parse(sanitized.due);
    sanitized.dueTime = Number.isFinite(dueTime) ? dueTime : null;
  } else {
    sanitized.dueTime = null;
  }
  return sanitized;
}

async function writeScheduledReminders(reminders = []) {
  try {
    const db = await getReminderDb();
    if (!db) {
      return;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const done = waitForTransaction(tx);
    await idbRequestToPromise(store.clear());
    for (const entry of reminders) {
      const sanitized = sanitizeReminderEntry(entry);
      if (sanitized) {
        await idbRequestToPromise(store.put(sanitized));
      }
    }
    await done;
  } catch (error) {
    console.warn('Failed to persist reminder schedule', error);
  }
}

async function readScheduledReminders() {
  try {
    const db = await getReminderDb();
    if (!db) {
      return [];
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readonly');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const request = store.getAll();
    const results = await idbRequestToPromise(request).catch(() => []);
    await waitForTransaction(tx).catch(() => undefined);
    return Array.isArray(results)
      ? results
          .map(sanitizeReminderEntry)
          .filter(Boolean)
      : [];
  } catch (error) {
    console.warn('Failed to read scheduled reminders', error);
    return [];
  }
}

async function checkAndNotifyDueReminders({ source = 'unknown' } = {}) {
  if (!self.registration || typeof self.registration.showNotification !== 'function') {
    return;
  }
  const reminders = await readScheduledReminders();
  if (!reminders.length) {
    return;
  }
  const now = Date.now();
  let changed = false;
  for (const reminder of reminders) {
    if (!reminder || !reminder.id) {
      continue;
    }
    const dueTime = Number.isFinite(reminder.dueTime)
      ? reminder.dueTime
      : (reminder.due ? Date.parse(reminder.due) : NaN);
    if (!Number.isFinite(dueTime) || dueTime > now) {
      continue;
    }
    const alreadyNotified = Number.isFinite(reminder.notifiedAt)
      ? reminder.notifiedAt
      : null;
    if (alreadyNotified && alreadyNotified >= dueTime) {
      continue;
    }
    const options = {
      body: reminder.body || 'Due now',
      tag: reminder.id,
      renotify: true,
      data: {
        id: reminder.id,
        due: reminder.due,
        priority: reminder.priority,
        category: reminder.category,
        body: reminder.body || 'Due now',
        urlPath: reminder.urlPath,
        source,
      },
    };
    try {
      await self.registration.showNotification(reminder.title || 'Reminder', options);
      reminder.notifiedAt = now;
      changed = true;
    } catch (error) {
      console.warn('Failed to display reminder notification', error);
    }
  }
  if (changed) {
    await writeScheduledReminders(reminders);
  }
}

self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.type === 'memoryCue:updateScheduledReminders') {
    const reminders = Array.isArray(data.reminders) ? data.reminders : [];
    event.waitUntil(writeScheduledReminders(reminders));
    return;
  }
  if (data.type === 'memoryCue:checkScheduledReminders') {
    event.waitUntil(checkAndNotifyDueReminders({ source: 'message' }));
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === REMINDER_PERIODIC_SYNC_TAG) {
    event.waitUntil(checkAndNotifyDueReminders({ source: 'periodic-sync' }));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === REMINDER_PERIODIC_SYNC_TAG) {
    event.waitUntil(checkAndNotifyDueReminders({ source: 'background-sync' }));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); }
  catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Memory Cue Reminder';
  const options = { body: data.body || '', data };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const destination = (() => {
    try {
      return data.urlPath ? new URL(data.urlPath, self.registration.scope).href : self.registration.scope;
    } catch (_) {
      return self.registration.scope;
    }
  })();
  event.waitUntil((async () => {
    try {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      let matching = null;
      const targetUrl = new URL(destination);
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname === targetUrl.pathname) {
            matching = client;
            break;
          }
        } catch (_) {
          // ignore bad URLs
        }
      }
      if (matching) {
        await matching.focus();
        if (targetUrl.hash && matching.navigate) {
          try { await matching.navigate(destination); } catch (_) { /* ignore navigate failure */ }
        }
        return;
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(destination);
      }
    } catch (_) {
      if (self.clients && self.clients.openWindow) {
        try { await self.clients.openWindow(destination); } catch (_) { /* ignore */ }
      }
    }
  })());
});

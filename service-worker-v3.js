/* service-worker-v3.js
 *
 * Memory Cue service worker refresh:
 * - New filename to break stale CDN/browser caches
 * - New cache version
 * - Network-first for navigations and HTML
 * - Stale-while-revalidate for static app assets
 * - Existing reminder notification persistence retained
 */

'use strict';

const APP_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '/') || '/';
const CACHE_NAME = 'memory-cue-v3';
const RUNTIME_CACHE = CACHE_NAME;
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const REMINDER_DB_NAME = 'memory-cue-reminders';
const REMINDER_DB_VERSION = 1;
const REMINDER_STORE_NAME = 'scheduled';
const REMINDER_PERIODIC_SYNC_TAG = 'memory-cue-reminder-sync';
const DEFAULT_REMINDER_CATEGORY = 'General';
const DEFAULT_REMINDER_URL_PATH = 'mobile.html';

let reminderDbPromise = null;

const SHELL_URLS = [
  `${APP_PATH}`,
  `${APP_PATH}mobile.html`,
  `${APP_PATH}manifest.webmanifest`,
  `${APP_PATH}styles/index.css`,
  `${APP_PATH}icons/icon-192.svg`,
  `${APP_PATH}icons/icon-512.svg`,
];

const BYPASS_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
  'script.google.com',
]);

self.addEventListener('install', (event) => {
  // We no longer call skipWaiting() immediately here.
  // This allows the UI to prompt the user to refresh, prevent data loss.

  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);

    await Promise.allSettled(
      SHELL_URLS.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (response?.ok) {
            await cache.put(url, response.clone());
          }
        } catch (_) {
          // Ignore install-time asset failures so the worker can still activate.
        }
      })
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  const request = event.request;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  if (BYPASS_HOSTS.has(url.hostname)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return;
  }

  if (shouldUseNetworkFirst(request, url)) {
    event.respondWith(networkFirst(request, getNavigationFallbacks(url.pathname)));
    return;
  }

  if (shouldUseStaleWhileRevalidate(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        return new Response('Offline and no cached response', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

function shouldUseNetworkFirst(request, url) {
  if (request.mode === 'navigate') {
    return true;
  }

  if (url.origin !== self.location.origin) {
    return false;
  }

  const relativePath = getRelativePath(url.pathname);
  return relativePath === 'index.html' || relativePath === 'mobile.html' || relativePath.endsWith('.html');
}

function shouldUseStaleWhileRevalidate(request, url) {
  if (url.origin !== self.location.origin) {
    return false;
  }

  const relativePath = getRelativePath(url.pathname);
  return (
    relativePath.startsWith('css/') ||
    relativePath.startsWith('styles/') ||
    relativePath.startsWith('js/') ||
    relativePath.startsWith('icons/') ||
    relativePath === 'manifest.webmanifest' ||
    relativePath.endsWith('.css') ||
    relativePath.endsWith('.js')
  );
}

function getRelativePath(pathname) {
  const appRoot = APP_PATH.endsWith('/') ? APP_PATH : `${APP_PATH}/`;
  return pathname.startsWith(appRoot) ? pathname.slice(appRoot.length) : pathname.replace(/^\//, '');
}

async function networkFirst(request, fallbackUrls = []) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (response?.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (_) {
        // Ignore cache write failures and keep the network response.
      }
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) {
      return cached;
    }

    const fallback = await matchFirstAvailable(fallbackUrls);
    if (fallback) {
      return fallback;
    }

    return new Response('Offline and no cached content available.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response?.ok) {
        try {
          await cache.put(request, response.clone());
        } catch (_) {
          // Ignore cache write failures and still return the live response.
        }
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    eventWaitUntil(networkPromise);
    return cached;
  }

  const response = await networkPromise;
  if (response) {
    return response;
  }

  return new Response('Offline and no cached content available.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function eventWaitUntil(promise) {
  try {
    self.registration?.active;
  } catch (_) {
    // No-op. This helper keeps call sites simple when no event object is available.
  }
  return promise;
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getNavigationFallbacks(pathname) {
  const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const fallbacks = [`${APP_PATH}mobile.html`];
  return [...new Set(fallbacks)];
}

async function matchFirstAvailable(fallbackUrls) {
  for (const url of fallbackUrls) {
    try {
      const cached = await caches.match(url, { ignoreSearch: true });
      if (cached) return cached;
    } catch (_) {
      // Ignore cache lookup errors.
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
          // Ignore malformed client URLs.
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

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
const CACHE_NAME = 'memory-cue-v2';
const RUNTIME_CACHE = CACHE_NAME;

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

  return event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);

    // Precache shell, but don’t fail the whole install if one URL 404s.
    await Promise.allSettled(
      SHELL_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
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
  return event.waitUntil((async () => {
    // Clean up old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // DO NOT intercept API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    return;
  }

  const req = event.request;

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

  if (shouldUseCacheFirst(req, url)) {
    event.respondWith(cacheFirst(req, getNavigationFallbacks(url.pathname)));
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

function shouldUseCacheFirst(req, url) {
  const requestMethod = req.method || 'GET';
  if (requestMethod !== 'GET') {
    return false;
  }
  if (url.origin !== self.location.origin) {
    return false;
  }

  const path = url.pathname;
  const appRoot = APP_PATH.endsWith('/') ? APP_PATH : `${APP_PATH}/`;
  const relativePath = path.startsWith(appRoot) ? path.slice(appRoot.length) : path.replace(/^\//, '');

  if (req.mode === 'navigate') {
    return true;
  }

  return (
    relativePath === 'index.html' ||
    relativePath === 'mobile.html' ||
    relativePath.startsWith('css/') ||
    relativePath.startsWith('styles/') ||
    relativePath.startsWith('js/') ||
    relativePath.startsWith('icons/') ||
    relativePath === 'manifest.webmanifest' ||
    relativePath.endsWith('.css') ||
    relativePath.endsWith('.js')
  );
}

async function cacheFirst(req, fallbackUrls = []) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(req);
    if (response && response.ok) {
      try {
        await cache.put(req, response.clone());
      } catch (_) {
        // Ignore cache write failures and still return the live response.
      }
    }
    return response;
  } catch (error) {
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
    viaTrigger: entry.viaTrigger === true,
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

async function upsertScheduledReminder(entry) {
  try {
    const db = await getReminderDb();
    if (!db) {
      return;
    }
    const sanitized = sanitizeReminderEntry(entry);
    if (!sanitized) {
      return;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const done = waitForTransaction(tx);
    await idbRequestToPromise(store.put(sanitized));
    await done;
  } catch (error) {
    console.warn('Failed to upsert scheduled reminder', error);
  }
}

async function deleteScheduledReminder(id) {
  if (!id) {
    return;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const done = waitForTransaction(tx);
    await idbRequestToPromise(store.delete(id));
    await done;
  } catch (error) {
    console.warn('Failed to delete scheduled reminder', error);
  }
}

function supportsTimestampTriggerScheduling() {
  return typeof self.TimestampTrigger === 'function'
    && !!self.registration
    && typeof self.registration.showNotification === 'function';
}

async function scheduleTriggeredReminder(reminder) {
  if (!supportsTimestampTriggerScheduling()) {
    return false;
  }
  const dueTime = Number.isFinite(reminder?.dueTime)
    ? reminder.dueTime
    : (reminder?.due ? Date.parse(reminder.due) : NaN);
  if (!Number.isFinite(dueTime) || dueTime <= Date.now()) {
    return false;
  }
  try {
    await self.registration.showNotification(reminder.title || 'Reminder', {
      body: reminder.body || 'Due now',
      tag: reminder.id,
      data: {
        id: reminder.id,
        due: reminder.due,
        priority: reminder.priority,
        category: reminder.category,
        body: reminder.body || 'Due now',
        urlPath: reminder.urlPath,
        source: 'push-sync',
      },
      renotify: true,
      showTrigger: new self.TimestampTrigger(dueTime),
    });
    return true;
  } catch (error) {
    console.warn('Failed to schedule trigger reminder from push', error);
    return false;
  }
}

function buildReminderBodyFromPush(reminder) {
  const notes = typeof reminder?.notes === 'string' ? reminder.notes.trim() : '';
  return notes || 'Due now';
}

function buildScheduledReminderFromPush(reminder = {}) {
  if (!reminder || typeof reminder !== 'object') {
    return null;
  }
  const reminderId = typeof reminder.id === 'string' ? reminder.id.trim() : '';
  if (!reminderId) {
    return null;
  }
  const due = typeof reminder.snoozedUntil === 'string' && reminder.snoozedUntil
    ? reminder.snoozedUntil
    : (typeof reminder.due === 'string' ? reminder.due : null);
  return sanitizeReminderEntry({
    id: reminderId,
    title: typeof reminder.title === 'string' && reminder.title ? reminder.title : 'Reminder',
    body: buildReminderBodyFromPush(reminder),
    due,
    priority: typeof reminder.priority === 'string' && reminder.priority ? reminder.priority : 'Medium',
    category:
      typeof reminder.category === 'string' && reminder.category.trim()
        ? reminder.category.trim()
        : DEFAULT_REMINDER_CATEGORY,
    notes: typeof reminder.notes === 'string' ? reminder.notes : '',
    urlPath:
      typeof reminder.urlPath === 'string' && reminder.urlPath
        ? reminder.urlPath
        : DEFAULT_REMINDER_URL_PATH,
    updatedAt: Number.isFinite(Number(reminder.updatedAt)) ? Number(reminder.updatedAt) : Date.now(),
    notifiedAt: null,
  });
}

async function handleReminderSyncPush(data = {}) {
  const action = typeof data.action === 'string' && data.action.trim() === 'delete'
    ? 'delete'
    : 'upsert';
  const reminderPayload = (() => {
    if (typeof data.reminder === 'string' && data.reminder.trim()) {
      try {
        return JSON.parse(data.reminder);
      } catch {
        return null;
      }
    }
    if (data.reminder && typeof data.reminder === 'object') {
      return data.reminder;
    }
    return null;
  })();
  const reminderId = typeof reminderPayload?.id === 'string' ? reminderPayload.id.trim() : '';
  if (!reminderId) {
    return;
  }
  if (action === 'delete') {
    await deleteScheduledReminder(reminderId);
    return;
  }
  const scheduledReminder = buildScheduledReminderFromPush(reminderPayload);
  if (!scheduledReminder) {
    return;
  }
  const viaTrigger = await scheduleTriggeredReminder(scheduledReminder);
  await upsertScheduledReminder({
    ...scheduledReminder,
    viaTrigger,
  });
  if (!viaTrigger) {
    await checkAndNotifyDueReminders({ source: 'push-sync' });
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
    if (reminder.viaTrigger === true) {
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
  if (data?.type === 'memoryCue:reminder-sync') {
    event.waitUntil(handleReminderSyncPush(data));
    return;
  }
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

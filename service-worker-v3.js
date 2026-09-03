/* service-worker-v3.js
 *
 * Memory Cue service worker refresh:
 * - New filename to break stale CDN/browser caches
 * - New cache version
 * - Network-first for navigations and HTML
 * - Stale-while-revalidate for static app assets
 * - Existing reminder notification persistence retained
 * - Typed urgent reminders, actions, and app badges supported
 */

'use strict';

const APP_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '/') || '/';
const CACHE_NAME = 'memory-cue-v6';
const RUNTIME_CACHE = CACHE_NAME;
const NAVIGATION_TIMEOUT_MS = 4000;
const SERVICE_WORKER_RELEASE = new URL(self.location.href).searchParams.get('v') || '';
const IMMEDIATE_ACTIVATION_RELEASE = '20260904a';

const SHOW_URGENT_REMINDER_MESSAGE_TYPE = 'memoryCue:showUrgentReminder';
const UPDATE_URGENT_BADGE_MESSAGE_TYPE = 'memoryCue:updateUrgentBadge';
const URGENT_ACTION_MESSAGE_TYPE = 'memoryCue:urgentAction';
const REQUEST_PENDING_URGENT_ACTIONS_MESSAGE_TYPE = 'memoryCue:requestPendingUrgentActions';
const URGENT_ACTION_COMPLETED_MESSAGE_TYPE = 'memoryCue:urgentActionCompleted';
const CANCEL_SCHEDULED_REMINDER_MESSAGE_TYPE = 'memoryCue:cancelScheduledReminder';
const REMINDER_SYNC_PUSH_TYPE = 'memoryCue:reminder-sync';
const URGENT_NOTIFICATION_DATA_TYPE = 'memoryCue:urgentReminder';
const URGENT_NOTIFICATION_ACTIONS = Object.freeze([
  { action: 'acknowledge', title: 'Seen' },
  { action: 'snooze5', title: 'Snooze 5' },
  { action: 'start', title: 'Start / Join' },
  { action: 'done', title: 'Done' },
]);
const URGENT_ACTION_NAMES = new Set(
  URGENT_NOTIFICATION_ACTIONS.map(({ action }) => action)
);
const URGENT_ALERT_LEAD_MINUTES = Object.freeze([15, 5, 1]);
const URGENT_OVERDUE_INTERVAL_MINUTES = 5;
const MINUTE_MS = 60 * 1000;
const REMINDER_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const REMINDER_DB_NAME = 'memory-cue-reminders';
const REMINDER_DB_VERSION = 5;
const REMINDER_STORE_NAME = 'scheduled';
const REMINDER_META_STORE_NAME = 'metadata';
const ACTIVE_REMINDER_OWNER_META_KEY = 'activeReminderOwner';
const PROCESSED_URGENT_DELIVERY_STORE_NAME = 'processedUrgentDeliveries';
const URGENT_STAGE_CLAIM_STORE_NAME = 'urgentStageClaims';
const PENDING_URGENT_ACTION_STORE_NAME = 'pendingUrgentActions';
const PROCESSED_URGENT_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSED_URGENT_DELIVERY_LIMIT = 512;
const URGENT_STAGE_CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const URGENT_STAGE_CLAIM_PENDING_TIMEOUT_MS = 2 * MINUTE_MS;
const URGENT_STAGE_CLAIM_LIMIT = 1024;
const URGENT_STAGE_CLAIM_PRUNE_TARGET = 896;
const PENDING_URGENT_ACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_URGENT_ACTION_LIMIT = 256;
const URGENT_DELIVERY_ID_PATTERN = /^v[12]_[A-Za-z0-9_-]{43}$/;
const REMINDER_PERIODIC_SYNC_TAG = 'memory-cue-reminder-sync';
const DEFAULT_REMINDER_CATEGORY = 'General';
const DEFAULT_REMINDER_URL_PATH = 'mobile.html';

let reminderDbPromise = null;
const inFlightUrgentDeliveries = new Map();
const inFlightUrgentStages = new Map();
let urgentStageClaimSequence = 0;
let urgentActionSequence = 0;
let activeReminderOwnerState = {
  known: false,
  ownerUserId: '',
  notificationTriggersSupported: false,
};

const SHELL_URLS = [
  `${APP_PATH}`,
  `${APP_PATH}mobile.html`,
  `${APP_PATH}manifest.webmanifest`,
  `${APP_PATH}styles/index.css`,
  `${APP_PATH}icons/icon-192.png`,
  `${APP_PATH}icons/icon-512.png`,
  `${APP_PATH}icons/apple-touch-icon.png`,
  `${APP_PATH}icons/icon-192.svg`,
  `${APP_PATH}icons/icon-512.svg`,
];

const BYPASS_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
  'script.google.com',
]);

function parseObjectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_) {
    return null;
  }
}

function normalizeIncomingPayload(rawPayload) {
  const root = parseObjectValue(rawPayload) || {};
  const nestedData = parseObjectValue(root.data);
  const payload = nestedData ? { ...root, ...nestedData } : { ...root };

  const reminder = parseObjectValue(payload.reminder);
  if (reminder) {
    payload.reminder = reminder;
  }

  const stage = parseObjectValue(payload.stage);
  if (stage) {
    payload.stage = stage;
  }

  const notification = parseObjectValue(payload.notification);
  if (notification) {
    if (!payload.title && typeof notification.title === 'string') {
      payload.title = notification.title;
    }
    if (!payload.body && typeof notification.body === 'string') {
      payload.body = notification.body;
    }
  }

  return payload;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function normalizeBadgeCount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function normalizeUrgentDeliveryId(value) {
  const deliveryId = normalizeText(value);
  return URGENT_DELIVERY_ID_PATTERN.test(deliveryId) ? deliveryId : '';
}

async function applyUrgentBadge(rawCount) {
  const count = normalizeBadgeCount(rawCount);
  if (count === null || !self.navigator) {
    return false;
  }

  try {
    if (count === 0) {
      if (typeof self.navigator.clearAppBadge === 'function') {
        await self.navigator.clearAppBadge();
        return true;
      }
      if (typeof self.navigator.setAppBadge === 'function') {
        await self.navigator.setAppBadge(0);
        return true;
      }
      return false;
    }
    if (typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(count);
      return true;
    }
  } catch (error) {
    console.warn('Failed to update urgent reminder badge', error);
  }
  return false;
}

function parseTimestamp(value) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeUrgentReminderPayload(rawPayload) {
  const payload = normalizeIncomingPayload(rawPayload);
  const reminder = parseObjectValue(payload.reminder) || {};
  const stage = parseObjectValue(payload.stage) || {};
  const reminderId = normalizeText(reminder.id) || normalizeText(payload.reminderId);
  if (!reminderId) {
    return null;
  }

  const stageLabel = normalizeText(stage.label);
  const reminderBody = normalizeText(reminder.body) || normalizeText(payload.body);
  const bodyIncludesStage = stageLabel
    && reminderBody.toLocaleLowerCase().includes(stageLabel.toLocaleLowerCase());
  const bodyParts = [bodyIncludesStage ? '' : stageLabel, reminderBody].filter(
    (part, index, parts) => part && parts.indexOf(part) === index
  );
  const due = reminder.due ?? payload.due ?? stage.dueAt ?? null;
  const timestamp = parseTimestamp(stage.startAt)
    || parseTimestamp(stage.dueAt)
    || parseTimestamp(due);

  return {
    reminderId,
    ownerUserId:
      normalizeText(payload.ownerUserId)
      || normalizeText(payload.userId)
      || normalizeText(reminder.ownerUserId)
      || normalizeText(reminder.userId)
      || '',
    title: normalizeText(reminder.title) || normalizeText(payload.title) || 'Memory Cue Reminder',
    body: bodyParts.join(' — ') || 'Due now',
    due,
    meetingUrl: normalizeHttpUrl(reminder.meetingUrl) || normalizeHttpUrl(payload.meetingUrl),
    urlPath:
      normalizeText(reminder.urlPath)
      || normalizeText(payload.urlPath)
      || `${DEFAULT_REMINDER_URL_PATH}#reminders`,
    stageKey: normalizeText(stage.key) || normalizeText(payload.stageKey),
    stageKind: normalizeText(stage.kind),
    badgeCount: normalizeBadgeCount(payload.badgeCount),
    timestamp,
    updatedAt:
      parseTimestamp(reminder.updatedAt)
      ?? parseTimestamp(payload.updatedAt)
      ?? 0,
  };
}

function buildUrgentStageClaimId(urgent) {
  const reminderId = normalizeText(urgent?.reminderId);
  const ownerUserId = normalizeText(urgent?.ownerUserId);
  const stageKey = normalizeText(urgent?.stageKey);
  if (!reminderId || !stageKey) {
    return '';
  }
  const dueAt = parseTimestamp(urgent?.due);
  const dueIdentity = dueAt === null
    ? normalizeText(String(urgent?.due ?? '')) || 'unknown-due'
    : String(dueAt);
  const revisionIdentity = parseTimestamp(urgent?.updatedAt) ?? 'unknown-revision';
  return ownerUserId
    ? JSON.stringify([ownerUserId, reminderId, dueIdentity, stageKey, revisionIdentity])
    : JSON.stringify([reminderId, dueIdentity, stageKey, revisionIdentity]);
}

function buildUrgentNotificationTag(reminderId, ownerUserId = '') {
  const normalizedReminderId = normalizeText(reminderId);
  const normalizedOwnerUserId = normalizeText(ownerUserId);
  if (!normalizedOwnerUserId) {
    return `memory-cue-urgent-${normalizedReminderId}`;
  }
  return `memory-cue-urgent-${encodeURIComponent(normalizedOwnerUserId)}-${normalizedReminderId}`;
}

function createUrgentStageClaimToken(now = Date.now()) {
  urgentStageClaimSequence += 1;
  if (self.crypto && typeof self.crypto.randomUUID === 'function') {
    return self.crypto.randomUUID();
  }
  return `${now.toString(36)}-${urgentStageClaimSequence.toString(36)}`;
}

async function pruneUrgentStageClaims(now = Date.now(), preserveId = '') {
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(URGENT_STAGE_CLAIM_STORE_NAME, 'readwrite');
    const store = tx.objectStore(URGENT_STAGE_CLAIM_STORE_NAME);
    const done = waitForTransaction(tx);
    const records = await idbRequestToPromise(store.getAll());
    const retainedIds = new Set(
      (Array.isArray(records) ? records : [])
        .filter((record) => (
          record
          && typeof record.id === 'string'
          && Number.isFinite(record.expiresAt)
          && record.expiresAt > now
        ))
        .sort((left, right) => {
          if (left.id === preserveId) return -1;
          if (right.id === preserveId) return 1;
          return (right.completedAt || right.claimedAt || 0)
            - (left.completedAt || left.claimedAt || 0);
        })
        .slice(0, URGENT_STAGE_CLAIM_PRUNE_TARGET)
        .map((record) => record.id)
    );
    for (const record of Array.isArray(records) ? records : []) {
      if (record?.id && !retainedIds.has(record.id)) {
        await idbRequestToPromise(store.delete(record.id));
      }
    }
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to prune urgent reminder stage history', error);
    return false;
  }
}

async function claimUrgentStage(stageClaimId, now = Date.now()) {
  if (!stageClaimId) {
    return { status: 'untracked', token: '' };
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return { status: 'unavailable', token: '' };
    }
    const tx = db.transaction(URGENT_STAGE_CLAIM_STORE_NAME, 'readwrite');
    const store = tx.objectStore(URGENT_STAGE_CLAIM_STORE_NAME);
    const done = waitForTransaction(tx);
    const [current, recordCount] = await Promise.all([
      idbRequestToPromise(store.get(stageClaimId)),
      idbRequestToPromise(store.count()),
    ]);
    if (
      current?.status === 'shown'
      && Number.isFinite(current.expiresAt)
      && current.expiresAt > now
    ) {
      await done;
      return { status: 'shown', token: '' };
    }
    if (
      current?.status === 'pending'
      && Number.isFinite(current.claimedAt)
      && current.claimedAt > now - URGENT_STAGE_CLAIM_PENDING_TIMEOUT_MS
    ) {
      await done;
      return { status: 'pending', token: '' };
    }

    const token = createUrgentStageClaimToken(now);
    await idbRequestToPromise(store.put({
      id: stageClaimId,
      status: 'pending',
      token,
      claimedAt: now,
      expiresAt: now + URGENT_STAGE_CLAIM_PENDING_TIMEOUT_MS,
    }));
    await done;
    if (Number(recordCount) >= URGENT_STAGE_CLAIM_LIMIT) {
      await pruneUrgentStageClaims(now, stageClaimId);
    }
    return { status: 'claimed', token };
  } catch (error) {
    console.warn('Failed to claim urgent reminder stage', error);
    return { status: 'unavailable', token: '' };
  }
}

async function completeUrgentStageClaim(stageClaimId, token, now = Date.now()) {
  if (!stageClaimId || !token) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(URGENT_STAGE_CLAIM_STORE_NAME, 'readwrite');
    const store = tx.objectStore(URGENT_STAGE_CLAIM_STORE_NAME);
    const done = waitForTransaction(tx);
    const current = await idbRequestToPromise(store.get(stageClaimId));
    if (current?.status !== 'pending' || current.token !== token) {
      await done;
      return false;
    }
    await idbRequestToPromise(store.put({
      ...current,
      status: 'shown',
      token: '',
      completedAt: now,
      expiresAt: now + URGENT_STAGE_CLAIM_RETENTION_MS,
    }));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to complete urgent reminder stage claim', error);
    return false;
  }
}

async function releaseUrgentStageClaim(stageClaimId, token) {
  if (!stageClaimId || !token) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(URGENT_STAGE_CLAIM_STORE_NAME, 'readwrite');
    const store = tx.objectStore(URGENT_STAGE_CLAIM_STORE_NAME);
    const done = waitForTransaction(tx);
    const current = await idbRequestToPromise(store.get(stageClaimId));
    if (current?.status !== 'pending' || current.token !== token) {
      await done;
      return false;
    }
    await idbRequestToPromise(store.delete(stageClaimId));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to release urgent reminder stage claim', error);
    return false;
  }
}

async function runUrgentStageOnce(
  stageClaimId,
  operation,
  {
    claimStage = claimUrgentStage,
    completeStage = completeUrgentStageClaim,
    releaseStage = releaseUrgentStageClaim,
  } = {}
) {
  if (!stageClaimId || typeof operation !== 'function') {
    return typeof operation === 'function' ? operation() : false;
  }
  if (inFlightUrgentStages.has(stageClaimId)) {
    return inFlightUrgentStages.get(stageClaimId);
  }

  const stagePromise = (async () => {
    const claim = await claimStage(stageClaimId);
    if (claim?.status === 'shown') {
      return true;
    }
    // A surviving pending claim may belong to a worker that stopped before it
    // displayed anything. Keep the scheduled stage unmarked so it can retry
    // after the short pending timeout instead of being suppressed forever.
    if (claim?.status === 'pending') {
      return false;
    }
    const claimed = claim?.status === 'claimed' && Boolean(claim.token);
    let succeeded = false;
    try {
      succeeded = await operation() === true;
    } catch (error) {
      console.warn('Failed to display urgent reminder notification', error);
    }
    if (!succeeded) {
      if (claimed) {
        await releaseStage(stageClaimId, claim.token);
      }
      return false;
    }
    if (claimed) {
      await completeStage(stageClaimId, claim.token);
    }
    return true;
  })();
  inFlightUrgentStages.set(stageClaimId, stagePromise);
  try {
    return await stagePromise;
  } finally {
    if (inFlightUrgentStages.get(stageClaimId) === stagePromise) {
      inFlightUrgentStages.delete(stageClaimId);
    }
  }
}

async function displayUrgentReminder(urgent) {
  if (!urgent || !self.registration || typeof self.registration.showNotification !== 'function') {
    return false;
  }

  const options = {
    body: urgent.body,
    icon: `${APP_PATH}icons/icon-192.png`,
    badge: `${APP_PATH}icons/icon-192.png`,
    tag: buildUrgentNotificationTag(urgent.reminderId, urgent.ownerUserId),
    renotify: true,
    requireInteraction: true,
    silent: false,
    actions: URGENT_NOTIFICATION_ACTIONS.map((action) => ({ ...action })),
    data: {
      type: URGENT_NOTIFICATION_DATA_TYPE,
      reminderId: urgent.reminderId,
      ownerUserId: urgent.ownerUserId,
      stageKey: urgent.stageKey,
      stageKind: urgent.stageKind,
      due: urgent.due,
      meetingUrl: urgent.meetingUrl,
      urlPath: urgent.urlPath,
      badgeCount: urgent.badgeCount,
      updatedAt: urgent.updatedAt,
    },
  };
  if (Number.isFinite(urgent.timestamp)) {
    options.timestamp = urgent.timestamp;
  }

  try {
    await self.registration.showNotification(urgent.title, options);
    return true;
  } catch (error) {
    console.warn('Failed to display urgent reminder notification', error);
    return false;
  }
}

async function showUrgentReminder(rawPayload, stageClaimDependencies) {
  const urgent = sanitizeUrgentReminderPayload(rawPayload);
  if (!urgent) {
    return false;
  }
  if (!(await incomingReminderOwnerIsAllowed(urgent.ownerUserId))) {
    return true;
  }
  const pendingActions = await readPendingUrgentActions();
  if (shouldSuppressUrgentForPendingActions(urgent, pendingActions)) {
    const pendingIntent = applyPendingUrgentActionIntents({
      id: urgent.reminderId,
      ownerUserId: urgent.ownerUserId,
      updatedAt: urgent.updatedAt,
    }, pendingActions);
    if (pendingIntent?.deleted !== true && urgent.badgeCount !== null) {
      await applyUrgentBadge(urgent.badgeCount);
    } else {
      await recomputeScheduledUrgentBadge();
    }
    return true;
  }
  if (urgent.badgeCount !== null) {
    await applyUrgentBadge(urgent.badgeCount);
  }
  return runUrgentStageOnce(
    buildUrgentStageClaimId(urgent),
    async () => {
      // Ownership can change while pending actions and the durable stage claim
      // are being read. Recheck immediately before invoking showNotification
      // so an old account cannot surface after the switch cleanup has run.
      if (!(await incomingReminderOwnerIsAllowed(
        urgent.ownerUserId,
        { adoptIfUnknown: false }
      ))) {
        return false;
      }
      return displayUrgentReminder(urgent);
    },
    stageClaimDependencies
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Activate only this targeted notification repair immediately. Future releases
    // retain the normal wait-for-close behavior that protects in-progress page work.
    if (SERVICE_WORKER_RELEASE === IMMEDIATE_ACTIVATION_RELEASE) {
      await self.skipWaiting();
    }

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
            if (!db.objectStoreNames.contains(PROCESSED_URGENT_DELIVERY_STORE_NAME)) {
              db.createObjectStore(PROCESSED_URGENT_DELIVERY_STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(URGENT_STAGE_CLAIM_STORE_NAME)) {
              db.createObjectStore(URGENT_STAGE_CLAIM_STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(PENDING_URGENT_ACTION_STORE_NAME)) {
              db.createObjectStore(PENDING_URGENT_ACTION_STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(REMINDER_META_STORE_NAME)) {
              db.createObjectStore(REMINDER_META_STORE_NAME, { keyPath: 'key' });
            }
          } catch (error) {
            reject(error);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            reminderDbPromise = null;
          };
          resolve(db);
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

async function readReminderWorkerState() {
  if (activeReminderOwnerState.known) {
    return { ...activeReminderOwnerState };
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return { ...activeReminderOwnerState };
    }
    const tx = db.transaction(REMINDER_META_STORE_NAME, 'readonly');
    const record = await idbRequestToPromise(
      tx.objectStore(REMINDER_META_STORE_NAME).get(ACTIVE_REMINDER_OWNER_META_KEY)
    );
    await waitForTransaction(tx);
    if (record && record.key === ACTIVE_REMINDER_OWNER_META_KEY) {
      activeReminderOwnerState = {
        known: true,
        ownerUserId: normalizeText(record.ownerUserId),
        notificationTriggersSupported: record.notificationTriggersSupported === true,
      };
    }
  } catch (error) {
    console.warn('Failed to read reminder worker state', error);
  }
  return { ...activeReminderOwnerState };
}

async function writeReminderWorkerState({
  ownerUserId = '',
  notificationTriggersSupported = false,
} = {}) {
  const nextState = {
    known: true,
    ownerUserId: normalizeText(ownerUserId),
    notificationTriggersSupported: notificationTriggersSupported === true,
  };
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(REMINDER_META_STORE_NAME, 'readwrite');
    const done = waitForTransaction(tx);
    await idbRequestToPromise(tx.objectStore(REMINDER_META_STORE_NAME).put({
      key: ACTIVE_REMINDER_OWNER_META_KEY,
      ownerUserId: nextState.ownerUserId,
      notificationTriggersSupported: nextState.notificationTriggersSupported,
      updatedAt: Date.now(),
    }));
    await done;
    activeReminderOwnerState = nextState;
    return true;
  } catch (error) {
    console.warn('Failed to persist reminder worker state', error);
    return false;
  }
}

async function incomingReminderOwnerIsAllowed(ownerUserId, { adoptIfUnknown = true } = {}) {
  const incomingOwnerUserId = normalizeText(ownerUserId);
  const state = await readReminderWorkerState();
  if (!state.known) {
    if (!incomingOwnerUserId || !adoptIfUnknown) {
      return false;
    }
    return writeReminderWorkerState({
        ownerUserId: incomingOwnerUserId,
        notificationTriggersSupported: false,
      });
  }
  return state.ownerUserId === incomingOwnerUserId;
}

function normalizePendingUrgentAction(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const id = normalizeText(record.id);
  const action = normalizeText(record.action);
  const reminderId = normalizeText(record.reminderId);
  const createdAt = Number(record.createdAt);
  if (!id || !URGENT_ACTION_NAMES.has(action) || !reminderId || !Number.isFinite(createdAt)) {
    return null;
  }
  return {
    id,
    action,
    reminderId,
    ownerUserId: normalizeText(record.ownerUserId),
    stageKey: normalizeText(record.stageKey),
    meetingAlreadyOpened: record.meetingAlreadyOpened === true,
    createdAt,
    reminderUpdatedAt: parseTimestamp(record.reminderUpdatedAt),
  };
}

function createPendingUrgentAction({
  action,
  reminderId,
  ownerUserId,
  stageKey,
  meetingAlreadyOpened = false,
  reminderUpdatedAt = null,
}, now = Date.now()) {
  urgentActionSequence += 1;
  const randomId = self.crypto && typeof self.crypto.randomUUID === 'function'
    ? self.crypto.randomUUID()
    : `${now.toString(36)}-${urgentActionSequence.toString(36)}`;
  return normalizePendingUrgentAction({
    id: `urgent-action-${randomId}`,
    action,
    reminderId,
    ownerUserId,
    stageKey,
    meetingAlreadyOpened,
    reminderUpdatedAt,
    createdAt: now,
  });
}

async function savePendingUrgentAction(record) {
  const normalized = normalizePendingUrgentAction(record);
  if (!normalized) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(PENDING_URGENT_ACTION_STORE_NAME, 'readwrite');
    const done = waitForTransaction(tx);
    await idbRequestToPromise(tx.objectStore(PENDING_URGENT_ACTION_STORE_NAME).put(normalized));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to persist an urgent reminder action', error);
    return false;
  }
}

function selectRetainedPendingUrgentActions(records = [], now = Date.now()) {
  return (Array.isArray(records) ? records : [])
    .map(normalizePendingUrgentAction)
    .filter((record) => record && record.createdAt > now - PENDING_URGENT_ACTION_RETENTION_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function readPendingUrgentActions(now = Date.now()) {
  try {
    const db = await getReminderDb();
    if (!db) {
      return [];
    }
    const tx = db.transaction(PENDING_URGENT_ACTION_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PENDING_URGENT_ACTION_STORE_NAME);
    const done = waitForTransaction(tx);
    const records = await idbRequestToPromise(store.getAll());
    const normalizedRecords = selectRetainedPendingUrgentActions(records, now);
    const retainedIds = new Set(normalizedRecords.map((record) => record.id));
    for (const record of Array.isArray(records) ? records : []) {
      const recordId = normalizeText(record?.id);
      if (recordId && !retainedIds.has(recordId)) {
        await idbRequestToPromise(store.delete(recordId));
      }
    }
    await done;
    return normalizedRecords;
  } catch (error) {
    console.warn('Failed to read pending urgent reminder actions', error);
    return [];
  }
}

async function updatePendingUrgentActionMeetingOpened(actionId) {
  const normalizedActionId = normalizeText(actionId);
  if (!normalizedActionId) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(PENDING_URGENT_ACTION_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PENDING_URGENT_ACTION_STORE_NAME);
    const done = waitForTransaction(tx);
    const existing = normalizePendingUrgentAction(
      await idbRequestToPromise(store.get(normalizedActionId)).catch(() => null)
    );
    if (!existing) {
      await done;
      return false;
    }
    await idbRequestToPromise(store.put({
      ...existing,
      meetingAlreadyOpened: true,
    }));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to update a pending urgent reminder action', error);
    return false;
  }
}

async function deletePendingUrgentAction(actionId, ownerUserId = '') {
  const normalizedActionId = normalizeText(actionId);
  const normalizedOwnerUserId = normalizeText(ownerUserId);
  if (!normalizedActionId) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(PENDING_URGENT_ACTION_STORE_NAME, 'readwrite');
    const done = waitForTransaction(tx);
    const store = tx.objectStore(PENDING_URGENT_ACTION_STORE_NAME);
    const existing = normalizePendingUrgentAction(
      await idbRequestToPromise(store.get(normalizedActionId)).catch(() => null)
    );
    if (!existing || existing.ownerUserId !== normalizedOwnerUserId) {
      await done;
      return false;
    }
    await idbRequestToPromise(store.delete(normalizedActionId));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to complete a pending urgent reminder action', error);
    return false;
  }
}

function applyPendingUrgentActionIntent(entry, rawAction) {
  const action = normalizePendingUrgentAction(rawAction);
  const reminder = sanitizeReminderEntry(entry);
  if (!action || !reminder || reminder.id !== action.reminderId) {
    return reminder;
  }
  if (action.reminderUpdatedAt === null) {
    return reminder;
  }
  const reminderOwnerUserId = normalizeText(reminder.ownerUserId);
  if (
    action.ownerUserId !== reminderOwnerUserId
    && (action.ownerUserId || reminderOwnerUserId)
  ) {
    return reminder;
  }
  const reminderUpdatedAt = parseTimestamp(entry?.updatedAt) ?? 0;
  const actionReminderUpdatedAt = action.reminderUpdatedAt;
  if (reminderUpdatedAt > actionReminderUpdatedAt) {
    return reminder;
  }
  const actionAt = action.createdAt;
  const next = {
    ...reminder,
    // Keep updatedAt as the reminder revision the action was based on. The
    // click time is useful for the action fields below, but promoting it to a
    // reminder revision would let an old notification outrank a newer edit
    // received from another device.
    updatedAt: Math.max(Number(reminder.updatedAt || 0), actionReminderUpdatedAt),
  };
  if (action.action === 'done') {
    next.done = true;
    next.deleted = true;
    next.due = null;
    next.dueTime = null;
  } else if (action.action === 'snooze5') {
    next.snoozedUntil = new Date(actionAt + (5 * MINUTE_MS)).toISOString();
  } else if (action.action === 'start') {
    next.urgentStartedAt = Math.max(Number(next.urgentStartedAt || 0), actionAt);
    next.urgentAcknowledgedAt = Math.max(Number(next.urgentAcknowledgedAt || 0), actionAt);
  } else if (action.action === 'acknowledge') {
    next.urgentAcknowledgedAt = Math.max(Number(next.urgentAcknowledgedAt || 0), actionAt);
  }
  return sanitizeReminderEntry(next);
}

function applyPendingUrgentActionIntents(entry, actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .filter((action) => action?.reminderId === entry?.id)
    .sort((left, right) => Number(left?.createdAt || 0) - Number(right?.createdAt || 0))
    .reduce((current, action) => applyPendingUrgentActionIntent(current, action), entry);
}

function shouldSuppressUrgentForPendingActions(urgent, actions = [], now = Date.now()) {
  const urgentOwnerUserId = normalizeText(urgent?.ownerUserId);
  const urgentUpdatedAt = parseTimestamp(urgent?.updatedAt) ?? 0;
  const matchingActions = (Array.isArray(actions) ? actions : [])
    .map(normalizePendingUrgentAction)
    .filter((action) => (
      action?.reminderId === urgent?.reminderId
      && action.ownerUserId === urgentOwnerUserId
      && action.reminderUpdatedAt !== null
      && action.reminderUpdatedAt >= urgentUpdatedAt
    ));
  return matchingActions.some((action) => {
    if (action.action === 'done' || action.action === 'start') {
      return true;
    }
    if (action.action === 'snooze5') {
      return action.createdAt + (5 * MINUTE_MS) > now;
    }
    return action.action === 'acknowledge'
      && action.stageKey
      && action.stageKey === urgent?.stageKey;
  });
}

async function applyPendingUrgentActionToSchedule(rawAction) {
  const action = normalizePendingUrgentAction(rawAction);
  if (!action) {
    return false;
  }
  if (action.reminderUpdatedAt === null) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readonly');
    const existing = await idbRequestToPromise(
      tx.objectStore(REMINDER_STORE_NAME).get(action.reminderId)
    ).catch(() => null);
    await waitForTransaction(tx);
    if (!existing) {
      // The durable pending action already suppresses matching or older
      // reminder revisions. Do not invent a click-time tombstone here: it
      // could later hide a newer cross-device edit that predates the click.
      return true;
    }
    const existingOwnerUserId = normalizeText(existing.ownerUserId || existing.userId);
    if (
      action.ownerUserId !== existingOwnerUserId
      && (action.ownerUserId || existingOwnerUserId)
    ) {
      return false;
    }
    if (
      (parseTimestamp(existing.updatedAt) ?? 0) > action.reminderUpdatedAt
    ) {
      return false;
    }
    return upsertScheduledReminder(applyPendingUrgentActionIntent(existing, action), {
      enforceOwner: true,
      expectedOwnerUserId: action.ownerUserId,
    });
  } catch (error) {
    console.warn('Failed to apply an urgent reminder action locally', error);
    return false;
  }
}

async function wasUrgentDeliveryProcessed(deliveryId, now = Date.now()) {
  const normalizedDeliveryId = normalizeUrgentDeliveryId(deliveryId);
  if (!normalizedDeliveryId) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(PROCESSED_URGENT_DELIVERY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROCESSED_URGENT_DELIVERY_STORE_NAME);
    const done = waitForTransaction(tx);
    const record = await idbRequestToPromise(store.get(normalizedDeliveryId)).catch(() => null);
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      if (record) {
        await idbRequestToPromise(store.delete(normalizedDeliveryId));
      }
      await done;
      return false;
    }
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to check urgent reminder delivery history', error);
    return false;
  }
}

async function rememberProcessedUrgentDelivery(deliveryId, now = Date.now()) {
  const normalizedDeliveryId = normalizeUrgentDeliveryId(deliveryId);
  if (!normalizedDeliveryId) {
    return false;
  }
  try {
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    const tx = db.transaction(PROCESSED_URGENT_DELIVERY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROCESSED_URGENT_DELIVERY_STORE_NAME);
    const done = waitForTransaction(tx);
    const existingRecords = await idbRequestToPromise(store.getAll()).catch(() => []);
    const validRecords = (Array.isArray(existingRecords) ? existingRecords : [])
      .filter((record) => (
        record
        && normalizeUrgentDeliveryId(record.id)
        && Number.isFinite(record.processedAt)
        && Number.isFinite(record.expiresAt)
        && record.expiresAt > now
        && record.id !== normalizedDeliveryId
      ))
      .sort((a, b) => b.processedAt - a.processedAt)
      .slice(0, PROCESSED_URGENT_DELIVERY_LIMIT - 1);

    await idbRequestToPromise(store.clear());
    await idbRequestToPromise(store.put({
      id: normalizedDeliveryId,
      processedAt: now,
      expiresAt: now + PROCESSED_URGENT_DELIVERY_RETENTION_MS,
    }));
    for (const record of validRecords) {
      await idbRequestToPromise(store.put(record));
    }
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to remember an urgent reminder delivery', error);
    return false;
  }
}

async function runUrgentDeliveryOnce(
  deliveryId,
  operation,
  {
    wasProcessed = wasUrgentDeliveryProcessed,
    rememberProcessed = rememberProcessedUrgentDelivery,
  } = {}
) {
  const normalizedDeliveryId = normalizeUrgentDeliveryId(deliveryId);
  if (!normalizedDeliveryId || typeof operation !== 'function') {
    return typeof operation === 'function' ? operation() : false;
  }
  if (inFlightUrgentDeliveries.has(normalizedDeliveryId)) {
    return inFlightUrgentDeliveries.get(normalizedDeliveryId);
  }

  const deliveryPromise = (async () => {
    if (await wasProcessed(normalizedDeliveryId)) {
      return true;
    }
    const succeeded = await operation();
    if (succeeded !== true) {
      return false;
    }
    // Storage failure deliberately fails open: showing a possible duplicate later
    // is safer than suppressing an urgent appointment that was never displayed.
    await rememberProcessed(normalizedDeliveryId);
    return true;
  })();
  inFlightUrgentDeliveries.set(normalizedDeliveryId, deliveryPromise);
  try {
    return await deliveryPromise;
  } finally {
    if (inFlightUrgentDeliveries.get(normalizedDeliveryId) === deliveryPromise) {
      inFlightUrgentDeliveries.delete(normalizedDeliveryId);
    }
  }
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
    notifyAt: typeof entry.notifyAt === 'string' ? entry.notifyAt : null,
    snoozedUntil: typeof entry.snoozedUntil === 'string' ? entry.snoozedUntil : null,
    urgentAlert: entry.urgentAlert === true,
    hasExplicitTime: entry.hasExplicitTime === true,
    urgentAcknowledgedAt: parseTimestamp(entry.urgentAcknowledgedAt),
    urgentStartedAt: parseTimestamp(entry.urgentStartedAt),
    done: entry.done === true || entry.completed === true,
    deleted: entry.deleted === true,
    priority: entry.priority || 'Medium',
    category:
      typeof entry.category === 'string' && entry.category.trim()
        ? entry.category.trim()
        : DEFAULT_REMINDER_CATEGORY,
    notes: typeof entry.notes === 'string' ? entry.notes : '',
    meetingUrl: normalizeHttpUrl(entry.meetingUrl),
    urlPath:
      typeof entry.urlPath === 'string' && entry.urlPath
        ? entry.urlPath
        : DEFAULT_REMINDER_URL_PATH,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
    notifiedAt: Number.isFinite(entry.notifiedAt) ? entry.notifiedAt : null,
    lastUrgentStageKey: normalizeText(entry.lastUrgentStageKey) || null,
    ownerUserId: normalizeText(entry.ownerUserId) || normalizeText(entry.userId),
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

function mergeScheduledReminderLocalState(existingEntry, incomingEntry) {
  const existing = sanitizeReminderEntry(existingEntry);
  const incoming = sanitizeReminderEntry(incomingEntry);
  if (!incoming || !existing || existing.id !== incoming.id || existing.due !== incoming.due) {
    return incoming;
  }

  const existingNotifiedAt = Number.isFinite(existing.notifiedAt) ? existing.notifiedAt : 0;
  const incomingNotifiedAt = Number.isFinite(incoming.notifiedAt) ? incoming.notifiedAt : 0;
  if (
    incoming.updatedAt <= existing.updatedAt
    &&
    existing.lastUrgentStageKey
    && (!incoming.lastUrgentStageKey || existingNotifiedAt > incomingNotifiedAt)
  ) {
    incoming.lastUrgentStageKey = existing.lastUrgentStageKey;
    incoming.notifiedAt = existing.notifiedAt;
  }
  return incoming;
}

function buildScheduledReminderSnapshot(
  existingEntries = [],
  reminders = [],
  tombstones = [],
  now = Date.now(),
  pendingActions = []
) {
  const nextById = new Map();
  [
    ...(Array.isArray(reminders) ? reminders : []).map((entry) => (
      applyPendingUrgentActionIntents(entry, pendingActions)
    )),
    ...(Array.isArray(tombstones) ? tombstones : []).map((entry) => ({
      ...entry,
      done: true,
      deleted: true,
    })),
  ]
    .map(sanitizeReminderEntry)
    .filter(Boolean)
    .forEach((entry) => {
      const current = nextById.get(entry.id);
      if (
        !current
        || entry.updatedAt > current.updatedAt
        || (
          entry.updatedAt === current.updatedAt
          && entry.deleted === true
          && current.deleted !== true
        )
      ) {
        nextById.set(entry.id, entry);
      }
    });
  const tombstoneCutoff = now - REMINDER_TOMBSTONE_RETENTION_MS;
  (Array.isArray(existingEntries) ? existingEntries : [])
    .map(sanitizeReminderEntry)
    .filter(Boolean)
    .forEach((existing) => {
      const incoming = nextById.get(existing.id);
      if (!incoming) {
        if (existing.deleted === true && existing.updatedAt >= tombstoneCutoff) {
          nextById.set(existing.id, existing);
        }
        return;
      }
      if (
        existing.updatedAt > incoming.updatedAt
        || (
          existing.updatedAt === incoming.updatedAt
          && existing.deleted === true
          && incoming.deleted !== true
        )
      ) {
        nextById.set(existing.id, existing);
        return;
      }
      nextById.set(
        existing.id,
        mergeScheduledReminderLocalState(existing, incoming)
      );
    });
  return Array.from(nextById.values());
}

async function writeScheduledReminders(reminders = [], tombstones = [], options = {}) {
  try {
    const activeOwnerWasProvided = options.activeOwnerWasProvided === true;
    const activeOwnerUserId = normalizeText(options.activeOwnerUserId);
    const expectedOwnerWasProvided = Object.prototype.hasOwnProperty.call(
      options,
      'expectedOwnerUserId'
    );
    const expectedOwnerUserId = normalizeText(options.expectedOwnerUserId);
    const nextOwnerState = activeOwnerWasProvided
      ? {
          known: true,
          ownerUserId: activeOwnerUserId,
          notificationTriggersSupported: options.notificationTriggersSupported === true,
        }
      : null;
    const db = await getReminderDb();
    if (!db) {
      return false;
    }
    // Read the separate pending-action store before opening the write transaction.
    // IndexedDB may auto-commit a transaction whenever it has no queued requests.
    const pendingActions = await readPendingUrgentActions();
    const tx = db.transaction(
      activeOwnerWasProvided || expectedOwnerWasProvided
        ? [REMINDER_STORE_NAME, REMINDER_META_STORE_NAME]
        : REMINDER_STORE_NAME,
      'readwrite'
    );
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const done = waitForTransaction(tx);
    if (expectedOwnerWasProvided) {
      const currentOwnerRecord = await idbRequestToPromise(
        tx.objectStore(REMINDER_META_STORE_NAME).get(ACTIVE_REMINDER_OWNER_META_KEY)
      );
      if (
        !currentOwnerRecord
        || currentOwnerRecord.key !== ACTIVE_REMINDER_OWNER_META_KEY
        || normalizeText(currentOwnerRecord.ownerUserId) !== expectedOwnerUserId
      ) {
        // A schedule check that began under a previous account must not clear
        // or replace the schedule installed by the newly active account.
        await done;
        return false;
      }
    }
    const existingEntries = await idbRequestToPromise(store.getAll()).catch(() => []);
    const belongsToActiveOwner = (entry) => (
      !activeOwnerWasProvided
      || normalizeText(entry?.ownerUserId || entry?.userId) === activeOwnerUserId
    );
    const nextEntries = buildScheduledReminderSnapshot(
      existingEntries.filter(belongsToActiveOwner),
      (Array.isArray(reminders) ? reminders : []).filter(belongsToActiveOwner),
      (Array.isArray(tombstones) ? tombstones : []).filter(belongsToActiveOwner),
      Date.now(),
      pendingActions
    );
    await idbRequestToPromise(store.clear());
    for (const entry of nextEntries) {
      await idbRequestToPromise(store.put(entry));
    }
    if (nextOwnerState) {
      await idbRequestToPromise(tx.objectStore(REMINDER_META_STORE_NAME).put({
        key: ACTIVE_REMINDER_OWNER_META_KEY,
        ownerUserId: nextOwnerState.ownerUserId,
        notificationTriggersSupported: nextOwnerState.notificationTriggersSupported,
        updatedAt: Date.now(),
      }));
    }
    await done;
    if (nextOwnerState) {
      activeReminderOwnerState = nextOwnerState;
    }
    return true;
  } catch (error) {
    console.warn('Failed to persist reminder schedule', error);
    return false;
  }
}

async function upsertScheduledReminder(entry, options = {}) {
  try {
    const db = await getReminderDb();
    if (!db) {
      return null;
    }
    const sanitized = sanitizeReminderEntry(entry);
    if (!sanitized) {
      return null;
    }
    const enforceOwner = options.enforceOwner === true;
    const expectedOwnerUserId = normalizeText(options.expectedOwnerUserId);
    if (
      enforceOwner
      && normalizeText(sanitized.ownerUserId) !== expectedOwnerUserId
    ) {
      return false;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const done = waitForTransaction(tx);
    const existing = await idbRequestToPromise(store.get(sanitized.id)).catch(() => null);
    const existingOwnerUserId = normalizeText(existing?.ownerUserId || existing?.userId);
    if (
      enforceOwner
      && existing
      && existingOwnerUserId !== expectedOwnerUserId
    ) {
      await done.catch(() => undefined);
      return false;
    }
    const existingUpdatedAt = Number.isFinite(existing?.updatedAt) ? existing.updatedAt : 0;
    if (
      existingUpdatedAt > sanitized.updatedAt
      || (
        existingUpdatedAt === sanitized.updatedAt
        && existing?.deleted === true
        && sanitized.deleted !== true
      )
    ) {
      await done.catch(() => undefined);
      return false;
    }
    await idbRequestToPromise(store.put(
      mergeScheduledReminderLocalState(existing, sanitized)
    ));
    await done;
    return true;
  } catch (error) {
    console.warn('Failed to upsert scheduled reminder', error);
    return null;
  }
}

async function deleteScheduledReminder(id, updatedAt = Date.now(), ownerUserId = '') {
  if (!id) {
    return null;
  }
  return upsertScheduledReminder({
    id,
    done: true,
    deleted: true,
    updatedAt,
    ownerUserId: normalizeText(ownerUserId),
  }, {
    enforceOwner: true,
    expectedOwnerUserId: normalizeText(ownerUserId),
  });
}

async function closeUrgentReminderNotifications(reminderId, ownerUserId = '') {
  const normalizedReminderId = normalizeText(reminderId);
  if (
    !normalizedReminderId
    || !self.registration
    || typeof self.registration.getNotifications !== 'function'
  ) {
    return false;
  }
  const normalizedOwnerUserId = normalizeText(ownerUserId);
  const urgentTags = [
    buildUrgentNotificationTag(normalizedReminderId, normalizedOwnerUserId),
    buildUrgentNotificationTag(normalizedReminderId, ''),
  ].filter((tag, index, tags) => tags.indexOf(tag) === index);
  try {
    for (const urgentTag of urgentTags) {
      const notifications = await self.registration.getNotifications({ tag: urgentTag });
      (Array.isArray(notifications) ? notifications : [])
        .filter((notification) => {
          if (notification?.tag && notification.tag !== urgentTag) return false;
          const notificationOwnerUserId = normalizeText(notification?.data?.ownerUserId);
          return !normalizedOwnerUserId || !notificationOwnerUserId
            || notificationOwnerUserId === normalizedOwnerUserId;
        })
        .forEach((notification) => {
          try { notification.close(); } catch (_) { /* ignore close failures */ }
        });
    }
    return true;
  } catch (error) {
    console.warn('Failed to close an urgent reminder notification', error);
    return false;
  }
}

async function closeForeignUrgentNotifications(activeOwnerUserId = '') {
  if (!self.registration || typeof self.registration.getNotifications !== 'function') {
    return false;
  }
  const normalizedActiveOwnerUserId = normalizeText(activeOwnerUserId);
  try {
    const notifications = await self.registration.getNotifications();
    (Array.isArray(notifications) ? notifications : [])
      .filter((notification) => {
        if (notification?.data?.type !== URGENT_NOTIFICATION_DATA_TYPE) return false;
        return normalizeText(notification?.data?.ownerUserId) !== normalizedActiveOwnerUserId;
      })
      .forEach((notification) => {
        try { notification.close(); } catch (_) { /* ignore close failures */ }
      });
    return true;
  } catch (error) {
    console.warn('Failed to close reminders from an inactive account', error);
    return false;
  }
}

function buildScheduledReminderFromPush(reminder = {}) {
  if (!reminder || typeof reminder !== 'object') {
    return null;
  }
  const reminderId = normalizeText(reminder.id);
  if (!reminderId) {
    return null;
  }
  const due = normalizeText(reminder.due) || null;
  const notes = normalizeText(reminder.notes);
  return sanitizeReminderEntry({
    id: reminderId,
    title: normalizeText(reminder.title) || 'Reminder',
    body: normalizeText(reminder.body) || notes || 'Due now',
    due,
    notifyAt: normalizeText(reminder.notifyAt) || null,
    snoozedUntil: normalizeText(reminder.snoozedUntil) || null,
    urgentAlert: reminder.urgentAlert === true,
    hasExplicitTime: reminder.hasExplicitTime === true,
    urgentAcknowledgedAt: reminder.urgentAcknowledgedAt,
    urgentStartedAt: reminder.urgentStartedAt,
    done: reminder.done === true || reminder.completed === true,
    priority: normalizeText(reminder.priority) || 'Medium',
    category: normalizeText(reminder.category) || DEFAULT_REMINDER_CATEGORY,
    notes,
    meetingUrl: normalizeHttpUrl(reminder.meetingUrl),
    urlPath: normalizeText(reminder.urlPath) || `${DEFAULT_REMINDER_URL_PATH}#reminders`,
    ownerUserId: normalizeText(reminder.ownerUserId) || normalizeText(reminder.userId),
    updatedAt: parseTimestamp(reminder.updatedAt) ?? Date.now(),
    notifiedAt: null,
  });
}

async function handleReminderSyncPush(rawPayload = {}) {
  const payload = normalizeIncomingPayload(rawPayload);
  const reminder = parseObjectValue(payload.reminder) || {};
  const reminderId = normalizeText(reminder.id) || normalizeText(payload.reminderId);
  if (!reminderId) {
    return false;
  }
  const incomingOwnerUserId =
    normalizeText(payload.ownerUserId)
    || normalizeText(payload.userId)
    || normalizeText(reminder.ownerUserId)
    || normalizeText(reminder.userId);
  if (!(await incomingReminderOwnerIsAllowed(incomingOwnerUserId))) {
    return true;
  }

  let mutationResult = null;
  let shouldCloseUrgentNotification = false;
  let unpersistedUrgentPayload = null;
  if (normalizeText(payload.action).toLowerCase() === 'delete') {
    const updatedAt = parseTimestamp(reminder.updatedAt) ?? Date.now();
    mutationResult = await deleteScheduledReminder(reminderId, updatedAt, incomingOwnerUserId);
    shouldCloseUrgentNotification = true;
  } else {
    const scheduledReminder = buildScheduledReminderFromPush({
      ...reminder,
      id: reminderId,
      ownerUserId: incomingOwnerUserId,
    });
    if (scheduledReminder) {
      const pendingActions = await readPendingUrgentActions();
      const reminderWithPendingIntent = applyPendingUrgentActionIntents(
        scheduledReminder,
        pendingActions
      );
      const urgentState = getScheduledUrgentState(reminderWithPendingIntent, Date.now());
      shouldCloseUrgentNotification = (
        reminderWithPendingIntent?.deleted === true
        || urgentState.shouldAlert === false
      );
      mutationResult = reminderWithPendingIntent?.deleted === true
        ? await deleteScheduledReminder(
            reminderId,
            Math.max(
              Number(reminderWithPendingIntent.updatedAt || 0),
              parseTimestamp(reminder.updatedAt) || 0
            ),
            incomingOwnerUserId
          )
          : await upsertScheduledReminder(reminderWithPendingIntent, {
              enforceOwner: true,
              expectedOwnerUserId: incomingOwnerUserId,
            });
      if (mutationResult === null && urgentState.shouldAlert) {
        unpersistedUrgentPayload = {
          ownerUserId: incomingOwnerUserId,
          reminder: reminderWithPendingIntent,
          stage: urgentState.stage,
          badgeCount: payload.badgeCount,
        };
      }
    }
  }

  if (mutationResult === null) {
    if (shouldCloseUrgentNotification) {
      // The server has authoritatively removed or deactivated this reminder.
      // Even if IndexedDB is temporarily unavailable, do not leave the stale
      // lock-screen notification inviting another action.
      await closeUrgentReminderNotifications(reminderId, incomingOwnerUserId);
    }
    if (unpersistedUrgentPayload) {
      return showUrgentReminder(unpersistedUrgentPayload);
    }
    if (normalizeBadgeCount(payload.badgeCount) !== null) {
      await applyUrgentBadge(payload.badgeCount);
    }
    return false;
  }
  if (mutationResult === false) {
    // This mutation lost the updatedAt conflict, so its badge count is stale too.
    // Rebuild the badge from the reminder schedule that actually won.
    await recomputeScheduledUrgentBadge();
    return true;
  }
  if (shouldCloseUrgentNotification) {
    await closeUrgentReminderNotifications(reminderId, incomingOwnerUserId);
  }
  const processed = await checkAndNotifyDueReminders({ source: 'push-sync' });
  if (processed === false && normalizeBadgeCount(payload.badgeCount) !== null) {
    await applyUrgentBadge(payload.badgeCount);
  }
  return processed;
}

async function readScheduledReminders() {
  try {
    const db = await getReminderDb();
    if (!db) {
      return null;
    }
    const tx = db.transaction(REMINDER_STORE_NAME, 'readonly');
    const store = tx.objectStore(REMINDER_STORE_NAME);
    const request = store.getAll();
    const results = await idbRequestToPromise(request);
    await waitForTransaction(tx);
    const workerState = await readReminderWorkerState();
    if (!workerState.known) {
      return [];
    }
    return Array.isArray(results)
      ? results
          .map(sanitizeReminderEntry)
          .filter((entry) => (
            entry && entry.ownerUserId === workerState.ownerUserId
          ))
      : null;
  } catch (error) {
    console.warn('Failed to read scheduled reminders', error);
    return null;
  }
}

function getScheduledUrgentState(reminder, now) {
  if (
    !reminder
    || reminder.done === true
    || reminder.urgentAlert !== true
    || reminder.hasExplicitTime !== true
  ) {
    return { stage: null, shouldBadge: false, shouldAlert: false };
  }
  const dueTime = Number.isFinite(reminder.dueTime)
    ? reminder.dueTime
    : parseTimestamp(reminder.due);
  if (!Number.isFinite(dueTime)) {
    return { stage: null, shouldBadge: false, shouldAlert: false };
  }

  let stage = null;
  if (now < dueTime) {
    for (let index = URGENT_ALERT_LEAD_MINUTES.length - 1; index >= 0; index -= 1) {
      const minutes = URGENT_ALERT_LEAD_MINUTES[index];
      const startAt = dueTime - (minutes * MINUTE_MS);
      if (now >= startAt) {
        stage = {
          key: `t-${minutes}`,
          label: minutes === 1 ? '1 minute to go' : `${minutes} minutes to go`,
          kind: 'upcoming',
          startAt,
          dueAt: dueTime,
        };
        break;
      }
    }
  } else {
    const overdueMinutes = Math.floor(
      (now - dueTime) / (URGENT_OVERDUE_INTERVAL_MINUTES * MINUTE_MS)
    ) * URGENT_OVERDUE_INTERVAL_MINUTES;
    stage = overdueMinutes < URGENT_OVERDUE_INTERVAL_MINUTES
      ? {
          key: 'due',
          label: 'Due now',
          kind: 'due',
          startAt: dueTime,
          dueAt: dueTime,
        }
      : {
          key: `overdue-${overdueMinutes}`,
          label: `${overdueMinutes} minutes overdue`,
          kind: 'overdue',
          startAt: dueTime + (overdueMinutes * MINUTE_MS),
          dueAt: dueTime,
        };
  }
  if (!stage) {
    return { stage: null, shouldBadge: false, shouldAlert: false };
  }

  const snoozedUntil = parseTimestamp(reminder.snoozedUntil);
  if (snoozedUntil !== null && snoozedUntil <= now && snoozedUntil > stage.startAt) {
    stage = {
      ...stage,
      key: `snooze-${snoozedUntil}`,
      label: 'Snooze finished',
      startAt: snoozedUntil,
    };
  }
  const startedAt = parseTimestamp(reminder.urgentStartedAt);
  const acknowledgedAt = parseTimestamp(reminder.urgentAcknowledgedAt);
  const shouldAlert = startedAt === null
    && !(snoozedUntil !== null && snoozedUntil > now)
    && !(acknowledgedAt !== null && acknowledgedAt >= stage.startAt);
  return { stage, shouldBadge: true, shouldAlert };
}

async function recomputeScheduledUrgentBadge(now = Date.now()) {
  const storedReminders = await readScheduledReminders();
  if (!Array.isArray(storedReminders)) {
    return false;
  }
  const pendingActions = await readPendingUrgentActions();
  const reminders = storedReminders.map((reminder) => (
    applyPendingUrgentActionIntents(reminder, pendingActions)
  ));
  const urgentBadgeCount = reminders.filter(
    (reminder) => getScheduledUrgentState(reminder, now).shouldBadge
  ).length;
  return applyUrgentBadge(urgentBadgeCount);
}

async function checkAndNotifyDueReminders({
  source = 'unknown',
  stageClaimDependencies,
} = {}) {
  if (!self.registration || typeof self.registration.showNotification !== 'function') {
    return false;
  }
  const storedReminders = await readScheduledReminders();
  if (!Array.isArray(storedReminders)) {
    return false;
  }
  const pendingActions = await readPendingUrgentActions();
  const workerState = await readReminderWorkerState();
  if (!workerState.known) {
    return false;
  }
  const expectedOwnerUserId = normalizeText(workerState.ownerUserId);
  if (storedReminders.some((reminder) => (
    normalizeText(reminder?.ownerUserId || reminder?.userId) !== expectedOwnerUserId
  ))) {
    // The account changed between reading the schedule and reading metadata.
    return false;
  }
  const reminders = storedReminders.map((reminder) => (
    applyPendingUrgentActionIntents(reminder, pendingActions)
  ));
  if (!reminders.length) {
    return true;
  }
  const now = Date.now();
  const urgentStates = reminders.map((reminder) => getScheduledUrgentState(reminder, now));
  const urgentBadgeCount = urgentStates.filter((state) => state.shouldBadge).length;
  if (!(await incomingReminderOwnerIsAllowed(
    expectedOwnerUserId,
    { adoptIfUnknown: false }
  ))) {
    return false;
  }
  await applyUrgentBadge(urgentBadgeCount);
  let changed = false;
  let displayFailed = false;
  for (let index = 0; index < reminders.length; index += 1) {
    const reminder = reminders[index];
    if (!reminder || !reminder.id || reminder.done === true) {
      continue;
    }
    const urgentState = urgentStates[index];
    if (reminder.urgentAlert === true && reminder.hasExplicitTime === true) {
      if (
        urgentState.shouldAlert
        && reminder.lastUrgentStageKey !== urgentState.stage.key
      ) {
        try {
          const displayed = await showUrgentReminder(
            {
              reminder: {
                id: reminder.id,
                title: reminder.title,
                body: reminder.body,
                due: reminder.due,
                meetingUrl: reminder.meetingUrl,
                urlPath: reminder.urlPath,
                ownerUserId: reminder.ownerUserId,
                updatedAt: reminder.updatedAt,
              },
              stage: urgentState.stage,
              badgeCount: urgentBadgeCount,
            },
            stageClaimDependencies
          );
          if (displayed) {
            reminder.notifiedAt = now;
            reminder.lastUrgentStageKey = urgentState.stage.key;
            changed = true;
          } else {
            displayFailed = true;
          }
        } catch (error) {
          console.warn('Failed to display urgent reminder notification', error);
          displayFailed = true;
        }
      }
      continue;
    }
    if (reminder.viaTrigger === true) {
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
      displayFailed = true;
    }
  }
  if (changed) {
    const persisted = await writeScheduledReminders(reminders, [], {
      expectedOwnerUserId,
    });
    if (!persisted) {
      return false;
    }
  }
  return !displayFailed;
}

self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.type === SHOW_URGENT_REMINDER_MESSAGE_TYPE) {
    event.waitUntil(showUrgentReminder(data));
    return;
  }
  if (data.type === UPDATE_URGENT_BADGE_MESSAGE_TYPE) {
    event.waitUntil((async () => {
      if (await incomingReminderOwnerIsAllowed(data.ownerUserId)) {
        await applyUrgentBadge(data.count);
      }
    })());
    return;
  }
  if (data.type === REMINDER_SYNC_PUSH_TYPE) {
    event.waitUntil(runUrgentDeliveryOnce(
      data.deliveryId,
      () => handleReminderSyncPush(data)
    ));
    return;
  }
  if (data.type === REQUEST_PENDING_URGENT_ACTIONS_MESSAGE_TYPE) {
    event.waitUntil((async () => {
      const ownerUserId = normalizeText(data.ownerUserId);
      if (!(await incomingReminderOwnerIsAllowed(ownerUserId, { adoptIfUnknown: false }))) {
        return 0;
      }
      return sendPendingUrgentActions(event.source, ownerUserId);
    })());
    return;
  }
  if (data.type === URGENT_ACTION_COMPLETED_MESSAGE_TYPE) {
    event.waitUntil((async () => {
      const ownerUserId = normalizeText(data.ownerUserId);
      if (!(await incomingReminderOwnerIsAllowed(ownerUserId, { adoptIfUnknown: false }))) {
        return false;
      }
      return deletePendingUrgentAction(data.actionId, ownerUserId);
    })());
    return;
  }
  if (data.type === CANCEL_SCHEDULED_REMINDER_MESSAGE_TYPE) {
    event.waitUntil((async () => {
      const reminderId = normalizeText(data.reminderId);
      if (!reminderId) {
        return false;
      }
      const ownerUserId = normalizeText(data.ownerUserId);
      if (!(await incomingReminderOwnerIsAllowed(ownerUserId))) {
        return false;
      }
      const deleted = await deleteScheduledReminder(
        reminderId,
        parseTimestamp(data.updatedAt) ?? Date.now(),
        ownerUserId
      );
      if (deleted === true) {
        await closeUrgentReminderNotifications(reminderId, ownerUserId);
      }
      await recomputeScheduledUrgentBadge();
      return deleted;
    })());
    return;
  }
  if (data.type === 'memoryCue:updateScheduledReminders') {
    const reminders = Array.isArray(data.reminders) ? data.reminders : [];
    const tombstones = Array.isArray(data.tombstones) ? data.tombstones : [];
    const activeOwnerWasProvided = Object.prototype.hasOwnProperty.call(data, 'activeOwnerUserId');
    const activeOwnerUserId = normalizeText(data.activeOwnerUserId);
    event.waitUntil((async () => {
      const written = await writeScheduledReminders(reminders, tombstones, {
        activeOwnerWasProvided,
        activeOwnerUserId,
        notificationTriggersSupported: data.notificationTriggersSupported === true,
      });
      if (activeOwnerWasProvided) {
        await closeForeignUrgentNotifications(activeOwnerUserId);
      }
      return written;
    })());
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
  let rawData = {};
  try {
    rawData = event.data ? event.data.json() : {};
  } catch (_) {
    const text = event.data ? event.data.text() : '';
    rawData = parseObjectValue(text) || { body: text };
  }
  const data = normalizeIncomingPayload(rawData);
  if (data.type === SHOW_URGENT_REMINDER_MESSAGE_TYPE) {
    event.waitUntil(showUrgentReminder(data));
    return;
  }
  if (data.type === UPDATE_URGENT_BADGE_MESSAGE_TYPE) {
    event.waitUntil((async () => {
      if (await incomingReminderOwnerIsAllowed(data.ownerUserId)) {
        await applyUrgentBadge(data.count ?? data.badgeCount);
      }
    })());
    return;
  }
  if (data.type === REMINDER_SYNC_PUSH_TYPE) {
    event.waitUntil(runUrgentDeliveryOnce(
      data.deliveryId,
      () => handleReminderSyncPush(data)
    ));
    return;
  }
  const title = data.title || 'Memory Cue Reminder';
  const options = { body: data.body || '', data };
  event.waitUntil((async () => {
    if (!(await incomingReminderOwnerIsAllowed(data.ownerUserId))) {
      return false;
    }
    await self.registration.showNotification(title, options);
    return true;
  })());
});

function buildNotificationDestination(data = {}, action = '', pendingAction = null) {
  try {
    const destination = data.urlPath
      ? new URL(data.urlPath, self.registration.scope)
      : new URL(self.registration.scope);
    if (data.type === URGENT_NOTIFICATION_DATA_TYPE) {
      if (data.reminderId) {
        destination.searchParams.set('reminderId', data.reminderId);
      }
      if (action) {
        destination.searchParams.set('urgentAction', action);
      }
      if (data.stageKey) {
        destination.searchParams.set('urgentStage', data.stageKey);
      }
      const actionId = normalizeText(pendingAction?.id || pendingAction?.actionId);
      const actionCreatedAt = Number(
        pendingAction?.createdAt ?? pendingAction?.actionCreatedAt
      );
      if (actionId) {
        destination.searchParams.set('urgentActionId', actionId);
      }
      if (Number.isFinite(actionCreatedAt)) {
        destination.searchParams.set('urgentActionCreatedAt', String(actionCreatedAt));
      }
      const reminderUpdatedAt = parseTimestamp(pendingAction?.reminderUpdatedAt);
      if (reminderUpdatedAt !== null) {
        destination.searchParams.set('urgentReminderUpdatedAt', String(reminderUpdatedAt));
      }
      if (pendingAction?.meetingAlreadyOpened === true) {
        destination.searchParams.set('meetingOpened', '1');
      }
      const ownerUserId = normalizeText(pendingAction?.ownerUserId || data.ownerUserId);
      if (ownerUserId) {
        destination.searchParams.set('urgentOwnerUserId', ownerUserId);
      }
      if (!destination.hash) {
        destination.hash = 'reminders';
      }
    }
    return destination.href;
  } catch (_) {
    return self.registration.scope;
  }
}

function isMobileAppEntryPath(pathname = '') {
  const scopePathWithoutTrailingSlash = APP_PATH === '/'
    ? '/'
    : APP_PATH.replace(/\/$/, '');
  const mobileEntryPaths = new Set([
    APP_PATH,
    scopePathWithoutTrailingSlash,
    `${APP_PATH}mobile`,
    `${APP_PATH}mobile/`,
    `${APP_PATH}mobile.html`,
    `${APP_PATH}index.html`,
  ]);
  return mobileEntryPaths.has(pathname);
}

function findNotificationWindowClient(windowClients = [], destination = '') {
  let targetUrl;
  try {
    targetUrl = new URL(destination);
  } catch (_) {
    return null;
  }

  let equivalentMobileClient = null;
  for (const client of windowClients) {
    try {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin !== targetUrl.origin) {
        continue;
      }
      if (clientUrl.pathname === targetUrl.pathname) {
        return client;
      }
      if (
        !equivalentMobileClient
        && isMobileAppEntryPath(clientUrl.pathname)
        && isMobileAppEntryPath(targetUrl.pathname)
      ) {
        equivalentMobileClient = client;
      }
    } catch (_) {
      // Ignore malformed client URLs.
    }
  }
  return equivalentMobileClient;
}

async function postUrgentActionToClients({
  id,
  actionId,
  action,
  reminderId,
  ownerUserId,
  stageKey,
  meetingAlreadyOpened = false,
  createdAt,
  actionCreatedAt,
  reminderUpdatedAt,
}, clients = null) {
  if (!reminderId || !URGENT_ACTION_NAMES.has(action)) {
    return [];
  }
  const normalizedActionId = normalizeText(id || actionId);
  const normalizedCreatedAt = Number(createdAt ?? actionCreatedAt);
  const actionMessage = {
    type: URGENT_ACTION_MESSAGE_TYPE,
    action,
    reminderId,
    ownerUserId: normalizeText(ownerUserId),
    stageKey: stageKey || '',
    meetingAlreadyOpened,
    actionId: normalizedActionId,
    actionCreatedAt: Number.isFinite(normalizedCreatedAt) ? normalizedCreatedAt : null,
    reminderUpdatedAt: parseTimestamp(reminderUpdatedAt),
  };
  const targetClients = clients || await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  await Promise.allSettled(
    targetClients.map(async (client) => {
      if (typeof client.postMessage === 'function') {
        client.postMessage(actionMessage);
      }
    })
  );
  return targetClients;
}

async function sendPendingUrgentActions(source = null, ownerUserId = '') {
  const normalizedOwnerUserId = normalizeText(ownerUserId);
  const pendingActions = await readPendingUrgentActions();
  const ownedPendingActions = pendingActions.filter(
    (action) => action.ownerUserId === normalizedOwnerUserId
  );
  if (!ownedPendingActions.length) {
    return 0;
  }
  const targetClients = source && typeof source.postMessage === 'function'
    ? [source]
    : await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const pendingAction of ownedPendingActions) {
    await postUrgentActionToClients(pendingAction, targetClients);
  }
  return ownedPendingActions.length;
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification?.data || {};
  const isUrgent = data.type === URGENT_NOTIFICATION_DATA_TYPE;
  const action = isUrgent && URGENT_ACTION_NAMES.has(event.action)
    ? event.action
    : (isUrgent ? 'acknowledge' : '');
  const meetingUrl = action === 'start' ? normalizeHttpUrl(data.meetingUrl) : '';
  let destination = buildNotificationDestination(data, action);
  event.notification?.close();
  event.waitUntil((async () => {
    let pendingAction = null;
    let pendingActionPersisted = false;
    let appWindowOpenAttempted = false;
    let meetingWindowOpened = false;
    if (isUrgent) {
      if (!(await incomingReminderOwnerIsAllowed(data.ownerUserId))) {
        return;
      }
      pendingAction = createPendingUrgentAction({
        action,
        reminderId: data.reminderId,
        stageKey: data.stageKey,
        ownerUserId: data.ownerUserId,
        reminderUpdatedAt: data.updatedAt,
      });
      if (pendingAction) {
        pendingActionPersisted = await savePendingUrgentAction(pendingAction);
        if (pendingActionPersisted) {
          await applyPendingUrgentActionToSchedule(pendingAction);
          await closeUrgentReminderNotifications(
            pendingAction.reminderId,
            pendingAction.ownerUserId
          );
          const clickedBadgeCount = normalizeBadgeCount(data.badgeCount);
          if (pendingAction.action !== 'done' && clickedBadgeCount !== null) {
            await applyUrgentBadge(clickedBadgeCount);
          } else {
            await recomputeScheduledUrgentBadge();
          }
        }
        destination = buildNotificationDestination(data, action, pendingAction);
      }
    }
    try {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const targetUrl = new URL(destination);
      const matching = findNotificationWindowClient(allClients, destination);
      if (matching) {
        let meetingAlreadyOpened = false;
        if (meetingUrl && self.clients.openWindow) {
          try {
            await self.clients.openWindow(meetingUrl);
            meetingAlreadyOpened = true;
            meetingWindowOpened = true;
            if (pendingAction && pendingActionPersisted) {
              pendingAction.meetingAlreadyOpened = true;
              await updatePendingUrgentActionMeetingOpened(pendingAction.id);
            }
          } catch (_) {
            // The page will make a best-effort fallback if the browser rejects this open.
          }
        }
        if (!meetingAlreadyOpened) {
          try {
            await matching.focus();
          } catch (_) {
            // The action can still reach an open app even when Windows rejects focus.
            // Do not fall through to openWindow(), which would create a duplicate.
          }
        }
        if (pendingAction) {
          pendingAction.meetingAlreadyOpened = meetingAlreadyOpened;
          await postUrgentActionToClients(pendingAction, [matching]);
        }
        if (pendingAction && !pendingActionPersisted && matching.navigate) {
          // Keep an action URL in the existing app when IndexedDB is unavailable.
          // If the page crashes before handling the message, its next load can
          // still finish the action instead of losing the user's tap.
          try { await matching.navigate(destination); } catch (_) { /* retry on next alert */ }
        } else if (!isUrgent && targetUrl.hash && matching.navigate) {
          try { await matching.navigate(destination); } catch (_) { /* ignore navigate failure */ }
        }
        return;
      }
      if (self.clients.openWindow) {
        if (pendingAction && !pendingActionPersisted) {
          appWindowOpenAttempted = true;
          try { await self.clients.openWindow(destination); } catch (_) { /* retry below when useful */ }
        }
        if (meetingUrl) {
          try {
            const meetingClient = await self.clients.openWindow(meetingUrl);
            meetingWindowOpened = true;
            if (pendingAction) {
              pendingAction.meetingAlreadyOpened = true;
              if (pendingActionPersisted) {
                await updatePendingUrgentActionMeetingOpened(pendingAction.id);
              }
              destination = buildNotificationDestination(data, action, pendingAction);
            }
            // A same-origin meeting can be focused again after Memory Cue starts
            // processing the durable action. Cross-origin meeting clients resolve
            // as null, so leave those in front and replay the queued action later.
            if (meetingClient && typeof meetingClient.focus === 'function') {
              appWindowOpenAttempted = true;
              try {
                await self.clients.openWindow(destination);
              } finally {
                try { await meetingClient.focus(); } catch (_) { /* ignore focus failure */ }
              }
            }
            return;
          } catch (_) {
            // Open Memory Cue with a truthful false flag so its Start action can
            // make a best-effort meeting launch when the service worker is blocked.
            if (pendingAction) {
              destination = buildNotificationDestination(data, action, pendingAction);
            }
          }
        }
        if (pendingAction) {
          destination = buildNotificationDestination(data, action, pendingAction);
        }
        if (appWindowOpenAttempted) {
          return;
        }
        appWindowOpenAttempted = true;
        await self.clients.openWindow(destination);
      }
    } catch (_) {
      if (!meetingWindowOpened && !appWindowOpenAttempted && self.clients && self.clients.openWindow) {
        appWindowOpenAttempted = true;
        try { await self.clients.openWindow(destination); } catch (_) { /* ignore */ }
      }
    }
  })());
});

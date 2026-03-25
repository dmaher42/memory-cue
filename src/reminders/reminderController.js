import { initAuth, startSignInFlow, startSignOutFlow } from '../../js/auth.js';
import { saveReminder, removeReminder } from '../repositories/reminderRepository.js';
import { syncNotes } from '../services/firestoreSyncService.js';
import { captureInput, getInboxEntries, saveInboxEntry } from '../../js/services/capture-service.js';
import { createReminder as createReminderViaService, setReminderCreationHandler, buildReminderPayload } from '../services/reminderService.js';
import { getFolders, loadAllNotes, saveAllNotes, saveFolders, setRemoteSyncHandler } from '../../js/modules/notes-storage.js';
import { createReminder as createStoredReminder, updateReminder as updateStoredReminder, deleteReminder as deleteStoredReminder, getReminders as getStoredReminders, setReminders as setStoredReminders, loadReminders } from './reminderStore.js';
import * as reminderDataService from './reminderService.js';
import { renderReminderList, renderReminderItem, renderTodayReminders } from './reminderRenderer.js';
import { setupSyncHandlers, loadRemindersFromFirestore, saveReminderToFirestore, listenForReminderUpdates } from './reminderSync.js';
import { setupNotificationHandlers, startReminderScheduler, sendReminderNotification, requestNotificationPermission } from './reminderNotifications.js';
import { saveNote } from '../services/adapters/notePersistenceAdapter.js';
import { generateEmbedding } from '../brain/embeddingService.js';
import { buildRagAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';
import { replaceInboxEntries } from '../services/inboxService.js';
import { getMessages, replaceMessages } from '../chat/messageStore.js';
import { createReminderFirestoreSync } from './reminderFirestoreSync.js';
import {
  normalizeReminderKeywords,
  extractReminderKeywords,
  normalizeSemanticEmbedding,
  normalizeRecurrence,
  normalizeIsoString,
  normalizeReminderRecord as normalizeReminderRecordHelper,
  normalizeReminderList as normalizeReminderListHelper,
  computeNextOccurrence,
  getReminderScheduleIso,
  cosineSimilarity,
} from './reminderSchemaHelpers.js';

// Shared reminder logic used by both the mobile and desktop pages.
// This module wires up Firebase-backed reminder UI handlers.

function compareRemindersForDisplay(a, b) {
  // Completed reminders go last.
  if (a?.completed && !b?.completed) return 1;
  if (!a?.completed && b?.completed) return -1;

  // Sort by due date with no-date reminders after dated reminders.
  const aTime = a?.dueAt ?? Infinity;
  const bTime = b?.dueAt ?? Infinity;

  return aTime - bTime;
}

const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const activeNotifications = new Map();
let notificationCleanupBound = false;
const SERVICE_WORKER_SCRIPT = 'service-worker.js';
const REMINDER_PERIODIC_SYNC_TAG = 'memory-cue-reminder-sync';
const SERVICE_WORKER_MESSAGE_TYPES = Object.freeze({
  updateScheduledReminders: 'memoryCue:updateScheduledReminders',
  checkScheduledReminders: 'memoryCue:checkScheduledReminders',
});
let serviceWorkerReadyPromise = null;
let backgroundSyncRegistrationPromise = null;
let backgroundSyncRegistrationSucceeded = false;
let firestoreMemoryBackfillModulePromise = null;

async function syncFirestoreMemoriesToLocalCache(notes = []) {
  if (!Array.isArray(notes) || !notes.length) {
    return;
  }

  if (!firestoreMemoryBackfillModulePromise) {
    firestoreMemoryBackfillModulePromise = import('../brain/backfillEmbeddings.js').catch((error) => {
      console.warn('[backfill] Failed to load Firestore memory backfill module', error);
      return null;
    });
  }

  const backfillModule = await firestoreMemoryBackfillModulePromise;
  const syncMemoriesFromFirestore = backfillModule?.syncMemoriesFromFirestore;
  if (typeof syncMemoriesFromFirestore !== 'function') {
    return;
  }

  try {
    await syncMemoriesFromFirestore(notes);
  } catch (error) {
    console.warn('[backfill] Failed to sync Firestore memories', error);
  }
}
const DEFAULT_CATEGORY = 'General';
const DISPLAY_TITLE_SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
]);
const SEEDED_CATEGORIES = Object.freeze([
  DEFAULT_CATEGORY,
  'General Appointments',
  'Home & Personal',
  'School – Appointments/Meetings',
  'School – Communication & Families',
  'School – Excursions & Events',
  'School – Grading & Assessment',
  'School – Prep & Resources',
  'School – To-Do',
  'Wellbeing & Support',
]);
const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';
const ORDER_INDEX_GAP = 1024;
const BACKUP_VERSION = 1;
const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
})();
const uid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
function fmtTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}
function fmtDayDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  });
}
function debounce(fn, delay = 300) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

function toast(message) {
  const scope = getGlobalScope();
  const notify = scope && typeof scope.toast === 'function' ? scope.toast : null;
  if (notify) {
    return notify(message);
  }
  if (typeof message === 'string' && message.trim()) {
    console.info('[reminder]', message);
  }
  return null;
}

function normalizeReminderRecord(reminder = {}, options = {}) {
  return normalizeReminderRecordHelper(reminder, {
    ...options,
    createId: uid,
    normalizeCategory,
  });
}

function normalizeReminderList(list = []) {
  return normalizeReminderListHelper(list, {
    createId: uid,
    normalizeCategory,
  });
}
async function ensureEmbeddingForItem(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const existing = normalizeSemanticEmbedding(item.semanticEmbedding);
  if (existing) {
    item.semanticEmbedding = existing;
    return item;
  }
  const text = [item.title, item.bodyText, item.body, item.notes]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim();
  if (!text) {
    return item;
  }
  const generated = normalizeSemanticEmbedding(await generateEmbedding(text));
  if (generated) {
    item.semanticEmbedding = generated;
  }
  return item;
}

function getGlobalScope() {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof self !== 'undefined') return self;
  if (typeof window !== 'undefined') return window;
  return {};
}

function getTimestampTriggerCtor() {
  const scope = getGlobalScope();
  const Trigger = scope && scope.TimestampTrigger;
  return typeof Trigger === 'function' ? Trigger : null;
}

async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') {
    return false;
  }

  if (Notification.permission === 'granted') return true;

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

function scheduleReminderNotification(reminder) {
  if (!reminder || typeof reminder !== 'object') {
    return;
  }

  const dueAtValue = typeof reminder.dueAt === 'string' && reminder.dueAt
    ? reminder.dueAt
    : reminder.due;
  if (!dueAtValue) {
    return;
  }

  const notifyMinutesBefore = Number.isFinite(reminder.notifyMinutesBefore)
    ? reminder.notifyMinutesBefore
    : 0;
  const notifyTime =
    new Date(dueAtValue).getTime() -
    notifyMinutesBefore * 60000;

  const delay = notifyTime - Date.now();
  if (delay <= 0) {
    return;
  }

  setTimeout(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Reminder', {
        body: reminder.text || reminder.title || '',
        icon: '/icons/icon-192.png',
        tag: reminder.id,
      });
    }
  }, delay);

  if (
    typeof navigator !== 'undefined' &&
    navigator.serviceWorker &&
    typeof navigator.serviceWorker.ready?.then === 'function'
  ) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({
        type: 'scheduleReminder',
        title: 'Reminder',
        body: reminder.text || reminder.title || '',
        time: notifyTime,
      });
    });
  }
}

function supportsNotificationTriggers() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (typeof ServiceWorkerRegistration === 'undefined') return false;
  if (typeof ServiceWorkerRegistration.prototype?.showNotification !== 'function') return false;
  return !!getTimestampTriggerCtor();
}

function resolveServiceWorkerUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return SERVICE_WORKER_SCRIPT;
  }
  try {
    return new URL(SERVICE_WORKER_SCRIPT, window.location.href).href;
  } catch {
    return SERVICE_WORKER_SCRIPT;
  }
}

async function ensureServiceWorkerRegistration() {
  if (serviceWorkerReadyPromise) {
    return serviceWorkerReadyPromise;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  serviceWorkerReadyPromise = (async () => {
    try {
      if (typeof window !== 'undefined' && window.MemoryCueServiceWorker && typeof window.MemoryCueServiceWorker.ensureRegistration === 'function') {
        await window.MemoryCueServiceWorker.ensureRegistration();
      }
      return await navigator.serviceWorker.ready;
    } catch (err) {
      console.warn('Service worker registration failed', err);
      return null;
    }
  })();
  return serviceWorkerReadyPromise;
}

async function postMessageToServiceWorker(message) {
  if (!message || typeof message !== 'object') {
    return false;
  }
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return false;
  }
  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return false;
    }
    const targets = new Set();
    if (navigator.serviceWorker.controller) {
      targets.add(navigator.serviceWorker.controller);
    }
    ['active', 'waiting', 'installing'].forEach((state) => {
      const worker = registration[state];
      if (worker) {
        targets.add(worker);
      }
    });
    let delivered = false;
    targets.forEach((worker) => {
      try {
        worker.postMessage(message);
        delivered = true;
      } catch (error) {
        console.warn('Failed posting message to service worker', error);
      }
    });
    return delivered;
  } catch (error) {
    console.warn('Unable to reach service worker', error);
    return false;
  }
}

async function setupBackgroundReminderSync() {
  if (supportsNotificationTriggers()) {
    return false;
  }
  if (backgroundSyncRegistrationSucceeded) {
    return true;
  }
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return false;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }
  if (backgroundSyncRegistrationPromise) {
    try {
      return await backgroundSyncRegistrationPromise;
    } catch {
      // Ignore errors from previous attempt and allow retry below.
    }
  }
  backgroundSyncRegistrationPromise = (async () => {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return false;
    }
    let registered = false;
    if ('periodicSync' in registration) {
      try {
        const tags = await registration.periodicSync.getTags();
        if (!Array.isArray(tags) || !tags.includes(REMINDER_PERIODIC_SYNC_TAG)) {
          await registration.periodicSync.register(REMINDER_PERIODIC_SYNC_TAG, {
            minInterval: 15 * 60 * 1000,
          });
        }
        registered = true;
      } catch (error) {
        console.warn('Periodic background sync unavailable', error);
      }
    }
    if (!registered && 'sync' in registration) {
      try {
        await registration.sync.register(REMINDER_PERIODIC_SYNC_TAG);
        registered = true;
      } catch (error) {
        console.warn('Background sync unavailable', error);
      }
    }
    return registered;
  })();
  try {
    const result = await backgroundSyncRegistrationPromise;
    if (result) {
      backgroundSyncRegistrationSucceeded = true;
    }
    return result;
  } catch (error) {
    console.warn('Background reminder sync setup failed', error);
    backgroundSyncRegistrationSucceeded = false;
    return false;
  } finally {
    backgroundSyncRegistrationPromise = null;
  }
}

async function syncScheduledRemindersWithServiceWorker(remindersPayload = [], { requestCheck = false } = {}) {
  if (supportsNotificationTriggers()) {
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return;
  }
  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return;
    }
    const delivered = await postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.updateScheduledReminders,
      reminders: Array.isArray(remindersPayload) ? remindersPayload : [],
    });
    if (requestCheck) {
      await postMessageToServiceWorker({
        type: SERVICE_WORKER_MESSAGE_TYPES.checkScheduledReminders,
      });
    }
    if (!delivered && typeof registration.update === 'function') {
      try {
        await registration.update();
      } catch {
        // Ignore update failures.
      }
    }
  } catch (error) {
    console.warn('Failed syncing reminders with service worker', error);
  }
}

async function cancelTriggerNotification(id, registrationOverride) {
  if (!supportsNotificationTriggers()) return;
  try {
    const registration = registrationOverride || (await ensureServiceWorkerRegistration());
    if (!registration) return;
    let notifications = [];
    try {
      notifications = await registration.getNotifications({ tag: id, includeTriggered: true });
    } catch {
      notifications = await registration.getNotifications({ tag: id });
    }
    for (const notification of notifications) {
      try { notification.close(); } catch { /* ignore close issues */ }
    }
  } catch {
    // ignore cancellation errors
  }
}

function closeActiveNotifications() {
  for (const notification of Array.from(activeNotifications.values())) {
    try {
      notification.close();
    } catch {
      // Ignore close errors so cleanup can continue for remaining notifications.
    }
  }
  activeNotifications.clear();
}

function bindNotificationCleanupHandlers() {
  if (notificationCleanupBound) {
    return;
  }
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  const cleanup = () => closeActiveNotifications();
  ['pagehide', 'beforeunload'].forEach((eventName) => {
    try {
      window.addEventListener(eventName, cleanup);
    } catch {
      // Ignore environments that do not support these events.
    }
  });
  notificationCleanupBound = true;
}

function normalizeCategory(value) {
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return DEFAULT_CATEGORY;
}

/**
 * Initialise the reminders UI and sync logic.
 * Pass in selectors for the elements the module should control.
 * Any selector can be omitted if the corresponding feature is not needed.
 *
 * @param {Object} sel - Map of selector strings for DOM elements.
 */
let activeReminderControllerApi = null;

export async function initReminders(sel = {}) {
  const $ = (s) => (typeof s === 'string' && s ? document.querySelector(s) : null);
  const $$ = (s) => (typeof s === 'string' && s ? Array.from(document.querySelectorAll(s)) : []);

  // Elements
  const title = $(sel.titleSel);
  const date = $(sel.dateSel);
  const time = $(sel.timeSel);
  const details = $(sel.detailsSel);
  const priority = $(sel.prioritySel);
  const categoryInput = $(sel.categorySel);
  const sortSelect = $(sel.sortSel);
  const saveBtn = $(sel.saveBtnSel);
  const cancelEditBtn = $(sel.cancelEditBtnSel);
  const list = $(sel.listSel);
  const PIN_TOGGLE_PINNED_CLASS = 'reminder-title-pinned';
  const PIN_TOGGLE_UNPINNED_CLASS = 'reminder-title-unpinned';
  const detailPanel = $(sel.detailPanelSel);
  const detailEmptyState = $(sel.detailEmptySel);
  const detailContent = $(sel.detailContentSel);
  const detailTitle = $(sel.detailTitleSel);
  const detailDue = $(sel.detailDueSel);
  const detailPriority = $(sel.detailPrioritySel);
  const detailCategory = $(sel.detailCategorySel);
  const detailNotes = $(sel.detailNotesSel);
  const detailNotesPlaceholder = detailNotes?.dataset?.placeholder || 'No notes added yet.';
  const detailClearBtn = $(sel.detailClearSel);
  const googleSignInBtns = $$(sel.googleSignInBtnSel);
  const googleSignOutBtns = $$(sel.googleSignOutBtnSel);
  const statusEl = $(sel.statusSel);
  const syncStatus = $(sel.syncStatusSel);
  const syncStatusPanel = typeof document !== 'undefined' ? document.getElementById('syncStatus') : null;
  const syncStatusDot = typeof document !== 'undefined' ? document.getElementById('mcStatus') : null;
  const syncStatusHeading = typeof document !== 'undefined' ? document.getElementById('drawerSyncHeading') : null;
  const syncStatusMessage = typeof document !== 'undefined' ? document.getElementById('sync-status') : null;
  const SYNC_STATUS_CONTENT = {
    online: {
      heading: 'Sync',
      label: 'Sync is on',
      message: 'Changes sync automatically while you are signed in.',
      tone: 'online',
    },
    local: {
      heading: 'Storage',
      label: 'Saved on this device',
      message: 'Your reminders are stored locally and ready to use.',
      tone: 'offline',
    },
    offline: {
      heading: 'Sync',
      label: 'Offline for now',
      message: 'Your reminders stay saved here and will sync again when you reconnect.',
      tone: 'offline',
    },
    error: {
      heading: 'Sync',
      label: 'Sync paused',
      message: 'Your reminders are still saved here. We will retry syncing shortly.',
      tone: 'error',
    },
  };
  const UNDO_DELETE_TIMEOUT_MS = 6000;
  const QUICK_ACTION_LONG_PRESS_MS = 500;
  let deleteUndoState = null;
  let detailSelectionId = null;
  let activeReminderQuickActionsMenu = null;
  let activeReminderQuickActionsCleanup = null;

  function closeReminderQuickActionsMenu() {
    if (typeof activeReminderQuickActionsCleanup === 'function') {
      activeReminderQuickActionsCleanup();
    }
    activeReminderQuickActionsCleanup = null;
    if (activeReminderQuickActionsMenu instanceof HTMLElement) {
      activeReminderQuickActionsMenu.remove();
    }
    activeReminderQuickActionsMenu = null;
  }

  function openReminderQuickActions(reminder) {
    if (!reminder || typeof reminder !== 'object') {
      return;
    }

    closeReminderQuickActionsMenu();
    const menu = document.createElement('div');
    menu.className = 'quick-actions-menu';
    menu.setAttribute('role', 'menu');

    const addAction = (label, dataAction, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = dataAction;
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        handler();
        closeReminderQuickActionsMenu();
        render();
      });
      menu.appendChild(button);
    };

    addAction('Create Reminder', 'reminder', () => {
      addItem({
        title: reminder.title,
        priority: reminder.priority || 'Medium',
        category: reminder.category || DEFAULT_CATEGORY,
        due: reminder.due || null,
        notes: typeof reminder.notes === 'string' ? reminder.notes : '',
      });
    });

    addAction('Convert to Note', 'note', () => {
      const content = [reminder.title, reminder.notes].filter((value) => typeof value === 'string' && value.trim()).join('\n\n');
      saveReflectionQuickNote(content || reminder.title || 'Reminder note');
    });

    addAction('Ask Assistant', 'assistant', () => {
      askAssistant(reminder.title || '').catch((error) => {
        console.warn('Ask assistant quick action failed', error);
      });
    });

    addAction('Snooze 5m', 'snooze-5', () => {
      snoozeReminder(reminder, 5);
    });

    addAction('Snooze 10m', 'snooze-10', () => {
      snoozeReminder(reminder, 10);
    });

    addAction('Snooze 30m', 'snooze-30', () => {
      snoozeReminder(reminder, 30);
    });

    addAction('Snooze 1h', 'snooze-60', () => {
      snoozeReminder(reminder, 60);
    });

    addAction('Snooze tomorrow', 'snooze-tomorrow', () => {
      snoozeReminder(reminder, 'tomorrow');
    });

    addAction('Archive', 'archive', () => {
      removeItem(reminder.id);
    });

    document.body.appendChild(menu);
    activeReminderQuickActionsMenu = menu;

    const handleOutsidePress = (event) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!menu.contains(event.target)) {
        closeReminderQuickActionsMenu();
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeReminderQuickActionsMenu();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePress, true);
    document.addEventListener('keydown', handleEscape);
    activeReminderQuickActionsCleanup = () => {
      document.removeEventListener('pointerdown', handleOutsidePress, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }

  function attachReminderLongPress(itemEl, reminder) {
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }
    let pressTimer = null;

    const start = () => {
      pressTimer = window.setTimeout(() => {
        openReminderQuickActions(reminder);
      }, QUICK_ACTION_LONG_PRESS_MS);
    };

    const cancel = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
      }
      pressTimer = null;
    };

    itemEl.addEventListener('touchstart', start, { passive: true });
    itemEl.addEventListener('touchend', cancel);
    itemEl.addEventListener('touchcancel', cancel);
    itemEl.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      start();
    });
    itemEl.addEventListener('pointerup', cancel);
    itemEl.addEventListener('pointerleave', cancel);
  }

  function clearUndoDeleteState(tokenId, { clearMessage = true } = {}) {
    if (!deleteUndoState) {
      return;
    }
    if (tokenId && deleteUndoState.tokenId !== tokenId) {
      return;
    }
    if (deleteUndoState.timeoutId) {
      clearTimeout(deleteUndoState.timeoutId);
    }
    if (clearMessage && statusEl && statusEl.dataset.undoToken === deleteUndoState.tokenId) {
      if (typeof statusEl.replaceChildren === 'function') {
        statusEl.replaceChildren();
      } else {
        statusEl.textContent = '';
      }
      delete statusEl.dataset.undoToken;
      delete statusEl.dataset.statusKind;
    }
    deleteUndoState = null;
  }

  function showDeleteUndoMessage(state) {
    if (!statusEl) {
      return;
    }
    const message = document.createElement('span');
    message.textContent = 'Reminder deleted.';
    const spacer = document.createTextNode(' ');
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.textContent = 'Undo';
    undoButton.className = 'status-undo';
    undoButton.addEventListener('click', () => undoDelete(state.tokenId));
    state.button = undoButton;
    if (typeof statusEl.replaceChildren === 'function') {
      statusEl.replaceChildren(message, spacer, undoButton);
    } else {
      statusEl.textContent = '';
      statusEl.append(message, spacer, undoButton);
    }
    statusEl.dataset.statusKind = 'undo';
    statusEl.dataset.undoToken = state.tokenId;
  }

  function captureReminderScrollPosition() {
    return {
      windowY: typeof window !== 'undefined' ? window.scrollY : 0,
      windowX: typeof window !== 'undefined' ? window.scrollX : 0,
      wrapperTop: listWrapper instanceof HTMLElement ? listWrapper.scrollTop : 0,
    };
  }

  function restoreReminderScrollPosition(position) {
    if (!position) {
      return;
    }

    const apply = () => {
      if (listWrapper instanceof HTMLElement) {
        listWrapper.scrollTop = position.wrapperTop || 0;
      }
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(position.windowX || 0, position.windowY || 0);
      }
    };

    apply();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(apply);
    }
  }

  function renderDetailPanel(reminder) {
    if (!detailPanel) {
      return;
    }
    const hasSelection = Boolean(reminder);
    detailPanel.dataset.state = hasSelection ? 'active' : 'empty';
    detailPanel.dataset.selectedId = hasSelection && reminder?.id ? reminder.id : '';

    if (detailEmptyState) {
      detailEmptyState.classList.toggle('hidden', hasSelection);
      detailEmptyState.setAttribute('aria-hidden', hasSelection ? 'true' : 'false');
    }
    if (detailContent) {
      detailContent.classList.toggle('hidden', !hasSelection);
      detailContent.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
    }

    if (!hasSelection) {
      if (detailTitle) detailTitle.textContent = '';
      if (detailDue) detailDue.textContent = '';
      if (detailPriority) detailPriority.textContent = '';
      if (detailCategory) detailCategory.textContent = '';
      if (detailNotes) {
        detailNotes.textContent = detailNotesPlaceholder;
        detailNotes.dataset.empty = 'true';
      }
      return;
    }

    if (detailTitle) detailTitle.textContent = reminder.title || 'Untitled reminder';
    if (detailDue) detailDue.textContent = formatDesktopDue(reminder);
    if (detailPriority) detailPriority.textContent = reminder.priority || 'Medium';
    if (detailCategory) detailCategory.textContent = reminder.category || DEFAULT_CATEGORY;
    if (detailNotes) {
      const noteText = typeof reminder.notes === 'string' ? reminder.notes.trim() : '';
      if (noteText) {
        detailNotes.textContent = noteText;
        detailNotes.dataset.empty = 'false';
      } else {
        detailNotes.textContent = detailNotesPlaceholder;
        detailNotes.dataset.empty = 'true';
      }
    }
  }

  function clearDetailSelection() {
    detailSelectionId = null;
    renderDetailPanel(null);
  }

  function applyDetailSelection(reminder) {
    detailSelectionId = reminder?.id || null;
    renderDetailPanel(reminder || null);
  }

  function syncDetailSelection() {
    if (!detailPanel) {
      return;
    }
    if (!detailSelectionId) {
      renderDetailPanel(null);
      return;
    }
    const current = items.find((entry) => entry?.id === detailSelectionId);
    if (current) {
      renderDetailPanel(current);
      return;
    }
    clearDetailSelection();
  }

  renderDetailPanel(null);

  function renderSyncIndicator(state, overrides = {}) {
    const config = SYNC_STATUS_CONTENT[state] || SYNC_STATUS_CONTENT.local;
    const details = typeof overrides === 'string'
      ? { message: overrides }
      : (overrides && typeof overrides === 'object' ? overrides : {});
    const heading = typeof details.heading === 'string' ? details.heading : config.heading;
    const label = typeof details.label === 'string' ? details.label : config.label;
    const message = typeof details.message === 'string' ? details.message : config.message;
    const tone = typeof details.tone === 'string' ? details.tone : config.tone;
    const indicatorStates = ['online', 'offline', 'error', 'local'];

    if (syncStatus) {
      indicatorStates.forEach((cls) => syncStatus.classList.remove(cls));
      if (indicatorStates.includes(state)) {
        syncStatus.classList.add(state);
      }
      syncStatus.dataset.state = state;
      syncStatus.textContent = label;
      if (label) {
        syncStatus.setAttribute('aria-label', label);
        syncStatus.setAttribute('title', label);
      } else {
        syncStatus.removeAttribute('aria-label');
        syncStatus.removeAttribute('title');
      }
    }

    if (syncStatusPanel instanceof HTMLElement) {
      indicatorStates.forEach((cls) => syncStatusPanel.classList.remove(cls));
      syncStatusPanel.classList.add(tone);
      syncStatusPanel.dataset.state = state;
      syncStatusPanel.setAttribute('title', message || label || '');
    }

    if (syncStatusDot instanceof HTMLElement) {
      ['online', 'offline', 'error', 'local'].forEach((cls) => syncStatusDot.classList.remove(cls));
      syncStatusDot.classList.add(tone === 'online' ? 'online' : 'offline');
      syncStatusDot.setAttribute('aria-label', label || message || '');
    }

    if (syncStatusHeading instanceof HTMLElement) {
      syncStatusHeading.textContent = heading;
    }

    if (syncStatusMessage instanceof HTMLElement) {
      syncStatusMessage.textContent = message;
    }
  }
  const notesEl = $(sel.notesSel);
  const saveNotesBtn = $(sel.saveNotesBtnSel);
  const loadNotesBtn = $(sel.loadNotesBtnSel);
  const countTotalEl = $(sel.countTotalSel);
  const googleUserName = $(sel.googleUserNameSel);
  const dateFeedback = $(sel.dateFeedbackSel);
  const voiceBtn = $(sel.voiceBtnSel);
  const notifBtn = $(sel.notifBtnSel);
  const moreBtn = $(sel.moreBtnSel);
  const moreMenu = $(sel.moreMenuSel);
  const copyMtlBtn = $(sel.copyMtlBtnSel);
  const importFile = $(sel.importFileSel);
  const exportBtn = $(sel.exportBtnSel);
  const importBtn = $(sel.importBtnSel);
  const syncAllBtn = $(sel.syncAllBtnSel);
  const syncUrlInput = $(sel.syncUrlInputSel);
  const saveSettings = $(sel.saveSettingsSel);
  const testSync = $(sel.testSyncSel);
  const openSettingsBtns = $$(sel.openSettingsSel);
  const settingsSection = $(sel.settingsSectionSel);
  const emptyStateEl = $(sel.emptyStateSel);
  const listWrapper = $(sel.listWrapperSel);
  const categoryDatalist = $(sel.categoryOptionsSel);
  const plannerContext = $(sel.plannerContextSel);
  const plannerLessonInput = $(sel.plannerLessonInputSel);
  const variant = sel.variant || 'mobile';
  const autoWireAuthButtons =
    typeof sel.autoWireAuthButtons === 'boolean' ? sel.autoWireAuthButtons : variant !== 'desktop';

  // Mobile reminders filter state and cache
  let mobileRemindersCache = [];
  let mobileRemindersTemperatureLabel = '';
  const REMINDER_SORT_OPTIONS = Object.freeze({
    created: 'created',
    timeRelevance: 'time-relevance',
  });
  let reminderSortMode = REMINDER_SORT_OPTIONS.created;

  function sortReminderRows(rows = []) {
    const sorted = Array.isArray(rows) ? rows.slice() : [];
    if (reminderSortMode === REMINDER_SORT_OPTIONS.timeRelevance) {
      const hasTimeReference = (reminder) => {
        if (!reminder || typeof reminder !== 'object') {
          return false;
        }
        if (typeof reminder.due === 'string' && reminder.due.trim()) {
          return true;
        }
        const sourceText = `${reminder.title || ''} ${reminder.notes || ''}`.toLowerCase();
        return /(\btoday\b|\btomorrow\b|\btonight\b|\bthis\s+(week|month|year)\b|\bnext\s+(week|month|year|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b|\byesterday\b|\bdue\b|\bdeadline\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(am|pm)\b)/i.test(sourceText);
      };

      const withTimeReferences = [];
      const withoutTimeReferences = [];
      sorted.forEach((reminder) => {
        if (hasTimeReference(reminder)) {
          withTimeReferences.push(reminder);
        } else {
          withoutTimeReferences.push(reminder);
        }
      });
      return withTimeReferences.concat(withoutTimeReferences);
    }
    return sorted;
  }

  // Returns a short, user-facing label for "today", e.g. "Tue 18 Nov"
  function getTodayLabelForHeader() {
    const now = new Date();
    return now.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  function updateMobileRemindersHeaderSubtitle() {
    if (variant !== 'mobile' || typeof document === 'undefined') {
      return;
    }
    const subtitleEl = document.getElementById('mobileRemindersHeaderSubtitle');
    if (!subtitleEl) {
      return;
    }
    const todayLabel = getTodayLabelForHeader();
    const activeCount = Array.isArray(items)
      ? items.filter((item) => item && item.done !== true).length
      : 0;

    let baseText = activeCount > 0
      ? `${activeCount} active ${activeCount === 1 ? 'reminder' : 'reminders'} \u2022 ${todayLabel}`
      : `No active reminders \u2022 ${todayLabel}`;

    if (mobileRemindersTemperatureLabel) {
      baseText += ` \u2022 ${mobileRemindersTemperatureLabel}`;
    }

    subtitleEl.textContent = baseText;
  }

  // Fetch current temperature using browser geolocation and Open-Meteo API.
  // If anything fails (no geolocation, permission denied, network error),
  // the function fails silently and leaves the subtitle without temperature.
  function fetchAndUpdateMobileTemperature() {
    if (variant !== 'mobile') {
      return;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      // Geolocation not available; nothing to do.
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          const { latitude, longitude } = position.coords;

          const url =
            'https://api.open-meteo.com/v1/forecast' +
            `?latitude=${encodeURIComponent(latitude)}` +
            `&longitude=${encodeURIComponent(longitude)}` +
            '&current_weather=true';

          fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error('Weather request failed');
              return res.json();
            })
            .then((data) => {
              if (
                data &&
                data.current_weather &&
                typeof data.current_weather.temperature === 'number'
              ) {
                const temp = Math.round(data.current_weather.temperature);
                mobileRemindersTemperatureLabel = `${temp}\u00B0C`; // e.g. "25°C"
                updateMobileRemindersHeaderSubtitle();
              }
            })
            .catch(() => {
              // Weather enrichment is optional; ignore transient network/API failures.
            });
        } catch {
          // Weather enrichment is optional; ignore geolocation payload issues.
        }
      },
      () => {
        // Geolocation permission denied or unavailable; weather remains optional.
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000, // up to 5 minutes old is fine
      }
    );
  }

  const LAST_DEFAULTS_KEY = 'mc:lastDefaults';

  const clearPlannerReminderContext = () => {
    if (plannerContext) {
      plannerContext.classList.add('hidden');
      plannerContext.setAttribute('aria-hidden', 'true');
      if (typeof plannerContext.replaceChildren === 'function') {
        plannerContext.replaceChildren();
      } else {
        plannerContext.textContent = '';
      }
    }
    if (plannerLessonInput) {
      plannerLessonInput.value = '';
      if (plannerLessonInput.dataset) {
        delete plannerLessonInput.dataset.lessonDayLabel;
        delete plannerLessonInput.dataset.lessonTitle;
        delete plannerLessonInput.dataset.lessonSummary;
      }
    }
  };

  const showPlannerReminderContext = (detail = {}) => {
    if (!plannerContext) {
      return;
    }
    const dayLabel = typeof detail.dayLabel === 'string' ? detail.dayLabel.trim() : '';
    const lessonTitle = typeof detail.lessonTitle === 'string' ? detail.lessonTitle.trim() : '';
    const summary = typeof detail.summary === 'string' ? detail.summary.trim() : '';
    const heading = document.createElement('p');
    heading.className = 'text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-base-content/60';
    heading.textContent = dayLabel ? `${dayLabel} lesson` : 'Planner lesson';
    const titleLine = document.createElement('p');
    titleLine.className = 'text-sm font-semibold text-base-content';
    titleLine.textContent = lessonTitle || summary || 'Planner reminder';
    const summaryLine = summary ? document.createElement('p') : null;
    if (summaryLine) {
      summaryLine.className = 'text-sm text-base-content/70';
      summaryLine.textContent = summary;
    }
    if (typeof plannerContext.replaceChildren === 'function') {
      plannerContext.replaceChildren(...[heading, titleLine, summaryLine].filter(Boolean));
    } else {
      plannerContext.textContent = '';
      plannerContext.append(heading, titleLine);
      if (summaryLine) {
        plannerContext.append(summaryLine);
      }
    }
    plannerContext.classList.remove('hidden');
    plannerContext.removeAttribute('aria-hidden');
  };

  const applyPlannerReminderPrefill = (detail = {}) => {
    if (!detail || typeof detail !== 'object') {
      return;
    }
    const plannerLessonId = typeof detail.plannerLessonId === 'string' ? detail.plannerLessonId : '';
    if (title && typeof detail.reminderTitle === 'string') {
      title.value = detail.reminderTitle;
    }
    if (details && typeof detail.reminderNotes === 'string') {
      details.value = detail.reminderNotes;
    }
    if (date && typeof detail.dueDate === 'string') {
      date.value = detail.dueDate;
    }
    if (plannerLessonInput) {
      plannerLessonInput.value = plannerLessonId;
      if (plannerLessonInput.dataset) {
        plannerLessonInput.dataset.lessonDayLabel = dayLabel;
        plannerLessonInput.dataset.lessonTitle = lessonTitle;
        plannerLessonInput.dataset.lessonSummary = summary;
      }
    }
    showPlannerReminderContext(detail);
  };

  function loadLastDefaults() {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(LAST_DEFAULTS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveLastDefaults(obj = {}) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(LAST_DEFAULTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  function updateDefaultsFrom(entry) {
    const prev = loadLastDefaults();
    const next = {
      category: normalizeCategory(entry?.category || prev.category || DEFAULT_CATEGORY),
      priority: entry?.priority || prev.priority || 'Medium',
      // repeat: entry?.repeat || prev.repeat || null,
    };
    saveLastDefaults(next);
  }

  const priorityChipSelector = 'fieldset#priorityChips input[name="priority"]';

  function getPriorityInputValue() {
    try {
      const chip = document.querySelector(`${priorityChipSelector}:checked`);
      if (chip && chip.value) {
        return chip.value;
      }
    } catch {
      // Ignore selector errors in environments without DOM APIs.
    }
    if (priority && typeof priority.value === 'string' && priority.value) {
      return priority.value;
    }
    return 'Medium';
  }

  function setPriorityInputValue(value) {
    const next = value || 'Medium';
    if (priority && typeof priority.value !== 'undefined') {
      priority.value = next;
    }
    try {
      const radios = Array.from(document.querySelectorAll(priorityChipSelector));
      if (!radios.length) {
        return;
      }
      let matched = false;
      radios.forEach((radio) => {
        const isMatch = radio.value === next;
        radio.checked = isMatch;
        matched = matched || isMatch;
      });
      if (!matched) {
        const fallback = radios.find((radio) => radio.value === 'Medium') || radios[0];
        if (fallback) {
          fallback.checked = true;
        }
      }
    } catch {
      // Ignore DOM update issues so the rest of the flow can continue.
    }
  }

  function applyStoredDefaultsToInputs() {
    const d = loadLastDefaults();
    if (d.category && categoryInput) categoryInput.value = d.category;
    if (d.priority) setPriorityInputValue(d.priority);
  }

  applyStoredDefaultsToInputs();

  const quickForm =
    typeof document !== 'undefined' ? document.getElementById('quickAddForm') : null;
  const quickInput =
    typeof document !== 'undefined' ? document.getElementById('reminderQuickAdd') : null;
  const quickBtn =
    typeof document !== 'undefined'
      ? document.getElementById('quickAddSubmit') || document.querySelector('[data-quick-add-submit]')
      : null;
  const quickVoiceBtn =
    typeof document !== 'undefined'
      ? document.getElementById('quickAddVoice') || document.getElementById('voiceBtn')
      : null;
  const quickAddParsingIndicator =
    typeof document !== 'undefined' ? document.getElementById('quickAddParsingIndicator') : null;
  const quickAddSuccessIndicator =
    typeof document !== 'undefined' ? document.getElementById('quickAddSuccessIndicator') : null;
  const pillVoiceBtn =
    typeof document !== 'undefined' ? document.querySelector('.pill-voice-btn') : null;
  // Track the currently focused input mode to prevent cross-triggering between quick add and search.
  let activeMode = null;
  let isQuickAddSubmitting = false;
  let stopQuickAddVoiceListening = null;
  const NOTES_STORAGE_KEY = 'memoryCueNotes';
  const FOLDERS_STORAGE_KEY = 'memoryCueFolders';
  const REFLECTION_FOLDER_NAME = 'Lesson – Reflections';
  const SMART_TAG_KEYWORDS = [
    'u14',
    'pressure',
    'transition',
    'year7',
    'year9',
    'netball',
    'footy',
    'voting',
    'preferential',
    'drill',
    'lesson',
  ];

  function parseQuickAddPrefixRoute(rawText) {
    const text = typeof rawText === 'string' ? rawText : '';
    const routes = [
      { kind: 'footy-drill', pattern: /^\s*footy\s+drill\s*:\s*/i },
      { kind: 'reflection', pattern: /^\s*reflection\s*:\s*/i },
      { kind: 'task', pattern: /^\s*task\s*:\s*/i },
    ];

    for (const route of routes) {
      if (route.pattern.test(text)) {
        return {
          kind: route.kind,
          text: text.replace(route.pattern, '').trim(),
        };
      }
    }

    return {
      kind: 'default',
      text: text.trim(),
    };
  }

  function readJsonArrayStorage(key, fallback = []) {
    if (typeof localStorage === 'undefined') {
      return Array.isArray(fallback) ? [...fallback] : [];
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return Array.isArray(fallback) ? [...fallback] : [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : Array.isArray(fallback) ? [...fallback] : [];
    } catch {
      return Array.isArray(fallback) ? [...fallback] : [];
    }
  }

  function ensureReflectionFolder() {
    const fallbackFolders = [{ id: 'unsorted', name: 'Unsorted', order: 0 }];
    const folders = readJsonArrayStorage(FOLDERS_STORAGE_KEY, fallbackFolders)
      .filter((folder) => folder && typeof folder === 'object' && typeof folder.id === 'string');

    const existing = folders.find((folder) => folder.name === REFLECTION_FOLDER_NAME);
    if (existing?.id) {
      return existing.id;
    }

    const usedIds = new Set(folders.map((folder) => folder.id));
    let nextId = 'lesson-reflections';
    let suffix = 1;
    while (usedIds.has(nextId)) {
      suffix += 1;
      nextId = `lesson-reflections-${suffix}`;
    }

    folders.push({
      id: nextId,
      name: REFLECTION_FOLDER_NAME,
      order: folders.length,
    });

    try {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    } catch {
      // Ignore storage write failures so quick-add does not crash.
    }

    return nextId;
  }

  function saveReflectionQuickNote(content) {
    const trimmed = typeof content === 'string' ? content.trim() : '';
    if (!trimmed || typeof localStorage === 'undefined') {
      return null;
    }

    const folderId = ensureReflectionFolder();
    const notes = readJsonArrayStorage(NOTES_STORAGE_KEY, []);
    const nowIso = new Date().toISOString();

    const note = {
      id: uid(),
      title: trimmed,
      body: trimmed,
      bodyHtml: trimmed,
      bodyText: trimmed,
      pinned: false,
      updatedAt: nowIso,
      folderId,
      semanticEmbedding: null,
    };

    notes.unshift(note);
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {
      return null;
    }

    return note;
  }

  function normalizeMemoryEntryType(type) {
    const value = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (value === 'note' || value === 'reminder' || value === 'drill' || value === 'idea' || value === 'task' || value === 'unknown') {
      return value;
    }
    return 'unknown';
  }

  function inferRelevantEntryType(query) {
    const normalized = typeof query === 'string' ? query.toLowerCase() : '';
    if (normalized.includes('remind')) return 'reminder';
    if (normalized.includes('drill') || normalized.includes('footy')) return 'drill';
    if (normalized.includes('task') || normalized.includes('todo') || normalized.includes('to do')) return 'task';
    if (normalized.includes('idea')) return 'idea';
    if (normalized.includes('note')) return 'note';
    return null;
  }

  function readMemoryEntries() {
    return getInboxEntries();
  }

  function extractTitle(text) {
    const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!normalized) {
      return 'Untitled note';
    }
    const words = normalized.split(' ').filter(Boolean);
    const firstWords = words.slice(0, 6).join(' ');
    return firstWords.length > 60 ? `${firstWords.slice(0, 60).trimEnd()}` : firstWords;
  }

  function extractTags(text) {
    const normalized = typeof text === 'string' ? text.toLowerCase() : '';
    const matches = SMART_TAG_KEYWORDS.filter((keyword) => normalized.includes(keyword));
    if (/\byear\s*7\b/.test(normalized)) {
      matches.push('year7');
    }
    if (/\byear\s*9\b/.test(normalized)) {
      matches.push('year9');
    }
    if (/\bvote\b/.test(normalized)) {
      matches.push('voting');
    }
    return [...new Set(matches)];
  }

  function sanitizeTags(tags) {
    if (!Array.isArray(tags)) {
      return [];
    }
    const cleaned = tags
      .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
      .filter(Boolean)
      .slice(0, 8);
    return [...new Set(cleaned)];
  }

  async function parseSmartEntryWithAI(text) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch is unavailable');
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

    const requestUrl = '/api/parse-entry';

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller?.signal,
      });
      if (!response.ok) {
        let responseBody = '';
        try {
          responseBody = await response.text();
        } catch (readError) {
          responseBody = `[unavailable: ${readError?.message || 'failed to read response body'}]`;
        }
        console.error('AI parse request failed', {
          url: requestUrl,
          status: response.status,
          body: responseBody,
        });
        throw new Error(`AI parse failed (${response.status})`);
      }
      const data = await response.json();
      return {
        type: typeof data?.type === 'string' ? data.type.trim().toLowerCase() : 'unknown',
        title: typeof data?.title === 'string' ? data.title.trim() : extractTitle(text),
        tags: sanitizeTags(Array.isArray(data?.tags) ? data.tags : extractTags(text)),
        reminderDate: typeof data?.reminderDate === 'string' ? data.reminderDate : null,
        metadata: data?.metadata && typeof data.metadata === 'object' ? data.metadata : {},
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function parseSmartEntryWithFallback(text) {
    return {
      type: 'unknown',
      title: extractTitle(text),
      tags: extractTags(text),
      reminderDate: null,
      metadata: {},
    };
  }

  async function createSmartEntry(text) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText) {
      return null;
    }

    const fallbackFields = parseSmartEntryWithFallback(normalizedText);
    const resolvedType = normalizeMemoryEntryType(fallbackFields.type);
    const resolvedTitle = fallbackFields.title;
    const resolvedTags = sanitizeTags(fallbackFields.tags);
    const resolvedReminderDate = null;

    const nowIso = new Date().toISOString();
    const smartEntry = {
      id: Date.now().toString(),
      type: resolvedType,
      title: resolvedTitle || fallbackFields.title,
      content: normalizedText,
      tags: resolvedTags,
      reminderDate: resolvedReminderDate,
      dateCreated: nowIso,
      body: normalizedText,
      bodyHtml: normalizedText,
      bodyText: normalizedText,
      pinned: false,
      updatedAt: nowIso,
      folderId: 'unsorted',
      semanticEmbedding: null,
    };

    const savedEntry = saveNote({
      text: normalizedText,
      title: smartEntry.title,
      tags: smartEntry.tags,
      folderId: smartEntry.folderId,
      source: 'reminder',
      parsedType: smartEntry.type,
    });

    if (!savedEntry) {
      console.error('Failed to save smart entry');
      return null;
    }

    smartEntry.id = savedEntry.id;
    smartEntry.createdAt = savedEntry.createdAt;
    smartEntry.updatedAt = savedEntry.updatedAt;

    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(
          new CustomEvent('memoryCue:notesUpdated', { detail: { entry: smartEntry } }),
        );
      }
    } catch (error) {
      console.error('Failed to dispatch notes refresh event', error);
    }

    // Best-effort AI enrichment must never block immediate save + render.
    parseSmartEntryWithAI(normalizedText)
      .then((parsedFields) => {
        if (!parsedFields || typeof localStorage === 'undefined') {
          return;
        }
        const storedNotes = readJsonArrayStorage(NOTES_STORAGE_KEY, []);
        const noteIndex = storedNotes.findIndex((entry) => entry?.id === smartEntry.id);
        if (noteIndex < 0) {
          return;
        }
        const existing = storedNotes[noteIndex] || {};
        const updatedEntry = {
          ...existing,
          type:
            typeof parsedFields.type === 'string' && parsedFields.type.trim()
              ? parsedFields.type.trim()
              : existing.type,
          title:
            typeof parsedFields.title === 'string' && parsedFields.title.trim()
              ? parsedFields.title.trim().slice(0, 60)
              : existing.title,
          tags: sanitizeTags(parsedFields?.tags?.length ? parsedFields.tags : existing.tags),
          reminderDate:
            typeof parsedFields.reminderDate === 'string' && parsedFields.reminderDate.trim()
              ? parsedFields.reminderDate
              : existing.reminderDate || null,
          updatedAt: new Date().toISOString(),
        };
        storedNotes[noteIndex] = updatedEntry;
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(storedNotes));
        try {
          if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
            document.dispatchEvent(
              new CustomEvent('memoryCue:notesUpdated', { detail: { entry: updatedEntry } }),
            );
          }
        } catch (error) {
          console.error('Failed to dispatch notes refresh event after AI enrichment', error);
        }
      })
      .catch((error) => {
        console.warn('AI smart capture failed, using fallback classifier', error);
      });

    return smartEntry;
  }

  function buildQuickReminder(titleText, dueOverride) {
    const d = loadLastDefaults();
    const dueIso = typeof dueOverride === 'string' && dueOverride ? dueOverride : null;

    return {
      title: (titleText || '').trim(),
      priority: d.priority || getPriorityInputValue(),
      category: normalizeCategory(d.category || categoryInput?.value || DEFAULT_CATEGORY),
      notes: '',
      due: dueIso,
      pinToToday: false,
      semanticEmbedding: null,
    };
  }


  function parseInboxTimeQuery(rawQuery, nowOverride = null) {
    const queryText = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (!queryText) {
      return { keywordQuery: '', timeRange: null };
    }

    const now = nowOverride instanceof Date && !Number.isNaN(nowOverride.getTime())
      ? new Date(nowOverride)
      : new Date();
    const normalized = queryText.toLowerCase();
    const dayRegex = /\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i;
    const timeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
    const todayRegex = /\btoday\b/i;
    const yesterdayRegex = /\byesterday\b/i;

    const dayMatch = normalized.match(dayRegex);
    const timeMatch = normalized.match(timeRegex);
    const todayMatch = normalized.match(todayRegex);
    const yesterdayMatch = normalized.match(yesterdayRegex);

    const parseTimeParts = () => {
      if (!timeMatch) return null;
      let hours = Number.parseInt(timeMatch[1], 10);
      const minutes = Number.parseInt(timeMatch[2] || '0', 10);
      const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
      if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) {
        return null;
      }
      if (meridiem === 'pm' && hours < 12) {
        hours += 12;
      } else if (meridiem === 'am' && hours === 12) {
        hours = 0;
      }
      if (hours > 23) {
        return null;
      }
      return { hours, minutes };
    };

    const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const stripMatches = () => {
      let cleaned = queryText;
      if (dayMatch) {
        cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(dayMatch[0])}\\b`, 'i'), ' ');
      }
      if (todayMatch) {
        cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(todayMatch[0])}\\b`, 'i'), ' ');
      }
      if (yesterdayMatch) {
        cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(yesterdayMatch[0])}\\b`, 'i'), ' ');
      }
      if (timeMatch) {
        cleaned = cleaned.replace(new RegExp(escapeRegex(timeMatch[0]), 'i'), ' ');
      }
      return cleaned.replace(/\s+/g, ' ').trim();
    };

    const buildDayRange = (dayOffset = 0) => {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() + dayOffset);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      return { start: dayStart.getTime(), end: dayEnd.getTime() };
    };

    const timeParts = parseTimeParts();
    if (dayMatch && timeParts) {
      const token = dayMatch[1].slice(0, 3).toLowerCase();
      const targetDowMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const targetDow = targetDowMap[token];
      if (typeof targetDow === 'number') {
        const target = new Date(now);
        const diff = (targetDow - target.getDay() + 7) % 7;
        target.setDate(target.getDate() + diff);
        target.setHours(timeParts.hours, timeParts.minutes, 0, 0);
        return {
          keywordQuery: stripMatches(),
          timeRange: {
            start: target.getTime() - 60 * 60 * 1000,
            end: target.getTime() + 60 * 60 * 1000,
          },
        };
      }
    }

    if (todayMatch || yesterdayMatch) {
      if (timeParts) {
        const target = new Date(now);
        if (yesterdayMatch) {
          target.setDate(target.getDate() - 1);
        }
        target.setHours(timeParts.hours, timeParts.minutes, 0, 0);
        return {
          keywordQuery: stripMatches(),
          timeRange: {
            start: target.getTime() - 60 * 60 * 1000,
            end: target.getTime() + 60 * 60 * 1000,
          },
        };
      }

      return {
        keywordQuery: stripMatches(),
        timeRange: buildDayRange(yesterdayMatch ? -1 : 0),
      };
    }

    return {
      keywordQuery: queryText,
      timeRange: null,
    };
  }

  function readInboxSearchNotes() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function buildInboxSearchEntries() {
    const reminderEntries = (Array.isArray(items) ? items : []).map((item) => ({
      id: item?.id || '',
      type: 'reminder',
      title: item?.title || '',
      body: item?.notes || '',
      category: item?.category || '',
      tags: Array.isArray(item?.tags) ? item.tags : [],
      relatedIds: [],
      createdAt: Number.isFinite(item?.createdAt) ? new Date(item.createdAt).toISOString() : '',
      updatedAt: Number.isFinite(item?.updatedAt) ? new Date(item.updatedAt).toISOString() : '',
      timestamp: Number.isFinite(item?.createdAt) ? item.createdAt : null,
      semanticEmbedding: normalizeSemanticEmbedding(item?.semanticEmbedding),
    }));
    const noteEntries = readInboxSearchNotes().map((note) => {
      const noteTime = typeof note?.updatedAt === 'string' ? Date.parse(note.updatedAt) : Number.NaN;
      const createdTime = typeof note?.createdAt === 'string' ? Date.parse(note.createdAt) : Number.NaN;
      return {
        id: note?.id || '',
        type: 'note',
        title: note?.title || '',
        body: note?.bodyText || note?.body || '',
        category: note?.metadata?.type || '',
        tags: Array.isArray(note?.metadata?.tags) ? note.metadata.tags : [],
        relatedIds: Array.isArray(note?.relatedIds) ? note.relatedIds : [],
        createdAt: typeof note?.createdAt === 'string' ? note.createdAt : '',
        updatedAt: typeof note?.updatedAt === 'string' ? note.updatedAt : '',
        timestamp: Number.isFinite(noteTime) ? noteTime : (Number.isFinite(createdTime) ? createdTime : null),
        semanticEmbedding: normalizeSemanticEmbedding(note?.semanticEmbedding),
      };
    });

    const memoryEntries = readMemoryEntries().map((entry) => {
      const updatedTime = Number.isFinite(entry?.updatedAt)
        ? entry.updatedAt
        : (typeof entry?.updatedAt === 'string' ? Date.parse(entry.updatedAt) : Number.NaN);
      const createdTime = Number.isFinite(entry?.createdAt)
        ? entry.createdAt
        : (typeof entry?.createdAt === 'string' ? Date.parse(entry.createdAt) : Number.NaN);
      const entryText = typeof entry?.text === 'string' ? entry.text : '';
      return {
        id: typeof entry?.id === 'string' ? entry.id : '',
        type: normalizeMemoryEntryType(entry?.type),
        title: entryText ? extractTitle(entryText) : (typeof entry?.title === 'string' ? entry.title : ''),
        body: entryText || (typeof entry?.body === 'string' ? entry.body : ''),
        category: typeof entry?.category === 'string' ? entry.category : '',
        tags: Array.isArray(entry?.tags) ? entry.tags : [],
        relatedIds: Array.isArray(entry?.relatedIds) ? entry.relatedIds : [],
        createdAt: Number.isFinite(createdTime) ? new Date(createdTime).toISOString() : '',
        updatedAt: Number.isFinite(updatedTime) ? new Date(updatedTime).toISOString() : '',
        timestamp: Number.isFinite(updatedTime) ? updatedTime : (Number.isFinite(createdTime) ? createdTime : null),
        semanticEmbedding: null,
      };
    });

    return [...reminderEntries, ...noteEntries, ...memoryEntries];
  }


  function buildSearchHaystack(entry) {
    const tags = Array.isArray(entry?.tags) ? entry.tags.join(' ') : '';
    return `${entry?.title || ''} ${entry?.body || ''} ${entry?.category || ''} ${tags}`.toLowerCase();
  }

  async function semanticSearchEntries(query, entries, excludedEntries = []) {
    const embedding = normalizeSemanticEmbedding(await generateEmbedding(query));
    if (!embedding) {
      return [];
    }
    const similarityThreshold = 0.72;
    const excluded = new Set(excludedEntries);
    const scored = entries
      .filter((entry) => !excluded.has(entry))
      .map((entry) => ({
        entry,
        score: cosineSimilarity(embedding, entry.semanticEmbedding),
      }))
      .filter((candidate) => candidate.score >= similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .map((candidate) => ({
        ...candidate.entry,
        isSemanticMatch: true,
      }));
    return scored;
  }

  function keywordSearchEntries(query, entries) {
    const parsed = parseInboxTimeQuery(query);
    const keywords = (parsed.keywordQuery || '')
      .toLowerCase()
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const matches = entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.body}`.toLowerCase();
      const keywordMatch = !keywords.length || keywords.every((word) => haystack.includes(word));
      if (!keywordMatch) {
        return false;
      }
      if (!parsed.timeRange) {
        return true;
      }
      if (!Number.isFinite(entry.timestamp)) {
        return false;
      }
      return entry.timestamp >= parsed.timeRange.start && entry.timestamp <= parsed.timeRange.end;
    });

    matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return matches;
  }

  function formatRagContext(entries) {
    const lines = ['=== MEMORY CONTEXT START ==='];
    entries.forEach((entry, index) => {
      const dateLabel = Number.isFinite(entry.timestamp)
        ? new Date(entry.timestamp).toISOString().slice(0, 10)
        : 'No date';
      lines.push(`[${index + 1}] Type: ${entry.type || 'Unknown'}`);
      lines.push(`    Title: ${entry.title || '(untitled)'}`);
      lines.push(`    Date: ${dateLabel}`);
      lines.push(`    Notes: ${entry.body || ''}`);
      lines.push('');
    });
    lines.push('=== MEMORY CONTEXT END ===');
    return lines.join('\n');
  }

  async function buildRagContext(query, maxResults = 8) {
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const safeMaxResults = Number.isFinite(maxResults)
      ? Math.max(1, Math.min(50, Math.floor(maxResults)))
      : 8;
    if (!trimmedQuery) {
      return formatRagContext([]);
    }

    const entries = buildInboxSearchEntries();
    const semanticMatches = await semanticSearchEntries(trimmedQuery, entries);
    const topMatches = semanticMatches.length
      ? semanticMatches.slice(0, safeMaxResults)
      : keywordSearchEntries(trimmedQuery, entries).slice(0, safeMaxResults);

    return formatRagContext(topMatches);
  }

  async function askAssistant(query) {
    const context = await buildRagContext(query);
    const entries = buildInboxSearchEntries();
    const relevantType = inferRelevantEntryType(query);
    const filteredEntries = relevantType
      ? entries.filter((entry) => entry.type === relevantType)
      : entries;
    const selectedEntries = (filteredEntries.length ? filteredEntries : entries)
      .slice(0, 8)
      .map((entry) => ({
        id: entry.id,
        type: normalizeMemoryEntryType(entry.type),
        title: entry.title,
        body: entry.body,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        relatedIds: Array.isArray(entry.relatedIds) ? entry.relatedIds : [],
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }));

    const requestBody = buildRagAssistantRequest({
      question: query,
      contextText: context,
      entries: selectedEntries,
      schemaVersion: 2,
    });

    try {
      return await requestAssistantChat(requestBody, {
        fallbackReply: 'I could not read an assistant response.',
      });
    } catch (error) {
      console.error('[RAG assistant] request failed while calling /api/assistant-chat', {
        error,
        query,
      });
      return 'Sorry, something went wrong while contacting the assistant.';
    }
  }


  function setupInboxSearch() {
    const inboxSearchInput = typeof document !== 'undefined' ? document.getElementById('inboxSearchInput') : null;
    const inboxSearchResults = typeof document !== 'undefined' ? document.getElementById('inboxSearchResults') : null;
    const inboxSearchClear = typeof document !== 'undefined' ? document.getElementById('inboxSearchClear') : null;
    if (!inboxSearchInput || !inboxSearchResults) {
      return;
    }

    // Keep search behavior scoped to the search field focus state.
    inboxSearchInput.addEventListener('focus', () => {
      activeMode = 'search';
    });

    const formatDateLabel = (timestamp) => {
      if (!Number.isFinite(timestamp)) {
        return 'No date';
      }
      try {
        return new Date(timestamp).toLocaleString();
      } catch {
        return 'No date';
      }
    };

    const escapeHtml = (value) => String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    const highlightMatch = (value, query) => {
      const raw = String(value || '');
      if (!query) {
        return escapeHtml(raw);
      }
      const parts = query
        .toLowerCase()
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      if (!parts.length) {
        return escapeHtml(raw);
      }
      let highlighted = escapeHtml(raw);
      parts.forEach((part) => {
        const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!escapedPart) return;
        highlighted = highlighted.replace(
          new RegExp(`(${escapedPart})`, 'gi'),
          '<mark class="inbox-search-match">$1</mark>',
        );
      });
      return highlighted;
    };

    const buildCombinedEntries = () => buildInboxSearchEntries();

    let autocompleteResults = [];
    let autocompleteIndex = -1;
    let lastAutocompleteQuery = null;
    let autocompleteDebounceTimer = null;

    const closeAutocomplete = () => {
      autocompleteResults = [];
      autocompleteIndex = -1;
      lastAutocompleteQuery = null;
      inboxSearchResults.innerHTML = '';
      inboxSearchResults.dataset.mode = '';
    };

    const renderResults = (results, options = {}) => {
      const limit = Number.isFinite(options.limit) ? options.limit : 20;
      const query = options.query || '';
      const selectedIndex = Number.isInteger(options.selectedIndex) ? options.selectedIndex : -1;
      const mode = options.mode || '';
      inboxSearchResults.innerHTML = '';
      inboxSearchResults.dataset.mode = mode;
      if (!results.length) {
        if (mode === 'autocomplete') {
          const emptyMessage = document.createElement('div');
          emptyMessage.className = 'inbox-search-empty text-xs opacity-70 py-2 px-2';
          emptyMessage.textContent = 'No matches';
          inboxSearchResults.appendChild(emptyMessage);
        }
        return;
      }
      const fragment = document.createDocumentFragment();
      results.slice(0, limit).forEach((entry, index) => {
        const li = document.createElement('li');
        li.className = 'inbox-search-result-item text-xs py-1 border-b border-base-300/60';
        if (mode === 'autocomplete') {
          li.classList.add('inbox-search-result-item--autocomplete');
          li.setAttribute('role', 'option');
          li.tabIndex = -1;
          if (index === selectedIndex) {
            li.classList.add('is-active');
          }
        }

        const badge = document.createElement('span');
        badge.className = 'badge badge-outline badge-xs mr-2';
        badge.textContent = entry.type;

        const title = document.createElement('span');
        title.className = 'inbox-search-result-title';
        title.innerHTML = highlightMatch(entry.title || '(untitled)', query);

        const date = document.createElement('div');
        date.className = 'opacity-70';
        date.textContent = formatDateLabel(entry.timestamp);

        const metaParts = [];
        if (entry.category) {
          metaParts.push(`Category: ${entry.category}`);
        }
        if (Array.isArray(entry.tags) && entry.tags.length) {
          metaParts.push(`Tags: ${entry.tags.join(', ')}`);
        }
        const meta = document.createElement('div');
        meta.className = 'opacity-70';
        meta.innerHTML = highlightMatch(metaParts.join(' • '), query);

        const relatedLabel = document.createElement('div');
        relatedLabel.className = 'opacity-60 italic';
        relatedLabel.textContent = 'Related results';

        if (mode === 'autocomplete') {
          li.addEventListener('mousedown', (event) => {
            event.preventDefault();
            inboxSearchInput.value = entry.title || '';
            runSearch();
            closeAutocomplete();
          });
        }

        li.appendChild(badge);
        li.appendChild(title);
        if (metaParts.length) {
          li.appendChild(meta);
        }
        li.appendChild(date);
        if (entry.isSemanticMatch && mode !== 'autocomplete') {
          li.appendChild(relatedLabel);
        }
        fragment.appendChild(li);
      });
      inboxSearchResults.appendChild(fragment);
    };

    async function semanticSearch(query, entries, excludedEntries = []) {
      return semanticSearchEntries(query, entries, excludedEntries);
    }

    const runSearch = async () => {
      if (activeMode !== 'search' && document.activeElement !== inboxSearchInput) {
        return;
      }
      const query = inboxSearchInput.value || '';
      const trimmed = query.trim();
      if (inboxSearchClear) {
        inboxSearchClear.hidden = !trimmed;
      }
      if (!trimmed) {
        inboxSearchResults.innerHTML = '';
        return;
      }

      const parsed = parseInboxTimeQuery(trimmed);
      const keywords = (parsed.keywordQuery || '')
        .toLowerCase()
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean);

      const combined = buildCombinedEntries();
      const matches = combined.filter((entry) => {
        const haystack = buildSearchHaystack(entry);
        const keywordMatch = !keywords.length || keywords.every((word) => haystack.includes(word));
        if (!keywordMatch) {
          return false;
        }
        if (!parsed.timeRange) {
          return true;
        }
        if (!Number.isFinite(entry.timestamp)) {
          return false;
        }
        return entry.timestamp >= parsed.timeRange.start && entry.timestamp <= parsed.timeRange.end;
      });

      matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const combinedResults = [...matches];
      if (matches.length < 5) {
        const semanticMatches = await semanticSearch(parsed.keywordQuery || trimmed, combined, matches);
        combinedResults.push(...semanticMatches);
      }

      renderResults(combinedResults);
    };

    const findAutocompleteResults = (query) => {
      const lowerQuery = query.toLowerCase();
      const matches = buildCombinedEntries().filter((entry) => buildSearchHaystack(entry).includes(lowerQuery));
      matches.sort((a, b) => {
        const aHaystack = buildSearchHaystack(a);
        const bHaystack = buildSearchHaystack(b);
        const aStarts = aHaystack.startsWith(lowerQuery);
        const bStarts = bHaystack.startsWith(lowerQuery);
        if (aStarts !== bStarts) {
          return aStarts ? -1 : 1;
        }
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
      return matches.slice(0, 8);
    };

    const renderAutocomplete = (query) => {
      autocompleteResults = findAutocompleteResults(query);
      autocompleteIndex = autocompleteResults.length ? 0 : -1;
      renderResults(autocompleteResults, {
        limit: 8,
        query,
        selectedIndex: autocompleteIndex,
        mode: 'autocomplete',
      });
    };

    const rerenderAutocomplete = () => {
      renderResults(autocompleteResults, {
        limit: 8,
        query: inboxSearchInput.value.trim(),
        selectedIndex: autocompleteIndex,
        mode: 'autocomplete',
      });
    };

    const queueAutocomplete = () => {
      if (activeMode !== 'search' && document.activeElement !== inboxSearchInput) {
        return;
      }
      const trimmed = (inboxSearchInput.value || '').trim();
      if (trimmed === lastAutocompleteQuery) {
        return;
      }
      if (autocompleteDebounceTimer) {
        clearTimeout(autocompleteDebounceTimer);
      }
      autocompleteDebounceTimer = setTimeout(() => {
        lastAutocompleteQuery = trimmed;
        if (!trimmed) {
          closeAutocomplete();
          return;
        }
        renderAutocomplete(trimmed);
      }, 120);
    };

    const selectAutocompleteResult = () => {
      if (autocompleteIndex < 0 || autocompleteIndex >= autocompleteResults.length) {
        return;
      }
      const selectedEntry = autocompleteResults[autocompleteIndex];
      inboxSearchInput.value = selectedEntry.title || '';
      runSearch();
      closeAutocomplete();
    };

    inboxSearchInput.addEventListener('input', () => {
      queueAutocomplete();
      runSearch();
    });
    inboxSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        // Search Enter should never trigger quick add submission.
        event.preventDefault();
        if (inboxSearchResults.dataset.mode === 'autocomplete' && autocompleteIndex >= 0) {
          selectAutocompleteResult();
        }
        return;
      }
      if (inboxSearchResults.dataset.mode !== 'autocomplete') {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!autocompleteResults.length) return;
        autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteResults.length - 1);
        rerenderAutocomplete();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!autocompleteResults.length) return;
        autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
        rerenderAutocomplete();
      } else if (event.key === 'Enter') {
        if (autocompleteIndex >= 0) {
          event.preventDefault();
          selectAutocompleteResult();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeAutocomplete();
      }
    });
    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Node)) return;
      if (event.target === inboxSearchInput || inboxSearchResults.contains(event.target)) {
        return;
      }
      closeAutocomplete();
    });

    if (inboxSearchClear) {
      inboxSearchClear.addEventListener('click', () => {
        inboxSearchInput.value = '';
        closeAutocomplete();
        inboxSearchClear.hidden = true;
        inboxSearchInput.focus();
      });
    }

    document.addEventListener('memoryCue:remindersUpdated', runSearch);
  }

  async function quickAddNow(options = {}) {
    const forcedText = typeof options.forceText === 'string' ? options.forceText.trim() : '';
    if (!quickInput && !forcedText) return null;
    if (isQuickAddSubmitting) {
      return null;
    }
    if (typeof stopQuickAddVoiceListening === 'function') {
      try {
        stopQuickAddVoiceListening();
      } catch {}
    }
    const text =
      typeof options.forceText === 'string'
        ? options.forceText
        : typeof options.text === 'string'
          ? options.text
          : (quickInput.value || '').trim();
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return null;

    const hasStructuredReminderPayload =
      options?.dueDate != null
      || options?.notifyAt != null
      || (typeof options?.category === 'string' && options.category.trim())
      || (typeof options?.priority === 'string' && options.priority.trim())
      || (typeof options?.notes === 'string' && options.notes.trim());
    const quickAddSource = typeof options?.source === 'string' && options.source.trim()
      ? options.source.trim()
      : 'quick-add';

    isQuickAddSubmitting = true;
    if (quickInput && typeof quickInput.disabled !== 'undefined') {
      quickInput.disabled = true;
      quickInput.setAttribute('aria-busy', 'true');
    }
    if (quickAddParsingIndicator instanceof HTMLElement) {
      quickAddParsingIndicator.hidden = false;
    }
    if (quickBtn && typeof quickBtn.disabled !== 'undefined') {
      quickBtn.disabled = true;
    }

    let entry = null;

    try {
      const routed = parseQuickAddPrefixRoute(t);
      const routedText = routed.text || t;
      const inferredSchedule = hasStructuredReminderPayload
        ? { dueDate: null, notifyAt: null, cleanedText: routedText }
        : parseReminderScheduleFromText(routedText);
      if (routed.kind === 'reflection') {
        entry = saveReflectionQuickNote(routedText);
      } else {
          const basePayload = buildQuickReminder(inferredSchedule.cleanedText || routedText);
          const optionDueIso =
            options?.dueDate instanceof Date && !Number.isNaN(options.dueDate.getTime())
              ? options.dueDate.toISOString()
              : typeof options?.dueDate === 'string' && options.dueDate.trim()
                ? options.dueDate.trim()
                : null;

          if (optionDueIso) {
            basePayload.dueAt = optionDueIso;
          } else if (inferredSchedule.dueDate instanceof Date && !Number.isNaN(inferredSchedule.dueDate.getTime())) {
            basePayload.dueAt = inferredSchedule.dueDate.toISOString();
          }
          if (options?.notifyAt instanceof Date && !Number.isNaN(options.notifyAt.getTime())) {
            basePayload.notifyAt = options.notifyAt.toISOString();
          } else if (typeof options?.notifyAt === 'string' && options.notifyAt.trim()) {
            basePayload.notifyAt = options.notifyAt.trim();
          } else if (inferredSchedule.notifyAt instanceof Date && !Number.isNaN(inferredSchedule.notifyAt.getTime())) {
            basePayload.notifyAt = inferredSchedule.notifyAt.toISOString();
          }

          if (typeof options?.category === 'string' && options.category.trim()) {
            basePayload.category = options.category.trim();
          }
          if (typeof options?.priority === 'string' && options.priority.trim()) {
            basePayload.priority = options.priority.trim();
          }
          if (typeof options?.notes === 'string' && options.notes.trim()) {
            basePayload.notes = options.notes.trim();
          }

          if (routed.kind === 'task') {
            basePayload.category = 'Tasks';
          } else if (routed.kind === 'footy-drill') {
            basePayload.category = 'Footy – Drills';
          }

          entry = createReminderFromPayload(basePayload, { closeSheet: false });
          if (quickAddSource !== 'inbox-swipe') {
            saveInboxEntry({
              text: t,
              source: quickAddSource,
              parsedType: 'reminder',
              entryPoint: 'reminders.quickAddNow',
              metadata: {
                mirroredReminderId: entry?.id || null,
              },
            });
          }
      }

      if (entry && typeof document !== 'undefined') {
        if (quickInput instanceof HTMLInputElement) {
          quickInput.value = '';
          try {
            quickInput.focus({ preventScroll: true });
          } catch {
            quickInput.focus();
          }
        }
        try {
          document.dispatchEvent(
            new CustomEvent('reminder:quick-add:complete', { detail: { entry } }),
          );
        } catch {
          // Ignore dispatch issues so the add flow can finish silently.
        }
        if (quickAddSuccessIndicator instanceof HTMLElement) {
          quickAddSuccessIndicator.hidden = false;
          setTimeout(() => {
            quickAddSuccessIndicator.hidden = true;
          }, 1200);
        }
      }
    } finally {
      if (quickInput && typeof quickInput.disabled !== 'undefined') {
        quickInput.disabled = false;
        quickInput.setAttribute('aria-busy', 'false');
      }
      if (quickAddParsingIndicator instanceof HTMLElement) {
        quickAddParsingIndicator.hidden = true;
      }
      if (quickBtn && typeof quickBtn.disabled !== 'undefined') {
        quickBtn.disabled = false;
      }
      isQuickAddSubmitting = false;
    }

    return entry || null;
  }

  if (typeof window !== 'undefined') {
    window.memoryCueQuickAddNow = quickAddNow;
  }

  quickBtn?.addEventListener('click', () => {
    activeMode = 'quick-add';
    quickAddNow();
  });

  quickInput?.addEventListener('focus', () => {
    activeMode = 'quick-add';
    // Clear search dropdown when user switches into quick add mode.
    const inboxSearchResults = document.getElementById('inboxSearchResults');
    if (inboxSearchResults) {
      inboxSearchResults.innerHTML = '';
      inboxSearchResults.dataset.mode = '';
    }
  });

  quickInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
      if (activeMode !== 'quick-add' && document.activeElement !== quickInput) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      quickAddNow();
    }
  });

  quickForm?.addEventListener('submit', (event) => {
    if (activeMode !== 'quick-add' && document.activeElement !== quickInput) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    quickAddNow();
  });

  setupInboxSearch();

  function setupQuickAddVoiceSupport() {
    if (
      typeof HTMLElement === 'undefined' ||
      !(quickVoiceBtn instanceof HTMLElement) ||
      !(quickInput instanceof HTMLInputElement)
    ) {
      return;
    }

    if (quickVoiceBtn.dataset.voiceBound === 'true') {
      return;
    }
    quickVoiceBtn.dataset.voiceBound = 'true';

    if (typeof window === 'undefined') {
      quickVoiceBtn.setAttribute('disabled', 'true');
      quickVoiceBtn.setAttribute('aria-disabled', 'true');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      quickVoiceBtn.setAttribute('disabled', 'true');
      quickVoiceBtn.setAttribute('aria-disabled', 'true');
      if (!quickVoiceBtn.getAttribute('title')) {
        quickVoiceBtn.title = 'Voice input is not supported in this browser.';
      }
      return;
    }

    let recognition = null;
    let isListening = false;

    const updateListening = (state) => {
      isListening = state;
      quickVoiceBtn.setAttribute('aria-pressed', state ? 'true' : 'false');
      quickVoiceBtn.dataset.listening = state ? 'true' : 'false';
      quickVoiceBtn.classList.toggle('is-listening', state);
      quickVoiceBtn.classList.toggle('mic-active', state);
    };

    recognition = new SpeechRecognition();
    recognition.lang = 'en-AU';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.addEventListener('result', (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim() || '';
      if (!transcript) {
        return;
      }
      quickInput.value =
        quickInput.value.trim().length > 0 ? `${quickInput.value} ${transcript}` : transcript;
      try {
        quickInput.focus({ preventScroll: true });
      } catch {
        quickInput.focus();
      }
    });

    recognition.addEventListener('end', () => {
      updateListening(false);
    });

    recognition.addEventListener('error', (event) => {
      console.error('Mic error:', event?.error);
      updateListening(false);
    });

    const stopListening = () => {
      if (!isListening || !recognition) {
        return;
      }
      try {
        recognition.stop();
      } catch (error) {
        console.error('Mic stop error:', error);
      }
      updateListening(false);
    };

    stopQuickAddVoiceListening = stopListening;

    quickVoiceBtn.addEventListener('click', () => {
      if (!recognition) {
        return;
      }

      if (isListening) {
        stopListening();
        return;
      }

      try {
        recognition.start();
        updateListening(true);
      } catch (error) {
        console.error('Mic start error:', error);
        updateListening(false);
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', stopListening);
    }

    updateListening(false);
  }

  setupQuickAddVoiceSupport();

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  let voiceSpeechRecognition = null;
  const voiceSupported = !!SpeechRecognition;

  if (voiceSupported) {
    voiceSpeechRecognition = new SpeechRecognition();
    voiceSpeechRecognition.lang = 'en-AU';
    voiceSpeechRecognition.interimResults = false;
    voiceSpeechRecognition.maxAlternatives = 1;
  }

  function showVoiceNotSupportedMessage() {
    try {
      if (typeof toast === 'function') {
        toast('Voice input is not supported on this device. You can still type your reminder.');
        return;
      }
    } catch {}

    try {
      alert('Voice input is not supported on this device. You can still type your reminder.');
    } catch {
      console.warn('Voice input is not supported on this device.');
    }
  }

  if (pillVoiceBtn) {
    if (voiceSupported && voiceSpeechRecognition) {
      pillVoiceBtn.addEventListener('click', () => {
        try {
          voiceSpeechRecognition.start();
          pillVoiceBtn.classList.add('is-recording');
        } catch (error) {
          console.warn('Voice input failed to start', error);
        }
      });
    } else {
      pillVoiceBtn.addEventListener('click', () => {
        showVoiceNotSupportedMessage();
      });
    }
  }

  if (voiceSpeechRecognition) {
    voiceSpeechRecognition.addEventListener('result', (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
      handleVoiceReminderTranscript(transcript);
    });

    voiceSpeechRecognition.addEventListener('end', () => {
      if (pillVoiceBtn) {
        pillVoiceBtn.classList.remove('is-recording');
      }
    });

    voiceSpeechRecognition.addEventListener('error', () => {
      if (pillVoiceBtn) {
        pillVoiceBtn.classList.remove('is-recording');
      }
    });
  }

  function formatReminderText(rawText) {
    if (!rawText) return '';

    let text = rawText.trim();

    text = text.charAt(0).toUpperCase() + text.slice(1);

    if (!/[.!?]$/.test(text)) {
      text += '.';
    }

    return text;
  }

  function parseTimePartsFromReminderText(rawText) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return null;
    }

    const compactMeridiemMatch = text.match(/\b(?:at\s*)?(\d{3,4})\s*(am|pm)\b/i);
    if (compactMeridiemMatch) {
      const digits = compactMeridiemMatch[1];
      const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
      const minuteDigits = digits.length === 3 ? digits.slice(1) : digits.slice(2);
      return {
        hours: Number.parseInt(hourDigits, 10),
        minutes: Number.parseInt(minuteDigits, 10),
        meridiem: compactMeridiemMatch[2],
      };
    }

    const meridiemMatch = text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (meridiemMatch) {
      return {
        hours: Number.parseInt(meridiemMatch[1], 10),
        minutes: meridiemMatch[2] ? Number.parseInt(meridiemMatch[2], 10) : 0,
        meridiem: meridiemMatch[3],
      };
    }

    const twentyFourHourMatch = text.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (twentyFourHourMatch) {
      return {
        hours: Number.parseInt(twentyFourHourMatch[1], 10),
        minutes: Number.parseInt(twentyFourHourMatch[2], 10),
        meridiem: '',
      };
    }

    return null;
  }

  function parseReminderScheduleFromText(rawText, nowOverride = null) {
    const result = { dueDate: null, notifyAt: null, cleanedText: '' };
    if (!rawText) {
      return result;
    }

    const sourceText = typeof rawText === 'string' ? rawText.trim() : '';
    const text = sourceText.toLowerCase();
    const now = nowOverride instanceof Date && !Number.isNaN(nowOverride.getTime())
      ? new Date(nowOverride)
      : new Date();
    const target = new Date(now);
    const timeParts = parseTimePartsFromReminderText(sourceText);
    const displayParts = extractReminderInlineSchedule(sourceText);

    result.cleanedText = displayParts.textWithoutSchedule || stripReminderPromptPrefix(sourceText) || sourceText;

    if (!timeParts) {
      return result;
    }

    const weekdayMatch = text.match(/\b(?:(next)\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
    if (text.includes('tomorrow')) {
      target.setDate(target.getDate() + 1);
    } else if (text.includes('today') || text.includes('tonight')) {
      // same day
    } else if (weekdayMatch) {
      const weekdayOrder = {
        sun: 0,
        sunday: 0,
        mon: 1,
        monday: 1,
        tue: 2,
        tues: 2,
        tuesday: 2,
        wed: 3,
        wednesday: 3,
        thu: 4,
        thur: 4,
        thurs: 4,
        thursday: 4,
        fri: 5,
        friday: 5,
        sat: 6,
        saturday: 6,
      };
      const targetDay = weekdayOrder[(weekdayMatch[2] || '').toLowerCase()];
      if (!Number.isFinite(targetDay)) {
        return result;
      }
      let dayOffset = (targetDay - target.getDay() + 7) % 7;
      if (dayOffset === 0 && weekdayMatch[1]) {
        dayOffset = 7;
      }
      target.setDate(target.getDate() + dayOffset);
    } else {
      return result;
    }

    let hours = timeParts.hours;
    const minutes = timeParts.minutes;
    const meridiem = typeof timeParts.meridiem === 'string' ? timeParts.meridiem.toLowerCase() : '';

    if (meridiem === 'pm' && hours < 12) {
      hours += 12;
    }
    if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }

    target.setHours(hours, minutes, 0, 0);

    const dueDate = new Date(target);
    if (Number.isNaN(dueDate.getTime())) {
      return result;
    }

    result.dueDate = dueDate;
    result.notifyAt = new Date(dueDate.getTime() - 10 * 60 * 1000);
    return result;
  }

  function parseNaturalDateTime(rawText) {
    const { dueDate, notifyAt } = parseReminderScheduleFromText(rawText);
    return { dueDate, notifyAt };
  }

  function handleVoiceReminderTranscript(rawText) {
    if (!rawText || !quickInput) return;

    const cleanedText = formatReminderText(rawText);
    const { dueDate, notifyAt } = parseNaturalDateTime(rawText);

    quickInput.value = cleanedText;

    quickAddNow({ text: cleanedText, dueDate, notifyAt });
  }

  if (typeof window !== 'undefined') {
    if (!window.memoryCueQuickAddShortcutsBound) {
      window.memoryCueQuickAddShortcutsBound = true;
      window.addEventListener('keydown', (e) => {
        if (
          e.target &&
          (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        ) {
          return;
        }
        if (e.key === '/' || e.key === 'q' || e.key === 'Q') {
          if (quickInput) {
            e.preventDefault();
            quickInput.focus();
          }
        }
      });
    }
  }

  try {
    if (variant === 'mobile' && typeof document !== 'undefined') {
      // Mobile now defaults to the full UI; minimal mode is only enabled when the class is removed elsewhere.
      document.body.classList.add('show-full');
    }
  } catch {
    /* ignore environments without DOM */
  }
  const emptyInitialText =
    sel.emptyStateInitialText || 'Create your first reminder to keep important tasks in view.';
  const sharedEmptyStateMount = (typeof window !== 'undefined' && typeof window.memoryCueMountEmptyState === 'function') ? window.memoryCueMountEmptyState : null;
  const sharedEmptyStateCtaClasses = (typeof window !== 'undefined' && typeof window.memoryCueEmptyStateCtaClasses === 'string')
    ? window.memoryCueEmptyStateCtaClasses
    : 'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 dark:bg-emerald-500 dark:hover:bg-emerald-400';
  const reminderLandingPath = sel.reminderLandingPath || (variant === 'desktop' ? 'index.html#reminders' : 'mobile.html');

  const dispatchCueEvent = (name, detail = {}) => {
    // Prefer the native CustomEvent if available; fall back to window.CustomEvent or a
    // lightweight Event-based shim so code running inside VMs (vm.runInNewContext)
    // or unusual test sandboxes don't throw ReferenceError.
    let CE = null;
    try {
      CE = typeof CustomEvent !== 'undefined' ? CustomEvent : null;
    } catch (e) {
      CE = null;
    }
    if (!CE && typeof window !== 'undefined' && typeof window.CustomEvent !== 'undefined') {
      CE = window.CustomEvent;
    }
    if (!CE) {
      CE = function (t, opts) {
        opts = opts || { bubbles: false, cancelable: false, detail: null };
        const ev = new Event(t, opts);
        ev.detail = opts.detail;
        return ev;
      };
    }
    document.dispatchEvent(new CE(name, { detail }));
  };

  function closeCreateSheetIfOpen() {
    if (typeof document === 'undefined') {
      return;
    }
    const sheet =
      document.getElementById('createReminderSheet') ||
      document.getElementById('create-sheet');
    if (!sheet) {
      return;
    }

    sheet.classList?.remove('open');
    sheet.classList?.add('hidden');
    sheet.setAttribute('hidden', '');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.removeAttribute('open');

    const backdrop = sheet.querySelector('.sheet-backdrop, .backdrop');
    if (backdrop instanceof HTMLElement) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('hidden', '');
      backdrop.setAttribute('aria-hidden', 'true');
    }

    try {
      document.dispatchEvent(
        new CustomEvent('cue:close', { detail: { reason: 'save' } }),
      );
    } catch {
      /* ignore CustomEvent issues */
    }
  }

  function emitReminderUpdates() {
    try {
      document.dispatchEvent(new CustomEvent('reminders:updated', { detail: { items } }));
    } catch {
      // Ignore environments where CustomEvent construction fails.
    }
  }

  if (categoryInput && !categoryInput.value) {
    categoryInput.value = DEFAULT_CATEGORY;
  }

  if (supportsNotificationTriggers()) {
    ensureServiceWorkerRegistration();
  }

  function emitActivity(detail = {}) {
    const label = typeof detail.label === 'string' ? detail.label.trim() : '';
    if (!label) return;
    const payload = {
      type: 'reminder',
      target: { view: 'reminders' },
      ...detail,
    };
    if (!payload.target) {
      payload.target = { view: 'reminders' };
    } else if (typeof payload.target === 'string') {
      payload.target = { view: payload.target };
    } else if (typeof payload.target === 'object' && payload.target.view == null) {
      payload.target.view = 'reminders';
    }
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }

    let handled = false;
    try {
      if (typeof window !== 'undefined' && window.memoryCueActivity && typeof window.memoryCueActivity.push === 'function') {
        window.memoryCueActivity.push(payload);
        handled = true;
      }
    } catch {
      handled = false;
    }

    if (handled) {
      return;
    }

    if (typeof window !== 'undefined') {
      const queue = Array.isArray(window.memoryCueActivityQueue) ? window.memoryCueActivityQueue : [];
      queue.push(payload);
      while (queue.length > 20) queue.shift();
      window.memoryCueActivityQueue = queue;
    }

    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      try {
        if (typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent(ACTIVITY_EVENT_NAME, { detail: payload }));
        } else if (document.createEvent) {
          const evt = document.createEvent('CustomEvent');
          if (evt && evt.initCustomEvent) {
            evt.initCustomEvent(ACTIVITY_EVENT_NAME, false, false, payload);
            document.dispatchEvent(evt);
          }
        }
      } catch {
        // ignore fallback dispatch errors
      }
    }
  }

  function setupVoiceEnhancement() {
    if (
      typeof HTMLElement === 'undefined' ||
      !(voiceBtn instanceof HTMLElement)
    ) {
      return;
    }

    const isInputElement =
      typeof HTMLInputElement !== 'undefined' &&
      title instanceof HTMLInputElement;
    const isTextareaElement =
      typeof HTMLTextAreaElement !== 'undefined' &&
      title instanceof HTMLTextAreaElement;

    if (!isInputElement && !isTextareaElement) {
      return;
    }

    if (voiceBtn.dataset.voiceBound === 'true') {
      return;
    }
    voiceBtn.dataset.voiceBound = 'true';

    if (typeof window === 'undefined') {
      voiceBtn.setAttribute('disabled', 'true');
      voiceBtn.setAttribute('aria-disabled', 'true');
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognitionCtor !== 'function') {
      voiceBtn.setAttribute('disabled', 'true');
      voiceBtn.setAttribute('aria-disabled', 'true');
      if (!voiceBtn.getAttribute('title')) {
        voiceBtn.title = 'Voice input is not supported in this browser.';
      }
      return;
    }

    let recognition = null;
    let listening = false;

    const updateListening = (state) => {
      listening = state;
      voiceBtn.setAttribute('aria-pressed', state ? 'true' : 'false');
      voiceBtn.dataset.listening = state ? 'true' : 'false';
      voiceBtn.classList.toggle('is-listening', state);
    };

    const ensureRecognition = () => {
      if (recognition) {
        return recognition;
      }
      recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.addEventListener('result', (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim() || '';
        if (!transcript) {
          return;
        }
        title.value = transcript;
        try {
          title.focus({ preventScroll: true });
        } catch {
          try {
            title.focus();
          } catch {}
        }
        try {
          const length = title.value.length;
          if (typeof title.setSelectionRange === 'function') {
            title.setSelectionRange(length, length);
          }
        } catch {}
        emitActivity({ action: 'dictated', label: `Voice input captured · ${transcript}` });
      });

      const resetState = () => {
        updateListening(false);
      };

      recognition.addEventListener('end', resetState);
      recognition.addEventListener('error', resetState);

      return recognition;
    };

    const stopListening = () => {
      if (!listening || !recognition) {
        return;
      }
      try {
        recognition.stop();
      } catch {}
      updateListening(false);
    };

    voiceBtn.addEventListener('click', () => {
      const recog = ensureRecognition();
      if (!recog) {
        return;
      }

      if (listening) {
        stopListening();
        return;
      }

      try {
        recog.start();
        updateListening(true);
      } catch (error) {
        console.warn('Speech recognition error:', error);
        updateListening(false);
      }
    });

    const handleClose = () => {
      stopListening();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('cue:close', handleClose);
      document.addEventListener('reminders:updated', handleClose);
    }

    updateListening(false);
  }

  bindNotificationCleanupHandlers();
  setupVoiceEnhancement();

  const globalScope = getGlobalScope();
  let authController = null;

  // State
  let items = [];
  let suppressRenderMemoryEvent = false;
  let userId = null;
  let notesMigrationComplete = false;
  let notesMigrationUserId = null;
  let lastSyncedNoteIds = new Set();
  const pendingDeletionItems = new Map();
  let unsubscribe = null;
  let editingId = null;
  let currentReminderMode = null;
  let currentReminderId = null;
  const reminderTimers = {};
  const reminderNotifyTimers = {};
  let scheduledReminders = {};
  const reminderSheetTitle =
    typeof document !== 'undefined'
      ? document.getElementById('createSheetTitle')
      : null;

  const focusTitleField = () => {
    if (!(title instanceof HTMLElement)) {
      return;
    }
    setTimeout(() => {
      try {
        title.focus();
      } catch {
        /* ignore focus errors */
      }
    }, 0);
  };

  const setReminderMode = (mode, reminderId = null) => {
    currentReminderMode = mode || null;
    currentReminderId = reminderId || null;
    editingId = currentReminderMode === 'edit' ? currentReminderId : null;

    if (reminderSheetTitle instanceof HTMLElement) {
      reminderSheetTitle.textContent =
        currentReminderMode === 'edit' ? 'Edit reminder' : 'Add reminder';
    }
  };

  function sortItemsByOrder(target = items) {
    if (!Array.isArray(target)) {
      return;
    }
    target.sort((a, b) => {
      const aVal = Number.isFinite(a?.orderIndex) ? a.orderIndex : -Infinity;
      const bVal = Number.isFinite(b?.orderIndex) ? b.orderIndex : -Infinity;
      if (aVal === bVal) {
        return compareRemindersForDisplay(a || {}, b || {});
      }
      return bVal - aVal;
    });
  }

  function getOrderBounds(target = items) {
    if (!Array.isArray(target) || target.length === 0) {
      return { min: 0, max: 0 };
    }
    let min = Infinity;
    let max = -Infinity;
    target.forEach((entry) => {
      const value = Number.isFinite(entry?.orderIndex) ? entry.orderIndex : null;
      if (value == null) {
        return;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    });
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;
    return { min, max };
  }

  function ensureOrderIndicesInitialized(target = items) {
    if (!Array.isArray(target) || target.length === 0) {
      return Array.isArray(target) ? target : [];
    }
    const allHaveOrder = target.every((entry) => Number.isFinite(entry?.orderIndex));
    let sorted;
    if (allHaveOrder) {
      sorted = target.slice();
      sortItemsByOrder(sorted);
    } else {
      sorted = target.slice().sort(compareRemindersForDisplay);
      const total = sorted.length;
      sorted.forEach((entry, index) => {
        entry.orderIndex = (total - index) * ORDER_INDEX_GAP;
      });
    }
    if (target === items) {
      items = sorted;
    }
    return sorted;
  }

  function assignOrderIndexForNewItem(item, { position = 'start' } = {}) {
    if (!item || typeof item !== 'object') {
      return;
    }
    const { min, max } = getOrderBounds();
    if (position === 'end') {
      const base = Number.isFinite(min) ? min : 0;
      item.orderIndex = base - ORDER_INDEX_GAP || ORDER_INDEX_GAP;
    } else {
      const base = Number.isFinite(max) ? max : 0;
      item.orderIndex = base + ORDER_INDEX_GAP || ORDER_INDEX_GAP;
    }
  }

  function maybeRebalanceOrderSpacing(target = items) {
    if (!Array.isArray(target) || target.length < 2) {
      return false;
    }
    sortItemsByOrder(target);
    let needsRebalance = false;
    for (let i = 1; i < target.length; i += 1) {
      const prev = target[i - 1];
      const curr = target[i];
      const prevVal = Number.isFinite(prev?.orderIndex) ? prev.orderIndex : null;
      const currVal = Number.isFinite(curr?.orderIndex) ? curr.orderIndex : null;
      if (prevVal == null || currVal == null || prevVal <= currVal || prevVal - currVal < 1) {
        needsRebalance = true;
        break;
      }
    }
    if (!needsRebalance) {
      return false;
    }
    for (let i = 0; i < target.length; i += 1) {
      target[i].orderIndex = (target.length - i) * ORDER_INDEX_GAP;
    }
    if (target === items) {
      sortItemsByOrder(items);
    }
    return true;
  }

  const dragState = {
    draggingId: null,
    dropTargetId: null,
    dropBefore: true,
  };
  let dragSetupComplete = false;
  const touchDragState = {
    active: false,
    ready: false,
    pointerId: null,
    item: null,
    placeholder: null,
    originalStyles: '',
    offsetY: 0,
    fixedX: 0,
    longPressTimer: null,
    startX: 0,
    startY: 0,
    lastClientX: 0,
    lastClientY: 0,
    moved: false,
    initialTouchAction: '',
    startTime: 0,
  };

  function findInteractiveControl(node) {
    if (!node || typeof node.closest !== 'function') {
      return null;
    }
    return node.closest(
      'button, a, input, textarea, select, label, [role="button"], [role="menuitem"], [role="option"], [role="switch"], [contenteditable="true"]'
    );
  }

  function findDraggableItem(node) {
    if (!node || typeof node.closest !== 'function') {
      return null;
    }
    return node.closest('[data-reminder-item]');
  }

  function clearDragHighlights() {
    if (!list) return;
    list.querySelectorAll('.drag-over-before, .drag-over-after').forEach((node) => {
      node.classList.remove('drag-over-before', 'drag-over-after');
    });
    list.classList.remove('drag-over-list');
  }

  function resetDragState() {
    if (!list) return;
    const draggingEl = list.querySelector('.is-dragging');
    if (draggingEl) {
      draggingEl.classList.remove('is-dragging');
    }
    clearDragHighlights();
    dragState.draggingId = null;
    dragState.dropTargetId = null;
    dragState.dropBefore = true;
  }

  function performReorder(sourceId, targetId, before) {
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const sourceIndex = items.findIndex((entry) => entry?.id === sourceId);
    if (sourceIndex < 0) {
      return;
    }
    const [moved] = items.splice(sourceIndex, 1);
    let insertIndex;
    if (!targetId) {
      insertIndex = items.length;
    } else {
      const targetIndex = items.findIndex((entry) => entry?.id === targetId);
      if (targetIndex < 0) {
        items.splice(sourceIndex, 0, moved);
        return;
      }
      insertIndex = before ? targetIndex : targetIndex + 1;
    }
    items.splice(insertIndex, 0, moved);

    const prev = items[insertIndex - 1];
    const next = items[insertIndex + 1];
    const prevVal = Number.isFinite(prev?.orderIndex) ? prev.orderIndex : null;
    const nextVal = Number.isFinite(next?.orderIndex) ? next.orderIndex : null;
    let newOrder;
    if (prevVal != null && nextVal != null) {
      newOrder = (prevVal + nextVal) / 2;
    } else if (prevVal != null) {
      newOrder = prevVal - ORDER_INDEX_GAP;
    } else if (nextVal != null) {
      newOrder = nextVal + ORDER_INDEX_GAP;
    } else {
      newOrder = ORDER_INDEX_GAP;
    }
    if (!Number.isFinite(newOrder)) {
      newOrder = ORDER_INDEX_GAP * (items.length + 1);
    }
    moved.orderIndex = newOrder;
    sortItemsByOrder(items);
    const rebalanced = maybeRebalanceOrderSpacing(items);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    if (rebalanced) {
      items.forEach((entry) => saveToFirebase(entry));
    } else {
      saveToFirebase(moved);
    }
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    emitActivity({ action: 'reordered', label: 'Reminders reordered' });
  }

  function handleDragStart(event) {
    const item = findDraggableItem(event.target);
    if (!item) {
      return;
    }
    const interactive = event.target?.closest('button, a, input, textarea, label');
    if (interactive && interactive !== item) {
      event.preventDefault();
      return;
    }
    const id = item.dataset.id;
    if (!id) {
      return;
    }
    dragState.draggingId = id;
    dragState.dropTargetId = null;
    dragState.dropBefore = true;
    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      } catch {}
    }
  }

  function handleDragOver(event) {
    if (!dragState.draggingId) {
      return;
    }
    const item = findDraggableItem(event.target);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (!item) {
      event.preventDefault();
      dragState.dropTargetId = null;
      dragState.dropBefore = false;
      clearDragHighlights();
      list?.classList.add('drag-over-list');
      return;
    }
    if (item.dataset.id === dragState.draggingId) {
      event.preventDefault();
      clearDragHighlights();
      return;
    }
    event.preventDefault();
    const rect = item.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const before = event.clientY < midpoint;
    if (dragState.dropTargetId !== item.dataset.id || dragState.dropBefore !== before) {
      clearDragHighlights();
      item.classList.add(before ? 'drag-over-before' : 'drag-over-after');
      dragState.dropTargetId = item.dataset.id;
      dragState.dropBefore = before;
    }
  }

  function handleDragLeave(event) {
    const item = findDraggableItem(event.target);
    if (!item) {
      if (!list?.contains(event.relatedTarget)) {
        clearDragHighlights();
      }
      return;
    }
    if (event.relatedTarget && item.contains(event.relatedTarget)) {
      return;
    }
    item.classList.remove('drag-over-before', 'drag-over-after');
    if (!list?.contains(event.relatedTarget)) {
      list?.classList.remove('drag-over-list');
    }
  }

  function handleDrop(event) {
    if (!dragState.draggingId) {
      return;
    }
    event.preventDefault();
    const item = findDraggableItem(event.target);
    let targetId = item?.dataset.id || null;
    let before = dragState.dropBefore;
    if (item) {
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      before = event.clientY < midpoint;
    } else {
      targetId = null;
      before = false;
    }
    performReorder(dragState.draggingId, targetId, before);
    resetDragState();
  }

  function handleDragEnd() {
    resetDragState();
  }

  function setupDragAndDrop() {
    if (!list || dragSetupComplete) {
      return;
    }
    dragSetupComplete = true;
    list.addEventListener('dragstart', handleDragStart);
    list.addEventListener('dragover', handleDragOver);
    list.addEventListener('drop', handleDrop);
    list.addEventListener('dragend', handleDragEnd);
    list.addEventListener('dragleave', handleDragLeave);
    setupTouchDrag();
  }

  function setupTouchDrag() {
    if (!list) {
      return;
    }

    if (setupTouchDrag._bound) {
      return;
    }

    const supportsTouch = (() => {
      if (typeof window === 'undefined') {
        return false;
      }
      if (navigator && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) {
        return true;
      }
      try {
        return window.matchMedia('(pointer: coarse)').matches;
      } catch {
        return false;
      }
    })();

    if (!supportsTouch) {
      setupTouchDrag._bound = true;
      return;
    }

    const TOUCH_MOVE_THRESHOLD = 6;
    const LONG_PRESS_DELAY = 160;

    function clearTouchTimer() {
      if (touchDragState.longPressTimer) {
        clearTimeout(touchDragState.longPressTimer);
        touchDragState.longPressTimer = null;
      }
    }

    function restoreListTouchAction() {
      if (!list) {
        return;
      }
      if (touchDragState.initialTouchAction != null) {
        list.style.touchAction = touchDragState.initialTouchAction;
      } else {
        list.style.removeProperty('touch-action');
      }
    }

    function resetTouchDragState({ keepHighlights = false } = {}) {
      clearTouchTimer();
      if (touchDragState.item && touchDragState.pointerId != null) {
        try {
          if (touchDragState.item.hasPointerCapture?.(touchDragState.pointerId)) {
            touchDragState.item.releasePointerCapture(touchDragState.pointerId);
          }
        } catch {
          /* noop */
        }
      }
      if (touchDragState.placeholder?.parentNode) {
        try {
          touchDragState.placeholder.parentNode.removeChild(touchDragState.placeholder);
        } catch {
          /* noop */
        }
      }
      if (touchDragState.item) {
        touchDragState.item.classList.remove('is-dragging');
        if (touchDragState.originalStyles) {
          touchDragState.item.setAttribute('style', touchDragState.originalStyles);
        } else {
          touchDragState.item.removeAttribute('style');
        }
      }
      restoreListTouchAction();
      if (!keepHighlights) {
        clearDragHighlights();
      }
      Object.assign(touchDragState, {
        active: false,
        ready: false,
        pointerId: null,
        item: null,
        placeholder: null,
        originalStyles: '',
        offsetY: 0,
        fixedX: 0,
        longPressTimer: null,
        startX: 0,
        startY: 0,
        lastClientX: 0,
        lastClientY: 0,
        moved: false,
        initialTouchAction: '',
        startTime: 0,
      });
    }

    function getDropTargets(exclude) {
      if (!list) {
        return [];
      }
      return Array.from(list.querySelectorAll('[data-reminder-item]')).filter((node) => node !== exclude);
    }

    function startTouchDrag(point) {
      const item = touchDragState.item;
      if (!item || touchDragState.ready) {
        return;
      }

      const rect = item.getBoundingClientRect();
      const computed = window.getComputedStyle(item);

      touchDragState.ready = true;
      dragState.draggingId = item.dataset.id || null;
      touchDragState.offsetY = point.clientY - rect.top;
      touchDragState.fixedX = rect.left;

      const placeholder = document.createElement('div');
      placeholder.className = 'touch-drag-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.boxSizing = 'border-box';
      placeholder.style.marginTop = computed.marginTop;
      placeholder.style.marginBottom = computed.marginBottom;
      placeholder.style.marginLeft = computed.marginLeft;
      placeholder.style.marginRight = computed.marginRight;
      placeholder.style.borderRadius = computed.borderRadius;
      placeholder.style.border = '2px dashed color-mix(in srgb, var(--primary-color, #5e72e4) 55%, transparent)';
      placeholder.style.background = 'color-mix(in srgb, var(--primary-color, #5e72e4) 12%, transparent)';
      placeholder.style.pointerEvents = 'none';
      placeholder.style.display = 'block';
      placeholder.style.width = '100%';
      item.parentNode?.insertBefore(placeholder, item);

      touchDragState.placeholder = placeholder;

      touchDragState.longPressTimer = null;
      touchDragState.originalStyles = item.getAttribute('style') || '';
      item.classList.add('is-dragging');
      item.style.position = 'fixed';
      item.style.left = `${rect.left}px`;
      item.style.top = `${rect.top}px`;
      item.style.width = `${rect.width}px`;
      item.style.zIndex = '999';
      item.style.pointerEvents = 'none';
      item.style.touchAction = 'none';

      touchDragState.initialTouchAction = list.style.touchAction || '';
      list.style.touchAction = 'none';
    }

    function updateTouchPosition(clientY) {
      const item = touchDragState.item;
      if (!item || !touchDragState.ready) {
        return;
      }
      const nextTop = clientY - touchDragState.offsetY;
      item.style.top = `${nextTop}px`;
      item.style.left = `${touchDragState.fixedX}px`;
    }

    function updateTouchDropTarget(clientY) {
      if (!touchDragState.ready || !list) {
        return;
      }

      const item = touchDragState.item;
      const targets = getDropTargets(item);

      clearDragHighlights();

      if (!targets.length) {
        dragState.dropTargetId = null;
        dragState.dropBefore = false;
        return;
      }

      let chosen = null;
      let before = false;

      for (const candidate of targets) {
        const rect = candidate.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint) {
          chosen = candidate;
          before = true;
          break;
        }
      }

      if (!chosen) {
        chosen = targets[targets.length - 1];
        const rect = chosen.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        before = clientY < midpoint;
        if (!before) {
          before = false;
        }
      }

      if (!chosen) {
        dragState.dropTargetId = null;
        dragState.dropBefore = false;
        return;
      }

      const rect = chosen.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const dropBefore = clientY < midpoint;

      chosen.classList.add(dropBefore ? 'drag-over-before' : 'drag-over-after');
      dragState.dropTargetId = chosen.dataset.id || null;
      dragState.dropBefore = dropBefore;
    }

    function finishTouchDrag(cancelled) {
      const draggedId = dragState.draggingId;
      const moved = touchDragState.moved;

      if (!touchDragState.ready) {
        resetTouchDragState();
        return;
      }

      resetTouchDragState();

      if (!cancelled && moved && draggedId) {
        performReorder(draggedId, dragState.dropTargetId, dragState.dropBefore);
      }
      resetDragState();
    }

    function handlePointerDown(event) {
      const pointerKind = event.pointerType || '';
      if (pointerKind && pointerKind !== 'touch' && pointerKind !== 'pen') {
        return;
      }
      if (touchDragState.active) {
        return;
      }
      const item = findDraggableItem(event.target);
      if (!item) {
        return;
      }
      const interactive = findInteractiveControl(event.target);
      if (interactive && interactive !== item) {
        return;
      }

      touchDragState.active = true;
      touchDragState.pointerId = event.pointerId;
      touchDragState.item = item;
      touchDragState.startX = event.clientX;
      touchDragState.startY = event.clientY;
      touchDragState.lastClientX = event.clientX;
      touchDragState.lastClientY = event.clientY;
      touchDragState.moved = false;
      touchDragState.ready = false;
      touchDragState.originalStyles = item.getAttribute('style') || '';
      touchDragState.startTime = event.timeStamp || Date.now();
      dragState.dropTargetId = null;
      dragState.dropBefore = true;
      dragState.draggingId = null;

      clearTouchTimer();
      touchDragState.longPressTimer = setTimeout(() => {
        startTouchDrag({ clientY: touchDragState.lastClientY });
      }, LONG_PRESS_DELAY);

      try {
        item.setPointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
    }

    function handlePointerMove(event) {
      if (!touchDragState.active || event.pointerId !== touchDragState.pointerId) {
        return;
      }
      const pointerKind = event.pointerType || '';
      if (pointerKind && pointerKind !== 'touch' && pointerKind !== 'pen') {
        return;
      }

      touchDragState.lastClientX = event.clientX;
      touchDragState.lastClientY = event.clientY;

      if (!touchDragState.ready) {
        const deltaX = Math.abs(event.clientX - touchDragState.startX);
        const deltaY = Math.abs(event.clientY - touchDragState.startY);
        if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
          const now = typeof event.timeStamp === 'number' ? event.timeStamp : Date.now();
          const elapsed = Math.abs(now - touchDragState.startTime);
          if (elapsed >= LONG_PRESS_DELAY) {
            clearTouchTimer();
            startTouchDrag({ clientY: touchDragState.lastClientY });
          } else {
            resetTouchDragState();
          }
        }
        return;
      }

      event.preventDefault();
      touchDragState.moved = true;
      updateTouchPosition(event.clientY);
      updateTouchDropTarget(event.clientY);
    }

    function handlePointerUp(event) {
      if (!touchDragState.active || event.pointerId !== touchDragState.pointerId) {
        return;
      }
      finishTouchDrag(false);
    }

    function handlePointerCancel(event) {
      if (!touchDragState.active || event.pointerId !== touchDragState.pointerId) {
        return;
      }
      finishTouchDrag(true);
    }

    list.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    setupTouchDrag._bound = true;
  }

  function applySignedOutState() {
    userId = null;
    renderSyncIndicator('local');
    googleSignInBtns.forEach((btn) => btn.classList.remove('hidden'));
    googleSignOutBtns.forEach((btn) => btn.classList.add('hidden'));
    if (googleUserName) {
      googleUserName.textContent = '';
    }
    unsubscribe?.();
    unsubscribe = null;
    hydrateOfflineReminders();
    render();
    persistItems();
    rescheduleAllReminders();
  }

  // Offline reminders in localStorage are the canonical local cache for reminder read/write/render.
  function loadOfflineRemindersFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return normalizeReminderList(parsed);
    } catch (error) {
      console.warn('Failed to load offline reminders', error);
      return [];
    }
  }

  // Persist using the same normalized reminder shape used by render and remote sync.
  function persistOfflineReminders(reminders = []) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (!Array.isArray(reminders) || reminders.length === 0) {
        localStorage.removeItem(OFFLINE_REMINDERS_KEY);
        return;
      }
      const serialisable = normalizeReminderList(reminders);
      localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(serialisable));
    } catch (error) {
      console.warn('Failed to persist offline reminders', error);
    }
  }

  function persistItems() {
    sortItemsByOrder(items);
    setStoredReminders(items);
    items = ensureOrderIndicesInitialized(
      normalizeReminderList(items)
    );
  }

  function hydrateOfflineReminders() {
    items = ensureOrderIndicesInitialized(
      normalizeReminderList(loadReminders())
    );
  }

  function buildBackupPayload() {
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      reminders: items.map((item) => normalizeReminderRecord(item, { fallbackId: item?.id || uid() })),
      notes: loadAllNotes(),
      folders: getFolders(),
      inbox: getInboxEntries(),
      chatHistory: getMessages(),
    };
  }

  function applyBackupPayload(payload = {}) {
    const backup = payload && typeof payload === 'object' ? payload : {};
    const nextFolders = Array.isArray(backup.folders) ? backup.folders : getFolders();
    const nextNotes = Array.isArray(backup.notes) ? backup.notes : [];
    const nextInbox = Array.isArray(backup.inbox) ? backup.inbox : [];
    const nextChatHistory = Array.isArray(backup.chatHistory) ? backup.chatHistory : [];
    const nextReminders = Array.isArray(backup.reminders) ? backup.reminders : [];

    saveFolders(nextFolders);
    saveAllNotes(nextNotes);
    replaceInboxEntries(nextInbox);
    replaceMessages(nextChatHistory);

    pendingDeletionItems.clear();
    items = ensureOrderIndicesInitialized(normalizeReminderList(nextReminders));
    render();
    persistItems();
    updateMobileRemindersHeaderSubtitle();
    rescheduleAllReminders();
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
  }

  hydrateOfflineReminders();

  async function ensureAllEmbeddings() {
    let remindersUpdated = false;
    for (const reminder of items) {
      const before = normalizeSemanticEmbedding(reminder?.semanticEmbedding);
      await ensureEmbeddingForItem(reminder);
      const after = normalizeSemanticEmbedding(reminder?.semanticEmbedding);
      if (!before && after) {
        remindersUpdated = true;
      }
    }
    if (remindersUpdated) {
      persistItems();
    }

    const notes = readJsonArrayStorage(NOTES_STORAGE_KEY, []);
    let notesUpdated = false;
    for (const note of notes) {
      const before = normalizeSemanticEmbedding(note?.semanticEmbedding);
      await ensureEmbeddingForItem(note);
      const after = normalizeSemanticEmbedding(note?.semanticEmbedding);
      if (!before && after) {
        notesUpdated = true;
      }
    }
    if (notesUpdated && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
      } catch (error) {
        console.warn('Failed to persist note embeddings', error);
      }
    }
  }

  ensureAllEmbeddings();

  async function migrateLocalReminders() {
    if (!userId) {
      return;
    }

    let localReminders = [];

    try {
      localReminders = JSON.parse(localStorage.getItem('memoryCue:offlineReminders') || '[]');
    } catch (error) {
      console.warn('Failed to parse local reminders for migration', error);
      localReminders = [];
    }

    if (!Array.isArray(localReminders) || !localReminders.length) {
      return;
    }

    for (const reminder of localReminders) {
      await saveReminder(userId, {
        ...reminder,
        id: reminder?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uid()),
        userId,
        migratedAt: Date.now(),
        pendingSync: true,
      });
    }

    localStorage.removeItem('memoryCue:offlineReminders');
  }

  async function migrateOfflineRemindersIfNeeded() {
    if (!userId) {
      items = loadOfflineRemindersFromStorage();
      return;
    }
    // The current offline reminder cache is the canonical local store.
    // setupReminderFirestoreSync() already reconciles pending local changes,
    // so replaying the whole local cache here can resurrect stale reminders.
  }
  try {
    scheduledReminders = JSON.parse(localStorage.getItem('scheduledReminders') || '{}');
  } catch {
    scheduledReminders = {};
  }
  if (scheduledReminders && typeof scheduledReminders === 'object') {
    Object.values(scheduledReminders).forEach((entry) => {
      if (entry && typeof entry === 'object') {
        entry.category = normalizeCategory(entry.category);
        entry.priority = entry.priority || 'Medium';
        entry.notes = typeof entry.notes === 'string' ? entry.notes : '';
        entry.notifyAt = typeof entry.notifyAt === 'string' ? entry.notifyAt : null;
        entry.recurrence = normalizeRecurrence(entry.recurrence);
        entry.snoozedUntil = normalizeIsoString(entry.snoozedUntil);
        entry.notifyMinutesBefore = Number.isFinite(Number(entry.notifyMinutesBefore)) ? Number(entry.notifyMinutesBefore) : 0;
        entry.body = typeof entry.body === 'string' && entry.body
          ? entry.body
          : buildReminderNotificationBody(entry);
        entry.urlPath = entry.urlPath || reminderLandingPath;
        if (!Number.isFinite(entry.updatedAt)) {
          entry.updatedAt = Date.now();
        }
        if (!Number.isFinite(entry.notifiedAt)) {
          entry.notifiedAt = null;
        }
        entry.semanticEmbedding = normalizeSemanticEmbedding(entry.semanticEmbedding);
      }
    });
  }

  if (!supportsNotificationTriggers()) {
    const initialPayload = buildScheduledReminderPayload();
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      setupBackgroundReminderSync();
      if (initialPayload.length) {
        syncScheduledRemindersWithServiceWorker(initialPayload, { requestCheck: true });
      }
    } else if (initialPayload.length) {
      syncScheduledRemindersWithServiceWorker(initialPayload);
    }
  }

  const recordFirebaseAvailability = (available) => {
    if (!globalScope) return;
    const targets = [globalScope];
    if (globalScope.window && !targets.includes(globalScope.window)) {
      targets.push(globalScope.window);
    }
    const unavailable = !available;
    targets.forEach((target) => {
      try {
        target.__memoryCueFirebaseUnavailable__ = unavailable;
      } catch {
        // Ignore write failures (e.g., frozen global scope)
      }
    });
  };

  // Notes (runs before Firebase modules load)
   function initNotebook() {
     if (!notesEl) return;

     const notesToolbar = document.getElementById('notesToolbar');
     const columnsToggleBtn = notesToolbar?.querySelector('[data-action="columns"]');
     const storageKey = 'mobileNotes';
     const columnsKey = 'mobileNotesColumns';

     const supportsRichFormatting = typeof document !== 'undefined' && typeof document.execCommand === 'function';

     const readEditorValue = () => {
       if ('value' in notesEl) {
         return notesEl.value;
       }
       return notesEl.innerHTML;
     };

     const writeEditorValue = (value) => {
       if ('value' in notesEl) {
         notesEl.value = value;
         return;
       }
       if (typeof value !== 'string' || value.length === 0) {
         notesEl.innerHTML = '';
         return;
       }

       const trimmed = value.trim();
       const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);

       if (looksLikeHtml) {
         notesEl.innerHTML = value;
         return;
       }

       const escaped = value
         .replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
         .replace(/\n/g, '<br>');
       notesEl.innerHTML = escaped;
     };

     const applyColumnsPreference = (enabled) => {
       if (enabled) {
         notesEl.classList.add('notes-editor--columns');
       } else {
         notesEl.classList.remove('notes-editor--columns');
       }
       if (columnsToggleBtn) {
         columnsToggleBtn.setAttribute('aria-pressed', String(Boolean(enabled)));
       }
     };

     let notesMemory = '';
     try {
       notesMemory = localStorage.getItem(storageKey) || '';
     } catch {
       toast('Unable to access saved notes');
     }

     writeEditorValue(notesMemory);

     let columnsPreference = false;
     try {
       columnsPreference = localStorage.getItem(columnsKey) === '1';
     } catch {
       columnsPreference = false;
     }
     applyColumnsPreference(columnsPreference);

     notesEl.addEventListener('input', () => {
       notesMemory = readEditorValue();
       try {
         localStorage.setItem(storageKey, notesMemory);
       } catch {
         toast('Notes saved for this session only');
       }
     });

     saveNotesBtn?.addEventListener('click', () => {
       notesMemory = readEditorValue();
       try {
         localStorage.setItem(storageKey, notesMemory);
         toast('Notes saved');
       } catch {
         toast('Notes saved for this session only');
       }
     });

     loadNotesBtn?.addEventListener('click', () => {
       let stored = notesMemory;
       try {
         stored = localStorage.getItem(storageKey) || notesMemory;
       } catch {
         toast('Unable to load saved notes');
       }
       notesMemory = stored;
       writeEditorValue(notesMemory);
     });

     notesToolbar?.addEventListener('click', (event) => {
       const target = event.target;
       if (!(target instanceof Element)) return;
       const button = target.closest('button[data-action]');
       if (!button) return;
       const action = button.getAttribute('data-action');

       if (action === 'columns') {
         const nextState = !notesEl.classList.contains('notes-editor--columns');
         applyColumnsPreference(nextState);
         try {
           localStorage.setItem(columnsKey, nextState ? '1' : '0');
         } catch {
           toast('Column preference saved for this session only');
         }
         return;
       }

       if (!supportsRichFormatting) {
         toast('Formatting controls are not supported in this browser');
         return;
       }

       notesEl.focus();
       if (action === 'bullets') {
         document.execCommand('insertUnorderedList');
       } else if (action === 'numbers') {
         document.execCommand('insertOrderedList');
       }
     });
   }
   initNotebook();

  saveBtn?.addEventListener('click', handleSaveAction);

    authController = await initAuth({
    selectors: {
      signInButtons: googleSignInBtns,
      signOutButtons: googleSignOutBtns,
      userName: googleUserName ? [googleUserName] : [],
      syncStatus: syncStatus ? [syncStatus] : [],
    },
    disableButtonBinding: true,
    onSessionChange: async (user) => {
      const nextUserId = typeof user?.uid === 'string' ? user.uid : (typeof user?.id === 'string' ? user.id : null);
      userId = nextUserId;

      if (nextUserId) {
        if (notesMigrationUserId !== nextUserId) {
          notesMigrationUserId = nextUserId;
          notesMigrationComplete = false;
          lastSyncedNoteIds = new Set();
        }
        renderSyncIndicator('online');
        googleSignInBtns.forEach((btn) => btn.classList.add('hidden'));
        googleSignOutBtns.forEach((btn) => btn.classList.remove('hidden'));
        if (googleUserName) googleUserName.textContent = user.email || '';
        await setupReminderFirestoreSync();
        await syncNotesFromFirestoreOnLogin();
        await migrateOfflineRemindersIfNeeded();
        await ensureNotificationPermission();
        return;
      }

      notesMigrationComplete = false;
      notesMigrationUserId = null;
      lastSyncedNoteIds = new Set();
      applySignedOutState();
    },
  });

  const shouldWireAuthButtons = autoWireAuthButtons;

  const wireAuthButton = (button, handler) => {
    if (!(button instanceof HTMLElement) || button._authWired) {
      return;
    }
    button.addEventListener('click', (event) => {
      try {
        const outcome = handler(event);
        if (outcome && typeof outcome.then === 'function') {
          outcome.catch((error) => {
            console.error('Auth handler error:', error);
          });
        }
      } catch (error) {
        console.error('Auth handler error:', error);
      }
    });
    button._authWired = true;
  };

  if (shouldWireAuthButtons && googleSignInBtns.length) {
    googleSignInBtns.forEach((btn) => wireAuthButton(btn, startSignInFlow));
  }

  if (shouldWireAuthButtons && googleSignOutBtns.length) {
    googleSignOutBtns.forEach((btn) => wireAuthButton(btn, startSignOutFlow));
  }

  const initialScopedUserId = typeof window !== 'undefined' && typeof window.__MEMORY_CUE_AUTH_USER_ID === 'string'
    ? window.__MEMORY_CUE_AUTH_USER_ID.trim()
    : '';

  if (!initialScopedUserId) {
    applySignedOutState();
  }

  async function syncNotesFromFirestoreOnLogin() {
    if (!userId) {
      return;
    }

    const notesFromRemote = await syncNotes();
    const normalizedNotes = Array.isArray(notesFromRemote)
      ? notesFromRemote.filter((note) => note && typeof note.id === 'string' && note.id)
      : [];

    if (normalizedNotes.length) {
      saveAllNotes(normalizedNotes, { skipRemoteSync: true });
      await syncFirestoreMemoriesToLocalCache(normalizedNotes);
      lastSyncedNoteIds = new Set(normalizedNotes.map((note) => note.id));
      return;
    }

    const localNotes = loadAllNotes();
    if (localNotes.length) {
      await syncNotes(localNotes);
    }
    lastSyncedNoteIds = new Set(localNotes.map((note) => note?.id).filter((id) => typeof id === 'string' && id));
  }

  setRemoteSyncHandler(async (notes) => {
    if (!userId) {
      return;
    }

    const serializable = Array.isArray(notes)
      ? notes.filter((note) => note && typeof note.id === 'string' && note.id)
      : [];

    await syncNotes(serializable);
    lastSyncedNoteIds = new Set(serializable.map((note) => note.id));
  });
  const reminderFirestoreSync = createReminderFirestoreSync({
    normalizeReminderRecord,
    normalizeReminderList,
    ensureOrderIndicesInitialized,
    loadReminders,
    saveToFirebase: (...args) => saveToFirebase(...args),
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
    getPendingDeletionItems: () => pendingDeletionItems,
    scheduleReminderNotification,
    render,
    updateMobileRemindersHeaderSubtitle,
    persistItems,
    rescheduleAllReminders,
    renderSyncIndicator,
  });

  async function setupReminderFirestoreSync(){
    unsubscribe = await reminderFirestoreSync.setupReminderFirestoreSync({
      userId,
      currentUnsubscribe: unsubscribe,
      hydrateOfflineReminders,
    });
  }

  async function saveToFirebase(item){
    const normalizedItem = normalizeReminderRecord(item, { fallbackId: uid() });
    const reminderId = normalizedItem.id;
    const createdAt = normalizedItem.createdAt;
    const updatedAt = Date.now();

    Object.assign(item, {
      ...normalizedItem,
      id: reminderId,
      createdAt,
      updatedAt,
      userId,
      pendingSync: true,
    });
    persistItems();

    try {
      await saveReminder(userId, {
        ...normalizedItem,
        id: reminderId,
        createdAt,
        updatedAt,
        userId,
        pendingSync: true,
      });
      item.pendingSync = false;
      persistItems();
      return true;
    } catch (error) {
      item.pendingSync = true;
      persistItems();
      console.error('Save failed:', error); toast('Save queued (offline)');
      return false;
    }
  }
  async function deleteFromFirebase(id){
    if (!userId) {
      return true;
    }
    try {
      await removeReminder(userId, id);
      return true;
    } catch (error) {
      console.error('Delete failed:', error);
      return false;
    }
  }

  async function tryCalendarSync(task){ const url=(localStorage.getItem('syncUrl')||'').trim(); if(!url) return; const payload={ id: task.id, title: task.title, dueIso: task.due || null, priority: task.priority || 'Medium', category: task.category || DEFAULT_CATEGORY, done: !!task.done, source: 'memory-cue-mobile' }; try{ await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }catch{} }

  function resetForm({ preserveDetail = false, resetMode = true } = {}){
    if(title) title.value='';
    if(date) date.value='';
    if(time) time.value='';
    if(details) details.value='';
    setPriorityInputValue('Medium');
    if(categoryInput) categoryInput.value = DEFAULT_CATEGORY;
    applyStoredDefaultsToInputs();
    if (resetMode) {
      setReminderMode(null);
    } else {
      editingId = currentReminderMode === 'edit' ? currentReminderId : null;
    }
    if(saveBtn) saveBtn.textContent='Add reminder';
    cancelEditBtn?.classList.add('hidden');
    clearPlannerReminderContext();
    if (!preserveDetail) {
      clearDetailSelection();
    }
  }
  function loadForEdit(id){
    const it = items.find(x=>x.id===id);
    if(!it) return;
    setReminderMode('edit', id);
    if(title) title.value=it.title||'';
    if(date&&time){ if(it.due){ date.value=isoToLocalDate(it.due); time.value=isoToLocalTime(it.due); } else { date.value=''; time.value=''; } }
    setPriorityInputValue(it?.priority || 'Medium');
    if(categoryInput) categoryInput.value = normalizeCategory(it.category);
    if(details) details.value = typeof it.notes === 'string' ? it.notes : '';
    if(plannerLessonInput) plannerLessonInput.value = typeof it.plannerLessonId === 'string' ? it.plannerLessonId : '';
    clearPlannerReminderContext();
    applyDetailSelection(it);
    if(saveBtn) saveBtn.textContent='Save changes';
    cancelEditBtn?.classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
    focusTitleField();
    dispatchCueEvent('cue:open', { mode: 'edit' });
  }

  function openEditReminderSheet(reminder) {
    const reminderId = reminder?.id || reminder;
    if (!reminderId) {
      return;
    }
    setReminderMode('edit', reminderId);
    loadForEdit(reminderId);
  }

  function openNewReminderSheet(trigger = null) {
    resetForm({ resetMode: false });
    setReminderMode('new');
    const detail = { mode: 'create', trigger };
    dispatchCueEvent('cue:prepare', detail);
    dispatchCueEvent('cue:open', detail);
    focusTitleField();
  }

  if (typeof window !== 'undefined') {
    window.openNewReminderSheet = openNewReminderSheet;
    window.openEditReminderSheet = openEditReminderSheet;
  }

  if (emptyStateEl instanceof HTMLElement) {
    emptyStateEl.addEventListener('click', (event) => {
      const trigger = event.target instanceof Element
        ? event.target.closest('#emptyStateCreateBtn')
        : null;
      if (!(trigger instanceof HTMLElement)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openNewReminderSheet(trigger);
    });
  }

  function createReminderFromPayload(payload = {}, options = {}) {
    const {
      closeSheet = true,
      activityAction = 'created',
      activityLabelPrefix = 'Reminder added',
    } = options;

    const item = reminderDataService.createReminder(payload, {
      normalizeReminder: (record) => normalizeReminderRecord(record),
      createId: uid,
      defaultCategory: categoryInput ? categoryInput.value : DEFAULT_CATEGORY,
      pendingSync: !userId,
      onCreated: (createdReminder) => {
        const createdEntry = normalizeReminderRecord({
          ...createdReminder,
          userId,
          pendingSync: !userId,
        }, { fallbackId: createdReminder?.id });

        assignOrderIndexForNewItem(createdEntry, { position: 'start' });
        items = [createdEntry, ...items];
        sortItemsByOrder(items);

        const rebalanced = maybeRebalanceOrderSpacing(items);
        suppressRenderMemoryEvent = true;
        render();
        persistItems();
        updateDefaultsFrom(createdEntry);
        if (rebalanced) {
          items.forEach((entry) => saveToFirebase(entry));
        } else {
          saveToFirebase(createdEntry);
        }

        const notifyMinutesBefore = (() => {
          if (typeof createdEntry.notifyAt !== 'string' || !createdEntry.notifyAt || typeof createdEntry.due !== 'string' || !createdEntry.due) {
            return 0;
          }
          const dueMs = new Date(createdEntry.due).getTime();
          const notifyMs = new Date(createdEntry.notifyAt).getTime();
          if (!Number.isFinite(dueMs) || !Number.isFinite(notifyMs)) {
            return 0;
          }
          return Math.max(0, Math.round((dueMs - notifyMs) / 60000));
        })();

        scheduleReminderNotification({
          id: createdEntry.id,
          text: createdEntry.title,
          dueAt: createdEntry.due,
          notifyMinutesBefore,
        });
        ensureNotificationPermission();
        tryCalendarSync(createdEntry);
        scheduleReminder(createdEntry);
        rescheduleAllReminders();
        emitReminderUpdates();
        dispatchCueEvent('memoryCue:remindersUpdated', { items });

        ensureEmbeddingForItem(createdEntry)
          .then((embeddedReminder) => {
            if (!normalizeSemanticEmbedding(embeddedReminder?.semanticEmbedding)) {
              return;
            }
            persistItems();
            dispatchCueEvent('memoryCue:remindersUpdated', { items });
          })
          .catch((error) => {
            console.warn('Failed to generate reminder embedding', error);
          });
      },
    });

    if (!item) {
      return null;
    }

    if (closeSheet) {
      closeCreateSheetIfOpen();
    }
    emitActivity({
      action: activityAction,
      label: `${activityLabelPrefix} · ${item.title}`,
    });
    return item;
  }


  const createReminderFromUi = (payload = {}) => createReminderFromPayload(buildReminderPayload(payload), { closeSheet: true });

  function addItem(obj){
    return reminderDataService.createReminder(obj, {
      normalizeReminder: (record) => normalizeReminderRecord(record),
      createId: uid,
      defaultCategory: DEFAULT_CATEGORY,
      pendingSync: !userId,
    }) || createReminderViaService(obj);
  }

  setReminderCreationHandler(createReminderFromUi);

  function addNoteToReminder(id, noteText){
    if(!userId){ toast('Sign in to add notes'); return null; }
    if(!id) return null;
    const reminder = items.find(x=>x.id===id);
    if(!reminder) return null;
    const incoming = noteText == null ? '' : (typeof noteText === 'string' ? noteText : String(noteText));
    const trimmed = incoming.trim();
    if(!trimmed) return reminder;
    const existing = typeof reminder.notes === 'string' ? reminder.notes : '';
    reminder.notes = existing ? `${existing}\n${trimmed}` : trimmed;
    reminder.updatedAt = Date.now();
    saveToFirebase(reminder);
    render();
    persistItems();
    emitActivity({
      action: 'updated',
      label: `Reminder notes updated · ${reminder.title}`,
    });
    return reminder;
  }
  function toggleDone(id){
    const it = items.find(x=>x.id===id);
    if(!it) return;
    const completed = !it.done;
    const updated = reminderDataService.completeReminder(id, completed, {
      onCompleted: (record) => {
        it.done = !!record.done;
        it.completed = !!record.completed;
        it.updatedAt = record.updatedAt;
      },
    });
    if (!updated) {
      return;
    }
    saveToFirebase(it);
    tryCalendarSync(it);
    render();
    persistItems();
    if(it.done){
      cancelReminder(id);
      emitActivity({
        action: 'completed',
        label: `Reminder completed · ${it.title}`,
      });
    } else {
      scheduleReminder(it);
      emitActivity({
        action: 'reopened',
        label: `Reminder reopened · ${it.title}`,
      });
    }
  }

  function setReminderPinnedState(id, pinned) {
    const reminder = items.find((entry) => entry?.id === id);
    if (!reminder) {
      return;
    }
    const nextValue = !!pinned;
    if (reminder.pinToToday === nextValue) {
      return;
    }
    reminder.pinToToday = nextValue;
    reminder.updatedAt = Date.now();
    saveToFirebase(reminder);
    render();
    persistItems();
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
  }

  function undoDelete(tokenId){
    if(!deleteUndoState || deleteUndoState.tokenId !== tokenId) return;
    const { item, index } = deleteUndoState;
    if(!item) {
      clearUndoDeleteState(tokenId);
      return;
    }
    if (item.id) {
      pendingDeletionItems.delete(item.id);
    }
    clearUndoDeleteState(tokenId);
    const insertAt = Number.isInteger(index) ? Math.min(Math.max(index, 0), items.length) : items.length;
    item.pendingSync = !userId;
    item.updatedAt = Date.now();
    items.splice(insertAt, 0, item);
    sortItemsByOrder(items);
    const rebalanced = maybeRebalanceOrderSpacing(items);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    scheduleReminder(item);
    if (rebalanced) {
      items.forEach((entry) => saveToFirebase(entry));
    } else {
      saveToFirebase(item);
    }
    const notifyMinutesBefore = (() => {
      if (typeof item.notifyAt !== 'string' || !item.notifyAt || typeof item.due !== 'string' || !item.due) {
        return 0;
      }
      const dueMs = new Date(item.due).getTime();
      const notifyMs = new Date(item.notifyAt).getTime();
      if (!Number.isFinite(dueMs) || !Number.isFinite(notifyMs)) {
        return 0;
      }
      return Math.max(0, Math.round((dueMs - notifyMs) / 60000));
    })();
    scheduleReminderNotification({
      id: item.id,
      text: item.title,
      dueAt: item.due,
      notifyMinutesBefore,
    });
    ensureNotificationPermission();
    tryCalendarSync(item);
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    emitActivity({
      action: 'restored',
      label: `Reminder restored · ${item.title}`,
    });
    toast('Reminder restored');
  }
  async function removeItem(id){
    const scrollPosition = captureReminderScrollPosition();
    const index = items.findIndex(x=>x.id===id);
    const removed = index >= 0 ? items.splice(index,1)[0] : null;
    if (removed && editingId === id) {
      resetForm();
    }
    if (!removed) {
      return;
    }
    pendingDeletionItems.set(id, removed);
    render();
    persistItems();
    restoreReminderScrollPosition(scrollPosition);
    const deletedRemotely = await deleteFromFirebase(id);
    if (!deletedRemotely) {
      pendingDeletionItems.delete(id);
      items.splice(index, 0, removed);
      sortItemsByOrder(items);
      render();
      persistItems();
      restoreReminderScrollPosition(scrollPosition);
      toast('Could not delete reminder. It was restored.');
      return;
    }
    cancelReminder(id);
    const activityLabel = removed ? `Reminder removed · ${removed.title}` : 'Reminder removed';
    emitActivity({ action: 'deleted', label: activityLabel });
    if(removed && statusEl){
      clearUndoDeleteState();
      const tokenId = `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      deleteUndoState = {
        tokenId,
        item: removed,
        index,
        timeoutId: null,
      };
      showDeleteUndoMessage(deleteUndoState);
      restoreReminderScrollPosition(scrollPosition);
      deleteUndoState.timeoutId = setTimeout(()=>{
        clearUndoDeleteState(tokenId);
      }, UNDO_DELETE_TIMEOUT_MS);
    } else if(removed) {
      clearUndoDeleteState();
    }
  }

  function enableSwipeToDelete(element, onDelete) {
    if (!element || typeof element.addEventListener !== 'function' || typeof onDelete !== 'function') {
      return;
    }

    const MIN_DISTANCE = 80;
    const MAX_VERTICAL_DISTANCE = 48;
    const MAX_DURATION = 800;
    const INTERACTIVE_SELECTOR =
      '[data-no-swipe], a[href], button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [contenteditable=""]';

    let pointerId = null;
    let tracking = false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const cleanupTracking = () => {
      if (!tracking) {
        return;
      }
      tracking = false;
      if (pointerId != null && element.hasPointerCapture?.(pointerId)) {
        try {
          element.releasePointerCapture(pointerId);
        } catch {
          /* noop */
        }
      }
      pointerId = null;
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
      element.removeEventListener('pointerleave', handlePointerCancel);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };

    const handlePointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      if (tracking) {
        cleanupTracking();
      }
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
        return;
      }

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = typeof event.timeStamp === 'number' ? event.timeStamp : Date.now();
      tracking = true;

      element.addEventListener('pointermove', handlePointerMove);
      element.addEventListener('pointerup', handlePointerUp);
      element.addEventListener('pointercancel', handlePointerCancel);
      element.addEventListener('pointerleave', handlePointerCancel);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    };

    const handlePointerMove = (event) => {
      if (!tracking || event.pointerId !== pointerId) {
        return;
      }
      const deltaY = Math.abs(event.clientY - startY);
      if (deltaY > MAX_VERTICAL_DISTANCE) {
        cleanupTracking();
      }
    };

    const handlePointerUp = (event) => {
      if (!tracking || event.pointerId !== pointerId) {
        return;
      }
      const deltaX = event.clientX - startX;
      const deltaY = Math.abs(event.clientY - startY);
      const duration = (typeof event.timeStamp === 'number' ? event.timeStamp : Date.now()) - startTime;
      cleanupTracking();
      if (deltaX <= -MIN_DISTANCE && deltaY <= MAX_VERTICAL_DISTANCE && duration <= MAX_DURATION) {
        event.preventDefault();
        event.stopPropagation();
        try {
          onDelete();
        } catch (error) {
          console.warn('Swipe delete handler failed', error);
        }
      }
    };

    const handlePointerCancel = (event) => {
      if (!tracking) {
        return;
      }
      if (typeof event.pointerId === 'number' && event.pointerId !== pointerId) {
        return;
      }
      cleanupTracking();
    };

    element.addEventListener('pointerdown', handlePointerDown);
  }


  function scheduleRecurringReminder(item) {
    const nextDue = computeNextOccurrence(item);
    if (!nextDue) {
      return false;
    }
    item.due = nextDue;
    item.snoozedUntil = null;
    item.notifyAt = null;
    item.updatedAt = Date.now();
    console.log('[reminder] recurring scheduled', { id: item.id, dueAt: nextDue, recurrence: item.recurrence });
    saveToFirebase(item);
    scheduleReminder(item);
    persistItems();
    render();
    return true;
  }

  function handleReminderTriggered(item) {
    showReminder(item);
    const current = items.find((entry) => entry?.id === item?.id);
    if (current && scheduleRecurringReminder(current)) {
      return;
    }
    clearReminderState(item.id, { closeNotification: false });
  }

  function snoozeReminder(reminder, minutes) {
    if (!reminder || typeof reminder !== 'object') {
      return;
    }
    const now = Date.now();
    let snoozeTime = now;
    if (minutes === 'tomorrow') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      snoozeTime = tomorrow.getTime();
    } else {
      const durationMinutes = Number(minutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return;
      }
      snoozeTime = now + (durationMinutes * 60000);
    }

    reminder.snoozedUntil = new Date(snoozeTime).toISOString();
    reminder.updatedAt = now;
    saveToFirebase(reminder);
    scheduleReminder(reminder);
    persistItems();
    render();
    console.log('[reminder] snoozed', { id: reminder.id, snoozedUntil: reminder.snoozedUntil });
  }

  function buildReminderNotificationBody(entry) {
    if (!entry) return 'Due now';
    const notesText = typeof entry.notes === 'string' ? entry.notes : '';
    const firstNote = notesText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstNote) {
      if (entry.due) {
        try {
          const dueDate = new Date(entry.due);
          if (!Number.isNaN(dueDate.getTime())) {
            const timeLabel = fmtTime(dueDate);
            if (timeLabel) {
              return `${firstNote} • ${timeLabel}`;
            }
          }
        } catch {
          // ignore formatting issues
        }
      }
      return firstNote;
    }
    if (entry.due) {
      try {
        const dueDate = new Date(entry.due);
        if (!Number.isNaN(dueDate.getTime())) {
          const timeLabel = fmtTime(dueDate);
          if (timeLabel) {
            return `Due ${timeLabel}`;
          }
        }
      } catch {
        // ignore formatting issues
      }
    }
    return 'Due now';
  }

  function adviseInstallForBackground() {
    try {
      const inStandaloneMode =
        (typeof window !== 'undefined' &&
          window.matchMedia &&
          window.matchMedia('(display-mode: standalone)').matches) ||
        (typeof navigator !== 'undefined' && navigator.standalone);
      if (inStandaloneMode) {
        return;
      }
    } catch {
      // Ignore detection errors
    }
    toast('Tip: Add Memory Cue to your home screen so reminders can run in the background.');
  }

  function buildScheduledReminderPayload() {
    return Object.values(scheduledReminders || {})
      .filter((entry) => entry && typeof entry === 'object' && entry.id)
      .map((entry) => ({
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : '',
        due: typeof entry.due === 'string' ? entry.due : null,
        notifyAt: typeof entry.notifyAt === 'string' ? entry.notifyAt : null,
        recurrence: normalizeRecurrence(entry.recurrence),
        snoozedUntil: normalizeIsoString(entry.snoozedUntil),
        notifyMinutesBefore: Number.isFinite(Number(entry.notifyMinutesBefore)) ? Number(entry.notifyMinutesBefore) : 0,
        priority: entry.priority || 'Medium',
        category: entry.category || DEFAULT_CATEGORY,
        notes: typeof entry.notes === 'string' ? entry.notes : '',
        body: buildReminderNotificationBody(entry),
        urlPath: entry.urlPath || reminderLandingPath,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        notifiedAt: Number.isFinite(entry.notifiedAt) ? entry.notifiedAt : null,
        semanticEmbedding: normalizeSemanticEmbedding(entry.semanticEmbedding),
      }));
  }

  function saveScheduled(){
    try {
      localStorage.setItem('scheduledReminders', JSON.stringify(scheduledReminders));
    } catch (error) {
      console.warn('Failed to persist scheduled reminders', error);
    }
    const payload = buildScheduledReminderPayload();
    const notificationsGranted =
      typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (notificationsGranted) {
      setupBackgroundReminderSync();
    }
    syncScheduledRemindersWithServiceWorker(
      payload,
      { requestCheck: notificationsGranted }
    );
  }
  function clearReminderState(id, { closeNotification = true } = {}){
    if(closeNotification){
      const active = activeNotifications.get(id);
      if(active){
        try { active.close(); } catch {}
        activeNotifications.delete(id);
      }
    }
    if(reminderTimers[id]){ clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
    if(reminderNotifyTimers[id]){ clearTimeout(reminderNotifyTimers[id]); delete reminderNotifyTimers[id]; }
    cancelTriggerNotification(id);
    if(scheduledReminders[id]){ delete scheduledReminders[id]; saveScheduled(); }
  }
  function cancelReminder(id){ clearReminderState(id); }
  function showReminder(item){
    if(!item || !item.id || !('Notification' in window)) return;
    try{
      const existing = activeNotifications.get(item.id);
      if(existing && typeof existing.close === 'function'){
        try { existing.close(); } catch {}
      }
      const notification = new Notification(item.title,{
        body: buildReminderNotificationBody(item),
        tag:item.id
      });
      activeNotifications.set(item.id, notification);
      const remove = () => {
        if(activeNotifications.get(item.id) === notification){
          activeNotifications.delete(item.id);
        }
      };
      if(typeof notification.addEventListener === 'function'){
        notification.addEventListener('close', remove);
        notification.addEventListener('click', remove);
      }
      notification.onclose = remove;
      notification.onclick = remove;
    }catch{}
  }
  async function scheduleTriggerNotification(item){
    if(!supportsNotificationTriggers()) return false;
    const Trigger = getTimestampTriggerCtor();
    const scheduledIso = getReminderScheduleIso(item);
    if(!Trigger || !scheduledIso) return false;
    const dueTime = new Date(scheduledIso).getTime();
    if(!Number.isFinite(dueTime)) return false;
    const registration = await ensureServiceWorkerRegistration();
    if(!registration) return false;
    await cancelTriggerNotification(item.id, registration);
    const body = buildReminderNotificationBody(item);
    const data = {
      id: item.id,
      title: item.title,
      due: scheduledIso,
      priority: item.priority || 'Medium',
      category: item.category || DEFAULT_CATEGORY,
      body,
      urlPath: reminderLandingPath,
    };
    const options = { body, tag: item.id, data, renotify: true };
    if(dueTime > Date.now()){
      options.showTrigger = new Trigger(dueTime);
    }
    try {
      await registration.showNotification(item.title, options);
      return true;
    } catch (err) {
      console.warn('Failed to schedule persistent notification', err);
      return false;
    }
  }
  function scheduleReminder(item){
    if(!item||!item.id) return;
    item.category = normalizeCategory(item.category);
    if(item.done){ cancelReminder(item.id); return; }
    const previous = scheduledReminders[item.id] || {};
    const stored = {
      id:item.id,
      title:item.title,
      due: getReminderScheduleIso(item),
      notifyAt: typeof item.notifyAt === 'string' ? item.notifyAt : null,
      recurrence: normalizeRecurrence(item.recurrence),
      snoozedUntil: normalizeIsoString(item.snoozedUntil),
      notifyMinutesBefore: Number.isFinite(Number(item.notifyMinutesBefore)) ? Number(item.notifyMinutesBefore) : 0,
      category: item.category || DEFAULT_CATEGORY,
      priority: item.priority || 'Medium',
      notes: typeof item.notes === 'string' ? item.notes : '',
      body: buildReminderNotificationBody(item),
      urlPath: reminderLandingPath,
      updatedAt: Date.now(),
      viaTrigger: !!previous.viaTrigger,
      semanticEmbedding: normalizeSemanticEmbedding(item.semanticEmbedding),
      notifiedAt: (() => {
        const prevDue = typeof previous.due === 'string' ? previous.due : null;
        const prevNotified = Number.isFinite(previous.notifiedAt) ? previous.notifiedAt : null;
        return prevDue === item.due ? prevNotified : null;
      })(),
    };
    scheduledReminders[item.id]=stored;
    saveScheduled();
    if(reminderTimers[item.id]){ clearTimeout(reminderTimers[item.id]); delete reminderTimers[item.id]; }
    if(reminderNotifyTimers[item.id]){ clearTimeout(reminderNotifyTimers[item.id]); delete reminderNotifyTimers[item.id]; }
    if(!('Notification' in window) || Notification.permission!=='granted'){ return; }
    const scheduleIso = stored.due;
    if(!scheduleIso){ cancelReminder(item.id); return; }
    const dueTime = new Date(scheduleIso).getTime();
    if(!Number.isFinite(dueTime)) return;
    const notifyMinutesBefore = Number.isFinite(Number(item.notifyMinutesBefore)) ? Number(item.notifyMinutesBefore) : 0;
    const notifyTime = dueTime - (Math.max(0, notifyMinutesBefore) * 60000);
    const delay = dueTime - Date.now();
    if(delay<=0){
      if(scheduledReminders[item.id]?.viaTrigger){
        clearReminderState(item.id,{ closeNotification:false });
        return;
      }
      handleReminderTriggered({ ...item, due: scheduleIso });
      return;
    }
    const useTriggers = supportsNotificationTriggers();
    if(Number.isFinite(notifyTime) && notifyTime > Date.now() && notifyTime < dueTime){
      const notifyDelay = notifyTime - Date.now();
      reminderNotifyTimers[item.id] = setTimeout(() => {
        showReminder({ ...item, due: scheduleIso });
      }, notifyDelay);
    }
    if(useTriggers){
      stored.viaTrigger = false;
      scheduleTriggerNotification(item).then((scheduled) => {
        if(scheduled && scheduledReminders[item.id]){
          scheduledReminders[item.id] = { ...scheduledReminders[item.id], viaTrigger: true };
          saveScheduled();
        }
      });
    }
    reminderTimers[item.id]=setTimeout(()=>{
      if(useTriggers){
        cancelTriggerNotification(item.id);
      }
      handleReminderTriggered({ ...item, due: scheduleIso });
    }, delay);
  }
  function rescheduleAllReminders(){ Object.values(scheduledReminders).forEach(it=>scheduleReminder({ ...it, category: normalizeCategory(it?.category) })); }

  function formatDesktopDue(item){
    if(!item?.due) {
      const fallbackLabel = extractReminderInlineSchedule(getReminderDisplaySourceText(item)).label;
      return fallbackLabel || 'No due date';
    }
    try {
      const due = new Date(item.due);
      const dayLabel = desktopDayLabelFmt.format(due);
      const dateLabel = desktopShortDateFmt.format(due);
      const timeLabel = fmtTime(due);
      return `${dayLabel}, ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}`;
    } catch {
      return 'No due date';
    }
  }

  function getPinToggleHandlerProp() {
    return '__mcPinToggleHandler';
  }
  var pinToggleSyncScheduled = false;

  function updatePinToggleVisualState(toggle, pinned) {
    if (!(toggle instanceof HTMLElement)) {
      return;
    }
    toggle.classList.add('reminder-title-toggle');
    toggle.classList.toggle(PIN_TOGGLE_PINNED_CLASS, pinned);
    toggle.classList.toggle(PIN_TOGGLE_UNPINNED_CLASS, !pinned);
    toggle.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  }

  function bindTodayToggleListener(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (element[getPinToggleHandlerProp()]) {
      return;
    }
    if (!element.hasAttribute('role')) {
      element.setAttribute('role', 'button');
    }
    if (!element.hasAttribute('tabindex')) {
      element.tabIndex = 0;
    }
    element.classList.add('cursor-pointer');
    const handleToggle = async (event) => {
      if (event?.defaultPrevented) {
        return;
      }
      event.stopPropagation();
      if (typeof event?.preventDefault === 'function') {
        event.preventDefault();
      }
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const card = typeof target.closest === 'function' ? target.closest('[data-reminder-item]') : null;
      const reminderId = card?.dataset?.id;
      if (!reminderId) {
        updatePinToggleVisualState(target, false);
        return;
      }
      const nextValue = !target.classList.contains(PIN_TOGGLE_PINNED_CLASS);
      await Promise.resolve(setReminderPinnedState(reminderId, nextValue));
      updatePinToggleVisualState(target, nextValue);
    };
    const handleKeyDown = (event) => {
      if (event?.defaultPrevented) {
        return;
      }
      if (event?.key === 'Enter' || event?.key === ' ') {
        event.preventDefault();
        handleToggle(event);
      }
    };
    element.addEventListener('click', handleToggle);
    element.addEventListener('keydown', handleKeyDown);
    element[getPinToggleHandlerProp()] = { click: handleToggle, keydown: handleKeyDown };
  }

  function syncPinToggleStates() {
    if (!list) {
      return;
    }
    const toggles = list.querySelectorAll('[data-role="reminder-today-toggle"]');
    if (!toggles.length) {
      return;
    }
    toggles.forEach((toggle) => {
      if (!(toggle instanceof HTMLElement)) {
        return;
      }
      const card = typeof toggle.closest === 'function' ? toggle.closest('[data-reminder-item]') : null;
      const reminderId = card?.dataset?.id;
      if (!reminderId) {
        updatePinToggleVisualState(toggle, false);
        bindTodayToggleListener(toggle);
        return;
      }
      const reminder = items.find((entry) => entry?.id === reminderId);
      const pinned = !!reminder?.pinToToday;
      updatePinToggleVisualState(toggle, pinned);
      bindTodayToggleListener(toggle);
    });
  }

  function schedulePinToggleSync() {
    if (!list || pinToggleSyncScheduled) {
      return;
    }
    pinToggleSyncScheduled = true;
    const runner = () => {
      pinToggleSyncScheduled = false;
      syncPinToggleStates();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(runner);
    } else {
      setTimeout(runner, 16);
    }
  }

  function isReminderForTodayMobile(reminder, todayRange) {
    if (!reminder || typeof reminder !== 'object') {
      return false;
    }
    if (reminder.pinToToday === true) {
      return true;
    }
    if (!reminder.due || !todayRange || !todayRange.start || !todayRange.end) {
      return false;
    }
    const dueDate = new Date(reminder.due);
    if (Number.isNaN(dueDate.getTime())) {
      return false;
    }
    return dueDate >= todayRange.start && dueDate <= todayRange.end;
  }

  function getReminderStartOfDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function getMobileReminderSectionKey(reminder, todayRange) {
    if (!reminder || typeof reminder !== 'object') {
      return 'later';
    }
    if (isReminderForTodayMobile(reminder, todayRange)) {
      return 'today';
    }
    if (!reminder.due) {
      return 'unscheduled';
    }

    const dueDate = new Date(reminder.due);
    const todayStart = getReminderStartOfDay(todayRange?.start);
    const dueStart = getReminderStartOfDay(dueDate);
    if (!todayStart || !dueStart) {
      return 'unscheduled';
    }

    const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000);
    if (diffDays < 0) {
      return 'overdue';
    }
    if (diffDays <= 7) {
      return 'upcoming';
    }
    return 'later';
  }

  function buildMobileReminderSections(reminders = [], todayRange) {
    const sectionOrder = [
      { key: 'overdue', label: 'Overdue', items: [] },
      { key: 'today', label: 'Today', items: [] },
      { key: 'upcoming', label: 'Upcoming', items: [] },
      { key: 'later', label: 'Later', items: [] },
      { key: 'unscheduled', label: 'No date', items: [] },
    ];
    const sectionsByKey = new Map(sectionOrder.map((section) => [section.key, section]));

    (Array.isArray(reminders) ? reminders : []).forEach((reminder) => {
      const sectionKey = getMobileReminderSectionKey(reminder, todayRange);
      const section = sectionsByKey.get(sectionKey) || sectionsByKey.get('later');
      section.items.push(reminder);
    });

    return sectionOrder.filter((section) => section.items.length);
  }

  function appendMobileReminderSectionHeading(parent, label, listIsSemantic) {
    if (!(parent instanceof HTMLElement) || !label) {
      return;
    }
    const headingEl = document.createElement(listIsSemantic ? 'li' : 'div');
    headingEl.className = 'reminder-mobile-section-heading';

    const headingLabel = document.createElement('span');
    headingLabel.className = 'reminder-mobile-section-heading-label';
    headingLabel.textContent = label;
    headingEl.appendChild(headingLabel);
    parent.appendChild(headingEl);
  }

  function formatMobileReminderMeta(reminder, categoryName, todayRange) {
    if (!reminder || typeof reminder !== 'object') {
      return '';
    }

    const metaParts = [];
    const inlineSchedule = extractReminderInlineSchedule(getReminderDisplaySourceText(reminder), todayRange);
    const dueDate = reminder.due ? new Date(reminder.due) : null;
    const hasValidDueDate = dueDate instanceof Date && !Number.isNaN(dueDate.getTime());

    if (hasValidDueDate) {
      const dueStart = getReminderStartOfDay(dueDate);
      const todayStart = getReminderStartOfDay(todayRange?.start);
      const diffDays = dueStart && todayStart
        ? Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000)
        : null;
      const timeLabel = fmtTime(dueDate);

      if (diffDays === 0) {
        metaParts.push(timeLabel ? `Today, ${timeLabel}` : 'Today');
      } else if (diffDays === 1) {
        metaParts.push(timeLabel ? `Tomorrow, ${timeLabel}` : 'Tomorrow');
      } else if (typeof diffDays === 'number' && diffDays < 0) {
        metaParts.push(timeLabel ? `Overdue, ${timeLabel}` : 'Overdue');
      } else {
        metaParts.push(formatDesktopDue(reminder));
      }
    } else if (inlineSchedule.label) {
      metaParts.push(inlineSchedule.label);
    } else if (reminder.pinToToday === true) {
      metaParts.push('Pinned for today');
    }

    const hasCustomCategory = Boolean(categoryName && categoryName !== DEFAULT_CATEGORY);
    if (hasCustomCategory) {
      metaParts.push(categoryName);
    }

    return metaParts.join('  ·  ');
  }

  function setupReminderSortControl() {
    if (typeof HTMLSelectElement === 'undefined' || !(sortSelect instanceof HTMLSelectElement)) {
      return;
    }

    const allowedModes = new Set(Object.values(REMINDER_SORT_OPTIONS));
    const initialMode = String(sortSelect.value || '').trim().toLowerCase();
    reminderSortMode = allowedModes.has(initialMode) ? initialMode : REMINDER_SORT_OPTIONS.created;
    sortSelect.value = reminderSortMode;

    if (setupReminderSortControl._wired) {
      return;
    }

    sortSelect.addEventListener('change', () => {
      const nextMode = String(sortSelect.value || '').trim().toLowerCase();
      if (!allowedModes.has(nextMode) || nextMode === reminderSortMode) {
        return;
      }
      reminderSortMode = nextMode;
      render();
    });

    const sortToggleBtn = document.getElementById('reminderSortToggle');
    if (sortToggleBtn instanceof HTMLElement) {
      const updateSortToggleLabel = () => {
        const label = reminderSortMode === REMINDER_SORT_OPTIONS.timeRelevance
          ? 'Time relevance ▼'
          : 'Created ▼';
        sortToggleBtn.textContent = label;
        sortToggleBtn.setAttribute('aria-label', `Sort reminders (${label.replace(' ▼', '')})`);
        sortToggleBtn.title = `Sort reminders (${label.replace(' ▼', '')})`;
      };
      const normalizeSortToggleCopy = () => {
        const label = reminderSortMode === REMINDER_SORT_OPTIONS.timeRelevance
          ? 'Due first'
          : 'Recent';
        sortToggleBtn.textContent = label;
        sortToggleBtn.setAttribute('aria-label', `Reminder order: ${label}`);
        sortToggleBtn.title = `Reminder order: ${label}`;
      };

      sortToggleBtn.addEventListener('click', () => {
        const modes = [
          REMINDER_SORT_OPTIONS.created,
          REMINDER_SORT_OPTIONS.timeRelevance,
        ];
        const currentIndex = modes.indexOf(reminderSortMode);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        reminderSortMode = nextMode;
        sortSelect.value = nextMode;
        updateSortToggleLabel();
        normalizeSortToggleCopy();
        render();
      });
      updateSortToggleLabel();
      normalizeSortToggleCopy();
    }

    setupReminderSortControl._wired = true;
  }

  function getReminderDisplaySourceText(reminder) {
    if (!reminder || typeof reminder !== 'object') {
      return '';
    }
    const raw = [reminder.title, reminder.text, reminder.notes]
      .find((value) => typeof value === 'string' && value.trim());
    return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  }

  function formatDisplayTitleCase(text) {
    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) {
      return '';
    }
    return normalized
      .split(/\s+/)
      .map((word, index, words) => {
        if (!word) {
          return word;
        }
        if (/[A-Z]{2,}/.test(word)) {
          return word;
        }
        const lower = word.toLowerCase();
        if (index > 0 && index < words.length - 1 && DISPLAY_TITLE_SMALL_WORDS.has(lower)) {
          return lower;
        }
        return lower.replace(/(^|['-])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
      })
      .join(' ');
  }

  function stripReminderPromptPrefix(text) {
    let cleaned = typeof text === 'string' ? text.trim() : '';
    if (!cleaned) {
      return '';
    }

    const prefixPatterns = [
      /^(?:and\s+)+/i,
      /^(?:(?:please|hey|ok(?:ay)?)\s+)?(?:(?:add|set|create|make)\s+)?(?:(?:me\s+)?(?:a|an)\s+)?(?:new\s+)?(?:reminder|remider|remind(?:er)?(?:\s+me)?|reminder\s+me)\b[\s:,-]*/i,
      /^(?:and\s+)?(?:remind(?:er)?\s+me\s+to|remind\s+me\s+to|remember\s+to)\b[\s:,-]*/i,
    ];

    let updated = true;
    while (updated && cleaned) {
      updated = false;
      prefixPatterns.forEach((pattern) => {
        const next = cleaned.replace(pattern, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          updated = true;
        }
      });
    }

    return cleaned;
  }

  function formatDisplayTimeLabel(hours, minutes, meridiemHint = '') {
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return '';
    }

    let normalizedHours = hours;
    const normalizedMeridiem = typeof meridiemHint === 'string' ? meridiemHint.trim().toLowerCase() : '';
    if (normalizedMeridiem === 'pm' && normalizedHours < 12) {
      normalizedHours += 12;
    }
    if (normalizedMeridiem === 'am' && normalizedHours === 12) {
      normalizedHours = 0;
    }

    const date = new Date();
    date.setHours(normalizedHours, minutes, 0, 0);
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function extractReminderInlineSchedule(rawText, todayRange) {
    const sourceText = typeof rawText === 'string' ? rawText.replace(/\s+/g, ' ').trim() : '';
    if (!sourceText) {
      return { textWithoutSchedule: '', label: '' };
    }

    let cleaned = stripReminderPromptPrefix(sourceText);
    let dayLabel = '';
    let dayPattern = null;
    const lower = cleaned.toLowerCase();
    const weekdayMatch = lower.match(/\b(?:(next)\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
    const weekdayLabels = {
      mon: 'Monday',
      monday: 'Monday',
      tue: 'Tuesday',
      tues: 'Tuesday',
      tuesday: 'Tuesday',
      wed: 'Wednesday',
      wednesday: 'Wednesday',
      thu: 'Thursday',
      thur: 'Thursday',
      thurs: 'Thursday',
      thursday: 'Thursday',
      fri: 'Friday',
      friday: 'Friday',
      sat: 'Saturday',
      saturday: 'Saturday',
      sun: 'Sunday',
      sunday: 'Sunday',
    };

    if (/\btomorrow\b/i.test(cleaned)) {
      dayLabel = 'Tomorrow';
      dayPattern = /\btomorrow\b/i;
    } else if (/\btonight\b/i.test(cleaned)) {
      dayLabel = 'Tonight';
      dayPattern = /\btonight\b/i;
    } else if (/\btoday\b/i.test(cleaned)) {
      dayLabel = 'Today';
      dayPattern = /\btoday\b/i;
    } else if (weekdayMatch) {
      dayLabel = weekdayLabels[(weekdayMatch[2] || '').toLowerCase()] || '';
      dayPattern = weekdayMatch[0] ? new RegExp(weekdayMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    }

    let timeLabel = '';
    let timePattern = null;
    const meridiemMatch = cleaned.match(/\b(?:at\s*)?(\d{1,2})(?::?(\d{2}))\s*(am|pm)\b/i)
      || cleaned.match(/\b(?:at\s*)?(\d{1,2})\s*(am|pm)\b/i);

    if (meridiemMatch) {
      const hour = Number.parseInt(meridiemMatch[1], 10);
      const minute = meridiemMatch.length >= 4 && meridiemMatch[3]
        ? Number.parseInt(meridiemMatch[2], 10)
        : 0;
      const meridiem = meridiemMatch.length >= 4 ? meridiemMatch[3] : meridiemMatch[2];
      timeLabel = formatDisplayTimeLabel(hour, minute, meridiem);
      timePattern = meridiemMatch[0] ? new RegExp(meridiemMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    }

    if (!timeLabel) {
      const twentyFourHourMatch = cleaned.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (twentyFourHourMatch) {
        timeLabel = formatDisplayTimeLabel(
          Number.parseInt(twentyFourHourMatch[1], 10),
          Number.parseInt(twentyFourHourMatch[2], 10),
        );
        timePattern = twentyFourHourMatch[0]
          ? new RegExp(twentyFourHourMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : null;
      }
    }

    if (dayPattern) {
      cleaned = cleaned.replace(dayPattern, ' ').trim();
    }
    if (timePattern) {
      cleaned = cleaned.replace(timePattern, ' ').trim();
    }

    cleaned = cleaned
      .replace(/\b(?:remind(?:er)?\s+me|reminder\s+me)\b/gi, ' ')
      .replace(/^[,.\-:;\s]+|[,.\-:;\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^(?:and|to)\b\s*/i, '')
      .replace(/\b(?:at|on|by|for)\b\s*$/i, '')
      .trim();

    const label = [dayLabel, timeLabel].filter(Boolean).join(', ');
    return {
      textWithoutSchedule: cleaned,
      label,
    };
  }

  function hasReminderDueValue(reminder) {
    if (!reminder || typeof reminder !== 'object' || !reminder.due) {
      return false;
    }
    const dueDate = new Date(reminder.due);
    return !Number.isNaN(dueDate.getTime());
  }

  function resolveReminderDisplayTitle(reminder) {
    const sourceText = getReminderDisplaySourceText(reminder);
    const titleSource = hasReminderDueValue(reminder)
      ? (extractReminderInlineSchedule(sourceText).textWithoutSchedule || sourceText)
      : sourceText;
    const cleanedTitle = formatDisplayTitleCase(titleSource);
    return cleanedTitle || 'Untitled reminder';
  }


  function getUpcomingTodayReminders(reminders = []) {
    const now = Date.now();
    const tomorrow = now + 24 * 60 * 60 * 1000;
    return (Array.isArray(reminders) ? reminders : [])
      .filter((reminder) => {
        if (!reminder || reminder.done) {
          return false;
        }
        const scheduleIso = getReminderScheduleIso(reminder);
        if (!scheduleIso) {
          return false;
        }
        const time = new Date(scheduleIso).getTime();
        return Number.isFinite(time) && time >= now && time <= tomorrow;
      })
      .sort((a, b) => new Date(getReminderScheduleIso(a)).getTime() - new Date(getReminderScheduleIso(b)).getTime());
  }

  function groupRemindersByDay(reminders = []) {
    const grouped = {};
    (Array.isArray(reminders) ? reminders : []).forEach((reminder) => {
      if (!reminder || reminder.done) {
        return;
      }
      const scheduleIso = getReminderScheduleIso(reminder);
      if (!scheduleIso) {
        return;
      }
      const date = new Date(scheduleIso);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const dayKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(reminder);
    });

    Object.values(grouped).forEach((entries) => {
      entries.sort((a, b) => new Date(getReminderScheduleIso(a)).getTime() - new Date(getReminderScheduleIso(b)).getTime());
    });
    return grouped;
  }

  function ensureReminderOverviewSection(upcoming = [], grouped = {}) {
    if (!(listWrapper instanceof HTMLElement)) {
      return;
    }
    let section = listWrapper.querySelector('[data-reminder-overview]');
    if (!section) {
      section = document.createElement('section');
      section.setAttribute('data-reminder-overview', 'true');
      section.className = 'space-y-3 mb-3';
      listWrapper.insertBefore(section, listWrapper.firstChild || null);
    }
    section.replaceChildren();

    const renderBlock = (label, rows) => {
      const block = document.createElement('div');
      const heading = document.createElement('h3');
      heading.className = 'text-sm font-semibold text-base-content/80';
      heading.textContent = label;
      block.appendChild(heading);
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-base-content/60';
        empty.textContent = 'No reminders.';
        block.appendChild(empty);
        section.appendChild(block);
        return;
      }
      const ul = document.createElement('ul');
      ul.className = 'text-xs text-base-content/80 space-y-1';
      rows.forEach((entry) => {
        const li = document.createElement('li');
        const scheduleIso = getReminderScheduleIso(entry);
        const scheduleDate = scheduleIso ? new Date(scheduleIso) : null;
        const timeLabel = scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? fmtTime(scheduleDate) : '';
        li.textContent = `${entry.title || 'Untitled reminder'}${timeLabel ? ` · ${timeLabel}` : ''}`;
        ul.appendChild(li);
      });
      block.appendChild(ul);
      section.appendChild(block);
    };

    renderBlock('Upcoming Today', upcoming);

    const agendaBlock = document.createElement('div');
    const agendaHeading = document.createElement('h3');
    agendaHeading.className = 'text-sm font-semibold text-base-content/80';
    agendaHeading.textContent = 'Agenda';
    agendaBlock.appendChild(agendaHeading);

    const dayKeys = Object.keys(grouped).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    if (!dayKeys.length) {
      const emptyAgenda = document.createElement('p');
      emptyAgenda.className = 'text-xs text-base-content/60';
      emptyAgenda.textContent = 'No scheduled reminders.';
      agendaBlock.appendChild(emptyAgenda);
      section.appendChild(agendaBlock);
      return;
    }

    dayKeys.forEach((dayKey) => {
      const date = new Date(dayKey);
      const subHeading = document.createElement('h4');
      subHeading.className = 'text-xs font-medium mt-2 text-base-content/70';
      subHeading.textContent = date.toDateString();
      agendaBlock.appendChild(subHeading);

      const ul = document.createElement('ul');
      ul.className = 'text-xs text-base-content/80 space-y-1';
      (grouped[dayKey] || []).forEach((entry) => {
        const li = document.createElement('li');
        const scheduleIso = getReminderScheduleIso(entry);
        const scheduleDate = scheduleIso ? new Date(scheduleIso) : null;
        const timeLabel = scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? fmtTime(scheduleDate) : '';
        li.textContent = `${entry.title || 'Untitled reminder'}${timeLabel ? ` · ${timeLabel}` : ''}`;
        ul.appendChild(li);
      });
      agendaBlock.appendChild(ul);
    });
    section.appendChild(agendaBlock);
  }

  function setupMobileReminderTabs() {
    if (variant !== 'mobile') {
      return;
    }
    updateMobileRemindersHeaderSubtitle();
  }

  function render(){
    setupReminderSortControl();
    const now = new Date();
    const localNow = new Date(now);
    const t0 = new Date(localNow); t0.setHours(0,0,0,0);
    const t1 = new Date(localNow); t1.setHours(23,59,59,999);
    const todayRange = { start: t0, end: t1 };

    clearDragHighlights();
    items = normalizeReminderList(items);
    sortItemsByOrder(items);

    if (countTotalEl) {
      try {
        countTotalEl.textContent = String(items.length);
      } catch {}
    }

    items.forEach(item => {
      if (item && typeof item === 'object') {
        item.category = normalizeCategory(item.category);
      }
    });

    const categorySet = new Set(SEEDED_CATEGORIES.map(cat => normalizeCategory(cat)));
    items.forEach(item => {
      if (item && typeof item === 'object') {
        categorySet.add(normalizeCategory(item.category));
      }
    });
    const allCategories = Array.from(categorySet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (categoryDatalist) {
      const existing = new Set();
      Array.from(categoryDatalist.querySelectorAll('option')).forEach(opt => {
        existing.add(opt.value.trim().toLowerCase());
      });
      allCategories.forEach(cat => {
        const key = cat.toLowerCase();
        if (!existing.has(key)) {
          const option = document.createElement('option');
          option.value = cat;
          categoryDatalist.appendChild(option);
          existing.add(key);
        }
      });
    }

    if (suppressRenderMemoryEvent) {
      suppressRenderMemoryEvent = false;
    } else if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      const payload = items.map(item => ({ ...item }));
      try {
        if (typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated', { detail: { items: payload } }));
        } else if (document.createEvent) {
          const evt = document.createEvent('CustomEvent');
          if (evt && evt.initCustomEvent) {
            evt.initCustomEvent('memoryCue:remindersUpdated', false, false, { items: payload });
            document.dispatchEvent(evt);
          }
        }
      } catch {
        // Ignore dispatch errors so reminder rendering can continue.
      }
    }

    let rows = sortReminderRows(items);
    const activeRows = rows.filter((row) => !row?.done);

    if (variant === 'mobile') {
      mobileRemindersCache = rows.slice();
      rows = mobileRemindersCache.slice();
      updateMobileRemindersHeaderSubtitle();
    }

    const highlightToday = true;

    const hasAny = items.length > 0;
    const hasRows = activeRows.length > 0;
    const upcomingToday = getUpcomingTodayReminders(activeRows);
    const agendaGroups = groupRemindersByDay(activeRows);
    if (variant === 'mobile') {
      listWrapper?.querySelector('[data-reminder-overview]')?.remove();
    } else {
      ensureReminderOverviewSection(upcomingToday, agendaGroups);
    }
    const pendingNotificationIds = (() => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return new Set();
      }
      const entries = Object.values(scheduledReminders || {}).filter((entry) => entry && typeof entry === 'object' && entry.id);
      return new Set(entries.map((entry) => entry.id));
    })();

    if(emptyStateEl){
      if(!hasRows){
        const description = hasAny ? 'You are all caught up for now.' : emptyInitialText;
        if(sharedEmptyStateMount){
          sharedEmptyStateMount(emptyStateEl, {
            icon: hasAny ? 'sparkles' : 'bell',
            title: hasAny ? 'All clear' : 'Create your first cue',
            description,
            action: hasAny
              ? undefined
              : `<button id="emptyStateCreateBtn" type="button" class="${sharedEmptyStateCtaClasses}">Create reminder</button>`
          });
        } else {
          emptyStateEl.textContent = description;
        }
        emptyStateEl.classList.remove('hidden');
      } else {
        emptyStateEl.classList.add('hidden');
      }
    }

    if(listWrapper){
      listWrapper.classList.toggle('has-items', hasRows);
    }

    if(!list){
      return;
    }

    if(!hasRows){
      if(emptyStateEl){
        list.innerHTML = '';
        list.classList.add('hidden');
      } else {
        list.innerHTML = '<div class="text-muted">No reminders found.</div>';
        list.classList.remove('hidden');
      }
      schedulePinToggleSync();
      return;
    }

    list.classList.remove('hidden');
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    const listIsSemantic = list.tagName === 'UL' || list.tagName === 'OL';

    const priorityClassTokens = ['priority-high', 'priority-medium', 'priority-low'];
    const applyPriorityTokensToCard = (card, priorityValue) => {
      if (!(card instanceof HTMLElement)) {
        return;
      }

      card.classList.remove(...priorityClassTokens);

      const normalized = typeof priorityValue === 'string' ? priorityValue.trim().toLowerCase() : '';

      if (normalized.startsWith('h')) {
        card.classList.add('priority-high');
      } else if (normalized.startsWith('m')) {
        card.classList.add('priority-medium');
      } else if (normalized.startsWith('l')) {
        card.classList.add('priority-low');
      }
    };

    const createMetaChip = (label, tone = 'neutral') => {
      const chip = document.createElement('span');
      chip.className =
        'desktop-reminder-chip inline-flex max-w-full items-center gap-1 rounded-full border border-base-300/80 bg-base-200/80 px-2 py-[2px] text-[0.65rem] font-medium text-base-content/70';
      chip.title = label;
      chip.dataset.tone = tone;

      const dot = document.createElement('span');
      dot.className = 'desktop-reminder-chip__dot h-1.5 w-1.5 rounded-full';
      if (tone === 'priority-high') {
        dot.classList.add('bg-error');
      } else if (tone === 'priority-medium') {
        dot.classList.add('bg-warning');
      } else if (tone === 'priority-low') {
        dot.classList.add('bg-secondary');
      } else if (tone === 'category') {
        dot.classList.add('bg-primary');
      } else {
        dot.classList.add('bg-base-content', 'opacity-40');
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'truncate';
      textSpan.textContent = label;

      chip.append(dot, textSpan);
      return chip;
    };

    const buildReminderCard = (reminder, catName, { elementTag, isMobile }) => {
      const reminderTitle = resolveReminderDisplayTitle(reminder);
      const summary = {
        id: reminder.id,
        title: reminderTitle,
        dueIso: reminder.due || null,
        priority: reminder.priority || 'Medium',
        category: catName,
        done: Boolean(reminder.done),
        pinToToday: reminder.pinToToday === true,
      };

      const desktopCardClasses =
        'reminder-item task-item reminder-card desktop-task-card grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-base-200 bg-base-100 p-4 text-sm shadow-sm transition hover:border-base-300 hover:bg-base-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';
      const mobileCardClasses = 'task-item reminder-row reminder-card w-full text-base-content';

      const itemEl = document.createElement(elementTag);
      itemEl.className = isMobile ? mobileCardClasses : desktopCardClasses;
      itemEl.dataset.id = summary.id;
      itemEl.dataset.category = summary.category;
      itemEl.dataset.title = summary.title;
      const priorityValue = summary.priority && String(summary.priority).trim();
      if (priorityValue) {
        itemEl.dataset.priority = priorityValue;
      } else {
        delete itemEl.dataset.priority;
      }
      itemEl.dataset.done = String(summary.done);
      if (summary.dueIso) {
        itemEl.dataset.due = summary.dueIso;
      } else {
        delete itemEl.dataset.due;
      }
      if (summary.pinToToday) {
        itemEl.dataset.pinToToday = 'true';
      } else {
        delete itemEl.dataset.pinToToday;
      }
      itemEl.dataset.reminder = JSON.stringify(summary);
      itemEl.dataset.orderIndex = Number.isFinite(reminder.orderIndex) ? String(reminder.orderIndex) : '';
      itemEl.dataset.reminderItem = 'true';
      itemEl.classList.add('reminder-draggable');
      itemEl.setAttribute('draggable', 'true');
      itemEl.setAttribute('role', 'button');
      itemEl.tabIndex = 0;
      itemEl.setAttribute('aria-label', `Edit reminder: ${reminderTitle}`);

      applyPriorityTokensToCard(itemEl, summary.priority);

      if (pendingNotificationIds.has(summary.id)) {
        itemEl.dataset.notificationActive = 'true';
      } else {
        delete itemEl.dataset.notificationActive;
      }

      const dueDate = summary.dueIso ? new Date(summary.dueIso) : null;
      const dueIsToday = highlightToday && dueDate && dueDate >= t0 && dueDate <= t1;
      if (dueIsToday) {
        itemEl.classList.add('is-today');
        itemEl.dataset.today = 'true';
      } else {
        itemEl.classList.remove('is-today');
        delete itemEl.dataset.today;
      }

      const dueLabelRaw = formatDesktopDue(reminder);
      const dueLabel = dueLabelRaw && dueLabelRaw !== 'No due date' ? dueLabelRaw : '';

      const controls = document.createElement('div');
      controls.className = 'task-toolbar flex items-start gap-1';
      controls.setAttribute('role', 'toolbar');
      controls.setAttribute('aria-label', 'Reminder actions');
      controls.setAttribute('draggable', 'false');
      if (isMobile) {
        controls.classList.add('flex-shrink-0');
      }

      const stopControlGesture = (event) => {
        event.stopPropagation();
      };

      const bindReminderControlAction = (element, handler) => {
        if (!(element instanceof HTMLElement) || typeof handler !== 'function') {
          return;
        }

        element.setAttribute('draggable', 'false');
        element.addEventListener('pointerdown', stopControlGesture);
        element.addEventListener('mousedown', stopControlGesture);
        element.addEventListener('touchstart', stopControlGesture, { passive: true });
        element.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          handler();
        });
      };

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-ghost btn-circle btn-xs task-toolbar-btn reminder-icon-btn reminder-complete-toggle';
      toggleBtn.classList.toggle('reminder-complete-toggle--active', summary.done);

      const iconStateClass = summary.done
        ? 'reminder-complete-toggle-icon--checked'
        : 'reminder-complete-toggle-icon--unchecked';

      toggleBtn.innerHTML = `
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          xmlns="http://www.w3.org/2000/svg"
          focusable="false"
          class="reminder-complete-toggle-icon"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" opacity="0.32" />
          <path
            d="M5.5 12.25l4.25 4.25L18.75 7.5"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="${iconStateClass}"
          />
        </svg>`;

      if (summary.done) {
        toggleBtn.classList.add('text-base-content/60');
        toggleBtn.setAttribute('aria-label', `Mark reminder as active: ${reminderTitle}`);
      } else {
        toggleBtn.classList.add('text-success');
        toggleBtn.setAttribute('aria-label', `Mark reminder as done: ${reminderTitle}`);
      }
      toggleBtn.setAttribute('aria-pressed', summary.done ? 'true' : 'false');
      toggleBtn.setAttribute('data-reminder-control', 'toggle');
      toggleBtn.setAttribute('data-no-swipe', 'true');
      bindReminderControlAction(toggleBtn, () => {
        toggleDone(summary.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-ghost btn-circle btn-xs text-base-content/60 task-toolbar-btn reminder-icon-btn';
      deleteBtn.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" focusable="false">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <line x1=\"10\" y1=\"11\" x2=\"10\" y2=\"17\"/>
          <line x1=\"14\" y1=\"11\" x2=\"14\" y2=\"17\"/>
        </svg>`;
      deleteBtn.setAttribute('aria-label', `Delete reminder: ${reminderTitle}`);
      deleteBtn.setAttribute('data-action', 'delete');
      deleteBtn.setAttribute('data-reminder-control', 'delete');
      deleteBtn.setAttribute('data-no-swipe', 'true');
      bindReminderControlAction(deleteBtn, () => {
        try {
          removeItem(summary.id);
        } catch (err) {
          console.warn('Delete handler failed', err);
        }
      });

      const openReminder = () => openEditReminderSheet(reminder);

      if (isMobile) {
        toggleBtn.classList.add('reminder-row-complete', 'reminder-card-checkbox');

        const rowMain = document.createElement('div');
        rowMain.className = 'reminder-content reminder-card-main reminder-row-main';

        const titleWrapper = document.createElement('div');
        titleWrapper.className = 'reminder-title reminder-row-title';
        titleWrapper.dataset.reminderTitle = 'true';
        const titleToggle = document.createElement('span');
        titleToggle.dataset.role = 'reminder-today-toggle';
        titleToggle.className = 'reminder-title-toggle cursor-pointer';
        titleToggle.setAttribute('role', 'button');
        titleToggle.tabIndex = 0;
        titleToggle.textContent = reminderTitle;
        updatePinToggleVisualState(titleToggle, summary.pinToToday);
        titleWrapper.appendChild(titleToggle);
        rowMain.appendChild(titleWrapper);

        const metaText = formatMobileReminderMeta(reminder, catName, todayRange);
        if (metaText) {
          const meta = document.createElement('div');
          meta.className = 'reminder-row-meta';
          meta.textContent = metaText;
          rowMain.appendChild(meta);
        }

        if (summary.done) {
          itemEl.classList.add('reminder-row-completed');
        }

        controls.append(deleteBtn);
        itemEl.append(toggleBtn, rowMain, controls);

        itemEl.addEventListener('click', (event) => {
          if (event.defaultPrevented) return;
          const target = event.target;
          if (target && typeof target.closest === 'function' && target.closest('[data-reminder-control]')) {
            return;
          }
          openReminder();
        });
        itemEl.addEventListener('keydown', (event) => {
          if (event.defaultPrevented) return;
          if (event.target !== itemEl) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openReminder();
          }
        });

        if (isMobile) {
          enableSwipeToDelete(itemEl, () => removeItem(summary.id));
        }

        return itemEl;
      }

      const content = document.createElement('div');
      content.className = 'flex min-w-0 flex-1 flex-col gap-2';
      const titleEl = document.createElement('p');
      titleEl.className = 'text-lg font-bold leading-snug text-base-content';
      titleEl.classList.add('desktop-reminder-title');
      titleEl.classList.add('sm:text-[0.95rem]');
      if (summary.done) {
        titleEl.classList.add('line-through', 'text-base-content/60');
      }
      titleEl.textContent = reminderTitle;

      content.appendChild(titleEl);

      const metaRow = document.createElement('div');
      metaRow.className = 'desktop-reminder-meta reminder-meta flex flex-wrap items-center gap-1 text-xs text-base-content/70';

      if (dueLabel) {
        metaRow.appendChild(createMetaChip(dueLabel, 'due'));
      }

      const hasCustomCategory = Boolean(catName && catName !== DEFAULT_CATEGORY);
      if (hasCustomCategory) {
        metaRow.appendChild(createMetaChip(catName, 'category'));
      }

      if (metaRow.children.length) {
        content.appendChild(metaRow);
      }

      itemEl.appendChild(content);

      controls.append(toggleBtn, deleteBtn);
      itemEl.appendChild(controls);

      itemEl.addEventListener('click', (event) => {
        if (event.defaultPrevented) return;
        const target = event.target;
        if (target && typeof target.closest === 'function' && target.closest('[data-reminder-control]')) {
          return;
        }
        openReminder();
      });
      itemEl.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.target !== itemEl) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openReminder();
        }
      });

      if (isMobile) {
        enableSwipeToDelete(itemEl, () => removeItem(summary.id));
      }

      return itemEl;
    };

    const createMobileItem = (r, catName) => buildReminderCard(r, catName, {
      elementTag: listIsSemantic ? 'li' : 'div',
      isMobile: true,
    });

    if (variant === 'mobile') {
      const mobileSections = buildMobileReminderSections(activeRows, todayRange);
      mobileSections.forEach((section) => {
        appendMobileReminderSectionHeading(frag, section.label, listIsSemantic);
        section.items.forEach((reminder) => {
          const catName = reminder.category || DEFAULT_CATEGORY;
          frag.appendChild(createMobileItem(reminder, catName));
        });
      });
    } else {
      activeRows.forEach((r) => {
        const catName = r.category || DEFAULT_CATEGORY;
        const itemEl = buildReminderCard(r, catName, {
          elementTag: listIsSemantic ? 'li' : 'div',
          isMobile: false,
        });
        frag.appendChild(itemEl);
      });
    }
    list.appendChild(frag);
    syncDetailSelection();
    schedulePinToggleSync();
  }

  function closeMenu(){ moreBtn?.setAttribute('aria-expanded','false'); moreMenu?.classList.add('hidden'); }
  function openMenu(){ moreBtn?.setAttribute('aria-expanded','true'); moreMenu?.classList.remove('hidden'); }
  moreBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); const open=moreBtn.getAttribute('aria-expanded')==='true'; open ? closeMenu() : openMenu(); });
  document.addEventListener('click', (e)=>{
    if (moreMenu && !moreMenu.classList.contains('hidden') && !moreMenu.contains(e.target) && e.target !== moreBtn) {
      closeMenu();
    }
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeMenu(); });

  openSettingsBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const willShow = settingsSection?.classList.contains('hidden');
      settingsSection?.classList.toggle('hidden');
      if (willShow) settingsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeMenu();
    });
  });
  document.addEventListener('DOMContentLoaded', () => { settingsSection?.classList.add('hidden'); });

  function parseManualDueInput(dateValue, timeValue){
    const normalizedDate = typeof dateValue === 'string' ? dateValue.trim() : '';
    const normalizedTime = typeof timeValue === 'string' ? timeValue.trim() : '';

    if(!normalizedDate && !normalizedTime){
      return null;
    }

    const fallbackDate = new Date().toISOString().slice(0, 10);
    const resolvedDate = normalizedDate || fallbackDate;
    const resolvedTime = normalizedTime || '00:00';
    const parsed = new Date(`${resolvedDate}T${resolvedTime}:00`);

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function parseQuickWhen(rawText){
    const parsed = parseReminderScheduleFromText(rawText);
    const dueDate = parsed?.dueDate instanceof Date && !Number.isNaN(parsed.dueDate.getTime())
      ? parsed.dueDate
      : null;

    if (!dueDate) {
      return {
        date: new Date().toISOString().slice(0, 10),
        time: '',
      };
    }

    const year = dueDate.getFullYear();
    const month = String(dueDate.getMonth() + 1).padStart(2, '0');
    const day = String(dueDate.getDate()).padStart(2, '0');
    const hours = String(dueDate.getHours()).padStart(2, '0');
    const minutes = String(dueDate.getMinutes()).padStart(2, '0');

    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`,
    };
  }

  function handleSaveAction(){
    // Debug: log when save handler invoked to help trace click issues

    const rawTitle = typeof title?.value === 'string' ? title.value : '';
    const trimmedTitle = rawTitle.trim();
    const dateValue = typeof date?.value === 'string' ? date.value : '';
    const timeValue = typeof time?.value === 'string' ? time.value : '';
    const plannerLinkId = typeof plannerLessonInput?.value === 'string' ? plannerLessonInput.value.trim() : '';

    if(currentReminderMode === 'edit' && editingId){
      const it = items.find(x=>x.id===editingId);
      if(!it){ resetForm(); return; }
      if(!trimmedTitle){ toast('Add a reminder title'); return; }
      let due = parseManualDueInput(dateValue, timeValue);
      if (!due) { const p=parseQuickWhen(trimmedTitle); if(p.time){ due = new Date(`${p.date}T${p.time}:00`).toISOString(); } }
      it.title = trimmedTitle;
      const nextPriority = getPriorityInputValue();
      it.priority = nextPriority;
      setPriorityInputValue(nextPriority);
      if(categoryInput){ it.category = normalizeCategory(categoryInput.value); }
      it.due = due;
      it.recurrence = normalizeRecurrence(it.recurrence);
      it.snoozedUntil = normalizeIsoString(it.snoozedUntil);
      it.notifyMinutesBefore = Number.isFinite(Number(it.notifyMinutesBefore)) ? Number(it.notifyMinutesBefore) : 0;
      if(details){ it.notes = details.value.trim(); }
      it.plannerLessonId = plannerLinkId || null;
      it.updatedAt=Date.now();
      saveToFirebase(it);
      tryCalendarSync(it);
      suppressRenderMemoryEvent = true;
      render();
      scheduleReminder(it);
      persistItems();
      emitReminderUpdates();
      dispatchCueEvent('memoryCue:remindersUpdated', { items });
      closeCreateSheetIfOpen();
      emitActivity({ action: 'updated', label: `Reminder updated · ${it.title}` });
      resetForm();
      toast('Reminder updated');
      dispatchCueEvent('cue:close', { reason: 'updated' });
      return;
    }
    if(!trimmedTitle){ toast('Add a reminder title'); return; }
    const noteText = details ? details.value.trim() : '';
    const priorityValue = getPriorityInputValue();
    const normalizedCategory = categoryInput ? normalizeCategory(categoryInput.value) : DEFAULT_CATEGORY;
    let due = parseManualDueInput(dateValue, timeValue);
    if (!due) { const p=parseQuickWhen(trimmedTitle); if(p.time){ due=new Date(`${p.date}T${p.time}:00`).toISOString(); } }
    const plannerLessonDetail = plannerLinkId
      ? {
          lessonId: plannerLinkId,
          dayLabel: plannerLessonInput?.dataset?.lessonDayLabel || '',
          lessonTitle: plannerLessonInput?.dataset?.lessonTitle || '',
          summary: plannerLessonInput?.dataset?.lessonSummary || '',
        }
      : null;
    const createdItem = createReminderFromPayload({
      title:trimmedTitle,
      priority: priorityValue,
      category: normalizedCategory,
      dueAt: due,
      notes: noteText,
      plannerLessonId: plannerLinkId || null,
    }, {
      closeSheet: false,
    });

    const createdItemResolved = createdItem && typeof createdItem.then === 'function'
      ? null
      : createdItem;
    const applyCreatedResult = (resolvedItem) => {
      if (!resolvedItem) {
        return;
      }
      const isReminderItem = Object.prototype.hasOwnProperty.call(resolvedItem, 'done');
      if (plannerLessonDetail && isReminderItem) {
        toast('Planner reminder created');
        dispatchCueEvent('planner:reminderCreated', {
          lessonId: plannerLessonDetail.lessonId,
          dayLabel: plannerLessonDetail.dayLabel,
          lessonTitle: plannerLessonDetail.lessonTitle,
          summary: plannerLessonDetail.summary,
          reminderId: resolvedItem.id,
          reminderTitle: resolvedItem.title,
          reminderDue: resolvedItem.due || null,
        });
      } else if (isReminderItem) {
        toast('Reminder created');
      } else {
        toast('Saved');
      }
    };

    if (createdItem && typeof createdItem.then === 'function') {
      createdItem.then(applyCreatedResult).catch((error) => {
        console.warn('Failed to save reminder capture', error);
      });
    } else {
      applyCreatedResult(createdItemResolved);
    }
    if(title) title.value='';
    if(time) time.value='';
    if(details) details.value='';
    clearPlannerReminderContext();
    dispatchCueEvent('cue:close', { reason: 'created' });
  }

  title?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleSaveAction(); });

  const bindNativePickerTrigger = (buttonId, inputEl) => {
    const trigger = document.getElementById(buttonId);
    if (!(trigger instanceof HTMLElement) || !(inputEl instanceof HTMLInputElement)) {
      return;
    }
    trigger.addEventListener('click', () => {
      if (typeof inputEl.showPicker === 'function') {
        try {
          inputEl.showPicker();
          return;
        } catch (error) {
          console.warn('Native picker failed to open', error);
        }
      }
      inputEl.focus();
      inputEl.click();
    });
  };

  bindNativePickerTrigger('reminderDatePickerBtn', date);
  bindNativePickerTrigger('reminderTimePickerBtn', time);

  function updateDateFeedback(){ if(!title || !dateFeedback) return; const text = title.value.trim(); if(!text){ dateFeedback.style.display='none'; return; } try{ const parsed=parseQuickWhen(text); const today=todayISO(); if(parsed.date !== today || parsed.time){ let feedback=''; if(parsed.date !== today){ const dateObj = new Date(parsed.date+'T00:00:00'); feedback+=`📅 ${fmtDayDate(parsed.date)}`; } if(parsed.time){ feedback+=`${feedback ? ' ' : ''}🕐 ${parsed.time}`; } if(feedback){ dateFeedback.textContent=`Parsed: ${feedback}`; dateFeedback.style.display='block'; } else { dateFeedback.style.display='none'; } } else { dateFeedback.style.display='none'; } } catch { dateFeedback.style.display='none'; } }

  title?.addEventListener('input', debounce(updateDateFeedback,300));
  cancelEditBtn?.addEventListener('click', () => { resetForm(); toast('Edit cancelled'); dispatchCueEvent('cue:close', { reason: 'edit-cancelled' }); });
  detailClearBtn?.addEventListener('click', () => { resetForm(); });
  document.addEventListener('cue:cancelled', () => { resetForm(); });
  document.addEventListener('cue:prepare', (event) => {
    const requestedMode = event?.detail?.mode === 'edit' ? 'edit' : 'new';
    resetForm({ resetMode: false });
    setReminderMode(requestedMode, requestedMode === 'edit' ? currentReminderId : null);
  });
  document.addEventListener('cue:close', () => { setReminderMode(null); });
  document.addEventListener('planner:prefillReminder', (event) => {
    applyPlannerReminderPrefill(event?.detail || {});
  });
  window.addEventListener('load', ()=> title?.focus());
  copyMtlBtn?.addEventListener('click', () => {
    const lines = items.filter(x=>!x.done).map(x=>{ const datePart = x.due ? fmtDayDate(x.due.slice(0,10)) : ''; const timePart = x.due ? new Date(x.due).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit', timeZone: TZ}) : ''; const pieces = [ 'mtl '+x.title, x.due ? `Due Date: ${datePart}` : '', x.due ? `Time: ${timePart}` : '', `Status: Not started` ].filter(Boolean); return pieces.join('\n'); });
    if(lines.length===0){ toast('No active tasks to copy'); return; }
    navigator.clipboard.writeText(lines.join('\n\n')).then(()=>toast('Copied for Master Task List')).catch(()=>toast('Copy failed'));
    closeMenu();
  });

  exportBtn?.addEventListener('click', () => {
    const backup = buildBackupPayload();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-cue-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exported');
    closeMenu();
  });
  importBtn?.addEventListener('click', () => {
    if (!(importFile instanceof HTMLInputElement)) {
      return;
    }
    importFile.click();
    closeMenu();
  });
  importFile?.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result) || '{}');
        if (!window.confirm('Restore this backup on the current device? This will replace the current local copy.')) {
          importFile.value = '';
          return;
        }
        applyBackupPayload(parsed);
        toast('Backup restored');
      } catch (error) {
        console.warn('Backup restore failed', error);
        toast('Backup restore failed');
      } finally {
        importFile.value = '';
      }
    };
    reader.readAsText(file);
  });
  syncAllBtn?.addEventListener('click', async () => {
    const url=(localStorage.getItem('syncUrl')||'').trim();
    if(!url){ toast('Add your Apps Script URL in Settings first'); closeMenu(); return; }
    if(!items.length){ toast('No tasks to sync'); closeMenu(); return; }
    toast('Syncing all tasks…');
    const chunkSize=20; let fail=0;
    for(let i=0;i<items.length;i+=chunkSize){
      const chunk=items.slice(i,i+chunkSize);
      const results=await Promise.allSettled(chunk.map(task=>{ const payload={ id:task.id, title:task.title, dueIso:task.due||null, priority:task.priority||'Medium', category:task.category||DEFAULT_CATEGORY, done:!!task.done, source:'memory-cue-mobile' }; return fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }));
      fail += results.filter(r=>r.status==='rejected').length;
      await new Promise(res=>setTimeout(res,400));
    }
    toast(`Sync complete: ${items.length - fail} ok${fail ? `, ${fail} failed` : ''}`);
    closeMenu();
  });

  if(syncUrlInput){ syncUrlInput.value = localStorage.getItem('syncUrl') || ''; }
  saveSettings?.addEventListener('click', () => { if(!syncUrlInput) return; localStorage.setItem('syncUrl', syncUrlInput.value.trim()); toast('Settings saved'); });
  testSync?.addEventListener('click', async () => { if(!syncUrlInput) return; const url = syncUrlInput.value.trim(); if(!url){ toast('Enter URL first'); return; } try{ const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ test:true }) }); toast(res.ok ? 'Test ok' : 'Test failed'); } catch { toast('Test failed'); } });

  notifBtn?.addEventListener('click', async () => {
    if(!('Notification' in window)){ toast('Notifications not supported'); return; }
    if(Notification.permission === 'granted'){
      toast('Notifications enabled');
      if(supportsNotificationTriggers()) {
        ensureServiceWorkerRegistration();
      } else {
        setupBackgroundReminderSync();
        adviseInstallForBackground();
      }
      rescheduleAllReminders();
      render();
      return;
    }
    try {
      const granted = await ensureNotificationPermission();
      if(granted){
        toast('Notifications enabled');
        if(supportsNotificationTriggers()) {
          ensureServiceWorkerRegistration();
        } else {
          setupBackgroundReminderSync();
          adviseInstallForBackground();
        }
        rescheduleAllReminders();
        render();
      } else {
        toast('Notifications blocked');
      }
    } catch {
      toast('Notifications blocked');
    }
  });

  setupMobileReminderTabs();
  if (variant === 'mobile') {
    // Only request geolocation in response to a user gesture to avoid browser
    // 'Only request geolocation information in response to a user gesture' violations.
    const triggerTempOnce = () => {
      try {
        fetchAndUpdateMobileTemperature();
      } catch (e) {
        console.warn('fetchAndUpdateMobileTemperature failed', e);
      }
    };

    const addGestureListeners = () => {
      // Use once:true so listeners remove themselves after firing
      window.addEventListener('pointerdown', triggerTempOnce, { passive: true, once: true });
      window.addEventListener('touchstart', triggerTempOnce, { passive: true, once: true });
      window.addEventListener('click', triggerTempOnce, { passive: true, once: true });
    };

    if (typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function') {
      // If permission already granted, it's OK to call immediately; otherwise wait for a gesture
      try {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((perm) => {
            if (perm && perm.state === 'granted') {
              triggerTempOnce();
            } else {
              addGestureListeners();
            }
          })
          .catch(() => addGestureListeners());
      } catch (e) {
        addGestureListeners();
      }
    } else {
      addGestureListeners();
    }
  }
  setupDragAndDrop();
  rescheduleAllReminders();
  render();
  persistItems();

  if (variant === 'mobile') {
    // Filtering is now handled by the assistant; keep a no-op for legacy callers.
    window.setMobileRemindersFilter = () => false;
  }


  activeReminderControllerApi = {
    createReminderFromPayload,
    render,
    setupReminderFirestoreSync,
  };

  return {
    cancelReminder,
    scheduleReminder,
    closeActiveNotifications,
    getActiveNotifications: () => activeNotifications,
    addNoteToReminder,
    buildRagContext,
    askAssistant,
    __testing: {
      setItems(listItems = []) {
        items = normalizeReminderList(listItems);
        items = ensureOrderIndicesInitialized(items);
        sortItemsByOrder(items);
        render();
      },
      render,
      getItems: () => items.map(item => ({ ...item })),
      parseInboxTimeQuery,
      buildRagContext,
      askAssistant,
    },
  };
}


export function createReminderFromPayload(payload = {}, options = {}) {
  return activeReminderControllerApi?.createReminderFromPayload?.(payload, options);
}

export function render() {
  return activeReminderControllerApi?.render?.();
}

export async function setupReminderFirestoreSync() {
  return activeReminderControllerApi?.setupReminderFirestoreSync?.();
}


export function updateReminder(id, updates = {}, options = {}) {
  return reminderDataService.updateReminder(id, updates, options);
}

export function deleteReminder(id, options = {}) {
  return reminderDataService.deleteReminder(id, options);
}

export function completeReminder(id, completed = true, options = {}) {
  return reminderDataService.completeReminder(id, completed, options);
}

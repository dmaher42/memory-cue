import { initAuth, startSignInFlow, startSignOutFlow } from '../../js/auth.js';
import {
  saveReminder,
  removeReminder,
  saveReminderGroupColorRemote,
  subscribeReminderGroupColors,
  saveReminderBoardLabelRemote,
  subscribeReminderBoardLabels,
} from '../repositories/reminderRepository.js?v=20260904a';
import { syncNotes } from '../services/firestoreSyncService.js';
import { captureInput, getInboxEntries, saveInboxEntry } from '../../js/services/capture-service.js';
import { createReminder as createReminderViaService, setReminderCreationHandler, buildReminderPayload } from '../services/reminderService.js';
import { getFolders, loadAllNotes, saveAllNotes, saveFolders, setRemoteSyncHandler } from '../../js/modules/notes-storage.js';
import { createReminder as createStoredReminder, updateReminder as updateStoredReminder, deleteReminder as deleteStoredReminder, getReminders as getStoredReminders, setReminders as setStoredReminders, loadReminders } from './reminderStore.js';
import * as reminderDataService from './reminderService.js';
import { setupSyncHandlers, loadRemindersFromFirestore, saveReminderToFirestore, listenForReminderUpdates } from './reminderSync.js';
import { setupNotificationHandlers, startReminderScheduler, sendReminderNotification, requestNotificationPermission } from './reminderNotifications.js';
import { saveNote } from '../services/adapters/notePersistenceAdapter.js';
import { generateEmbedding } from '../brain/embeddingService.js';
import { buildRagAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';
import { replaceInboxEntries } from '../services/inboxService.js';
import { resolveShorthandText } from '../services/patternLearningService.js';
import { getMessages, replaceMessages } from '../chat/messageStore.js';
import { createReminderFirestoreSync } from './reminderFirestoreSync.js?v=20260904a';
import { createReminderFormHandlers } from './reminderFormHandlers.js';
import {
  registerReminderPushDevice,
  syncReminderToOtherDevices,
  unregisterReminderPushDevice,
} from './reminderPushSync.js?v=20260904a';
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
import {
  getUrgentReminderState,
  isUrgentTimedReminder,
} from './reminderUrgency.js';

// Shared reminder logic used by both the mobile and desktop pages.
// This module wires up Firebase-backed reminder UI handlers.

function compareRemindersForDisplay(a, b) {
  const isCompleted = (reminder) => {
    if (!reminder || typeof reminder !== 'object') {
      return false;
    }
    if (typeof reminder.done === 'boolean') {
      return reminder.done;
    }
    return Boolean(reminder.completed || reminder.isDone || reminder.status === 'done');
  };

  const readDueTime = (reminder) => {
    if (!reminder || typeof reminder !== 'object') {
      return Infinity;
    }
    if (Number.isFinite(reminder.dueAt)) {
      return Number(reminder.dueAt);
    }
    if (typeof reminder.due === 'string' && reminder.due.trim()) {
      const parsed = Date.parse(reminder.due);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return Infinity;
  };

  // Completed reminders go last.
  const aCompleted = isCompleted(a);
  const bCompleted = isCompleted(b);
  if (aCompleted && !bCompleted) return 1;
  if (!aCompleted && bCompleted) return -1;

  // Sort by due date with no-date reminders after dated reminders.
  const aTime = readDueTime(a);
  const bTime = readDueTime(b);

  return aTime - bTime;
}

const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const activeNotifications = new Map();
let notificationCleanupBound = false;
const REMINDER_PERIODIC_SYNC_TAG = 'memory-cue-reminder-sync';
const SERVICE_WORKER_MESSAGE_TYPES = Object.freeze({
  updateScheduledReminders: 'memoryCue:updateScheduledReminders',
  checkScheduledReminders: 'memoryCue:checkScheduledReminders',
  showUrgentReminder: 'memoryCue:showUrgentReminder',
  updateUrgentBadge: 'memoryCue:updateUrgentBadge',
  cancelScheduledReminder: 'memoryCue:cancelScheduledReminder',
  requestPendingUrgentActions: 'memoryCue:requestPendingUrgentActions',
  urgentActionCompleted: 'memoryCue:urgentActionCompleted',
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
  'School',
  'Footy',
  'Footy – Drills',
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
const REMINDER_BOARD_COLUMNS = Object.freeze([
  Object.freeze({ key: 'school', label: 'School', category: 'School' }),
  Object.freeze({ key: 'footy', label: 'Footy', category: 'Footy' }),
]);
const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';
const QUARANTINED_PENDING_REMINDERS_KEY = 'memoryCue:quarantinedPendingReminders';
const SCHEDULED_REMINDER_TOMBSTONES_KEY = 'memoryCue:scheduledReminderTombstones';
const PENDING_REMINDER_DELETIONS_KEY = 'memoryCue:pendingReminderDeletions';
const PENDING_REMOTE_GUARD_METADATA_KEY = '__memoryCuePendingRemoteGuard';
const LEGACY_DAILY_TASKS_STORAGE_KEY = 'dailyTasksByDate';
const ORDER_INDEX_GAP = 1024;
const BACKUP_VERSION = 2;
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

function supportsNotificationTriggers() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (typeof ServiceWorkerRegistration === 'undefined') return false;
  if (typeof ServiceWorkerRegistration.prototype?.showNotification !== 'function') return false;
  return !!getTimestampTriggerCtor();
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

async function syncScheduledRemindersWithServiceWorker(
  remindersPayload = [],
  { requestCheck = false, tombstones = [], activeOwnerUserId = '' } = {}
) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return;
  }
  const notificationTriggersSupported = supportsNotificationTriggers();
  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return;
    }
    const delivered = await postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.updateScheduledReminders,
      reminders: Array.isArray(remindersPayload) ? remindersPayload : [],
      tombstones: Array.isArray(tombstones) ? tombstones : [],
      activeOwnerUserId:
        typeof activeOwnerUserId === 'string' ? activeOwnerUserId.trim() : '',
      notificationTriggersSupported,
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
      notifications = await registration.getNotifications({ includeTriggered: true });
    } catch {
      notifications = await registration.getNotifications();
    }
    for (const notification of notifications) {
      const notificationReminderId = typeof notification?.data?.id === 'string'
        ? notification.data.id
        : '';
      const legacyTagMatches = notification?.tag === id;
      if (notificationReminderId !== id && !legacyTagMatches) {
        continue;
      }
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
      const seededMatch = SEEDED_CATEGORIES.find(
        (category) => category.toLowerCase() === trimmed.toLowerCase(),
      );
      return seededMatch || trimmed;
    }
  }
  return DEFAULT_CATEGORY;
}

function getReminderBoardColumnKey(categoryName) {
  const raw = typeof categoryName === 'string' ? categoryName.trim().toLowerCase() : '';
  if (raw.includes('school')) return 'school';
  if (raw.includes('footy') || raw.includes('football')) return 'footy';
  return 'other';
}

function getReminderBoardColumnDefinition(columnKey) {
  return REMINDER_BOARD_COLUMNS.find((column) => column.key === columnKey) || null;
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
    menu.className = 'quick-actions-menu reminder-card-actions-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Card actions for ${resolveReminderDisplayTitle(reminder)}`);

    const addAction = (label, dataAction, handler, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = dataAction;
      button.textContent = label;
      if (options.danger) {
        button.classList.add('reminder-card-action--danger');
      }
      if (options.disabled) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (button.disabled) {
          return;
        }
        handler();
        closeReminderQuickActionsMenu();
        if (options.renderAfter !== false) {
          render();
        }
      });
      menu.appendChild(button);
    };

    const currentColumnKey = getReminderBoardColumnKey(reminder.category);
    const currentColumnItems = getReminderBoardColumnItems(currentColumnKey, {
      completed: Boolean(reminder.done),
    });
    const currentIndex = currentColumnItems.findIndex((entry) => entry.id === reminder.id);

    addAction('Edit card', 'edit-card', () => {
      openEditReminderSheet(reminder);
    }, { renderAfter: false });

    const categoryName = normalizeCategory(reminder.category || DEFAULT_CATEGORY);
    const colorAction = document.createElement('label');
    colorAction.className = 'reminder-card-color-action';
    colorAction.dataset.action = 'change-category-colour';
    colorAction.setAttribute('role', 'none');
    const colorActionLabel = document.createElement('span');
    colorActionLabel.textContent = 'Category colour';
    const colorActionInput = document.createElement('input');
    colorActionInput.type = 'color';
    colorActionInput.value = getReminderGroupColor(categoryName);
    colorActionInput.setAttribute('aria-label', `Change ${categoryName} category colour`);
    colorActionInput.addEventListener('click', (event) => event.stopPropagation());
    colorActionInput.addEventListener('change', (event) => {
      event.stopPropagation();
      updateReminderGroupColor(categoryName, colorActionInput.value, categoryName);
      closeReminderQuickActionsMenu();
    });
    colorAction.append(colorActionLabel, colorActionInput);
    menu.appendChild(colorAction);

    REMINDER_BOARD_COLUMNS
      .filter((column) => column.key !== currentColumnKey)
      .forEach((column) => {
        addAction(`Move to ${getReminderBoardLabel(column)}`, `move-to-${column.key}`, () => {
          moveReminderToBoardColumn(reminder.id, column.key);
        }, { renderAfter: false });
      });

    addAction('Move card up', 'move-card-up', () => {
      moveReminderWithinBoardColumn(reminder.id, -1);
    }, { disabled: currentIndex <= 0, renderAfter: false });

    addAction('Move card down', 'move-card-down', () => {
      moveReminderWithinBoardColumn(reminder.id, 1);
    }, {
      disabled: currentIndex < 0 || currentIndex >= currentColumnItems.length - 1,
      renderAfter: false,
    });

    addAction('Delete card', 'delete-card', () => {
      removeItem(reminder.id);
    }, { danger: true, renderAfter: false });

    const divider = document.createElement('div');
    divider.className = 'reminder-card-actions-divider';
    divider.setAttribute('role', 'separator');
    menu.appendChild(divider);

    addAction('Duplicate card', 'reminder', () => {
      createReminderFromPayload({
        title: reminder.title,
        priority: reminder.priority || 'Medium',
        category: reminder.category || DEFAULT_CATEGORY,
        due: reminder.due || null,
        notifyAt: reminder.notifyAt || null,
        hasExplicitTime: reminder.hasExplicitTime === true,
        urgentAlert: reminder.hasExplicitTime === true && reminder.urgentAlert === true,
        notes: typeof reminder.notes === 'string' ? reminder.notes : '',
      }, { closeSheet: false, parseSchedule: false });
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
    message.textContent = state?.pendingRemote
      ? 'Reminder deleted here. Cloud deletion queued.'
      : 'Reminder deleted.';
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
  const openSettingsBtns = $$(sel.openSettingsSel);
  const settingsSection = $(sel.settingsSectionSel);
  const emptyStateEl = $(sel.emptyStateSel);
  const listWrapper = $(sel.listWrapperSel);
  const categoryDatalist = $(sel.categoryOptionsSel);
  const categoryChoiceButtons =
    typeof document !== 'undefined'
      ? Array.from(document.querySelectorAll('[data-category-choice]'))
      : [];
  const categoryOtherButton =
    typeof document !== 'undefined' ? document.getElementById('reminderCategoryOther') : null;
  const categoryCustomField =
    typeof document !== 'undefined' ? document.getElementById('reminderCustomCategoryField') : null;
  const reminderTitleError =
    typeof document !== 'undefined' ? document.getElementById('reminderTitleError') : null;
  const plannerContext = $(sel.plannerContextSel);
  const plannerLessonInput = $(sel.plannerLessonInputSel);
  const variant = sel.variant || 'mobile';
  const autoWireAuthButtons =
    typeof sel.autoWireAuthButtons === 'boolean' ? sel.autoWireAuthButtons : variant !== 'desktop';
  const completedRemindersMenuBtn =
    typeof document !== 'undefined' ? document.getElementById('completedRemindersMenuBtn') : null;
  const completedRemindersMenuCount =
    typeof document !== 'undefined' ? document.getElementById('completedRemindersMenuCount') : null;
  const appHeader =
    typeof document !== 'undefined' ? document.getElementById('reminders-slim-header') : null;
  const appHeaderTitle = appHeader?.querySelector('.header-title');
  const remindersHeaderActions =
    typeof document !== 'undefined' ? document.getElementById('remindersHeaderActions') : null;
  const remindersHeaderToggle =
    typeof document !== 'undefined' ? document.getElementById('remindersHeaderToggle') : null;
  const remindersHeaderToggleLabel =
    typeof document !== 'undefined' ? document.getElementById('remindersHeaderToggleLabel') : null;
  const remindersHeaderToggleCount =
    typeof document !== 'undefined' ? document.getElementById('remindersHeaderToggleCount') : null;
  if (appHeaderTitle instanceof HTMLElement && !appHeaderTitle.dataset.defaultTitle) {
    appHeaderTitle.dataset.defaultTitle = appHeaderTitle.textContent?.trim() || 'Memory Cue';
  }

  // Mobile reminders filter state and cache
  let mobileRemindersCache = [];
  let mobileRemindersTemperatureLabel = '';
  const REMINDER_SORT_OPTIONS = Object.freeze({
    created: 'created',
    timeRelevance: 'time-relevance',
  });
  let reminderSortMode = REMINDER_SORT_OPTIONS.created;
  let completedReminderSectionExpanded = false;

  function ensureReminderHeaderToggle() {
    if (variant !== 'mobile' || !(remindersHeaderToggle instanceof HTMLElement)) {
      return null;
    }

    if (remindersHeaderToggle.dataset.reminderViewWired !== 'true') {
      remindersHeaderToggle.dataset.reminderViewWired = 'true';
      remindersHeaderToggle.addEventListener('click', () => {
        if (remindersHeaderToggle.dataset.remindersFilter === 'completed') {
          showCompletedReminders({ focusList: false });
        } else {
          showActiveReminders();
        }
      });
    }
    return remindersHeaderToggle;
  }

  function syncReminderHeader(activeCount = 0, completedCount = 0) {
    const viewToggle = ensureReminderHeaderToggle();
    if (!(viewToggle instanceof HTMLElement)) {
      return;
    }

    const remindersViewIsActive = document.body?.dataset.activeView === 'reminders';
    if (remindersHeaderActions instanceof HTMLElement) {
      remindersHeaderActions.hidden = !remindersViewIsActive;
      remindersHeaderActions.setAttribute('aria-hidden', remindersViewIsActive ? 'false' : 'true');
    }
    if (!remindersViewIsActive) {
      return;
    }

    const showingCompleted = completedReminderSectionExpanded;
    const normalizedActiveCount = Math.max(0, Number(activeCount) || 0);
    const normalizedCompletedCount = Math.max(0, Number(completedCount) || 0);
    const nextFilter = showingCompleted ? 'active' : 'completed';
    const nextLabel = showingCompleted ? 'Back' : 'Done';

    if (appHeaderTitle instanceof HTMLElement) {
      appHeaderTitle.textContent = showingCompleted ? 'Done reminders' : 'Reminders';
    }
    viewToggle.dataset.remindersFilter = nextFilter;
    viewToggle.setAttribute(
      'aria-label',
      showingCompleted
        ? `Back to ${normalizedActiveCount} active ${normalizedActiveCount === 1 ? 'reminder' : 'reminders'}`
        : `View ${normalizedCompletedCount} done ${normalizedCompletedCount === 1 ? 'reminder' : 'reminders'}`,
    );
    if (remindersHeaderToggleLabel instanceof HTMLElement) {
      remindersHeaderToggleLabel.textContent = nextLabel;
    }
    if (remindersHeaderToggleCount instanceof HTMLElement) {
      remindersHeaderToggleCount.textContent = String(normalizedCompletedCount);
      remindersHeaderToggleCount.hidden = showingCompleted;
    }
  }

  function syncReminderHeaderFromItems() {
    const activeCount = Array.isArray(items)
      ? items.filter((item) => item?.done !== true).length
      : 0;
    const completedCount = Array.isArray(items)
      ? items.filter((item) => item?.done === true).length
      : 0;
    syncReminderHeader(activeCount, completedCount);
  }

  if (variant === 'mobile' && typeof window !== 'undefined') {
    window.addEventListener('memorycue:navigation:changed', () => {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(syncReminderHeaderFromItems);
      } else {
        window.setTimeout(syncReminderHeaderFromItems, 0);
      }
    });
  }

  function syncCompletedRemindersMenu(count = 0) {
    const completedCount = Math.max(0, Number(count) || 0);
    const shouldHide = completedCount === 0;

    if (completedRemindersMenuCount instanceof HTMLElement) {
      completedRemindersMenuCount.textContent = String(completedCount);
    }
    if (completedRemindersMenuBtn instanceof HTMLElement) {
      completedRemindersMenuBtn.hidden = shouldHide;
      completedRemindersMenuBtn.classList.toggle('hidden', shouldHide);
      completedRemindersMenuBtn.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
      completedRemindersMenuBtn.setAttribute(
        'aria-label',
        `View ${completedCount} completed ${completedCount === 1 ? 'reminder' : 'reminders'}`,
      );
    }
  }

  function showCompletedReminders({ focusList = true } = {}) {
    completedReminderSectionExpanded = true;
    render();

    if (!focusList) {
      return true;
    }

    const focusCompletedSection = () => {
      const target = document.querySelector('.reminder-completed-section-toggle')
        || document.querySelector('[data-reminders-filter="completed"]');
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusCompletedSection);
    } else {
      focusCompletedSection();
    }
    return true;
  }

  function showActiveReminders() {
    completedReminderSectionExpanded = false;
    render();
    return true;
  }

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

  function syncCategoryChoiceState(value = categoryInput?.value) {
    const activeCategory = normalizeCategory(value).toLowerCase();
    let matchesBoardColumn = false;
    categoryChoiceButtons.forEach((button) => {
      const buttonCategory = normalizeCategory(button.dataset?.categoryChoice).toLowerCase();
      const isActive = buttonCategory === activeCategory;
      matchesBoardColumn = matchesBoardColumn || isActive;
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      const boardKey = button.dataset?.boardLabelKey;
      if (boardKey) {
        const displayLabel = getReminderBoardLabel(boardKey);
        if (displayLabel) {
          button.textContent = displayLabel;
          button.setAttribute('aria-label', `Save to ${displayLabel}`);
        }
      }
    });

    if (categoryOtherButton instanceof HTMLElement) {
      categoryOtherButton.setAttribute('aria-pressed', matchesBoardColumn ? 'false' : 'true');
    }
    if (categoryCustomField instanceof HTMLElement) {
      categoryCustomField.classList.toggle('hidden', matchesBoardColumn);
    }

    if (saveBtn instanceof HTMLElement) {
      const sheetMode = typeof document !== 'undefined'
        ? document.getElementById('create-sheet')?.dataset?.mode
        : '';
      if (sheetMode === 'edit') {
        saveBtn.textContent = 'Save changes';
      } else {
        const activeButton = categoryChoiceButtons.find(
          (button) => button.getAttribute('aria-pressed') === 'true',
        );
        const displayLabel = activeButton?.textContent?.trim();
        saveBtn.textContent = displayLabel ? `Add to ${displayLabel}` : 'Add reminder';
      }
    }
  }

  function setReminderTitleError(message = '') {
    const nextMessage = typeof message === 'string' ? message.trim() : '';
    if (reminderTitleError instanceof HTMLElement) {
      reminderTitleError.textContent = nextMessage || 'Enter a reminder title.';
      reminderTitleError.classList.toggle('hidden', !nextMessage);
    }
    if (title instanceof HTMLElement) {
      if (nextMessage) {
        title.setAttribute('aria-invalid', 'true');
      } else {
        title.removeAttribute('aria-invalid');
      }
    }
  }

  function updateDefaultsFrom(entry) {
    const prev = loadLastDefaults();
    const next = {
      category: normalizeCategory(entry?.category || prev.category || DEFAULT_CATEGORY),
      priority: entry?.priority || prev.priority || 'Medium',
      // repeat: entry?.repeat || prev.repeat || null,
    };
    saveLastDefaults(next);
    syncCategoryChoiceState(next.category);
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
    const categoryValue = normalizeCategory(d.category || categoryInput?.value || DEFAULT_CATEGORY);
    if (categoryInput) categoryInput.value = categoryValue;
    syncCategoryChoiceState(categoryValue);
    if (d.priority) setPriorityInputValue(d.priority);
  }

  categoryChoiceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!categoryInput) {
        return;
      }
      categoryInput.value = normalizeCategory(button.dataset?.categoryChoice);
      syncCategoryChoiceState(categoryInput.value);
      categoryInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  categoryOtherButton?.addEventListener('click', () => {
    if (!categoryInput) {
      return;
    }
    const currentCategory = normalizeCategory(categoryInput.value).toLowerCase();
    const isBoardCategory = categoryChoiceButtons.some(
      (button) => normalizeCategory(button.dataset?.categoryChoice).toLowerCase() === currentCategory,
    );
    if (isBoardCategory) {
      categoryInput.value = DEFAULT_CATEGORY;
    }
    syncCategoryChoiceState(categoryInput.value);
    categoryInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof categoryInput.focus === 'function') {
      categoryInput.focus();
      categoryInput.select?.();
    }
  });

  categoryInput?.addEventListener('input', () => syncCategoryChoiceState(categoryInput.value));
  categoryInput?.addEventListener('change', () => syncCategoryChoiceState(categoryInput.value));

  applyStoredDefaultsToInputs();
  let isQuickAddSubmitting = false;
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
    if (/^\s*!\s*/.test(text)) {
      return {
        kind: 'default',
        text: text.replace(/^\s*!\s*/, '').trim(),
      };
    }
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
      if (document.activeElement !== inboxSearchInput) {
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
      if (document.activeElement !== inboxSearchInput) {
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
    if (isQuickAddSubmitting) {
      return null;
    }
    const text =
      typeof options.forceText === 'string'
        ? options.forceText
        : typeof options.text === 'string'
          ? options.text
          : '';
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return null;

    const quickAddSource = typeof options?.source === 'string' && options.source.trim()
      ? options.source.trim()
      : 'quick-add';

    isQuickAddSubmitting = true;

    let entry = null;

    try {
      const routed = parseQuickAddPrefixRoute(t);
      const routedText = resolveShorthandText(routed.text || t);
      const inferredSchedule = parseReminderScheduleFromText(routedText);
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

        const hasExplicitTime = Boolean(basePayload.dueAt && (
          typeof options?.hasExplicitTime === 'boolean'
            ? options.hasExplicitTime
            : inferredSchedule.hasExplicitTime === true
        ));
        basePayload.hasExplicitTime = hasExplicitTime;
        basePayload.urgentAlert = hasExplicitTime && (
          typeof options?.urgentAlert === 'boolean' ? options.urgentAlert : true
        );

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
        try {
          document.dispatchEvent(
            new CustomEvent('reminder:quick-add:complete', { detail: { entry } }),
          );
        } catch {
          // Ignore dispatch issues so the add flow can finish silently.
        }
      }
    } finally {
      isQuickAddSubmitting = false;
    }

    return entry || null;
  }

  if (typeof window !== 'undefined') {
    window.memoryCueQuickAddNow = quickAddNow;
  }

  setupInboxSearch();

  const REMINDER_MONTH_NAME_TO_INDEX = Object.freeze({
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  });
  const REMINDER_WEEKDAY_NAME_PATTERN = '(?:monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)';
  const REMINDER_MONTH_NAME_PATTERN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const REMINDER_DAY_MONTH_DATE_PATTERN = new RegExp(
    `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${REMINDER_MONTH_NAME_PATTERN})(?:\\s+(\\d{4}))?\\b`,
    'i',
  );
  const REMINDER_MONTH_DAY_DATE_PATTERN = new RegExp(
    `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(${REMINDER_MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`,
    'i',
  );
  const REMINDER_DAY_MONTH_DATE_STRIP_PATTERN = new RegExp(
    `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(?:\\d{1,2})(?:st|nd|rd|th)?\\s+${REMINDER_MONTH_NAME_PATTERN}(?:\\s+\\d{4})?\\b`,
    'gi',
  );
  const REMINDER_MONTH_DAY_DATE_STRIP_PATTERN = new RegExp(
    `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?${REMINDER_MONTH_NAME_PATTERN}\\s+(?:\\d{1,2})(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b`,
    'gi',
  );
  const REMINDER_TIME_RANGE_PATTERN = /\b(?:at\s*)?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(?:at\s*)?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i;
  const REMINDER_TIME_RANGE_STRIP_PATTERN = /\b(?:at\s*)?\d{1,2}(?::?\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*(?:at\s*)?\d{1,2}(?::?\d{2})?\s*(?:am|pm)?\b/gi;

  function stripExplicitReminderDateText(text) {
    return String(text || '')
      .replace(REMINDER_DAY_MONTH_DATE_STRIP_PATTERN, ' ')
      .replace(REMINDER_MONTH_DAY_DATE_STRIP_PATTERN, ' ');
  }

  function parseReminderTimeRangeFromText(rawText) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return null;
    }

    const match = text.match(REMINDER_TIME_RANGE_PATTERN);
    if (!match) {
      return null;
    }

    let startHours = Number.parseInt(match[1], 10);
    const startMinutes = match[2] ? Number.parseInt(match[2], 10) : 0;
    const startMeridiem = typeof match[3] === 'string' ? match[3].toLowerCase() : '';
    let endHours = Number.parseInt(match[4], 10);
    const endMinutes = match[5] ? Number.parseInt(match[5], 10) : 0;
    const endMeridiem = typeof match[6] === 'string' ? match[6].toLowerCase() : '';

    if (!Number.isFinite(startHours) || !Number.isFinite(startMinutes) || !Number.isFinite(endHours) || !Number.isFinite(endMinutes)) {
      return null;
    }

    let inferredMeridiem = startMeridiem || endMeridiem || '';
    if (!inferredMeridiem && startHours <= 6 && endHours <= 6) {
      inferredMeridiem = 'pm';
    }

    if (inferredMeridiem === 'pm') {
      if (!startMeridiem && startHours < 12) {
        startHours += 12;
      }
      if (!endMeridiem && endHours < 12) {
        endHours += 12;
      }
    } else if (inferredMeridiem === 'am') {
      if (!startMeridiem && startHours === 12) {
        startHours = 0;
      }
      if (!endMeridiem && endHours === 12) {
        endHours = 0;
      }
    }

    const startLabel = formatDisplayTimeLabel(startHours, startMinutes, inferredMeridiem);
    const endLabel = formatDisplayTimeLabel(endHours, endMinutes, inferredMeridiem);

    return {
      start: { hours: startHours, minutes: startMinutes },
      end: { hours: endHours, minutes: endMinutes },
      label: startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel || endLabel || '',
      text: match[0],
    };
  }

  function parseExplicitReminderDate(rawText, now) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return null;
    }

    const buildCandidate = (year, monthIndex, day, timeParts) => {
      if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
        return null;
      }

      const candidate = new Date(now.getTime());
      candidate.setFullYear(year, monthIndex, day);
      candidate.setHours(0, 0, 0, 0);

      if (
        candidate.getFullYear() !== year
        || candidate.getMonth() !== monthIndex
        || candidate.getDate() !== day
      ) {
        return null;
      }

      const resolvedTime = timeParts || { hours: 9, minutes: 0 };
      let resolvedHours = resolvedTime.hours;
      const meridiem = typeof resolvedTime.meridiem === 'string'
        ? resolvedTime.meridiem.toLowerCase()
        : '';
      if (meridiem === 'pm' && resolvedHours < 12) {
        resolvedHours += 12;
      } else if (meridiem === 'am' && resolvedHours === 12) {
        resolvedHours = 0;
      }
      candidate.setHours(resolvedHours, resolvedTime.minutes, 0, 0);
      return candidate;
    };

    const dayMonthMatch = text.match(REMINDER_DAY_MONTH_DATE_PATTERN);
    if (dayMonthMatch) {
      const monthIndex = REMINDER_MONTH_NAME_TO_INDEX[dayMonthMatch[2].toLowerCase()];
      const day = Number.parseInt(dayMonthMatch[1], 10);
      const year = dayMonthMatch[3] ? Number.parseInt(dayMonthMatch[3], 10) : now.getFullYear();
      const timeParts = parseTimePartsFromReminderText(text.replace(dayMonthMatch[0], ' '));
      const candidate = buildCandidate(year, monthIndex, day, timeParts);
      if (candidate) {
        return candidate;
      }
    }

    const monthDayMatch = text.match(REMINDER_MONTH_DAY_DATE_PATTERN);
    if (monthDayMatch) {
      const monthIndex = REMINDER_MONTH_NAME_TO_INDEX[monthDayMatch[1].toLowerCase()];
      const day = Number.parseInt(monthDayMatch[2], 10);
      const year = monthDayMatch[3] ? Number.parseInt(monthDayMatch[3], 10) : now.getFullYear();
      const timeParts = parseTimePartsFromReminderText(text.replace(monthDayMatch[0], ' '));
      const candidate = buildCandidate(year, monthIndex, day, timeParts);
      if (candidate) {
        return candidate;
      }
    }

    return null;
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

    const compactTimeMatch = text.match(/\b(?:at\s*)?(\d{3,4})\b/);
    if (compactTimeMatch) {
      const digits = compactTimeMatch[1];
      const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
      const minuteDigits = digits.length === 3 ? digits.slice(1) : digits.slice(2);
      const hours = Number.parseInt(hourDigits, 10);
      const minutes = Number.parseInt(minuteDigits, 10);
      if (Number.isFinite(hours) && Number.isFinite(minutes) && hours <= 23 && minutes < 60) {
        return {
          hours,
          minutes,
          meridiem: '',
        };
      }
    }

    return null;
  }

  function parseReminderScheduleFromText(rawText, nowOverride = null) {
    const result = {
      dueDate: null,
      notifyAt: null,
      cleanedText: '',
      hasExplicitTime: false,
    };
    if (!rawText) {
      return result;
    }

    const sourceText = typeof rawText === 'string' ? rawText.trim() : '';
    const text = sourceText.toLowerCase();
    const now = nowOverride instanceof Date && !Number.isNaN(nowOverride.getTime())
      ? new Date(nowOverride)
      : new Date();
    const target = new Date(now);
    const timeRange = parseReminderTimeRangeFromText(sourceText);
    const explicitDateMatchForTime = sourceText.match(REMINDER_DAY_MONTH_DATE_PATTERN)
      || sourceText.match(REMINDER_MONTH_DAY_DATE_PATTERN);
    const timeParts = parseTimePartsFromReminderText(
      explicitDateMatchForTime
        ? sourceText.replace(explicitDateMatchForTime[0], ' ')
        : sourceText,
    );
    const displayParts = extractReminderInlineSchedule(sourceText);
    const weekdayMatch = text.match(/\b(?:(next)\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
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
    const resolveRelativeDayOffset = () => {
      if (text.includes('tomorrow')) {
        return 1;
      }
      if (text.includes('today') || text.includes('tonight')) {
        return 0;
      }
      if (!weekdayMatch) {
        return null;
      }
      const targetDay = weekdayOrder[(weekdayMatch[2] || '').toLowerCase()];
      if (!Number.isFinite(targetDay)) {
        return null;
      }
      let dayOffset = (targetDay - target.getDay() + 7) % 7;
      if (dayOffset === 0 && weekdayMatch[1]) {
        dayOffset = 7;
      }
      return dayOffset;
    };
    const relativeDayOffset = resolveRelativeDayOffset();

    result.cleanedText = displayParts.textWithoutSchedule || stripReminderPromptPrefix(sourceText) || sourceText;

    const explicitDate = parseExplicitReminderDate(sourceText, now);
    if (explicitDate) {
      const explicitDateMatch = sourceText.match(REMINDER_DAY_MONTH_DATE_PATTERN)
        || sourceText.match(REMINDER_MONTH_DAY_DATE_PATTERN);
      const textWithoutDate = explicitDateMatch
        ? sourceText.replace(explicitDateMatch[0], ' ')
        : sourceText;
      result.dueDate = explicitDate;
      result.notifyAt = new Date(explicitDate.getTime() - 15 * 60 * 1000);
      result.hasExplicitTime = Boolean(
        timeRange || parseTimePartsFromReminderText(textWithoutDate)
      );
      return result;
    }

    if (timeRange) {
      const candidate = new Date(target);
      if (Number.isFinite(relativeDayOffset)) {
        candidate.setDate(candidate.getDate() + relativeDayOffset);
      }
      candidate.setHours(timeRange.start.hours, timeRange.start.minutes, 0, 0);
      if (candidate.getTime() <= now.getTime()) {
        candidate.setDate(candidate.getDate() + (weekdayMatch ? 7 : 1));
      }
      result.dueDate = candidate;
      result.notifyAt = new Date(candidate.getTime() - 15 * 60 * 1000);
      result.hasExplicitTime = true;
      return result;
    }

    if (!timeParts) {
      return result;
    }

      if (Number.isFinite(relativeDayOffset)) {
        target.setDate(target.getDate() + relativeDayOffset);
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
    result.notifyAt = new Date(dueDate.getTime() - 15 * 60 * 1000);
    result.hasExplicitTime = true;
    return result;
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
  let authSessionResolved = false;
  let remindersHydratedUserId = null;
  let reminderReconciliationPending = false;
  let reminderSyncGeneration = 0;
  let reminderHydrationRetry = null;
  let reminderReconciliationRetryTimer = null;
  let cachedOutOfScopeReminderItems = [];
  let legacyDailyTasksMigrationRan = false;
  const reminderSaveQueues = new Map();
  const latestReminderSavePromises = new Map();
  let pushUnregisteredBeforeSignOutUserId = null;
  const emitNotificationPermissionState = (phonePushStatus = 'unavailable') => {
    const normalizedPhonePushStatus = phonePushStatus === 'connected'
      ? 'connected'
      : 'unavailable';
    const permission = typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported';
    if (typeof window !== 'undefined') {
      window.__MEMORY_CUE_PHONE_PUSH_STATUS = normalizedPhonePushStatus;
    }
    dispatchCueEvent('reminder:notification-permission-changed', {
      permission,
      phonePushStatus: normalizedPhonePushStatus,
    });
  };
  let notesMigrationComplete = false;
  let notesMigrationUserId = null;
  let lastSyncedNoteIds = new Set();
  const pendingDeletionItems = new Map();
  let unsubscribe = null;
  // Group-colour state is declared here, above the authentication wiring
  // further down: when a signed-in session is persisted, Firebase fires
  // onSessionChange synchronously during init (which renders and starts the
  // group-colour sync). Declaring these any later leaves them in the temporal
  // dead zone at that moment, throwing "Cannot access ... before
  // initialization" and leaving the reminders list blank.
  const REMINDER_GROUP_COLORS_KEY = 'memoryCue:reminderGroupColors';
  const REMINDER_BOARD_LABELS_KEY = 'memoryCue:reminderBoardLabels';
  const REMINDER_BOARD_LABEL_MAX_LENGTH = 32;
  const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  let groupColorUnsub = null;
  let groupColorInitialSyncDone = false;
  let boardLabelUnsub = null;
  let boardLabelInitialSyncDone = false;
  const reminderFirestoreSync = createReminderFirestoreSync({
    normalizeReminderRecord,
    normalizeReminderList,
    ensureOrderIndicesInitialized,
    isCurrentUser: (expectedUserId) => userId === expectedUserId,
    loadReminders,
    loadQuarantinedPendingReminders,
    quarantinePendingReminders,
    clearQuarantinedPendingReminders,
    loadPendingReminderDeletions,
    clearPendingReminderDeletions,
    retryPendingReminderDeletion,
    saveToFirebase: (...args) => saveToFirebase(...args),
    onPendingWork: () => markReminderReconciliationPending(),
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
    getPendingDeletionItems: () => pendingDeletionItems,
    render,
    updateMobileRemindersHeaderSubtitle,
    persistItems,
    rescheduleAllReminders,
    renderSyncIndicator,
  });
  let editingId = null;
  let currentReminderMode = null;
  let currentReminderId = null;
  const reminderTimers = {};
  const reminderNotifyTimers = {};
  // setTimeout uses a signed 32-bit delay; anything larger overflows and fires almost
  // immediately. Cap at the max and re-arm in chunks for far-future reminders.
  const MAX_TIMEOUT_DELAY = 2147483647; // ~24.8 days
  function setLongTimeout(timerMap, key, delay, callback){
    const remaining = Math.max(0, delay);
    if(remaining <= MAX_TIMEOUT_DELAY){
      timerMap[key] = setTimeout(callback, remaining);
      return;
    }
    // Store the live handle each chunk so clearTimeout(timerMap[key]) still cancels it.
    timerMap[key] = setTimeout(() => {
      setLongTimeout(timerMap, key, remaining - MAX_TIMEOUT_DELAY, callback);
    }, MAX_TIMEOUT_DELAY);
  }
  let scheduledReminders = {};
  const scheduledReminderTombstones = new Map();
  const URGENT_ATTENTION_TICK_MS = 5000;
  const URGENT_TITLE_PREFIX = /^\ud83d\udd34\s+\d+\s+urgent(?:\s+appointments?)?(?:\s+\u2022\s+ALERT)?\s+\u2014\s+/u;
  const urgentPresentedStages = new Set();
  const urgentPresentationsPending = new Set();
  const urgentBackgroundStages = new Set();
  const urgentActionInFlight = new Map();
  const urgentActionUrlInFlight = new Map();
  const processedUrgentActionKeys = new Set();
  const PROCESSED_URGENT_ACTIONS_STORAGE_KEY = 'memoryCue:processedUrgentActions';
  const PROCESSED_URGENT_ACTIONS_LIMIT = 64;
  let urgentAttentionTimer = null;
  let urgentAttentionSurface = null;
  let urgentBaseDocumentTitle = '';
  let lastUrgentBadgeCount = null;
  let lastUrgentBridgeSignature = '';

  try {
    const storedActionKeys = JSON.parse(
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROCESSED_URGENT_ACTIONS_STORAGE_KEY) || '[]'
        : '[]'
    );
    if (Array.isArray(storedActionKeys)) {
      storedActionKeys
        .filter((value) => typeof value === 'string' && value)
        .slice(-PROCESSED_URGENT_ACTIONS_LIMIT)
        .forEach((value) => processedUrgentActionKeys.add(value));
    }
  } catch {
    // The in-memory cache still prevents duplicate handling for this page session.
  }

  function normalizeUrgentActionTimestamp(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
      return null;
    }
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function getUrgentActionKey(action, reminderId, stageKey = '', options = {}) {
    const actionId = typeof options.actionId === 'string' ? options.actionId.trim() : '';
    if (actionId) {
      return `id:${actionId}`;
    }
    const actionCreatedAt = normalizeUrgentActionTimestamp(options.actionCreatedAt);
    if (actionCreatedAt === null) {
      return '';
    }
    return `legacy:${reminderId}:${action}:${stageKey}:${actionCreatedAt}`;
  }

  function rememberProcessedUrgentAction(actionKey) {
    if (!actionKey) {
      return;
    }
    processedUrgentActionKeys.delete(actionKey);
    processedUrgentActionKeys.add(actionKey);
    while (processedUrgentActionKeys.size > PROCESSED_URGENT_ACTIONS_LIMIT) {
      const oldestKey = processedUrgentActionKeys.values().next().value;
      processedUrgentActionKeys.delete(oldestKey);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          PROCESSED_URGENT_ACTIONS_STORAGE_KEY,
          JSON.stringify(Array.from(processedUrgentActionKeys))
        );
      }
    } catch {
      // The service worker will replay again if persistence is unavailable.
    }
  }

  function requestPendingUrgentActions() {
    if (!authSessionResolved) {
      return Promise.resolve(false);
    }
    return postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.requestPendingUrgentActions,
      ownerUserId: userId || '',
    });
  }

  function acknowledgeCompletedUrgentAction(actionId, actionOwnerUserId = userId || '') {
    if (!actionId) {
      return Promise.resolve(false);
    }
    return postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.urgentActionCompleted,
      actionId,
      ownerUserId: typeof actionOwnerUserId === 'string' ? actionOwnerUserId.trim() : '',
    });
  }

  function getUrgentEntrySignature(entry) {
    const reminderId = entry?.reminderId || entry?.reminder?.id || '';
    const stageKey = entry?.stage?.key || '';
    const dueAt = Number.isFinite(entry?.stage?.dueAt) ? entry.stage.dueAt : '';
    const reminderUpdatedAt = normalizeUrgentActionTimestamp(entry?.reminder?.updatedAt) ?? '';
    return `${reminderId}:${stageKey}:${dueAt}:${reminderUpdatedAt}`;
  }

  function formatUrgentDueTime(reminder) {
    const dueValue = reminder?.due || reminder?.dueAt;
    const due = dueValue ? new Date(dueValue) : null;
    if (!due || Number.isNaN(due.getTime())) {
      return '';
    }
    return due.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: TZ,
    });
  }

  function getUrgentMeetingLink(reminder) {
    const text = [reminder?.notes, reminder?.body, reminder?.title]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ');
    const match = text.match(/https?:\/\/[^\s<>()]+/i);
    return match ? match[0].replace(/[.,;!?]+$/, '') : '';
  }

  function ensureUrgentAttentionSurface() {
    if (urgentAttentionSurface instanceof HTMLElement || typeof document === 'undefined' || !document.body) {
      return urgentAttentionSurface;
    }

    const surface = document.createElement('aside');
    surface.id = 'urgentAppointmentAlert';
    surface.className = 'urgent-appointment-alert';
    surface.hidden = true;
    surface.setAttribute('aria-live', 'assertive');
    surface.setAttribute('aria-atomic', 'true');
    surface.innerHTML = `
      <section class="urgent-appointment-alert__card" role="alertdialog" aria-modal="false" aria-labelledby="urgentAppointmentTitle" aria-describedby="urgentAppointmentStatus">
        <div class="urgent-appointment-alert__topline">
          <span class="urgent-appointment-alert__eyebrow">Urgent appointment</span>
          <span class="urgent-appointment-alert__count" data-urgent-count></span>
        </div>
        <h2 id="urgentAppointmentTitle" class="urgent-appointment-alert__title" data-urgent-title></h2>
        <p id="urgentAppointmentStatus" class="urgent-appointment-alert__status" data-urgent-status></p>
        <p class="urgent-appointment-alert__hint">This stays visible until you choose what to do.</p>
        <div class="urgent-appointment-alert__actions">
          <button type="button" class="urgent-appointment-alert__button urgent-appointment-alert__button--seen" data-urgent-action="acknowledge">I've seen this</button>
          <button type="button" class="urgent-appointment-alert__button" data-urgent-action="snooze5">Snooze 5 min</button>
          <button type="button" class="urgent-appointment-alert__button" data-urgent-action="start">Start / join</button>
          <button type="button" class="urgent-appointment-alert__button urgent-appointment-alert__button--done" data-urgent-action="done">Done</button>
        </div>
      </section>`;

    surface.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-urgent-action]')
        : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const reminderId = surface.dataset.reminderId || '';
      const stageKey = surface.dataset.stageKey || '';
      void handleUrgentAction(button.dataset.urgentAction || '', reminderId, stageKey);
    });

    document.body.appendChild(surface);
    urgentAttentionSurface = surface;
    return surface;
  }

  function hideUrgentAttentionSurface() {
    const surface = ensureUrgentAttentionSurface();
    if (surface) {
      surface.hidden = true;
      surface.removeAttribute('data-reminder-id');
      surface.removeAttribute('data-stage-key');
    }
  }

  function renderUrgentAttentionSurface(entry, badgeCount) {
    const surface = ensureUrgentAttentionSurface();
    const reminder = entry?.reminder;
    if (!surface || !reminder) {
      return;
    }
    const dueLabel = formatUrgentDueTime(reminder);
    const statusParts = [entry?.stage?.label || 'Due soon'];
    if (dueLabel) {
      statusParts.push(`Scheduled for ${dueLabel}`);
    }
    const titleElement = surface.querySelector('[data-urgent-title]');
    const statusElement = surface.querySelector('[data-urgent-status]');
    const countElement = surface.querySelector('[data-urgent-count]');
    if (titleElement) titleElement.textContent = reminder.title || 'Appointment';
    if (statusElement) statusElement.textContent = statusParts.join(' \u2022 ');
    if (countElement) {
      countElement.textContent = badgeCount > 1 ? `${badgeCount} need attention` : 'Needs attention';
    }
    surface.dataset.reminderId = reminder.id || '';
    surface.dataset.stageKey = entry?.stage?.key || '';
    surface.hidden = false;
  }

  function updateUrgentDocumentTitle(state) {
    if (typeof document === 'undefined') {
      return;
    }
    const currentTitle = document.title || 'Memory Cue';
    if (!URGENT_TITLE_PREFIX.test(currentTitle)) {
      urgentBaseDocumentTitle = currentTitle;
    }
    if (!urgentBaseDocumentTitle) {
      urgentBaseDocumentTitle = currentTitle.replace(URGENT_TITLE_PREFIX, '') || 'Memory Cue';
    }
    if (!state.badgeCount) {
      document.title = urgentBaseDocumentTitle;
      return;
    }
    const noun = state.badgeCount === 1 ? 'urgent appointment' : 'urgent appointments';
    const alertMarker = state.alertItems.length ? ' \u2022 ALERT' : '';
    document.title = `\ud83d\udd34 ${state.badgeCount} ${noun}${alertMarker} \u2014 ${urgentBaseDocumentTitle}`;
  }

  function emitWindowsAttention(action, state, stage = null) {
    if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
      return;
    }
    const count = Math.max(0, Number(state?.badgeCount) || 0);
    const signature = `${action}:${count}:${stage?.key || ''}`;
    if (signature === lastUrgentBridgeSignature) {
      return;
    }
    lastUrgentBridgeSignature = signature;
    window.postMessage({
      source: 'memory-cue',
      type: 'memoryCue:windowsAttention',
      action,
      count,
      stage: stage?.key || undefined,
    }, window.location.origin);
  }

  function updateInstalledAppBadge(count) {
    const nextCount = Math.max(0, Number(count) || 0);
    if (nextCount === lastUrgentBadgeCount) {
      return;
    }
    lastUrgentBadgeCount = nextCount;
    if (typeof navigator !== 'undefined') {
      try {
        const result = nextCount > 0 && typeof navigator.setAppBadge === 'function'
          ? navigator.setAppBadge(nextCount)
          : nextCount === 0 && typeof navigator.clearAppBadge === 'function'
            ? navigator.clearAppBadge()
            : null;
        if (result && typeof result.catch === 'function') {
          result.catch(() => undefined);
        }
      } catch {
        // Badging is an optional installed-app capability.
      }
    }
    void postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.updateUrgentBadge,
      count: nextCount,
      ownerUserId: userId || '',
    });
  }

  function buildUrgentNotificationBody(entry) {
    const reminder = entry?.reminder || {};
    const dueLabel = formatUrgentDueTime(reminder);
    const stageLabel = entry?.stage?.label || 'Due soon';
    return [stageLabel, dueLabel ? `At ${dueLabel}` : '', buildReminderNotificationBody(reminder)]
      .filter(Boolean)
      .join(' \u2022 ');
  }

  function presentUrgentEntry(entry, badgeCount) {
    const signature = getUrgentEntrySignature(entry);
    if (
      !signature
      || urgentPresentedStages.has(signature)
      || urgentPresentationsPending.has(signature)
    ) {
      return;
    }
    if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) {
      urgentBackgroundStages.add(signature);
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate([250, 120, 250]); } catch { /* optional capability */ }
    }
    const reminder = entry.reminder || {};
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    urgentPresentationsPending.add(signature);
    void postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.showUrgentReminder,
      reminder: {
        id: reminder.id,
        title: reminder.title || 'Appointment',
        body: buildUrgentNotificationBody(entry),
        due: reminder.due || null,
        meetingUrl: getUrgentMeetingLink(reminder),
        urlPath: reminderLandingPath,
        ownerUserId: reminder.userId || userId || '',
        updatedAt: reminder.updatedAt,
      },
      stage: entry.stage,
      badgeCount,
    }).then((delivered) => {
      urgentPresentationsPending.delete(signature);
      if (delivered) {
        urgentPresentedStages.add(signature);
      }
    }).catch(() => {
      urgentPresentationsPending.delete(signature);
    });
  }

  function refreshUrgentAttention(nowMs = Date.now()) {
    const state = getUrgentReminderState(items, nowMs);
    updateInstalledAppBadge(state.badgeCount);
    updateUrgentDocumentTitle(state);

    state.alertItems.forEach((entry) => presentUrgentEntry(entry, state.badgeCount));
    const primaryEntry = state.alertItems[0] || null;
    if (primaryEntry) {
      renderUrgentAttentionSurface(primaryEntry, state.badgeCount);
      emitWindowsAttention('urgent', state, primaryEntry.stage);
    } else {
      hideUrgentAttentionSurface();
      emitWindowsAttention(state.badgeCount ? 'acknowledged' : 'clear', state);
    }
    return state;
  }

  function commitUrgentReminderUpdate(reminder, saveOptions = {}) {
    if (!reminder) return Promise.resolve(false);
    reminder.updatedAt = Date.now();
    const savePromise = saveToFirebase(reminder, saveOptions);
    persistItems();
    scheduleReminder(reminder);
    suppressRenderMemoryEvent = true;
    render();
    dispatchCueEvent('memoryCue:remindersUpdated', { items: getReminders() });
    refreshUrgentAttention();
    return savePromise;
  }

  function handleUrgentAction(action, reminderId, stageKey = '', options = {}) {
    const normalizedAction = typeof action === 'string' ? action.trim() : '';
    const normalizedReminderId = typeof reminderId === 'string' ? reminderId.trim() : '';
    const actionId = typeof options.actionId === 'string' ? options.actionId.trim() : '';
    const ownerUserId = typeof options.ownerUserId === 'string' ? options.ownerUserId.trim() : '';
    const actionReminderUpdatedAt = normalizeUrgentActionTimestamp(options.reminderUpdatedAt);
    const isDurableNotificationAction = options.requireRemotePersistence === true || !!actionId;
    const supportedActions = new Set(['done', 'snooze5', 'start', 'acknowledge']);
    if (!normalizedReminderId || !supportedActions.has(normalizedAction)) {
      return Promise.resolve(false);
    }

    const actionKey = getUrgentActionKey(
      normalizedAction,
      normalizedReminderId,
      stageKey,
      options
    );
    if (actionKey && urgentActionInFlight.has(actionKey)) {
      return urgentActionInFlight.get(actionKey);
    }

    const executeAction = async () => {
      if (actionKey && processedUrgentActionKeys.has(actionKey)) {
        if (actionId) {
          await acknowledgeCompletedUrgentAction(actionId, ownerUserId);
        }
        return true;
      }

      const reminder = items.find((entry) => entry?.id === normalizedReminderId);
      if (!reminder) {
        const missingReminderIsTerminal = Boolean(
          actionId
          && ownerUserId
          && userId === ownerUserId
          && remindersHydratedUserId === userId
        );
        if (missingReminderIsTerminal) {
          if (actionKey) {
            rememberProcessedUrgentAction(actionKey);
          }
          await acknowledgeCompletedUrgentAction(actionId, ownerUserId);
          return true;
        }
        return false;
      }

      const effectiveOwnerUserId = ownerUserId
        || (typeof reminder.userId === 'string' ? reminder.userId.trim() : '');
      // Cloud-backed phone actions must wait for the matching account to finish
      // hydration. Unowned local reminders remain actionable while signed out.
      if (
        isDurableNotificationAction
        && effectiveOwnerUserId
        && (
          !userId
          || remindersHydratedUserId !== userId
          || effectiveOwnerUserId !== userId
        )
      ) {
        return false;
      }

      const unversionedCloudActionIsTerminal = Boolean(
        isDurableNotificationAction
        && effectiveOwnerUserId
        && actionReminderUpdatedAt === null
        && effectiveOwnerUserId === userId
        && remindersHydratedUserId === userId
      );
      if (unversionedCloudActionIsTerminal) {
        // Notifications created by older releases did not carry the reminder
        // version. Applying one after a later edit could overwrite or suppress
        // that edit, so retire the legacy action and leave the current reminder
        // prominent for the user to confirm in the app.
        if (actionKey) {
          rememberProcessedUrgentAction(actionKey);
        }
        if (actionId) {
          await acknowledgeCompletedUrgentAction(actionId, effectiveOwnerUserId);
        }
        return true;
      }

      const actionCreatedAt = normalizeUrgentActionTimestamp(options.actionCreatedAt);
      const now = actionCreatedAt ?? Date.now();
      const reminderUpdatedAt = normalizeUrgentActionTimestamp(reminder.updatedAt);
      const reminderAlreadyReflectsAction = (
        (normalizedAction === 'done' && (reminder.done === true || reminder.completed === true))
        || (
          normalizedAction === 'snooze5'
          && Date.parse(reminder.snoozedUntil || '') === now + (5 * 60 * 1000)
        )
        || (
          normalizedAction === 'start'
          && normalizeUrgentActionTimestamp(reminder.urgentStartedAt) === now
        )
        || (
          normalizedAction === 'acknowledge'
          && normalizeUrgentActionTimestamp(reminder.urgentAcknowledgedAt) === now
        )
      );
      const staleActionIsTerminal = Boolean(
        isDurableNotificationAction
        && actionCreatedAt !== null
        && reminderUpdatedAt !== null
        && (actionReminderUpdatedAt ?? actionCreatedAt) < reminderUpdatedAt
        && !reminderAlreadyReflectsAction
        && effectiveOwnerUserId
        && effectiveOwnerUserId === userId
        && remindersHydratedUserId === userId
      );
      if (staleActionIsTerminal) {
        if (actionKey) {
          rememberProcessedUrgentAction(actionKey);
        }
        if (actionId) {
          await acknowledgeCompletedUrgentAction(actionId, effectiveOwnerUserId);
        }
        return true;
      }
      let savePromise = null;
      const actionSaveOptions = isDurableNotificationAction && actionReminderUpdatedAt !== null
        ? {
            expectedRemoteUpdatedAt: actionReminderUpdatedAt,
            requireExistingRemote: true,
          }
        : {};

      if (normalizedAction === 'done') {
        const updated = setReminderCompleted(reminder.id, true, actionSaveOptions);
        if (!updated) {
          return false;
        }
        savePromise = getLatestReminderSavePromise(reminder.id);
      } else if (normalizedAction === 'snooze5') {
        snoozeReminder(reminder, 5, now, actionSaveOptions);
        refreshUrgentAttention(now);
        savePromise = getLatestReminderSavePromise(reminder.id);
      } else if (normalizedAction === 'start') {
        const meetingLink = getUrgentMeetingLink(reminder);
        const meetingSideEffectKey = actionKey
          ? `meeting:${actionKey}`
          : isDurableNotificationAction
            ? `meeting:legacy:${normalizedReminderId}:${stageKey}`
            : '';
        if (options.meetingAlreadyOpened === true && meetingSideEffectKey) {
          rememberProcessedUrgentAction(meetingSideEffectKey);
        }
        if (
          meetingLink
          && options.meetingAlreadyOpened !== true
          && (!meetingSideEffectKey || !processedUrgentActionKeys.has(meetingSideEffectKey))
          && typeof window !== 'undefined'
          && typeof window.open === 'function'
        ) {
          try {
            window.open(meetingLink, '_blank', 'noopener,noreferrer');
            if (meetingSideEffectKey) {
              rememberProcessedUrgentAction(meetingSideEffectKey);
            }
          } catch {
            // Keep the side effect retryable when the browser rejects the open.
          }
        }
        reminder.urgentStartedAt = now;
        reminder.urgentAcknowledgedAt = now;
        savePromise = commitUrgentReminderUpdate(reminder, actionSaveOptions);
      } else if (normalizedAction === 'acknowledge') {
        reminder.urgentAcknowledgedAt = now;
        savePromise = commitUrgentReminderUpdate(reminder, actionSaveOptions);
      }

      const saved = await (savePromise || Promise.resolve(false));
      if (saved?.terminalConflict === true) {
        if (actionKey) {
          rememberProcessedUrgentAction(actionKey);
        }
        if (actionId) {
          await acknowledgeCompletedUrgentAction(actionId, effectiveOwnerUserId);
        }
        return true;
      }
      if (saved !== true) {
        const currentReminder = items.find((entry) => entry?.id === normalizedReminderId);
        const conflictIsNowTerminal = Boolean(
          isDurableNotificationAction
          && actionReminderUpdatedAt !== null
          && effectiveOwnerUserId
          && effectiveOwnerUserId === userId
          && remindersHydratedUserId === userId
          && (
            !currentReminder
            || (
              currentReminder.pendingSync !== true
              && normalizeUrgentActionTimestamp(currentReminder.updatedAt) > actionReminderUpdatedAt
            )
          )
        );
        if (conflictIsNowTerminal) {
          if (actionKey) {
            rememberProcessedUrgentAction(actionKey);
          }
          if (actionId) {
            await acknowledgeCompletedUrgentAction(actionId, effectiveOwnerUserId);
          }
          return true;
        }
        return false;
      }
      if (actionKey) {
        rememberProcessedUrgentAction(actionKey);
      }
      if (actionId) {
        await acknowledgeCompletedUrgentAction(actionId, effectiveOwnerUserId);
      }
      return true;
    };

    if (!actionKey) {
      return executeAction();
    }

    let resolveAction;
    let rejectAction;
    const actionPromise = new Promise((resolve, reject) => {
      resolveAction = resolve;
      rejectAction = reject;
    });

    // Install the lock before executeAction() runs: each urgent action mutates
    // synchronously and dispatches remindersUpdated before its first await.
    urgentActionInFlight.set(actionKey, actionPromise);
    executeAction().then(resolveAction, rejectAction);
    actionPromise.then(
      () => {
        if (urgentActionInFlight.get(actionKey) === actionPromise) {
          urgentActionInFlight.delete(actionKey);
        }
      },
      () => {
        if (urgentActionInFlight.get(actionKey) === actionPromise) {
          urgentActionInFlight.delete(actionKey);
        }
      }
    );
    return actionPromise;
  }

  function acknowledgeBackgroundUrgentStages() {
    if (!urgentBackgroundStages.size) {
      return;
    }
    const state = getUrgentReminderState(items, Date.now());
    const entries = state.alertItems.filter((entry) => urgentBackgroundStages.has(getUrgentEntrySignature(entry)));
    urgentBackgroundStages.clear();
    if (!entries.length) {
      return;
    }
    const now = Date.now();
    entries.forEach((entry) => {
      const reminder = entry.reminder;
      reminder.urgentAcknowledgedAt = now;
      reminder.updatedAt = now;
      saveToFirebase(reminder);
      scheduleReminder(reminder);
    });
    persistItems();
    suppressRenderMemoryEvent = true;
    render();
    dispatchCueEvent('memoryCue:remindersUpdated', { items: getReminders() });
    refreshUrgentAttention(now);
  }

  function consumeUrgentActionFromUrl() {
    if (typeof window === 'undefined' || !window.location) {
      return Promise.resolve(false);
    }
    let url;
    try {
      url = new URL(window.location.href);
    } catch {
      return Promise.resolve(false);
    }
    const action = url.searchParams.get('urgentAction');
    const reminderId = url.searchParams.get('reminderId');
    const stageKey = url.searchParams.get('urgentStage') || '';
    const meetingAlreadyOpened = url.searchParams.get('meetingOpened') === '1';
    const actionId = url.searchParams.get('urgentActionId') || '';
    const actionCreatedAt = url.searchParams.get('urgentActionCreatedAt')
      || url.searchParams.get('actionCreatedAt')
      || '';
    const ownerUserId = url.searchParams.get('urgentOwnerUserId') || '';
    const reminderUpdatedAt = url.searchParams.get('urgentReminderUpdatedAt') || '';
    if (!action || !reminderId) {
      return Promise.resolve(false);
    }
    const urlActionKey = [actionId || 'legacy', reminderId, action, stageKey, actionCreatedAt]
      .map((part) => String(part || ''))
      .join(':');
    if (urgentActionUrlInFlight.has(urlActionKey)) {
      return urgentActionUrlInFlight.get(urlActionKey);
    }

    // Defer execution by one microtask so this URL-level lock exists before an
    // action dispatches remindersUpdated synchronously.
    const actionPromise = Promise.resolve().then(async () => {
      const succeeded = await handleUrgentAction(action, reminderId, stageKey, {
        actionId,
        actionCreatedAt,
        meetingAlreadyOpened,
        ownerUserId,
        reminderUpdatedAt,
        requireRemotePersistence: true,
      });
      if (!succeeded) {
        return false;
      }
      let currentUrl = null;
      try {
        currentUrl = new URL(window.location.href);
      } catch {
        currentUrl = null;
      }
      const sameCurrentAction = currentUrl
        && currentUrl.searchParams.get('urgentAction') === action
        && currentUrl.searchParams.get('reminderId') === reminderId
        && (!actionId || currentUrl.searchParams.get('urgentActionId') === actionId);
      if (
        sameCurrentAction
        && window.history
        && typeof window.history.replaceState === 'function'
      ) {
        currentUrl.searchParams.delete('urgentAction');
        currentUrl.searchParams.delete('reminderId');
        currentUrl.searchParams.delete('urgentStage');
        currentUrl.searchParams.delete('meetingOpened');
        currentUrl.searchParams.delete('urgentActionId');
        currentUrl.searchParams.delete('urgentActionCreatedAt');
        currentUrl.searchParams.delete('actionCreatedAt');
        currentUrl.searchParams.delete('urgentOwnerUserId');
        currentUrl.searchParams.delete('urgentReminderUpdatedAt');
        window.history.replaceState(
          window.history.state,
          '',
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
        );
      }
      return true;
    });
    urgentActionUrlInFlight.set(urlActionKey, actionPromise);
    actionPromise.then(
      () => {
        if (urgentActionUrlInFlight.get(urlActionKey) === actionPromise) {
          urgentActionUrlInFlight.delete(urlActionKey);
        }
      },
      () => {
        if (urgentActionUrlInFlight.get(urlActionKey) === actionPromise) {
          urgentActionUrlInFlight.delete(urlActionKey);
        }
      }
    );
    return actionPromise;
  }

  function setupUrgentAttention() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const refresh = () => {
      void consumeUrgentActionFromUrl();
      refreshUrgentAttention();
    };
    const replayPendingUrgentActions = async ({ retryHydration = false } = {}) => {
      if (retryHydration) {
        await retryReminderFirestoreHydrationIfNeeded();
      }
      await requestPendingUrgentActions();
      return consumeUrgentActionFromUrl();
    };
    const stopTimer = () => {
      if (urgentAttentionTimer) {
        clearInterval(urgentAttentionTimer);
        urgentAttentionTimer = null;
      }
    };
    const startTimer = () => {
      if (!urgentAttentionTimer) {
        urgentAttentionTimer = window.setInterval(refresh, URGENT_ATTENTION_TICK_MS);
      }
    };
    stopTimer();
    document.addEventListener('memoryCue:remindersUpdated', () => {
      refresh();
      replayPendingUrgentActions();
    });
    document.addEventListener('visibilitychange', () => {
      refresh();
      if (!document.hidden) {
        replayPendingUrgentActions({ retryHydration: true });
      }
    });
    window.addEventListener('pageshow', () => {
      startTimer();
      refresh();
      replayPendingUrgentActions({ retryHydration: true });
    });
    window.addEventListener('focus', () => {
      acknowledgeBackgroundUrgentStages();
      replayPendingUrgentActions({ retryHydration: true });
    });
    window.addEventListener('online', () => {
      void replayPendingUrgentActions({ retryHydration: true });
    });
    if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event?.data;
        if (data?.type !== 'memoryCue:urgentAction') {
          return;
        }
        void handleUrgentAction(
          data.action || '',
          data.reminderId || '',
          data.stageKey || '',
          {
            actionId: data.actionId || '',
            actionCreatedAt: data.actionCreatedAt,
            meetingAlreadyOpened: data.meetingAlreadyOpened === true,
            ownerUserId: data.ownerUserId || '',
            reminderUpdatedAt: data.reminderUpdatedAt,
            requireRemotePersistence: true,
          }
        );
      });
    }
    startTimer();
    window.addEventListener('pagehide', stopTimer);
    refresh();
    replayPendingUrgentActions();
  }
  const reminderSheetTitle =
    typeof document !== 'undefined'
      ? document.getElementById('createSheetTitle')
      : null;
  const reminderSheet = typeof document !== 'undefined' ? document.getElementById('create-sheet') : null;
  const reminderSheetEyebrow =
    typeof document !== 'undefined'
      ? document.getElementById('reminderSheetEyebrow')
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
    const isEditMode = currentReminderMode === 'edit';

    if (reminderSheetTitle instanceof HTMLElement) {
      reminderSheetTitle.textContent = isEditMode ? 'Edit reminder' : 'Add reminder';
    }
    if (reminderSheetEyebrow instanceof HTMLElement) {
      reminderSheetEyebrow.textContent = isEditMode ? 'Review' : 'Create';
    }
    if (reminderSheet instanceof HTMLElement) {
      reminderSheet.dataset.mode = isEditMode ? 'edit' : 'create';
    }
  };

  const isoToLocalDate = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isoToLocalTime = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
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

  function getReminderBoardColumnItems(columnKey, { completed = false, excludeId = null } = {}) {
    return items
      .filter((entry) => (
        entry
        && entry.id !== excludeId
        && Boolean(entry.done) === Boolean(completed)
        && getReminderBoardColumnKey(entry.category) === columnKey
      ))
      .slice()
      .sort((a, b) => {
        const aOrder = Number.isFinite(a?.orderIndex) ? a.orderIndex : -Infinity;
        const bOrder = Number.isFinite(b?.orderIndex) ? b.orderIndex : -Infinity;
        if (aOrder !== bOrder) return bOrder - aOrder;
        return compareRemindersForDisplay(a, b);
      });
  }

  function saveBoardOrderChanges(changedItems = [], activityLabel = 'Reminder board updated') {
    const uniqueItems = Array.from(new Map(
      changedItems.filter((entry) => entry?.id).map((entry) => [entry.id, entry]),
    ).values());
    if (!uniqueItems.length) {
      return;
    }

    uniqueItems.forEach((entry) => {
      entry.updatedAt = Date.now();
    });
    sortItemsByOrder(items);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    uniqueItems.forEach((entry) => saveToFirebase(entry));
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    emitActivity({ action: 'reordered', label: activityLabel });
  }

  function moveReminderWithinBoardColumn(id, direction) {
    const reminder = items.find((entry) => entry?.id === id);
    if (!reminder || (direction !== -1 && direction !== 1)) {
      return false;
    }

    const columnKey = getReminderBoardColumnKey(reminder.category);
    const columnItems = getReminderBoardColumnItems(columnKey, { completed: Boolean(reminder.done) });
    const currentIndex = columnItems.findIndex((entry) => entry.id === id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= columnItems.length) {
      return false;
    }

    const target = columnItems[targetIndex];
    const currentOrder = Number.isFinite(reminder.orderIndex) ? reminder.orderIndex : 0;
    const targetOrder = Number.isFinite(target.orderIndex) ? target.orderIndex : 0;
    reminder.orderIndex = targetOrder;
    target.orderIndex = currentOrder;
    saveBoardOrderChanges([reminder, target], `${resolveReminderDisplayTitle(reminder)} reordered`);
    return true;
  }

  function moveReminderToBoardColumn(id, targetColumnKey) {
    const reminder = items.find((entry) => entry?.id === id);
    const targetColumn = getReminderBoardColumnDefinition(targetColumnKey);
    if (!reminder || !targetColumn) {
      return false;
    }

    const currentColumnKey = getReminderBoardColumnKey(reminder.category);
    if (currentColumnKey === targetColumn.key) {
      return false;
    }

    const destinationItems = getReminderBoardColumnItems(targetColumn.key, {
      completed: Boolean(reminder.done),
      excludeId: reminder.id,
    });
    const highestOrder = destinationItems.reduce((max, entry) => (
      Number.isFinite(entry?.orderIndex) ? Math.max(max, entry.orderIndex) : max
    ), 0);

    reminder.category = targetColumn.category;
    reminder.orderIndex = highestOrder + ORDER_INDEX_GAP;
    const targetColumnLabel = getReminderBoardLabel(targetColumn);
    saveBoardOrderChanges(
      [reminder],
      `${resolveReminderDisplayTitle(reminder)} moved to ${targetColumnLabel}`,
    );
    toast(`Moved to ${targetColumnLabel}`);
    return true;
  }

  const dragState = {
    draggingId: null,
    dropTargetId: null,
    dropBefore: true,
    dropColumnKey: null,
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

  function findReminderColumn(node) {
    if (!node || typeof node.closest !== 'function') {
      return null;
    }
    return node.closest('[data-reminder-column]');
  }

  function clearDragHighlights() {
    if (!list) return;
    list.querySelectorAll('.drag-over-before, .drag-over-after').forEach((node) => {
      node.classList.remove('drag-over-before', 'drag-over-after');
    });
    list.querySelectorAll('.reminder-category-column.is-drag-over').forEach((node) => {
      node.classList.remove('is-drag-over');
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
    dragState.dropColumnKey = null;
  }

  function performReorder(sourceId, targetId, before, targetColumnKey = null) {
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const moved = items.find((entry) => entry?.id === sourceId);
    if (!moved) {
      return;
    }

    const target = targetId ? items.find((entry) => entry?.id === targetId) : null;
    const destinationColumnKey = targetColumnKey
      || (target ? getReminderBoardColumnKey(target.category) : getReminderBoardColumnKey(moved.category));
    const destinationColumn = getReminderBoardColumnDefinition(destinationColumnKey);
    const sourceColumnKey = getReminderBoardColumnKey(moved.category);
    if (destinationColumnKey === 'other' && sourceColumnKey !== 'other') {
      return;
    }
    if (destinationColumn && sourceColumnKey !== destinationColumn.key) {
      moved.category = destinationColumn.category;
    }

    const destinationItems = getReminderBoardColumnItems(destinationColumnKey, {
      completed: Boolean(moved.done),
      excludeId: moved.id,
    });
    let insertIndex;
    if (!targetId) {
      insertIndex = destinationItems.length;
    } else {
      const targetIndex = destinationItems.findIndex((entry) => entry?.id === targetId);
      if (targetIndex < 0) {
        return;
      }
      insertIndex = before ? targetIndex : targetIndex + 1;
    }
    destinationItems.splice(insertIndex, 0, moved);

    const prev = destinationItems[insertIndex - 1];
    const next = destinationItems[insertIndex + 1];
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
      newOrder = ORDER_INDEX_GAP * (destinationItems.length + 1);
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
    const destinationLabel = destinationColumn ? getReminderBoardLabel(destinationColumn) : '';
    emitActivity({
      action: sourceColumnKey === destinationColumnKey ? 'reordered' : 'moved',
      label: destinationLabel
        ? `${resolveReminderDisplayTitle(moved)} moved to ${destinationLabel}`
        : 'Reminders reordered',
    });
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
    dragState.dropColumnKey = getReminderBoardColumnKey(item.dataset.category);
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
    const column = findReminderColumn(event.target);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (!item) {
      event.preventDefault();
      dragState.dropTargetId = null;
      dragState.dropBefore = false;
      dragState.dropColumnKey = column?.dataset?.reminderColumn || null;
      clearDragHighlights();
      if (column) {
        column.classList.add('is-drag-over');
      } else {
        list?.classList.add('drag-over-list');
      }
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
      dragState.dropColumnKey = column?.dataset?.reminderColumn
        || getReminderBoardColumnKey(item.dataset.category);
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
    const column = findReminderColumn(event.target);
    let targetId = item?.dataset.id || null;
    let before = dragState.dropBefore;
    const targetColumnKey = column?.dataset?.reminderColumn || dragState.dropColumnKey || null;
    if (item) {
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      before = event.clientY < midpoint;
    } else {
      targetId = null;
      before = false;
    }
    performReorder(dragState.draggingId, targetId, before, targetColumnKey);
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

    function getDropTargets(exclude, columnKey = null) {
      if (!list) {
        return [];
      }
      return Array.from(list.querySelectorAll('[data-reminder-item]')).filter((node) => {
        if (node === exclude) return false;
        if (!columnKey) return true;
        const nodeColumn = findReminderColumn(node)?.dataset?.reminderColumn
          || getReminderBoardColumnKey(node.dataset.category);
        return nodeColumn === columnKey;
      });
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
      placeholder.style.border = '2px dashed color-mix(in srgb, var(--primary-color, #0f766e) 55%, transparent)';
      placeholder.style.background = 'color-mix(in srgb, var(--primary-color, #0f766e) 12%, transparent)';
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
      const pointTarget = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(touchDragState.lastClientX, clientY)
        : null;
      const targetColumn = findReminderColumn(pointTarget) || findReminderColumn(item);
      const targetColumnKey = targetColumn?.dataset?.reminderColumn
        || getReminderBoardColumnKey(item?.dataset?.category);
      const targets = getDropTargets(item, targetColumnKey);

      clearDragHighlights();
      dragState.dropColumnKey = targetColumnKey;
      targetColumn?.classList.add('is-drag-over');

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
        performReorder(
          draggedId,
          dragState.dropTargetId,
          dragState.dropBefore,
          dragState.dropColumnKey,
        );
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
      dragState.dropColumnKey = getReminderBoardColumnKey(item.dataset.category);

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

  function applySignedOutState({ rescheduleSchedules = true } = {}) {
    reminderSyncGeneration += 1;
    clearReminderReconciliationRetry();
    const previousUserId = userId;
    userId = null;
    remindersHydratedUserId = null;
    reminderReconciliationPending = false;
    if (
      previousUserId
      && pushUnregisteredBeforeSignOutUserId !== previousUserId
    ) {
      unregisterReminderPushDevice({ userId: previousUserId }).catch((error) => {
        console.warn('[reminder-push] Failed to unregister push device', error);
      });
    }
    if (pushUnregisteredBeforeSignOutUserId === previousUserId) {
      pushUnregisteredBeforeSignOutUserId = null;
    }
    emitNotificationPermissionState('unavailable');
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
    if (rescheduleSchedules) {
      rescheduleAllReminders();
      const notificationsGranted = typeof Notification !== 'undefined'
        && Notification.permission === 'granted';
      void syncScheduledRemindersWithServiceWorker(buildScheduledReminderPayload(), {
        requestCheck: notificationsGranted,
        tombstones: Array.from(scheduledReminderTombstones.values()),
        activeOwnerUserId: '',
      });
    }
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

  function readQuarantinedPendingReminders() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(QUARANTINED_PENDING_REMINDERS_KEY) || '[]');
      return Array.isArray(parsed) ? normalizeReminderList(parsed) : [];
    } catch (error) {
      console.warn('Failed to load quarantined reminders', error);
      return [];
    }
  }

  function writeQuarantinedPendingReminders(reminders = []) {
    if (typeof localStorage === 'undefined') return false;
    try {
      const normalized = normalizeReminderList(reminders)
        .filter((entry) => entry?.id && entry?.pendingSync && entry?.userId)
        .sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
      if (!normalized.length) {
        localStorage.removeItem(QUARANTINED_PENDING_REMINDERS_KEY);
        return true;
      }
      localStorage.setItem(QUARANTINED_PENDING_REMINDERS_KEY, JSON.stringify(normalized));
      return true;
    } catch (error) {
      console.warn('Failed to preserve quarantined reminders', error);
      return false;
    }
  }

  function quarantinePendingReminders(reminders = []) {
    const byOwnerAndId = new Map();
    [...readQuarantinedPendingReminders(), ...normalizeReminderList(reminders)]
      .forEach((entry) => {
        if (!entry?.id || !entry?.pendingSync || !entry?.userId) return;
        const key = `${entry.userId}:${entry.id}`;
        const existing = byOwnerAndId.get(key);
        if (!existing || Number(entry.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
          byOwnerAndId.set(key, entry);
        }
      });
    return writeQuarantinedPendingReminders(Array.from(byOwnerAndId.values()));
  }

  function loadQuarantinedPendingReminders(ownerUserId) {
    const normalizedOwnerUserId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
    if (!normalizedOwnerUserId) return [];
    return readQuarantinedPendingReminders()
      .filter((entry) => entry.userId === normalizedOwnerUserId);
  }

  function clearQuarantinedPendingReminders(ownerUserId, reminderIds = []) {
    const normalizedOwnerUserId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
    const ids = new Set(Array.isArray(reminderIds) ? reminderIds.filter(Boolean) : []);
    if (!normalizedOwnerUserId || !ids.size) return true;
    return writeQuarantinedPendingReminders(
      readQuarantinedPendingReminders().filter((entry) => (
        entry.userId !== normalizedOwnerUserId || !ids.has(entry.id)
      ))
    );
  }

  function normalizePendingReminderDeletion(record) {
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const ownerUserId = typeof record?.userId === 'string' ? record.userId.trim() : '';
    const updatedAt = Number(record?.updatedAt);
    if (record?.type !== 'delete' || !id || !ownerUserId) {
      return null;
    }
    return {
      type: 'delete',
      id,
      userId: ownerUserId,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    };
  }

  function pendingReminderDeletionKey(record) {
    return JSON.stringify([record.userId, record.id]);
  }

  function readPendingReminderDeletions() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_REMINDER_DELETIONS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      const byOwnerAndId = new Map();
      parsed.forEach((record) => {
        const normalized = normalizePendingReminderDeletion(record);
        if (!normalized) return;
        const key = pendingReminderDeletionKey(normalized);
        const existing = byOwnerAndId.get(key);
        if (!existing || normalized.updatedAt >= existing.updatedAt) {
          byOwnerAndId.set(key, normalized);
        }
      });
      return Array.from(byOwnerAndId.values());
    } catch (error) {
      console.warn('Failed to load pending reminder deletions', error);
      return [];
    }
  }

  function writePendingReminderDeletions(records = []) {
    if (typeof localStorage === 'undefined') return false;
    const byOwnerAndId = new Map();
    records.forEach((record) => {
      const normalized = normalizePendingReminderDeletion(record);
      if (!normalized) return;
      const key = pendingReminderDeletionKey(normalized);
      const existing = byOwnerAndId.get(key);
      if (!existing || normalized.updatedAt >= existing.updatedAt) {
        byOwnerAndId.set(key, normalized);
      }
    });
    const normalizedRecords = Array.from(byOwnerAndId.values())
      .sort((a, b) => a.updatedAt - b.updatedAt);
    try {
      if (!normalizedRecords.length) {
        localStorage.removeItem(PENDING_REMINDER_DELETIONS_KEY);
      } else {
        localStorage.setItem(PENDING_REMINDER_DELETIONS_KEY, JSON.stringify(normalizedRecords));
      }
      return true;
    } catch (error) {
      console.warn('Failed to preserve pending reminder deletions', error);
      return false;
    }
  }

  function queuePendingReminderDeletion(record) {
    const normalized = normalizePendingReminderDeletion(record);
    if (!normalized) return false;
    const key = pendingReminderDeletionKey(normalized);
    const byOwnerAndId = new Map(
      readPendingReminderDeletions().map((entry) => [pendingReminderDeletionKey(entry), entry])
    );
    const existing = byOwnerAndId.get(key);
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      byOwnerAndId.set(key, normalized);
    }
    const persisted = writePendingReminderDeletions(Array.from(byOwnerAndId.values()));
    if (persisted) {
      // A delete intent must never coexist with a retryable live upsert for the
      // same account and reminder.
      if (!clearQuarantinedPendingReminders(normalized.userId, [normalized.id])) {
        markReminderReconciliationPending();
      }
    }
    return persisted;
  }

  function loadPendingReminderDeletions(ownerUserId) {
    const normalizedOwnerUserId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
    if (!normalizedOwnerUserId) return [];
    return readPendingReminderDeletions()
      .filter((record) => record.userId === normalizedOwnerUserId);
  }

  function clearPendingReminderDeletions(ownerUserId, reminderIds = []) {
    const normalizedOwnerUserId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
    const ids = new Set(Array.isArray(reminderIds) ? reminderIds.filter(Boolean) : []);
    if (!normalizedOwnerUserId || !ids.size) return false;
    const currentRecords = readPendingReminderDeletions();
    const nextRecords = currentRecords.filter((record) => (
      record.userId !== normalizedOwnerUserId || !ids.has(record.id)
    ));
    if (nextRecords.length === currentRecords.length) return true;
    return writePendingReminderDeletions(nextRecords);
  }

  function retirePendingReminderDeletion(ownerUserId, reminderId) {
    // Remove every retryable upsert before retiring the delete tombstone. If
    // storage fails, retaining the tombstone is safer than reviving a reminder.
    if (!clearQuarantinedPendingReminders(ownerUserId, [reminderId])) {
      markReminderReconciliationPending();
      return false;
    }
    const retired = clearPendingReminderDeletions(ownerUserId, [reminderId]);
    if (!retired) {
      markReminderReconciliationPending();
    }
    return retired;
  }

  function filterPendingDeletedReminders(reminders = [], fallbackOwnerUserId = '') {
    const tombstoneKeys = new Set(
      readPendingReminderDeletions().map((record) => pendingReminderDeletionKey(record))
    );
    if (!tombstoneKeys.size) return reminders;
    const fallbackOwner = typeof fallbackOwnerUserId === 'string' ? fallbackOwnerUserId.trim() : '';
    return reminders.filter((reminder) => {
      const reminderOwner = typeof reminder?.userId === 'string' && reminder.userId.trim()
        ? reminder.userId.trim()
        : fallbackOwner;
      if (!reminder?.id || !reminderOwner) return true;
      return !tombstoneKeys.has(pendingReminderDeletionKey({
        id: reminder.id,
        userId: reminderOwner,
      }));
    });
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
    const normalizedVisibleItems = ensureOrderIndicesInitialized(
      normalizeReminderList(items)
    );
    const byOwnerAndId = new Map();
    [...cachedOutOfScopeReminderItems, ...normalizedVisibleItems].forEach((entry) => {
      if (!entry?.id) return;
      const ownerUserId = typeof entry.userId === 'string' ? entry.userId.trim() : '';
      byOwnerAndId.set(`${ownerUserId}:${entry.id}`, entry);
    });
    const storedItems = Array.from(byOwnerAndId.values());
    setStoredReminders(storedItems);
    cachedOutOfScopeReminderItems = storedItems.filter(
      (entry) => !reminderIsVisibleForCurrentScope(entry)
    );
    items = normalizedVisibleItems;
  }

  function reminderIsVisibleForCurrentScope(reminder) {
    const ownerUserId = typeof reminder?.userId === 'string' ? reminder.userId.trim() : '';
    if (!authSessionResolved) {
      return false;
    }
    if (!ownerUserId) {
      return !userId;
    }
    return !!userId && ownerUserId === userId;
  }

  function hydrateOfflineReminders() {
    const loadedItems = filterPendingDeletedReminders(
      normalizeReminderList(loadReminders()),
      userId || ''
    );
    cachedOutOfScopeReminderItems = loadedItems.filter(
      (entry) => !reminderIsVisibleForCurrentScope(entry)
    );
    items = ensureOrderIndicesInitialized(
      loadedItems.filter((entry) => reminderIsVisibleForCurrentScope(entry))
    );
  }

  function parseLegacyDailyTaskDate(dateId) {
    if (typeof dateId !== 'string') return null;
    const match = dateId.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const value = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (
      Number.isNaN(value.getTime())
      || value.getFullYear() !== year
      || value.getMonth() !== month - 1
      || value.getDate() !== day
    ) {
      return null;
    }
    return value;
  }

  function normalizeLegacyDailyTaskCategory(value) {
    const category = typeof value === 'string' ? value.trim() : '';
    if (!category || category.toLowerCase() === 'general') {
      return DEFAULT_CATEGORY;
    }
    return category;
  }

  function migrateLegacyDailyTasks() {
    const report = {
      found: false,
      migrated: 0,
      existing: 0,
      invalid: 0,
      verified: false,
      sourceRemoved: false,
    };
    if (typeof localStorage === 'undefined') {
      return report;
    }

    let raw = null;
    try {
      raw = localStorage.getItem(LEGACY_DAILY_TASKS_STORAGE_KEY);
    } catch (error) {
      console.warn('Unable to inspect the legacy Today list', error);
      return report;
    }
    if (!raw) {
      return report;
    }
    report.found = true;

    let dailyTasksByDate = null;
    try {
      dailyTasksByDate = JSON.parse(raw);
    } catch (error) {
      console.warn('Legacy Today list was not valid JSON; keeping it unchanged', error);
      report.invalid = 1;
      return report;
    }
    if (!dailyTasksByDate || typeof dailyTasksByDate !== 'object' || Array.isArray(dailyTasksByDate)) {
      report.invalid = 1;
      return report;
    }

    const candidates = [];
    Object.entries(dailyTasksByDate)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .forEach(([dateId, rawTasks]) => {
        const dueDate = parseLegacyDailyTaskDate(dateId);
        if (!Array.isArray(rawTasks) || !dueDate) {
          report.invalid += Array.isArray(rawTasks) ? Math.max(1, rawTasks.length) : 1;
          return;
        }
        rawTasks.forEach((task, index) => {
          const title = typeof task?.text === 'string' ? task.text.trim() : '';
          if (!title) {
            report.invalid += 1;
            return;
          }
          const legacyId = typeof task?.id === 'string' && task.id.trim()
            ? task.id.trim()
            : `item-${index}`;
          candidates.push({
            dateId,
            dueDate,
            task,
            title,
            identity: `${dateId}:${legacyId}:${index}`,
          });
        });
      });

    const existingKeys = new Set(
      items
        .map((item) => item?.metadata?.legacyDailyTaskKey)
        .filter((value) => typeof value === 'string' && value),
    );
    const createdEntries = [];

    candidates.forEach(({ dateId, dueDate, task, title, identity }) => {
      if (existingKeys.has(identity)) {
        report.existing += 1;
        return;
      }

      const createdAt = Number.isFinite(Number(task?.createdAt))
        ? Number(task.createdAt)
        : Date.now();
      const completedAt = Number.isFinite(Number(task?.completedAt))
        ? Number(task.completedAt)
        : null;
      const priority = typeof task?.priority === 'string' && task.priority.trim()
        ? task.priority.trim()
        : 'Medium';
      const migratedReminder = normalizeReminderRecord({
        id: uid(),
        title,
        due: dueDate.toISOString(),
        notifyAt: null,
        hasExplicitTime: false,
        urgentAlert: false,
        category: normalizeLegacyDailyTaskCategory(task?.category),
        priority: priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase(),
        done: Boolean(task?.completed),
        createdAt,
        updatedAt: completedAt || createdAt,
        pendingSync: !userId,
        metadata: {
          migratedFrom: LEGACY_DAILY_TASKS_STORAGE_KEY,
          legacyDailyTaskKey: identity,
          legacyDailyTaskDate: dateId,
          legacyDailyTaskId: typeof task?.id === 'string' ? task.id : null,
          isAllDay: true,
          suppressNotification: true,
          estimateMs: Number.isFinite(Number(task?.estimateMs)) ? Number(task.estimateMs) : null,
          timeTrackedMs: Number.isFinite(Number(task?.timeTrackedMs)) ? Number(task.timeTrackedMs) : 0,
        },
      });
      assignOrderIndexForNewItem(migratedReminder, { position: 'end' });
      items.push(migratedReminder);
      existingKeys.add(identity);
      createdEntries.push(migratedReminder);
      report.migrated += 1;
    });

    if (createdEntries.length) {
      sortItemsByOrder(items);
      render();
      persistItems();
      updateMobileRemindersHeaderSubtitle();
      emitReminderUpdates();
      dispatchCueEvent('memoryCue:remindersUpdated', { items });
    }

    const persistedKeys = new Set(
      normalizeReminderList(loadReminders())
        .map((item) => item?.metadata?.legacyDailyTaskKey)
        .filter((value) => typeof value === 'string' && value),
    );
    const allCandidatesPersisted = candidates.every(({ identity }) => persistedKeys.has(identity));
    report.verified = report.invalid === 0 && allCandidatesPersisted;

    if (report.verified) {
      try {
        localStorage.removeItem(LEGACY_DAILY_TASKS_STORAGE_KEY);
        report.sourceRemoved = localStorage.getItem(LEGACY_DAILY_TASKS_STORAGE_KEY) == null;
      } catch (error) {
        console.warn('Migrated Today items, but could not retire the old local list', error);
      }
    }

    if (userId && createdEntries.length) {
      createdEntries.forEach((entry) => {
        void saveToFirebase(entry);
      });
    }

    return report;
  }

  function runLegacyDailyTasksMigrationOnce() {
    if (legacyDailyTasksMigrationRan) {
      return null;
    }
    legacyDailyTasksMigrationRan = true;
    const report = migrateLegacyDailyTasks();
    if (report.invalid > 0) {
      console.warn(
        'Some legacy Today items could not be migrated; the original local list was kept',
        report
      );
    }
    return report;
  }

  function buildBackupPayload() {
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      reminders: items.map((item) => normalizeReminderRecord(item, { fallbackId: item?.id || uid() })),
      notes: loadAllNotes(),
      folders: getFolders(),
      inbox: getInboxEntries({ includeMemoryCoach: true }),
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
    const restoresMemoryCoach = Number(backup.version) >= 2;
    replaceInboxEntries(nextInbox, {
      includeMemoryCoach: restoresMemoryCoach,
      syncMemoryCoach: restoresMemoryCoach,
    });
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

  function scheduleEmbeddingBackfill() {
    if (typeof window === 'undefined') {
      return;
    }
    const run = () => {
      ensureAllEmbeddings().catch((error) => {
        console.warn('Deferred reminder embedding backfill failed', error);
      });
    };
    const scheduleWhenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 5000 });
      } else {
        setTimeout(run, 1200);
      }
    };

    if (document.readyState === 'complete') {
      scheduleWhenIdle();
    } else {
      window.addEventListener('load', scheduleWhenIdle, { once: true });
    }
  }

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
  try {
    const storedTombstones = JSON.parse(
      localStorage.getItem(SCHEDULED_REMINDER_TOMBSTONES_KEY) || '[]'
    );
    if (Array.isArray(storedTombstones)) {
      storedTombstones
        .filter((entry) => entry?.id && Number.isFinite(Number(entry.updatedAt)))
        .sort((left, right) => Number(left.updatedAt) - Number(right.updatedAt))
        .slice(-256)
        .forEach((entry) => {
          scheduledReminderTombstones.set(entry.id, {
            id: entry.id,
            ownerUserId: getScheduledReminderOwnerId(entry),
            done: true,
            deleted: true,
            updatedAt: Number(entry.updatedAt),
            transientAccountCleanup: entry.transientAccountCleanup === true,
          });
        });
    }
  } catch {
    scheduledReminderTombstones.clear();
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
        if (!Number.isFinite(entry.sourceUpdatedAt)) {
          entry.sourceUpdatedAt = entry.updatedAt;
        }
        if (!Number.isFinite(entry.notifiedAt)) {
          entry.notifiedAt = null;
        }
        entry.semanticEmbedding = normalizeSemanticEmbedding(entry.semanticEmbedding);
      }
    });
  }

  {
    const initialPayload = buildScheduledReminderPayload();
    const notificationsGranted =
      typeof Notification !== 'undefined'
      && Notification.permission === 'granted';
    if (notificationsGranted) {
      setupBackgroundReminderSync();
    }
    // Keep the worker's last authenticated schedule intact while Firebase is
    // still resolving the persisted account. The auth callback below sends the
    // complete owner-scoped snapshot once that identity is known.
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


  // Local reminders and the capture controls should not wait for Firebase's
  // CDN modules. Start auth in the background; the existing session callback
  // will reconcile Firestore as soon as it is ready.
  void Promise.resolve()
    .then(() => initAuth({
      selectors: {
        signInButtons: googleSignInBtns,
        signOutButtons: googleSignOutBtns,
        userName: googleUserName ? [googleUserName] : [],
        syncStatus: syncStatus ? [syncStatus] : [],
      },
      disableButtonBinding: true,
      onSessionChange: async (user) => {
        const authWasResolved = authSessionResolved;
        authSessionResolved = true;
        const nextUserId = typeof user?.uid === 'string' ? user.uid : (typeof user?.id === 'string' ? user.id : null);
        const previousUserId = userId;
        const sessionSyncGeneration = ++reminderSyncGeneration;
        clearUndoDeleteState();
        if (nextUserId !== previousUserId) {
          remindersHydratedUserId = null;
          reminderReconciliationPending = false;
          clearReminderReconciliationRetry();
        }
        userId = nextUserId;
        if (!authWasResolved || nextUserId !== previousUserId) {
          hydrateOfflineReminders();
          runLegacyDailyTasksMigrationOnce();
          render();
          rescheduleAllReminders();
        }

        const previousPushWasAlreadyRemoved = Boolean(
          previousUserId
          && pushUnregisteredBeforeSignOutUserId === previousUserId
        );
        if (previousPushWasAlreadyRemoved) {
          pushUnregisteredBeforeSignOutUserId = null;
        }
        if (previousUserId && previousUserId !== nextUserId && !previousPushWasAlreadyRemoved) {
          await unregisterReminderPushDevice({
            userId: previousUserId,
            ...(nextUserId ? { preserveMessagingToken: true } : {}),
          }).catch((error) => {
            console.warn('[reminder-push] Failed to unregister the previous account device', error);
          });
          if (userId !== nextUserId || reminderSyncGeneration !== sessionSyncGeneration) {
            return;
          }
        }

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
          // Phone registration is safety-critical and must not wait behind notes,
          // migration, or reminder sync work that could fail independently.
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            await syncCurrentDevicePushRegistration(nextUserId, sessionSyncGeneration);
          }
          if (userId !== nextUserId || reminderSyncGeneration !== sessionSyncGeneration) {
            return;
          }
          await setupReminderFirestoreSync(nextUserId, sessionSyncGeneration);
          if (userId !== nextUserId || reminderSyncGeneration !== sessionSyncGeneration) {
            return;
          }
          await syncNotesFromFirestoreOnLogin();
          await migrateOfflineRemindersIfNeeded();
          startGroupColorSync();
          startBoardLabelSync();
          return;
        }

        notesMigrationComplete = false;
        notesMigrationUserId = null;
        lastSyncedNoteIds = new Set();
        stopGroupColorSync();
        stopBoardLabelSync();
        applySignedOutState();
      },
    }))
    .then((controller) => {
      authController = controller;
    })
    .catch((error) => {
      console.warn('Reminder auth startup failed; continuing with the local copy.', error);
      authSessionResolved = true;
      applySignedOutState();
    });

  const shouldWireAuthButtons = autoWireAuthButtons;

  const wireAuthButton = (button, handler) => {
    if (!(button instanceof HTMLElement) || button._authWired) {
      return;
    }
    button.addEventListener('click', (event) => {
      // The mobile overflow menu also observes this click. Mark it so that menu
      // code closes the menu without starting a second auth request.
      event.__memoryCueAuthHandled = true;
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

  const signOutAfterPushCleanup = async () => {
    const signingOutUserId = userId;
    if (signingOutUserId) {
      try {
        const deviceRecordRemoved = await unregisterReminderPushDevice({
          userId: signingOutUserId,
        });
        if (deviceRecordRemoved !== false) {
          pushUnregisteredBeforeSignOutUserId = signingOutUserId;
        }
      } catch (error) {
        console.warn('[reminder-push] Failed to unregister push device before sign-out', error);
      }
    }
    try {
      return await startSignOutFlow();
    } catch (error) {
      if (pushUnregisteredBeforeSignOutUserId === signingOutUserId) {
        pushUnregisteredBeforeSignOutUserId = null;
      }
      // If sign-out itself fails, keep this still-signed-in device connected so
      // an urgent phone alert is not silently lost after the cleanup attempt.
      await syncCurrentDevicePushRegistration();
      throw error;
    }
  };

  if (shouldWireAuthButtons && googleSignInBtns.length) {
    googleSignInBtns.forEach((btn) => wireAuthButton(btn, startSignInFlow));
  }

  if (shouldWireAuthButtons && googleSignOutBtns.length) {
    googleSignOutBtns.forEach((btn) => wireAuthButton(btn, signOutAfterPushCleanup));
  }

  const initialScopedUserId = typeof window !== 'undefined' && typeof window.__MEMORY_CUE_AUTH_USER_ID === 'string'
    ? window.__MEMORY_CUE_AUTH_USER_ID.trim()
    : '';

  if (!initialScopedUserId) {
    applySignedOutState({ rescheduleSchedules: false });
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
  async function setupReminderFirestoreSync(
    syncingUserId = userId,
    syncingGeneration = reminderSyncGeneration,
    { replayPendingActions = true } = {}
  ){
    const syncResult = await reminderFirestoreSync.setupReminderFirestoreSync({
      userId: syncingUserId,
      currentUnsubscribe: unsubscribe,
      hydrateOfflineReminders,
      isCurrent: () => (
        userId === syncingUserId
        && reminderSyncGeneration === syncingGeneration
      ),
    });
    const hasStructuredSyncResult = Boolean(
      syncResult
      && typeof syncResult === 'object'
      && Object.prototype.hasOwnProperty.call(syncResult, 'authoritative')
    );
    const nextUnsubscribe = hasStructuredSyncResult
      ? syncResult.unsubscribe
      : syncResult;
    // Legacy injected implementations returned only the unsubscribe callback.
    // Production returns the structured result above so an offline fallback can
    // never be mistaken for an authoritative cloud hydration.
    const hydrationIsAuthoritative = hasStructuredSyncResult
      ? syncResult.authoritative === true
      : true;
    const reconciliationIsPending = hasStructuredSyncResult
      ? syncResult.pendingWork === true
      : false;
    if (userId !== syncingUserId || reminderSyncGeneration !== syncingGeneration) {
      nextUnsubscribe?.();
      return false;
    }
    unsubscribe = typeof nextUnsubscribe === 'function' ? nextUnsubscribe : null;
    remindersHydratedUserId = hydrationIsAuthoritative ? syncingUserId : null;
    reminderReconciliationPending = reconciliationIsPending;
    if (reconciliationIsPending) {
      scheduleReminderReconciliationRetry();
    } else {
      clearReminderReconciliationRetry();
    }
    const notificationsGranted = typeof Notification !== 'undefined'
      && Notification.permission === 'granted';
    await syncScheduledRemindersWithServiceWorker(buildScheduledReminderPayload(), {
      requestCheck: notificationsGranted,
      tombstones: Array.from(scheduledReminderTombstones.values()),
      activeOwnerUserId: syncingUserId || '',
    });
    if (userId !== syncingUserId || reminderSyncGeneration !== syncingGeneration) {
      return false;
    }
    if (replayPendingActions) {
      await requestPendingUrgentActions();
      void consumeUrgentActionFromUrl();
    }
    return hydrationIsAuthoritative;
  }

  async function retryReminderFirestoreHydrationIfNeeded() {
    const retryUserId = userId;
    const retryGeneration = reminderSyncGeneration;
    if (
      !retryUserId
      || (
        remindersHydratedUserId === retryUserId
        && reminderReconciliationPending !== true
      )
    ) {
      return remindersHydratedUserId === retryUserId;
    }
    if (
      reminderHydrationRetry
      && reminderHydrationRetry.userId === retryUserId
      && reminderHydrationRetry.generation === retryGeneration
    ) {
      return reminderHydrationRetry.promise;
    }

    const retryEntry = {
      userId: retryUserId,
      generation: retryGeneration,
      promise: null,
    };
    retryEntry.promise = setupReminderFirestoreSync(
      retryUserId,
      retryGeneration,
      { replayPendingActions: false }
    ).catch((error) => {
      console.warn('[reminder] Firestore hydration retry failed', error);
      return false;
    }).finally(() => {
      if (reminderHydrationRetry === retryEntry) {
        reminderHydrationRetry = null;
      }
    });
    reminderHydrationRetry = retryEntry;
    return retryEntry.promise;
  }

  function clearReminderReconciliationRetry() {
    if (reminderReconciliationRetryTimer !== null) {
      clearTimeout(reminderReconciliationRetryTimer);
      reminderReconciliationRetryTimer = null;
    }
  }

  function scheduleReminderReconciliationRetry(delayMs = 15000) {
    if (!userId || reminderReconciliationRetryTimer !== null) {
      return;
    }
    const scheduledUserId = userId;
    const scheduledGeneration = reminderSyncGeneration;
    reminderReconciliationRetryTimer = setTimeout(async () => {
      reminderReconciliationRetryTimer = null;
      if (
        userId !== scheduledUserId
        || reminderSyncGeneration !== scheduledGeneration
        || reminderReconciliationPending !== true
      ) {
        return;
      }
      await retryReminderFirestoreHydrationIfNeeded();
      if (
        userId === scheduledUserId
        && reminderSyncGeneration === scheduledGeneration
        && reminderReconciliationPending === true
      ) {
        scheduleReminderReconciliationRetry(30000);
      }
    }, Math.max(0, Number(delayMs) || 0));
  }

  function markReminderReconciliationPending() {
    reminderReconciliationPending = true;
    scheduleReminderReconciliationRetry();
  }

  async function syncCurrentDevicePushRegistration(
    expectedUserId = userId,
    expectedGeneration = reminderSyncGeneration
  ) {
    const registrationUserId = typeof expectedUserId === 'string' ? expectedUserId.trim() : '';
    const registrationGeneration = expectedGeneration;
    const registrationSessionIsCurrent = () => (
      registrationUserId
      && registrationUserId === userId
      && registrationGeneration === reminderSyncGeneration
    );
    if (!registrationSessionIsCurrent()) {
      if (!userId) {
        emitNotificationPermissionState('unavailable');
      }
      return null;
    }
    const registration = await ensureServiceWorkerRegistration().catch(() => null);
    if (!registrationSessionIsCurrent()) {
      return null;
    }
    if (!registration) {
      emitNotificationPermissionState('unavailable');
      return null;
    }
    const registeredDevice = await registerReminderPushDevice({
      userId: registrationUserId,
      serviceWorkerRegistration: registration,
    }).catch((error) => {
      console.warn('[reminder-push] Failed to register this device', error);
      return null;
    });
    if (!registrationSessionIsCurrent()) {
      if (registeredDevice) {
        await unregisterReminderPushDevice({
          userId: registrationUserId,
          preserveMessagingToken: true,
        }).catch((error) => {
          console.warn('[reminder-push] Failed to remove a stale device registration', error);
        });

        // A same-account sign-out/sign-in can make an old registration finish
        // after the fresh session has already registered this device. Removing
        // that stale write also removes the shared device record, so immediately
        // restore it for the still-current generation.
        const replacementUserId = userId;
        const replacementGeneration = reminderSyncGeneration;
        if (
          replacementUserId === registrationUserId
          && replacementGeneration !== registrationGeneration
          && userId === replacementUserId
          && reminderSyncGeneration === replacementGeneration
        ) {
          await syncCurrentDevicePushRegistration(
            replacementUserId,
            replacementGeneration
          );
        }
      }
      return null;
    }
    emitNotificationPermissionState(registeredDevice ? 'connected' : 'unavailable');
    return registeredDevice;
  }

  async function syncReminderAcrossDevices(item, action = 'upsert', syncUserId = userId) {
    if (!syncUserId || syncUserId !== userId || !item?.id) {
      return null;
    }
    return syncReminderToOtherDevices({
      userId: syncUserId,
      reminder: item,
      action,
      badgeCount: getUrgentReminderState(items, Date.now()).badgeCount,
    }).catch((error) => {
      console.warn('[reminder-push] Failed to sync reminder across devices', error);
      return null;
    });
  }

  function queueReminderSave(reminderId, operation) {
    const previousSave = reminderSaveQueues.get(reminderId) || Promise.resolve(true);
    const currentSave = previousSave
      .catch(() => false)
      .then(operation);
    reminderSaveQueues.set(reminderId, currentSave);
    latestReminderSavePromises.set(reminderId, currentSave);
    currentSave.then(
      () => {
        if (reminderSaveQueues.get(reminderId) === currentSave) {
          reminderSaveQueues.delete(reminderId);
        }
        if (latestReminderSavePromises.get(reminderId) === currentSave) {
          latestReminderSavePromises.delete(reminderId);
        }
      },
      () => {
        if (reminderSaveQueues.get(reminderId) === currentSave) {
          reminderSaveQueues.delete(reminderId);
        }
        if (latestReminderSavePromises.get(reminderId) === currentSave) {
          latestReminderSavePromises.delete(reminderId);
        }
      }
    );
    return currentSave;
  }

  function getLatestReminderSavePromise(reminderId) {
    return latestReminderSavePromises.get(reminderId) || Promise.resolve(true);
  }

  function saveToFirebase(item, options = {}){
    const explicitExpectedUserId = typeof options.expectedUserId === 'string'
      ? options.expectedUserId.trim()
      : '';
    const itemOwnerUserId = typeof item?.userId === 'string' ? item.userId.trim() : '';
    if (
      explicitExpectedUserId
      && itemOwnerUserId
      && explicitExpectedUserId !== itemOwnerUserId
    ) {
      return Promise.resolve(false);
    }
    const expectedUserId = explicitExpectedUserId || itemOwnerUserId;
    const saveUserId = userId;
    if (expectedUserId && saveUserId && expectedUserId !== saveUserId) {
      return Promise.resolve(false);
    }

    const storedRemoteGuard = item?.metadata?.[PENDING_REMOTE_GUARD_METADATA_KEY];
    const hasExplicitExpectedRemoteVersion = Object.prototype.hasOwnProperty.call(
      options,
      'expectedRemoteUpdatedAt'
    );
    const expectedRemoteUpdatedAt = normalizeUrgentActionTimestamp(
      hasExplicitExpectedRemoteVersion
        ? options.expectedRemoteUpdatedAt
        : storedRemoteGuard?.expectedUpdatedAt
    );
    const requireExistingRemote = options.requireExistingRemote === true
      || storedRemoteGuard?.requireExisting === true;
    const hasRemoteGuard = expectedRemoteUpdatedAt !== null;
    const normalizedItem = normalizeReminderRecord(item, { fallbackId: uid() });
    if (hasRemoteGuard) {
      normalizedItem.metadata = {
        ...(normalizedItem.metadata && typeof normalizedItem.metadata === 'object'
          ? normalizedItem.metadata
          : {}),
        [PENDING_REMOTE_GUARD_METADATA_KEY]: {
          expectedUpdatedAt: expectedRemoteUpdatedAt,
          requireExisting: requireExistingRemote,
        },
      };
    }
    const reminderId = normalizedItem.id;
    const createdAt = normalizedItem.createdAt;
    const updatedAt = Math.max(Date.now(), Number(normalizedItem.updatedAt) || 0);
    const savePayload = {
      ...normalizedItem,
      id: reminderId,
      createdAt,
      updatedAt,
      userId: saveUserId || expectedUserId || null,
      pendingSync: true,
    };
    const remoteMetadata = savePayload.metadata && typeof savePayload.metadata === 'object'
      ? { ...savePayload.metadata }
      : null;
    if (remoteMetadata) {
      delete remoteMetadata[PENDING_REMOTE_GUARD_METADATA_KEY];
    }
    const remoteSavePayload = {
      ...savePayload,
      metadata: remoteMetadata && Object.keys(remoteMetadata).length ? remoteMetadata : null,
    };

    Object.assign(item, {
      ...savePayload,
    });
    persistItems();

    const pushAction = savePayload.done
      || savePayload.completed
      || savePayload?.metadata?.suppressNotification === true
      || !getReminderScheduleIso(savePayload)
      ? 'delete'
      : 'upsert';
    let savePromise = null;
    savePromise = queueReminderSave(reminderId, async () => {
      if (!saveUserId) {
        return true;
      }
      if (
        userId !== saveUserId
        || (expectedUserId && userId !== expectedUserId)
      ) {
        return false;
      }

      try {
        const remoteSaveResult = await saveReminder(saveUserId, remoteSavePayload, {
          ...(hasRemoteGuard ? { expectedUpdatedAt: expectedRemoteUpdatedAt } : {}),
          ...(requireExistingRemote ? { requireExisting: true } : {}),
        });
        if (remoteSaveResult?.saved === false) {
          if (remoteSaveResult.remoteStateKnown !== true) {
            markReminderReconciliationPending();
          }
          const saveIsStillLatest = latestReminderSavePromises.get(reminderId) === savePromise;
          const currentIndex = userId === saveUserId
            ? items.findIndex((entry) => entry?.id === reminderId)
            : -1;
          if (
            saveIsStillLatest
            && currentIndex >= 0
            && remoteSaveResult.remoteStateKnown === true
          ) {
            if (remoteSaveResult.remoteReminder) {
              items[currentIndex] = normalizeReminderRecord({
                ...remoteSaveResult.remoteReminder,
                id: reminderId,
                userId: saveUserId,
                pendingSync: false,
              }, { fallbackId: reminderId });
            } else {
              items.splice(currentIndex, 1);
            }
            persistItems();
            render();
            rescheduleAllReminders();
            refreshUrgentAttention();
          } else {
            item.pendingSync = true;
            if (currentIndex >= 0) {
              items[currentIndex].pendingSync = true;
            }
            persistItems();
          }
          return {
            ...remoteSaveResult,
            terminalConflict: remoteSaveResult.remoteStateKnown === true,
          };
        }
        if (latestReminderSavePromises.get(reminderId) === savePromise) {
          item.pendingSync = false;
          if (item.metadata && typeof item.metadata === 'object') {
            delete item.metadata[PENDING_REMOTE_GUARD_METADATA_KEY];
          }
          if (userId === saveUserId) {
            const currentItem = items.find((entry) => entry?.id === reminderId);
            const currentItemOwner = typeof currentItem?.userId === 'string'
              ? currentItem.userId.trim()
              : '';
            if (currentItem && (!currentItemOwner || currentItemOwner === saveUserId)) {
              currentItem.pendingSync = false;
              if (currentItem.metadata && typeof currentItem.metadata === 'object') {
                delete currentItem.metadata[PENDING_REMOTE_GUARD_METADATA_KEY];
              }
            }
            persistItems();
          }
        }
        return true;
      } catch (error) {
        markReminderReconciliationPending();
        item.pendingSync = true;
        if (userId === saveUserId) {
          const currentItem = items.find((entry) => entry?.id === reminderId);
          const currentItemOwner = typeof currentItem?.userId === 'string'
            ? currentItem.userId.trim()
            : '';
          if (currentItem && (!currentItemOwner || currentItemOwner === saveUserId)) {
            currentItem.pendingSync = true;
          }
          persistItems();
        }
        console.error('Save failed:', error); toast('Save queued (offline)');
        return false;
      }
    });
    void savePromise.then((saved) => {
      if (saved !== true || !saveUserId) {
        return null;
      }
      // Cross-device push is a best-effort fan-out after the durable Firestore
      // write. It must never hold the per-reminder persistence queue or delay a
      // phone action acknowledgement.
      return syncReminderAcrossDevices({
        ...remoteSavePayload,
        pendingSync: false,
      }, pushAction, saveUserId);
    }).catch((error) => {
      console.warn('[reminder-push] Failed after reminder save', error);
    });
    return savePromise;
  }
  function deleteFromFirebase(id, options = {}){
    const expectedUserId = typeof options.expectedUserId === 'string'
      ? options.expectedUserId.trim()
      : '';
    const deleteUserId = userId;
    if (expectedUserId && deleteUserId !== expectedUserId) {
      return Promise.resolve(false);
    }
    return queueReminderSave(id, async () => {
      if (!deleteUserId) {
        return true;
      }
      if (
        userId !== deleteUserId
        || (expectedUserId && userId !== expectedUserId)
      ) {
        return false;
      }
      try {
        const removeResult = await removeReminder(deleteUserId, id, {
          ...(Object.prototype.hasOwnProperty.call(options, 'maxUpdatedAt')
            ? { maxUpdatedAt: options.maxUpdatedAt }
            : {}),
        });
        return removeResult?.removed !== false;
      } catch (error) {
        markReminderReconciliationPending();
        console.error('Delete failed:', error);
        return false;
      }
    });
  }

  async function retryPendingReminderDeletion(record) {
    const pendingDelete = normalizePendingReminderDeletion(record);
    if (!pendingDelete || userId !== pendingDelete.userId) {
      return false;
    }
    const deleted = await deleteFromFirebase(pendingDelete.id, {
      expectedUserId: pendingDelete.userId,
      maxUpdatedAt: pendingDelete.updatedAt,
    });
    if (deleted) {
      void syncReminderAcrossDevices({
        id: pendingDelete.id,
        userId: pendingDelete.userId,
        updatedAt: pendingDelete.updatedAt,
        done: true,
        completed: true,
      }, 'delete', pendingDelete.userId);
    }
    return deleted;
  }

  let resetForm = () => {};
  let loadForEdit = () => {};
  let openEditReminderSheet = () => {};
  let openNewReminderSheet = () => {};
  let handleSaveAction = () => {};

  function createReminderFromPayload(payload = {}, options = {}) {
    const {
      closeSheet = true,
      activityAction = 'created',
      activityLabelPrefix = 'Reminder added',
      parseSchedule = true,
    } = options;
    const sourceText = typeof payload?.text === 'string' && payload.text.trim()
      ? payload.text.trim()
      : typeof payload?.title === 'string' && payload.title.trim()
        ? payload.title.trim()
        : '';
    const parsedSchedule = parseSchedule && sourceText
      ? parseReminderScheduleFromText(sourceText)
      : { dueDate: null, cleanedText: '' };
    // Accept an explicit due as an ISO string, a Date, OR epoch milliseconds.
    // buildReminderPayload normalizes dueAt to a number before this runs, so the old
    // string/Date-only check treated a correctly-parsed time as "no explicit due" and
    // re-derived it from the date-stripped title, producing the wrong time.
    const toDueIso = (value) => {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
      if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
      return null;
    };
    const explicitDueAt = toDueIso(payload?.dueAt) || toDueIso(payload?.due);
    const explicitNotifyAt = toDueIso(payload?.notifyAt);
    const hasExplicitDue = Boolean(explicitDueAt);
    const parsedDueAt = parsedSchedule.dueDate instanceof Date && Number.isFinite(parsedSchedule.dueDate.getTime())
      ? parsedSchedule.dueDate.toISOString()
      : null;
    const parsedNotifyAt = parsedSchedule.dueDate instanceof Date && Number.isFinite(parsedSchedule.dueDate.getTime())
      ? new Date(parsedSchedule.dueDate.getTime() - 15 * 60 * 1000).toISOString()
      : null;
    const resolvedDueAt = hasExplicitDue ? explicitDueAt : parsedDueAt;
    const resolvedNotifyAt = hasExplicitDue ? explicitNotifyAt : parsedNotifyAt;
    const hasExplicitTime = Boolean(resolvedDueAt && (
      typeof payload?.hasExplicitTime === 'boolean'
        ? payload.hasExplicitTime
        : !hasExplicitDue && parsedSchedule.hasExplicitTime === true
    ));
    const urgentAlert = hasExplicitTime && (
      typeof payload?.urgentAlert === 'boolean' ? payload.urgentAlert : true
    );
    const cleanedTitle = parsedSchedule.cleanedText || stripReminderPromptPrefix(sourceText);
    const normalizedPayload = cleanedTitle && (resolvedDueAt || parsedDueAt)
      ? {
        ...payload,
        text: cleanedTitle,
        title: cleanedTitle,
        dueAt: resolvedDueAt,
        due: resolvedDueAt,
        notifyAt: resolvedNotifyAt,
        hasExplicitTime,
        urgentAlert,
      }
      : {
        ...payload,
        hasExplicitTime: false,
        urgentAlert: false,
      };

    const item = reminderDataService.createReminder(normalizedPayload, {
      normalizeReminder: (record) => normalizeReminderRecord(record),
      createId: uid,
      defaultCategory: categoryInput ? categoryInput.value : DEFAULT_CATEGORY,
      pendingSync: !userId,
      parseSchedule,
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

        const notificationsSuppressed = createdEntry?.metadata?.suppressNotification === true;
        if (
          !notificationsSuppressed
          && typeof Notification !== 'undefined'
          && Notification.permission === 'granted'
        ) {
          syncCurrentDevicePushRegistration();
        }
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
  function getReminders(){
    return items.map((item) => ({
      ...item,
      metadata: item?.metadata && typeof item.metadata === 'object'
        ? { ...item.metadata }
        : item?.metadata ?? null,
      keywords: Array.isArray(item?.keywords) ? [...item.keywords] : [],
      semanticEmbedding: Array.isArray(item?.semanticEmbedding)
        ? [...item.semanticEmbedding]
        : item?.semanticEmbedding ?? null,
    }));
  }

  function setReminderCompleted(id, completed = true, saveOptions = {}){
    const it = items.find(x=>x.id===id);
    if(!it) return null;
    const nextCompleted = Boolean(completed);
    const updated = reminderDataService.completeReminder(id, nextCompleted, {
      onCompleted: (record) => {
        it.done = !!record.done;
        it.completed = !!record.completed;
        it.completedAt = record.completedAt || null;
        it.updatedAt = record.updatedAt;
      },
    });
    if (!updated) {
      return null;
    }
    saveToFirebase(it, saveOptions);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    dispatchCueEvent('memoryCue:remindersUpdated', { items: getReminders() });
    if(it.done){
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
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
    refreshUrgentAttention();
    return getReminders().find((entry) => entry.id === id) || null;
  }

  function toggleDone(id){
    const it = items.find(x=>x.id===id);
    if(!it) return null;
    return setReminderCompleted(id, !it.done);
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

  function isReminderDeleteSessionCurrent(sessionUserId, syncGeneration) {
    return userId === sessionUserId && reminderSyncGeneration === syncGeneration;
  }

  function clearPendingDeletionForItem(item) {
    if (item?.id && pendingDeletionItems.get(item.id) === item) {
      pendingDeletionItems.delete(item.id);
    }
  }

  function undoDelete(tokenId){
    if(!deleteUndoState || deleteUndoState.tokenId !== tokenId) return;
    const {
      item,
      index,
      sessionUserId,
      syncGeneration,
    } = deleteUndoState;
    if(!item) {
      clearUndoDeleteState(tokenId);
      return;
    }
    if (!isReminderDeleteSessionCurrent(sessionUserId, syncGeneration)) {
      clearUndoDeleteState(tokenId);
      return;
    }
    const ownerUserId = typeof item.userId === 'string' && item.userId.trim()
      ? item.userId.trim()
      : sessionUserId;
    if (
      ownerUserId
      && !clearPendingReminderDeletions(ownerUserId, [item.id])
    ) {
      toast('Could not restore reminder yet. Please try again.');
      return;
    }
    if (ownerUserId) {
      clearQuarantinedPendingReminders(ownerUserId, [item.id]);
      item.userId = ownerUserId;
    }
    if (item.id) {
      pendingDeletionItems.delete(item.id);
    }
    clearUndoDeleteState(tokenId);
    const insertAt = Number.isInteger(index) ? Math.min(Math.max(index, 0), items.length) : items.length;
    item.pendingSync = !userId;
    item.updatedAt = Math.max(Date.now(), (Number(item.updatedAt) || 0) + 1);
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
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      syncCurrentDevicePushRegistration();
    }
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    emitActivity({
      action: 'restored',
      label: `Reminder restored · ${item.title}`,
    });
    toast('Reminder restored');
  }
  async function removeItem(id, { offerUndo = true } = {}){
    const deletionSessionUserId = userId;
    const deletionSyncGeneration = reminderSyncGeneration;
    const scrollPosition = captureReminderScrollPosition();
    const index = items.findIndex(x=>x.id===id);
    const removalCandidate = index >= 0 ? items[index] : null;
    if (!removalCandidate) return false;
    const deletionUserId = typeof removalCandidate.userId === 'string' && removalCandidate.userId.trim()
      ? removalCandidate.userId.trim()
      : deletionSessionUserId;
    const deletionUpdatedAt = Math.max(
      Date.now(),
      (Number(removalCandidate.updatedAt) || 0) + 1
    );
    const deletionSnapshot = {
      ...removalCandidate,
      ...(deletionUserId ? { userId: deletionUserId } : {}),
      updatedAt: deletionUpdatedAt,
    };

    // Store a durable, owner-scoped delete intent before changing the visible
    // cache. If this write fails, keeping the reminder is safer than silently
    // losing a cloud deletion on reload.
    if (deletionUserId && !queuePendingReminderDeletion({
      type: 'delete',
      id,
      userId: deletionUserId,
      updatedAt: deletionUpdatedAt,
    })) {
      toast('Could not queue reminder deletion. The reminder was kept.');
      return false;
    }

    const removed = items.splice(index, 1)[0];
    removed.updatedAt = deletionUpdatedAt;
    if (deletionUserId) {
      removed.userId = deletionUserId;
    }
    if (editingId === id) {
      resetForm();
    }
    pendingDeletionItems.set(id, removed);
    render();
    persistItems();
    cancelReminder(id);
    restoreReminderScrollPosition(scrollPosition);
    const deletedRemotely = deletionUserId
      ? await deleteFromFirebase(id, {
          expectedUserId: deletionUserId,
          maxUpdatedAt: deletionSnapshot.updatedAt,
        })
      : false;
    if (deletedRemotely) {
      retirePendingReminderDeletion(deletionUserId, id);
      void syncReminderAcrossDevices(deletionSnapshot, 'delete', deletionUserId);
    }
    if (!isReminderDeleteSessionCurrent(deletionSessionUserId, deletionSyncGeneration)) {
      clearPendingDeletionForItem(removed);
      return true;
    }
    if (!deletionUserId || !userId) {
      clearPendingDeletionForItem(removed);
    }
    const activityLabel = removed ? `Reminder removed · ${removed.title}` : 'Reminder removed';
    emitActivity({ action: 'deleted', label: activityLabel });
    if(removed && statusEl && offerUndo){
      clearUndoDeleteState();
      const tokenId = `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      deleteUndoState = {
        tokenId,
        item: removed,
        index,
        sessionUserId: deletionSessionUserId,
        syncGeneration: deletionSyncGeneration,
        pendingRemote: Boolean(deletionUserId && !deletedRemotely),
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
    return true;
  }

  function openReminderById(id) {
    const reminder = items.find((entry) => entry?.id === id);
    if (!reminder) {
      return false;
    }
    openEditReminderSheet(reminder);
    return true;
  }

  async function undoCapturedReminder(id) {
    if (!items.some((entry) => entry?.id === id)) {
      return false;
    }
    await removeItem(id, { offerUndo: false });
    return !items.some((entry) => entry?.id === id);
  }

  async function clearCompletedReminders(){
    const completedItems = items.filter((item) => item?.done === true);
    if (!completedItems.length) {
      return;
    }

    const count = completedItems.length;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return;
    }
    const confirmed = window.confirm(
      `Permanently delete ${count} completed ${count === 1 ? 'reminder' : 'reminders'}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    const deletionSessionUserId = userId;
    const deletionSyncGeneration = reminderSyncGeneration;
    const completedDeletionRecords = completedItems.map((item) => {
      const deletionUpdatedAt = Math.max(
        Date.now(),
        (Number(item.updatedAt) || 0) + 1
      );
      const ownerUserId = typeof item?.userId === 'string' && item.userId.trim()
        ? item.userId.trim()
        : deletionSessionUserId;
      return {
        item,
        ownerUserId,
        deletionSnapshot: {
          ...item,
          ...(ownerUserId ? { userId: ownerUserId } : {}),
          updatedAt: deletionUpdatedAt,
        },
      };
    });

    const readyDeletionRecords = [];
    const blockedDeletionRecords = [];
    completedDeletionRecords.forEach((record) => {
      if (record.ownerUserId && !queuePendingReminderDeletion({
        type: 'delete',
        id: record.item.id,
        userId: record.ownerUserId,
        updatedAt: record.deletionSnapshot.updatedAt,
      })) {
        blockedDeletionRecords.push(record);
        return;
      }
      record.item.updatedAt = record.deletionSnapshot.updatedAt;
      if (record.ownerUserId) {
        record.item.userId = record.ownerUserId;
      }
      readyDeletionRecords.push(record);
    });

    if (!readyDeletionRecords.length) {
      toast('Could not queue completed reminder deletions. They were kept.');
      return;
    }

    const readyDeletionIds = new Set(readyDeletionRecords.map(({ item }) => item.id));
    readyDeletionRecords.forEach(({ item }) => {
      pendingDeletionItems.set(item.id, item);
    });

    items = items.filter((item) => !readyDeletionIds.has(item?.id));
    completedReminderSectionExpanded = false;
    render();
    persistItems();
    readyDeletionRecords.forEach(({ item }) => cancelReminder(item.id));

    const results = [];
    const chunkSize = 8;
    for (let index = 0; index < readyDeletionRecords.length; index += chunkSize) {
      const chunk = readyDeletionRecords.slice(index, index + chunkSize);
      const chunkResults = await Promise.all(chunk.map(async ({
        item,
        ownerUserId,
        deletionSnapshot,
      }) => ({
        item,
        ownerUserId,
        deletionSnapshot,
        deleted: ownerUserId
          ? await deleteFromFirebase(item.id, {
              expectedUserId: ownerUserId,
              maxUpdatedAt: deletionSnapshot.updatedAt,
            })
          : false,
      })));
      results.push(...chunkResults);
    }

    results
      .filter(({ deleted }) => deleted)
      .forEach(({ item, ownerUserId, deletionSnapshot }) => {
        retirePendingReminderDeletion(ownerUserId, item.id);
        void syncReminderAcrossDevices(deletionSnapshot, 'delete', ownerUserId);
      });

    if (!isReminderDeleteSessionCurrent(deletionSessionUserId, deletionSyncGeneration)) {
      results.forEach(({ item }) => clearPendingDeletionForItem(item));
      return;
    }

    const queuedResults = results.filter((result) => result.ownerUserId && !result.deleted);
    if (!userId) {
      results.forEach(({ item }) => clearPendingDeletionForItem(item));
    }

    items = ensureOrderIndicesInitialized(normalizeReminderList(items));
    sortItemsByOrder(items);
    render();
    persistItems();
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });

    const clearedCount = results.length;

    emitActivity({
      action: 'deleted',
      label: `${clearedCount} completed ${clearedCount === 1 ? 'reminder' : 'reminders'} cleared`,
    });
    if (blockedDeletionRecords.length) {
      toast(`${clearedCount} cleared. ${blockedDeletionRecords.length} could not be queued and were kept.`);
    } else if (queuedResults.length) {
      toast(`${clearedCount} cleared. ${queuedResults.length} cloud ${queuedResults.length === 1 ? 'deletion is' : 'deletions are'} queued.`);
    } else {
      toast(`${clearedCount} completed ${clearedCount === 1 ? 'reminder' : 'reminders'} cleared`);
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


  function scheduleRecurringReminder(item, { preserveTriggeredNotification = false } = {}) {
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
    scheduleReminder(item, { preserveTriggeredNotification });
    persistItems();
    render();
    return true;
  }

  function handleReminderTriggered(item, { notificationAlreadyDisplayed = false } = {}) {
    if (isUrgentTimedReminder(item)) {
      refreshUrgentAttention();
      return;
    }
    if (!notificationAlreadyDisplayed) {
      showReminder(item);
    }
    const current = items.find((entry) => entry?.id === item?.id);
    if (current && scheduleRecurringReminder(current, {
      preserveTriggeredNotification: notificationAlreadyDisplayed,
    })) {
      return;
    }
    clearReminderState(item.id, {
      closeNotification: false,
      cancelTrigger: !notificationAlreadyDisplayed,
    });
  }

  function snoozeReminder(reminder, minutes, actionCreatedAt = null, saveOptions = {}) {
    if (!reminder || typeof reminder !== 'object') {
      return;
    }
    const normalizedActionCreatedAt = normalizeUrgentActionTimestamp(actionCreatedAt);
    const now = normalizedActionCreatedAt ?? Date.now();
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
    saveToFirebase(reminder, saveOptions);
    scheduleReminder(reminder);
    persistItems();
    render();
    refreshUrgentAttention();
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

  function normalizeScheduleUpdatedAt(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    return null;
  }

  function getScheduledReminderOwnerId(item) {
    return typeof (item?.ownerUserId || item?.userId) === 'string'
      ? (item.ownerUserId || item.userId).trim()
      : '';
  }

  function isReminderEligibleForSchedule(item) {
    if (
      !item?.id
      || item.done === true
      || item.completed === true
      || item?.metadata?.suppressNotification === true
      || !getReminderScheduleIso(item)
    ) {
      return false;
    }
    const ownerUserId = getScheduledReminderOwnerId(item);
    if (userId) {
      return !ownerUserId || ownerUserId === userId;
    }
    return !ownerUserId || !authSessionResolved;
  }

  function buildScheduledReminderRecord(item, previous = {}) {
    const scheduleIso = getReminderScheduleIso(item);
    const sourceUpdatedAt = normalizeScheduleUpdatedAt(item?.updatedAt)
      ?? normalizeScheduleUpdatedAt(previous?.sourceUpdatedAt)
      ?? normalizeScheduleUpdatedAt(previous?.updatedAt)
      ?? Date.now();
    const previousSourceUpdatedAt = normalizeScheduleUpdatedAt(previous?.sourceUpdatedAt);
    const previousTransportUpdatedAt = normalizeScheduleUpdatedAt(previous?.updatedAt);
    const transportUpdatedAt = previousSourceUpdatedAt === sourceUpdatedAt
      && previousTransportUpdatedAt !== null
      && previousTransportUpdatedAt >= sourceUpdatedAt
      ? previousTransportUpdatedAt
      : sourceUpdatedAt;
    const previousDue = typeof previous?.due === 'string' ? previous.due : null;
    return {
      id: item.id,
      ownerUserId: getScheduledReminderOwnerId(item) || userId || '',
      title: item.title,
      due: scheduleIso,
      notifyAt: typeof item.notifyAt === 'string' ? item.notifyAt : null,
      recurrence: normalizeRecurrence(item.recurrence),
      snoozedUntil: normalizeIsoString(item.snoozedUntil),
      notifyMinutesBefore: Number.isFinite(Number(item.notifyMinutesBefore)) ? Number(item.notifyMinutesBefore) : 0,
      category: normalizeCategory(item.category) || DEFAULT_CATEGORY,
      priority: item.priority || 'Medium',
      notes: typeof item.notes === 'string' ? item.notes : '',
      body: buildReminderNotificationBody(item),
      meetingUrl: getUrgentMeetingLink(item),
      urlPath: reminderLandingPath,
      updatedAt: transportUpdatedAt,
      sourceUpdatedAt,
      viaTrigger: false,
      semanticEmbedding: normalizeSemanticEmbedding(item.semanticEmbedding),
      notifiedAt: previousDue === scheduleIso && Number.isFinite(previous?.notifiedAt)
        ? previous.notifiedAt
        : null,
      urgentAlert: item.urgentAlert === true,
      hasExplicitTime: item.hasExplicitTime === true,
      urgentAcknowledgedAt: normalizeUrgentActionTimestamp(item.urgentAcknowledgedAt),
      urgentStartedAt: normalizeUrgentActionTimestamp(item.urgentStartedAt),
    };
  }

  function scheduledReminderDefinitionMatches(left, right) {
    if (!left || !right) return false;
    const fields = [
      'id',
      'ownerUserId',
      'title',
      'due',
      'notifyAt',
      'recurrence',
      'snoozedUntil',
      'notifyMinutesBefore',
      'category',
      'priority',
      'notes',
      'body',
      'meetingUrl',
      'urlPath',
      'updatedAt',
      'sourceUpdatedAt',
      'urgentAlert',
      'hasExplicitTime',
      'urgentAcknowledgedAt',
      'urgentStartedAt',
    ];
    return fields.every((field) => left[field] === right[field])
      && JSON.stringify(left.semanticEmbedding || null) === JSON.stringify(right.semanticEmbedding || null);
  }

  function buildScheduledReminderPayload() {
    return Object.values(scheduledReminders || {})
      .filter((entry) => entry && typeof entry === 'object' && entry.id)
      .map((entry) => ({
        id: entry.id,
        ownerUserId: entry.ownerUserId || entry.userId || userId || '',
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
        meetingUrl: typeof entry.meetingUrl === 'string' ? entry.meetingUrl : '',
        urlPath: entry.urlPath || reminderLandingPath,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        notifiedAt: Number.isFinite(entry.notifiedAt) ? entry.notifiedAt : null,
        urgentAlert: entry.urgentAlert === true,
        hasExplicitTime: entry.hasExplicitTime === true,
        urgentAcknowledgedAt: normalizeUrgentActionTimestamp(entry.urgentAcknowledgedAt),
        urgentStartedAt: normalizeUrgentActionTimestamp(entry.urgentStartedAt),
        viaTrigger: entry.viaTrigger === true,
        semanticEmbedding: normalizeSemanticEmbedding(entry.semanticEmbedding),
      }));
  }

  function saveScheduled(){
    try {
      localStorage.setItem('scheduledReminders', JSON.stringify(scheduledReminders));
      const tombstones = Array.from(scheduledReminderTombstones.values());
      if (tombstones.length) {
        localStorage.setItem(SCHEDULED_REMINDER_TOMBSTONES_KEY, JSON.stringify(tombstones));
      } else {
        localStorage.removeItem(SCHEDULED_REMINDER_TOMBSTONES_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist scheduled reminders', error);
    }
    const payload = buildScheduledReminderPayload();
    const notificationsGranted =
      typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (notificationsGranted) {
      setupBackgroundReminderSync();
    }
    if (authSessionResolved) {
      syncScheduledRemindersWithServiceWorker(
        payload,
        {
          requestCheck: notificationsGranted,
          tombstones: Array.from(scheduledReminderTombstones.values()),
          activeOwnerUserId: userId || '',
        }
      );
    }
  }
  function clearReminderState(id, {
    closeNotification = true,
    cancelTrigger = true,
    updatedAt: mutationUpdatedAt = null,
    transientAccountCleanup = false,
  } = {}){
    if(closeNotification){
      const active = activeNotifications.get(id);
      if(active){
        try { active.close(); } catch {}
        activeNotifications.delete(id);
      }
    }
    if(reminderTimers[id]){ clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
    if(reminderNotifyTimers[id]){ clearTimeout(reminderNotifyTimers[id]); delete reminderNotifyTimers[id]; }
    if (cancelTrigger) {
      cancelTriggerNotification(id);
    }
    const scheduledEntry = scheduledReminders[id] || null;
    const reminderEntry = items.find((entry) => entry?.id === id) || null;
    const previousTombstone = scheduledReminderTombstones.get(id);
    const normalizedMutationUpdatedAt = normalizeScheduleUpdatedAt(mutationUpdatedAt);
    const updatedAt = normalizedMutationUpdatedAt === null
      ? transientAccountCleanup
        ? Math.max(
          Number(scheduledEntry?.updatedAt || 0),
          Number(reminderEntry?.updatedAt || 0),
          Number(previousTombstone?.updatedAt || 0)
        )
        : Math.max(
          Date.now(),
          Number(scheduledEntry?.updatedAt || 0) + 1,
          Number(reminderEntry?.updatedAt || 0),
          Number(previousTombstone?.updatedAt || 0) + 1
        )
      : Math.max(normalizedMutationUpdatedAt, Number(previousTombstone?.updatedAt || 0));
    scheduledReminderTombstones.set(id, {
      id,
      ownerUserId:
        scheduledEntry?.ownerUserId
        || reminderEntry?.ownerUserId
        || reminderEntry?.userId
        || userId
        || '',
      done: true,
      deleted: true,
      updatedAt,
      transientAccountCleanup,
    });
    while (scheduledReminderTombstones.size > 256) {
      const oldestId = Array.from(scheduledReminderTombstones.entries())
        .sort((left, right) => Number(left[1]?.updatedAt || 0) - Number(right[1]?.updatedAt || 0))[0]?.[0];
      if (!oldestId) break;
      scheduledReminderTombstones.delete(oldestId);
    }
    void postMessageToServiceWorker({
      type: SERVICE_WORKER_MESSAGE_TYPES.cancelScheduledReminder,
      reminderId: id,
      ownerUserId: scheduledReminderTombstones.get(id)?.ownerUserId || '',
      updatedAt,
    });
    if(scheduledEntry){ delete scheduledReminders[id]; }
    saveScheduled();
  }
  function cancelReminder(id, options = {}){ clearReminderState(id, options); }
  function showReminder(item){
    if(!item || !item.id || !('Notification' in window)) return;
    try{
      const existing = activeNotifications.get(item.id);
      if(existing && typeof existing.close === 'function'){
        try { existing.close(); } catch {}
      }
      const notification = new Notification(item.title,{
        body: buildReminderNotificationBody(item),
        icon: new URL('./icons/icon-192.png', window.location.href).href,
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
  async function scheduleTriggerNotification(item, { cancelExisting = true } = {}){
    if(!supportsNotificationTriggers()) return false;
    const Trigger = getTimestampTriggerCtor();
    const scheduledIso = getReminderScheduleIso(item);
    if(!Trigger || !scheduledIso) return false;
    const dueTime = new Date(scheduledIso).getTime();
    if(!Number.isFinite(dueTime)) return false;
    const registration = await ensureServiceWorkerRegistration();
    if(!registration) return false;
    if (cancelExisting) {
      await cancelTriggerNotification(item.id, registration);
    }
    const body = buildReminderNotificationBody(item);
    const data = {
      id: item.id,
      title: item.title,
      due: scheduledIso,
      priority: item.priority || 'Medium',
      category: item.category || DEFAULT_CATEGORY,
      body,
      urlPath: reminderLandingPath,
      ownerUserId: item.ownerUserId || item.userId || userId || '',
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
    };
    const options = {
      body,
      tag: `memory-cue-reminder-${encodeURIComponent(item.id)}-${dueTime}`,
      data,
      renotify: true,
    };
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
  function scheduleReminder(item, { preserveTriggeredNotification = false } = {}){
    if(!item||!item.id) return;
    const itemUpdatedAt = normalizeScheduleUpdatedAt(item.updatedAt);
    if(item?.metadata?.suppressNotification === true){
      cancelReminder(item.id, { updatedAt: itemUpdatedAt });
      return;
    }
    item.category = normalizeCategory(item.category);
    if(item.done || item.completed){
      cancelReminder(item.id, { updatedAt: itemUpdatedAt });
      return;
    }
    const previous = scheduledReminders[item.id] || {};
    const previousTombstone = scheduledReminderTombstones.get(item.id);
    const stored = buildScheduledReminderRecord(item, previous);
    if(!stored.due){
      cancelReminder(item.id, { updatedAt: itemUpdatedAt });
      return;
    }
    const tombstoneOwnerUserId = getScheduledReminderOwnerId(previousTombstone);
    const reactivatingTransientAccountSchedule = Boolean(
      previousTombstone?.transientAccountCleanup === true
      && stored.ownerUserId
      && stored.ownerUserId === userId
      && tombstoneOwnerUserId === stored.ownerUserId
    );
    const tombstoneAppliesToItem = previousTombstone
      && !reactivatingTransientAccountSchedule
      && (
        !tombstoneOwnerUserId
        || !stored.ownerUserId
        || tombstoneOwnerUserId === stored.ownerUserId
      );
    if (
      tombstoneAppliesToItem
      && Number(previousTombstone.updatedAt || 0) >= Number(stored.updatedAt || 0)
    ) {
      return;
    }
    if (reactivatingTransientAccountSchedule) {
      // The worker saw an equal-timestamp tombstone while another account was
      // active. A one-millisecond transport bump revives that same domain
      // version without turning ordinary rescheduling into a new mutation.
      stored.updatedAt = Math.max(
        stored.updatedAt,
        Number(previousTombstone.updatedAt || 0) + 1
      );
    }
    const definitionUnchanged = scheduledReminderDefinitionMatches(previous, stored);
    stored.viaTrigger = definitionUnchanged && previous.viaTrigger === true;
    scheduledReminderTombstones.delete(item.id);
    scheduledReminders[item.id]=stored;
    saveScheduled();
    if(reminderTimers[item.id]){ clearTimeout(reminderTimers[item.id]); delete reminderTimers[item.id]; }
    if(reminderNotifyTimers[item.id]){ clearTimeout(reminderNotifyTimers[item.id]); delete reminderNotifyTimers[item.id]; }
    if(!('Notification' in window) || Notification.permission!=='granted'){ return; }
    const scheduleIso = stored.due;
    if(isUrgentTimedReminder(item)){
      refreshUrgentAttention();
      return;
    }
    const dueTime = new Date(scheduleIso).getTime();
    if(!Number.isFinite(dueTime)) return;
    const notifyMinutesBefore = Number.isFinite(Number(item.notifyMinutesBefore)) ? Number(item.notifyMinutesBefore) : 0;
    const notifyTime = dueTime - (Math.max(0, notifyMinutesBefore) * 60000);
    const delay = dueTime - Date.now();
    if(delay<=0){
      if(scheduledReminders[item.id]?.viaTrigger){
        handleReminderTriggered(item, { notificationAlreadyDisplayed: true });
        return;
      }
      handleReminderTriggered({ ...item, due: scheduleIso });
      return;
    }
    const useTriggers = supportsNotificationTriggers();
    if(Number.isFinite(notifyTime) && notifyTime > Date.now() && notifyTime < dueTime){
      const notifyDelay = notifyTime - Date.now();
      setLongTimeout(reminderNotifyTimers, item.id, notifyDelay, () => {
        showReminder({ ...item, due: scheduleIso });
      });
    }
    if(useTriggers){
      stored.viaTrigger = false;
      scheduleTriggerNotification(item, {
        cancelExisting: !preserveTriggeredNotification,
      }).then((scheduled) => {
        if(scheduled && scheduledReminders[item.id]){
          scheduledReminders[item.id] = { ...scheduledReminders[item.id], viaTrigger: true };
          saveScheduled();
        }
      });
    }
    setLongTimeout(reminderTimers, item.id, delay, () => {
      if(useTriggers && scheduledReminders[item.id]?.viaTrigger === true){
        handleReminderTriggered(item, { notificationAlreadyDisplayed: true });
        return;
      }
      handleReminderTriggered({ ...item, due: scheduleIso });
    });
  }
  function rescheduleAllReminders(){
    // Until auth resolves, the shared local cache may belong to another
    // account. Preserve the stored schedule unchanged rather than exposing or
    // cancelling it under an unknown owner.
    if (!authSessionResolved) {
      return;
    }
    const currentItemsById = new Map(
      items
        .filter((item) => item?.id)
        .map((item) => [item.id, item])
    );

    Object.keys(scheduledReminders).forEach((reminderId) => {
      const currentItem = currentItemsById.get(reminderId);
      if (isReminderEligibleForSchedule(currentItem)) {
        return;
      }
      const useDomainTimestamp = currentItem
        && (
          currentItem.done === true
          || currentItem.completed === true
          || currentItem?.metadata?.suppressNotification === true
        );
      const scheduledOwnerUserId = getScheduledReminderOwnerId(scheduledReminders[reminderId]);
      const currentOwnerUserId = getScheduledReminderOwnerId(currentItem);
      const belongsToInactiveAccount = Boolean(
        (scheduledOwnerUserId && scheduledOwnerUserId !== userId)
        || (currentOwnerUserId && currentOwnerUserId !== userId)
      );
      clearReminderState(reminderId, {
        updatedAt: useDomainTimestamp ? currentItem.updatedAt : null,
        transientAccountCleanup: belongsToInactiveAccount,
      });
    });

    currentItemsById.forEach((item) => {
      if (!isReminderEligibleForSchedule(item)) {
        return;
      }
      const existing = scheduledReminders[item.id] || null;
      const desired = buildScheduledReminderRecord(item, existing || {});
      const definitionUnchanged = scheduledReminderDefinitionMatches(existing, desired);
      const hasPageTimer = Object.prototype.hasOwnProperty.call(reminderTimers, item.id)
        || Object.prototype.hasOwnProperty.call(reminderNotifyTimers, item.id);
      const notificationsGranted = typeof Notification !== 'undefined'
        && Notification.permission === 'granted';
      const alreadyArmed = isUrgentTimedReminder(item)
        || hasPageTimer
        || (supportsNotificationTriggers() && existing?.viaTrigger === true);
      if (definitionUnchanged && (!notificationsGranted || alreadyArmed)) {
        return;
      }
      scheduleReminder(item);
    });
  }

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

  function getReminderStartOfDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function appendCompletedReminderSectionHeading(parent, {
    listIsSemantic,
    count = 0,
    expanded = false,
    onToggle = null,
    onClear = null,
  } = {}) {
    if (!parent || typeof parent.appendChild !== 'function') {
      return;
    }

    const headingEl = document.createElement(listIsSemantic ? 'li' : 'div');
    headingEl.className = 'reminder-completed-section';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'reminder-completed-section-toggle';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', expanded ? 'Hide completed reminders' : 'Show completed reminders');

    const headingLabel = document.createElement('span');
    headingLabel.className = 'reminder-completed-section-label';
    headingLabel.textContent = 'Done';

    const countLabel = document.createElement('span');
    countLabel.className = 'reminder-completed-section-count';
    countLabel.textContent = String(count);

    const chevron = document.createElement('span');
    chevron.className = 'reminder-completed-section-icon';
    chevron.setAttribute('aria-hidden', 'true');

    toggleBtn.append(headingLabel, countLabel, chevron);
    if (typeof onToggle === 'function') {
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      });
    }
    headingEl.appendChild(toggleBtn);
    if (typeof onClear === 'function') {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'reminder-completed-section-clear';
      clearBtn.dataset.action = 'clear-completed-reminders';
      clearBtn.textContent = 'Clear done';
      clearBtn.setAttribute(
        'aria-label',
        `Permanently delete ${count} completed ${count === 1 ? 'reminder' : 'reminders'}`,
      );
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClear();
      });
      headingEl.appendChild(clearBtn);
    }
    parent.appendChild(headingEl);
  }

  // Collapse detailed categories into the broad visual groups used by reminder cards.
  function getReminderCategoryGroup(categoryName) {
    const raw = typeof categoryName === 'string' ? categoryName.toLowerCase() : '';
    if (raw.includes('school')) return { key: 'school', label: 'School' };
    if (raw.includes('footy') || raw.includes('football')) return { key: 'footy', label: 'Footy' };
    if (raw.includes('home')) return { key: 'home', label: 'Home' };
    if (raw.includes('wellbeing') || raw.includes('support')) return { key: 'wellbeing', label: 'Wellbeing' };
    return { key: 'other', label: 'Other' };
  }

  // Compact due label for a card with an explicit calendar date, e.g. "30 Jul, 3:00 PM".
  function formatReminderDueChip(reminder, todayRange) {
    if (!reminder || typeof reminder !== 'object') {
      return '';
    }
    const dueDate = reminder.due ? new Date(reminder.due) : null;
    const hasValidDueDate = dueDate instanceof Date && !Number.isNaN(dueDate.getTime());
    if (hasValidDueDate) {
      const timeLabel = reminder?.metadata?.isAllDay === true ? '' : fmtTime(dueDate);
      const referenceDate = todayRange?.start instanceof Date && !Number.isNaN(todayRange.start.getTime())
        ? todayRange.start
        : new Date();
      const dateOptions = {
        day: 'numeric',
        month: 'short',
        timeZone: TZ,
      };
      if (dueDate.getFullYear() !== referenceDate.getFullYear()) {
        dateOptions.year = 'numeric';
      }
      let dateLabel = '';
      try { dateLabel = dueDate.toLocaleDateString(locale, dateOptions); } catch { dateLabel = fmtDayDate(dueDate); }
      return timeLabel ? `${dateLabel}, ${timeLabel}` : dateLabel;
    }
    const inlineSchedule = extractReminderInlineSchedule(getReminderDisplaySourceText(reminder), todayRange);
    if (inlineSchedule.label) return inlineSchedule.label;
    if (reminder.pinToToday === true) return 'Pinned for today';
    return '';
  }

  function normalizeReminderBoardLabel(value) {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, REMINDER_BOARD_LABEL_MAX_LENGTH)
      : '';
  }

  function loadReminderBoardLabels() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(REMINDER_BOARD_LABELS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      return REMINDER_BOARD_COLUMNS.reduce((labels, column) => {
        const label = normalizeReminderBoardLabel(parsed[column.key]);
        if (label) labels[column.key] = label;
        return labels;
      }, {});
    } catch {
      return {};
    }
  }

  function persistReminderBoardLabels(labels) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(REMINDER_BOARD_LABELS_KEY, JSON.stringify(labels));
    } catch {
      /* ignore persistence errors */
    }
  }

  function getReminderBoardLabel(columnOrKey) {
    const column = typeof columnOrKey === 'string'
      ? getReminderBoardColumnDefinition(columnOrKey)
      : columnOrKey;
    if (!column) return '';
    return loadReminderBoardLabels()[column.key] || column.label;
  }

  function saveReminderBoardLabel(columnKey, nextValue) {
    const column = getReminderBoardColumnDefinition(columnKey);
    const label = normalizeReminderBoardLabel(nextValue);
    if (!column || !label) return '';
    const previousLabel = getReminderBoardLabel(column);
    const labels = loadReminderBoardLabels();
    labels[column.key] = label;
    persistReminderBoardLabels(labels);
    if (userId) {
      saveReminderBoardLabelRemote(userId, column.key, label).catch((error) => {
        console.warn('[reminder] board label save failed', error);
      });
    }
    render();
    if (label !== previousLabel) {
      toast(`${previousLabel} renamed to ${label}`);
    }
    return label;
  }

  function applyRemoteReminderBoardLabels(remoteLabels) {
    if (!remoteLabels || typeof remoteLabels !== 'object') return;
    const local = loadReminderBoardLabels();
    let changed = false;
    REMINDER_BOARD_COLUMNS.forEach((column) => {
      const remoteLabel = normalizeReminderBoardLabel(remoteLabels[column.key]);
      if (remoteLabel && local[column.key] !== remoteLabel) {
        local[column.key] = remoteLabel;
        changed = true;
      }
    });
    if (changed) {
      persistReminderBoardLabels(local);
    }
    if (!boardLabelInitialSyncDone && userId) {
      boardLabelInitialSyncDone = true;
      REMINDER_BOARD_COLUMNS.forEach((column) => {
        const localLabel = normalizeReminderBoardLabel(local[column.key]);
        if (localLabel && !normalizeReminderBoardLabel(remoteLabels[column.key])) {
          saveReminderBoardLabelRemote(userId, column.key, localLabel).catch(() => {});
        }
      });
    }
    if (changed) {
      try {
        render();
      } catch {
        /* ignore */
      }
    }
  }

  async function startBoardLabelSync() {
    if (!userId) return;
    stopBoardLabelSync();
    try {
      boardLabelUnsub = await subscribeReminderBoardLabels(
        userId,
        (remoteLabels) => applyRemoteReminderBoardLabels(remoteLabels),
        (error) => console.warn('[reminder] board label sync error', error),
      );
    } catch (error) {
      console.warn('[reminder] board label subscribe failed', error);
    }
  }

  function stopBoardLabelSync() {
    if (typeof boardLabelUnsub === 'function') {
      try {
        boardLabelUnsub();
      } catch {
        /* ignore */
      }
    }
    boardLabelUnsub = null;
    boardLabelInitialSyncDone = false;
  }

  function beginReminderBoardLabelEdit(column, headingCopy, labelHeading) {
    if (!column || !(headingCopy instanceof HTMLElement) || !(labelHeading instanceof HTMLElement)) {
      return;
    }
    const currentLabel = getReminderBoardLabel(column);
    const form = document.createElement('form');
    form.className = 'reminder-category-column-rename-form';
    form.setAttribute('aria-label', `Rename ${currentLabel} column`);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'reminder-category-column-rename-input';
    input.value = currentLabel;
    input.maxLength = REMINDER_BOARD_LABEL_MAX_LENGTH;
    input.required = true;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Column name');

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'reminder-category-column-rename-save';
    saveButton.textContent = '✓';
    saveButton.setAttribute('aria-label', 'Save column name');

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'reminder-category-column-rename-cancel';
    cancelButton.textContent = '×';
    cancelButton.setAttribute('aria-label', 'Cancel renaming column');

    const cancel = () => render();
    cancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const savedLabel = saveReminderBoardLabel(column.key, input.value);
      if (!savedLabel) {
        input.setCustomValidity('Enter a column name');
        input.reportValidity();
      }
    });

    form.append(input, saveButton, cancelButton);
    headingCopy.classList.add('is-renaming');
    labelHeading.replaceWith(form);
    input.focus();
    input.select();
  }

  function loadReminderGroupColors() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(REMINDER_GROUP_COLORS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveReminderGroupColor(name, color) {
    const key = typeof name === 'string' ? name.trim() : '';
    if (!key || !isHexColor(color) || typeof localStorage === 'undefined') return;
    try {
      const map = loadReminderGroupColors();
      map[key] = color.toLowerCase();
      localStorage.setItem(REMINDER_GROUP_COLORS_KEY, JSON.stringify(map));
    } catch {
      /* ignore persistence errors */
    }
  }

  function updateReminderGroupColor(name, color, displayName = name) {
    const key = typeof name === 'string' ? name.trim() : '';
    if (!key || !isHexColor(color)) {
      return false;
    }

    const normalizedColor = color.toLowerCase();
    saveReminderGroupColor(key, normalizedColor);
    render();
    if (userId) {
      saveReminderGroupColorRemote(userId, key, normalizedColor).catch((error) => {
        console.warn('[reminder] group colour save failed', error);
        toast('Colour saved on this device. Sync will retry later.');
      });
    }
    const label = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : key;
    toast(`${label} colour updated`);
    return true;
  }

  // Merge a remote group-colour map (from Firestore) into the local cache, re-rendering if
  // anything changed, and push any colours set locally that the server doesn't have yet.
  function applyRemoteReminderGroupColors(remoteColors) {
    if (!remoteColors || typeof remoteColors !== 'object') return;
    const local = loadReminderGroupColors();
    let changed = false;
    Object.keys(remoteColors).forEach((key) => {
      const color = remoteColors[key];
      if (isHexColor(color) && local[key] !== color.toLowerCase()) {
        local[key] = color.toLowerCase();
        changed = true;
      }
    });
    if (changed && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(REMINDER_GROUP_COLORS_KEY, JSON.stringify(local));
      } catch {
        /* ignore */
      }
    }
    if (!groupColorInitialSyncDone && userId) {
      groupColorInitialSyncDone = true;
      Object.keys(local).forEach((key) => {
        if (!(key in remoteColors)) {
          saveReminderGroupColorRemote(userId, key, local[key]).catch(() => {});
        }
      });
    }
    if (changed) {
      try {
        render();
      } catch {
        /* ignore */
      }
    }
  }

  async function startGroupColorSync() {
    if (!userId) return;
    stopGroupColorSync();
    try {
      groupColorUnsub = await subscribeReminderGroupColors(
        userId,
        (remoteColors) => applyRemoteReminderGroupColors(remoteColors),
        (error) => console.warn('[reminder] group colour sync error', error),
      );
    } catch (error) {
      console.warn('[reminder] group colour subscribe failed', error);
    }
  }

  function stopGroupColorSync() {
    if (typeof groupColorUnsub === 'function') {
      try {
        groupColorUnsub();
      } catch {
        /* ignore */
      }
    }
    groupColorUnsub = null;
    groupColorInitialSyncDone = false;
  }

  // Colour for a user-named group: a colour the user chose (saved) wins; otherwise known
  // names keep a fixed colour and any other name is hashed to a fixed palette so each group
  // keeps a consistent, recognisable colour.
  function getReminderGroupColor(name) {
    const key = typeof name === 'string' ? name.trim() : '';
    const colors = loadReminderGroupColors();
    if (key) {
      const custom = colors[key];
      if (isHexColor(custom)) return custom.toLowerCase();
    }
    const columnKey = getReminderBoardColumnKey(key);
    const column = getReminderBoardColumnDefinition(columnKey);
    const columnCustom = column ? colors[column.category] : '';
    if (isHexColor(columnCustom)) return columnCustom.toLowerCase();
    const raw = key.toLowerCase();
    if (!raw) return '#6b7280';
    if (raw.includes('school')) return '#2563eb';
    if (raw.includes('footy') || raw.includes('football')) return '#7c3aed';
    if (raw.includes('home')) return '#15803d';
    if (raw.includes('wellbeing') || raw.includes('support')) return '#0d9488';
    const palette = ['#b45309', '#0d9488', '#be185d', '#0f766e', '#0891b2', '#a16207', '#dc2626', '#0284c7'];
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
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
    cleaned = stripExplicitReminderDateText(cleaned);
    const timeRange = parseReminderTimeRangeFromText(cleaned);
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

    let timeLabel = timeRange?.label || '';
    let timePattern = timeRange?.text ? new RegExp(timeRange.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    const meridiemMatch = cleaned.match(/\b(?:at\s*)?(\d{1,2})(?::?(\d{2}))\s*(am|pm)\b/i)
      || cleaned.match(/\b(?:at\s*)?(\d{1,2})\s*(am|pm)\b/i);

    if (!timeLabel && meridiemMatch) {
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

    if (!timeLabel) {
      const compactTimeMatch = cleaned.match(/\b(?:at\s*)?(\d{3,4})\b/);
      if (compactTimeMatch) {
        const digits = compactTimeMatch[1];
        const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
        const minuteDigits = digits.length === 3 ? digits.slice(1) : digits.slice(2);
        const hours = Number.parseInt(hourDigits, 10);
        const minutes = Number.parseInt(minuteDigits, 10);
        if (Number.isFinite(hours) && Number.isFinite(minutes) && hours <= 23 && minutes < 60) {
          timeLabel = formatDisplayTimeLabel(hours, minutes);
          timePattern = compactTimeMatch[0]
            ? new RegExp(compactTimeMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            : null;
        }
      }
    }

    if (dayPattern) {
      cleaned = cleaned.replace(dayPattern, ' ').trim();
    }
    if (timePattern) {
      cleaned = cleaned.replace(timePattern, ' ').trim();
    }
    cleaned = cleaned.replace(REMINDER_TIME_RANGE_STRIP_PATTERN, ' ').trim();

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

  function formatReminderCompletedLabel(value) {
    const completedDate = new Date(value);
    if (Number.isNaN(completedDate.getTime())) {
      return 'Completed';
    }

    const today = getReminderStartOfDay(new Date());
    const completedDay = getReminderStartOfDay(completedDate);
    const daysAgo = today && completedDay
      ? Math.round((today.getTime() - completedDay.getTime()) / 86400000)
      : null;
    if (daysAgo === 0) {
      return 'Completed today';
    }
    if (daysAgo === 1) {
      return 'Completed yesterday';
    }

    const locale = typeof navigator !== 'undefined' ? navigator.language || undefined : undefined;
    const options = completedDate.getFullYear() === new Date().getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
    return `Completed ${completedDate.toLocaleDateString(locale, options)}`;
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
    if (variant === 'mobile') {
      syncCategoryChoiceState(categoryInput?.value || DEFAULT_CATEGORY);
    }
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
    const completedRows = rows
      .filter((row) => row?.done)
      .sort((a, b) => (
        Number(b?.completedAt || b?.updatedAt || b?.createdAt || 0)
        - Number(a?.completedAt || a?.updatedAt || a?.createdAt || 0)
      ));
    const showingCompletedReminders = variant === 'mobile' && completedReminderSectionExpanded;
    syncCompletedRemindersMenu(completedRows.length);
    syncReminderHeader(activeRows.length, completedRows.length);

    if (variant === 'mobile') {
      mobileRemindersCache = rows.slice();
      rows = mobileRemindersCache.slice();
      updateMobileRemindersHeaderSubtitle();
    }

    const highlightToday = true;

    const hasAny = items.length > 0;
    const hasRows = showingCompletedReminders
      ? completedRows.length > 0
      : activeRows.length > 0;
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
        const description = showingCompletedReminders
          ? 'Finished reminders will appear here as a record of what you have done.'
          : (hasAny ? 'You are all caught up for now.' : emptyInitialText);
        if(sharedEmptyStateMount){
          sharedEmptyStateMount(emptyStateEl, {
            icon: showingCompletedReminders || hasAny ? 'sparkles' : 'bell',
            title: showingCompletedReminders
              ? 'Nothing completed yet'
              : (hasAny ? 'All clear' : 'Create your first cue'),
            description,
            action: showingCompletedReminders || hasAny
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
      listWrapper.classList.toggle('has-items', hasRows || variant === 'mobile');
    }

    if(!list){
      return;
    }

    if(!hasRows && variant !== 'mobile'){
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
        completedAt: reminder.completedAt || null,
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
      toggleBtn.className = 'task-toolbar-btn reminder-icon-btn reminder-complete-toggle';
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
          <rect x="4" y="4" width="16" height="16" rx="4.5" class="reminder-complete-toggle-box" />
          <path
            d="M8.25 12.4l2.7 2.8 4.8-5.2"
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
      deleteBtn.className = 'text-base-content/60 task-toolbar-btn reminder-icon-btn reminder-delete-btn';
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
        itemEl.classList.add('reminder-stream-row');
        const categoryGroup = getReminderCategoryGroup(catName);
        itemEl.classList.add(`reminder-cat-${categoryGroup.key}`);
        const categoryColor = getReminderGroupColor(catName);
        itemEl.style.setProperty('--reminder-category-color', categoryColor);
        itemEl.style.setProperty('--rcat-color', categoryColor);
        toggleBtn.classList.add('reminder-row-complete', 'reminder-stream-checkbox');

        const rowMain = document.createElement('div');
        rowMain.className = 'reminder-content reminder-stream-main reminder-row-main';

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

        const metaRow = document.createElement('div');
        metaRow.className = 'reminder-stream-meta';
        const dueChipText = summary.done
          ? formatReminderCompletedLabel(summary.completedAt || reminder.updatedAt || reminder.createdAt)
          : formatReminderDueChip(reminder, todayRange);
        if (dueChipText) {
          const dueChip = document.createElement('span');
          dueChip.className = 'reminder-stream-due';
          if (summary.done) {
            dueChip.classList.add('reminder-stream-completed-date');
          }
          const chipDueDate = summary.dueIso ? new Date(summary.dueIso) : null;
          const chipDueStart = getReminderStartOfDay(chipDueDate);
          const chipTodayStart = getReminderStartOfDay(todayRange?.start);
          const chipDiffDays = chipDueStart && chipTodayStart
            ? Math.round((chipDueStart.getTime() - chipTodayStart.getTime()) / 86400000)
            : null;
          if (typeof chipDiffDays === 'number' && chipDiffDays < 0) {
            dueChip.classList.add('reminder-stream-due--overdue');
          } else if (chipDiffDays === 0 || summary.pinToToday) {
            dueChip.classList.add('reminder-stream-due--today');
          }
          dueChip.textContent = dueChipText;
          metaRow.appendChild(dueChip);
        }

        if (metaRow.children.length) {
          rowMain.appendChild(metaRow);
        }

        if (summary.done) {
          itemEl.classList.add('reminder-row-completed');
        }

        const actionsBtn = document.createElement('button');
        actionsBtn.type = 'button';
        actionsBtn.className = 'reminder-stream-more reminder-icon-btn';
        actionsBtn.setAttribute('aria-label', `More actions for ${reminderTitle}`);
        actionsBtn.setAttribute('aria-haspopup', 'menu');
        actionsBtn.setAttribute('data-reminder-control', 'actions');
        actionsBtn.setAttribute('data-no-swipe', 'true');
        actionsBtn.innerHTML = `
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" focusable="false">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>`;
        bindReminderControlAction(actionsBtn, () => openReminderQuickActions(reminder));
        controls.append(actionsBtn);
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

        enableSwipeToDelete(itemEl, () => removeItem(summary.id));

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

    if (variant === 'mobile' && !showingCompletedReminders) {
      const columnItems = new Map(REMINDER_BOARD_COLUMNS.map((column) => [column.key, []]));
      const boardLabels = new Map(
        REMINDER_BOARD_COLUMNS.map((column) => [column.key, getReminderBoardLabel(column)]),
      );
      const otherItems = [];
      activeRows.forEach((reminder) => {
        const columnKey = getReminderBoardColumnKey(reminder.category);
        if (columnItems.has(columnKey)) {
          columnItems.get(columnKey).push(reminder);
        } else {
          otherItems.push(reminder);
        }
      });

      const board = document.createElement(listIsSemantic ? 'li' : 'div');
      board.className = 'reminder-category-board';
      board.setAttribute('aria-label', 'Reminder categories');
      if (list) {
        list.setAttribute(
          'aria-label',
          `${boardLabels.get('school')} and ${boardLabels.get('footy')} reminder board`,
        );
      }

      REMINDER_BOARD_COLUMNS.forEach((column) => {
        const reminders = columnItems.get(column.key) || [];
        const displayLabel = boardLabels.get(column.key) || column.label;
        const section = document.createElement('section');
        section.className = `reminder-category-column reminder-category-column--${column.key}`;
        section.dataset.reminderColumn = column.key;
        section.style.setProperty('--reminder-column-accent', getReminderGroupColor(column.category));
        section.setAttribute('aria-labelledby', `reminder-column-${column.key}-title`);

        const heading = document.createElement('header');
        heading.className = 'reminder-category-column-header';
        const headingCopy = document.createElement('div');
        headingCopy.className = 'reminder-category-column-heading-copy';
        const label = document.createElement('h3');
        label.id = `reminder-column-${column.key}-title`;
        label.className = 'reminder-category-column-title';
        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'reminder-category-column-rename';
        renameButton.dataset.action = 'rename-column';
        renameButton.dataset.columnKey = column.key;
        renameButton.textContent = displayLabel;
        renameButton.setAttribute('aria-label', `Rename ${displayLabel} column`);
        renameButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          beginReminderBoardLabelEdit(column, headingCopy, label);
        });
        label.appendChild(renameButton);
        const count = document.createElement('span');
        count.className = 'reminder-category-column-count';
        count.textContent = String(reminders.length);
        count.setAttribute('aria-label', `${reminders.length} cards`);
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'reminder-category-column-color';
        colorInput.dataset.action = 'change-column-colour';
        colorInput.dataset.columnKey = column.key;
        colorInput.value = getReminderGroupColor(column.category);
        colorInput.title = `Change ${displayLabel} colour`;
        colorInput.setAttribute('aria-label', `Change ${displayLabel} column colour`);
        colorInput.addEventListener('click', (event) => event.stopPropagation());
        colorInput.addEventListener('change', (event) => {
          event.stopPropagation();
          updateReminderGroupColor(column.category, colorInput.value, displayLabel);
        });
        headingCopy.append(label, count, colorInput);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'reminder-category-add-card';
        addButton.textContent = '+ Add';
        addButton.setAttribute('aria-label', `Add a ${displayLabel} reminder card`);
        addButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openNewReminderSheet(addButton);
          if (categoryInput) {
            categoryInput.value = column.category;
            syncCategoryChoiceState(column.category);
            categoryInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        heading.append(headingCopy, addButton);

        const sectionItems = document.createElement('ul');
        sectionItems.className = 'reminder-category-column-items';
        sectionItems.setAttribute('aria-label', `${displayLabel} reminder cards`);
        if (!reminders.length) {
          const emptyColumn = document.createElement('li');
          emptyColumn.className = 'reminder-category-column-empty';
          emptyColumn.textContent = 'No cards yet';
          sectionItems.appendChild(emptyColumn);
        } else {
          reminders.forEach((reminder) => {
            const catName = (reminder.category && String(reminder.category).trim()) || DEFAULT_CATEGORY;
            sectionItems.appendChild(buildReminderCard(reminder, catName, {
              elementTag: 'li',
              isMobile: true,
            }));
          });
        }

        section.append(heading, sectionItems);
        board.appendChild(section);
      });
      frag.appendChild(board);

      if (otherItems.length) {
        const otherSection = document.createElement(listIsSemantic ? 'li' : 'section');
        otherSection.className = 'reminder-other-cards';
        otherSection.dataset.reminderColumn = 'other';
        const heading = document.createElement('div');
        heading.className = 'reminder-other-cards-heading';
        const label = document.createElement('h3');
        label.className = 'reminder-other-cards-title';
        label.textContent = 'Other reminders';
        heading.appendChild(label);

        const sectionItems = document.createElement('ul');
        sectionItems.className = 'reminder-other-cards-items';
        otherItems.forEach((reminder) => {
          const catName = (reminder.category && String(reminder.category).trim()) || DEFAULT_CATEGORY;
          sectionItems.appendChild(buildReminderCard(reminder, catName, {
            elementTag: 'li',
            isMobile: true,
          }));
        });
        otherSection.append(heading, sectionItems);
        frag.appendChild(otherSection);
      }
    } else if (variant !== 'mobile') {
      activeRows.forEach((r) => {
        const catName = r.category || DEFAULT_CATEGORY;
        const itemEl = buildReminderCard(r, catName, {
          elementTag: listIsSemantic ? 'li' : 'div',
          isMobile: false,
        });
        frag.appendChild(itemEl);
      });
    }

    const shouldRenderCompletedSection = completedRows.length
      && (variant !== 'mobile' || completedReminderSectionExpanded);
    if (shouldRenderCompletedSection) {
      appendCompletedReminderSectionHeading(frag, {
        listIsSemantic,
        count: completedRows.length,
        expanded: completedReminderSectionExpanded,
        onToggle: () => {
          completedReminderSectionExpanded = !completedReminderSectionExpanded;
          if (variant === 'mobile' && !completedReminderSectionExpanded) {
            const activeButton = document.querySelector('[data-reminders-filter="active"]');
            if (activeButton instanceof HTMLElement) {
              try {
                activeButton.focus({ preventScroll: true });
              } catch {
                activeButton.focus();
              }
            }
          }
          render();
        },
        onClear: clearCompletedReminders,
      });

      if (completedReminderSectionExpanded) {
        completedRows.forEach((reminder) => {
          const catName = reminder.category || DEFAULT_CATEGORY;
          const itemEl = buildReminderCard(reminder, catName, {
            elementTag: listIsSemantic ? 'li' : 'div',
            isMobile: variant === 'mobile',
          });
          frag.appendChild(itemEl);
        });
      }
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
        hasExplicitTime: false,
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
      hasExplicitTime: parsed.hasExplicitTime === true,
    };
  }

  ({
    resetForm,
    loadForEdit,
    openEditReminderSheet,
    openNewReminderSheet,
    handleSaveAction,
  } = createReminderFormHandlers({
    title,
    date,
    time,
    details,
    categoryInput,
    plannerLessonInput,
    saveBtn,
    cancelEditBtn,
    DEFAULT_CATEGORY,
    getItems: () => items,
    getCurrentReminderMode: () => currentReminderMode,
    getEditingId: () => editingId,
    setReminderMode,
    syncEditingIdFromMode: () => {
      editingId = currentReminderMode === 'edit' ? currentReminderId : null;
    },
    setPriorityInputValue,
    getPriorityInputValue,
    normalizeCategory,
    normalizeRecurrence,
    normalizeIsoString,
    applyStoredDefaultsToInputs,
    syncCategoryChoiceState,
    setTitleError: setReminderTitleError,
    clearPlannerReminderContext,
    clearDetailSelection,
    applyDetailSelection,
    focusTitleField,
    dispatchCueEvent,
    closeCreateSheetIfOpen,
    emitActivity,
    toast,
    parseManualDueInput,
    parseQuickWhen,
    createReminderFromPayload,
    saveToFirebase,
    render,
    scheduleReminder,
    persistItems,
    emitReminderUpdates,
    setSuppressRenderMemoryEvent: (value) => {
      suppressRenderMemoryEvent = value;
    },
    isoToLocalDate,
    isoToLocalTime,
    scrollToTop: () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  }));

  if (typeof window !== 'undefined') {
    window.openNewReminderSheet = openNewReminderSheet;
    window.openEditReminderSheet = openEditReminderSheet;
  }

  saveBtn?.addEventListener('click', handleSaveAction);

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

  title?.addEventListener('input', () => setReminderTitleError(''));
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

  notifBtn?.addEventListener('click', async () => {
    if(!('Notification' in window)){
      toast('Notifications not supported');
      emitNotificationPermissionState('unavailable');
      return;
    }
    if(Notification.permission === 'granted'){
      const registeredDevice = await syncCurrentDevicePushRegistration();
      toast(registeredDevice
        ? 'Local reminders enabled. This device is registered for lock-screen alerts.'
        : 'Local reminders enabled. This device is not registered for lock-screen alerts.');
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
        const registeredDevice = await syncCurrentDevicePushRegistration();
        toast(registeredDevice
          ? 'Local reminders enabled. This device is registered for lock-screen alerts.'
          : 'Local reminders enabled. This device is not registered for lock-screen alerts.');
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
        emitNotificationPermissionState('unavailable');
      }
    } catch {
      toast('Notifications blocked');
      emitNotificationPermissionState('unavailable');
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
  // Legacy Today records are ownerless local data, so migrating them cannot
  // expose another signed-in account. Do this synchronously to keep the
  // one-time migration crash-safe; ordinary cached account data remains hidden
  // until auth resolves.
  runLegacyDailyTasksMigrationOnce();
  rescheduleAllReminders();
  render();
  persistItems();
  setupUrgentAttention();
  scheduleEmbeddingBackfill();

  if (variant === 'mobile') {
    window.setMobileRemindersFilter = (filter) => {
      if (filter === 'completed') {
        return showCompletedReminders();
      }
      if (filter === 'active' || filter === 'all') {
        return showActiveReminders();
      }
      return false;
    };
  }


  activeReminderControllerApi = {
    createReminderFromPayload,
    getReminders,
    setReminderCompleted,
    handleUrgentAction,
    openReminderById,
    render,
    setupReminderFirestoreSync,
    undoCapturedReminder,
  };

  return {
    createReminderFromPayload,
    cancelReminder,
    scheduleReminder,
    closeActiveNotifications,
    getActiveNotifications: () => activeNotifications,
    addNoteToReminder,
    buildRagContext,
    askAssistant,
    getReminders,
    setReminderCompleted,
    handleUrgentAction,
    openReminderById,
    undoCapturedReminder,
    __testing: {
      setItems(listItems = []) {
        items = normalizeReminderList(listItems);
        items = ensureOrderIndicesInitialized(items);
        sortItemsByOrder(items);
        render();
      },
      render,
      getItems: () => items.map(item => ({ ...item })),
      getScheduledReminders: () => Object.fromEntries(
        Object.entries(scheduledReminders).map(([id, entry]) => [id, { ...entry }])
      ),
      getScheduledReminderTombstones: () => Array.from(
        scheduledReminderTombstones.values(),
        (entry) => ({ ...entry })
      ),
      scheduleReminder,
      rescheduleAllReminders,
      refreshUrgentAttention,
      getUrgentState: (nowMs = Date.now()) => getUrgentReminderState(items, nowMs),
      migrateLegacyDailyTasks,
      persistItems,
      saveToFirebase,
      removeItem,
      clearCompletedReminders,
      parseInboxTimeQuery,
      buildRagContext,
      askAssistant,
    },
  };
}


export function createReminderFromPayload(payload = {}, options = {}) {
  return activeReminderControllerApi?.createReminderFromPayload?.(payload, options);
}

export function getReminders() {
  return activeReminderControllerApi?.getReminders?.() || [];
}

export function setReminderCompleted(id, completed = true) {
  return activeReminderControllerApi?.setReminderCompleted?.(id, completed) || null;
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

import { setAuthContext, startSignInFlow, startSignOutFlow } from './supabase-auth.js';

// Shared reminder logic used by both the mobile and desktop pages.
// This module wires up Firebase/Firestore and all reminder UI handlers.

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
const DEFAULT_CATEGORY = 'General';
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

// Provide a safe fallback that does not embed production credentials in the
// repository. Hosting environments are expected to inject their own Firebase
// configuration via the memoryCueFirebase API or a local module export.
const FALLBACK_FIREBASE_CONFIG = Object.freeze({});

let cachedFirebaseConfig = null;

function resolveFirebaseConfig() {
  if (cachedFirebaseConfig) {
    return { ...cachedFirebaseConfig };
  }
  const scope = getGlobalScope();
  const memoryCueApi = scope?.memoryCueFirebase;
  if (memoryCueApi && typeof memoryCueApi.getFirebaseConfig === 'function') {
    cachedFirebaseConfig = memoryCueApi.getFirebaseConfig();
    return { ...cachedFirebaseConfig };
  }
  if (typeof require === 'function') {
    try {
      const moduleValue = require('./firebase-config.js');
      if (moduleValue) {
        const getter = typeof moduleValue.getFirebaseConfig === 'function'
          ? moduleValue.getFirebaseConfig
          : typeof moduleValue.default?.getFirebaseConfig === 'function'
            ? moduleValue.default.getFirebaseConfig
            : null;
        if (getter) {
          cachedFirebaseConfig = getter();
          return { ...cachedFirebaseConfig };
        }
      }
    } catch {
      // ignore – likely running in the browser without require
    }
  }
  if (memoryCueApi && memoryCueApi.DEFAULT_FIREBASE_CONFIG) {
    cachedFirebaseConfig = { ...memoryCueApi.DEFAULT_FIREBASE_CONFIG };
    return { ...cachedFirebaseConfig };
  }
  cachedFirebaseConfig = { ...FALLBACK_FIREBASE_CONFIG };
  return { ...cachedFirebaseConfig };
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
      const existing = await navigator.serviceWorker.getRegistration();
      if (!existing) {
        await navigator.serviceWorker.register(resolveServiceWorkerUrl());
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
export async function initReminders(sel = {}) {
  const $ = (s) => (s ? document.querySelector(s) : null);
  const $$ = (s) => (s ? Array.from(document.querySelectorAll(s)) : []);

  // Elements
  const title = $(sel.titleSel);
  const date = $(sel.dateSel);
  const time = $(sel.timeSel);
  const details = $(sel.detailsSel);
  const priority = $(sel.prioritySel);
  const categoryInput = $(sel.categorySel);
  const saveBtn = $(sel.saveBtnSel);
  const cancelEditBtn = $(sel.cancelEditBtnSel);
  const list = $(sel.listSel);
  const googleSignInBtns = $$(sel.googleSignInBtnSel);
  const googleSignOutBtns = $$(sel.googleSignOutBtnSel);
  const statusEl = $(sel.statusSel);
  const syncStatus = $(sel.syncStatusSel);
  const SYNC_STATUS_LABELS = {
    online: 'Connected. Changes sync automatically.',
    offline: "Offline. Changes are saved on this device until you reconnect.",
  };
  const UNDO_DELETE_TIMEOUT_MS = 6000;
  let deleteUndoState = null;

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

  function renderSyncIndicator(state, message) {
    if (!syncStatus) return;

    const indicatorStates = ['online', 'offline', 'error'];
    indicatorStates.forEach((cls) => syncStatus.classList.remove(cls));
    if (indicatorStates.includes(state)) {
      syncStatus.classList.add(state);
    }

    syncStatus.dataset.state = state;

    const label = typeof message === 'string' ? message : SYNC_STATUS_LABELS[state] || '';
    const isDotState = state === 'online' || state === 'offline';

    if (isDotState) {
      syncStatus.textContent = '';
      syncStatus.dataset.compact = 'true';
      if (label) {
        syncStatus.setAttribute('aria-label', label);
        syncStatus.setAttribute('title', label);
      } else {
        syncStatus.removeAttribute('aria-label');
        syncStatus.removeAttribute('title');
      }
    } else {
      syncStatus.textContent = label;
      syncStatus.removeAttribute('data-compact');
      if (label) {
        syncStatus.setAttribute('aria-label', label);
        syncStatus.setAttribute('title', label);
      } else {
        syncStatus.removeAttribute('aria-label');
        syncStatus.removeAttribute('title');
      }
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
  const syncAllBtn = $(sel.syncAllBtnSel);
  const syncUrlInput = $(sel.syncUrlInputSel);
  const saveSettings = $(sel.saveSettingsSel);
  const testSync = $(sel.testSyncSel);
  const openSettingsBtns = $$(sel.openSettingsSel);
  const settingsSection = $(sel.settingsSectionSel);
  const emptyStateEl = $(sel.emptyStateSel);
  const listWrapper = $(sel.listWrapperSel);
  const categoryDatalist = $(sel.categoryOptionsSel);
  const variant = sel.variant || 'mobile';
  const autoWireAuthButtons =
    typeof sel.autoWireAuthButtons === 'boolean' ? sel.autoWireAuthButtons : variant !== 'desktop';

  const LAST_DEFAULTS_KEY = 'mc:lastDefaults';

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

  const quickInput =
    typeof document !== 'undefined' ? document.getElementById('quickAddInput') : null;
  const quickBtn =
    typeof document !== 'undefined' ? document.getElementById('quickAddSubmit') : null;
  const quickVoiceBtn =
    typeof document !== 'undefined' ? document.getElementById('quickAddVoiceBtn') : null;
  let stopQuickAddVoiceListening = null;

  function buildQuickReminder(titleText, dueOverride) {
    const now = Date.now();
    const d = loadLastDefaults();
    const dueIso = typeof dueOverride === 'string' && dueOverride ? dueOverride : null;

    return {
      id: uid(),
      title: (titleText || '').trim(),
      priority: d.priority || getPriorityInputValue(),
      category: normalizeCategory(d.category || categoryInput?.value || DEFAULT_CATEGORY),
      notes: '',
      done: false,
      createdAt: now,
      updatedAt: now,
      due: dueIso,
      pendingSync: !userId,
    };
  }

  async function quickAddNow() {
    if (!quickInput) return;
    if (typeof stopQuickAddVoiceListening === 'function') {
      try {
        stopQuickAddVoiceListening();
      } catch {}
    }
    const t = (quickInput.value || '').trim();
    if (!t) return;

    let quickDue = null;
    try {
      const parsedWhen = parseQuickWhen(t);
      if (parsedWhen && parsedWhen.time) {
        const isoCandidate = new Date(`${parsedWhen.date}T${parsedWhen.time}:00`).toISOString();
        quickDue = isoCandidate;
      }
    } catch {
      quickDue = null;
    }

    const entry = buildQuickReminder(t, quickDue);
    assignOrderIndexForNewItem(entry, { position: 'start' });
    items.unshift(entry);
    sortItemsByOrder(items);
    const rebalanced = maybeRebalanceOrderSpacing(items);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    if (rebalanced) {
      items.forEach((item) => saveToFirebase(item));
    } else {
      saveToFirebase(entry);
    }
    tryCalendarSync(entry);
    scheduleReminder(entry);
    rescheduleAllReminders();

    updateDefaultsFrom(entry);

    emitReminderUpdates();
    try {
      document.dispatchEvent(
        new CustomEvent('memoryCue:remindersUpdated', { detail: { items } }),
      );
    } catch {}

    emitActivity({ action: 'created', label: `Reminder added · ${entry.title}` });

    quickInput.value = '';
  }

  if (typeof window !== 'undefined') {
    window.memoryCueQuickAddNow = quickAddNow;
  }

  quickBtn?.addEventListener('click', () => {
    quickAddNow();
  });

  quickInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      quickAddNow();
    }
  });

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

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognitionCtor !== 'function') {
      quickVoiceBtn.setAttribute('disabled', 'true');
      quickVoiceBtn.setAttribute('aria-disabled', 'true');
      if (!quickVoiceBtn.getAttribute('title')) {
        quickVoiceBtn.title = 'Voice input is not supported in this browser.';
      }
      return;
    }

    let recognition = null;
    let listening = false;

    const updateListening = (state) => {
      listening = state;
      quickVoiceBtn.setAttribute('aria-pressed', state ? 'true' : 'false');
      quickVoiceBtn.dataset.listening = state ? 'true' : 'false';
      quickVoiceBtn.classList.toggle('is-listening', state);
    };

    const ensureRecognition = () => {
      if (recognition) {
        return recognition;
      }

      recognition = new SpeechRecognitionCtor();
      const lang =
        (typeof document !== 'undefined' &&
          document.documentElement &&
          document.documentElement.lang) ||
        (typeof navigator !== 'undefined' && navigator.language) ||
        'en-US';
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.addEventListener('result', (event) => {
        const transcript = event?.results?.[0]?.[0]?.transcript?.trim() || '';
        if (!transcript) {
          return;
        }
        quickInput.value = transcript;
        try {
          quickInput.focus({ preventScroll: true });
        } catch {
          quickInput.focus();
        }
        try {
          const length = quickInput.value.length;
          if (typeof quickInput.setSelectionRange === 'function') {
            quickInput.setSelectionRange(length, length);
          }
        } catch {}
      });

      const reset = () => {
        updateListening(false);
      };

      recognition.addEventListener('end', reset);
      recognition.addEventListener('error', reset);

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

    stopQuickAddVoiceListening = stopListening;

    quickVoiceBtn.addEventListener('click', () => {
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
        console.warn('Quick add voice error:', error);
        updateListening(false);
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', stopListening);
    }

    updateListening(false);
  }

  setupQuickAddVoiceSupport();

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
    document.dispatchEvent(new CustomEvent(name, { detail }));
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

  // Placeholder for Firebase modules loaded later
  let initializeApp, getFirestore, enableMultiTabIndexedDbPersistence,
    enableIndexedDbPersistence, doc, setDoc, deleteDoc, onSnapshot, collection,
    query, orderBy, serverTimestamp, getAuth, onAuthStateChanged,
    GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
    signOut;

  const firebaseDeps = sel.firebaseDeps;
  const importModule = typeof sel.importModule === 'function'
    ? sel.importModule
    : (specifier) => import(specifier);
  const globalScope = getGlobalScope();

  let firebaseModulesLoaded = false;
  let firebaseReady = false;
  let app = null;
  let db = null;
  let auth = null;

  // State
  let items = [];
  let suppressRenderMemoryEvent = false;
  let userId = null;
  let unsubscribe = null;
  let editingId = null;
  const reminderTimers = {};
  let scheduledReminders = {};

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
    renderSyncIndicator('offline');
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

  function loadOfflineRemindersFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
          const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : createdAt;
          const rawOrder = Number(entry.orderIndex);
          return {
            id: typeof entry.id === 'string' && entry.id ? entry.id : uid(),
            title: typeof entry.title === 'string' ? entry.title : '',
            priority: entry.priority || 'Medium',
            category: normalizeCategory(entry.category),
            notes: typeof entry.notes === 'string' ? entry.notes : '',
            done: !!entry.done,
            createdAt,
            updatedAt,
            due: typeof entry.due === 'string' && entry.due ? entry.due : null,
            pendingSync: !!entry.pendingSync,
            orderIndex: Number.isFinite(rawOrder) ? rawOrder : null,
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.warn('Failed to load offline reminders', error);
      return [];
    }
  }

  function persistOfflineReminders(reminders = []) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (!Array.isArray(reminders) || reminders.length === 0) {
        localStorage.removeItem(OFFLINE_REMINDERS_KEY);
        return;
      }
      const serialisable = reminders
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          priority: entry.priority || 'Medium',
          category: normalizeCategory(entry.category),
          notes: typeof entry.notes === 'string' ? entry.notes : '',
          done: !!entry.done,
          createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
          due: typeof entry.due === 'string' && entry.due ? entry.due : null,
          pendingSync: !!entry.pendingSync,
          orderIndex: Number.isFinite(entry.orderIndex) ? entry.orderIndex : null,
        }));
      localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(serialisable));
    } catch (error) {
      console.warn('Failed to persist offline reminders', error);
    }
  }

  function persistItems() {
    sortItemsByOrder(items);
    persistOfflineReminders(items);
  }

  function hydrateOfflineReminders() {
    items = ensureOrderIndicesInitialized(loadOfflineRemindersFromStorage());
  }

  hydrateOfflineReminders();

  async function migrateOfflineRemindersIfNeeded() {
    if (!userId) {
      items = loadOfflineRemindersFromStorage();
      return;
    }
    let offline = ensureOrderIndicesInitialized(loadOfflineRemindersFromStorage());
    if (!offline.length) {
      items = [];
      persistItems();
      return;
    }
    const unsynced = offline.filter((entry) => entry?.pendingSync);
    if (unsynced.length) {
      for (const entry of unsynced) {
        try {
          await saveToFirebase(entry);
          entry.pendingSync = false;
        } catch (error) {
          console.warn('Failed to sync offline reminder', error);
        }
      }
    }
    items = ensureOrderIndicesInitialized(
      offline.map((entry) => ({ ...entry, pendingSync: false }))
    );
    persistItems();
    render();
    rescheduleAllReminders();
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

  if (firebaseDeps) {
    ({ initializeApp, getFirestore, enableMultiTabIndexedDbPersistence, enableIndexedDbPersistence, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, serverTimestamp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } = firebaseDeps);
    firebaseModulesLoaded = true;
  } else {
    try {
      ({ initializeApp } = await importModule('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'));
      ({ getFirestore, enableMultiTabIndexedDbPersistence, enableIndexedDbPersistence, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, serverTimestamp } = await importModule('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js'));
      ({ getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } = await importModule('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'));
      firebaseModulesLoaded = true;
    } catch (err) {
      firebaseModulesLoaded = false;
      console.warn('Firebase modules failed to load:', err);
      toast('Firebase failed to load; notes available offline');
      recordFirebaseAvailability(false);
    }
  }

  if (firebaseModulesLoaded && typeof initializeApp === 'function' && typeof getFirestore === 'function' && typeof getAuth === 'function') {
    try {
      const firebaseConfig = resolveFirebaseConfig();
      if (!firebaseConfig || typeof firebaseConfig !== 'object') {
        throw new Error('Firebase config unavailable');
      }
      if (!firebaseConfig.projectId) {
        throw new Error('Firebase projectId missing from configuration');
      }
      console.info('[Firebase] Initialising Memory Cue', firebaseConfig.projectId);
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      firebaseReady = true;
      console.info('[Firebase] Firestore initialised', firebaseConfig.projectId);
      recordFirebaseAvailability(true);
    } catch (err) {
      firebaseReady = false;
      console.warn('Firebase initialization failed:', err);
      toast('Firebase failed to load; notes available offline');
      recordFirebaseAvailability(false);
    }
  } else if (!firebaseModulesLoaded) {
    firebaseReady = false;
  } else {
    firebaseReady = false;
    recordFirebaseAvailability(false);
  }

  if (firebaseReady && typeof enableMultiTabIndexedDbPersistence === 'function' && typeof enableIndexedDbPersistence === 'function') {
    // Firestore offline persistence: prefer multi-tab, fallback to single-tab
    // Runs once per app load, before any reads/writes/listeners.
    (function initFirestorePersistence() {
      const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
      if (!scope) {
        return;
      }
      // Guard against accidental double-initialization
      if (scope.__persistenceInitialized__) return;
      scope.__persistenceInitialized__ = true;

      (async () => {
        try {
          await enableMultiTabIndexedDbPersistence(db);
          console.info('[Firestore] Persistence: multi-tab enabled');
        } catch (err) {
          if (err && err.code === 'failed-precondition') {
            // Multi-tab not available (e.g., private mode or another constraint) -> try single-tab
            try {
              await enableIndexedDbPersistence(db);
              console.info('[Firestore] Persistence: single-tab fallback enabled');
            } catch (e2) {
              console.warn('[Firestore] Persistence disabled (single-tab fallback failed):', e2?.code || e2);
            }
          } else if (err && err.code === 'unimplemented') {
            // IndexedDB not supported in this browser/environment
            console.warn('[Firestore] Persistence not supported in this browser (online-only).');
          } else {
            console.warn('[Firestore] Persistence initialization error:', err?.code || err);
          }
        }
      })();
    })();
  }

  if (firebaseReady && typeof getAuth === 'function') {
    auth = getAuth(app);
  }

  // Formatting helpers
  function sanitizeLocaleTag(tag) {
    if (typeof tag !== 'string') return '';
    let value = tag.trim();
    if (!value) return '';
    const atIndex = value.indexOf('@');
    if (atIndex >= 0) {
      value = value.slice(0, atIndex);
    }
    value = value.replace(/_/g, '-');
    try {
      // Validate via Intl API – throws if the tag is invalid.
      new Intl.DateTimeFormat(value);
      return value;
    } catch {
      return '';
    }
  }

  const navigatorLocaleRaw = typeof navigator !== 'undefined' && navigator.language ? navigator.language : '';
  const navigatorLocale = sanitizeLocaleTag(navigatorLocaleRaw);
  let locale = navigatorLocale || 'en-US';
  let TZ = 'UTC';
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    if (resolved.timeZone) TZ = resolved.timeZone;
    if (!navigatorLocale && resolved.locale) locale = resolved.locale;
  } catch {
    // Intl not supported; fall back to defaults already set
  }
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const dateOnlyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const desktopDayLabelFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'long' });
  const desktopShortDateFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, month: 'short', day: 'numeric' });
  function formatDateLocal(d) {
    const parts = dateOnlyFmt.formatToParts(d);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const da = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${da}`;
  }
  function localDateTimeToISO(dstr, tstr) {
    const [Y, M, D] = dstr.split('-').map(n => parseInt(n, 10));
    const [h, m] = tstr.split(':').map(n => parseInt(n, 10));
    const dt = new Date();
    dt.setFullYear(Y, (M || 1) - 1, D || 1);
    dt.setHours(h || 0, m || 0, 0, 0);
    return dt.toISOString();
  }
  const datePartsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timePartsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  function isoToLocalDate(iso) {
    try {
      const d = new Date(iso);
      const parts = datePartsFmt.formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value || '0000';
      const m = parts.find(p => p.type === 'month')?.value || '00';
      const da = parts.find(p => p.type === 'day')?.value || '00';
      return `${y}-${m}-${da}`;
    } catch { return ''; }
  }
  function isoToLocalTime(iso) {
    try {
      const d = new Date(iso);
      const parts = timePartsFmt.formatToParts(d);
      const h = parts.find(p => p.type === 'hour')?.value?.padStart(2, '0') || '00';
      const m = parts.find(p => p.type === 'minute')?.value?.padStart(2, '0') || '00';
      return `${h}:${m}`;
    } catch { return ''; }
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function todayISO() { return formatDateLocal(new Date()); }
  function startOfWeek(d) { const n = new Date(d); const day = (n.getDay() + 6) % 7; n.setDate(n.getDate() - day); n.setHours(0,0,0,0); return n; }
  function endOfWeek(d) { const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate()+6); e.setHours(23,59,59,999); return e; }
  function priorityWeight(p) { return p === 'High' ? 3 : p === 'Medium' ? 2 : 1; }
  function compareRemindersForDisplay(a, b) {
    const aDone = a?.done ? 1 : 0;
    const bDone = b?.done ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDue = a?.due ? new Date(a.due).getTime() : Infinity;
    const bDue = b?.due ? new Date(b.due).getTime() : Infinity;
    if (aDue !== bDue) return aDue - bDue;
    const priorityDiff = priorityWeight(b?.priority) - priorityWeight(a?.priority);
    if (priorityDiff) return priorityDiff;
    return (b?.updatedAt || 0) - (a?.updatedAt || 0);
  }
  function smartCompare(a,b){ const pr = priorityWeight(b.priority)-priorityWeight(a.priority); if(pr) return pr; const at=+new Date(a.due||0), bt=+new Date(b.due||0); if(at!==bt) return at-bt; return (a.updatedAt||0)>(b.updatedAt||0)?-1:1; }
  function fmtDayDate(iso){ if(!iso) return '—'; try{ const d = new Date(iso+'T00:00:00'); return dayFmt.format(d); }catch{ return iso; } }
  function fmtTime(d){ return timeFmt.format(d); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function notesToHtml(note){
    if(!note) return '';
    const safe = escapeHtml(note).replace(/\r\n/g,'\n');
    return safe.replace(/\n/g,'<br>');
  }
  function toast(msg){
    if(!statusEl) return;
    clearUndoDeleteState();
    statusEl.dataset.statusKind = 'toast';
    statusEl.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>{
      if(statusEl && statusEl.dataset.statusKind === 'toast'){
        statusEl.textContent='';
        delete statusEl.dataset.statusKind;
      }
    },2500);
  }
  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  // Quick when parser (subset from mobile)
  function parseQuickWhen(text){
    text = String(text||'').toLowerCase();
    let when = { date: todayISO(), time: '' };
    const getNextDayOfWeek = (dayIndex)=>{ const today=new Date(); const current=today.getDay(); const days=(dayIndex-current+7)%7; const target=new Date(today); target.setDate(today.getDate()+(days===0?7:days)); return target; };
    const getThisDayOfWeek = (dayIndex)=>{ const today=new Date(); const current=today.getDay(); const days=(dayIndex-current+7)%7; const target=new Date(today); target.setDate(today.getDate()+days); return target; };
    const dayNames={ 'sunday':0,'sun':0,'monday':1,'mon':1,'tuesday':2,'tue':2,'tues':2,'wednesday':3,'wed':3,'thursday':4,'thu':4,'thur':4,'thurs':4,'friday':5,'fri':5,'saturday':6,'sat':6 };
    const monthNames={ 'january':0,'jan':0,'february':1,'feb':1,'march':2,'mar':2,'april':3,'apr':3,'may':4,'june':5,'jun':5,'july':6,'jul':6,'august':7,'aug':7,'september':8,'sep':8,'sept':8,'october':9,'oct':9,'november':10,'nov':10,'december':11,'dec':11 };
    if(/\btomorrow\b/.test(text)){ const d=new Date(); d.setDate(d.getDate()+1); when.date=formatDateLocal(d); }
    else if(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getNextDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getThisDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getNextDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\bin\s+(\d+)\s+days?\b/.test(text)){ const m=text.match(/\bin\s+(\d+)\s+days?\b/); const days=parseInt(m[1],10); const d=new Date(); d.setDate(d.getDate()+days); when.date=formatDateLocal(d); }
    else if(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.test(text)){ const m=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); const day=parseInt(m[1],10); const month=parseInt(m[2],10)-1; const year=m[3]?parseInt(m[3],10):(new Date()).getFullYear(); const d=new Date(year,month,day); when.date=formatDateLocal(d); }
    else {
      for (const [name, idx] of Object.entries(monthNames)) {
        const re = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
        if (re.test(text)) {
          const m = text.match(re);
          const day = parseInt(m[1], 10);
          const year = new Date().getFullYear();
          const d = new Date(year, idx, day);
          when.date = formatDateLocal(d);
          break;
        }
      }
    }
    const timeMatch = text.match(/(\d{1,2})(?:[:\.](\d{2}))?\s*(am|pm)?/);
    if(timeMatch){
      let h=parseInt(timeMatch[1],10);
      let m=timeMatch[2]?parseInt(timeMatch[2],10):0;
      const ap=timeMatch[3];
      if(ap){ if(ap==='pm' && h<12) h+=12; if(ap==='am' && h===12) h=0; }
      when.time=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    return when;
  }

  // Auth
  const authReady = firebaseReady && auth && typeof GoogleAuthProvider === 'function';

  setAuthContext({
    authReady,
    auth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    toast,
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

  if (authReady && typeof getRedirectResult === 'function') {
    getRedirectResult(auth).catch(()=>{});
  }

  if (shouldWireAuthButtons && googleSignOutBtns.length) {
    googleSignOutBtns.forEach((btn) => wireAuthButton(btn, startSignOutFlow));
  }

  if (authReady && typeof onAuthStateChanged === 'function') {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        userId = user.uid;
        renderSyncIndicator('online');
        googleSignInBtns.forEach((btn) => btn.classList.add('hidden'));
        googleSignOutBtns.forEach((btn) => btn.classList.remove('hidden'));
        if(googleUserName) googleUserName.textContent = user.displayName || user.email || '';
        setupFirestoreSync();
        await migrateOfflineRemindersIfNeeded();
      } else {
        applySignedOutState();
      }
    });
  } else {
    applySignedOutState();
  }

  // Firestore sync
  function setupFirestoreSync(){
    if(!firebaseReady || !db || typeof collection !== 'function' || typeof query !== 'function' || typeof orderBy !== 'function' || typeof onSnapshot !== 'function'){
      return;
    }
    if(!userId){
      hydrateOfflineReminders();
      render();
      persistItems();
      rescheduleAllReminders();
      return;
    }
    if(unsubscribe) unsubscribe();
    const userCollection = collection(db, 'users', userId, 'reminders');
    const qSnap = query(userCollection, orderBy('updatedAt','desc'));
    unsubscribe = onSnapshot(qSnap, (snapshot) => {
      const remoteItems = [];
      snapshot.forEach((d)=>{
        const data = d.data();
        const orderValue = Number(data.orderIndex);
        remoteItems.push({ id: d.id, title: data.title, priority: data.priority, notes: data.notes || '', done: !!data.done, due: data.due || null, category: normalizeCategory(data.category), createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: data.updatedAt?.toMillis?.() || 0, pendingSync: false, orderIndex: Number.isFinite(orderValue) ? orderValue : null });
      });
      items = ensureOrderIndicesInitialized(remoteItems);
      render();
      persistItems();
      rescheduleAllReminders();
    }, (error)=>{
      console.error('Firestore sync error:', error);
      if(syncStatus){
        renderSyncIndicator('error', 'Sync Error');
      }
    });
  }

  async function saveToFirebase(item){
    if(!firebaseReady || !userId || !db || typeof doc !== 'function' || typeof setDoc !== 'function' || typeof serverTimestamp !== 'function') return;
    try {
      await setDoc(doc(db, 'users', userId, 'reminders', item.id), {
        ownerUid: userId,
        title: item.title, priority: item.priority, notes: item.notes || '', done: !!item.done, due: item.due || null,
        category: item.category || DEFAULT_CATEGORY,
        orderIndex: Number.isFinite(item.orderIndex) ? item.orderIndex : null,
        createdAt: item.createdAt ? new Date(item.createdAt) : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('Save failed:', error); toast('Save queued (offline)');
    }
  }
  async function deleteFromFirebase(id){ if(!firebaseReady || !userId || !db || typeof doc !== 'function' || typeof deleteDoc !== 'function') return; try { await deleteDoc(doc(db,'users',userId,'reminders',id)); } catch { toast('Delete queued (offline)'); } }

  async function tryCalendarSync(task){ const url=(localStorage.getItem('syncUrl')||'').trim(); if(!url) return; const payload={ id: task.id, title: task.title, dueIso: task.due || null, priority: task.priority || 'Medium', category: task.category || DEFAULT_CATEGORY, done: !!task.done, source: 'memory-cue-mobile' }; try{ await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }catch{} }

  function resetForm(){
    if(title) title.value='';
    if(date) date.value='';
    if(time) time.value='';
    if(details) details.value='';
    setPriorityInputValue('Medium');
    if(categoryInput) categoryInput.value = DEFAULT_CATEGORY;
    applyStoredDefaultsToInputs();
    editingId=null;
    if(saveBtn) saveBtn.textContent='Save Cue';
    cancelEditBtn?.classList.add('hidden');
  }
  function loadForEdit(id){ const it = items.find(x=>x.id===id); if(!it) return; if(title) title.value=it.title||''; if(date&&time){ if(it.due){ date.value=isoToLocalDate(it.due); time.value=isoToLocalTime(it.due); } else { date.value=''; time.value=''; } } setPriorityInputValue(it?.priority || 'Medium'); if(categoryInput) categoryInput.value = normalizeCategory(it.category); if(details) details.value = typeof it.notes === 'string' ? it.notes : ''; editingId=id; if(saveBtn) saveBtn.textContent='Update'; cancelEditBtn?.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); title?.focus(); dispatchCueEvent('cue:open', { mode: 'edit' }); }

  function addItem(obj){
    const nowMs = Date.now();
    const note = obj.notes == null ? '' : (typeof obj.notes === 'string' ? obj.notes.trim() : String(obj.notes).trim());
    const categoryValue = normalizeCategory(obj.category ?? (categoryInput ? categoryInput.value : ''));
    const item = {
      id: uid(),
      title: obj.title.trim(),
      priority: obj.priority||'Medium',
      category: categoryValue,
      notes: note,
      done:false,
      createdAt: nowMs,
      updatedAt: nowMs,
      due: obj.due || null,
      pendingSync: !userId,
    };
    assignOrderIndexForNewItem(item, { position: 'start' });
    items = [item, ...items];
    sortItemsByOrder(items);
    const rebalanced = maybeRebalanceOrderSpacing(items);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    updateDefaultsFrom(item);
    if (rebalanced) {
      items.forEach((entry) => saveToFirebase(entry));
    } else {
      saveToFirebase(item);
    }
    tryCalendarSync(item);
    scheduleReminder(item);
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    closeCreateSheetIfOpen();
    emitActivity({
      action: 'created',
      label: `Reminder added · ${item.title}`,
    });
    return item;
  }
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
    it.done = !it.done;
    it.updatedAt = Date.now();
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
  function undoDelete(tokenId){
    if(!deleteUndoState || deleteUndoState.tokenId !== tokenId) return;
    const { item, index } = deleteUndoState;
    if(!item) {
      clearUndoDeleteState(tokenId);
      return;
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
    tryCalendarSync(item);
    emitReminderUpdates();
    dispatchCueEvent('memoryCue:remindersUpdated', { items });
    emitActivity({
      action: 'restored',
      label: `Reminder restored · ${item.title}`,
    });
    toast('Reminder restored');
  }
  function removeItem(id){
    const index = items.findIndex(x=>x.id===id);
    const removed = index >= 0 ? items.splice(index,1)[0] : null;
    render();
    persistItems();
    deleteFromFirebase(id);
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
        priority: entry.priority || 'Medium',
        category: entry.category || DEFAULT_CATEGORY,
        notes: typeof entry.notes === 'string' ? entry.notes : '',
        body: buildReminderNotificationBody(entry),
        urlPath: entry.urlPath || reminderLandingPath,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        notifiedAt: Number.isFinite(entry.notifiedAt) ? entry.notifiedAt : null,
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
    if(!Trigger || !item?.due) return false;
    const dueTime = new Date(item.due).getTime();
    if(!Number.isFinite(dueTime)) return false;
    const registration = await ensureServiceWorkerRegistration();
    if(!registration) return false;
    await cancelTriggerNotification(item.id, registration);
    const data = {
      id: item.id,
      title: item.title,
      due: item.due,
      priority: item.priority || 'Medium',
      category: item.category || DEFAULT_CATEGORY,
      body,
      urlPath: reminderLandingPath,
    };
    const body = buildReminderNotificationBody(item);
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
    if(!item.due || item.done){ cancelReminder(item.id); return; }
    const previous = scheduledReminders[item.id] || {};
    const stored = {
      id:item.id,
      title:item.title,
      due:item.due,
      category: item.category || DEFAULT_CATEGORY,
      priority: item.priority || 'Medium',
      notes: typeof item.notes === 'string' ? item.notes : '',
      body: buildReminderNotificationBody(item),
      urlPath: reminderLandingPath,
      updatedAt: Date.now(),
      viaTrigger: !!previous.viaTrigger,
      notifiedAt: (() => {
        const prevDue = typeof previous.due === 'string' ? previous.due : null;
        const prevNotified = Number.isFinite(previous.notifiedAt) ? previous.notifiedAt : null;
        return prevDue === item.due ? prevNotified : null;
      })(),
    };
    scheduledReminders[item.id]=stored;
    saveScheduled();
    if(reminderTimers[item.id]){ clearTimeout(reminderTimers[item.id]); delete reminderTimers[item.id]; }
    if(!('Notification' in window) || Notification.permission!=='granted'){ return; }
    const dueTime = new Date(item.due).getTime();
    if(!Number.isFinite(dueTime)) return;
    const delay = dueTime - Date.now();
    if(delay<=0){
      if(scheduledReminders[item.id]?.viaTrigger){
        clearReminderState(item.id,{ closeNotification:false });
        return;
      }
      showReminder(item);
      clearReminderState(item.id,{ closeNotification:false });
      return;
    }
    const useTriggers = supportsNotificationTriggers();
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
      showReminder(item);
      clearReminderState(item.id,{ closeNotification:false });
    }, delay);
  }
  function rescheduleAllReminders(){ Object.values(scheduledReminders).forEach(it=>scheduleReminder({ ...it, category: normalizeCategory(it?.category) })); }

  function formatDesktopDue(item){
    if(!item?.due) return 'No due date';
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

  function render(){
    const now = new Date();
    const localNow = new Date(now);
    const t0 = new Date(localNow); t0.setHours(0,0,0,0);
    const t1 = new Date(localNow); t1.setHours(23,59,59,999);

    clearDragHighlights();
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

    let rows = items.slice();

    sortItemsByOrder(rows);

    const highlightToday = true;

    const hasAny = items.length > 0;
    const hasRows = rows.length > 0;

    const pendingNotificationIds = (() => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return new Set();
      }
      const entries = Object.values(scheduledReminders || {}).filter((entry) => entry && typeof entry === 'object' && entry.id);
      return new Set(entries.map((entry) => entry.id));
    })();

    if(emptyStateEl){
      if(!hasRows){
        const description = hasAny ? 'No reminders to show right now.' : emptyInitialText;
        if(sharedEmptyStateMount){
          sharedEmptyStateMount(emptyStateEl, {
            icon: hasAny ? 'sparkles' : 'bell',
            title: hasAny ? 'Nothing to display' : 'Create your first cue',
            description,
            action: hasAny
              ? undefined
              : `<button type="button" class="${sharedEmptyStateCtaClasses}" data-trigger="open-cue">Create reminder</button>`
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
      return;
    }

    list.classList.remove('hidden');
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    const listIsSemantic = list.tagName === 'UL' || list.tagName === 'OL';

    const shouldGroupCategories = true;

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
      const summary = {
        id: reminder.id,
        title: reminder.title,
        dueIso: reminder.due || null,
        priority: reminder.priority || 'Medium',
        category: catName,
        done: Boolean(reminder.done),
      };

      const itemEl = document.createElement(elementTag);
      itemEl.className =
        'task-item reminder-card desktop-task-card grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-base-200 bg-base-100 p-4 text-sm shadow-sm transition hover:border-base-300 hover:bg-base-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';
      if (isMobile) {
        itemEl.classList.add('w-full');
      }
      itemEl.dataset.id = summary.id;
      itemEl.dataset.category = summary.category;
      itemEl.dataset.title = summary.title;
      itemEl.dataset.priority = summary.priority;
      itemEl.dataset.done = String(summary.done);
      if (summary.dueIso) {
        itemEl.dataset.due = summary.dueIso;
      } else {
        delete itemEl.dataset.due;
      }
      itemEl.dataset.reminder = JSON.stringify(summary);
      itemEl.dataset.orderIndex = Number.isFinite(reminder.orderIndex) ? String(reminder.orderIndex) : '';
      itemEl.dataset.reminderItem = 'true';
      itemEl.dataset.compact = 'true';
      itemEl.classList.add('reminder-draggable');
      itemEl.setAttribute('draggable', 'true');
      itemEl.setAttribute('role', 'button');
      itemEl.tabIndex = 0;
      itemEl.setAttribute('aria-label', `Edit reminder: ${reminder.title}`);

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

      const content = document.createElement('div');
      content.className = 'flex min-w-0 flex-col gap-2';

      const titleEl = document.createElement('p');
      titleEl.className = 'text-sm font-bold leading-snug text-base-content';
      titleEl.classList.add('desktop-reminder-title');
      if (!isMobile) {
        titleEl.classList.add('sm:text-[0.95rem]');
      }
      if (summary.done) {
        titleEl.classList.add('line-through', 'text-base-content/60');
      }
      titleEl.textContent = reminder.title;
      content.appendChild(titleEl);

      const metaRow = document.createElement('div');
      metaRow.className = 'desktop-reminder-meta flex flex-wrap items-center gap-1 text-xs text-base-content/70';

      const dueLabelRaw = formatDesktopDue(reminder);
      const dueLabel = dueLabelRaw && dueLabelRaw !== 'No due date' ? dueLabelRaw : '';
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

      const controls = document.createElement('div');
      controls.className = 'flex items-start gap-1';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-ghost btn-circle btn-xs';
      if (summary.done) {
        toggleBtn.classList.add('text-base-content/60');
        toggleBtn.innerHTML = '<span aria-hidden="true">↺</span>';
        toggleBtn.setAttribute('aria-label', `Mark reminder as active: ${reminder.title}`);
      } else {
        toggleBtn.classList.add('text-success');
        toggleBtn.innerHTML = '<span aria-hidden="true">✓</span>';
        toggleBtn.setAttribute('aria-label', `Mark reminder as done: ${reminder.title}`);
      }
      toggleBtn.setAttribute('aria-pressed', summary.done ? 'true' : 'false');
      toggleBtn.setAttribute('data-reminder-control', 'toggle');
      toggleBtn.setAttribute('data-no-swipe', 'true');
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleDone(summary.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-ghost btn-circle btn-xs text-error';
      deleteBtn.innerHTML = '<span aria-hidden="true">🗑️</span>';
      deleteBtn.setAttribute('aria-label', `Delete reminder: ${reminder.title}`);
      deleteBtn.setAttribute('data-reminder-control', 'delete');
      deleteBtn.setAttribute('data-no-swipe', 'true');
      deleteBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeItem(summary.id);
      });

      controls.append(toggleBtn, deleteBtn);
      itemEl.appendChild(controls);

      const openReminder = () => loadForEdit(summary.id);
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

    const createMobileItem = (r, catName) => buildReminderCard(r, catName, { elementTag: 'div', isMobile: true });

    if (variant !== 'desktop' && !shouldGroupCategories) {
      rows.forEach((r) => {
        const catName = r.category || DEFAULT_CATEGORY;
        frag.appendChild(createMobileItem(r, catName));
      });
      list.appendChild(frag);
      return;
    }

    const grouped = new Map();
    rows.forEach(r => {
      const catName = r.category || DEFAULT_CATEGORY;
      if (!grouped.has(catName)) {
        grouped.set(catName, []);
      }
      grouped.get(catName).push(r);
    });
    const sortedGroups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
    let firstGroup = true;
    sortedGroups.forEach(([catName, catRows]) => {
      if (catName !== DEFAULT_CATEGORY) {
        const headingWrapper = document.createElement(listIsSemantic ? 'li' : 'div');
        headingWrapper.dataset.categoryHeading = catName;
        if (listIsSemantic) {
          headingWrapper.setAttribute('role', 'presentation');
          headingWrapper.style.listStyle = 'none';
        }
        headingWrapper.className = variant === 'desktop'
          ? 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500'
          : 'text-xs font-semibold uppercase text-gray-500 dark:text-gray-500';
        if (!firstGroup) {
          headingWrapper.style.marginTop = variant === 'desktop' ? '1.25rem' : '1rem';
        }
        const headingInner = document.createElement('div');
        headingInner.setAttribute('role', 'heading');
        headingInner.setAttribute('aria-level', '3');
        headingInner.className = variant === 'desktop'
          ? 'flex items-center justify-between gap-2 px-1 text-gray-500 dark:text-gray-500'
          : 'flex items-center justify-between gap-2 text-gray-500 dark:text-gray-500';
        const headingLabel = document.createElement('span');
        headingLabel.textContent = catName;
        const headingCount = document.createElement('span');
        headingCount.className = 'text-[0.7rem] font-medium text-gray-500 dark:text-gray-500';
        headingCount.textContent = `${catRows.length} ${catRows.length === 1 ? 'item' : 'items'}`;
        headingInner.append(headingLabel, headingCount);
        headingWrapper.appendChild(headingInner);
        frag.appendChild(headingWrapper);
      }

      catRows.forEach(r => {
        if(variant === 'desktop'){
          const itemEl = buildReminderCard(r, catName, {
            elementTag: listIsSemantic ? 'li' : 'div',
            isMobile: false,
          });
          frag.appendChild(itemEl);
          return;
        }

        frag.appendChild(createMobileItem(r, catName));
      });

      firstGroup = false;
    });
    list.appendChild(frag);
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

  function handleSaveAction(){
    // Debug: log when save handler invoked to help trace click issues
    try { console.log('handleSaveAction invoked', { editingId, title: title?.value }); } catch (e) {}

    if(editingId){
      const it = items.find(x=>x.id===editingId);
      if(!it){ resetForm(); return; }
      const tNew = title.value.trim(); if(!tNew){ toast('Add a reminder title'); return; }
      let due=null;
      if(date.value || time.value){ const d=(date.value || todayISO()); const tm=(time.value || '09:00'); due = localDateTimeToISO(d,tm); }
      else { const p=parseQuickWhen(tNew); if(p.time){ due = new Date(`${p.date}T${p.time}:00`).toISOString(); } }
      it.title = tNew;
      const nextPriority = getPriorityInputValue();
      it.priority = nextPriority;
      setPriorityInputValue(nextPriority);
      if(categoryInput){ it.category = normalizeCategory(categoryInput.value); }
      it.due = due;
      if(details){ it.notes = details.value.trim(); }
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
    const t = title.value.trim(); if(!t){ toast('Add a reminder title'); return; }
    const noteText = details ? details.value.trim() : '';
    let due=null;
    if(date.value || time.value){ const d=(date.value || todayISO()); const tm=(time.value || '09:00'); due = localDateTimeToISO(d,tm); }
    else { const p=parseQuickWhen(t); if(p.time){ due=new Date(`${p.date}T${p.time}:00`).toISOString(); } }
    addItem({ title:t, priority:getPriorityInputValue(), category: categoryInput ? categoryInput.value : '', due, notes: noteText });
    title.value=''; time.value=''; if(details) details.value='';
    dispatchCueEvent('cue:close', { reason: 'created' });
  }

  title?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleSaveAction(); });

  function updateDateFeedback(){ if(!title || !dateFeedback) return; const text = title.value.trim(); if(!text){ dateFeedback.style.display='none'; return; } try{ const parsed=parseQuickWhen(text); const today=todayISO(); if(parsed.date !== today || parsed.time){ let feedback=''; if(parsed.date !== today){ const dateObj = new Date(parsed.date+'T00:00:00'); feedback+=`📅 ${fmtDayDate(parsed.date)}`; } if(parsed.time){ feedback+=`${feedback ? ' ' : ''}🕐 ${parsed.time}`; } if(feedback){ dateFeedback.textContent=`Parsed: ${feedback}`; dateFeedback.style.display='block'; } else { dateFeedback.style.display='none'; } } else { dateFeedback.style.display='none'; } } catch { dateFeedback.style.display='none'; } }

  title?.addEventListener('input', debounce(updateDateFeedback,300));
  cancelEditBtn?.addEventListener('click', () => { resetForm(); toast('Edit cancelled'); dispatchCueEvent('cue:close', { reason: 'edit-cancelled' }); });
  document.addEventListener('cue:cancelled', () => { resetForm(); });
  document.addEventListener('cue:prepare', () => { resetForm(); });
  window.addEventListener('load', ()=> title?.focus());
  copyMtlBtn?.addEventListener('click', () => {
    const lines = items.filter(x=>!x.done).map(x=>{ const datePart = x.due ? fmtDayDate(x.due.slice(0,10)) : ''; const timePart = x.due ? new Date(x.due).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit', timeZone: TZ}) : ''; const pieces = [ 'mtl '+x.title, x.due ? `Due Date: ${datePart}` : '', x.due ? `Time: ${timePart}` : '', `Status: Not started` ].filter(Boolean); return pieces.join('\n'); });
    if(lines.length===0){ toast('No active tasks to copy'); return; }
    navigator.clipboard.writeText(lines.join('\n\n')).then(()=>toast('Copied for Master Task List')).catch(()=>toast('Copy failed'));
    closeMenu();
  });

  importFile?.addEventListener('change', () => {
    const f = importFile.files[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const importedItems = JSON.parse(String(rd.result) || '[]').slice(0,500);
        const newlyAdded = [];
        importedItems.forEach(item => {
          const entry = {
            ...item,
            id: uid(),
            category: normalizeCategory(item.category),
            pendingSync: !userId,
            orderIndex: null,
          };
          assignOrderIndexForNewItem(entry, { position: 'start' });
          items = [entry, ...items];
          newlyAdded.push(entry);
        });
        sortItemsByOrder(items);
        const rebalanced = maybeRebalanceOrderSpacing(items);
        render();
        persistItems();
        if (rebalanced) {
          items.forEach((entry) => saveToFirebase(entry));
        } else {
          newlyAdded.forEach((entry) => saveToFirebase(entry));
        }
        toast('Import successful');
      } catch { toast('Invalid JSON'); }
    };
    rd.readAsText(f); importFile.value='';
    closeMenu();
  });
  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(items,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='memory-cue-mobile.json'; a.click(); URL.revokeObjectURL(url); closeMenu();
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
      const perm = await Notification.requestPermission();
      if(perm==='granted'){
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

  setupDragAndDrop();
  rescheduleAllReminders();
  render();
  persistItems();
  return {
    cancelReminder,
    scheduleReminder,
    closeActiveNotifications,
    getActiveNotifications: () => activeNotifications,
    addNoteToReminder,
    __testing: {
      setItems(listItems = []) {
        items = Array.isArray(listItems)
          ? listItems.map(item => ({ ...item, category: normalizeCategory(item?.category) }))
          : [];
        items = ensureOrderIndicesInitialized(items);
        sortItemsByOrder(items);
        render();
      },
      render,
      getItems: () => items.map(item => ({ ...item })),
    },
  };
}

// Shared reminder logic used by both the mobile and desktop pages.
// This module wires up Firebase/Firestore and all reminder UI handlers.

const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const activeNotifications = new Map();
let notificationCleanupBound = false;
const SERVICE_WORKER_SCRIPT = 'service-worker.js';
let serviceWorkerReadyPromise = null;
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

let voiceInputInitialized = false;

function initVoiceInput() {
  if (voiceInputInitialized) {
    return;
  }
  voiceInputInitialized = true;

  if (typeof document === 'undefined') {
    return;
  }

  const mic = document.getElementById('voiceAddBtn');
  const status = document.getElementById('voiceStatus');
  const input =
    document.getElementById('quickAddInput') || document.getElementById('reminderText');

  if (!mic || !input) {
    return;
  }

  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    if (status) {
      status.textContent = 'Speech not supported';
      status.hidden = false;
    }
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recog = new SpeechRecognition();
  recog.lang = 'en-US';
  recog.interimResults = false;
  recog.maxAlternatives = 1;

  mic.addEventListener('click', () => {
    try {
      if (status) {
        status.hidden = false;
        status.textContent = 'Listening…';
      }
      recog.start();
    } catch (err) {
      console.warn('Speech recognition error:', err);
    }
  });

  document.getElementById('quickAddMic')?.addEventListener('click', () => {
    mic?.click();
  });

  recog.addEventListener('result', (e) => {
    const transcript = e.results?.[0]?.[0]?.transcript?.trim() || '';
    if (!transcript) {
      if (status) {
        status.hidden = true;
      }
      return;
    }
    input.value = transcript;
    if (status) {
      status.textContent = 'Added: ' + transcript;
      status.hidden = true;
    }
    if (input && input.id === 'quickAddInput') {
      try {
        const globalQuickAdd =
          typeof window !== 'undefined' ? window.memoryCueQuickAddNow : null;
        globalQuickAdd?.();
      } catch {}
    }
  });

  recog.addEventListener('end', () => {
    if (status) {
      status.hidden = true;
    }
  });
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
  const q = $(sel.qSel);
  const title = $(sel.titleSel);
  const date = $(sel.dateSel);
  const time = $(sel.timeSel);
  const details = $(sel.detailsSel);
  const priority = $(sel.prioritySel);
  const categoryInput = $(sel.categorySel);
  const saveBtn = $(sel.saveBtnSel);
  const cancelEditBtn = $(sel.cancelEditBtnSel);
  const list = $(sel.listSel);
  const googleSignInBtn = $(sel.googleSignInBtnSel);
  const googleSignOutBtn = $(sel.googleSignOutBtnSel);
  const statusEl = $(sel.statusSel);
  const syncStatus = $(sel.syncStatusSel);
  const notesEl = $(sel.notesSel);
  const saveNotesBtn = $(sel.saveNotesBtnSel);
  const loadNotesBtn = $(sel.loadNotesBtnSel);
  const sortSel = $(sel.sortSel);
  const filterBtns = $$(sel.filterBtnsSel);
  const normaliseFilterValue = (value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  const filterLookup = new Map();
  filterBtns.forEach((btn) => {
    const raw = btn?.getAttribute('data-filter');
    const normalised = normaliseFilterValue(raw);
    if (normalised && !filterLookup.has(normalised)) {
      filterLookup.set(normalised, raw);
    }
  });
  const providedDefaultFilter = normaliseFilterValue(sel.defaultFilter);
  const resolvedDefaultFilter =
    (providedDefaultFilter && filterLookup.get(providedDefaultFilter)) ||
    (providedDefaultFilter && !filterLookup.size ? providedDefaultFilter : null);
  const countTodayEl = $(sel.countTodaySel);
  const countWeekEl = $(sel.countWeekSel);
  const countOverdueEl = $(sel.countOverdueSel);
  const countTotalEl = $(sel.countTotalSel);
  const countCompletedEl = $(sel.countCompletedSel);
  const googleAvatar = $(sel.googleAvatarSel);
  const googleUserName = $(sel.googleUserNameSel);
  const dateFeedback = $(sel.dateFeedbackSel);
  const addQuickBtn = $(sel.addQuickBtnSel);
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
  const openSettings = $(sel.openSettingsSel);
  const settingsSection = $(sel.settingsSectionSel);
  const emptyStateEl = $(sel.emptyStateSel);
  const listWrapper = $(sel.listWrapperSel);
  const categoryFilter = $(sel.categoryFilterSel);
  const categoryDatalist = $(sel.categoryOptionsSel);
  const variant = sel.variant || 'mobile';

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
  const quickMic =
    typeof document !== 'undefined' ? document.getElementById('quickAddMic') : null;
  const quickBtn =
    typeof document !== 'undefined' ? document.getElementById('quickAddSubmit') : null;

  function buildQuickReminder(titleText) {
    const now = Date.now();
    const d = loadLastDefaults();
    const dueIso = null;

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
    const t = (quickInput.value || '').trim();
    if (!t) return;

    const entry = buildQuickReminder(t);
    items.unshift(entry);
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    saveToFirebase(entry);
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
        } else if ((e.key === 'm' || e.key === 'M') && e.altKey) {
          e.preventDefault();
          quickMic?.click();
        }
      });
    }
  }

  try {
    if (variant === 'mobile' && typeof document !== 'undefined') {
      // Minimal Mode is the default; let the UI toggle control add/remove 'show-full'
      // (no body class added here)
    }
  } catch {
    /* ignore environments without DOM */
  }
  const emptyInitialText = sel.emptyStateInitialText || 'Create your first reminder to keep important tasks in view.';
  const emptyFilteredText = sel.emptyStateFilteredText || 'No reminders match the current filter. Adjust your filters or add a new cue.';
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
    if (sheet && sheet.classList?.contains('open')) {
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
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

  bindNotificationCleanupHandlers();
  initVoiceInput();

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
  let filter = resolvedDefaultFilter || (filterBtns.length ? 'today' : 'all');
  let categoryFilterValue = categoryFilter?.value || 'all';
  let sortKey = 'smart';
  let suppressRenderMemoryEvent = false;
  let userId = null;
  let unsubscribe = null;
  let editingId = null;
  const reminderTimers = {};
  let scheduledReminders = {};

  function applySignedOutState() {
    userId = null;
    syncStatus?.classList.remove('online', 'error');
    if (syncStatus) {
      syncStatus.classList.add('offline');
      syncStatus.textContent = 'Offline';
    }
    googleSignInBtn?.classList.remove('hidden');
    googleSignOutBtn?.classList.add('hidden');
    if (googleAvatar) {
      googleAvatar.classList.add('hidden');
      googleAvatar.src = '';
    }
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
        }));
      localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(serialisable));
    } catch (error) {
      console.warn('Failed to persist offline reminders', error);
    }
  }

  function persistItems() {
    persistOfflineReminders(items);
  }

  function hydrateOfflineReminders() {
    items = loadOfflineRemindersFromStorage();
  }

  hydrateOfflineReminders();

  async function migrateOfflineRemindersIfNeeded() {
    if (!userId) {
      items = loadOfflineRemindersFromStorage();
      return;
    }
    const offline = loadOfflineRemindersFromStorage();
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
    items = offline.map((entry) => ({ ...entry, pendingSync: false }));
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
      }
    });
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
      const firebaseConfig = {
        apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
        authDomain: 'memory-cue-app.firebaseapp.com',
        projectId: 'memory-cue-app',
        storageBucket: 'memory-cue-app.firebasestorage.app',
        messagingSenderId: '751284466633',
        appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
        measurementId: 'G-R0V4M7VCE6'
      };
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      firebaseReady = true;
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
  function smartCompare(a,b){ const pr = priorityWeight(b.priority)-priorityWeight(a.priority); if(pr) return pr; const at=+new Date(a.due||0), bt=+new Date(b.due||0); if(at!==bt) return at-bt; return (a.updatedAt||0)>(b.updatedAt||0)?-1:1; }
  function fmtDayDate(iso){ if(!iso) return '—'; try{ const d = new Date(iso+'T00:00:00'); return dayFmt.format(d); }catch{ return iso; } }
  function fmtTime(d){ return timeFmt.format(d); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function notesToHtml(note){
    if(!note) return '';
    const safe = escapeHtml(note).replace(/\r\n/g,'\n');
    return safe.replace(/\n/g,'<br>');
  }
  function toast(msg){ if(!statusEl) return; statusEl.textContent = msg; clearTimeout(toast._t); toast._t = setTimeout(()=> statusEl.textContent='',2500); }
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

  googleSignInBtn?.addEventListener('click', async () => {
    if (!authReady || typeof signInWithPopup !== 'function' || typeof signInWithRedirect !== 'function') {
      toast('Sign-in unavailable offline');
      return;
    }
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } catch (error) { try { await signInWithRedirect(auth, provider); } catch { toast('Google sign-in failed'); } }
  });

  if (authReady && typeof getRedirectResult === 'function') {
    getRedirectResult(auth).catch(()=>{});
  }

  googleSignOutBtn?.addEventListener('click', async () => {
    if (!authReady || typeof signOut !== 'function') {
      toast('Sign-out unavailable offline');
      return;
    }
    try { await signOut(auth); toast('Signed out'); } catch { toast('Sign-out failed'); }
  });

  if (authReady && typeof onAuthStateChanged === 'function') {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        userId = user.uid;
        syncStatus?.classList.remove('offline','error');
        syncStatus?.classList.add('online');
        if(syncStatus) syncStatus.textContent = 'Online';
        googleSignInBtn?.classList.add('hidden');
        googleSignOutBtn?.classList.remove('hidden');
        if(googleAvatar){ if(user.photoURL){ googleAvatar.classList.remove('hidden'); googleAvatar.src=user.photoURL; } else { googleAvatar.classList.add('hidden'); googleAvatar.src=''; } }
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
        remoteItems.push({ id: d.id, title: data.title, priority: data.priority, notes: data.notes || '', done: !!data.done, due: data.due || null, category: normalizeCategory(data.category), createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: data.updatedAt?.toMillis?.() || 0, pendingSync: false });
      });
      items = remoteItems;
      render();
      persistItems();
      rescheduleAllReminders();
    }, (error)=>{
      console.error('Firestore sync error:', error);
      if(syncStatus){ syncStatus.textContent='Sync Error'; syncStatus.className='sync-status error'; }
    });
  }

  async function saveToFirebase(item){
    if(!firebaseReady || !userId || !db || typeof doc !== 'function' || typeof setDoc !== 'function' || typeof serverTimestamp !== 'function') return;
    try {
      await setDoc(doc(db, 'users', userId, 'reminders', item.id), {
        title: item.title, priority: item.priority, notes: item.notes || '', done: !!item.done, due: item.due || null,
        category: item.category || DEFAULT_CATEGORY,
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
  function loadForEdit(id){ const it = items.find(x=>x.id===id); if(!it) return; if(title) title.value=it.title||''; if(date&&time){ if(it.due){ date.value=isoToLocalDate(it.due); time.value=isoToLocalTime(it.due); } else { date.value=''; time.value=''; } } setPriorityInputValue(it?.priority || 'Medium'); if(categoryInput) categoryInput.value = normalizeCategory(it.category); if(details) details.value = typeof it.notes === 'string' ? it.notes : ''; editingId=id; if(saveBtn) saveBtn.textContent='Update Cue'; cancelEditBtn?.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); title?.focus(); dispatchCueEvent('cue:open', { mode: 'edit' }); }

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
    items = [item, ...items];
    suppressRenderMemoryEvent = true;
    render();
    persistItems();
    updateDefaultsFrom(item);
    saveToFirebase(item);
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
  function removeItem(id){
    const removed = items.find(x=>x.id===id);
    items = items.filter(x=>x.id!==id);
    render();
    persistItems();
    deleteFromFirebase(id);
    cancelReminder(id);
    if(removed){
      emitActivity({
        action: 'deleted',
        label: `Reminder removed · ${removed.title}`,
      });
    } else {
      emitActivity({ action: 'deleted', label: 'Reminder removed' });
    }
  }

  function saveScheduled(){ localStorage.setItem('scheduledReminders', JSON.stringify(scheduledReminders)); }
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
      const notification = new Notification(item.title,{ body:'Due now', tag:item.id });
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
      urlPath: reminderLandingPath,
    };
    const primaryNote = typeof item.notes === 'string'
      ? item.notes.split(/\r?\n/).find(line => line.trim()) || ''
      : '';
    let body = primaryNote || 'Due now';
    try {
      const dueDate = new Date(item.due);
      if(!Number.isNaN(dueDate.getTime())){
        const timeLabel = fmtTime(dueDate);
        if(timeLabel){
          body = primaryNote ? `${primaryNote} • ${timeLabel}` : `Due ${timeLabel}`;
        }
      }
    } catch {}
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
    const stored = { id:item.id, title:item.title, due:item.due, category: item.category || DEFAULT_CATEGORY };
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

  const desktopPriorityClasses = {
    High: 'bg-rose-400/80 dark:bg-rose-300/80',
    Medium: 'bg-amber-400/80 dark:bg-amber-300/80',
    Low: 'bg-emerald-400/80 dark:bg-emerald-300/80'
  };

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
    const w0 = startOfWeek(localNow);
    const w1 = endOfWeek(localNow);
    const todays = items.filter(x => {
      if (!x.due || x.done) return false;
      const due = new Date(x.due);
      return due >= t0 && due <= t1;
    });
    const weeks  = items.filter(x => {
      if (!x.due || x.done) return false;
      const due = new Date(x.due);
      return due >= w0 && due <= w1;
    });
    const overdueCount = items.filter(x => {
      if (x.done || !x.due) return false;
      return new Date(x.due) < localNow;
    }).length;
    const completedCount = items.filter(x => x.done).length;
    if(countTodayEl) countTodayEl.textContent = String(todays.length);
    if(countWeekEl) countWeekEl.textContent = String(weeks.length);
    if(countOverdueEl) countOverdueEl.textContent = String(overdueCount);
    if(countTotalEl) countTotalEl.textContent = String(items.length);
    if(countCompletedEl) countCompletedEl.textContent = String(completedCount);

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

    if (categoryFilter) {
      const previous = categoryFilterValue;
      categoryFilter.replaceChildren();
      const allOption = document.createElement('option');
      allOption.value = 'all';
      allOption.textContent = 'All categories';
      categoryFilter.appendChild(allOption);
      allCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
      });
      if (previous !== 'all' && !allCategories.includes(previous)) {
        categoryFilterValue = 'all';
      }
      categoryFilter.value = categoryFilterValue;
    }

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
    const queryStr = q?.value.trim().toLowerCase() || '';
    if(queryStr){ rows = rows.filter(r => r.title.toLowerCase().includes(queryStr) || (r.notes||'').toLowerCase().includes(queryStr) || (r.category||'').toLowerCase().includes(queryStr)); }
    if(categoryFilterValue && categoryFilterValue !== 'all'){
      rows = rows.filter(r => normalizeCategory(r.category) === categoryFilterValue);
    }
    rows = rows.filter(r => {
      if(filter==='done') return r.done;
      if(filter==='overdue') return !r.done && r.due && new Date(r.due) < localNow;
      if(filter==='today'){
        if(!r.due) return true;
        const dueLocal = new Date(r.due);
        return dueLocal >= t0 && dueLocal <= t1;
      }
      return true;
    });
    rows.sort((a,b)=>{
      if(sortKey==='time') return (+new Date(a.due||0))-(+new Date(b.due||0));
      if(sortKey==='priority') return priorityWeight(b.priority)-priorityWeight(a.priority);
      return smartCompare(a,b);
    });

    filterBtns.forEach(btn => {
      const isActive = btn.getAttribute('data-filter')===filter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      if (!btn.classList.contains('btn-ghost')) {
        btn.classList.toggle('bg-gray-900', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('border-gray-900', isActive);
        btn.classList.toggle('dark:bg-gray-100', isActive);
        btn.classList.toggle('dark:text-gray-900', isActive);
        btn.classList.toggle('dark:border-gray-100', isActive);
        btn.classList.toggle('bg-white', !isActive);
        btn.classList.toggle('text-gray-600', !isActive);
        btn.classList.toggle('border-gray-200', !isActive);
        btn.classList.toggle('dark:bg-gray-800', !isActive);
        btn.classList.toggle('dark:text-gray-400', !isActive);
        btn.classList.toggle('dark:border-gray-700', !isActive);
      }
    });

    const hasAny = items.length > 0;
    const hasRows = rows.length > 0;

    if(emptyStateEl){
      if(!hasAny){
        if(sharedEmptyStateMount){
          sharedEmptyStateMount(emptyStateEl, {
            icon: 'bell',
            title: 'Create your first cue',
            description: emptyInitialText,
            action: `<button type="button" class="${sharedEmptyStateCtaClasses}" data-trigger="open-cue">Create reminder</button>`
          });
        } else {
          emptyStateEl.textContent = emptyInitialText;
        }
        emptyStateEl.classList.remove('hidden');
      } else if(!hasRows){
        if(sharedEmptyStateMount){
          sharedEmptyStateMount(emptyStateEl, {
            icon: 'sparkles',
            title: 'No reminders match this view',
            description: emptyFilteredText
          });
        } else {
          emptyStateEl.textContent = emptyFilteredText;
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

    const isMinimalLayout = (() => {
      if (typeof document === 'undefined') return false;
      const body = document.body;
      if (!body || typeof body.classList?.contains !== 'function') return false;
      return !body.classList.contains('show-full');
    })();
    const shouldGroupCategories =
      variant === 'desktop' ||
      !isMinimalLayout ||
      (!listIsSemantic && variant !== 'desktop');

    const createMobileItem = (r, catName) => {
    const div = document.createElement('div');
    div.className = 'task-item' + (r.done ? ' completed' : '');
    div.dataset.category = catName;
    // Make rows discoverable by other modules (e.g., Today view)
    div.dataset.reminder = '1';
    div.dataset.id = r.id;
    if (r.due) div.dataset.due = r.due; // ISO string
      const dueTxt = r.due ? `${fmtTime(new Date(r.due))} • ${fmtDayDate(r.due.slice(0,10))}` : 'No due date';
      const priorityClass = `priority-${(r.priority || 'Medium').toLowerCase()}`;
      const notesHtml = r.notes ? `<div class="task-notes">${notesToHtml(r.notes)}</div>` : '';
      div.innerHTML = `
        <input type="checkbox" ${r.done ? 'checked' : ''} aria-label="Mark complete" />
        <div class="task-content">
          <div class="task-title">${escapeHtml(r.title)}</div>
          <div class="task-meta">
            <div class="task-meta-row" style="gap:8px; flex-wrap:wrap;">
              <span>${dueTxt}</span>
              <span class="priority-badge ${priorityClass}">${r.priority}</span>
              <span class="priority-badge" style="background:rgba(56,189,248,.14);color:#0284c7;border-color:rgba(56,189,248,.26);">${escapeHtml(catName)}</span>
            </div>
          </div>
          ${notesHtml}
        </div>
        <div class="task-actions">
          <button class="btn-ghost" data-edit type="button">Edit</button>
          <button class="btn-ghost" data-del type="button">Del</button>
        </div>`;
      div.querySelector('input').addEventListener('change', () => toggleDone(r.id));
      div.querySelector('[data-edit]').addEventListener('click', () => loadForEdit(r.id));
      div.querySelector('[data-del]').addEventListener('click', () => removeItem(r.id));
      return div;
    };

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

      catRows.forEach(r => {
        if(variant === 'desktop'){
          const itemEl = document.createElement(listIsSemantic ? 'li' : 'div');
          itemEl.dataset.id = r.id;
          itemEl.dataset.category = catName;
          itemEl.className = 'card bg-base-100 shadow-xl w-full lg:w-96 border border-base-200';
          const dueLabel = formatDesktopDue(r);
          const priorityIndicatorClass = desktopPriorityClasses[r.priority] || desktopPriorityClasses.Medium;
          const titleClasses = r.done ? 'line-through text-base-content/50' : 'text-base-content';
          const statusLabel = r.done ? 'Completed' : 'Active';
          const priorityBadgeClass = r.priority === 'High'
            ? 'badge badge-outline border-error text-error'
            : r.priority === 'Medium'
              ? 'badge badge-outline border-warning text-warning'
              : 'badge badge-outline border-success text-success';
          const statusBadgeClass = r.done
            ? 'badge badge-outline border-success text-success'
            : 'badge badge-outline border-neutral text-neutral';
          const toggleClasses = r.done
            ? 'btn btn-sm btn-outline'
            : 'btn btn-sm btn-outline btn-success';
          const notesHtml = r.notes ? `<p class="text-sm leading-relaxed text-base-content/70">${notesToHtml(r.notes)}</p>` : '';
          itemEl.innerHTML = `
    <div class="card-body gap-4">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-3">
          <h3 class="card-title text-base sm:text-lg font-semibold ${titleClasses}">${escapeHtml(r.title)}</h3>
          <div class="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-base-content/70">
            <span class="badge badge-outline gap-2 text-[0.7rem] sm:text-xs">
              <span class="h-2 w-2 rounded-full bg-gray-400"></span>
              ${escapeHtml(dueLabel)}
            </span>
            <span class="badge badge-outline border-primary text-primary gap-2 text-[0.7rem] sm:text-xs">
              <span class="h-2 w-2 rounded-full bg-sky-400"></span>
              ${escapeHtml(catName)}
            </span>
            <span class="${priorityBadgeClass} gap-2 text-[0.7rem] sm:text-xs">
              <span class="h-2 w-2 rounded-full ${priorityIndicatorClass}"></span>
              ${escapeHtml(r.priority)} priority
            </span>
            <span class="${statusBadgeClass} text-[0.7rem] sm:text-xs">${statusLabel}</span>
          </div>
        </div>
        <div class="dropdown dropdown-end">
          <button type="button" tabindex="0" class="btn btn-ghost btn-circle btn-sm" aria-label="Cue actions">
            <span class="text-xl leading-none">⋮</span>
          </button>
          <ul tabindex="0" class="dropdown-content menu menu-sm p-2 shadow bg-base-100 rounded-box w-40">
            <li><button type="button" data-action="edit" class="justify-start">Edit</button></li>
            <li><button type="button" data-action="delete" class="justify-start text-error">Delete</button></li>
          </ul>
        </div>
      </div>
      ${notesHtml}
      <div class="card-actions justify-end">
        <button data-action="toggle" type="button" class="${toggleClasses}">${r.done ? 'Mark active' : 'Mark done'}</button>
      </div>
    </div>`;
          itemEl.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleDone(r.id));
          itemEl.querySelector('[data-action="edit"]').addEventListener('click', () => loadForEdit(r.id));
          itemEl.querySelector('[data-action="delete"]').addEventListener('click', () => removeItem(r.id));
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

  openSettings?.addEventListener('click', () => {
    const willShow = settingsSection?.classList.contains('hidden');
    settingsSection?.classList.toggle('hidden');
    if(willShow) settingsSection?.scrollIntoView({ behavior:'smooth', block:'start' });
    closeMenu();
  });
  document.addEventListener('DOMContentLoaded', () => { settingsSection?.classList.add('hidden'); });

  function handleSaveAction(){
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
  addQuickBtn?.addEventListener('click', () => { if (!title.value.trim()) { title.focus(); toast('Type something like "email parents at 4pm"'); return; } handleSaveAction(); });
  q?.addEventListener('input', debounce(render,150));
  sortSel?.addEventListener('change', ()=>{ sortKey = sortSel.value; render(); });
  categoryFilter?.addEventListener('change', () => { categoryFilterValue = categoryFilter.value || 'all'; render(); });
  filterBtns.forEach(b => b.addEventListener('click', ()=>{ filter = b.getAttribute('data-filter'); render(); }));

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
        importedItems.forEach(item => { item.id = uid(); item.category = normalizeCategory(item.category); item.pendingSync = !userId; items=[item,...items]; saveToFirebase(item); });
        render();
        persistItems();
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
      if(supportsNotificationTriggers()) ensureServiceWorkerRegistration();
      rescheduleAllReminders();
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if(perm==='granted'){
        toast('Notifications enabled');
        if(supportsNotificationTriggers()) ensureServiceWorkerRegistration();
        rescheduleAllReminders();
      } else {
        toast('Notifications blocked');
      }
    } catch {
      toast('Notifications blocked');
    }
  });

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
        render();
      },
      render,
      getItems: () => items.map(item => ({ ...item })),
    },
  };
}

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function transformEsm(source) {
  return source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
}

function loadReminderFormHandlers() {
  const filePath = path.resolve(__dirname, '../../../src/reminders/reminderFormHandlers.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = transformEsm(source);
  source += '\nmodule.exports = { createReminderFormHandlers };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

function createReminderMocks(overrides = {}) {
  const reminderState = {
    reminders: [],
  };

  const readStorageArray = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const writeStorageArray = (key, value) => {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  };

  const getFolders = overrides.getFolders || (() => readStorageArray('memoryCueFolders'));
  const saveFolders = overrides.saveFolders || ((folders) => {
    writeStorageArray('memoryCueFolders', folders);
    return folders;
  });
  const loadAllNotes = overrides.loadAllNotes || (() => readStorageArray('memoryCueNotes'));
  const saveAllNotes = overrides.saveAllNotes || ((notes) => {
    writeStorageArray('memoryCueNotes', notes);
    return notes;
  });
  const getInboxEntries = overrides.getInboxEntries || (() => readStorageArray('memoryCueInbox'));
  const saveInboxEntry = overrides.saveInboxEntry || ((entry) => {
    const entries = getInboxEntries();
    entries.unshift({
      id: entry?.id || `entry-${Date.now()}`,
      createdAt: Number.isFinite(entry?.createdAt) ? entry.createdAt : Date.now(),
      processed: entry?.processed ?? false,
      ...entry,
    });
    writeStorageArray('memoryCueInbox', entries);
    return entry;
  });

  const normalizeReminderRecordHelper = overrides.normalizeReminderRecordHelper || ((reminder = {}, options = {}) => {
    const createId = typeof options.createId === 'function' ? options.createId : () => `${Date.now()}`;
    const normalizeCategory = typeof options.normalizeCategory === 'function'
      ? options.normalizeCategory
      : (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'General');
    const nextId = reminder.id || options.fallbackId || createId();
    const createdAt = Number.isFinite(reminder.createdAt) ? Number(reminder.createdAt) : Date.now();
    const updatedAt = Number.isFinite(reminder.updatedAt) ? Number(reminder.updatedAt) : createdAt;
    const done = Boolean(reminder.done ?? reminder.completed);
    return {
      id: nextId,
      title: typeof reminder.title === 'string' ? reminder.title.trim() : '',
      notes: typeof reminder.notes === 'string' ? reminder.notes : '',
      due: typeof reminder.due === 'string' ? reminder.due : '',
      priority: typeof reminder.priority === 'string' && reminder.priority.trim() ? reminder.priority : 'Medium',
      category: normalizeCategory(reminder.category),
      done,
      completed: done,
      createdAt,
      updatedAt,
      pendingSync: Boolean(reminder.pendingSync),
      notify: reminder.notify !== false,
      recurrence: reminder.recurrence || null,
      semanticEmbedding: Array.isArray(reminder.semanticEmbedding) ? reminder.semanticEmbedding : null,
      order: Number.isFinite(reminder.order) ? Number(reminder.order) : null,
    };
  });

  const normalizeReminderListHelper = overrides.normalizeReminderListHelper || ((list = [], options = {}) => (
    Array.isArray(list) ? list.map((item) => normalizeReminderRecordHelper(item, options)) : []
  ));

  const saveNote = overrides.saveNote || ((payload = {}) => {
    const notes = loadAllNotes();
    const nextNote = {
      id: payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: payload.title || '',
      bodyHtml: payload.bodyHtml || '',
      bodyText: payload.bodyText || payload.bodyHtml || '',
      folderId: payload.folderId || 'unsorted',
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: payload.updatedAt || new Date().toISOString(),
      metadata: payload.metadata || null,
    };
    notes.unshift(nextNote);
    saveAllNotes(notes);
    return nextNote;
  });

  const createReminder = overrides.createReminder || ((payload = {}, options = {}) => {
    const now = Date.now();
    const reminder = {
      id: payload.id || `reminder-${now}`,
      title: typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim()
        : typeof payload.text === 'string'
          ? payload.text.trim()
          : '',
      notes: typeof payload.notes === 'string' ? payload.notes : '',
      due: typeof payload.dueAt === 'string' && payload.dueAt.trim()
        ? payload.dueAt.trim()
        : typeof payload.due === 'string'
          ? payload.due.trim()
          : '',
      dueAt: typeof payload.dueAt === 'string' && payload.dueAt.trim()
        ? payload.dueAt.trim()
        : typeof payload.due === 'string'
          ? payload.due.trim()
          : '',
      notifyAt: typeof payload.notifyAt === 'string' ? payload.notifyAt : '',
      priority: typeof payload.priority === 'string' && payload.priority.trim() ? payload.priority.trim() : 'Medium',
      category: typeof payload.category === 'string' && payload.category.trim() ? payload.category.trim() : 'General',
      createdAt: now,
      updatedAt: now,
      completed: false,
      done: false,
      pendingSync: false,
    };
    if (typeof options.onCreated === 'function') {
      options.onCreated(reminder);
    }
    return reminder;
  });

  return {
    initAuth: overrides.initAuth || (async () => ({})),
    startSignInFlow: overrides.startSignInFlow || (() => Promise.resolve()),
    startSignOutFlow: overrides.startSignOutFlow || (() => Promise.resolve()),
    saveReminder: overrides.saveReminder || (async () => true),
    removeReminder: overrides.removeReminder || (async () => true),
    syncNotes: overrides.syncNotes || (async () => []),
    captureInput: overrides.captureInput || (async (text, source = 'quick-add') => {
      const entry = {
        id: `entry-${Date.now()}`,
        text: String(text || '').trim(),
        source,
        parsedType: 'unknown',
        createdAt: Date.now(),
        metadata: {},
      };
      saveInboxEntry(entry);
      return entry;
    }),
    getInboxEntries,
    saveInboxEntry,
    createReminderViaService: overrides.createReminderViaService || ((payload = {}) => payload),
    setReminderCreationHandler: overrides.setReminderCreationHandler || (() => {}),
    buildReminderPayload: overrides.buildReminderPayload || ((payload = {}) => payload),
    getFolders,
    loadAllNotes,
    saveAllNotes,
    saveFolders,
    setRemoteSyncHandler: overrides.setRemoteSyncHandler || (() => {}),
    createStoredReminder: overrides.createStoredReminder || ((reminder) => {
      reminderState.reminders.push(reminder);
      return reminder;
    }),
    updateStoredReminder: overrides.updateStoredReminder || ((id, updates = {}) => {
      reminderState.reminders = reminderState.reminders.map((item) => (item.id === id ? { ...item, ...updates } : item));
    }),
    deleteStoredReminder: overrides.deleteStoredReminder || ((id) => {
      reminderState.reminders = reminderState.reminders.filter((item) => item.id !== id);
    }),
    getStoredReminders: overrides.getStoredReminders || (() => reminderState.reminders.slice()),
    setStoredReminders: overrides.setStoredReminders || ((list = []) => {
      reminderState.reminders = Array.isArray(list) ? list.slice() : [];
      return reminderState.reminders;
    }),
    loadReminders: overrides.loadReminders || (() => reminderState.reminders.slice()),
    reminderDataService: overrides.reminderDataService || {
      createReminder,
      updateReminder: () => null,
      deleteReminder: () => null,
      completeReminder: () => null,
    },
    renderReminderList: overrides.renderReminderList || ((renderFn, ...args) => renderFn(...args)),
    renderReminderItem: overrides.renderReminderItem || ((renderFn, ...args) => renderFn(...args)),
    renderTodayReminders: overrides.renderTodayReminders || ((renderFn, ...args) => renderFn(...args)),
    setupSyncHandlers: overrides.setupSyncHandlers || (() => ({})),
    loadRemindersFromFirestore: overrides.loadRemindersFromFirestore || (async () => []),
    saveReminderToFirestore: overrides.saveReminderToFirestore || (async () => true),
    listenForReminderUpdates: overrides.listenForReminderUpdates || (() => () => {}),
    setupNotificationHandlers: overrides.setupNotificationHandlers || (() => ({})),
    startReminderScheduler: overrides.startReminderScheduler || (() => {}),
    sendReminderNotification: overrides.sendReminderNotification || (() => {}),
    requestNotificationPermission: overrides.requestNotificationPermission || (async () => 'granted'),
    saveNote,
    generateEmbedding: overrides.generateEmbedding || (async () => null),
    buildRagAssistantRequest: overrides.buildRagAssistantRequest || (() => ({})),
    requestAssistantChat: overrides.requestAssistantChat || (async () => ({ reply: '' })),
    replaceInboxEntries: overrides.replaceInboxEntries || (() => {}),
    getMessages: overrides.getMessages || (() => []),
    replaceMessages: overrides.replaceMessages || (() => {}),
    createReminderFirestoreSync: overrides.createReminderFirestoreSync || (() => ({
      setupReminderFirestoreSync: async ({ currentUnsubscribe = null, hydrateOfflineReminders = () => {} } = {}) => {
        hydrateOfflineReminders();
        return currentUnsubscribe;
      },
    })),
    createReminderFormHandlers: overrides.createReminderFormHandlers || loadReminderFormHandlers().createReminderFormHandlers,
    registerReminderPushDevice: overrides.registerReminderPushDevice || (async () => null),
    syncReminderToOtherDevices: overrides.syncReminderToOtherDevices || (async () => null),
    unregisterReminderPushDevice: overrides.unregisterReminderPushDevice || (async () => null),
    normalizeReminderKeywords: overrides.normalizeReminderKeywords || ((value) => Array.isArray(value) ? value : []),
    extractReminderKeywords: overrides.extractReminderKeywords || ((text = '') => String(text).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10)),
    normalizeSemanticEmbedding: overrides.normalizeSemanticEmbedding || ((value) => Array.isArray(value) ? value : null),
    normalizeRecurrence: overrides.normalizeRecurrence || ((value) => value || null),
    normalizeIsoString: overrides.normalizeIsoString || ((value) => (typeof value === 'string' ? value : '')),
    normalizeReminderRecordHelper,
    normalizeReminderListHelper,
    computeNextOccurrence: overrides.computeNextOccurrence || (() => null),
    getReminderScheduleIso: overrides.getReminderScheduleIso || ((reminder) => reminder?.due || null),
    cosineSimilarity: overrides.cosineSimilarity || (() => 0),
  };
}

function loadReminderController(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../../src/reminders/reminderController.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = transformEsm(source);
  source += '\nmodule.exports = { initReminders, createReminderFromPayload, render, setupReminderFirestoreSync, updateReminder, deleteReminder, completeReminder };\n';

  const module = { exports: {} };
  const mocks = createReminderMocks(overrides);
  window.scrollTo = overrides.scrollTo || (() => {});
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window,
    document,
    localStorage,
    navigator,
    Notification: global.Notification,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Blob: global.Blob,
    Response: global.Response,
    URL: global.URL,
    fetch: global.fetch,
    self: window,
    globalThis: window,
    ...mocks,
  };

  new vm.Script(source, { filename: filePath }).runInNewContext(sandbox);
  return module.exports;
}

module.exports = { loadReminderController };

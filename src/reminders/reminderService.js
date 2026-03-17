import {
  createReminder as createReminderInStore,
  updateReminder as updateReminderInStore,
  deleteReminder as deleteReminderInStore,
  loadReminders,
  getReminders,
} from './reminderStore.js';

function runHook(hook, payload) {
  if (typeof hook === 'function') {
    return hook(payload);
  }
  return payload;
}

export function createReminder(payload = {}, options = {}) {
  const titleText = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!titleText) {
    return null;
  }

  const normalizeReminder = options.normalizeReminder;
  const createId = options.createId;
  const category = options.defaultCategory;
  const reminder = typeof normalizeReminder === 'function'
    ? normalizeReminder({
      ...payload,
      id: typeof createId === 'function' ? createId() : payload.id,
      title: titleText,
      done: false,
      pendingSync: !!options.pendingSync,
      category: payload.category ?? category,
      priority: payload.priority || 'Medium',
    })
    : {
      ...payload,
      id: typeof createId === 'function' ? createId() : payload.id,
      title: titleText,
      done: false,
      pendingSync: !!options.pendingSync,
      category: payload.category ?? category,
      priority: payload.priority || 'Medium',
    };

  console.log('[reminder-service] created reminder', reminder);
  createReminderInStore(reminder);
  runHook(options.onCreated, reminder);
  return reminder;
}

export function updateReminder(id, updates = {}, options = {}) {
  if (!id) {
    return null;
  }
  const updated = updateReminderInStore(id, updates);
  if (!updated) {
    return null;
  }
  console.log('[reminder-service] updated reminder', { id, updates });
  runHook(options.onUpdated, updated);
  return updated;
}

export function deleteReminder(id, options = {}) {
  if (!id) {
    return false;
  }
  const removed = deleteReminderInStore(id);
  if (!removed) {
    return false;
  }
  console.log('[reminder-service] deleted reminder', { id });
  runHook(options.onDeleted, { id });
  return true;
}

export function completeReminder(id, completed = true, options = {}) {
  if (!id) {
    return null;
  }
  const updated = updateReminderInStore(id, {
    done: !!completed,
    completed: !!completed,
    updatedAt: Date.now(),
  });
  if (!updated) {
    return null;
  }
  console.log('[reminder-service] completed reminder', { id, completed: !!completed });
  runHook(options.onCompleted, updated);
  return updated;
}

export function loadReminderList() {
  const reminders = loadReminders();
  console.log('[reminder-service] loaded reminders', { count: reminders.length });
  return reminders;
}

export function getReminderList() {
  return getReminders();
}

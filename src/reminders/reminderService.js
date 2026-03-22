import { normalizeReminder } from './reminderNormalizer.js';

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
  const reminderText = typeof payload.text === 'string' && payload.text.trim()
    ? payload.text.trim()
    : typeof payload.title === 'string'
      ? payload.title.trim()
      : '';
  if (!reminderText) {
    return null;
  }

  const normalizeReminderRecord = typeof options.normalizeReminder === 'function' ? options.normalizeReminder : normalizeReminder;
  const createId = options.createId;
  const category = options.defaultCategory;
  const reminder = normalizeReminderRecord({
    ...payload,
    id: typeof createId === 'function' ? createId() : payload.id,
    text: payload.text ?? payload.title,
    completed: false,
    pendingSync: !!options.pendingSync,
    category: payload.category ?? category,
    priority: payload.priority || 'medium',
  });

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
  runHook(options.onCompleted, updated);
  return updated;
}

export function loadReminderList() {
  return loadReminders();
}

export function getReminderList() {
  return getReminders();
}

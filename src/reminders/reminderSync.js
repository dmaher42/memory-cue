let syncHandlers = {
  loadRemindersFromFirestore: null,
  saveReminderToFirestore: null,
  listenForReminderUpdates: null,
  init: null,
  syncNow: null,
};

export function setupSyncHandlers(handlers = {}) {
  syncHandlers = { ...syncHandlers, ...handlers };
}

export async function init(...args) {
  if (typeof syncHandlers.init !== 'function') {
    return null;
  }
  return syncHandlers.init(...args);
}

export async function syncNow(...args) {
  if (typeof syncHandlers.syncNow !== 'function') {
    return null;
  }
  return syncHandlers.syncNow(...args);
}

export async function loadRemindersFromFirestore(...args) {
  if (typeof syncHandlers.loadRemindersFromFirestore !== 'function') {
    return null;
  }
  return syncHandlers.loadRemindersFromFirestore(...args);
}

export async function saveReminderToFirestore(...args) {
  if (typeof syncHandlers.saveReminderToFirestore !== 'function') {
    return null;
  }
  return syncHandlers.saveReminderToFirestore(...args);
}

export function listenForReminderUpdates(...args) {
  if (typeof syncHandlers.listenForReminderUpdates !== 'function') {
    return null;
  }
  return syncHandlers.listenForReminderUpdates(...args);
}

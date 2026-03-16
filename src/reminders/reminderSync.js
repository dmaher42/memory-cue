let syncHandlers = {
  loadRemindersFromFirestore: null,
  saveReminderToFirestore: null,
  listenForReminderUpdates: null,
};

export function setupSyncHandlers(handlers = {}) {
  syncHandlers = { ...syncHandlers, ...handlers };
  console.log('[reminder-sync] firestore sync started');
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

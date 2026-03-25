import { listReminders, subscribeReminders } from '../repositories/reminderRepository.js';

const resolveSyncState = () => (
  typeof navigator !== 'undefined' && navigator.onLine ? 'error' : 'offline'
);

export const createReminderFirestoreSync = (options = {}) => {
  const {
    normalizeReminderRecord = (value) => value,
    normalizeReminderList = (value) => (Array.isArray(value) ? value : []),
    ensureOrderIndicesInitialized = (value) => value,
    loadReminders = () => [],
    saveToFirebase = async () => false,
    getItems = () => [],
    setItems = () => {},
    getPendingDeletionItems = () => new Map(),
    scheduleReminderNotification = () => {},
    render = () => {},
    updateMobileRemindersHeaderSubtitle = () => {},
    persistItems = () => {},
    rescheduleAllReminders = () => {},
    renderSyncIndicator = null,
  } = options;

  const mapFirestoreReminder = (userId, reminderId, payload = {}) => normalizeReminderRecord({
    ...payload,
    id: typeof payload.id === 'string' && payload.id ? payload.id : reminderId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt || payload.createdAt,
    userId: typeof payload.userId === 'string' ? payload.userId : userId,
    pendingSync: false,
  }, { fallbackId: reminderId });

  const applyRemoteReminderItems = (userId, remoteItems = []) => {
    const normalizedRemoteItems = Array.isArray(remoteItems)
      ? remoteItems.map((entry) => mapFirestoreReminder(userId, entry?.id, entry)).filter(Boolean)
      : [];
    const pendingDeletionItems = getPendingDeletionItems();
    const remoteIds = new Set(normalizedRemoteItems.map((entry) => entry.id));

    pendingDeletionItems.forEach((_entry, reminderId) => {
      if (!remoteIds.has(reminderId)) {
        pendingDeletionItems.delete(reminderId);
      }
    });

    const mergedById = new Map(
      normalizedRemoteItems
        .filter((entry) => !pendingDeletionItems.has(entry.id))
        .map((entry) => [entry.id, entry])
    );

    getItems()
      .filter((entry) => entry && entry.id && entry.pendingSync && !pendingDeletionItems.has(entry.id))
      .forEach((entry) => {
        if (!mergedById.has(entry.id)) {
          mergedById.set(entry.id, normalizeReminderRecord({
            ...entry,
            userId,
          }, { fallbackId: entry.id }));
        }
      });

    const nextItems = ensureOrderIndicesInitialized(Array.from(mergedById.values()));
    setItems(nextItems);
    nextItems.forEach((reminder) => {
      scheduleReminderNotification({
        ...reminder,
        dueAt: reminder.due,
        text: reminder.title,
      });
    });
    render();
    updateMobileRemindersHeaderSubtitle();
    persistItems();
    rescheduleAllReminders();
  };

  const setupReminderFirestoreSync = async ({
    userId,
    currentUnsubscribe = null,
    hydrateOfflineReminders = () => {},
  } = {}) => {
    if (!userId) {
      currentUnsubscribe?.();
      hydrateOfflineReminders();
      render();
      updateMobileRemindersHeaderSubtitle();
      persistItems();
      rescheduleAllReminders();
      return null;
    }

    const localItems = ensureOrderIndicesInitialized(normalizeReminderList(loadReminders()));

    try {
      currentUnsubscribe?.();

      const remoteItems = await listReminders(userId);
      const normalizedRemoteItems = Array.isArray(remoteItems)
        ? remoteItems.map((entry) => mapFirestoreReminder(userId, entry?.id, entry)).filter(Boolean)
        : [];
      const remoteById = new Map(normalizedRemoteItems.map((entry) => [entry.id, entry]));
      const remindersToSync = localItems.filter((entry) => {
        if (!entry || typeof entry !== 'object' || !entry.id) {
          return false;
        }
        return !!entry.pendingSync;
      });

      for (const entry of remindersToSync) {
        const saved = await saveToFirebase({ ...entry, userId });
        if (saved) {
          remoteById.set(entry.id, mapFirestoreReminder(userId, entry.id, {
            ...entry,
            pendingSync: false,
            userId,
          }));
        } else {
          remoteById.set(entry.id, normalizeReminderRecord({
            ...entry,
            userId,
          }, { fallbackId: entry.id }));
        }
      }

      applyRemoteReminderItems(userId, Array.from(remoteById.values()));

      return await subscribeReminders(userId, (nextRemoteItems) => {
        applyRemoteReminderItems(userId, nextRemoteItems);
      }, (error) => {
        console.error('Firestore reminders listener error:', error);
        if (typeof renderSyncIndicator === 'function') {
          renderSyncIndicator(resolveSyncState());
        }
      });
    } catch (error) {
      console.error('Firestore reminders sync error:', error);
      setItems(ensureOrderIndicesInitialized(normalizeReminderList(localItems)));
      render();
      updateMobileRemindersHeaderSubtitle();
      persistItems();
      rescheduleAllReminders();
      if (typeof renderSyncIndicator === 'function') {
        renderSyncIndicator(resolveSyncState());
      }
      return null;
    }
  };

  return {
    mapFirestoreReminder: (userId, reminderId, payload = {}) => mapFirestoreReminder(userId, reminderId, payload),
    applyRemoteReminderItems: (userId, remoteItems = []) => applyRemoteReminderItems(userId, remoteItems),
    setupReminderFirestoreSync,
  };
};

import { listReminders, subscribeReminders } from '../repositories/reminderRepository.js?v=20260904a';

const resolveSyncState = () => (
  typeof navigator !== 'undefined' && navigator.onLine ? 'error' : 'offline'
);

const toUpdatedAtTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const createReminderFirestoreSync = (options = {}) => {
  const {
    normalizeReminderRecord = (value) => value,
    normalizeReminderList = (value) => (Array.isArray(value) ? value : []),
    ensureOrderIndicesInitialized = (value) => value,
    listRemoteReminders = (...args) => listReminders(...args),
    subscribeRemoteReminders = (...args) => subscribeReminders(...args),
    isCurrentUser = () => true,
    loadReminders = () => [],
    loadQuarantinedPendingReminders = () => [],
    quarantinePendingReminders = () => true,
    clearQuarantinedPendingReminders = () => true,
    loadPendingReminderDeletions = () => [],
    clearPendingReminderDeletions = () => true,
    retryPendingReminderDeletion = async () => false,
    saveToFirebase = async () => false,
    getItems = () => [],
    setItems = () => {},
    getPendingDeletionItems = () => new Map(),
    render = () => {},
    updateMobileRemindersHeaderSubtitle = () => {},
    persistItems = () => {},
    rescheduleAllReminders = () => {},
    renderSyncIndicator = null,
    onPendingWork = () => {},
  } = options;

  const mapFirestoreReminder = (userId, reminderId, payload = {}) => normalizeReminderRecord({
    ...payload,
    id: reminderId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt || payload.createdAt,
    // The collection path is the ownership boundary. Never let a stale or
    // malformed document payload relabel data from one account as another.
    userId,
    pendingSync: false,
  }, { fallbackId: reminderId });

  const getPendingDeletionsForUser = (userId) => {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    const byId = new Map();
    if (!normalizedUserId) return byId;
    const records = loadPendingReminderDeletions(normalizedUserId);
    if (!Array.isArray(records)) return byId;
    records.forEach((record) => {
      const id = typeof record?.id === 'string' ? record.id.trim() : '';
      const ownerUserId = typeof record?.userId === 'string' ? record.userId.trim() : '';
      if (record?.type !== 'delete' || !id || ownerUserId !== normalizedUserId) {
        return;
      }
      const normalized = {
        type: 'delete',
        id,
        userId: ownerUserId,
        updatedAt: toUpdatedAtTimestamp(record.updatedAt),
      };
      const existing = byId.get(id);
      if (!existing || normalized.updatedAt >= existing.updatedAt) {
        byId.set(id, normalized);
      }
    });
    return byId;
  };

  const clearPendingDeletionRecord = (userId, reminderId) => {
    // A retryable upsert must be removed before its delete tombstone. If the
    // first write fails, retaining the tombstone prevents resurrection.
    if (clearQuarantinedPendingReminders(userId, [reminderId]) !== true) {
      onPendingWork();
      return false;
    }
    if (clearPendingReminderDeletions(userId, [reminderId]) !== true) {
      onPendingWork();
      return false;
    }
    return true;
  };

  const applyRemoteReminderItems = (userId, remoteItems = [], options = {}) => {
    const ignoredLocalPendingIds = options.ignoreLocalPendingIds instanceof Set
      ? options.ignoreLocalPendingIds
      : new Set(Array.isArray(options.ignoreLocalPendingIds) ? options.ignoreLocalPendingIds : []);
    const preservedLocalPendingItems = normalizeReminderList(
      Array.isArray(options.preserveLocalPendingItems)
        ? options.preserveLocalPendingItems
        : []
    );
    const allowAbsenceConfirmation = options.allowAbsenceConfirmation === true;
    const normalizedRemoteItems = Array.isArray(remoteItems)
      ? remoteItems.map((entry) => mapFirestoreReminder(userId, entry?.id, entry)).filter(Boolean)
      : [];
    const pendingDeletionItems = getPendingDeletionItems();
    const remoteById = new Map(normalizedRemoteItems.map((entry) => [entry.id, entry]));
    const persistentDeletionsById = getPendingDeletionsForUser(userId);

    let cleanupPending = false;
    persistentDeletionsById.forEach((deletion, reminderId) => {
      const remoteEntry = remoteById.get(reminderId);
      if (
        (!remoteEntry && allowAbsenceConfirmation)
        || (
          remoteEntry
          && toUpdatedAtTimestamp(remoteEntry.updatedAt) > deletion.updatedAt
        )
      ) {
        // Absence confirms the hard delete. A strictly newer remote record is a
        // later edit/recreation and must win over this older local intent.
        if (clearPendingDeletionRecord(userId, reminderId)) {
          persistentDeletionsById.delete(reminderId);
        } else {
          cleanupPending = true;
        }
      }
    });

    const isEphemeralDeletionForUser = (reminderId) => {
      if (!pendingDeletionItems.has(reminderId)) {
        return false;
      }
      const pendingEntry = pendingDeletionItems.get(reminderId);
      const ownerUserId = typeof pendingEntry?.userId === 'string'
        ? pendingEntry.userId.trim()
        : '';
      return !ownerUserId || ownerUserId === userId;
    };

    pendingDeletionItems.forEach((entry, reminderId) => {
      if (!isEphemeralDeletionForUser(reminderId)) return;
      const remoteEntry = remoteById.get(reminderId);
      if (
        (!remoteEntry && allowAbsenceConfirmation)
        || (
          remoteEntry
          && toUpdatedAtTimestamp(remoteEntry.updatedAt) > toUpdatedAtTimestamp(entry?.updatedAt)
        )
      ) {
        pendingDeletionItems.delete(reminderId);
      }
    });

    const isPendingDeletionForUser = (reminderId) => (
      isEphemeralDeletionForUser(reminderId)
      || persistentDeletionsById.has(reminderId)
    );

    const mergedById = new Map(
      normalizedRemoteItems
        .filter((entry) => !isPendingDeletionForUser(entry.id))
        .map((entry) => [entry.id, entry])
    );

    [...getItems(), ...preservedLocalPendingItems]
      .filter((entry) => {
        if (
          !entry?.id
          || !entry.pendingSync
          || ignoredLocalPendingIds.has(entry.id)
          || isPendingDeletionForUser(entry.id)
        ) {
          return false;
        }
        const ownerUserId = typeof entry.userId === 'string' ? entry.userId.trim() : '';
        return !ownerUserId || ownerUserId === userId;
      })
      .forEach((entry) => {
        const remoteEntry = mergedById.get(entry.id);
        const localPendingEditWins = !remoteEntry
          || toUpdatedAtTimestamp(entry.updatedAt) >= toUpdatedAtTimestamp(remoteEntry.updatedAt);
        if (localPendingEditWins) {
          mergedById.set(entry.id, normalizeReminderRecord({
            ...entry,
            userId: entry.userId || userId,
          }, { fallbackId: entry.id }));
        }
      });

    const nextItems = ensureOrderIndicesInitialized(Array.from(mergedById.values()));
    setItems(nextItems);
    render();
    updateMobileRemindersHeaderSubtitle();
    persistItems();
    rescheduleAllReminders();
    return { pendingWork: cleanupPending };
  };

  const setupReminderFirestoreSync = async ({
    userId,
    currentUnsubscribe = null,
    hydrateOfflineReminders = () => {},
    isCurrent = null,
  } = {}) => {
    if (!userId) {
      currentUnsubscribe?.();
      hydrateOfflineReminders();
      render();
      updateMobileRemindersHeaderSubtitle();
      persistItems();
      rescheduleAllReminders();
      return {
        unsubscribe: null,
        authoritative: false,
      };
    }

    const syncIsCurrent = typeof isCurrent === 'function'
      ? () => isCurrent() === true && isCurrentUser(userId) === true
      : () => isCurrentUser(userId) === true;
    if (!syncIsCurrent()) {
      return {
        unsubscribe: null,
        authoritative: false,
      };
    }
    const loadedLocalItems = normalizeReminderList(loadReminders());
    const pendingDeletionsByOwner = new Map();
    const pendingDeletionsForOwner = (ownerUserId) => {
      const normalizedOwnerUserId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
      if (!normalizedOwnerUserId) return new Map();
      if (!pendingDeletionsByOwner.has(normalizedOwnerUserId)) {
        pendingDeletionsByOwner.set(
          normalizedOwnerUserId,
          getPendingDeletionsForUser(normalizedOwnerUserId)
        );
      }
      return pendingDeletionsByOwner.get(normalizedOwnerUserId);
    };
    const pendingDeletionsById = pendingDeletionsForOwner(userId);
    const isCoveredByPendingDeletion = (entry, fallbackOwnerUserId = userId) => {
      const ownerUserId = typeof entry?.userId === 'string' && entry.userId.trim()
        ? entry.userId.trim()
        : fallbackOwnerUserId;
      return Boolean(entry?.id && pendingDeletionsForOwner(ownerUserId).has(entry.id));
    };
    const foreignPendingItems = loadedLocalItems.filter((entry) => {
      const ownerUserId = typeof entry?.userId === 'string' ? entry.userId.trim() : '';
      return entry?.pendingSync
        && ownerUserId
        && ownerUserId !== userId
        && !isCoveredByPendingDeletion(entry, ownerUserId);
    });
    if (foreignPendingItems.length) {
      const quarantined = quarantinePendingReminders(foreignPendingItems) === true;
      if (!quarantined) {
        currentUnsubscribe?.();
        if (typeof renderSyncIndicator === 'function') {
          renderSyncIndicator('error');
        }
        return {
          unsubscribe: null,
          authoritative: false,
          pendingWork: true,
        };
      }
    }
    const activeLocalItems = loadedLocalItems.filter((entry) => {
      const ownerUserId = typeof entry?.userId === 'string' ? entry.userId.trim() : '';
      return (!ownerUserId || ownerUserId === userId)
        && !isCoveredByPendingDeletion(entry);
    });
    const restoredPendingItems = normalizeReminderList(loadQuarantinedPendingReminders(userId))
      .filter((entry) => {
        const ownerUserId = typeof entry?.userId === 'string' ? entry.userId.trim() : '';
        return entry?.pendingSync
          && ownerUserId === userId
          && !pendingDeletionsById.has(entry.id);
      });
    const localById = new Map();
    [...activeLocalItems, ...restoredPendingItems].forEach((entry) => {
      if (!entry?.id) {
        return;
      }
      const existing = localById.get(entry.id);
      if (
        !existing
        || toUpdatedAtTimestamp(entry.updatedAt) >= toUpdatedAtTimestamp(existing.updatedAt)
      ) {
        localById.set(entry.id, entry);
      }
    });
    const localItems = ensureOrderIndicesInitialized(Array.from(localById.values()));

    let pendingWork = false;
    try {
      currentUnsubscribe?.();

      const remoteItems = await listRemoteReminders(userId);
      if (!syncIsCurrent()) {
        return {
          unsubscribe: null,
          authoritative: false,
        };
      }
      const normalizedRemoteItems = Array.isArray(remoteItems)
        ? remoteItems.map((entry) => mapFirestoreReminder(userId, entry?.id, entry)).filter(Boolean)
        : [];
      const remoteById = new Map(normalizedRemoteItems.map((entry) => [entry.id, entry]));

      for (const deletion of pendingDeletionsById.values()) {
        if (!syncIsCurrent()) {
          return {
            unsubscribe: null,
            authoritative: false,
          };
        }
        const remoteEntry = remoteById.get(deletion.id);
        if (!remoteEntry) {
          if (!clearPendingDeletionRecord(userId, deletion.id)) {
            pendingWork = true;
          }
          continue;
        }
        if (toUpdatedAtTimestamp(remoteEntry.updatedAt) > deletion.updatedAt) {
          // A later remote edit/recreation supersedes this older local delete.
          if (!clearPendingDeletionRecord(userId, deletion.id)) {
            pendingWork = true;
          }
          continue;
        }
        let deleted = false;
        try {
          deleted = await retryPendingReminderDeletion(deletion) === true;
        } catch (error) {
          console.warn('Pending reminder delete retry failed:', error);
        }
        if (!syncIsCurrent()) {
          return {
            unsubscribe: null,
            authoritative: false,
          };
        }
        if (deleted) {
          remoteById.delete(deletion.id);
          if (!clearPendingDeletionRecord(userId, deletion.id)) {
            pendingWork = true;
          }
        } else {
          pendingWork = true;
        }
        // On failure, retain the remote record in this snapshot. The persistent
        // tombstone filters it below without mistaking the filtered view for
        // confirmation that the Firestore document is absent.
      }

      const remindersToSync = localItems.filter((entry) => {
        if (!entry || typeof entry !== 'object' || !entry.id) {
          return false;
        }
        if (!entry.pendingSync) {
          return false;
        }
        const remoteEntry = remoteById.get(entry.id);
        return !remoteEntry
          || toUpdatedAtTimestamp(entry.updatedAt) >= toUpdatedAtTimestamp(remoteEntry.updatedAt);
      });
      const failedPendingItems = [];
      const resolvedPendingIds = new Set(
        localItems
          .filter((entry) => entry?.id && !remindersToSync.includes(entry))
          .map((entry) => entry.id)
      );

      for (const entry of remindersToSync) {
        if (!syncIsCurrent()) {
          return {
            unsubscribe: null,
            authoritative: false,
          };
        }
        const saveCandidate = { ...entry, userId };
        const saved = await saveToFirebase(
          saveCandidate,
          { expectedUserId: userId }
        );
        if (!syncIsCurrent()) {
          return {
            unsubscribe: null,
            authoritative: false,
          };
        }
        if (saved === true) {
          resolvedPendingIds.add(entry.id);
          remoteById.set(entry.id, mapFirestoreReminder(userId, entry.id, {
            ...saveCandidate,
            pendingSync: false,
            userId,
          }));
        } else if (saved?.terminalConflict === true && saved.remoteStateKnown === true) {
          resolvedPendingIds.add(entry.id);
          if (saved.remoteReminder) {
            remoteById.set(
              entry.id,
              mapFirestoreReminder(userId, entry.id, saved.remoteReminder)
            );
          } else {
            remoteById.delete(entry.id);
          }
        } else {
          pendingWork = true;
          failedPendingItems.push(normalizeReminderRecord({
            ...saveCandidate,
            pendingSync: true,
            userId,
          }, { fallbackId: entry.id }));
        }
      }

      if (!syncIsCurrent()) {
        return {
          unsubscribe: null,
          authoritative: false,
        };
      }
      const applyResult = applyRemoteReminderItems(userId, Array.from(remoteById.values()), {
        ignoreLocalPendingIds: new Set([
          ...pendingDeletionsById.keys(),
          ...resolvedPendingIds,
        ]),
        preserveLocalPendingItems: failedPendingItems,
        allowAbsenceConfirmation: true,
      });
      if (applyResult?.pendingWork === true) {
        pendingWork = true;
      }
      const resolvedRestoredIds = restoredPendingItems
        .filter((entry) => resolvedPendingIds.has(entry.id))
        .map((entry) => entry.id);
      if (resolvedRestoredIds.length) {
        if (clearQuarantinedPendingReminders(userId, resolvedRestoredIds) !== true) {
          pendingWork = true;
          onPendingWork();
        }
      }

      let nextUnsubscribe = null;
      try {
        nextUnsubscribe = await subscribeRemoteReminders(userId, (nextRemoteItems, snapshotState = {}) => {
          if (!syncIsCurrent()) {
            return;
          }
          applyRemoteReminderItems(userId, nextRemoteItems, {
            allowAbsenceConfirmation: snapshotState?.serverAuthoritative === true,
          });
        }, (error) => {
          if (!syncIsCurrent()) {
            return;
          }
          console.error('Firestore reminders listener error:', error);
          onPendingWork();
          if (typeof renderSyncIndicator === 'function') {
            renderSyncIndicator(resolveSyncState());
          }
        });
      } catch (error) {
        // The server hydration above is still authoritative. Only the live
        // listener needs retrying; never restore the stale pre-hydration cache.
        console.error('Firestore reminders listener setup error:', error);
        pendingWork = true;
        onPendingWork();
        if (typeof renderSyncIndicator === 'function') {
          renderSyncIndicator(resolveSyncState());
        }
      }
      if (!syncIsCurrent()) {
        nextUnsubscribe?.();
        return {
          unsubscribe: null,
          authoritative: false,
        };
      }
      return {
        unsubscribe: nextUnsubscribe,
        authoritative: true,
        pendingWork,
      };
    } catch (error) {
      if (!syncIsCurrent()) {
        return {
          unsubscribe: null,
          authoritative: false,
        };
      }
      console.error('Firestore reminders sync error:', error);
      setItems(ensureOrderIndicesInitialized(normalizeReminderList(localItems)));
      render();
      updateMobileRemindersHeaderSubtitle();
      persistItems();
      rescheduleAllReminders();
      if (typeof renderSyncIndicator === 'function') {
        renderSyncIndicator(resolveSyncState());
      }
      return {
        unsubscribe: null,
        authoritative: false,
        pendingWork: true,
      };
    }
  };

  return {
    mapFirestoreReminder: (userId, reminderId, payload = {}) => mapFirestoreReminder(userId, reminderId, payload),
    applyRemoteReminderItems: (userId, remoteItems = [], options = {}) => (
      applyRemoteReminderItems(userId, remoteItems, options)
    ),
    setupReminderFirestoreSync,
  };
};

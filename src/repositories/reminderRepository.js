import { getFirebaseContext, requireUid } from '../lib/firebase.js?v=20260904a';
import { normalizeReminder, normalizeReminderList } from '../reminders/reminderNormalizer.js';


const remindersCollection = (firebase, uid) => firebase.collection(firebase.db, 'users', requireUid(uid), 'reminders');

const toUpdatedAtTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const requireReminderFirebase = async (uid, action) => {
  const firebase = await getFirebaseContext();
  const normalizedUid = requireUid(uid);
  if (!firebase) {
    const error = new Error(`Firebase unavailable for reminder ${action}`);
    error.code = 'firebase-unavailable';
    throw error;
  }
  return {
    firebase,
    uid: normalizedUid,
  };
};

export const listReminders = async (uid) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'list');
  const snapshot = await firebase.getDocsFromServer(
    firebase.query(remindersCollection(firebase, normalizedUid), firebase.orderBy('updatedAt', 'desc'))
  );
  return normalizeReminderList(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })));
};

export const saveReminder = async (uid, reminder, options = {}) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'save');
  const normalizedReminder = normalizeReminder({ ...reminder, userId: normalizedUid });
  const reminderId = normalizedReminder.id;
  const reminderRef = firebase.doc(
    firebase.db,
    'users',
    normalizedUid,
    'reminders',
    requireUid(reminderId)
  );
  const hasExpectedRemoteVersion = Object.prototype.hasOwnProperty.call(options, 'expectedUpdatedAt');
  const expectedRemoteUpdatedAt = hasExpectedRemoteVersion
    ? toUpdatedAtTimestamp(options.expectedUpdatedAt)
    : null;
  const requireExisting = options.requireExisting === true;
  const transactionResult = await firebase.runTransaction(firebase.db, async (transaction) => {
    const existingSnapshot = await transaction.get(reminderRef);
    const existing = existingSnapshot?.exists?.() ? existingSnapshot.data() : null;
    if (requireExisting && !existing) {
      return {
        saved: false,
        reason: 'remote-reminder-missing',
        remoteReminder: null,
        remoteStateKnown: true,
      };
    }
    const conflictVersion = hasExpectedRemoteVersion
      ? expectedRemoteUpdatedAt
      : toUpdatedAtTimestamp(normalizedReminder.updatedAt);
    if (
      existing
      && toUpdatedAtTimestamp(existing.updatedAt) > conflictVersion
    ) {
      return {
        saved: false,
        reason: 'newer-remote-version',
        remoteReminder: normalizeReminder({
          ...existing,
          id: reminderId,
          userId: normalizedUid,
          pendingSync: false,
        }),
        remoteStateKnown: true,
      };
    }
    transaction.set(reminderRef, normalizedReminder, { merge: true });
    return { saved: true };
  });
  return transactionResult?.saved === false
    ? transactionResult
    : normalizeReminder(normalizedReminder);
};

export const removeReminder = async (uid, reminderId, options = {}) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'delete');
  const normalizedReminderId = requireUid(reminderId);
  const reminderRef = firebase.doc(firebase.db, 'users', normalizedUid, 'reminders', normalizedReminderId);
  if (!Object.prototype.hasOwnProperty.call(options, 'maxUpdatedAt')) {
    await firebase.deleteDoc(reminderRef);
    return { removed: true };
  }
  const maxUpdatedAt = toUpdatedAtTimestamp(options.maxUpdatedAt);
  return firebase.runTransaction(firebase.db, async (transaction) => {
    const existingSnapshot = await transaction.get(reminderRef);
    if (!existingSnapshot?.exists?.()) {
      return { removed: true, alreadyMissing: true };
    }
    const existing = existingSnapshot.data();
    if (toUpdatedAtTimestamp(existing?.updatedAt) > maxUpdatedAt) {
      return {
        removed: false,
        reason: 'newer-remote-version',
        remoteReminder: normalizeReminder({
          ...existing,
          id: normalizedReminderId,
          userId: normalizedUid,
          pendingSync: false,
        }),
      };
    }
    transaction.delete(reminderRef);
    return { removed: true };
  });
};

const groupColorsDoc = (firebase, uid) => firebase.doc(firebase.db, 'users', requireUid(uid), 'preferences', 'reminderGroupColors');

const normalizeBoardColumnKey = (value) => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return key === 'school' || key === 'footy' ? key : '';
};

export const saveReminderGroupColorRemote = async (uid, name, color) => {
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key || typeof color !== 'string' || !color) {
    return;
  }
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'save-group-colour');
  // merge:true deep-merges the nested colours map, so one colour update never clobbers others.
  await firebase.setDoc(groupColorsDoc(firebase, normalizedUid), { colors: { [key]: color } }, { merge: true });
};

export const subscribeReminderGroupColors = async (uid, onColors, onError = null) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'subscribe-group-colours');
  if (typeof firebase.onSnapshot !== 'function') {
    return () => {};
  }
  return firebase.onSnapshot(groupColorsDoc(firebase, normalizedUid), (snapshot) => {
    const data = snapshot && typeof snapshot.data === 'function' ? snapshot.data() : null;
    const colors = data && data.colors && typeof data.colors === 'object' ? data.colors : {};
    if (typeof onColors === 'function') {
      onColors(colors);
    }
  }, (error) => {
    if (typeof onError === 'function') {
      onError(error);
    }
  });
};

export const saveReminderBoardLabelRemote = async (uid, columnKey, label) => {
  const key = normalizeBoardColumnKey(columnKey);
  const normalizedLabel = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, 32) : '';
  if (!key || !normalizedLabel) {
    return;
  }
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'save-board-label');
  await firebase.setDoc(
    groupColorsDoc(firebase, normalizedUid),
    { boardLabels: { [key]: normalizedLabel } },
    { merge: true },
  );
};

export const subscribeReminderBoardLabels = async (uid, onLabels, onError = null) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'subscribe-board-labels');
  if (typeof firebase.onSnapshot !== 'function') {
    return () => {};
  }
  return firebase.onSnapshot(groupColorsDoc(firebase, normalizedUid), (snapshot) => {
    const data = snapshot && typeof snapshot.data === 'function' ? snapshot.data() : null;
    const labels = data && data.boardLabels && typeof data.boardLabels === 'object'
      ? data.boardLabels
      : {};
    if (typeof onLabels === 'function') {
      onLabels(labels);
    }
  }, (error) => {
    if (typeof onError === 'function') {
      onError(error);
    }
  });
};

export const subscribeReminders = async (uid, onItems, onError = null) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'subscribe');
  if (typeof firebase.onSnapshot !== 'function') {
    const error = new Error('Firebase onSnapshot is unavailable for reminder subscribe');
    error.code = 'firebase-onSnapshot-unavailable';
    throw error;
  }

  const queryRef = firebase.query(
    remindersCollection(firebase, normalizedUid),
    firebase.orderBy('updatedAt', 'desc')
  );

  return firebase.onSnapshot(queryRef, (snapshot) => {
    const items = normalizeReminderList(
      snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
    );

    if (typeof onItems === 'function') {
      onItems(items, {
        fromCache: snapshot?.metadata?.fromCache === true,
        hasPendingWrites: snapshot?.metadata?.hasPendingWrites === true,
        serverAuthoritative:
          snapshot?.metadata?.fromCache !== true
          && snapshot?.metadata?.hasPendingWrites !== true,
      });
    }
  }, (error) => {
    if (typeof onError === 'function') {
      onError(error);
    }
  });
};

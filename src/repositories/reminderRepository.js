import { getFirebaseContext, requireUid } from '../lib/firebase.js';
import { normalizeReminder, normalizeReminderList } from '../reminders/reminderNormalizer.js';


const remindersCollection = (firebase, uid) => firebase.collection(firebase.db, 'users', requireUid(uid), 'reminders');

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
  const snapshot = await firebase.getDocs(
    firebase.query(remindersCollection(firebase, normalizedUid), firebase.orderBy('updatedAt', 'desc'))
  );
  return normalizeReminderList(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))); 
};

export const saveReminder = async (uid, reminder) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'save');
  const normalizedReminder = normalizeReminder({ ...reminder, userId: normalizedUid });
  const reminderId = normalizedReminder.id;
  await firebase.setDoc(
    firebase.doc(firebase.db, 'users', normalizedUid, 'reminders', requireUid(reminderId)),
    normalizedReminder,
    { merge: true }
  );
  return normalizeReminder(normalizedReminder);
};

export const removeReminder = async (uid, reminderId) => {
  const { firebase, uid: normalizedUid } = await requireReminderFirebase(uid, 'delete');
  await firebase.deleteDoc(firebase.doc(firebase.db, 'users', normalizedUid, 'reminders', requireUid(reminderId)));
};

const groupColorsDoc = (firebase, uid) => firebase.doc(firebase.db, 'users', requireUid(uid), 'preferences', 'reminderGroupColors');

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
      snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
    );

    if (typeof onItems === 'function') {
      onItems(items);
    }
  }, (error) => {
    if (typeof onError === 'function') {
      onError(error);
    }
  });
};

import { getFirebaseContext, requireUid } from '../lib/firebase.js';
import { normalizeReminder, normalizeReminderList } from '../reminders/reminderNormalizer.js';


const remindersCollection = (firebase, uid) => firebase.collection(firebase.db, 'users', requireUid(uid), 'reminders');

export const listReminders = async (uid) => {
  const firebase = await getFirebaseContext();
  if (!firebase) {
    return [];
  }
  const snapshot = await firebase.getDocs(firebase.query(remindersCollection(firebase, uid), firebase.orderBy('updatedAt', 'desc')));
  return normalizeReminderList(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))); 
};

export const saveReminder = async (uid, reminder) => {
  const firebase = await getFirebaseContext();
  const normalizedUid = requireUid(uid);
  const normalizedReminder = normalizeReminder({ ...reminder, userId: normalizedUid });
  const reminderId = normalizedReminder.id;
  if (!firebase) {
    return normalizedReminder;
  }
  await firebase.setDoc(
    firebase.doc(firebase.db, 'users', normalizedUid, 'reminders', requireUid(reminderId)),
    normalizedReminder,
    { merge: true }
  );
  return normalizeReminder(normalizedReminder);
};

export const removeReminder = async (uid, reminderId) => {
  const firebase = await getFirebaseContext();
  if (!firebase) {
    return;
  }
  await firebase.deleteDoc(firebase.doc(firebase.db, 'users', requireUid(uid), 'reminders', requireUid(reminderId)));
};

export const subscribeReminders = async (uid, onItems, onError = null) => {
  const firebase = await getFirebaseContext();
  if (!firebase || typeof firebase.onSnapshot !== 'function') {
    return () => {};
  }

  const queryRef = firebase.query(
    remindersCollection(firebase, uid),
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

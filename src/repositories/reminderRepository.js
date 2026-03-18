import { getFirebaseContext, requireUid } from '../lib/firebase.js';

const remindersCollection = (firebase, uid) => firebase.collection(firebase.db, 'users', requireUid(uid), 'reminders');

export const listReminders = async (uid) => {
  const firebase = await getFirebaseContext();
  if (!firebase) {
    return [];
  }
  const snapshot = await firebase.getDocs(firebase.query(remindersCollection(firebase, uid), firebase.orderBy('updatedAt', 'desc')));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

export const saveReminder = async (uid, reminder) => {
  const firebase = await getFirebaseContext();
  if (!firebase) {
    return reminder;
  }
  const reminderId = reminder?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
  const normalizedUid = requireUid(uid);
  await firebase.setDoc(
    firebase.doc(firebase.db, 'users', normalizedUid, 'reminders', requireUid(reminderId)),
    { ...reminder, id: reminderId, userId: normalizedUid },
    { merge: true }
  );
  return { ...reminder, id: reminderId, userId: normalizedUid };
};

export const removeReminder = async (uid, reminderId) => {
  const firebase = await getFirebaseContext();
  if (!firebase) {
    return;
  }
  await firebase.deleteDoc(firebase.doc(firebase.db, 'users', requireUid(uid), 'reminders', requireUid(reminderId)));
};

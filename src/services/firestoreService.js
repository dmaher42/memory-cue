import { getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc, query, where, limit } from 'firebase/firestore';

const db = getFirestore();

export function userCollection(uid, name) {
  return collection(db, 'users', uid, name);
}

export function userDoc(uid, collectionName, id) {
  return doc(db, 'users', uid, collectionName, id);
}

export async function createReminder(uid, reminder) {
  console.log('[firestore] createReminder', uid);
  return addDoc(userCollection(uid, 'reminders'), reminder);
}

export async function updateReminder(uid, id, reminder) {
  return setDoc(userDoc(uid, 'reminders', id), reminder, { merge: true });
}

export async function loadReminders(uid) {
  console.log('[firestore] loadReminders', uid);
  const snapshot = await getDocs(userCollection(uid, 'reminders'));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createNote(uid, note) {
  return addDoc(userCollection(uid, 'notes'), note);
}

export async function saveInbox(uid, entry) {
  return addDoc(userCollection(uid, 'inbox'), entry);
}

export async function storeEmbedding(uid, embedding) {
  return addDoc(userCollection(uid, 'embeddings'), embedding);
}

export async function upsertUserDocument(uid, collectionName, id, data, options = { merge: true }) {
  return setDoc(userDoc(uid, collectionName, id), data, options);
}

export async function deleteUserDocument(uid, collectionName, id) {
  return deleteDoc(userDoc(uid, collectionName, id));
}

export async function loadUserCollection(uid, collectionName) {
  const snapshot = await getDocs(userCollection(uid, collectionName));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function findUserDocumentByField(uid, collectionName, field, value) {
  const collectionRef = userCollection(uid, collectionName);
  const existingQuery = query(collectionRef, where(field, '==', value), limit(1));
  const snapshot = await getDocs(existingQuery);
  return snapshot.empty ? null : snapshot.docs[0];
}

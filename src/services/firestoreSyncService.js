import { getFirebaseContext, requireUid } from '../lib/firebase.js';
import { normalizeReminderList } from '../reminders/reminderNormalizer.js';
import { normalizeMemory, normalizeMemoryList } from './memoryService.js';

const NOTES_KEY = 'memoryCueNotes';
const INBOX_KEY = 'memoryCueInbox';
const REMINDERS_KEY = 'memoryCue:offlineReminders';
const CHAT_KEY = 'memoryCueChatHistory';

const COLLECTIONS = Object.freeze({
  notes: 'notes',
  inbox: 'inbox',
  chat: 'chatHistory',
});

const normalizeUid = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveUid = (uidOverride = null) => {
  const explicitUid = normalizeUid(uidOverride);
  if (explicitUid) {
    return explicitUid;
  }

  if (typeof globalThis !== 'undefined') {
    const scopedUid = normalizeUid(globalThis.__MEMORY_CUE_AUTH_USER_ID);
    if (scopedUid) {
      return scopedUid;
    }
  }

  if (typeof window !== 'undefined') {
    const scopedUid = normalizeUid(window.__MEMORY_CUE_AUTH_USER_ID);
    if (scopedUid) {
      return scopedUid;
    }
  }

  return '';
};

const readLocal = (key) => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[firestore-sync] Failed reading local cache', key, error);
    return [];
  }
};

const writeLocal = (key, items) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (error) {
    console.warn('[firestore-sync] Failed writing local cache', key, error);
  }
};

const mergeById = (items = []) => {
  const merged = new Map();

  items.forEach((item) => {
    if (!item?.id) {
      return;
    }

    merged.set(String(item.id), { ...item, id: String(item.id), pendingSync: false });
  });

  return Array.from(merged.values());
};

const normalizeNote = (note = {}) => {
  if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !note.id.trim()) {
    return null;
  }

  return {
    ...note,
    id: note.id.trim(),
    pendingSync: false,
  };
};

const normalizeInboxEntry = (entry = {}) => {
  const normalized = normalizeMemory({
    ...entry,
    type: 'inbox',
    source: entry?.source,
    entryPoint: entry?.entryPoint || 'firestoreSyncService.syncInbox',
  }, {
    type: 'inbox',
    source: 'capture',
    entryPoint: 'firestoreSyncService.syncInbox',
  });

  if (!normalized?.id || !normalized.text) {
    return null;
  }

  return {
    ...entry,
    id: normalized.id,
    text: normalized.text,
    type: 'inbox',
    tags: Array.isArray(normalized.tags) ? normalized.tags : [],
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    source: normalized.source,
    parsedType: typeof entry?.parsedType === 'string' && entry.parsedType.trim()
      ? entry.parsedType.trim()
      : 'unknown',
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    pendingSync: false,
    entryPoint: normalized.entryPoint,
  };
};

const normalizeChatEntry = (message = {}, conversationId = 'default') => {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const id = typeof message.id === 'string' && message.id.trim()
    ? message.id.trim()
    : (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `chat-${Date.now()}`);

  const content = typeof message.content === 'string' ? message.content : '';
  if (!content.trim()) {
    return null;
  }

  return {
    ...message,
    id,
    role: typeof message.role === 'string' && message.role.trim() ? message.role.trim() : 'user',
    content,
    conversationId: typeof message.conversationId === 'string' && message.conversationId.trim()
      ? message.conversationId.trim()
      : conversationId,
    createdAt: typeof message.createdAt === 'string' && message.createdAt
      ? message.createdAt
      : new Date().toISOString(),
    pendingSync: false,
  };
};

const getCollectionRef = (firebase, uid, collectionName) => (
  firebase.collection(firebase.db, 'users', requireUid(uid), collectionName)
);

const readRemoteCollection = async (collectionName, { uid, orderField = 'updatedAt' } = {}) => {
  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(uid);

  if (!firebase || !resolvedUid) {
    return null;
  }

  const collectionRef = getCollectionRef(firebase, resolvedUid, collectionName);
  const queryRef = typeof firebase.query === 'function' && typeof firebase.orderBy === 'function'
    ? firebase.query(collectionRef, firebase.orderBy(orderField, 'desc'))
    : collectionRef;
  const snapshot = await firebase.getDocs(queryRef);
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

const reconcileCollection = async ({
  localKey,
  collectionName,
  normalizeItem,
  localItemsOverride,
  uid,
  orderField = 'updatedAt',
}) => {
  const localItems = mergeById((Array.isArray(localItemsOverride) ? localItemsOverride : readLocal(localKey))
    .map((item) => normalizeItem(item))
    .filter(Boolean));

  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(uid);
  if (!firebase || !resolvedUid) {
    writeLocal(localKey, localItems);
    return localItems;
  }

  const remoteItems = await readRemoteCollection(collectionName, { uid: resolvedUid, orderField });
  const remoteIds = new Set(
    Array.isArray(remoteItems)
      ? remoteItems.map((item) => String(item?.id || '')).filter(Boolean)
      : []
  );
  const localIds = new Set(localItems.map((item) => String(item.id)));

  await Promise.all(localItems.map((item) => (
    firebase.setDoc(
      firebase.doc(firebase.db, 'users', resolvedUid, collectionName, requireUid(item.id)),
      item,
      { merge: true }
    )
  )));

  await Promise.all(Array.from(remoteIds)
    .filter((id) => !localIds.has(id))
    .map((id) => firebase.deleteDoc(firebase.doc(firebase.db, 'users', resolvedUid, collectionName, requireUid(id)))));

  writeLocal(localKey, localItems);
  return localItems;
};

const pullCollection = async ({
  localKey,
  collectionName,
  normalizeItem,
  uid,
  orderField = 'updatedAt',
}) => {
  const remoteItems = await readRemoteCollection(collectionName, { uid, orderField });
  if (!Array.isArray(remoteItems)) {
    return mergeById(readLocal(localKey).map((item) => normalizeItem(item)).filter(Boolean));
  }

  const normalized = mergeById(remoteItems.map((item) => normalizeItem(item)).filter(Boolean));
  writeLocal(localKey, normalized);
  return normalized;
};

export const syncNotes = async (localItemsOverride = null, options = {}) => {
  if (Array.isArray(localItemsOverride)) {
    return reconcileCollection({
      localKey: NOTES_KEY,
      collectionName: COLLECTIONS.notes,
      normalizeItem: normalizeNote,
      localItemsOverride,
      uid: options.uid,
      orderField: 'updatedAt',
    });
  }

  return pullCollection({
    localKey: NOTES_KEY,
    collectionName: COLLECTIONS.notes,
    normalizeItem: normalizeNote,
    uid: options.uid,
    orderField: 'updatedAt',
  });
};

export const syncInbox = async (localItemsOverride = null, options = {}) => {
  if (Array.isArray(localItemsOverride)) {
    return reconcileCollection({
      localKey: INBOX_KEY,
      collectionName: COLLECTIONS.inbox,
      normalizeItem: normalizeInboxEntry,
      localItemsOverride,
      uid: options.uid,
      orderField: 'updatedAt',
    });
  }

  const pulled = await pullCollection({
    localKey: INBOX_KEY,
    collectionName: COLLECTIONS.inbox,
    normalizeItem: normalizeInboxEntry,
    uid: options.uid,
    orderField: 'updatedAt',
  });
  return normalizeMemoryList(pulled, { type: 'inbox', source: 'capture' });
};

export const syncReminders = async () => normalizeReminderList(readLocal(REMINDERS_KEY));

export const syncChatHistory = async (localItemsOverride = null, options = {}) => {
  if (Array.isArray(localItemsOverride)) {
    return reconcileCollection({
      localKey: CHAT_KEY,
      collectionName: COLLECTIONS.chat,
      normalizeItem: (item) => normalizeChatEntry(item, item?.conversationId || 'default'),
      localItemsOverride,
      uid: options.uid,
      orderField: 'createdAt',
    });
  }

  return pullCollection({
    localKey: CHAT_KEY,
    collectionName: COLLECTIONS.chat,
    normalizeItem: (item) => normalizeChatEntry(item, item?.conversationId || 'default'),
    uid: options.uid,
    orderField: 'createdAt',
  });
};

export const pushChanges = async (options = {}) => Promise.all([
  syncNotes(readLocal(NOTES_KEY), options),
  syncInbox(readLocal(INBOX_KEY), options),
  syncChatHistory(readLocal(CHAT_KEY), options),
]);

export const pullChanges = async (options = {}) => Promise.all([
  syncNotes(null, options),
  syncInbox(null, options),
  syncChatHistory(null, options),
]);

export const upsertInboxEntry = async (entry, options = {}) => {
  const normalizedEntry = normalizeInboxEntry(entry);
  if (!normalizedEntry?.id) return;

  const cached = mergeById([
    normalizedEntry,
    ...readLocal(INBOX_KEY).map((item) => normalizeInboxEntry(item)).filter(Boolean),
  ]);
  await syncInbox(cached, options);
};

export const upsertReminder = async (reminder) => {
  const cached = normalizeReminderList([
    reminder,
    ...readLocal(REMINDERS_KEY),
  ]);
  writeLocal(REMINDERS_KEY, cached);
};

export const deleteReminder = async (id) => {
  writeLocal(REMINDERS_KEY, readLocal(REMINDERS_KEY).filter((item) => String(item?.id) !== String(id)));
};

export const appendChatMessage = async (message, conversationId = 'default', options = {}) => {
  const entry = normalizeChatEntry(message, conversationId);
  if (!entry?.id) {
    return;
  }

  const cached = mergeById([
    ...readLocal(CHAT_KEY).map((item) => normalizeChatEntry(item, item?.conversationId || 'default')).filter(Boolean),
    entry,
  ]);
  await syncChatHistory(cached, options);
};

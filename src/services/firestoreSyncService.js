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

const SYNC_EVENTS = Object.freeze({
  [NOTES_KEY]: 'memoryCue:notesUpdated',
  [INBOX_KEY]: 'memoryCue:entriesUpdated',
  [CHAT_KEY]: 'memoryCue:chatUpdated',
});

const normalizeUid = (value) => (typeof value === 'string' ? value.trim() : '');

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

// Merge a remote snapshot into the locally-cached items WITHOUT dropping unsynced local
// edits. A live snapshot or pull that hasn't caught up to a just-written local item would
// otherwise erase it (e.g. a chat message vanishing right after you type it).
//   - present in both: remote wins, unless the local copy is pendingSync and at least as new
//   - remote only: added
//   - local only: kept ONLY if pendingSync (otherwise it was deleted remotely)
export const mergeRemoteWithLocal = (localItems, remoteItems, orderField = 'updatedAt') => {
  const localById = new Map();
  (Array.isArray(localItems) ? localItems : []).forEach((item) => {
    if (item && item.id != null) {
      localById.set(String(item.id), item);
    }
  });
  const remoteById = new Map();
  (Array.isArray(remoteItems) ? remoteItems : []).forEach((item) => {
    if (item && item.id != null) {
      remoteById.set(String(item.id), item);
    }
  });

  const merged = [];
  remoteById.forEach((remoteItem, id) => {
    const localItem = localById.get(id);
    if (
      localItem
      && localItem.pendingSync
      && toTimestamp(localItem[orderField]) >= toTimestamp(remoteItem[orderField])
    ) {
      merged.push(localItem);
    } else {
      merged.push(remoteItem);
    }
  });
  localById.forEach((localItem, id) => {
    if (!remoteById.has(id) && localItem.pendingSync) {
      merged.push(localItem);
    }
  });
  return merged;
};
const INBOX_SOURCE_VALUES = new Set(['capture', 'reminder', 'assistant', 'quick-add']);

const normalizeInboxSource = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return INBOX_SOURCE_VALUES.has(normalized) ? normalized : 'capture';
};

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

const dispatchSyncEvent = (key, items) => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  const eventName = SYNC_EVENTS[key];
  if (!eventName) {
    return;
  }

  document.dispatchEvent(new CustomEvent(eventName, {
    detail: {
      key,
      items: Array.isArray(items) ? items : [],
    },
  }));
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
    source: normalizeInboxSource(entry?.source || normalized.source),
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
  const remoteNormalized = Array.isArray(remoteItems)
    ? remoteItems.map((item) => normalizeItem(item)).filter(Boolean)
    : [];
  const remoteById = new Map(remoteNormalized.map((item) => [String(item.id), item]));

  // Only push local items that are new or at least as recent as the remote copy, so a stale
  // local item can't overwrite a newer edit made on another device.
  const itemsToPush = localItems.filter((item) => {
    const remote = remoteById.get(String(item.id));
    return !remote || toTimestamp(item[orderField]) >= toTimestamp(remote[orderField]);
  });

  await Promise.all(itemsToPush.map((item) => (
    firebase.setDoc(
      firebase.doc(firebase.db, 'users', resolvedUid, collectionName, requireUid(item.id)),
      item,
      { merge: true }
    )
  )));

  // Merge remote into local (newest wins) so a push never drops items that exist only on
  // another device, instead of overwriting the local cache with local-only data.
  const mergedById = new Map(remoteById);
  localItems.forEach((item) => {
    const remote = remoteById.get(String(item.id));
    if (!remote || toTimestamp(item[orderField]) >= toTimestamp(remote[orderField])) {
      mergedById.set(String(item.id), item);
    }
  });

  const merged = Array.from(mergedById.values());
  writeLocal(localKey, merged);
  return merged;
};

const deleteCollectionItem = async ({
  localKey,
  collectionName,
  normalizeItem,
  id,
  uid,
}) => {
  const normalizedId = typeof id === 'string' ? id.trim() : String(id || '').trim();
  if (!normalizedId) {
    return false;
  }

  const remainingItems = mergeById(
    readLocal(localKey)
      .map((item) => normalizeItem(item))
      .filter(Boolean)
      .filter((item) => String(item.id) !== normalizedId)
  );

  writeLocal(localKey, remainingItems);
  dispatchSyncEvent(localKey, remainingItems);

  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(uid);
  if (!firebase || !resolvedUid) {
    return true;
  }

  await firebase.deleteDoc(
    firebase.doc(firebase.db, 'users', resolvedUid, collectionName, requireUid(normalizedId))
  );

  return true;
};

const clearCollection = async ({
  localKey,
  collectionName,
  uid,
}) => {
  writeLocal(localKey, []);
  dispatchSyncEvent(localKey, []);

  const remoteItems = await readRemoteCollection(collectionName, { uid });
  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(uid);
  if (!firebase || !resolvedUid || !Array.isArray(remoteItems) || !remoteItems.length) {
    return [];
  }

  await Promise.all(
    remoteItems
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
      .map((id) => firebase.deleteDoc(
        firebase.doc(firebase.db, 'users', resolvedUid, collectionName, requireUid(id))
      ))
  );

  return [];
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

  const remoteNormalized = mergeById(remoteItems.map((item) => normalizeItem(item)).filter(Boolean));
  // Keep unsynced local items the remote pull hasn't caught up to yet.
  const merged = mergeRemoteWithLocal(readLocal(localKey), remoteNormalized, orderField);
  writeLocal(localKey, merged);
  dispatchSyncEvent(localKey, merged);
  return merged;
};

const subscribeToCollection = async ({
  localKey,
  collectionName,
  normalizeItem,
  uid,
  orderField = 'updatedAt',
  onItems = null,
}) => {
  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(uid);

  if (!firebase || !resolvedUid || typeof firebase.onSnapshot !== 'function') {
    return () => {};
  }

  const collectionRef = getCollectionRef(firebase, resolvedUid, collectionName);
  const queryRef = typeof firebase.query === 'function' && typeof firebase.orderBy === 'function'
    ? firebase.query(collectionRef, firebase.orderBy(orderField, 'desc'))
    : collectionRef;

  return firebase.onSnapshot(queryRef, (snapshot) => {
    const remoteNormalized = mergeById(
      snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .map((item) => normalizeItem(item))
        .filter(Boolean)
    );

    // Merge rather than overwrite, so a snapshot that predates a just-written local item
    // (e.g. a chat message you just typed) doesn't erase it before it has synced.
    const merged = mergeRemoteWithLocal(readLocal(localKey), remoteNormalized, orderField);
    writeLocal(localKey, merged);
    dispatchSyncEvent(localKey, merged);

    const normalized = merged;
    if (typeof onItems === 'function') {
      try {
        onItems(normalized);
      } catch (error) {
        console.warn('[firestore-sync] Subscriber callback failed', error);
      }
    }
  }, (error) => {
    console.warn(`[firestore-sync] Live sync failed for ${collectionName}`, error);
  });
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

export const subscribeToNotesChanges = async (options = {}) => subscribeToCollection({
  localKey: NOTES_KEY,
  collectionName: COLLECTIONS.notes,
  normalizeItem: normalizeNote,
  uid: options.uid,
  orderField: 'updatedAt',
  onItems: options.onItems,
});

export const subscribeToInboxChanges = async (options = {}) => subscribeToCollection({
  localKey: INBOX_KEY,
  collectionName: COLLECTIONS.inbox,
  normalizeItem: normalizeInboxEntry,
  uid: options.uid,
  orderField: 'updatedAt',
  onItems: options.onItems,
});

export const subscribeToChatHistoryChanges = async (options = {}) => subscribeToCollection({
  localKey: CHAT_KEY,
  collectionName: COLLECTIONS.chat,
  normalizeItem: (item) => normalizeChatEntry(item, item?.conversationId || 'default'),
  uid: options.uid,
  orderField: 'createdAt',
  onItems: options.onItems,
});

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

export const deleteNote = async (id, options = {}) => deleteCollectionItem({
  localKey: NOTES_KEY,
  collectionName: COLLECTIONS.notes,
  normalizeItem: normalizeNote,
  id,
  uid: options.uid,
});

export const deleteInboxEntry = async (id, options = {}) => deleteCollectionItem({
  localKey: INBOX_KEY,
  collectionName: COLLECTIONS.inbox,
  normalizeItem: normalizeInboxEntry,
  id,
  uid: options.uid,
});

export const clearRemoteChatHistory = async (options = {}) => clearCollection({
  localKey: CHAT_KEY,
  collectionName: COLLECTIONS.chat,
  uid: options.uid,
});

export const appendChatMessage = async (message, conversationId = 'default', options = {}) => {
  const entry = normalizeChatEntry(message, conversationId);
  if (!entry?.id) {
    return;
  }

  // Push ONLY this message to Firestore; do not rewrite the local cache here.
  // The message is already cached locally (with pendingSync:true). Clearing that flag
  // before the live snapshot has confirmed the message lets a stale snapshot treat it as
  // deleted and erase it (a message vanishing right after it appears). Leaving the local
  // copy untouched keeps it pending until the snapshot merge confirms it from the server.
  const firebase = await getFirebaseContext();
  const resolvedUid = resolveUid(options.uid);
  if (!firebase || !resolvedUid) {
    return;
  }

  await firebase.setDoc(
    firebase.doc(firebase.db, 'users', resolvedUid, COLLECTIONS.chat, requireUid(entry.id)),
    entry,
    { merge: true },
  );
};

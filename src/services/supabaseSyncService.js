import { getSupabaseClient } from '../../js/supabase-client.js';

const NOTES_KEY = 'memoryCueNotes';
const INBOX_KEY = 'memoryCueInbox';
const REMINDERS_KEY = 'memoryCue:offlineReminders';
const CHAT_KEY = 'memoryCueChatHistory';

const TABLES = {
  notes: 'notes',
  inbox: 'inbox',
  reminders: 'reminders',
  chat: 'chat_messages',
};

const readLocal = (key) => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[supabase-sync] Failed reading local cache', key, error);
    return [];
  }
};

const writeLocal = (key, items) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (error) {
    console.warn('[supabase-sync] Failed writing local cache', key, error);
  }
};

const toMs = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getUpdatedMs = (item = {}) => toMs(item.updated_at || item.updatedAt || item.created_at || item.createdAt);

const markSynced = (item = {}) => ({ ...item, pendingSync: false });

const mergeByLatest = (localItems = [], remoteItems = []) => {
  const merged = new Map();
  remoteItems.forEach((item) => {
    if (item?.id) merged.set(String(item.id), item);
  });
  localItems.forEach((item) => {
    if (!item?.id) return;
    const id = String(item.id);
    const existing = merged.get(id);
    if (!existing || getUpdatedMs(item) >= getUpdatedMs(existing)) {
      merged.set(id, item);
    }
  });
  return Array.from(merged.values());
};

const getCurrentUserId = async () => {
  if (typeof window === 'undefined') return null;
  const userId = typeof window.__MEMORY_CUE_AUTH_USER_ID === 'string'
    ? window.__MEMORY_CUE_AUTH_USER_ID.trim()
    : '';
  return userId || null;
};

const mapNoteToRow = (item, userId) => ({
  id: item.id,
  user_id: userId,
  title: item.title || 'Untitled note',
  body: item.bodyHtml || item.body || '',
  body_html: item.bodyHtml || item.body || '',
  body_text: item.bodyText || '',
  folder_id: item.folderId || null,
  metadata: item.metadata || null,
  links: item.links || [],
  pinned: !!item.pinned,
  created_at: item.createdAt || new Date().toISOString(),
  updated_at: item.updatedAt || new Date().toISOString(),
});

const mapInboxToRow = (item, userId) => ({
  id: item.id,
  user_id: userId,
  text: item.text || '',
  tags: Array.isArray(item.tags) ? item.tags : [],
  source: item.source || 'capture',
  parsed_type: item.parsedType || 'unknown',
  metadata: item.metadata || null,
  created_at: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
  updated_at: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString(),
});

const mapReminderToRow = (item, userId) => ({
  id: item.id,
  user_id: userId,
  title: item.title || '',
  notes: item.notes || '',
  priority: item.priority || 'Medium',
  category: item.category || null,
  done: !!item.done,
  due: item.due || null,
  created_at: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
  updated_at: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString(),
  order_index: Number.isFinite(item.orderIndex) ? item.orderIndex : null,
  metadata: item.metadata || null,
});

const mapChatToRow = (item, userId) => ({
  id: item.id,
  user_id: userId,
  role: item.role || 'user',
  content: item.content || '',
  created_at: item.createdAt || new Date().toISOString(),
  conversation_id: item.conversationId || 'default',
});

async function syncDomain({ key, table, mapToRow, mapFromRow = (row) => row, localItemsOverride = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[storage] supabase unavailable — using local only');
    return readLocal(key);
  }

  const userId = await getCurrentUserId();
  if (!userId) return readLocal(key);

  const localItems = Array.isArray(localItemsOverride) ? localItemsOverride : readLocal(key);
  const pendingItems = localItems.filter((item) => item?.id && item.pendingSync !== false);

  if (pendingItems.length) {
    const { error } = await supabase.from(table).upsert(pendingItems.map((item) => mapToRow(item, userId)));
    if (!error) {
      const syncedIds = new Set(pendingItems.map((item) => String(item.id)));
      const nextItems = localItems.map((item) => (syncedIds.has(String(item?.id)) ? markSynced(item) : item));
      writeLocal(key, nextItems);
    } else {
      console.warn(`[supabase-sync] Failed pushing ${table}`, error);
    }
  }

  const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
  if (error) {
    console.warn(`[supabase-sync] Failed pulling ${table}`, error);
    return readLocal(key);
  }

  const remoteItems = Array.isArray(data) ? data.map((row) => mapFromRow(row)).filter(Boolean) : [];
  const merged = mergeByLatest(readLocal(key), remoteItems).map(markSynced);
  writeLocal(key, merged);
  return merged;
}


const mapNoteFromRow = (row = {}) => ({
  id: row.id,
  title: row.title || 'Untitled note',
  body: row.body_html || row.body || '',
  bodyHtml: row.body_html || row.body || '',
  bodyText: row.body_text || '',
  folderId: row.folder_id || null,
  metadata: row.metadata || null,
  links: Array.isArray(row.links) ? row.links : [],
  pinned: !!row.pinned,
  createdAt: row.created_at || new Date().toISOString(),
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
});

const mapInboxFromRow = (row = {}) => ({
  id: row.id,
  text: row.text || '',
  tags: Array.isArray(row.tags) ? row.tags : [],
  source: row.source || 'capture',
  parsedType: row.parsed_type || 'unknown',
  metadata: row.metadata || {},
  createdAt: row.created_at ? Date.parse(row.created_at) || Date.now() : Date.now(),
  updatedAt: row.updated_at ? Date.parse(row.updated_at) || Date.now() : Date.now(),
  pendingSync: false,
});

const mapReminderFromRow = (row = {}) => ({
  id: row.id,
  title: row.title || '',
  notes: row.notes || '',
  priority: row.priority || 'Medium',
  category: row.category || null,
  done: !!row.done,
  due: row.due || null,
  createdAt: row.created_at ? Date.parse(row.created_at) || Date.now() : Date.now(),
  updatedAt: row.updated_at ? Date.parse(row.updated_at) || Date.now() : Date.now(),
  orderIndex: Number.isFinite(row.order_index) ? row.order_index : null,
  metadata: row.metadata || null,
  pendingSync: false,
});

const mapChatFromRow = (row = {}) => ({
  id: row.id,
  role: row.role || 'user',
  content: row.content || '',
  conversationId: row.conversation_id || 'default',
  createdAt: row.created_at || new Date().toISOString(),
  pendingSync: false,
});

export const syncNotes = (localItemsOverride = null) => syncDomain({ key: NOTES_KEY, table: TABLES.notes, mapToRow: mapNoteToRow, mapFromRow: mapNoteFromRow, localItemsOverride });
export const syncInbox = () => syncDomain({ key: INBOX_KEY, table: TABLES.inbox, mapToRow: mapInboxToRow, mapFromRow: mapInboxFromRow });
export const syncReminders = () => syncDomain({ key: REMINDERS_KEY, table: TABLES.reminders, mapToRow: mapReminderToRow, mapFromRow: mapReminderFromRow });
export const syncChatHistory = () => syncDomain({ key: CHAT_KEY, table: TABLES.chat, mapToRow: mapChatToRow, mapFromRow: mapChatFromRow });

export const pushChanges = async () => {
  await Promise.allSettled([syncNotes(), syncInbox(), syncReminders(), syncChatHistory()]);
};

export const pullChanges = async () => {
  await Promise.allSettled([syncNotes(), syncInbox(), syncReminders(), syncChatHistory()]);
};

export const upsertInboxEntry = async (entry) => {
  if (!entry?.id) return;
  const cached = readLocal(INBOX_KEY);
  const existingIndex = cached.findIndex((item) => String(item?.id) === String(entry.id));
  const nextEntry = { ...entry, pendingSync: true, updatedAt: Date.now() };
  if (existingIndex >= 0) {
    cached[existingIndex] = { ...cached[existingIndex], ...nextEntry };
  } else {
    cached.unshift(nextEntry);
  }
  writeLocal(INBOX_KEY, cached);
  await syncInbox();
};

export const upsertReminder = async (reminder) => {
  if (!reminder?.id) return;
  const cached = readLocal(REMINDERS_KEY);
  const existingIndex = cached.findIndex((item) => String(item?.id) === String(reminder.id));
  const nextReminder = { ...reminder, pendingSync: true, updatedAt: Date.now() };
  if (existingIndex >= 0) cached[existingIndex] = { ...cached[existingIndex], ...nextReminder };
  else cached.unshift(nextReminder);
  writeLocal(REMINDERS_KEY, cached);
  await syncReminders();
};

export const deleteReminder = async (id) => {
  const supabase = getSupabaseClient();
  const userId = supabase ? await getCurrentUserId() : null;
  const cached = readLocal(REMINDERS_KEY).filter((item) => String(item?.id) !== String(id));
  writeLocal(REMINDERS_KEY, cached);
  if (supabase && userId) {
    await supabase.from(TABLES.reminders).delete().eq('id', id).eq('user_id', userId);
  }
};

export const appendChatMessage = async (message, conversationId = 'default') => {
  const entry = {
    id: message?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}`),
    role: message?.role || 'user',
    content: message?.content || '',
    conversationId,
    createdAt: message?.createdAt || new Date().toISOString(),
    pendingSync: true,
  };
  const cached = readLocal(CHAT_KEY);
  const exists = cached.some((item) => String(item?.id) === String(entry.id));
  if (!exists) {
    cached.push(entry);
    writeLocal(CHAT_KEY, cached);
  }
  await syncChatHistory();
};

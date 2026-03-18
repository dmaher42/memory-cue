import { normalizeReminder, normalizeReminderList } from '../reminders/reminderNormalizer.js';
import { normalizeMemoryList } from './memoryService.js';

const NOTES_KEY = 'memoryCueNotes';
const INBOX_KEY = 'memoryCueInbox';
const REMINDERS_KEY = 'memoryCue:offlineReminders';
const CHAT_KEY = 'memoryCueChatHistory';

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
    if (item?.id) {
      merged.set(String(item.id), { ...item, pendingSync: false });
    }
  });
  return Array.from(merged.values());
};

export const syncNotes = async (localItemsOverride = null) => {
  const nextItems = Array.isArray(localItemsOverride) ? localItemsOverride : readLocal(NOTES_KEY);
  writeLocal(NOTES_KEY, mergeById(nextItems));
  return readLocal(NOTES_KEY);
};

export const syncInbox = async () => normalizeMemoryList(readLocal(INBOX_KEY), { type: 'inbox', source: 'capture' });
export const syncReminders = async () => normalizeReminderList(readLocal(REMINDERS_KEY));
export const syncChatHistory = async () => readLocal(CHAT_KEY);
export const pushChanges = async () => {};
export const pullChanges = async () => {};

export const upsertInboxEntry = async (entry) => {
  if (!entry?.id) return;
  const cached = normalizeMemoryList(readLocal(INBOX_KEY), { type: 'inbox', source: 'capture' })
    .filter((item) => String(item?.id) !== String(entry.id));
  cached.unshift({ ...entry, type: 'inbox', pendingSync: false, updatedAt: Date.now() });
  writeLocal(INBOX_KEY, cached);
};

export const upsertReminder = async (reminder) => {
  const normalizedReminder = normalizeReminder(reminder);
  if (!normalizedReminder?.id) return;
  const cached = normalizeReminderList(readLocal(REMINDERS_KEY))
    .filter((item) => String(item?.id) !== String(normalizedReminder.id));
  cached.unshift(normalizeReminder({ ...normalizedReminder, updatedAt: Date.now() }));
  writeLocal(REMINDERS_KEY, cached);
};

export const deleteReminder = async (id) => {
  writeLocal(REMINDERS_KEY, readLocal(REMINDERS_KEY).filter((item) => String(item?.id) !== String(id)));
};

export const appendChatMessage = async (message, conversationId = 'default') => {
  const entry = {
    id: message?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}`),
    role: message?.role || 'user',
    content: message?.content || '',
    conversationId,
    createdAt: message?.createdAt || new Date().toISOString(),
    pendingSync: false,
  };
  const cached = readLocal(CHAT_KEY);
  if (!cached.some((item) => String(item?.id) === String(entry.id))) {
    cached.push(entry);
    writeLocal(CHAT_KEY, cached);
  }
};

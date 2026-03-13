import { upsertInboxEntry } from './supabaseSyncService.js';
const INBOX_STORAGE_KEY = 'memoryCueInbox';

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const sanitizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
};

export const getInboxEntries = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[inbox-service] Failed to load inbox entries', error);
    return [];
  }
};

const persistInboxEntries = (entries) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('[inbox-service] Failed to persist inbox entries', error);
  }
};

const dispatchInboxUpdated = () => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memoryCue:entriesUpdated'));
};

export const saveToInbox = (text) => {
  const normalizedText = sanitizeText(text);
  if (!normalizedText) {
    return null;
  }

  const entry = {
    id: generateId(),
    text: normalizedText,
    createdAt: Date.now(),
    processed: false,
    tags: [],
    pendingSync: true,
  };

  const entries = getInboxEntries();
  entries.push(entry);
  persistInboxEntries(entries);
  dispatchInboxUpdated();
  upsertInboxEntry(entry).catch((error) => {
    console.warn('[inbox-service] Supabase inbox sync failed', error);
  });

  return entry;
};

export const removeInboxEntry = (id) => {
  const targetId = typeof id === 'string' ? id.trim() : String(id || '').trim();
  if (!targetId) {
    return false;
  }

  const entries = getInboxEntries();
  const nextEntries = entries.filter((entry) => String(entry?.id || '') !== targetId);
  if (nextEntries.length === entries.length) {
    return false;
  }

  persistInboxEntries(nextEntries);
  dispatchInboxUpdated();
  return true;
};

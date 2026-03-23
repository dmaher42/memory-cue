import { syncInbox, upsertInboxEntry } from './firestoreSyncService.js';
import { indexSourceEmbedding } from './embeddingService.js';
import { saveMemory, normalizeMemory } from './memoryService.js';

export const INBOX_STORAGE_KEY = 'memoryCueInbox';
const LEGACY_INBOX_STORAGE_KEYS = ['memoryEntries'];
const PARSED_TYPE_VALUES = new Set(['note', 'reminder', 'idea', 'lesson_idea', 'coaching_drill', 'question', 'unknown']);
const SOURCE_VALUES = new Set(['capture', 'reminder', 'assistant', 'quick-add']);

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

const normalizeSource = (source) => {
  const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return SOURCE_VALUES.has(normalized) ? normalized : 'capture';
};

const normalizeParsedType = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'unknown';
  return PARSED_TYPE_VALUES.has(normalized) ? normalized : 'unknown';
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    .filter(Boolean);
};


const normalizeInboxEntry = (entryInput = {}) => {
  const canonical = normalizeMemory({
    ...entryInput,
    type: 'inbox',
    source: entryInput?.source,
    entryPoint: entryInput?.entryPoint || 'inboxService.saveInboxEntry',
  }, {
    source: 'capture',
    entryPoint: 'inboxService.saveInboxEntry',
  });

  return {
    id: canonical.id,
    text: canonical.text,
    type: canonical.type,
    tags: canonical.tags,
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
    source: canonical.source,
    parsedType: normalizeParsedType(entryInput?.parsedType || 'unknown'),
    metadata: entryInput?.metadata && typeof entryInput.metadata === 'object' ? entryInput.metadata : {},
    pendingSync: canonical.pendingSync,
    entryPoint: canonical.entryPoint,
  };
};
export const getInboxEntries = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_INBOX_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (!legacyRaw) continue;
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed) && legacyParsed.length) {
          const normalizedLegacy = legacyParsed.map((entry) => normalizeInboxEntry(entry)).filter((entry) => entry.text);
          localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(normalizedLegacy));
          localStorage.removeItem(legacyKey);
          return normalizedLegacy;
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((entry) => normalizeInboxEntry(entry)).filter((entry) => entry.text)
      : [];
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

  return saveInboxEntry({ text: normalizedText });
};

export const saveInboxEntry = (entryInput = {}) => {
  const normalizedText = sanitizeText(entryInput?.text);
  if (!normalizedText) {
    return null;
  }

  const timestamp = Date.now();
  const entry = normalizeInboxEntry({
    id: typeof entryInput?.id === 'string' && entryInput.id.trim() ? entryInput.id.trim() : generateId(),
    text: normalizedText,
    tags: normalizeTags(entryInput?.tags),
    createdAt: Number.isFinite(entryInput?.createdAt) ? entryInput.createdAt : timestamp,
    source: normalizeSource(entryInput?.source),
    parsedType: normalizeParsedType(entryInput?.parsedType),
    metadata: entryInput?.metadata && typeof entryInput.metadata === 'object' ? entryInput.metadata : {},
    pendingSync: true,
    updatedAt: timestamp,
    entryPoint: entryInput?.entryPoint,
  });

  const entries = getInboxEntries();
  entries.unshift(entry);
  persistInboxEntries(entries);
  dispatchInboxUpdated();
  upsertInboxEntry(entry).catch((error) => {
    console.warn('[inbox-service] Firebase inbox sync failed', error);
  });

  indexSourceEmbedding({
    text: entry.text,
    sourceType: 'inbox',
    sourceId: entry.id,
  }).catch((error) => {
    console.warn('[embedding] Failed to index inbox embedding', error);
  });

  saveMemory({
    id: entry.id,
    text: entry.text,
    type: 'inbox',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    source: entry.source,
    entryPoint: entry.entryPoint,
    tags: entry.tags,
  }).catch((error) => {
    console.warn('[memory-service] Failed to save inbox memory', error);
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
  syncInbox(nextEntries).catch((error) => {
    console.warn('[inbox-service] Firebase inbox deletion sync failed', error);
  });
  return true;
};

import { getSupabaseClient } from '../../js/supabase-client.js';
import { learnPattern } from './patternLearningService.js';

const MEMORY_CACHE_KEY = 'memoryCueCache';
const LEGACY_KEYS = ['memoryCueNotes', 'mobileNotes', 'memory-cue-notes', 'memoryCueInbox'];
const MEMORY_TYPES = new Set(['note', 'reminder', 'idea', 'task', 'inbox']);
const DEFAULT_RECENT_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 10;
const SUPABASE_TABLE = 'memories';

let memoryCache = [];
let migrationChecked = false;
let syncInFlight = null;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeNumber = (value, fallback = Date.now()) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
};

const normalizeType = (value) => {
  const type = normalizeText(value).toLowerCase();
  return MEMORY_TYPES.has(type) ? type : 'note';
};

const getCurrentUserId = () => {
  if (typeof window === 'undefined') {
    return 'local-user';
  }

  const userId = normalizeText(window.__MEMORY_CUE_AUTH_USER_ID);
  return userId || 'local-user';
};

const normalizeEmbedding = (value) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

  return numbers.length ? numbers : undefined;
};

const toMemoryShape = (entry = {}, fallback = {}) => {
  const now = Date.now();
  const createdAt = normalizeNumber(entry.createdAt, now);
  const updatedAt = normalizeNumber(entry.updatedAt, createdAt);
  const resolvedId = normalizeText(entry.id)
    || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `memory-${updatedAt}`);

  return {
    id: resolvedId,
    userId: normalizeText(entry.userId) || fallback.userId || getCurrentUserId(),
    text: normalizeText(entry.text),
    type: normalizeType(entry.type),
    createdAt,
    updatedAt,
    source: normalizeText(entry.source) || fallback.source || 'capture',
    entryPoint: normalizeText(entry.entryPoint) || fallback.entryPoint || 'capture',
    tags: normalizeTags(entry.tags),
    embedding: normalizeEmbedding(entry.embedding),
    pendingSync: entry.pendingSync === false ? false : true,
  };
};

const readCacheFromStorage = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(MEMORY_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => toMemoryShape(item)).filter((item) => item.text);
  } catch (error) {
    console.warn('[memory-service] Failed to read memory cache', error);
    return [];
  }
};

const writeCacheToStorage = (entries = []) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(MEMORY_CACHE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('[memory-service] Failed to write memory cache', error);
  }
};

const mergeByLatest = (entries = []) => {
  const merged = new Map();
  entries.forEach((entry) => {
    if (!entry?.id) {
      return;
    }

    const existing = merged.get(entry.id);
    if (!existing || normalizeNumber(entry.updatedAt, 0) >= normalizeNumber(existing.updatedAt, 0)) {
      merged.set(entry.id, entry);
    }
  });

  return Array.from(merged.values());
};

const fromSupabaseRow = (row = {}) => toMemoryShape({
  id: row.id,
  userId: row.user_id,
  text: row.text,
  type: row.type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  source: row.source,
  entryPoint: row.entry_point,
  tags: row.tags,
  embedding: row.embedding,
  pendingSync: false,
});

const toSupabaseRow = (memory = {}) => ({
  id: memory.id,
  user_id: memory.userId,
  text: memory.text,
  type: memory.type,
  created_at: new Date(memory.createdAt).toISOString(),
  updated_at: new Date(memory.updatedAt).toISOString(),
  source: memory.source,
  entry_point: memory.entryPoint,
  tags: Array.isArray(memory.tags) ? memory.tags : [],
  embedding: Array.isArray(memory.embedding) ? memory.embedding : null,
});

const migrateLegacyEntries = () => {
  if (migrationChecked || typeof localStorage === 'undefined') {
    return;
  }

  migrationChecked = true;
  const migrated = [];

  LEGACY_KEYS.forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      parsed.forEach((item) => {
        const memory = toMemoryShape({
          id: item?.id,
          text: item?.text || item?.bodyText || item?.body || item?.title,
          type: key === 'memoryCueInbox' ? 'inbox' : item?.type || item?.parsedType || 'note',
          createdAt: item?.createdAt || item?.updatedAt,
          updatedAt: item?.updatedAt || item?.createdAt,
          source: item?.source || 'capture',
          entryPoint: key,
          tags: item?.tags || item?.keywords,
        });

        if (memory.text) {
          migrated.push(memory);
        }
      });
    } catch (error) {
      console.warn('[memory-service] Failed migrating key', key, error);
    }
  });

  if (!migrated.length) {
    return;
  }

  memoryCache = mergeByLatest([...memoryCache, ...migrated]);
  writeCacheToStorage(memoryCache);
  console.info('[brain] memory_migrated', { count: migrated.length });
};

const ensureCacheLoaded = () => {
  if (!memoryCache.length) {
    memoryCache = readCacheFromStorage();
  }

  migrateLegacyEntries();
};

const cosineSimilarity = (left = [], right = []) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return -1;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (!leftNorm || !rightNorm) {
    return -1;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const triggerSync = async () => {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    const userId = getCurrentUserId();
    const pending = memoryCache.filter((item) => item.pendingSync !== false && item.userId === userId);

    if (pending.length) {
      const { error } = await supabase.from(SUPABASE_TABLE).upsert(pending.map((item) => toSupabaseRow(item)));
      if (error) {
        console.warn('[memory-service] Failed pushing memories', error);
      } else {
        const syncedIds = new Set(pending.map((item) => item.id));
        memoryCache = memoryCache.map((item) => (syncedIds.has(item.id) ? { ...item, pendingSync: false } : item));
      }
    }

    const { data, error } = await supabase.from(SUPABASE_TABLE).select('*').eq('user_id', userId);
    if (error) {
      console.warn('[memory-service] Failed pulling memories', error);
      return;
    }

    const remote = Array.isArray(data) ? data.map((row) => fromSupabaseRow(row)) : [];
    memoryCache = mergeByLatest([...memoryCache, ...remote]);
    writeCacheToStorage(memoryCache);
  })()
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
};

const lexicalSearch = (query, limit = DEFAULT_SEARCH_LIMIT) => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return memoryCache
    .filter((memory) => {
      const text = normalizeText(memory.text).toLowerCase();
      const tags = Array.isArray(memory.tags) ? memory.tags.join(' ') : '';
      return text.includes(normalizedQuery) || tags.includes(normalizedQuery);
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
};

const semanticSearch = (queryEmbedding, limit = DEFAULT_SEARCH_LIMIT) => memoryCache
  .map((memory) => ({
    memory,
    score: cosineSimilarity(queryEmbedding, memory.embedding),
  }))
  .filter((item) => item.score > -1)
  .sort((left, right) => right.score - left.score)
  .slice(0, limit)
  .map((item) => item.memory);

ensureCacheLoaded();
void triggerSync();

export const saveMemory = async (memory = {}) => {
  ensureCacheLoaded();

  const nextMemory = toMemoryShape(memory, {
    source: normalizeText(memory.source) || 'capture',
    entryPoint: normalizeText(memory.entryPoint) || 'capture',
  });

  if (!nextMemory.text) {
    return null;
  }

  memoryCache = mergeByLatest([
    ...memoryCache,
    {
      ...nextMemory,
      updatedAt: Date.now(),
      pendingSync: true,
    },
  ]);

  writeCacheToStorage(memoryCache);
  learnPattern(nextMemory);
  console.info('[brain] memory_saved', {
    id: nextMemory.id,
    type: nextMemory.type,
    source: nextMemory.source,
  });

  void triggerSync();
  return nextMemory;
};

export const getMemoryById = (id) => {
  ensureCacheLoaded();
  void triggerSync();

  const targetId = normalizeText(id);
  if (!targetId) {
    return null;
  }

  return memoryCache.find((memory) => memory.id === targetId) || null;
};

export const getRecentMemories = (limit = DEFAULT_RECENT_LIMIT) => {
  ensureCacheLoaded();
  void triggerSync();

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : DEFAULT_RECENT_LIMIT;

  return [...memoryCache]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, safeLimit);
};

export const searchMemories = (queryEmbedding, limit = DEFAULT_SEARCH_LIMIT) => {
  ensureCacheLoaded();
  void triggerSync();

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : DEFAULT_SEARCH_LIMIT;

  if (Array.isArray(queryEmbedding)) {
    return semanticSearch(queryEmbedding, safeLimit);
  }

  return lexicalSearch(queryEmbedding, safeLimit);
};

export const deleteMemory = async (id) => {
  ensureCacheLoaded();

  const targetId = normalizeText(id);
  if (!targetId) {
    return false;
  }

  const existing = memoryCache.find((item) => item.id === targetId);
  if (!existing) {
    return false;
  }

  memoryCache = memoryCache.filter((item) => item.id !== targetId);
  writeCacheToStorage(memoryCache);

  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .delete()
      .eq('id', targetId)
      .eq('user_id', existing.userId);

    if (error) {
      console.warn('[memory-service] Failed deleting memory', error);
      return false;
    }
  }

  return true;
};

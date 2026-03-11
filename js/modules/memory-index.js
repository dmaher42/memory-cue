import { getFolderNameById, loadAllNotes } from './notes-storage.js';

const MAX_SEARCH_RESULTS = 5;
const DEFAULT_RECENT_LIMIT = 20;
const ALLOWED_MEMORY_TYPES = new Set([
  'task',
  'lesson-idea',
  'lesson-reflection',
  'footy-drill',
  'coaching-note',
  'reminder',
  'resource',
]);

let cachedIndex = null;
let hasBoundNotesUpdatedListener = false;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => normalizeString(tag))
    .filter((tag, index, list) => tag.length && list.indexOf(tag) === index);
};

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const sortByRecency = (a, b) => b.updatedAt - a.updatedAt;

const ensureNotesUpdatedListener = () => {
  if (hasBoundNotesUpdatedListener || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('memoryCue:notesUpdated', () => {
    cachedIndex = null;
  });

  hasBoundNotesUpdatedListener = true;
};

const buildIndexEntry = (note) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
  const createdAt = toTimestamp(note.createdAt);
  const updatedAt = toTimestamp(note.updatedAt) || createdAt;
  const type = normalizeString(metadata.type).toLowerCase();

  const body = normalizeString(note.bodyText) || normalizeString(note.body);

  return {
    id: normalizeString(note.id),
    title: normalizeString(note.title) || 'Untitled note',
    body,
    summary: body.slice(0, 180),
    type,
    tags: normalizeTags(metadata.tags),
    folder: getFolderNameById(note.folderId),
    createdAt,
    updatedAt,
  };
};

const tokenizeQuery = (query) => normalizeString(query)
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const scoreMemoryMatch = (entry, normalizedQuery) => {
  const queryTokens = tokenizeQuery(normalizedQuery);
  const lowerTitle = entry.title.toLowerCase();
  const lowerBody = entry.body.toLowerCase();
  const lowerTags = entry.tags.map((tag) => tag.toLowerCase());

  let score = 0;
  let matched = false;

  queryTokens.forEach((token) => {
    if (lowerTitle.includes(token)) {
      score += 1000;
      matched = true;
    }

    if (lowerTags.some((tag) => tag.includes(token))) {
      score += 500;
      matched = true;
    }

    if (lowerBody.includes(token)) {
      score += 100;
      matched = true;
    }
  });

  // Recency is the final tie-breaker after relevance rules.
  const recencyBoost = entry.updatedAt > 0 ? Math.max(0, 50 - (Date.now() - entry.updatedAt) / (24 * 60 * 60 * 1000)) : 0;
  score += recencyBoost;

  return { entry, matched, score };
};

export const buildMemoryIndex = () => {
  ensureNotesUpdatedListener();

  if (cachedIndex) {
    return cachedIndex;
  }

  cachedIndex = loadAllNotes()
    .map((note) => buildIndexEntry(note))
    .filter((entry) => entry.id)
    .sort(sortByRecency);

  return cachedIndex;
};

export const searchMemoryIndex = (query) => {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery.length) {
    return getRecentMemory(MAX_SEARCH_RESULTS);
  }

  return buildMemoryIndex()
    .map((entry) => scoreMemoryMatch(entry, normalizedQuery))
    .filter((result) => result.matched)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.entry.updatedAt - a.entry.updatedAt;
    })
    .slice(0, MAX_SEARCH_RESULTS)
    .map((result) => result.entry);
};

export const getRecentMemory = (limit = DEFAULT_RECENT_LIMIT) => {
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0
    ? Math.floor(normalizedLimit)
    : DEFAULT_RECENT_LIMIT;

  return buildMemoryIndex().slice(0, safeLimit);
};

export const getMemoryByType = (type) => {
  const normalizedType = normalizeString(type).toLowerCase();
  if (!ALLOWED_MEMORY_TYPES.has(normalizedType)) {
    return [];
  }

  return buildMemoryIndex().filter((entry) => entry.type === normalizedType);
};

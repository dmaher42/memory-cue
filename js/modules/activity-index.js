import { getFolderNameById, loadAllNotes } from './notes-storage.js';

const MAX_SEARCH_RESULTS = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TOKEN_SYNONYMS = Object.freeze({
  footy: ['football'],
  football: ['footy'],
  drill: ['drills', 'practice', 'training'],
  drills: ['drill', 'practice', 'training'],
  reflection: ['reflections', 'reflect'],
  reflections: ['reflection', 'reflect'],
  reminder: ['reminders'],
  reminders: ['reminder'],
});

let cachedIndex = null;
let hasBoundNotesUpdatedListener = false;

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

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => normalizeString(tag))
    .filter((tag, index, list) => tag.length && list.indexOf(tag) === index);
};

const buildIndexEntry = (note) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
  const tags = normalizeTags(metadata.tags);
  const createdAt = toTimestamp(note.createdAt);
  const updatedAt = toTimestamp(note.updatedAt) || createdAt;

  return {
    id: normalizeString(note.id),
    type: normalizeString(metadata.type) || 'note',
    title: normalizeString(note.title) || 'Untitled note',
    body: normalizeString(note.bodyText) || normalizeString(note.body),
    tags,
    folder: getFolderNameById(note.folderId),
    createdAt,
    updatedAt,
    aiCaptured: metadata.aiCaptured === true,
    aiPriority: normalizeString(metadata.aiPriority) || null,
  };
};

const sortByRecency = (a, b) => b.updatedAt - a.updatedAt;

const tokenizeQuery = (query) => {
  const rawTokens = normalizeString(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const expanded = new Set(rawTokens);
  rawTokens.forEach((token) => {
    const synonyms = TOKEN_SYNONYMS[token] || [];
    synonyms.forEach((synonym) => expanded.add(synonym));
  });

  return Array.from(expanded);
};

const getWeekdayFromQuery = (queryTokens) => queryTokens.find((token) => WEEKDAY_NAMES.includes(token)) || null;

const ensureNotesUpdatedListener = () => {
  if (hasBoundNotesUpdatedListener || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('memoryCue:notesUpdated', () => {
    cachedIndex = null;
  });

  hasBoundNotesUpdatedListener = true;
};

const scoreEntryForQuery = (entry, normalizedQuery, queryTokens, weekdayToken) => {
  const titleLower = entry.title.toLowerCase();
  const bodyLower = entry.body.toLowerCase();
  const typeLower = entry.type.toLowerCase();
  const tagsLower = entry.tags.map((tag) => tag.toLowerCase());

  let score = 0;
  let matched = false;

  if (normalizedQuery.length > 2 && titleLower.includes(normalizedQuery)) {
    score += 18;
    matched = true;
  }

  queryTokens.forEach((token) => {
    const inTitle = titleLower.includes(token);
    const inTags = tagsLower.some((tag) => tag.includes(token));
    const inType = typeLower.includes(token);
    const inBody = bodyLower.includes(token);

    if (inTitle) {
      score += 12;
      matched = true;
    }
    if (inTags) {
      score += 10;
      matched = true;
    }
    if (inType) {
      score += 5;
      matched = true;
    }
    if (inBody) {
      score += 2;
      matched = true;
    }
  });

  if (weekdayToken && Number.isFinite(entry.createdAt) && entry.createdAt > 0) {
    const entryWeekday = WEEKDAY_NAMES[new Date(entry.createdAt).getDay()];
    if (entryWeekday === weekdayToken) {
      score += 8;
      matched = true;
    }
  }

  const recencyDays = Math.max(0, (Date.now() - entry.updatedAt) / MS_PER_DAY);
  const recencyWeight = Math.max(0, 3 - recencyDays / 20);

  return {
    entry,
    score: score + recencyWeight,
    matched,
  };
};

export const buildActivityIndex = () => {
  ensureNotesUpdatedListener();

  if (cachedIndex) {
    return cachedIndex;
  }

  const notes = loadAllNotes();
  cachedIndex = notes.map(buildIndexEntry).filter((entry) => entry.id).sort(sortByRecency);
  return cachedIndex;
};

export const searchActivityIndex = (query) => {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery.length) {
    return getRecentActivity(MAX_SEARCH_RESULTS);
  }

  const queryTokens = tokenizeQuery(normalizedQuery);
  const weekdayToken = getWeekdayFromQuery(queryTokens);

  const ranked = buildActivityIndex()
    .map((entry) => scoreEntryForQuery(entry, normalizedQuery, queryTokens, weekdayToken))
    .filter((result) => result.matched)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.entry.updatedAt - a.entry.updatedAt;
    })
    .slice(0, MAX_SEARCH_RESULTS)
    .map((result) => result.entry);

  if (ranked.length) {
    return ranked;
  }

  // Keep assistant search lightweight by falling back to recent notes.
  return getRecentActivity(MAX_SEARCH_RESULTS);
};

export const getRecentActivity = (limit = MAX_SEARCH_RESULTS) => {
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0
    ? Math.floor(normalizedLimit)
    : MAX_SEARCH_RESULTS;

  return buildActivityIndex().slice(0, safeLimit);
};

export const getEntriesByType = (type) => {
  const normalizedType = normalizeString(type).toLowerCase();
  if (!normalizedType.length) {
    return [];
  }

  return buildActivityIndex().filter((entry) => entry.type.toLowerCase() === normalizedType);
};

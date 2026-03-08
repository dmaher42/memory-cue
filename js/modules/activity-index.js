import { getFolderNameById, loadAllNotes } from './notes-storage.js';

const MAX_SEARCH_RESULTS = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

const ensureNotesUpdatedListener = () => {
  if (hasBoundNotesUpdatedListener || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('memoryCue:notesUpdated', () => {
    cachedIndex = null;
  });

  hasBoundNotesUpdatedListener = true;
};

const scoreEntryForQuery = (entry, queryTokens) => {
  const titleLower = entry.title.toLowerCase();
  const bodyLower = entry.body.toLowerCase();
  const typeLower = entry.type.toLowerCase();
  const tagsLower = entry.tags.map((tag) => tag.toLowerCase());

  let score = 0;
  let matched = false;

  queryTokens.forEach((token) => {
    const inTitle = titleLower.includes(token);
    const inTags = tagsLower.some((tag) => tag.includes(token));
    const inType = typeLower.includes(token);
    const inBody = bodyLower.includes(token);

    if (inTitle) {
      score += 10;
      matched = true;
    }
    if (inTags) {
      score += 7;
      matched = true;
    }
    if (inType) {
      score += 5;
      matched = true;
    }
    if (inBody) {
      score += 3;
      matched = true;
    }
  });

  const recencyDays = Math.max(0, (Date.now() - entry.updatedAt) / MS_PER_DAY);
  const recencyWeight = Math.max(0, 2 - recencyDays / 30);

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

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return buildActivityIndex()
    .map((entry) => scoreEntryForQuery(entry, queryTokens))
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

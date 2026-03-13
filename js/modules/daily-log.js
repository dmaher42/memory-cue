import { loadAllNotes } from './notes-storage.js';

const DAILY_LOG_GROUPS = ['tasks', 'ideas', 'memories'];
const MEMORY_ENTRIES_STORAGE_KEY = 'memoryCueInbox';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeDateKey = (value) => {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = String(parsed.getFullYear());
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDateKeyFromTimestamp = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return normalizeDateKey(parsed.toISOString());
};

const toDailyLogGroup = (value = '') => {
  const normalized = normalizeString(value).toLowerCase();

  if (normalized.includes('task')) {
    return 'tasks';
  }
  if (normalized.includes('idea')) {
    return 'ideas';
  }
  return 'memories';
};

const toDailyLogEntry = ({ id = '', group = 'memories', text = '' } = {}) => ({
  id: normalizeString(id),
  group: DAILY_LOG_GROUPS.includes(group) ? group : 'memories',
  text: normalizeString(text) || 'Untitled item',
});

const readMemoryEntries = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MEMORY_ENTRIES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Unable to read inbox entries for Daily Log', error);
    return [];
  }
};

const getNoteDateKey = (note) => (
  normalizeDateKey(note?.metadata?.aiActionDate)
  || normalizeDateKey(note?.createdAt)
);

const getMemoryEntryDateKey = (entry) => (
  normalizeDateKey(entry?.date)
  || toDateKeyFromTimestamp(entry?.createdAt)
  || toDateKeyFromTimestamp(entry?.timestamp)
);

const getNoteText = (note) => (
  normalizeString(note?.title)
  || normalizeString(note?.bodyText)
  || normalizeString(note?.body)
);

const getMemoryEntryText = (entry) => (
  normalizeString(entry?.text)
  || normalizeString(entry?.title)
  || normalizeString(entry?.body)
);

export const getDailyLog = (date) => {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    return [];
  }

  const noteEntries = loadAllNotes()
    .filter((note) => getNoteDateKey(note) === dateKey)
    .map((note) => toDailyLogEntry({
      id: note?.id,
      group: toDailyLogGroup(note?.metadata?.type || note?.type),
      text: getNoteText(note),
    }));

  const memoryEntries = readMemoryEntries()
    .filter((entry) => getMemoryEntryDateKey(entry) === dateKey)
    .map((entry) => toDailyLogEntry({
      id: entry?.id,
      group: toDailyLogGroup(entry?.type),
      text: getMemoryEntryText(entry),
    }));

  return [...memoryEntries, ...noteEntries];
};

export { DAILY_LOG_GROUPS, normalizeDateKey };

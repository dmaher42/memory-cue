import { loadAllNotes } from './notes-storage.js';

const DAILY_LOG_GROUPS = ['tasks', 'ideas', 'notes', 'knowledge'];

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

const toDailyLogGroup = (note) => {
  const metadataType = normalizeString(note?.metadata?.type).toLowerCase();
  const noteType = normalizeString(note?.type).toLowerCase();
  const value = metadataType || noteType;

  if (value.includes('task')) {
    return 'tasks';
  }
  if (value.includes('idea')) {
    return 'ideas';
  }
  if (value.includes('knowledge')) {
    return 'knowledge';
  }
  return 'notes';
};

const toDailyLogEntry = (note) => {
  const title = normalizeString(note?.title);
  const bodyText = normalizeString(note?.bodyText);
  const body = normalizeString(note?.body);

  return {
    id: normalizeString(note?.id),
    group: toDailyLogGroup(note),
    text: title || bodyText || body || 'Untitled note',
  };
};

export const getDailyLog = (date) => {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    return [];
  }

  return loadAllNotes()
    .filter((note) => {
      const metadataDate = normalizeDateKey(note?.metadata?.aiActionDate);
      const createdDate = normalizeDateKey(note?.createdAt);
      return metadataDate === dateKey || createdDate === dateKey;
    })
    .map((note) => toDailyLogEntry(note));
};

export { DAILY_LOG_GROUPS };

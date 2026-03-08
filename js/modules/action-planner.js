import { getFolderNameById, loadAllNotes } from './notes-storage.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HIGH_PRIORITY = 'high';
const COACHING_TYPES = new Set(['footy-drill', 'coaching-note']);
const TEACHING_TYPES = new Set(['lesson-idea', 'lesson-reflection', 'resource']);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

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

const parseDateValue = (value) => {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const estimateActionDateFromTitle = (title, today) => {
  const normalizedTitle = normalizeString(title).toLowerCase();
  if (!normalizedTitle) {
    return null;
  }

  if (normalizedTitle.includes('today')) {
    return new Date(today);
  }

  if (
    normalizedTitle.includes('tomorrow') ||
    normalizedTitle.includes('next lesson') ||
    normalizedTitle.includes('training')
  ) {
    const estimatedDate = new Date(today);
    estimatedDate.setDate(estimatedDate.getDate() + 1);
    return estimatedDate;
  }

  return null;
};

const resolveActionDate = (note, today) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
  const metadataDate = parseDateValue(metadata.aiActionDate);
  if (metadataDate) {
    return metadataDate;
  }
  return estimateActionDateFromTitle(note?.title, today);
};

const buildActionEntry = (note, actionDate) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
  return {
    id: normalizeString(note?.id),
    title: normalizeString(note?.title) || 'Untitled note',
    type: normalizeString(metadata.type) || 'note',
    folder: getFolderNameById(note?.folderId),
    priority: normalizeString(metadata.aiPriority).toLowerCase() || null,
    actionDate: formatDateKey(actionDate),
  };
};

const getActionEntries = () => {
  const notes = loadAllNotes();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return notes.map((note) => {
    const actionDate = resolveActionDate(note, today);
    return {
      note,
      actionDate,
      entry: buildActionEntry(note, actionDate),
    };
  });
};

export const getTodayActions = () => {
  const todayKey = formatDateKey(new Date());
  const now = Date.now();

  return getActionEntries()
    .filter(({ note, entry, actionDate }) => {
      const isActionScheduledForToday = actionDate && formatDateKey(actionDate) === todayKey;
      const createdAt = toTimestamp(note?.createdAt);
      const isRecentHighPriority =
        entry.priority === HIGH_PRIORITY &&
        createdAt > 0 &&
        now - createdAt <= MS_PER_DAY;

      return isActionScheduledForToday || isRecentHighPriority;
    })
    .map(({ entry }) => entry);
};

export const getThisWeekActions = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return getActionEntries()
    .filter(({ actionDate }) => actionDate && actionDate >= today && actionDate <= weekEnd)
    .map(({ entry }) => entry);
};

export const getHighPriorityItems = () => {
  return getActionEntries()
    .filter(({ entry }) => entry.priority === HIGH_PRIORITY)
    .map(({ entry }) => entry);
};

export const getCoachingItems = () => {
  return getActionEntries()
    .filter(({ entry }) => COACHING_TYPES.has(entry.type))
    .map(({ entry }) => entry);
};

export const getTeachingItems = () => {
  return getActionEntries()
    .filter(({ entry }) => TEACHING_TYPES.has(entry.type))
    .map(({ entry }) => entry);
};

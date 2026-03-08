import { getFolderNameById, loadAllNotes } from './notes-storage.js';
import { getRecentActivity } from './activity-index.js';

const COACHING_TYPES = new Set(['footy-drill', 'coaching-note']);
const TEACHING_TYPES = new Set(['lesson-idea', 'lesson-reflection']);

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

const getTodayKey = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDashboardEntry = (note) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};

  return {
    id: normalizeString(note?.id),
    title: normalizeString(note?.title) || 'Untitled note',
    type: normalizeString(metadata.type || note?.type).toLowerCase() || 'note',
    priority: normalizeString(metadata.aiPriority || note?.priority).toLowerCase(),
    aiActionDate: normalizeDateKey(metadata.aiActionDate || note?.aiActionDate),
    folder: normalizeString(getFolderNameById(note?.folderId)) || 'Unsorted',
  };
};

const getRecentMemory = (limit = 10) => getRecentActivity(limit);

export const buildDashboard = () => {
  const entries = loadAllNotes().map((note) => toDashboardEntry(note));
  const todayKey = getTodayKey();

  return {
    today: entries.filter((entry) => entry.aiActionDate === todayKey || entry.priority === 'high'),
    coaching: entries.filter((entry) => COACHING_TYPES.has(entry.type)),
    teaching: entries.filter((entry) => TEACHING_TYPES.has(entry.type)),
    recent: getRecentMemory(10),
    inbox: entries.filter((entry) => entry.folder === 'Inbox'),
  };
};

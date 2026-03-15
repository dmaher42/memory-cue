import { saveNote } from './adapters/notePersistenceAdapter.js';
import { createReminder } from './reminderService.js';
import { getInboxEntries, saveInboxEntry } from './inboxService.js';
import { getRecentMemory } from '../../js/modules/memory-index.js';
import { searchNotesMemory } from './memorySearch.js';
import { getFolderNameById, getFolders, loadAllNotes } from '../../js/modules/notes-storage.js';

const REMINDER_STORAGE_KEY = 'memoryCue:offlineReminders';
const MEMORY_TYPES = new Set(['note', 'reminder', 'idea', 'inbox']);
const DEFAULT_RECENT_LIMIT = 20;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeType = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return MEMORY_TYPES.has(normalized) ? normalized : 'note';
};

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
};

const toIsoString = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
};

const toTimestamp = (value) => {
  const iso = toIsoString(value);
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const resolveNotebookId = (notebook) => {
  const normalizedNotebook = normalizeText(notebook).toLowerCase();
  if (!normalizedNotebook) {
    return null;
  }

  const folders = getFolders();
  const matched = folders.find((folder) => {
    const folderId = normalizeText(folder?.id).toLowerCase();
    const folderName = normalizeText(folder?.name).toLowerCase();
    return folderId === normalizedNotebook || folderName === normalizedNotebook;
  });

  return matched ? matched.id : null;
};

const normalizeNoteToMemory = (note = {}) => {
  const metadata = note?.metadata && typeof note.metadata === 'object' ? note.metadata : {};
  const parsedType = normalizeType(metadata.type === 'idea' ? 'idea' : 'note');
  const bodyText = normalizeText(note.bodyText) || normalizeText(note.body);

  return {
    id: normalizeText(note.id),
    text: bodyText || normalizeText(note.title),
    type: parsedType,
    notebook: getFolderNameById(note.folderId),
    tags: normalizeTags(metadata.tags),
    createdAt: toIsoString(note.createdAt || note.updatedAt),
    source: normalizeText(metadata.source) || 'note',
    entryPoint: 'notes',
    metadata,
  };
};

const normalizeIndexedNoteToMemory = (entry = {}) => ({
  id: normalizeText(entry.id),
  text: normalizeText(entry.body) || normalizeText(entry.title),
  type: normalizeType(entry.type === 'idea' ? 'idea' : 'note'),
  notebook: normalizeText(entry.folder),
  tags: normalizeTags(entry.tags),
  createdAt: toIsoString(entry.createdAt || entry.updatedAt),
  source: 'note',
  entryPoint: 'notes',
  metadata: {
    summary: normalizeText(entry.summary),
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
  },
});

const normalizeReminderToMemory = (reminder = {}) => {
  const metadata = reminder?.metadata && typeof reminder.metadata === 'object' ? reminder.metadata : {};
  const title = normalizeText(reminder.title);
  const notes = normalizeText(reminder.notes);

  return {
    id: normalizeText(reminder.id),
    text: [title, notes].filter(Boolean).join('\n\n') || title,
    type: 'reminder',
    notebook: normalizeText(reminder.category) || 'Reminders',
    tags: normalizeTags(reminder.keywords || metadata.tags),
    createdAt: toIsoString(reminder.createdAt || reminder.updatedAt),
    source: normalizeText(metadata.source) || 'reminder',
    entryPoint: 'reminders',
    metadata: {
      ...metadata,
      due: reminder.due || null,
      done: !!reminder.done,
      priority: reminder.priority || 'Medium',
    },
  };
};

const normalizeInboxToMemory = (entry = {}) => ({
  id: normalizeText(entry.id),
  text: normalizeText(entry.text),
  type: 'inbox',
  notebook: 'Inbox',
  tags: normalizeTags(entry.tags),
  createdAt: toIsoString(entry.createdAt || entry.updatedAt),
  source: normalizeText(entry.source) || 'capture',
  entryPoint: 'inbox',
  metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
});

const loadReminderEntries = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[memory-service] Failed to load reminders', error);
    return [];
  }
};

const matchesQuery = (memory, query) => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  const text = normalizeText(memory?.text).toLowerCase();
  const notebook = normalizeText(memory?.notebook).toLowerCase();
  const tags = Array.isArray(memory?.tags) ? memory.tags.map((tag) => normalizeText(tag).toLowerCase()) : [];

  return text.includes(normalizedQuery)
    || notebook.includes(normalizedQuery)
    || tags.some((tag) => tag.includes(normalizedQuery));
};

const sortMemoriesByRecency = (a, b) => toTimestamp(b?.createdAt) - toTimestamp(a?.createdAt);

const dedupeMemories = (entries = []) => {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry?.type || 'unknown'}:${entry?.id || ''}`;
    if (!entry?.id || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const saveMemory = async (entry = {}) => {
  const text = normalizeText(entry?.text);
  const type = normalizeType(entry?.type);
  const tags = normalizeTags(entry?.tags);
  const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};

  if (!text) {
    return null;
  }

  const logMemorySaved = (memory) => {
    if (!memory) {
      return memory;
    }
    console.info('[brain] memory saved', {
      id: memory.id,
      type: memory.type,
      source: memory.source,
    });
    return memory;
  };

  if (type === 'inbox') {
    const savedInboxEntry = saveInboxEntry({
      text,
      tags,
      source: entry?.source,
      parsedType: entry?.metadata?.parsedType,
      metadata,
    });
    return savedInboxEntry ? logMemorySaved(normalizeInboxToMemory(savedInboxEntry)) : null;
  }

  if (type === 'reminder') {
    const reminderPayload = {
      title: text,
      notes: typeof metadata.notes === 'string' ? metadata.notes : '',
      due: metadata.due,
      priority: metadata.priority,
      category: entry?.notebook,
      semanticEmbedding: metadata.semanticEmbedding,
    };

    try {
      const savedReminder = await createReminder(reminderPayload);
      return savedReminder ? logMemorySaved(normalizeReminderToMemory(savedReminder)) : null;
    } catch (error) {
      console.warn('[memory-service] Failed to save reminder', error);
      return null;
    }
  }

  const savedNote = saveNote(
    {
      text,
      tags,
      parsedType: type === 'idea' ? 'idea' : 'note',
      source: entry?.source,
      folderId: resolveNotebookId(entry?.notebook),
    },
    {
      metadata,
      entryPoint: entry?.entryPoint,
    },
  );

  return savedNote ? logMemorySaved(normalizeNoteToMemory(savedNote)) : null;
};

export const getMemoryById = (id) => {
  const targetId = normalizeText(id);
  if (!targetId) {
    return null;
  }

  const note = loadAllNotes().find((entry) => normalizeText(entry?.id) === targetId);
  if (note) {
    const memory = normalizeNoteToMemory(note);
    console.info('[brain] memory retrieved', { id: memory.id, type: memory.type, source: 'getMemoryById' });
    return memory;
  }

  const reminder = loadReminderEntries().find((entry) => normalizeText(entry?.id) === targetId);
  if (reminder) {
    const memory = normalizeReminderToMemory(reminder);
    console.info('[brain] memory retrieved', { id: memory.id, type: memory.type, source: 'getMemoryById' });
    return memory;
  }

  const inboxEntry = getInboxEntries().find((entry) => normalizeText(entry?.id) === targetId);
  if (inboxEntry) {
    const memory = normalizeInboxToMemory(inboxEntry);
    console.info('[brain] memory retrieved', { id: memory.id, type: memory.type, source: 'getMemoryById' });
    return memory;
  }

  return null;
};

export const getRecentMemories = (limit = DEFAULT_RECENT_LIMIT) => {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : DEFAULT_RECENT_LIMIT;

  const noteMemories = getRecentMemory(safeLimit).map((entry) => normalizeIndexedNoteToMemory(entry));
  const reminderMemories = loadReminderEntries().map((entry) => normalizeReminderToMemory(entry));
  const inboxMemories = getInboxEntries().map((entry) => normalizeInboxToMemory(entry));

  const memories = dedupeMemories([...noteMemories, ...reminderMemories, ...inboxMemories])
    .sort(sortMemoriesByRecency)
    .slice(0, safeLimit);

  console.info('[brain] memory retrieved', {
    source: 'getRecentMemories',
    count: memories.length,
  });

  return memories;
};

export const searchMemories = (query) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const noteMatches = searchNotesMemory(normalizedQuery)
    .items
    .map((entry) => normalizeIndexedNoteToMemory(entry));

  const reminderMatches = loadReminderEntries()
    .map((entry) => normalizeReminderToMemory(entry))
    .filter((entry) => matchesQuery(entry, normalizedQuery));

  const inboxMatches = getInboxEntries()
    .map((entry) => normalizeInboxToMemory(entry))
    .filter((entry) => matchesQuery(entry, normalizedQuery));

  const matches = dedupeMemories([...noteMatches, ...reminderMatches, ...inboxMatches])
    .sort(sortMemoriesByRecency);

  console.info('[brain] memory retrieved', {
    source: 'searchMemories',
    query: normalizedQuery,
    count: matches.length,
  });

  return matches;
};

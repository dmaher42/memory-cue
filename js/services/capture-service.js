import { createAndSaveNote } from '../modules/notes-storage.js';
import { generateTags } from '../../src/ai/tagGenerator.js';
import {
  getInboxEntries,
  saveInboxEntry as saveInboxEntryCanonical,
  removeInboxEntry,
  INBOX_STORAGE_KEY,
} from '../../src/services/inboxService.js';

export { INBOX_STORAGE_KEY, getInboxEntries, removeInboxEntry };

const PARSED_TYPE_VALUES = new Set(['note', 'reminder', 'unknown']);
const SOURCE_VALUES = new Set(['capture', 'reminder', 'assistant', 'quick-add']);

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

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `capture-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

export const saveInboxEntry = (entry) => saveInboxEntryCanonical(entry);

const parseEntry = async (text) => {
  try {
    const response = await fetch('/api/parse-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      return { parsedType: 'unknown', metadata: {} };
    }

    const parsed = await response.json();
    const parsedType = normalizeParsedType(parsed?.type);
    return {
      parsedType,
      metadata: parsed && typeof parsed === 'object' ? parsed : {},
    };
  } catch (error) {
    console.warn('[capture-service] parse-entry unavailable, using unknown type', error);
    return { parsedType: 'unknown', metadata: {} };
  }
};

export const captureInput = async (text, source = 'capture') => {
  const cleanedText = sanitizeText(text);
  if (!cleanedText) {
    return null;
  }

  const parsed = await parseEntry(cleanedText);

  const entry = {
    id: generateId(),
    text: cleanedText,
    tags: generateTags(cleanedText),
    createdAt: Date.now(),
    source: normalizeSource(source),
    parsedType: parsed.parsedType,
    metadata: parsed.metadata,
  };

  return saveInboxEntryCanonical(entry);
};

export const convertInboxToNote = (entryId) => {
  const targetId = typeof entryId === 'string' ? entryId : '';
  if (!targetId) {
    return null;
  }

  const entries = getInboxEntries();
  const entry = entries.find((candidate) => String(candidate?.id || '') === targetId);
  if (!entry) {
    return null;
  }

  const text = sanitizeText(entry.text);
  if (!text) {
    return null;
  }

  const title = text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';
  const note = createAndSaveNote({
    text,
    title,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    folderId: entry.folderId,
    source: 'inbox',
    parsedType: entry.parsedType || 'note',
  });
  if (!note) {
    return null;
  }
  removeInboxEntry(targetId);

  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('memoryCue:notesUpdated'));
  }

  return note;
};

if (typeof window !== 'undefined') {
  window.MemoryCueCaptureService = {
    captureInput,
    getInboxEntries,
    saveInboxEntry,
    removeInboxEntry,
    convertInboxToNote,
  };
}

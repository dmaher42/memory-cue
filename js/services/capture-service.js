import { saveNote } from '../../src/services/adapters/notePersistenceAdapter.js';
import { generateTags } from '../../src/ai/tagGenerator.js';
import { routeIntent } from '../../src/services/intentRouter.js';
import * as reminderService from '../../src/services/reminderService.js';
import {
  getInboxEntries,
  saveInboxEntry as saveInboxEntryCanonical,
  removeInboxEntry,
  INBOX_STORAGE_KEY,
} from '../../src/services/inboxService.js';

export { INBOX_STORAGE_KEY, getInboxEntries, removeInboxEntry };

const PARSED_TYPE_VALUES = new Set(['note', 'reminder', 'idea', 'lesson_idea', 'coaching_drill', 'question', 'unknown']);
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
      return { parsedEntry: null, isValid: false };
    }

    const parsed = await response.json();
    const isValid = Boolean(parsed && typeof parsed === 'object');
    const parsedType = normalizeParsedType(parsed?.type);
    return {
      parsedEntry: {
        ...(isValid ? parsed : {}),
        type: parsedType,
      },
      isValid,
    };
  } catch (error) {
    console.warn('[capture-service] parse-entry unavailable, using unknown type', error);
    return { parsedEntry: null, isValid: false };
  }
};

const resolveCaptureContext = (sourceInput) => {
  if (sourceInput && typeof sourceInput === 'object') {
    return {
      source: normalizeSource(sourceInput.source),
      entryPoint:
        typeof sourceInput.entryPoint === 'string' && sourceInput.entryPoint.trim()
          ? sourceInput.entryPoint.trim()
          : normalizeSource(sourceInput.source),
      capturedAt:
        Number.isFinite(sourceInput.capturedAt)
          ? sourceInput.capturedAt
          : Date.now(),
    };
  }

  const normalizedSource = normalizeSource(sourceInput);
  return {
    source: normalizedSource,
    entryPoint: normalizedSource,
    capturedAt: Date.now(),
  };
};

const persistInboxDecision = (text, parsedEntry, context, overrides = {}) => saveInboxEntryCanonical({
  id: overrides.id,
  text,
  tags: Array.isArray(parsedEntry?.tags) ? parsedEntry.tags : generateTags(text),
  createdAt: context.capturedAt,
  source: context.source,
  parsedType: normalizeParsedType(parsedEntry?.type),
  metadata: {
    ...(parsedEntry && typeof parsedEntry === 'object' ? parsedEntry : {}),
    source: context.source,
    entryPoint: context.entryPoint,
    capturedAt: context.capturedAt,
  },
});

const persistNoteDecision = (text, parsedEntry, context) => {
  const title =
    typeof parsedEntry?.title === 'string' && parsedEntry.title.trim()
      ? parsedEntry.title.trim()
      : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  const note = saveNote({
    text,
    title,
    tags: Array.isArray(parsedEntry?.tags) ? parsedEntry.tags : generateTags(text),
    source: context.source,
    parsedType: normalizeParsedType(parsedEntry?.type) || 'note',
  });

  if (!note) {
    return persistInboxDecision(text, parsedEntry, context);
  }

  return note;
};

const persistReminderDecision = async (text, parsedEntry, context) => {
  const title =
    typeof parsedEntry?.title === 'string' && parsedEntry.title.trim()
      ? parsedEntry.title.trim()
      : text;

  try {
    const reminder = await reminderService.createReminder({
      title,
      text,
      due: typeof parsedEntry?.reminderDate === 'string' ? parsedEntry.reminderDate : undefined,
      notes: text,
      metadata: {
        source: context.source,
        entryPoint: context.entryPoint,
        capturedAt: context.capturedAt,
      },
    });
    if (reminder) {
      return reminder;
    }
  } catch (error) {
    console.warn('[capture-service] reminder creation unavailable, falling back to inbox', error);
  }

  return persistInboxDecision(text, parsedEntry, context);
};

const executeDecision = async (decision, text, parsedEntry, context) => {
  if (!decision || typeof decision !== 'object') {
    return persistInboxDecision(text, parsedEntry, context);
  }

  if (decision.decisionType === 'persist_reminder') {
    return persistReminderDecision(text, parsedEntry, context);
  }

  if (decision.decisionType === 'persist_note') {
    return persistNoteDecision(text, parsedEntry, context);
  }

  return persistInboxDecision(text, parsedEntry, context);
};

export const captureInput = async (text, source = 'capture') => {
  const cleanedText = sanitizeText(text);
  if (!cleanedText) {
    return null;
  }

  const context = resolveCaptureContext(source);
  const parsed = await parseEntry(cleanedText);
  const parsedEntry = parsed?.parsedEntry;

  if (!parsed?.isValid || !parsedEntry) {
    return persistInboxDecision(
      cleanedText,
      { type: 'unknown', metadata: {} },
      context,
      { id: generateId() },
    );
  }

  const hints = {
    source: context.source,
    entryPoint: context.entryPoint,
    capturedAt: context.capturedAt,
  };

  const decision = routeIntent(parsedEntry, cleanedText, hints);
  return executeDecision(decision, cleanedText, parsedEntry, context);
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
  const note = saveNote({
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

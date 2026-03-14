import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { ensureFolderExistsByName } from '../../js/modules/ai-capture-save.js';
import { suggestNotebookAndTags } from '../services/taggingEngine.js';
import { routeIntent } from '../services/intentRouter.js';

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const getEntryText = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  return normalizeText(entry.title || entry.text || entry.content || entry.body || '');
};

const normalizeParsedEntry = (parsed, text = '') => {
  const payload = parsed && typeof parsed === 'object' ? parsed : {};
  const normalizedType = typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : '';
  const fallbackType = typeof text === 'string' && text.trim().endsWith('?') ? 'question' : 'unknown';

  return {
    type: normalizedType || fallbackType,
    title: typeof payload.title === 'string' ? payload.title.trim() : '',
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : '')).filter(Boolean)
      : [],
    reminderDate:
      typeof payload.reminderDate === 'string' && payload.reminderDate.trim()
        ? payload.reminderDate.trim()
        : null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
};

const parseEntry = async (text) => {
  const response = await fetch('/api/parse-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to parse entry (${response.status})`);
  }

  const parsed = await response.json();
  return normalizeParsedEntry(parsed, text);
};

const getExistingParsedEntry = (entry, text) => {
  if (entry?.parsedEntry && typeof entry.parsedEntry === 'object') {
    return normalizeParsedEntry(entry.parsedEntry, text);
  }

  if (entry?.metadata && typeof entry.metadata === 'object' && typeof entry.metadata.type === 'string') {
    return normalizeParsedEntry(entry.metadata, text);
  }

  if (typeof entry?.parsedType === 'string' && entry.parsedType.trim()) {
    return normalizeParsedEntry({ type: entry.parsedType, title: text }, text);
  }

  return null;
};

const mapDecisionToCountType = (decision) => {
  const parsedType = typeof decision?.parsedType === 'string' ? decision.parsedType.trim().toLowerCase() : '';

  if (decision?.decisionType === 'persist_reminder') {
    return 'reminder';
  }

  if (parsedType === 'idea') {
    return 'idea';
  }

  if (parsedType === 'drill') {
    return 'training';
  }

  return 'note';
};

const addNotes = (notes) => {
  if (!Array.isArray(notes) || !notes.length) {
    return;
  }

  const existing = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  saveAllNotes([...notes, ...existing]);
};

export const processInbox = async (entries = [], options = {}) => {
  const createReminder = typeof options.createReminder === 'function' ? options.createReminder : null;
  const removeInboxEntry = typeof options.removeInboxEntry === 'function' ? options.removeInboxEntry : null;
  const aiClassifier = typeof options.aiClassifier === 'function' ? options.aiClassifier : null;

  const counts = {
    note: 0,
    reminder: 0,
    idea: 0,
    training: 0,
    personal: 0,
  };

  const notesToSave = [];
  const processedItems = [];

  for (const entry of entries) {
    const text = getEntryText(entry);
    if (!text) {
      continue;
    }

    let parsedEntry = getExistingParsedEntry(entry, text);
    if (!parsedEntry) {
      try {
        parsedEntry = await parseEntry(text);
      } catch (error) {
        console.warn('[inbox-processor] parse-entry failed, leaving inbox item unchanged', error);
        continue;
      }
    }

    const hints = {
      source: typeof entry?.source === 'string' ? entry.source : 'inbox',
      entryId: entry?.id != null ? String(entry.id) : '',
    };
    const decision = routeIntent(parsedEntry, text, hints);

    if (decision.decisionType === 'persist_inbox' || decision.decisionType === 'query') {
      continue;
    }

    const organization = await suggestNotebookAndTags(text, { aiClassifier });
    const combinedTags = Array.from(new Set([...(Array.isArray(parsedEntry.tags) ? parsedEntry.tags : []), ...organization.tags]));
    const type = mapDecisionToCountType(decision);

    counts[type] += 1;
    processedItems.push({ ...entry, type, text, tags: combinedTags, notebook: organization.notebook });

    if (decision.decisionType === 'persist_reminder') {
      if (createReminder) {
        createReminder({
          title: parsedEntry?.title || text,
          text,
          due: parsedEntry?.reminderDate || undefined,
          notes: 'Created from Inbox processing.',
        });
      }
    } else if (decision.decisionType === 'persist_note') {
      const folderId = ensureFolderExistsByName(organization.notebook);
      notesToSave.push(
        createNote(parsedEntry?.title || text.split(/\s+/).slice(0, 8).join(' '), text, {
          folderId,
          metadata: {
            type: parsedEntry?.type || type,
            tags: combinedTags,
          },
        }),
      );
    }

    if (removeInboxEntry && entry?.id != null) {
      removeInboxEntry(String(entry.id));
    }
  }

  addNotes(notesToSave);

  return {
    processedCount: processedItems.length,
    counts,
    processedItems,
    summary: [
      `Processed ${processedItems.length} notes.`,
      `${counts.idea + counts.training} teaching ideas`,
      `${counts.reminder} reminders`,
      `${counts.note + counts.personal} notes`,
    ].join('\n'),
  };
};

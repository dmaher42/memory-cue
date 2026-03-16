import { saveNote } from '../services/adapters/notePersistenceAdapter.js';
import { ensureFolderExistsByName } from '../../js/modules/ai-capture-save.js';
import { suggestNotebookAndTags } from '../services/taggingEngine.js';
import { classifyIntentLocally, routeIntent } from '../services/intentRouter.js';

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

  const notePayloads = [];
  const processedItems = [];

  for (const entry of entries) {
    const text = getEntryText(entry);
    if (!text) {
      continue;
    }

    const hints = {
      source: typeof entry?.source === 'string' ? entry.source : 'inbox',
      entryId: entry?.id != null ? String(entry.id) : '',
      entryPoint: 'inbox.processInbox',
      capturedAt: Date.now(),
    };

    let parsedEntry = getExistingParsedEntry(entry, text);
    if (!parsedEntry) {
      const localDecision = classifyIntentLocally(text, hints);
      if (localDecision) {
        parsedEntry = localDecision.parsedEntry;
      } else {
        console.warn('[brain] AI fallback triggered', {
          source: 'processInbox',
          reason: 'local_intent_unresolved',
          entryId: hints.entryId,
        });
        try {
          parsedEntry = await parseEntry(text);
        } catch (error) {
          console.warn('[inbox-processor] parse-entry failed, leaving inbox item unchanged', error);
          continue;
        }
      }
    }

    const decision = routeIntent(parsedEntry, text, hints);

    if (decision.decisionType === 'persist_inbox' || decision.decisionType === 'query_memory') {
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
      notePayloads.push({
        text,
        title: parsedEntry?.title || text.split(/\s+/).slice(0, 8).join(' '),
        folderId,
        tags: combinedTags,
        parsedType: parsedEntry?.type || type,
        source: typeof entry?.source === 'string' ? entry.source : 'inbox',
      });
    }

    if (removeInboxEntry && entry?.id != null) {
      removeInboxEntry(String(entry.id));
    }
  }

  for (let index = notePayloads.length - 1; index >= 0; index -= 1) {
    saveNote(notePayloads[index]);
  }

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

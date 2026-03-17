import { classifyIntentLocally, routeIntent } from '../services/intentRouter.js';
import { saveMemory } from '../services/memoryService.js';
import { createReminder } from '../services/reminderService.js';
import { semanticSearch } from '../services/semanticSearchService.js';
import { handleQuery } from '../brain/queryEngine.js';
import { saveInboxEntry } from '../services/inboxService.js';
import { buildMemoryAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const normalizeSource = (value) => {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalized = value.trim();
  return normalized || 'unknown';
};

const normalizeParsedEntry = (parsed, text = '') => {
  const payload = parsed && typeof parsed === 'object' ? parsed : {};
  const normalizedType = typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : '';
  const fallbackType = text.endsWith('?') ? 'question' : 'unknown';

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

const resolveDecision = async (text, hints) => {
  const localDecision = classifyIntentLocally(text, hints);
  if (localDecision) {
    return localDecision;
  }

  let parsedEntry = null;
  try {
    parsedEntry = await parseEntry(text);
  } catch (error) {
    console.warn('[capture] parse fallback failed, defaulting to inbox', error);
    parsedEntry = normalizeParsedEntry({ type: 'unknown', title: text }, text);
  }

  return routeIntent(parsedEntry, text, hints);
};

const saveNoteMemory = async (text, decision, context) => {
  const title = typeof decision?.parsedEntry?.title === 'string' && decision.parsedEntry.title.trim()
    ? decision.parsedEntry.title.trim()
    : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  return saveMemory({
    text,
    title,
    type: 'note',
    source: context.source,
    entryPoint: context.entryPoint,
    tags: Array.isArray(decision?.parsedEntry?.tags) ? decision.parsedEntry.tags : [],
  });
};

const runAssistantQuery = async (text, metadata = {}) => {
  const matches = await semanticSearch(text, metadata.uid);
  const snippets = matches.map((memory) => memory?.text).filter(Boolean);
  const body = buildMemoryAssistantRequest(text, snippets);
  return requestAssistantChat(body, { fallbackReply: 'Here is what I found.' });
};

export async function captureInput({
  text,
  source = 'unknown',
  metadata = {},
}) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return null;
  }

  const context = {
    source: normalizeSource(source),
    entryPoint: typeof metadata?.entryPoint === 'string' && metadata.entryPoint.trim()
      ? metadata.entryPoint.trim()
      : normalizeSource(source),
    capturedAt: Number.isFinite(metadata?.capturedAt) ? metadata.capturedAt : Date.now(),
  };

  const hints = {
    source: context.source,
    entryPoint: context.entryPoint,
    capturedAt: context.capturedAt,
    ...metadata,
  };

  const decision = await resolveDecision(normalizedText, hints);

  console.log('[capture]', {
    source: context.source,
    decision: decision?.decisionType,
    text: normalizedText,
  });

  switch (decision?.decisionType) {
    case 'persist_note': {
      const memory = await saveNoteMemory(normalizedText, decision, context);
      return {
        decision,
        data: memory,
        message: 'Saved note.',
      };
    }
    case 'persist_reminder': {
      const reminder = await createReminder({
        title: decision?.parsedEntry?.title || normalizedText,
        text: normalizedText,
        due: decision?.parsedEntry?.reminderDate || undefined,
        notes: normalizedText,
        metadata: {
          source: context.source,
          entryPoint: context.entryPoint,
          capturedAt: context.capturedAt,
        },
      });
      return {
        decision,
        data: reminder,
        message: 'Reminder created.',
      };
    }
    case 'query_memory': {
      const queryResults = await handleQuery(normalizedText);
      return {
        decision,
        data: queryResults,
        message: '',
      };
    }
    case 'assistant_query': {
      const reply = await runAssistantQuery(normalizedText, metadata);
      return {
        decision,
        data: { reply },
        message: reply,
      };
    }
    case 'persist_inbox':
    default: {
      const inboxEntry = saveInboxEntry({
        text: normalizedText,
        source: context.source,
        parsedType: decision?.parsedType || 'unknown',
        tags: Array.isArray(decision?.parsedEntry?.tags) ? decision.parsedEntry.tags : [],
        metadata: decision?.parsedEntry?.metadata && typeof decision.parsedEntry.metadata === 'object'
          ? decision.parsedEntry.metadata
          : {},
        entryPoint: context.entryPoint,
      });
      return {
        decision,
        data: inboxEntry,
        message: 'Added to inbox for later review.',
      };
    }
  }
}

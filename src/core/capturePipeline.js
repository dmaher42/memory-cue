import { intentRouter } from '../services/intentRouter.js';
import { saveMemory } from '../services/memoryService.js';
import { createReminder } from '../services/reminderService.js';
import { semanticSearch } from '../services/semanticSearchService.js';
import { handleQuery } from '../brain/queryEngine.js';
import { saveInboxEntry } from '../services/inboxService.js';
import { buildMemoryAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';

// Lightweight in-memory conversation state for one-step clarifications.
let pendingIntent = null;

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

const buildAssistantResponse = (message, extra = {}) => ({
  type: 'assistant_response',
  message,
  ...extra,
});

const toIsoString = (date) => (date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null);

const setTimeOnDate = (date, hours, minutes = 0) => {
  const nextDate = new Date(date.getTime());
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
};

const parseFollowUpDueAt = (text, now = new Date()) => {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return null;
  }

  const tomorrowMatch = normalized.match(/\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/);
  if (tomorrowMatch) {
    const dueDate = new Date(now.getTime());
    dueDate.setDate(dueDate.getDate() + 1);

    if (tomorrowMatch[1]) {
      let hours = Number.parseInt(tomorrowMatch[1], 10);
      const minutes = tomorrowMatch[2] ? Number.parseInt(tomorrowMatch[2], 10) : 0;
      const meridiem = tomorrowMatch[3];
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      return toIsoString(setTimeOnDate(dueDate, hours, minutes));
    }

    return toIsoString(setTimeOnDate(dueDate, 9, 0));
  }

  if (/\btonight\b/.test(normalized)) {
    return toIsoString(setTimeOnDate(now, 19, 0));
  }

  if (/\bnext week\b/.test(normalized)) {
    const dueDate = new Date(now.getTime());
    dueDate.setDate(dueDate.getDate() + 7);
    return toIsoString(setTimeOnDate(dueDate, 9, 0));
  }

  return null;
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
  const initialIntent = intentRouter(text, hints);
  if (initialIntent?.payload?.decisionType && initialIntent.payload.decisionType !== 'unresolved') {
    return {
      decisionType: initialIntent.payload.decisionType,
      parsedType: initialIntent.payload.parsedType,
      text,
      parsedEntry: initialIntent.payload.parsedEntry,
      missing: Array.isArray(initialIntent?.payload?.missing) ? initialIntent.payload.missing : [],
      hints,
    };
  }

  let parsedEntry = null;
  try {
    parsedEntry = await parseEntry(text);
  } catch (error) {
    console.warn('[capture] parse fallback failed, defaulting to inbox', error);
    parsedEntry = normalizeParsedEntry({ type: 'unknown', title: text }, text);
  }

  const routedIntent = intentRouter(text, { ...hints, parsedEntry });
  return {
    decisionType: routedIntent?.payload?.decisionType || 'persist_inbox',
    parsedType: routedIntent?.payload?.parsedType || 'unknown',
    text,
    parsedEntry: routedIntent?.payload?.parsedEntry || parsedEntry,
    missing: Array.isArray(routedIntent?.payload?.missing) ? routedIntent.payload.missing : [],
    hints,
  };
};

const buildPendingReminderDecision = (intent, dueAt) => {
  const parsedEntry = intent?.parsedEntry && typeof intent.parsedEntry === 'object'
    ? intent.parsedEntry
    : {};

  return {
    decisionType: 'persist_reminder',
    parsedType: intent?.parsedType || 'reminder',
    text: intent?.text || parsedEntry?.title || '',
    parsedEntry: {
      ...parsedEntry,
      type: 'reminder',
      title: intent?.payload?.text || parsedEntry?.title || intent?.text || '',
      reminderDate: dueAt,
      metadata: {
        ...(parsedEntry?.metadata && typeof parsedEntry.metadata === 'object' ? parsedEntry.metadata : {}),
        dueAt,
      },
    },
    missing: dueAt ? [] : ['dueAt'],
    hints: intent?.hints || {},
  };
};

const maybeResolvePendingIntent = async (text) => {
  if (!pendingIntent) {
    return null;
  }

  // Follow-up replies are treated as clarification answers for the pending reminder.
  const dueAt = parseFollowUpDueAt(text);
  const decision = buildPendingReminderDecision(pendingIntent, dueAt);

  if (decision.missing.length) {
    pendingIntent = {
      ...pendingIntent,
      lastFollowUpText: text,
    };
    return {
      clarification: buildAssistantResponse('When should I remind you?'),
    };
  }

  pendingIntent = null;
  return { decision };
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

  const pendingResolution = await maybeResolvePendingIntent(normalizedText);
  if (pendingResolution?.clarification) {
    return pendingResolution.clarification;
  }

  const decision = pendingResolution?.decision || await resolveDecision(normalizedText, hints);

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
      if (Array.isArray(decision?.missing) && decision.missing.includes('dueAt')) {
        pendingIntent = {
          ...decision,
          payload: {
            text: decision?.parsedEntry?.title || normalizedText,
            dueAt: decision?.parsedEntry?.reminderDate || null,
          },
        };
        return buildAssistantResponse('When should I remind you?', {
          decision,
        });
      }

      const reminder = await createReminder({
        text: decision?.parsedEntry?.title || normalizedText,
        dueAt: decision?.parsedEntry?.reminderDate || undefined,
        source: 'capture',
      });
      return buildAssistantResponse('Reminder created.', {
        decision,
        data: reminder,
      });
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

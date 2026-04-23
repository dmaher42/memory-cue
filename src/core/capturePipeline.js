import { intentRouter } from '../services/intentRouter.js';
import { saveMemory } from '../services/memoryService.js';
import { createReminder } from '../services/reminderService.js';
import { semanticSearch } from '../services/semanticSearchService.js';
import { handleQuery } from '../brain/queryEngine.js';
import { saveInboxEntry } from '../services/inboxService.js';
import { buildMemoryAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';

// Keep one-step clarifications scoped to the capture surface that started them.
const pendingIntentsByChannel = new Map();
const pendingCaptureKindsByChannel = new Map();

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

const getPendingChannelKey = (context = {}) => {
  const source = normalizeSource(context?.source);
  const entryPoint = normalizeSource(context?.entryPoint || context?.source);
  return `${entryPoint}::${source}`;
};

const QUICK_CAPTURE_PREFIXES = Object.freeze({
  reminder: '!',
  note: '+',
});

const MONTH_NAME_TO_INDEX = Object.freeze({
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
});

const WEEKDAY_NAME_PATTERN = '(?:monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)';
const MONTH_NAME_PATTERN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY_MONTH_DATE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_PATTERN})(?:\\s+(\\d{4}))?\\b`,
  'i',
);
const MONTH_DAY_DATE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`,
  'i',
);
const DAY_MONTH_DATE_TITLE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(?:\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME_PATTERN}(?:\\s+\\d{4})?\\b`,
  'gi',
);
const MONTH_DAY_DATE_TITLE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?${MONTH_NAME_PATTERN}\\s+(?:\\d{1,2})(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b`,
  'gi',
);

const CAPTURE_KIND_REPLY_MAP = Object.freeze({
  '!': 'reminder',
  '+': 'note',
  reminder: 'reminder',
  reminders: 'reminder',
  task: 'reminder',
  tasks: 'reminder',
  note: 'note',
  notes: 'note',
  notebook: 'note',
});

const TASK_LIKE_PREFIXES = [
  'add',
  'ask',
  'book',
  'bring',
  'buy',
  'call',
  'check',
  'clean',
  'collect',
  'do',
  'drop',
  'email',
  'finish',
  'follow up',
  'get',
  'make',
  'move',
  'organise',
  'organize',
  'pack',
  'pay',
  'phone',
  'pick up',
  'post',
  'prepare',
  'put',
  'return',
  'ring',
  'save',
  'send',
  'sort',
  'start',
  'take',
  'text',
  'tidy',
  'update',
  'wash',
  'write',
];

const normalizeCaptureKind = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return CAPTURE_KIND_REPLY_MAP[normalized] || null;
};

const parseQuickCapturePrefix = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const prefix = text.charAt(0);
  if (prefix === QUICK_CAPTURE_PREFIXES.reminder || prefix === QUICK_CAPTURE_PREFIXES.note) {
    const body = text.slice(1).trim();
    const kind = prefix === QUICK_CAPTURE_PREFIXES.reminder ? 'reminder' : 'note';
    if (!body) {
      return { kind, text: '' };
    }
    return { kind, text: body };
  }

  return null;
};

const looksLikeTaskCapture = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text || text.endsWith('?')) {
    return false;
  }
  if (parseQuickCapturePrefix(text)) {
    return false;
  }
  if (/\b(remind|reminder|note|notes|idea|journal|meeting notes)\b/.test(text)) {
    return false;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 8) {
    return false;
  }

  return TASK_LIKE_PREFIXES.some((prefix) => text.startsWith(`${prefix} `) || text === prefix);
};

const createForcedParsedEntry = (kind, text, hints = {}) => ({
  type: kind === 'reminder' ? 'reminder' : 'note',
  title: text,
  tags: [],
  reminderDate: null,
  metadata: {
    source: hints?.source,
    entryPoint: hints?.entryPoint,
    capturedAt: hints?.capturedAt,
    forcedCaptureKind: kind,
  },
});

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

const stripReminderPromptPrefix = (text) => {
  let cleaned = normalizeText(text);
  if (!cleaned) {
    return '';
  }

  const prefixPatterns = [
    /^(?:and\s+)+/i,
    /^(?:(?:please|hey|ok(?:ay)?)\s+)?(?:(?:add|set|create|make)\s+)?(?:(?:me\s+)?(?:a|an)\s+)?(?:new\s+)?(?:reminder|remider|remind(?:er)?(?:\s+me)?|reminder\s+me)\b[\s:,-]*/i,
    /^(?:and\s+)?(?:remind(?:er)?\s+me\s+to|remind\s+me\s+to|remember\s+to)\b[\s:,-]*/i,
  ];

  let updated = true;
  while (updated && cleaned) {
    updated = false;
    prefixPatterns.forEach((pattern) => {
      const next = cleaned.replace(pattern, '').trim();
      if (next !== cleaned) {
        cleaned = next;
        updated = true;
      }
    });
  }

  return cleaned;
};

const cleanReminderTitle = (text) => {
  let cleaned = stripReminderPromptPrefix(text);
  if (!cleaned) {
    return '';
  }

  cleaned = cleaned
    .replace(/\b(?:today|tomorrow|tonight|next week|morning|afternoon|evening|night)\b/gi, ' ')
    .replace(/\b(?:(?:next)\s+)?(?:monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/gi, ' ')
    .replace(DAY_MONTH_DATE_TITLE_PATTERN, ' ')
    .replace(MONTH_DAY_DATE_TITLE_PATTERN, ' ')
    .replace(/\b(?:at\s*)?(?:\d{1,2}(?::\d{2})?|\d{3,4})\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:at\s*)?\d{1,2}:\d{2}\b/gi, ' ')
    .replace(/^[,.\-:;\s]+|[,.\-:;\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(?:and|to)\b\s*/i, '')
    .replace(/\b(?:at|on|by|for)\b\s*$/i, '')
    .trim();

  return cleaned;
};

const parseExplicitReminderDate = (normalizedText, now) => {
  if (typeof normalizedText !== 'string' || !normalizedText.trim()) {
    return null;
  }

  const buildCandidate = (year, monthIndex, day, timeParts) => {
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
      return null;
    }

    const candidate = new Date(now.getTime());
    candidate.setFullYear(year, monthIndex, day);
    candidate.setHours(0, 0, 0, 0);

    if (
      candidate.getFullYear() !== year
      || candidate.getMonth() !== monthIndex
      || candidate.getDate() !== day
    ) {
      return null;
    }

    const resolvedTime = timeParts || { hours: 9, minutes: 0 };
    return setTimeOnDate(candidate, resolvedTime.hours, resolvedTime.minutes);
  };

  const dayMonthMatch = normalizedText.match(DAY_MONTH_DATE_PATTERN);
  if (dayMonthMatch) {
    const day = Number.parseInt(dayMonthMatch[1], 10);
    const monthIndex = MONTH_NAME_TO_INDEX[dayMonthMatch[2]];
    const year = dayMonthMatch[3] ? Number.parseInt(dayMonthMatch[3], 10) : now.getFullYear();
    const timeParts = extractTimeParts(normalizedText);
    const candidate = buildCandidate(year, monthIndex, day, timeParts);
    if (candidate) {
      return toIsoString(candidate);
    }
  }

  const monthDayMatch = normalizedText.match(MONTH_DAY_DATE_PATTERN);
  if (monthDayMatch) {
    const monthIndex = MONTH_NAME_TO_INDEX[monthDayMatch[1]];
    const day = Number.parseInt(monthDayMatch[2], 10);
    const year = monthDayMatch[3] ? Number.parseInt(monthDayMatch[3], 10) : now.getFullYear();
    const timeParts = extractTimeParts(normalizedText);
    const candidate = buildCandidate(year, monthIndex, day, timeParts);
    if (candidate) {
      return toIsoString(candidate);
    }
  }

  return null;
};

const extractTimeParts = (normalizedText) => {
  if (typeof normalizedText !== 'string' || !normalizedText.trim()) {
    return null;
  }

  const explicitMeridiemMatch = normalizedText.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (explicitMeridiemMatch) {
    let hours = Number.parseInt(explicitMeridiemMatch[1], 10);
    const minutes = explicitMeridiemMatch[2] ? Number.parseInt(explicitMeridiemMatch[2], 10) : 0;
    const meridiem = explicitMeridiemMatch[3];

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  const colonTimeMatch = normalizedText.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/);
  if (colonTimeMatch) {
    return {
      hours: Number.parseInt(colonTimeMatch[1], 10),
      minutes: Number.parseInt(colonTimeMatch[2], 10),
    };
  }

  const compactTimeMatch = normalizedText.match(/\b(?:at\s+)?(\d{3,4})\b/);
  if (compactTimeMatch) {
    const compactValue = compactTimeMatch[1];
    const hoursDigits = compactValue.length === 3 ? compactValue.slice(0, 1) : compactValue.slice(0, 2);
    const minutesDigits = compactValue.length === 3 ? compactValue.slice(1) : compactValue.slice(2);
    const hours = Number.parseInt(hoursDigits, 10);
    const minutes = Number.parseInt(minutesDigits, 10);

    if (Number.isFinite(hours) && Number.isFinite(minutes) && minutes < 60) {
      return { hours, minutes };
    }
  }

  return null;
};

const buildReminderDate = (normalizedText, now) => {
  if (/\bnext week\b/.test(normalizedText)) {
    const dueDate = new Date(now.getTime());
    dueDate.setDate(dueDate.getDate() + 7);
    return dueDate;
  }

  if (/\btomorrow\b/.test(normalizedText)) {
    const dueDate = new Date(now.getTime());
    dueDate.setDate(dueDate.getDate() + 1);
    return dueDate;
  }

  if (/\b(today|tonight)\b/.test(normalizedText)) {
    return new Date(now.getTime());
  }

  return null;
};

const looksLikeReminderTimingReply = (text) => Boolean(parseReminderDueAt(text, new Date(), { allowTimeOnly: true }));

const parseReminderDueAt = (text, now = new Date(), options = {}) => {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/\btonight\b/.test(normalized)) {
    const tonightTime = extractTimeParts(normalized) || { hours: 19, minutes: 0 };
    return toIsoString(setTimeOnDate(now, tonightTime.hours, tonightTime.minutes));
  }

  const explicitDate = parseExplicitReminderDate(normalized, now);
  if (explicitDate) {
    return explicitDate;
  }

  const dueDate = buildReminderDate(normalized, now);
  const timeParts = extractTimeParts(normalized);

  if (dueDate) {
    const resolvedTime = timeParts || { hours: 9, minutes: 0 };
    return toIsoString(setTimeOnDate(dueDate, resolvedTime.hours, resolvedTime.minutes));
  }

  if (options.allowTimeOnly && timeParts) {
    const candidate = setTimeOnDate(now, timeParts.hours, timeParts.minutes);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return toIsoString(candidate);
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
  const resolvedTitle = cleanReminderTitle(intent?.payload?.text || parsedEntry?.title || intent?.text || '');

  return {
    decisionType: 'persist_reminder',
    parsedType: intent?.parsedType || 'reminder',
    text: intent?.text || parsedEntry?.title || '',
    parsedEntry: {
      ...parsedEntry,
      type: 'reminder',
      title: resolvedTitle || intent?.payload?.text || parsedEntry?.title || intent?.text || '',
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

const buildPendingCaptureKindDecision = (kind, originalText, hints = {}) => {
  const parsedEntry = createForcedParsedEntry(kind, originalText, hints);
  if (kind === 'reminder') {
    return {
      decisionType: 'persist_reminder',
      parsedType: 'reminder',
      text: originalText,
      parsedEntry,
      missing: [],
      hints,
    };
  }

  return {
    decisionType: 'persist_note',
    parsedType: 'note',
    text: originalText,
    parsedEntry,
    missing: [],
    hints,
  };
};

const enrichReminderDecision = (decision, text) => {
  if (decision?.decisionType !== 'persist_reminder') {
    return decision;
  }

  const parsedEntry = decision?.parsedEntry && typeof decision.parsedEntry === 'object'
    ? decision.parsedEntry
    : {};
  const dueAt = typeof parsedEntry?.reminderDate === 'string' && parsedEntry.reminderDate.trim()
    ? parsedEntry.reminderDate.trim()
    : parseReminderDueAt(text);
  const resolvedTitle = cleanReminderTitle(parsedEntry?.title || text);
  const missing = Array.isArray(decision?.missing)
    ? decision.missing.filter((value) => value !== 'dueAt')
    : [];

  if (!dueAt) {
    const forcedCaptureKind = normalizeCaptureKind(parsedEntry?.metadata?.forcedCaptureKind);
    if (forcedCaptureKind !== 'reminder') {
      missing.push('dueAt');
    }
  }

  return {
    ...decision,
    parsedEntry: {
      ...parsedEntry,
      type: 'reminder',
      title: resolvedTitle || parsedEntry?.title || text,
      reminderDate: dueAt,
      metadata: {
        ...(parsedEntry?.metadata && typeof parsedEntry.metadata === 'object' ? parsedEntry.metadata : {}),
        ...(dueAt ? { dueAt } : {}),
      },
    },
    missing,
  };
};

const maybeResolvePendingIntent = async (text, hints = {}) => {
  const channelKey = getPendingChannelKey(hints);
  const pendingCaptureKind = pendingCaptureKindsByChannel.get(channelKey) || null;
  if (pendingCaptureKind) {
    const selectedKind = normalizeCaptureKind(text);
    if (selectedKind === 'reminder' || selectedKind === 'note') {
      const decision = buildPendingCaptureKindDecision(
        selectedKind,
        pendingCaptureKind.originalText,
        pendingCaptureKind.hints,
      );
      pendingCaptureKindsByChannel.delete(channelKey);
      return { decision };
    }

    pendingCaptureKindsByChannel.delete(channelKey);
  }

  const pendingIntent = pendingIntentsByChannel.get(channelKey) || null;
  if (!pendingIntent) {
    return null;
  }

  const dueAt = parseReminderDueAt(text, new Date(), { allowTimeOnly: true });
  const decision = buildPendingReminderDecision(pendingIntent, dueAt);

  if (!dueAt && !looksLikeReminderTimingReply(text)) {
    pendingIntentsByChannel.delete(channelKey);
    return null;
  }

  if (decision.missing.length) {
    pendingIntentsByChannel.set(channelKey, {
      ...pendingIntent,
      lastFollowUpText: text,
    });
    return {
      clarification: buildAssistantResponse('When should I remind you?'),
    };
  }

  pendingIntentsByChannel.delete(channelKey);
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

export async function analyzeCaptureInput({
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

  const quickCapture = parseQuickCapturePrefix(normalizedText);
  if (quickCapture?.kind && quickCapture.text) {
    const parsedEntry = createForcedParsedEntry(quickCapture.kind, quickCapture.text, hints);
    const decision = quickCapture.kind === 'reminder'
      ? enrichReminderDecision({
        decisionType: 'persist_reminder',
        parsedType: 'reminder',
        text: quickCapture.text,
        parsedEntry,
        missing: [],
        hints,
      }, quickCapture.text)
      : {
        decisionType: 'persist_note',
        parsedType: 'note',
        text: quickCapture.text,
        parsedEntry,
        missing: [],
        hints,
      };

    return {
      text: quickCapture.text,
      context,
      hints,
      decision,
    };
  }

  if (looksLikeTaskCapture(normalizedText)) {
    return {
      text: normalizedText,
      context,
      hints,
      decision: {
        decisionType: 'choose_capture_kind',
        parsedType: 'unknown',
        text: normalizedText,
        parsedEntry: createForcedParsedEntry('note', normalizedText, hints),
        missing: ['captureKind'],
        hints,
      },
    };
  }

  const resolvedDecision = await resolveDecision(normalizedText, hints);
  const decision = enrichReminderDecision(resolvedDecision, normalizedText);

  return {
    text: normalizedText,
    context,
    hints,
    decision,
  };
}

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

  const channelKey = getPendingChannelKey(context);
  const pendingResolution = await maybeResolvePendingIntent(normalizedText, context);
  if (pendingResolution?.clarification) {
    return pendingResolution.clarification;
  }
  if (pendingResolution?.decision) {
    const pendingDecision = pendingResolution.decision;
    if (pendingDecision.decisionType === 'persist_note') {
      const memory = await saveNoteMemory(pendingDecision.text, pendingDecision, context);
      return {
        decision: pendingDecision,
        data: memory,
        message: 'Saved note.',
      };
    }
    if (pendingDecision.decisionType === 'persist_reminder') {
      const reminder = await createReminder({
        text: pendingDecision?.parsedEntry?.title || pendingDecision.text || normalizedText,
        dueAt: pendingDecision?.parsedEntry?.reminderDate || undefined,
        source: 'capture',
      });
      return buildAssistantResponse('Reminder created.', {
        decision: pendingDecision,
        data: reminder,
      });
    }
  }

  const analyzedCapture = pendingResolution?.decision
    ? { decision: pendingResolution.decision }
    : await analyzeCaptureInput({
      text: normalizedText,
      source: context.source,
      metadata: hints,
    });
  const decision = analyzedCapture?.decision || null;

  switch (decision?.decisionType) {
    case 'choose_capture_kind': {
      pendingCaptureKindsByChannel.set(channelKey, {
        originalText: normalizedText,
        hints,
      });
      return buildAssistantResponse('Should I save that as a reminder or a note?');
    }
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
        pendingIntentsByChannel.set(channelKey, {
          ...decision,
          payload: {
            text: decision?.parsedEntry?.title || normalizedText,
            dueAt: decision?.parsedEntry?.reminderDate || null,
          },
        });
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
        message: 'Saved for later review.',
      };
    }
  }
}

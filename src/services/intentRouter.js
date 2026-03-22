import { predictIntent, recordPattern } from './patternLearningService.js';

const NOTEBOOK_CAPTURE_PATTERN = /(meeting notes|lesson idea|remember\b|notes?\s+from|journal|plan\b|scored\b)/i;
const REMINDER_KEYWORDS = ['remind', 'tomorrow', 'tonight', 'later', 'buy', 'pick up'];
const NOTE_KEYWORDS = ['idea', 'note', 'remember', 'lesson'];
const DRILL_KEYWORDS = ['drill', 'training', 'coaching'];
const QUESTION_PREFIXES = ['what', 'when', 'how', 'where'];
const PLAN_DAY_PHRASES = ['plan my day', 'what should i do today', 'daily plan', 'schedule my day'];

export const DECISION_TYPES = ['query_memory', 'learn_pattern', 'plan_day', 'persist_reminder', 'persist_note', 'persist_inbox'];

const countKeywordMatches = (normalizedText, keywords) => keywords.reduce((count, keyword) => (
  normalizedText.includes(keyword) ? count + 1 : count
), 0);

const createHeuristicParsedEntry = (type, text, hints = {}) => ({
  type,
  title: text,
  tags: [],
  reminderDate: null,
  metadata: {
    source: hints?.source,
    entryPoint: hints?.entryPoint,
    capturedAt: hints?.capturedAt,
  },
});

const isPlanDayPhrase = (normalizedText) => PLAN_DAY_PHRASES
  .some((phrase) => normalizedText.includes(phrase));

const logRoutingDecision = (_source, _text, decision, _details = {}) => decision;

/**
 * Heuristic-first routing to reduce /api/parse-entry usage.
 * If we can classify with high confidence locally, we skip AI parsing.
 */
export const classifyIntentLocally = (rawText, hints = {}) => {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  const normalized = text.toLowerCase();
  if (!normalized) {
    return null;
  }

  const patternMatch = predictIntent(text);
  if (isPlanDayPhrase(normalized)) {
    return logRoutingDecision('classifyIntentLocally.phrase', text, {
      decisionType: 'plan_day',
      parsedType: 'plan_day',
      text,
      parsedEntry: createHeuristicParsedEntry('plan_day', text, hints),
      hints,
    });
  }

  if (patternMatch?.predictedIntent === 'persist_reminder') {
    return logRoutingDecision('classifyIntentLocally.pattern', text, {
      decisionType: 'persist_reminder',
      parsedType: 'reminder',
      text,
      parsedEntry: createHeuristicParsedEntry('reminder', text, hints),
      hints,
    });
  }

  if (patternMatch?.predictedIntent === 'persist_note') {
    return logRoutingDecision('classifyIntentLocally.pattern', text, {
      decisionType: 'persist_note',
      parsedType: 'note',
      text,
      parsedEntry: createHeuristicParsedEntry('note', text, hints),
      hints,
    });
  }

  if (patternMatch?.predictedIntent === 'query' || patternMatch?.predictedIntent === 'query_memory') {
    return logRoutingDecision('classifyIntentLocally.pattern', text, {
      decisionType: 'query_memory',
      parsedType: 'question',
      text,
      parsedEntry: createHeuristicParsedEntry('question', text, hints),
      hints,
    });
  }

  if (patternMatch?.predictedIntent === 'learn_pattern') {
    return logRoutingDecision('classifyIntentLocally.pattern', text, {
      decisionType: 'learn_pattern',
      parsedType: 'learn_pattern',
      text,
      parsedEntry: createHeuristicParsedEntry('learn_pattern', text, hints),
      hints,
    });
  }

  if (patternMatch?.predictedIntent === 'plan_day') {
    return logRoutingDecision('classifyIntentLocally.pattern', text, {
      decisionType: 'plan_day',
      parsedType: 'plan_day',
      text,
      parsedEntry: createHeuristicParsedEntry('plan_day', text, hints),
      hints,
    });
  }

  const startsWithQuestion = QUESTION_PREFIXES
    .some((prefix) => normalized.startsWith(`${prefix} `));

  const reminderScore = countKeywordMatches(normalized, REMINDER_KEYWORDS);
  const noteScore = countKeywordMatches(normalized, NOTE_KEYWORDS);
  const drillScore = countKeywordMatches(normalized, DRILL_KEYWORDS);
  const questionScore = (text.endsWith('?') ? 2 : 0) + (startsWithQuestion ? 1 : 0);

  const scored = [
    { kind: 'reminder', score: reminderScore },
    { kind: 'drill', score: drillScore },
    { kind: 'note', score: noteScore },
    { kind: 'question', score: questionScore },
  ].sort((a, b) => b.score - a.score);

  const [top, next] = scored;
  const isConfident = top.score >= 1 && top.score > (next?.score || 0);
  if (!isConfident) {
    return null;
  }

  if (top.kind === 'reminder') {
    const parsedEntry = createHeuristicParsedEntry('reminder', text, hints);
    const decision = {
      decisionType: 'persist_reminder',
      parsedType: 'reminder',
      text,
      parsedEntry,
      hints,
    };
    return logRoutingDecision('classifyIntentLocally', text, decision);
  }

  if (top.kind === 'drill' || top.kind === 'note') {
    const parsedType = top.kind === 'drill' ? 'drill' : 'note';
    const parsedEntry = createHeuristicParsedEntry(parsedType, text, hints);
    const decision = {
      decisionType: 'persist_note',
      parsedType,
      text,
      parsedEntry,
      hints,
    };
    return logRoutingDecision('classifyIntentLocally', text, decision);
  }

  const parsedEntry = createHeuristicParsedEntry('question', text, hints);
  const decision = {
    decisionType: 'query_memory',
    parsedType: 'question',
    text,
    parsedEntry,
    hints,
  };
  return logRoutingDecision('classifyIntentLocally', text, decision);
};

const normalizeType = (parsedType, rawText) => {
  const normalizedType = typeof parsedType === 'string' ? parsedType.trim().toLowerCase() : '';
  if (normalizedType) {
    return normalizedType;
  }

  const normalizedText = typeof rawText === 'string' ? rawText.trim() : '';
  return normalizedText.endsWith('?') ? 'question' : 'unknown';
};

const looksLikeNotebookCapture = (rawText) => {
  const normalized = typeof rawText === 'string' ? rawText.trim().toLowerCase() : '';
  if (!normalized) {
    return false;
  }
  if (normalized.includes('?')) {
    return false;
  }
  return NOTEBOOK_CAPTURE_PATTERN.test(normalized);
};

/**
 * Shared, pure routing decision for parsed captures.
 *
 * Inputs:
 * - parsedEntry: parser payload (type/title/tags/metadata/reminderDate)
 * - rawText: original user text
 * - hints: optional metadata from caller context
 *
 * Output:
 * - normalized decision object for caller-side handling
 */
export const routeIntent = (parsedEntry, rawText, hints = {}) => {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  const normalizedText = text.toLowerCase();
  const parsed = parsedEntry && typeof parsedEntry === 'object' ? parsedEntry : {};
  const parsedType = normalizeType(parsed?.type, text);
  const notebookHeuristic = looksLikeNotebookCapture(text);
  const isQuestion = parsedType === 'question' || text.endsWith('?');

  if (parsedType === 'learn_pattern') {
    const decision = {
      decisionType: 'learn_pattern',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    return logRoutingDecision('routeIntent', text, decision);
  }

  if (parsedType === 'plan_day') {
    const decision = {
      decisionType: 'plan_day',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    return logRoutingDecision('routeIntent', text, decision);
  }

  if (isPlanDayPhrase(normalizedText)) {
    const decision = {
      decisionType: 'plan_day',
      parsedType: 'plan_day',
      text,
      parsedEntry: parsed,
      hints,
    };
    return logRoutingDecision('routeIntent.phrase', text, decision);
  }

  if (parsedType === 'reminder') {
    const decision = {
      decisionType: 'persist_reminder',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    recordPattern(text, { predictedIntent: decision.decisionType, predictedNotebook: '' });
    return logRoutingDecision('routeIntent', text, decision);
  }

  if (
    parsedType === 'note'
    || parsedType === 'drill'
    || parsedType === 'idea'
    || parsedType === 'task'
    || notebookHeuristic
  ) {
    const decision = {
      decisionType: 'persist_note',
      parsedType,
      text,
      parsedEntry: parsed,
      notebookHeuristic,
      hints,
    };
    recordPattern(text, { predictedIntent: decision.decisionType, predictedNotebook: '' });
    return logRoutingDecision('routeIntent', text, decision, { notebookHeuristic });
  }

  if (isQuestion) {
    const decision = {
      decisionType: 'query_memory',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    recordPattern(text, { predictedIntent: decision.decisionType, predictedNotebook: '' });
    return logRoutingDecision('routeIntent', text, decision);
  }

  const decision = {
    decisionType: 'persist_inbox',
    parsedType,
    text,
    parsedEntry: parsed,
    hints,
  };
  recordPattern(text, { predictedIntent: decision.decisionType, predictedNotebook: 'Inbox' });
  return logRoutingDecision('routeIntent', text, decision);
};

const mapDecisionTypeToIntentType = (decisionType) => {
  switch (decisionType) {
    case 'persist_reminder':
      return 'reminder';
    case 'persist_note':
      return 'note';
    case 'query_memory':
    case 'assistant_query':
      return 'query';
    case 'plan_day':
      return 'plan_day';
    case 'learn_pattern':
      return 'learn_pattern';
    case 'persist_inbox':
    default:
      return 'inbox';
  }
};

/**
 * Canonical classification entry point for user text.
 * This is intentionally pure routing metadata: callers decide how to execute.
 */
export const intentRouter = (query, context = {}) => {
  const text = typeof query === 'string' ? query.trim() : '';
  const hints = context && typeof context === 'object' ? context : {};
  const parsedEntry = hints?.parsedEntry && typeof hints.parsedEntry === 'object'
    ? hints.parsedEntry
    : null;

  const decision = parsedEntry
    ? routeIntent(parsedEntry, text, hints)
    : classifyIntentLocally(text, hints);

  if (!decision) {
    return {
      type: 'unknown',
      payload: {
        query: text,
        text,
        dueAt: null,
        missing: [],
        decisionType: 'unresolved',
        parsedType: 'unknown',
        hints,
      },
    };
  }

  const reminderText = typeof decision?.parsedEntry?.title === 'string' && decision.parsedEntry.title.trim()
    ? decision.parsedEntry.title.trim()
    : text;
  const reminderDueAt =
    (typeof decision?.parsedEntry?.reminderDate === 'string' && decision.parsedEntry.reminderDate.trim())
    || (typeof decision?.parsedEntry?.metadata?.dueAt === 'string' && decision.parsedEntry.metadata.dueAt.trim())
    || null;
  const missing = decision.decisionType === 'persist_reminder' && !reminderDueAt
    ? ['dueAt']
    : [];

  return {
    type: decision.decisionType,
    payload: {
      query: text,
      text: reminderText,
      dueAt: reminderDueAt,
      missing,
      decisionType: decision.decisionType,
      parsedType: decision.parsedType || 'unknown',
      parsedEntry: decision.parsedEntry || null,
      intentType: mapDecisionTypeToIntentType(decision.decisionType),
      hints,
    },
  };
};

export const createChatIntentInput = (parsedEntry, rawText, hints = {}) => ({
  parsedEntry,
  rawText,
  hints: { ...hints, source: 'chat' },
});

export const createCaptureIntentInput = (parsedEntry, rawText, hints = {}) => ({
  parsedEntry,
  rawText,
  hints: { ...hints, source: 'capture' },
});

export const createInboxIntentInput = (parsedEntry, rawText, hints = {}) => ({
  parsedEntry,
  rawText,
  hints: { ...hints, source: 'inbox_processor' },
});

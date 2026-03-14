const NOTEBOOK_CAPTURE_PATTERN = /(meeting notes|lesson idea|remember\b|notes?\s+from|journal|plan\b|scored\b)/i;
const REMINDER_KEYWORDS = ['remind', 'tomorrow', 'tonight', 'later', 'buy', 'pick up'];
const NOTE_KEYWORDS = ['idea', 'note', 'remember', 'lesson'];
const DRILL_KEYWORDS = ['drill', 'training', 'coaching'];
const QUESTION_PREFIXES = ['what', 'when', 'how', 'where'];
const INTENT_PATTERNS_KEY = 'memoryCueIntentPatterns';
const MAX_STORED_PATTERNS = 50;

const getPatternStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

const tokenizeText = (rawText) => {
  const normalized = typeof rawText === 'string' ? rawText.trim().toLowerCase() : '';
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(
    normalized
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  ));
};

const readIntentPatterns = () => {
  const storage = getPatternStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(INTENT_PATTERNS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[intent-router] Unable to read intent patterns from localStorage.', error);
    return [];
  }
};

const writeIntentPatterns = (patterns) => {
  const storage = getPatternStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(INTENT_PATTERNS_KEY, JSON.stringify(patterns.slice(0, MAX_STORED_PATTERNS)));
  } catch (error) {
    console.warn('[intent-router] Unable to persist intent patterns to localStorage.', error);
  }
};

const learnIntentPattern = (rawText, decisionType) => {
  const tokens = tokenizeText(rawText).slice(0, 5);
  if (!tokens.length || !decisionType) {
    return;
  }

  const existing = readIntentPatterns();
  const now = Date.now();
  const updates = tokens.map((token) => ({ token, decisionType, capturedAt: now }));
  writeIntentPatterns([...updates, ...existing]);
};

const countKeywordMatches = (normalizedText, keywords) => keywords.reduce((count, keyword) => (
  normalizedText.includes(keyword) ? count + 1 : count
), 0);

const getLearnedBias = (tokens) => {
  const bias = {
    persist_reminder: 0,
    persist_note: 0,
    query: 0,
  };

  if (!tokens.length) {
    return bias;
  }

  const patterns = readIntentPatterns();
  patterns.forEach((pattern) => {
    if (!tokens.includes(pattern?.token)) {
      return;
    }

    if (pattern?.decisionType === 'persist_reminder') {
      bias.persist_reminder += 1;
    } else if (pattern?.decisionType === 'persist_note') {
      bias.persist_note += 1;
    } else if (pattern?.decisionType === 'query') {
      bias.query += 1;
    }
  });

  return bias;
};

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

  const startsWithQuestion = QUESTION_PREFIXES
    .some((prefix) => normalized.startsWith(`${prefix} `));

  const tokens = tokenizeText(normalized);
  const learnedBias = getLearnedBias(tokens);

  const reminderScore = countKeywordMatches(normalized, REMINDER_KEYWORDS) + learnedBias.persist_reminder;
  const noteScore = countKeywordMatches(normalized, NOTE_KEYWORDS) + learnedBias.persist_note;
  const drillScore = countKeywordMatches(normalized, DRILL_KEYWORDS);
  const questionScore = (text.endsWith('?') ? 2 : 0) + (startsWithQuestion ? 1 : 0) + learnedBias.query;

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
    learnIntentPattern(text, decision.decisionType);
    return decision;
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
    learnIntentPattern(text, decision.decisionType);
    return decision;
  }

  const parsedEntry = createHeuristicParsedEntry('question', text, hints);
  const decision = {
    decisionType: 'query',
    parsedType: 'question',
    text,
    parsedEntry,
    hints,
  };
  learnIntentPattern(text, decision.decisionType);
  return decision;
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
  const parsed = parsedEntry && typeof parsedEntry === 'object' ? parsedEntry : {};
  const parsedType = normalizeType(parsed?.type, text);
  const notebookHeuristic = looksLikeNotebookCapture(text);
  const isQuestion = parsedType === 'question' || text.endsWith('?');

  if (parsedType === 'reminder') {
    const decision = {
      decisionType: 'persist_reminder',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    learnIntentPattern(text, decision.decisionType);
    return decision;
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
    learnIntentPattern(text, decision.decisionType);
    return decision;
  }

  if (isQuestion) {
    const decision = {
      decisionType: 'query',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
    learnIntentPattern(text, decision.decisionType);
    return decision;
  }

  return {
    decisionType: 'persist_inbox',
    parsedType,
    text,
    parsedEntry: parsed,
    hints,
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

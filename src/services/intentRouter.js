const NOTEBOOK_CAPTURE_PATTERN = /(meeting notes|lesson idea|remember\b|notes?\s+from|journal|plan\b|scored\b)/i;

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
    return {
      decisionType: 'persist_reminder',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
  }

  if (
    parsedType === 'note'
    || parsedType === 'drill'
    || parsedType === 'idea'
    || parsedType === 'task'
    || notebookHeuristic
  ) {
    return {
      decisionType: 'persist_note',
      parsedType,
      text,
      parsedEntry: parsed,
      notebookHeuristic,
      hints,
    };
  }

  if (isQuestion) {
    return {
      decisionType: 'query',
      parsedType,
      text,
      parsedEntry: parsed,
      hints,
    };
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

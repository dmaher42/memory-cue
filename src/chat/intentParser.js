/*
 * DEPRECATED MODULE
 *
 * Intent classification for capture messages has moved to the canonical
 * /api/parse-entry contract consumed by src/chat/chatManager.js.
 *
 * Migration note: do not add new imports of parseIntent(). Route capture
 * inputs through chatManager (or callers that use /api/parse-entry directly)
 * and consume the canonical parsed shape:
 * { type, title, tags, reminderDate, metadata }.
 */

const MEMORY_SEARCH_PREFIXES = ['what', 'show', 'find', 'list'];

const isMemorySearchQuery = (text) => {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (!normalized) {
    return false;
  }

  return MEMORY_SEARCH_PREFIXES.some((prefix) => normalized.startsWith(`${prefix} `));
};

export const parseIntent = (text) => {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';

  if (normalized.includes('remind')) {
    return 'reminder';
  }

  if (isMemorySearchQuery(normalized)) {
    return 'memorySearch';
  }

  if (normalized.includes('note')) {
    return 'note';
  }

  if (normalized.includes('idea')) {
    return 'capture';
  }

  if (normalized.endsWith('?')) {
    return 'assistant';
  }

  return 'capture';
};

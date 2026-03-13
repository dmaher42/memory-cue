export const parseIntent = (text) => {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';

  if (normalized.includes('remind')) {
    return 'reminder';
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

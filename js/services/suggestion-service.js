export function analyseText(text) {
  const normalized = typeof text === 'string' ? text.toLowerCase() : '';

  if (normalized.includes('tomorrow') || /\d+\s*(am|pm)\b/i.test(normalized)) {
    return {
      type: 'reminder',
      reason: 'Contains time reference'
    };
  }

  if (normalized.length > 60) {
    return {
      type: 'note',
      reason: 'Long text likely a note'
    };
  }

  return {
    type: 'none',
    reason: ''
  };
}

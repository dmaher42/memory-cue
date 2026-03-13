const reminderServiceState = {
  handler: null,
};

export const setReminderCreationHandler = (handler) => {
  reminderServiceState.handler = typeof handler === 'function' ? handler : null;
  return reminderServiceState.handler;
};

export const buildReminderPayload = (payload = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const title =
    typeof source.title === 'string' && source.title.trim()
      ? source.title.trim()
      : typeof source.text === 'string' && source.text.trim()
        ? source.text.trim()
        : '';

  const normalized = { title };
  const passthroughKeys = [
    'priority',
    'category',
    'notes',
    'due',
    'notifyAt',
    'plannerLessonId',
    'pinToToday',
    'semanticEmbedding',
  ];

  passthroughKeys.forEach((key) => {
    if (source[key] !== undefined) {
      normalized[key] = source[key];
    }
  });

  return normalized;
};

export const createReminder = async (payload = {}, options = {}) => {
  const handler =
    typeof options?.handler === 'function'
      ? options.handler
      : typeof reminderServiceState.handler === 'function'
        ? reminderServiceState.handler
        : null;

  if (typeof handler !== 'function') {
    throw new Error('Reminder creation logic is unavailable.');
  }

  return handler(buildReminderPayload(payload));
};

if (typeof window !== 'undefined') {
  window.MemoryCueReminderService = {
    createReminder,
    buildReminderPayload,
    setReminderCreationHandler,
  };
}

import { indexSourceEmbedding } from './embeddingService.js';

const reminderServiceState = {
  handler: null,
};

export const setReminderCreationHandler = (handler) => {
  reminderServiceState.handler = typeof handler === 'function' ? handler : null;
  return reminderServiceState.handler;
};

export const buildReminderPayload = (payload = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const now = Date.now();
  const titleCandidates = [source.title, source.text, source.name];
  const title = titleCandidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

  const dueCandidates = [source.due, source.dueAt, source.dueDate];
  const dueValue = dueCandidates.find((value) => value instanceof Date || (typeof value === 'string' && value.trim()));
  const due = dueValue instanceof Date
    ? dueValue.toISOString()
    : typeof dueValue === 'string' && dueValue.trim()
      ? dueValue.trim()
      : null;

  const normalized = {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : '',
    title,
    notes: typeof source.notes === 'string' ? source.notes.trim() : '',
    due,
    priority: typeof source.priority === 'string' && source.priority.trim() ? source.priority.trim() : 'Medium',
    category: typeof source.category === 'string' && source.category.trim() ? source.category.trim() : 'General',
    done: source.done === true || source.completed === true || source.isDone === true || source.status === 'done',
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : now,
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : now,
    keywords: Array.isArray(source.keywords)
      ? source.keywords.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().toLowerCase())
      : [],
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null,
  };
  const passthroughKeys = [
    'priority',
    'category',
    'notes',
    'notifyAt',
    'plannerLessonId',
    'pinToToday',
    'semanticEmbedding',
    'recurrence',
    'snoozedUntil',
    'notifyMinutesBefore',
  ];

  passthroughKeys.forEach((key) => {
    if (source[key] !== undefined) {
      normalized[key] = source[key];
    }
  });

  delete normalized.dueAt;
  delete normalized.dueDate;

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

  const normalizedPayload = buildReminderPayload(payload);
  const reminder = await handler(normalizedPayload);
  const reminderId = typeof reminder?.id === 'string' ? reminder.id : null;
  const reminderText = [normalizedPayload.title, normalizedPayload.notes].filter(Boolean).join(' ').trim();

  if (reminderId && reminderText) {
    indexSourceEmbedding({
      text: reminderText,
      sourceType: 'reminder',
      sourceId: reminderId,
    }).catch((error) => {
      console.warn('[embedding] Failed to index reminder embedding', error);
    });
  }

  return reminder;
};

if (typeof window !== 'undefined') {
  window.MemoryCueReminderService = {
    createReminder,
    buildReminderPayload,
    setReminderCreationHandler,
  };
}

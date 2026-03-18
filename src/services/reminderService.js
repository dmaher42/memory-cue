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
  const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
  const normalizeEpochMs = (value) => {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const normalizePriority = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return ['low', 'medium', 'high'].includes(normalized) ? normalized : null;
  };
  const normalizeSource = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return 'manual';
    if (normalized === 'quick-add' || normalized === 'quick_add' || normalized === 'quick capture' || normalized === 'quick_capture') return 'manual';
    return ['capture', 'manual', 'inbox', 'system'].includes(normalized) ? normalized : 'manual';
  };
  const text = normalizeText(source.text || source.title || source.name || source.notes);

  return {
    id: normalizeText(source.id),
    text,
    dueAt: normalizeEpochMs(source.dueAt ?? source.due ?? source.dueDate),
    createdAt: normalizeEpochMs(source.createdAt) ?? now,
    updatedAt: normalizeEpochMs(source.updatedAt) ?? now,
    completed: source.completed === true || source.done === true || source.isDone === true || source.status === 'done',
    category: normalizeText(source.category) || null,
    priority: normalizePriority(source.priority) || 'medium',
    source: normalizeSource(source.source ?? source.metadata?.source),
  };
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
  const reminderText = typeof normalizedPayload.text === 'string' ? normalizedPayload.text.trim() : '';

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

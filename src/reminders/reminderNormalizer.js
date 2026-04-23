const DEFAULT_SOURCE = 'manual';
const DEFAULT_PRIORITY = 'Medium';
const DEFAULT_CATEGORY = null;
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);
const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
const VALID_SOURCES = new Set(['capture', 'manual', 'inbox', 'system']);

function createReminderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rem-${Date.now()}`;
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeNullableString(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEpochMs(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizePriority(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return VALID_PRIORITIES.has(normalized) ? PRIORITY_LABELS[normalized] : null;
}

function normalizeIsoString(value) {
  const timestamp = normalizeEpochMs(value);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function normalizeSource(value) {
  if (typeof value !== 'string') {
    return DEFAULT_SOURCE;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_SOURCE;
  }
  if (normalized === 'quick-add' || normalized === 'quick_add' || normalized === 'quick capture' || normalized === 'quick_capture') {
    return 'manual';
  }
  return VALID_SOURCES.has(normalized) ? normalized : DEFAULT_SOURCE;
}

function attachLegacyAccessors(reminder) {
  if (!reminder || typeof reminder !== 'object') {
    return reminder;
  }
  const accessors = {
    title: { get: () => reminder.text },
    notes: { get: () => '' },
    due: { get: () => normalizeIsoString(reminder.dueAt) },
    dueDate: { get: () => normalizeIsoString(reminder.dueAt) },
    done: { get: () => reminder.completed },
    status: { get: () => (reminder.completed ? 'done' : 'open') },
    timestamp: { get: () => reminder.createdAt },
  };

  Object.entries(accessors).forEach(([key, descriptor]) => {
    if (Object.prototype.hasOwnProperty.call(reminder, key)) {
      return;
    }
    Object.defineProperty(reminder, key, {
      enumerable: false,
      configurable: true,
      ...descriptor,
    });
  });

  return reminder;
}

export function normalizeReminder(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = Date.now();
  const text = normalizeText(
    source.text
    ?? source.title
    ?? source.note
    ?? source.notes
    ?? source.name
  );
  const title = normalizeText(source.title ?? source.text ?? source.name ?? source.note) || text;
  const notes = normalizeText(source.notes ?? source.bodyText ?? source.body);
  const createdAt = normalizeEpochMs(source.createdAt ?? source.timestamp) ?? now;
  const updatedAt = normalizeEpochMs(source.updatedAt) ?? createdAt;
  const completed = source.completed === true
    || source.done === true
    || source.isDone === true
    || source.status === 'done';
  const dueAt = normalizeEpochMs(source.dueAt ?? source.dueDate ?? source.date ?? source.time ?? source.due);
  const due = normalizeIsoString(source.due ?? source.dueAt ?? source.dueDate ?? source.date ?? source.time);

  const reminder = {
    id: normalizeText(source.id) || createReminderId(),
    text: text || title,
    title,
    notes,
    dueAt,
    due,
    dueDate: due,
    createdAt,
    updatedAt,
    completed,
    done: completed,
    status: completed ? 'done' : 'open',
    category: normalizeNullableString(source.category) ?? DEFAULT_CATEGORY,
    priority: normalizePriority(source.priority) ?? DEFAULT_PRIORITY,
    source: normalizeSource(source.source ?? source.metadata?.source),
    recurrence: normalizeNullableString(source.recurrence),
    snoozedUntil: normalizeIsoString(source.snoozedUntil),
    notifyAt: normalizeIsoString(source.notifyAt) || due,
    notifyMinutesBefore: Number.isFinite(Number(source.notifyMinutesBefore)) ? Number(source.notifyMinutesBefore) : 0,
    userId: normalizeNullableString(source.userId),
    pendingSync: !!source.pendingSync,
    orderIndex: Number.isFinite(Number(source.orderIndex)) ? Number(source.orderIndex) : null,
    plannerLessonId: normalizeNullableString(source.plannerLessonId),
    pinToToday: source.pinToToday === true,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null,
    keywords: Array.isArray(source.keywords) ? source.keywords : [],
    semanticEmbedding: Array.isArray(source.semanticEmbedding) ? source.semanticEmbedding : null,
  };

  return attachLegacyAccessors(reminder);
}

export function normalizeReminderList(list = []) {
  return Array.isArray(list) ? list.map((entry) => normalizeReminder(entry)) : [];
}

export const normalizeReminderRecord = normalizeReminder;

const REMINDER_RECURRENCE_VALUES = new Set(['daily', 'weekly', 'monthly']);
const REMINDER_KEYWORD_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'for', 'from', 'have', 'idea', 'ideas', 'in', 'is', 'it', 'lesson', 'meeting', 'my', 'of', 'on', 'or', 'reminder', 'reminders', 'shopping', 'that', 'the', 'this', 'to', 'with', 'write', 'wrote'
]);

export function normalizeReminderKeywords(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set();
  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }
    const normalized = entry.trim().toLowerCase();
    if (normalized) {
      deduped.add(normalized);
    }
  });
  return Array.from(deduped).slice(0, 12);
}

export function extractReminderKeywords(text) {
  const normalized = typeof text === 'string' ? text.toLowerCase() : '';
  const terms = normalized
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !REMINDER_KEYWORD_STOP_WORDS.has(term));

  if (/\bdrills?\b/.test(normalized)) terms.push('drill');
  if (/\blesson(s|\sideas?)?\b/.test(normalized)) terms.push('lesson');
  if (/\bideas?\b/.test(normalized)) terms.push('idea');
  if (/\bmeetings?\b/.test(normalized)) terms.push('meeting');
  if (/\bshopping\b/.test(normalized)) terms.push('shopping');

  return normalizeReminderKeywords(terms);
}

export function normalizeSemanticEmbedding(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const vector = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  return vector.length ? vector : null;
}

export function normalizeRecurrence(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return REMINDER_RECURRENCE_VALUES.has(normalized) ? normalized : null;
}

export function normalizeIsoString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function normalizeReminderRecord(reminder = {}, options = {}) {
  const source = reminder && typeof reminder === 'object' ? reminder : {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const createId = typeof options.createId === 'function' ? options.createId : () => '';
  const fallbackId = typeof options.fallbackId === 'string' && options.fallbackId ? options.fallbackId : createId();
  const normalizeCategory = typeof options.normalizeCategory === 'function'
    ? options.normalizeCategory
    : (value) => value || 'General';
  const titleCandidates = [source.title, source.text, source.name];
  const title = titleCandidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const dueCandidate = [source.due, source.dueAt, source.dueDate]
    .find((value) => value instanceof Date || (typeof value === 'string' && value.trim()));
  const due = dueCandidate instanceof Date
    ? dueCandidate.toISOString()
    : normalizeIsoString(dueCandidate);
  const notifyCandidate = source.notifyAt instanceof Date
    ? source.notifyAt.toISOString()
    : normalizeIsoString(source.notifyAt);
  const createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : now;
  const updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : createdAt;
  const notes = typeof source.notes === 'string'
    ? source.notes
    : typeof source.bodyText === 'string'
      ? source.bodyText
      : typeof source.body === 'string'
        ? source.body
        : '';

  const normalized = {
    id: typeof source.id === 'string' && source.id ? source.id : fallbackId,
    title,
    notes,
    due,
    priority: source.priority || 'Medium',
    category: normalizeCategory(source.category),
    done: typeof source.done === 'boolean'
      ? source.done
      : Boolean(source.completed || source.isDone || source.status === 'done'),
    createdAt,
    updatedAt,
    keywords: normalizeReminderKeywords(
      source.keywords
      || source?.metadata?.keywords
      || extractReminderKeywords(`${title} ${notes}`),
    ),
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null,
    recurrence: normalizeRecurrence(source.recurrence),
    snoozedUntil: normalizeIsoString(source.snoozedUntil),
    notifyMinutesBefore: Number.isFinite(Number(source.notifyMinutesBefore)) ? Number(source.notifyMinutesBefore) : 0,
    userId: typeof source.userId === 'string' && source.userId ? source.userId : null,
    pendingSync: !!source.pendingSync,
    orderIndex: Number.isFinite(Number(source.orderIndex)) ? Number(source.orderIndex) : null,
    plannerLessonId:
      typeof source.plannerLessonId === 'string' && source.plannerLessonId.trim()
        ? source.plannerLessonId.trim()
        : null,
    pinToToday: source.pinToToday === true,
    semanticEmbedding: normalizeSemanticEmbedding(source.semanticEmbedding),
    notifyAt: notifyCandidate || due,
  };

  normalized.metadata = {
    ...(normalized.metadata || {}),
    text: [normalized.title, normalized.notes].filter(Boolean).join(' ').trim(),
    keywords: normalized.keywords,
    created_at: new Date(normalized.createdAt).toISOString(),
  };

  return normalized;
}

export function normalizeReminderList(list = [], options = {}) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((entry) => normalizeReminderRecord(entry, {
      ...options,
      fallbackId: typeof options.createId === 'function' ? options.createId() : '',
    }))
    .filter(Boolean);
}

export function computeNextOccurrence(reminder) {
  if (!reminder?.due) {
    return null;
  }
  const recurrence = normalizeRecurrence(reminder.recurrence);
  if (!recurrence) {
    return null;
  }
  const date = new Date(reminder.due);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (recurrence === 'daily') date.setDate(date.getDate() + 1);
  if (recurrence === 'weekly') date.setDate(date.getDate() + 7);
  if (recurrence === 'monthly') date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

export function getReminderScheduleIso(reminder) {
  const snoozed = normalizeIsoString(reminder?.snoozedUntil);
  if (snoozed) {
    return snoozed;
  }
  return normalizeIsoString(reminder?.due);
}

export function cosineSimilarity(vecA, vecB) {
  const a = normalizeSemanticEmbedding(vecA);
  const b = normalizeSemanticEmbedding(vecB);
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

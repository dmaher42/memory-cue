export function normalizeReminder(record = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const uid = typeof window !== 'undefined' ? window.__MEMORY_CUE_AUTH_USER_ID || null : null;
  const nowIso = new Date().toISOString();
  const titleCandidates = [source.title, source.text, source.name];
  const title = titleCandidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const dueCandidate = [source.dueAt, source.due, source.dueDate]
    .find((value) => value instanceof Date || (typeof value === 'string' && value.trim()));
  const dueAt = dueCandidate instanceof Date
    ? dueCandidate.toISOString()
    : typeof dueCandidate === 'string' && dueCandidate.trim()
      ? dueCandidate.trim()
      : null;

  return {
    id: typeof source.id === 'string' && source.id ? source.id : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `rem-${Date.now()}`),
    userId: typeof source.userId === 'string' ? source.userId : uid,
    title,
    notes: typeof source.notes === 'string' ? source.notes : '',
    dueAt,
    due: dueAt,
    completed: source.completed === true || source.done === true,
    done: source.done === true || source.completed === true,
    pendingSync: source.pendingSync === true,
    priority: source.priority || 'Medium',
    category: source.category || 'General',
    createdAt: source.createdAt || nowIso,
    updatedAt: source.updatedAt || source.createdAt || nowIso,
    notifyAt: source.notifyAt || null,
    notifyMinutesBefore: Number.isFinite(source.notifyMinutesBefore) ? source.notifyMinutesBefore : 0,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null,
  };
}

export function normalizeReminderList(list = []) {
  return Array.isArray(list) ? list.map((entry) => normalizeReminder(entry)) : [];
}

// Compatibility alias used by reminderController helpers.
export const normalizeReminderRecord = normalizeReminder;

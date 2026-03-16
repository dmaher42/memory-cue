const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';

// Reminder source of truth: this module owns the normalized local reminder cache
// backed by localStorage. Remote sync layers should read/write through this shape.

let reminders = [];


function normalizeReminder(reminder = {}) {
  const source = reminder && typeof reminder === 'object' ? reminder : {};
  const now = Date.now();
  const titleCandidates = [source.title, source.text, source.name];
  const title = titleCandidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const dueCandidate = [source.due, source.dueAt, source.dueDate]
    .find((value) => value instanceof Date || (typeof value === 'string' && value.trim()));
  const due = dueCandidate instanceof Date
    ? dueCandidate.toISOString()
    : typeof dueCandidate === 'string' && dueCandidate.trim()
      ? dueCandidate.trim()
      : null;

  return {
    id: typeof source.id === 'string' && source.id ? source.id : '',
    title,
    notes: typeof source.notes === 'string' ? source.notes : '',
    due,
    priority: source.priority || 'Medium',
    category: source.category || 'General',
    done: source.done === true || source.completed === true || source.isDone === true || source.status === 'done',
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : now,
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : now,
    keywords: Array.isArray(source.keywords)
      ? source.keywords.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim().toLowerCase())
      : [],
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null,
  };
}

console.log('[reminder-store] loaded');

export function getReminders() {
  return reminders;
}

export function setReminders(nextReminders = []) {
  reminders = Array.isArray(nextReminders) ? nextReminders.map((entry) => normalizeReminder(entry)) : [];
  persistLocalReminders(reminders);
  return reminders;
}

export function loadReminders() {
  try {
    const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
    reminders = raw ? JSON.parse(raw).map((entry) => normalizeReminder(entry)) : [];
  } catch (error) {
    console.warn('[reminder-store] failed to load reminders', error);
    reminders = [];
  }
  return reminders;
}

export function persistLocalReminders(nextReminders = reminders) {
  reminders = Array.isArray(nextReminders) ? nextReminders.map((entry) => normalizeReminder(entry)) : [];
  try {
    localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(reminders));
  } catch (error) {
    console.warn('[reminder-store] failed to persist reminders', error);
  }
  return reminders;
}

export function createReminder(reminder) {
  const nextReminder = normalizeReminder(reminder);
  reminders = [...reminders, nextReminder];
  persistLocalReminders(reminders);
  return nextReminder;
}

export function updateReminder(id, updates = {}) {
  let updatedReminder = null;
  reminders = reminders.map((item) => {
    if (!item || item.id !== id) {
      return item;
    }
    updatedReminder = normalizeReminder({ ...item, ...updates });
    return updatedReminder;
  });
  persistLocalReminders(reminders);
  return updatedReminder;
}

export function deleteReminder(id) {
  const beforeCount = reminders.length;
  reminders = reminders.filter((item) => item?.id !== id);
  persistLocalReminders(reminders);
  return reminders.length !== beforeCount;
}

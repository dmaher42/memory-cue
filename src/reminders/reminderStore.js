const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';

let reminders = [];

console.log('[reminder-store] loaded');

export function getReminders() {
  return reminders;
}

export function setReminders(nextReminders = []) {
  reminders = Array.isArray(nextReminders) ? nextReminders : [];
  persistLocalReminders(reminders);
  return reminders;
}

export function loadReminders() {
  try {
    const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
    reminders = raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn('[reminder-store] failed to load reminders', error);
    reminders = [];
  }
  return reminders;
}

export function persistLocalReminders(nextReminders = reminders) {
  reminders = Array.isArray(nextReminders) ? nextReminders : [];
  try {
    localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(reminders));
  } catch (error) {
    console.warn('[reminder-store] failed to persist reminders', error);
  }
  return reminders;
}

export function createReminder(reminder) {
  const nextReminder = reminder && typeof reminder === 'object' ? reminder : {};
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
    updatedReminder = { ...item, ...updates };
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

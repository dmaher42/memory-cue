import { normalizeReminder, normalizeReminderList } from './reminderNormalizer.js';

const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';

const reminderState = {
  reminders: [],
};


export function getReminders() {
  return reminderState.reminders;
}

export function setReminders(list = []) {
  reminderState.reminders = normalizeReminderList(list);
  persistLocalReminders(reminderState.reminders);
  return reminderState.reminders;
}

export function loadReminders() {
  try {
    const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    reminderState.reminders = normalizeReminderList(parsed);
  } catch (error) {
    console.warn('[reminder-store] failed to load reminders', error);
    reminderState.reminders = [];
  }
  return reminderState.reminders;
}

export function persistLocalReminders(nextReminders = reminderState.reminders) {
  reminderState.reminders = normalizeReminderList(nextReminders);
  try {
    localStorage.setItem(OFFLINE_REMINDERS_KEY, JSON.stringify(reminderState.reminders));
  } catch (error) {
    console.warn('[reminder-store] failed to persist reminders', error);
  }
  return reminderState.reminders;
}

export function createReminder(reminder) {
  const nextReminder = normalizeReminder(reminder);
  reminderState.reminders = [...reminderState.reminders, nextReminder];
  persistLocalReminders(reminderState.reminders);
  return nextReminder;
}

export function updateReminder(id, updates = {}) {
  let updatedReminder = null;
  reminderState.reminders = reminderState.reminders.map((item) => {
    if (!item || item.id !== id) {
      return item;
    }
    updatedReminder = normalizeReminder({ ...item, ...updates });
    return updatedReminder;
  });
  persistLocalReminders(reminderState.reminders);
  return updatedReminder;
}

export function deleteReminder(id) {
  const beforeCount = reminderState.reminders.length;
  reminderState.reminders = reminderState.reminders.filter((item) => item?.id !== id);
  persistLocalReminders(reminderState.reminders);
  return reminderState.reminders.length !== beforeCount;
}

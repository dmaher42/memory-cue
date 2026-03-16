let reminderSchedulerId = null;
let notificationPermissionRequested = false;

export async function requestNotificationPermission() {
  if (notificationPermissionRequested) {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }
  notificationPermissionRequested = true;

  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export function sendReminderNotification(reminder) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  new Notification('Memory Cue Reminder', {
    body: reminder.title || reminder.text,
    icon: '/icons/icon-192.png',
  });

  reminder._notified = true;
  console.log('[reminder-engine] notification fired', { id: reminder.id });
}

export function startReminderScheduler(getReminders) {
  if (typeof getReminders !== 'function' || reminderSchedulerId) {
    return;
  }

  reminderSchedulerId = setInterval(() => {
    const reminders = getReminders();
    const now = Date.now();

    reminders.forEach((reminder) => {
      if (!reminder || reminder._notified) return;

      const dueAtValue = reminder.dueAt || reminder.due;
      if (!dueAtValue) return;

      const due = new Date(dueAtValue).getTime();
      if (!Number.isFinite(due)) return;

      if (Math.abs(due - now) < 60000) {
        sendReminderNotification(reminder);
      }
    });
  }, 60000);

  console.log('[reminder-engine] scheduler started');
}

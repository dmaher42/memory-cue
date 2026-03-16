let notificationHandlers = {
  startReminderScheduler: null,
  sendReminderNotification: null,
  requestNotificationPermission: null,
};

export function setupNotificationHandlers(handlers = {}) {
  notificationHandlers = { ...notificationHandlers, ...handlers };
}

export function startReminderScheduler(...args) {
  if (typeof notificationHandlers.startReminderScheduler !== 'function') {
    return null;
  }
  return notificationHandlers.startReminderScheduler(...args);
}

export function sendReminderNotification(...args) {
  if (typeof notificationHandlers.sendReminderNotification !== 'function') {
    return null;
  }
  return notificationHandlers.sendReminderNotification(...args);
}

export async function requestNotificationPermission(...args) {
  if (typeof notificationHandlers.requestNotificationPermission !== 'function') {
    return null;
  }
  return notificationHandlers.requestNotificationPermission(...args);
}

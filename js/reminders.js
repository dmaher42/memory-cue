let reminderControllerModulePromise = null;
let activeReminderControllerApi = null;

function loadReminderControllerModule() {
  if (!reminderControllerModulePromise) {
    reminderControllerModulePromise = import('../src/reminders/reminderController.js');
  }
  return reminderControllerModulePromise;
}

export async function initReminders(sel = {}) {
  const controller = await loadReminderControllerModule();

  if (typeof globalThis !== 'undefined') {
    globalThis.createReminderFromPayload = (...args) => controller.createReminderFromPayload(...args);
    globalThis.getReminders = (...args) => controller.getReminders(...args);
    globalThis.setReminderCompleted = (...args) => controller.setReminderCompleted(...args);
    globalThis.render = (...args) => controller.render(...args);
    globalThis.setupReminderFirestoreSync = (...args) => controller.setupReminderFirestoreSync(...args);
    // Backward-compatible alias for legacy callers.
    globalThis.setupFirebaseSync = (...args) => controller.setupReminderFirestoreSync(...args);
    globalThis.initReminders = (...args) => controller.initReminders(...args);
  }

  activeReminderControllerApi = await controller.initReminders(sel);
  return activeReminderControllerApi;
}

export function getReminders() {
  return activeReminderControllerApi?.getReminders?.() || [];
}

export function setReminderCompleted(id, completed = true) {
  return activeReminderControllerApi?.setReminderCompleted?.(id, completed) || null;
}

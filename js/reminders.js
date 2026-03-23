let reminderControllerModulePromise = null;

function loadReminderControllerModule() {
  if (!reminderControllerModulePromise) {
    reminderControllerModulePromise = import('../src/reminders/reminderController.js?v=20260323a');
  }
  return reminderControllerModulePromise;
}

export async function initReminders(sel = {}) {
  const controller = await loadReminderControllerModule();

  if (typeof globalThis !== 'undefined') {
    globalThis.createReminderFromPayload = (...args) => controller.createReminderFromPayload(...args);
    globalThis.render = (...args) => controller.render(...args);
    globalThis.setupReminderFirestoreSync = (...args) => controller.setupReminderFirestoreSync(...args);
    // Backward-compatible alias for legacy callers.
    globalThis.setupFirebaseSync = (...args) => controller.setupReminderFirestoreSync(...args);
    globalThis.initReminders = (...args) => controller.initReminders(...args);
  }

  return controller.initReminders(sel);
}

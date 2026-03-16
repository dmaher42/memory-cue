let reminderControllerModulePromise = null;

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
    globalThis.render = (...args) => controller.render(...args);
    globalThis.setupSupabaseSync = (...args) => controller.setupSupabaseSync(...args);
    globalThis.initReminders = (...args) => controller.initReminders(...args);
  }

  return controller.initReminders(sel);
}

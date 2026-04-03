import { initQuickCapture } from '../src/ui/quickCapture.js';
import { initReminderUI, renderReminders as renderRemindersView } from '../src/ui/reminderUI.js';
import { initChatUI } from '../src/ui/chatUI.js';
import { onDomReady } from '../src/ui/uiEvents.js';

export function initEntriesApp() {
  initQuickCapture();
  initReminderUI();
  initChatUI();
}

// Compatibility wrappers for older imports while modules are migrated.
export function renderReminders(...args) {
  return renderRemindersView(...args);
}

export function renderInboxEntries(...args) {
  return args[0];
}

onDomReady(initEntriesApp);

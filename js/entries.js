import { initQuickCapture } from '../src/ui/quickCapture.js?v=20260323a';
import { initReminderUI, renderReminders as renderRemindersView } from '../src/ui/reminderUI.js?v=20260323a';
import { initInboxUI, renderInbox } from '../src/ui/inboxUI.js?v=20260323a';
import { initChatUI } from '../src/ui/chatUI.js?v=20260323a';
import { onDomReady } from '../src/ui/uiEvents.js?v=20260323a';

export function initEntriesApp() {
  initQuickCapture();
  initReminderUI();
  initInboxUI();
  initChatUI();
}

// Compatibility wrappers for older imports while modules are migrated.
export function renderReminders(...args) {
  return renderRemindersView(...args);
}

export function renderInboxEntries(...args) {
  return renderInbox(...args);
}

onDomReady(initEntriesApp);

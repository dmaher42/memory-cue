import { addDelegatedEvent } from './uiEvents.js';

export const dispatchReminderSheetOpen = (trigger, prefillText = '') => {
  const detail = {
    mode: 'create',
    trigger: trigger instanceof HTMLElement ? trigger : null,
    prefillText,
  };

  try {
    document.dispatchEvent(new CustomEvent('open-reminder-sheet', { detail }));
    document.dispatchEvent(new CustomEvent('cue:prepare', { detail }));
    document.dispatchEvent(new CustomEvent('cue:open', { detail }));
  } catch (error) {
    console.warn('Failed to open reminder sheet', error);
  }

  const focusEditor = () => {
    const reminderText = document.getElementById('reminderText');
    if (!(reminderText instanceof HTMLElement)) return;
    try {
      reminderText.focus({ preventScroll: true });
    } catch {
      reminderText.focus();
    }
    if (prefillText && reminderText instanceof HTMLInputElement) {
      reminderText.value = prefillText;
      reminderText.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  document.addEventListener('reminder:sheet-opened', focusEditor, { once: true });
};

export function initQuickCapture() {
  addDelegatedEvent('click', '[data-trigger="open-cue"]', (event, trigger) => {
    event.preventDefault();
    dispatchReminderSheetOpen(trigger);
  });
}

import { captureInput } from '../core/capturePipeline.js?v=20260323a';
import { addDelegatedEvent } from './uiEvents.js?v=20260323a';

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
  const quickForm = document.getElementById('quickAddForm');
  const quickInput = document.getElementById('reminderQuickAdd');
  const voiceButton = document.getElementById('startVoiceCaptureGlobal');

  const startVoiceCapture = () => {
    if (!(quickInput instanceof HTMLInputElement)) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognition !== 'function') {
      window.alert('Voice capture not supported on this device.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript;
      if (typeof transcript !== 'string') return;
      quickInput.value = transcript.trim();
      quickInput.dispatchEvent(new Event('input', { bubbles: true }));
      try { quickInput.focus({ preventScroll: true }); } catch { quickInput.focus(); }
    };
    recognition.onerror = (event) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        window.alert('Voice capture not supported on this device.');
      }
    };
    recognition.start();
  };

  addDelegatedEvent('click', '[data-trigger="open-cue"]', (event, trigger) => {
    event.preventDefault();
    dispatchReminderSheetOpen(trigger);
  });

  if (voiceButton instanceof HTMLElement) {
    voiceButton.addEventListener('click', startVoiceCapture);
  }

  if (!(quickForm instanceof HTMLFormElement) || !(quickInput instanceof HTMLInputElement)) return;
  if (typeof window.memoryCueQuickAddNow === 'function') return;

  quickForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = (quickInput.value || '').trim();
    if (!text) return;

    console.log('[ui]', 'quick capture triggered');
    try {
      await captureInput({ text, source: 'quick_capture' });
      quickInput.value = '';
      quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      console.error('Quick capture failed', error);
    }
  });
}

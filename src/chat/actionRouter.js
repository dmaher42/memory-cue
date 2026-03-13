import { captureInput } from '../../js/services/capture-service.js';

const parseAssistantReply = (payload) => {
  if (typeof payload?.reply === 'string' && payload.reply.trim()) {
    return payload.reply;
  }
  if (typeof payload?.response === 'string' && payload.response.trim()) {
    return payload.response;
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return 'Assistant response unavailable.';
};

const resolveReminderHandler = (dependencies = {}) => {
  if (typeof dependencies.createReminder === 'function') {
    return dependencies.createReminder;
  }

  if (typeof window !== 'undefined' && typeof window.memoryCueCreateReminder === 'function') {
    return window.memoryCueCreateReminder;
  }

  return null;
};

const QUICK_ACTIONS_BY_INTENT = {
  capture: [{ label: 'Open Inbox', targetView: 'capture' }],
  reminder: [{ label: 'Edit Reminder', targetView: 'reminders' }],
  assistant: [{ label: 'View Notes', targetView: 'notes' }],
};

const createActionResult = (intent, message) => ({
  message,
  quickActions: QUICK_ACTIONS_BY_INTENT[intent] || [],
});

const routeCapture = async (text) => {
  await captureInput(text, 'capture');
  return createActionResult('capture', 'Saved to Inbox.');
};

const routeReminder = async (text, dependencies = {}) => {
  const createReminder = resolveReminderHandler(dependencies);
  if (typeof createReminder !== 'function') {
    throw new Error('Reminder creation logic is unavailable.');
  }

  await createReminder({ title: text });
  return createActionResult('reminder', 'Reminder created.');
};

const routeAssistant = async (text) => {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });

  if (!response.ok) {
    throw new Error(`Assistant request failed (${response.status})`);
  }

  const payload = await response.json();
  return createActionResult('assistant', parseAssistantReply(payload));
};

export const routeAction = async (intent, text, dependencies = {}) => {
  if (intent === 'reminder') {
    return routeReminder(text, dependencies);
  }

  if (intent === 'assistant') {
    return routeAssistant(text);
  }

  return routeCapture(text);
};

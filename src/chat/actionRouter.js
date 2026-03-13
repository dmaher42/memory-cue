import { executeCommand } from '../core/commandEngine.js';

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
  const result = await executeCommand('capture', { text, source: 'capture' });
  return createActionResult('capture', result.message);
};

const routeReminder = async (text, dependencies = {}) => {
  const result = await executeCommand('reminder', {
    text,
    handler: dependencies.createReminder,
  });
  return createActionResult('reminder', result.message);
};

const routeAssistant = async (text) => {
  const result = await executeCommand('assistantQuery', { question: text });
  return createActionResult('assistant', result.message);
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

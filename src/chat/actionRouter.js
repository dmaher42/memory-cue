import { processInbox } from '../ai/inboxProcessor.js';
import { executeCommand } from '../core/commandEngine.js';
import { getInboxEntries, removeInboxEntry } from '../services/inboxService.js';
import { formatMemorySearchResponse, searchNotesMemory } from '../services/memorySearch.js';

const QUICK_ACTIONS_BY_INTENT = {
  capture: [{ label: 'View Capture', targetView: 'capture' }],
  reminder: [{ label: 'Edit Reminder', targetView: 'reminders' }],
  assistant: [{ label: 'View Notes', targetView: 'notebooks' }],
  processInbox: [{ label: 'View Notes', targetView: 'notebooks' }],
  memorySearch: [{ label: 'View Notes', targetView: 'notebooks' }],
};

const createActionResult = (intent, message, status) => ({
  message,
  quickActions: QUICK_ACTIONS_BY_INTENT[intent] || [],
  status,
});

const routeCapture = async (text) => {
  const result = await executeCommand('capture', { text, source: 'capture' });
  return createActionResult('capture', result.message, result);
};

const routeReminder = async (text, dependencies = {}) => {
  const result = await executeCommand('reminder', {
    text,
    handler: dependencies.createReminder,
  });
  return createActionResult('reminder', result.message, result);
};

const routeAssistant = async (text) => {
  const result = await executeCommand('assistantQuery', { question: text });
  return createActionResult('assistant', result.message, result);
};

const routeMemorySearch = async (text) => {
  const result = await executeCommand('search', {
    query: text,
    handler: ({ query }) => searchNotesMemory(query),
  });

  return createActionResult(
    'memorySearch',
    formatMemorySearchResponse(result.data),
    { ...result, message: formatMemorySearchResponse(result.data) },
  );
};

const routeProcessInbox = async (dependencies = {}) => {
  const result = await executeCommand('processInbox', {
    handler: async () => {
      const inboxEntries = getInboxEntries().filter((entry) => entry?.processed === false);
      if (!inboxEntries.length) {
        return {
          processedCount: 0,
          processedItems: [],
          counts: { note: 0, reminder: 0, idea: 0, training: 0, personal: 0 },
          summary: 'Processed 0 notes.',
        };
      }

      return processInbox(inboxEntries, {
        createReminder: dependencies.createReminder,
        removeInboxEntry,
      });
    },
  });

  const summary = typeof result?.data?.summary === 'string' && result.data.summary.trim()
    ? result.data.summary
    : result.message;

  return createActionResult('processInbox', summary, { ...result, message: summary });
};

export const routeAction = async (intent, text, dependencies = {}) => {
  switch (intent) {
    case 'processInbox':
      return routeProcessInbox(dependencies);
    case 'reminder':
      return routeReminder(text, dependencies);
    case 'assistant':
      return routeAssistant(text);
    case 'memorySearch':
      return routeMemorySearch(text);
    case 'capture':
    default:
      return routeCapture(text);
  }
};

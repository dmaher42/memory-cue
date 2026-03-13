import { addMessage } from './messageStore.js';
import { executeCommand } from '../core/commandEngine.js';
import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { captureInput } from '../../js/services/capture-service.js';

export const ENABLE_CHAT_INTERFACE = true;

const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const createMessage = (role, content, quickActions = []) => ({
  id: generateMessageId(),
  role,
  content,
  quickActions,
  timestamp: Date.now(),
});

const normalizeRouteResult = (result) => {
  if (typeof result === 'string') {
    return { message: result, quickActions: [], status: null };
  }

  return {
    message: typeof result?.message === 'string' ? result.message : '',
    quickActions: Array.isArray(result?.quickActions) ? result.quickActions : [],
    status: result?.status && typeof result.status === 'object' ? result.status : null,
  };
};

const parseEntry = async (text) => {
  const response = await fetch('/api/parse-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to parse entry (${response.status})`);
  }

  return response.json();
};

const normalizeType = (parsedType, text) => {
  const normalizedType = typeof parsedType === 'string' ? parsedType.trim().toLowerCase() : '';
  if (normalizedType) {
    return normalizedType;
  }

  return text.endsWith('?') ? 'question' : 'unknown';
};

const askAssistant = async (text) => {
  const response = await fetch('/api/assistant-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });

  if (!response.ok) {
    throw new Error(`Assistant request failed (${response.status})`);
  }

  const payload = await response.json();
  return typeof payload?.reply === 'string' && payload.reply.trim()
    ? payload.reply.trim()
    : 'Here is what I found.';
};

const createNotebookNote = (parsed, text) => {
  const title = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  const note = createNote(title, text, {
    bodyText: text,
    metadata: {
      type: 'note',
      tags: Array.isArray(parsed?.tags) ? parsed.tags : [],
    },
  });

  const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  saveAllNotes([note, ...notes]);
  return note;
};

const processParsedEntry = async (parsed, text, dependencies = {}) => {
  const parsedType = normalizeType(parsed?.type, text);

  if (parsedType === 'reminder') {
    console.log('Capture routed to:', 'reminder');
    await executeCommand('reminder', {
      text: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text,
      handler: dependencies.createReminder,
    });
    return { message: 'Reminder created.' };
  }

  if (parsedType === 'note' || parsedType === 'drill' || parsedType === 'idea' || parsedType === 'task') {
    console.log('Capture routed to:', 'note');
    createNotebookNote(parsed, text);
    return { message: 'Saved as a notebook note.' };
  }

  if (parsedType === 'question' || text.endsWith('?')) {
    return { message: await askAssistant(text) };
  }

  console.log('Capture routed to:', 'inbox');
  await captureInput(text, 'assistant');
  return { message: "I wasn't sure where this belongs, so I saved it to your Inbox." };
};

export const handleChatMessage = async (text, dependencies = {}) => {
  const userText = typeof text === 'string' ? text.trim() : '';
  if (!userText) {
    return { message: '', quickActions: [], status: null };
  }

  addMessage(createMessage('user', userText));

  const parsed = await parseEntry(userText);
  const routeResult = await processParsedEntry(parsed, userText, dependencies);
  const response = normalizeRouteResult(routeResult);

  addMessage(createMessage('assistant', response.message, response.quickActions));
  return response;
};

export const handleMessage = handleChatMessage;

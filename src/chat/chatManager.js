import { addMessage } from './messageStore.js';
import { executeCommand } from '../core/commandEngine.js';
import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { saveToInbox } from '../services/inboxService.js';
import { suggestNotebookAndTags } from '../services/taggingEngine.js';
import { ensureFolderExistsByName } from '../../js/modules/ai-capture-save.js';

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

const getReminderScheduleLabel = (parsed, text) => {
  const metadata = parsed && typeof parsed === 'object' ? parsed.metadata || parsed : {};
  const dueValue =
    (typeof metadata?.due === 'string' && metadata.due.trim())
    || (typeof metadata?.dueAt === 'string' && metadata.dueAt.trim())
    || (typeof parsed?.due === 'string' && parsed.due.trim())
    || (typeof parsed?.date === 'string' && parsed.date.trim())
    || null;

  if (dueValue) {
    return dueValue;
  }

  const normalizedText = typeof text === 'string' ? text.toLowerCase() : '';
  if (normalizedText.includes('tomorrow')) {
    return 'tomorrow';
  }
  if (normalizedText.includes('today')) {
    return 'today';
  }

  return null;
};

const createNotebookNote = async (parsed, text) => {
  const title = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  const notebookSuggestion = await suggestNotebookAndTags(text);
  const folderName = notebookSuggestion?.notebook && notebookSuggestion.notebook !== 'Inbox'
    ? notebookSuggestion.notebook
    : null;
  const folderId = folderName ? ensureFolderExistsByName(folderName) : null;

  const note = createNote(title, text, {
    bodyText: text,
    folderId,
    metadata: {
      type: 'note',
      tags: Array.isArray(notebookSuggestion?.tags)
        ? notebookSuggestion.tags
        : Array.isArray(parsed?.tags)
          ? parsed.tags
          : [],
    },
  });

  const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  saveAllNotes([note, ...notes]);
  return { note, notebookName: folderName || 'Unsorted' };
};

const looksLikeNotebookCapture = (text) => {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (!normalized) {
    return false;
  }
  if (normalized.includes('?')) {
    return false;
  }
  return /(meeting notes|lesson idea|remember\b|notes?\s+from|journal|plan\b|scored\b)/i.test(normalized);
};

const processParsedEntry = async (parsed, text, dependencies = {}) => {
  const parsedType = normalizeType(parsed?.type, text);

  if (parsedType === 'reminder') {
    console.log('Capture routed to:', 'reminder');
    await executeCommand('reminder', {
      text: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text,
      handler: dependencies.createReminder,
    });
    const scheduleLabel = getReminderScheduleLabel(parsed, text);
    const title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text;
    const message = scheduleLabel
      ? `Reminder created for ${scheduleLabel}: ${title}`
      : `Reminder created: ${title}`;
    return { message };
  }

  if (
    parsedType === 'note'
    || parsedType === 'drill'
    || parsedType === 'idea'
    || parsedType === 'task'
    || looksLikeNotebookCapture(text)
  ) {
    const { notebookName } = await createNotebookNote(parsed, text);
    return { message: `Saved to notebook (${notebookName}).` };
  }

  if (parsedType === 'question' || text.endsWith('?')) {
    return { message: await askAssistant(text) };
  }

  saveToInbox(text);
  return { message: 'Added to inbox for later review.' };
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

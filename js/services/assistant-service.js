import { loadAllNotes } from '../modules/notes-storage.js';
import { getInboxEntries } from './capture-service.js';
import { addMessage, clearMessages, getMessages } from '../../src/chat/messageStore.js';

const toTimestamp = (value) => {
  const parsed = Date.parse(typeof value === 'string' ? value : '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

const readReminders = () => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('scheduledReminders');
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.values(parsed || {}).filter((entry) => entry && typeof entry === 'object');
  } catch {
    return [];
  }
};

const readConversation = () => getMessages();

const createStoredMessage = (role, content) => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  role,
  content,
  timestamp: Date.now(),
});

const appendMessage = (container, text, className) => {
  const message = document.createElement('div');
  message.className = className;
  message.textContent = text;
  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
  return message;
};

const renderStoredConversation = (container) => {
  const history = readConversation();
  history.forEach((entry) => {
    const role = entry?.role === 'assistant' ? 'assistant' : 'user';
    const className = role === 'assistant'
      ? 'assistant-message assistant-message--reply'
      : 'assistant-message';
    appendMessage(container, typeof entry?.content === 'string' ? entry.content : '', className);
  });
  container.scrollTop = container.scrollHeight;
};

const appendReferences = (container, references) => {
  if (!Array.isArray(references) || !references.length) {
    return;
  }

  const list = document.createElement('ul');
  list.className = 'assistant-reference-list';

  references.forEach((reference) => {
    const item = document.createElement('li');
    const type = typeof reference?.type === 'string' ? reference.type : 'entry';
    const title = typeof reference?.title === 'string' ? reference.title : 'Untitled';
    item.textContent = `${type}: ${title}`;
    list.appendChild(item);
  });

  container.appendChild(list);
};

const buildPayload = (message, history) => {
  const notes = (Array.isArray(loadAllNotes()) ? loadAllNotes() : [])
    .sort((a, b) => toTimestamp(b?.updatedAt || b?.createdAt) - toTimestamp(a?.updatedAt || a?.createdAt))
    .slice(0, 20)
    .map((note) => ({
      id: note?.id,
      title: note?.title,
      body: note?.bodyText || note?.body || '',
      createdAt: note?.createdAt,
      updatedAt: note?.updatedAt,
    }));

  const reminders = readReminders().slice(0, 20).map((reminder) => ({
    id: reminder?.id,
    title: reminder?.title,
    body: reminder?.notes || reminder?.body || '',
    due: reminder?.due,
    createdAt: reminder?.createdAt,
  }));

  const inboxEntries = getInboxEntries().slice(0, 20).map((entry) => ({
    id: entry?.id,
    text: entry?.text,
    createdAt: entry?.createdAt,
    source: entry?.source,
  }));

  return {
    message,
    history,
    notes,
    reminders,
    inboxEntries,
  };
};

const sendAssistantRequest = async (payload) => {
  const response = await fetch('/api/assistant-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Assistant request failed (${response.status})`);
  }

  const data = await response.json();
  return {
    reply: typeof data?.reply === 'string' ? data.reply : 'I could not read the assistant response.',
    references: Array.isArray(data?.references) ? data.references : [],
  };
};

const askAssistant = async ({ message, assistantMessages, assistantLoading }) => {
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  if (!trimmedMessage) {
    return null;
  }

  if (assistantMessages instanceof HTMLElement) {
    appendMessage(assistantMessages, trimmedMessage, 'assistant-message');
  }
  addMessage(createStoredMessage('user', trimmedMessage));

  if (assistantLoading instanceof HTMLElement) {
    assistantLoading.classList.remove('hidden');
  }

  const history = readConversation();

  try {
    const payload = buildPayload(trimmedMessage, history);
    const result = await sendAssistantRequest(payload);
    if (assistantMessages instanceof HTMLElement) {
      const replyNode = appendMessage(assistantMessages, result.reply, 'assistant-message assistant-message--reply');
      appendReferences(replyNode, result.references);
    }
    addMessage(createStoredMessage('assistant', result.reply));
    return result;
  } catch (error) {
    console.error('[assistant-service] Assistant unavailable', error);
    if (assistantMessages instanceof HTMLElement) {
      appendMessage(assistantMessages, 'Assistant is unavailable.', 'assistant-message assistant-message--error');
    }
    return { reply: 'Assistant is unavailable.', references: [] };
  } finally {
    if (assistantLoading instanceof HTMLElement) {
      assistantLoading.classList.add('hidden');
    }
  }
};

(function initAssistantService() {
  const assistantForm = document.getElementById('assistantForm');
  const assistantInput = document.getElementById('assistantInput');
  const assistantMessages = document.getElementById('assistantMessages') || document.getElementById('assistantThread');
  const assistantLoading = document.getElementById('assistantLoading');

  if (!(assistantForm instanceof HTMLFormElement) || !(assistantInput instanceof HTMLElement) || !(assistantMessages instanceof HTMLElement)) {
    if (typeof window !== 'undefined') {
      window.memoryCueAskAssistant = async (message) => askAssistant({ message, assistantMessages, assistantLoading });
    }
    return;
  }

  renderStoredConversation(assistantMessages);

  const clearChatHistoryBtn = document.getElementById('clearChatHistoryBtn');
  clearChatHistoryBtn?.addEventListener('click', () => {
    clearMessages();
    assistantMessages.innerHTML = '';
  });

  if (typeof window !== 'undefined') {
    window.memoryCueAskAssistant = async (message) => askAssistant({ message, assistantMessages, assistantLoading });
  }

  assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = typeof assistantInput.value === 'string' ? assistantInput.value.trim() : '';
    if (!message) return;
    assistantInput.value = '';
    await askAssistant({ message, assistantMessages, assistantLoading });
  });
})();

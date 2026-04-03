import { loadAllNotes } from '../modules/notes-storage.js';
import { captureInput, getInboxEntries } from './capture-service.js';
import { addMessage, clearMessages, getMessages } from '../../src/chat/messageStore.js';

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

const hasStoredItems = () => {
  const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  const reminders = readReminders();
  const inboxEntries = getInboxEntries();
  return notes.length > 0 || reminders.length > 0 || inboxEntries.length > 0;
};

const buildWelcomeMessage = () => [
  'Welcome to Memory Cue.',
  '',
  'Try typing something like:',
  '',
  'remind me to get milk tomorrow',
  'lesson idea for year 7 volleyball',
  'remember Archer scored 3 goals today',
].join('\n');

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

const formatReminderItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) {
    return 'I could not find any matching reminders.';
  }

  return [
    'Here are the matching reminders:',
    '',
    ...items.slice(0, 10).map((item) => `• ${item?.title || item?.text || item?.notes || 'Untitled reminder'}`),
  ].join('\n');
};

const formatMemoryItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) {
    return 'I could not find any matching memories.';
  }

  return [
    'Here is what I found:',
    '',
    ...items.slice(0, 10).map((item) => `• ${item?.title || item?.text || 'Untitled memory'}`),
  ].join('\n');
};

const formatQueryResponse = (data) => {
  if (!data || typeof data !== 'object') {
    return '';
  }

  if (data.type === 'reminder_results') {
    return formatReminderItems(data.items);
  }

  if (data.type === 'memory_results') {
    return formatMemoryItems(data.items);
  }

  if (data.type === 'mixed_results') {
    const memories = formatMemoryItems(data.memories);
    const reminders = formatReminderItems(data.reminders);
    return [memories, '', reminders].join('\n');
  }

  return '';
};

const shouldUseAssistantApi = (result) => result?.decision?.decisionType === 'assistant_query';

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

  try {
    const routed = await captureInput({
      text: trimmedMessage,
      source: 'assistant_service',
      metadata: {
        entryPoint: 'assistant-service.askAssistant',
      },
    });

    let reply = typeof routed?.message === 'string' ? routed.message.trim() : '';
    let references = [];

    if (!reply) {
      reply = formatQueryResponse(routed?.data);
    }

    if (!reply && shouldUseAssistantApi(routed)) {
      reply = typeof routed?.data?.reply === 'string' ? routed.data.reply : '';
      references = Array.isArray(routed?.data?.references) ? routed.data.references : [];
    }

    if (!reply) {
      reply = 'Saved for later review.';
    }

    if (assistantMessages instanceof HTMLElement) {
      const replyNode = appendMessage(assistantMessages, reply, 'assistant-message assistant-message--reply');
      appendReferences(replyNode, references);
    }
    addMessage(createStoredMessage('assistant', reply));
    return { reply, references, routed };
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

  const assistantHelpBtn = document.getElementById('assistantHelpBtn');
  assistantHelpBtn?.addEventListener('click', async () => {
    await askAssistant({ message: 'help', assistantMessages, assistantLoading });
  });

  if (!readConversation().length && !hasStoredItems()) {
    const welcomeMessage = buildWelcomeMessage();
    appendMessage(assistantMessages, welcomeMessage, 'assistant-message assistant-message--reply');
    addMessage(createStoredMessage('assistant', welcomeMessage));
  }

  assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = typeof assistantInput.value === 'string' ? assistantInput.value.trim() : '';
    if (!message) return;
    assistantInput.value = '';
    await askAssistant({ message, assistantMessages, assistantLoading });
  });
})();

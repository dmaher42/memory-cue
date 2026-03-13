import { addMessage } from './messageStore.js';
import { parseIntent } from './intentParser.js';
import { routeAction } from './actionRouter.js';

export const ENABLE_CHAT_INTERFACE = true;

const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const createMessage = (role, content) => ({
  id: generateMessageId(),
  role,
  content,
  timestamp: Date.now(),
});

export const handleChatMessage = async (text, dependencies = {}) => {
  const userText = typeof text === 'string' ? text.trim() : '';
  if (!userText) {
    return '';
  }

  addMessage(createMessage('user', userText));

  const intent = parseIntent(userText);
  const response = await routeAction(intent, userText, dependencies);

  addMessage(createMessage('assistant', response));
  return response;
};

export const handleMessage = handleChatMessage;

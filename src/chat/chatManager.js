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

export const handleChatMessage = async (text, dependencies = {}) => {
  const userText = typeof text === 'string' ? text.trim() : '';
  if (!userText) {
    return { message: '', quickActions: [], status: null };
  }

  addMessage(createMessage('user', userText));

  const intent = parseIntent(userText);
  const routeResult = await routeAction(intent, userText, dependencies);
  const response = normalizeRouteResult(routeResult);

  addMessage(createMessage('assistant', response.message, response.quickActions));
  return response;
};

export const handleMessage = handleChatMessage;

import { appendChatMessage, clearRemoteChatHistory } from '../services/firestoreSyncService.js';
const CHAT_HISTORY_STORAGE_KEY = 'memoryCueChatHistory';

const dispatchChatUpdated = (messages = []) => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memoryCue:chatUpdated', {
    detail: {
      key: CHAT_HISTORY_STORAGE_KEY,
      items: Array.isArray(messages) ? messages : [],
    },
  }));
};

const readMessages = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[chat/messageStore] Failed to read chat history', error);
    return [];
  }
};

const writeMessages = (messages) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages));
  } catch (error) {
    console.warn('[chat/messageStore] Failed to persist chat history', error);
  }
};

export const addMessage = (message) => {
  const messages = readMessages();
  const nextMessage = { ...message, pendingSync: true };
  const nextMessages = [...messages, nextMessage];
  writeMessages(nextMessages);
  dispatchChatUpdated(nextMessages);
  appendChatMessage(nextMessage, message?.conversationId || 'default').catch((error) => {
    console.warn('[chat/messageStore] Failed to sync chat message', error);
  });
  return nextMessage;
};

export const getMessages = () => readMessages();

export const replaceMessages = (messages = []) => {
  const nextMessages = Array.isArray(messages)
    ? messages.filter((message) => message && typeof message === 'object')
    : [];
  writeMessages(nextMessages);
  dispatchChatUpdated(nextMessages);
  return nextMessages;
};

export const clearMessages = () => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    dispatchChatUpdated([]);
    clearRemoteChatHistory().catch(() => {});
  } catch (error) {
    console.warn('[chat/messageStore] Failed to clear chat history', error);
  }
};

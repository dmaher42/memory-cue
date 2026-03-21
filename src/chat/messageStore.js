import { appendChatMessage, syncChatHistory } from '../services/firestoreSyncService.js';
const CHAT_HISTORY_STORAGE_KEY = 'memoryCueChatHistory';

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
  appendChatMessage(nextMessage, message?.conversationId || 'default').catch((error) => {
    console.warn('[chat/messageStore] Failed to sync chat message', error);
  });
  return nextMessage;
};

export const getMessages = () => readMessages();

export const clearMessages = () => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    syncChatHistory([]).catch(() => {});
  } catch (error) {
    console.warn('[chat/messageStore] Failed to clear chat history', error);
  }
};

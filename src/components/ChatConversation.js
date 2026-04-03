import { handleMessage } from '../chat/chatManager.js';
import { getMessages } from '../chat/messageStore.js';
import { createReminder } from '../services/reminderService.js';

const bubbleStyles = {
  user: {
    alignSelf: 'flex-end',
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
  },
  assistant: {
    alignSelf: 'flex-start',
    background: 'var(--card)',
    color: 'var(--fg)',
    border: '1px solid color-mix(in srgb, var(--fg) 15%, transparent)',
  },
};

const createNode = (tag, styles = {}) => {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  return node;
};

const createMessageBubble = (message) => {
  const role = message?.role === 'user' ? 'user' : 'assistant';
  const row = createNode('div', {
    display: 'flex',
    flexDirection: 'column',
    alignItems: role === 'user' ? 'flex-end' : 'flex-start',
    gap: '0.2rem',
  });

  const label = createNode('div', {
    fontSize: '0.7rem',
    opacity: '0.75',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  });
  label.textContent = role === 'user' ? 'You' : 'Memory Cue';

  const bubble = createNode('div', {
    maxWidth: '82%',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.75rem',
    fontSize: '0.95rem',
    lineHeight: '1.35',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...bubbleStyles[role],
  });
  bubble.textContent = typeof message?.content === 'string' ? message.content : '';

  row.append(label, bubble);
  return row;
};

export const createChatConversation = () => {
  const container = createNode('section', {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    background: 'var(--bg)',
    border: '1px solid color-mix(in srgb, var(--fg) 10%, transparent)',
    borderRadius: '0.75rem',
    padding: '0.75rem',
  });

  const messageList = createNode('div', {
    minHeight: '220px',
    maxHeight: '360px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  });

  const inputBar = createNode('form', {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'flex-end',
  });

  const input = createNode('textarea', {
    flex: '1',
    border: '1px solid color-mix(in srgb, var(--fg) 15%, transparent)',
    borderRadius: '0.5rem',
    background: 'var(--card)',
    color: 'var(--fg)',
    padding: '0.55rem 0.75rem',
    minHeight: '2.5rem',
    maxHeight: '7.5rem',
    resize: 'none',
    lineHeight: '1.35',
  });
  input.rows = 1;
  input.placeholder = 'Think or ask anything…';

  const sendButton = createNode('button', {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    padding: '0.5rem 0.9rem',
    cursor: 'pointer',
    height: '2.5rem',
  });
  sendButton.type = 'submit';
  sendButton.textContent = 'Send';

  const resizeInput = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };

  const appendMessage = (role, content) => {
    if (!content) return;
    messageList.appendChild(createMessageBubble({ role, content }));
    messageList.scrollTop = messageList.scrollHeight;
  };

  const renderMessages = () => {
    messageList.innerHTML = '';
    getMessages().forEach((message) => {
      appendMessage(message.role, message.content);
    });
  };

  const createTypingIndicator = () => createMessageBubble({ role: 'assistant', content: 'Memory Cue is thinking…' });

  input.addEventListener('input', resizeInput);
  resizeInput();
  renderMessages();

  inputBar.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userInput = input.value.trim();
    if (!userInput) {
      return;
    }

    appendMessage('user', userInput);
    input.value = '';
    resizeInput();

    const typingIndicator = createTypingIndicator();
    messageList.appendChild(typingIndicator);
    messageList.scrollTop = messageList.scrollHeight;

    try {
      const assistantReply = await handleMessage(userInput, { createReminder });
      typingIndicator.remove();
      appendMessage('assistant', assistantReply?.message || 'Saved for later review.');
    } catch (error) {
      typingIndicator.remove();
      console.error('Failed to handle chat message', error);
      appendMessage('assistant', 'Unable to complete that request right now.');
    }
  });

  inputBar.append(input, sendButton);
  container.append(messageList, inputBar);

  return {
    container,
    messageList,
    input,
    sendButton,
    inputBar,
  };
};

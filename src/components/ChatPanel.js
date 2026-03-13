import { handleMessage } from '../chat/chatManager.js';

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
  const bubble = createNode('div', {
    maxWidth: '80%',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.75rem',
    fontSize: '0.95rem',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...bubbleStyles[role],
  });
  bubble.textContent = typeof message?.content === 'string' ? message.content : '';
  return bubble;
};

const appendMessage = (list, role, content) => {
  const message = { role, content };
  list.appendChild(createMessageBubble(message));
  list.scrollTop = list.scrollHeight;
};

export const createChatPanel = () => {
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
    maxHeight: '320px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  });

  const inputBar = createNode('form', {
    display: 'flex',
    gap: '0.5rem',
  });

  const input = createNode('input', {
    flex: '1',
    border: '1px solid color-mix(in srgb, var(--fg) 15%, transparent)',
    borderRadius: '0.5rem',
    background: 'var(--card)',
    color: 'var(--fg)',
    padding: '0.5rem 0.75rem',
  });
  input.type = 'text';
  input.placeholder = 'Type a message...';

  const sendButton = createNode('button', {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    padding: '0.5rem 0.9rem',
    cursor: 'pointer',
  });
  sendButton.type = 'submit';
  sendButton.textContent = 'Send';

  inputBar.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userInput = input.value.trim();
    if (!userInput) {
      return;
    }

    appendMessage(messageList, 'user', userInput);
    input.value = '';

    const assistantReply = await handleMessage(userInput);
    appendMessage(messageList, 'assistant', assistantReply);
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

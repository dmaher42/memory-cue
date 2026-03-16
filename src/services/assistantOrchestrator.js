const DEFAULT_SYSTEM_PROMPT = 'You are Memory Cue, a personal assistant. Use provided memories when they are relevant, and be concise.';

const trimText = (value, maxChars) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return normalized;
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
};

export const buildMemoryAssistantRequest = (question, memorySnippets = [], options = {}) => {
  const safeQuestion = trimText(question, options.maxQuestionChars ?? 500);
  const normalizedSnippets = Array.isArray(memorySnippets)
    ? memorySnippets
      .map((snippet, index) => {
        const value = trimText(snippet, options.maxSnippetChars ?? 240);
        return value ? `${index + 1}. ${value}` : '';
      })
      .filter(Boolean)
    : [];

  const memoryBlock = normalizedSnippets.length
    ? normalizedSnippets.join('\n')
    : 'No relevant memories found.';

  const assembledUserContent = [
    `User asked: "${safeQuestion}"`,
    '',
    'Relevant memories:',
    memoryBlock,
  ].join('\n').slice(0, options.maxMessageChars ?? 2600);

  return {
    message: safeQuestion,
    messages: [
      {
        role: 'system',
        content: options.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: assembledUserContent,
      },
    ],
  };
};

export const buildRagAssistantRequest = ({ question, contextText, entries = [], schemaVersion = 2 } = {}) => ({
  question: trimText(question),
  contextText: trimText(contextText),
  entries: Array.isArray(entries) ? entries : [],
  schemaVersion,
});

export const formatAssistantReply = (payload, fallbackReply = 'Here is what I found.') => {
  const reply = typeof payload?.reply === 'string'
    ? payload.reply
    : typeof payload?.text === 'string'
      ? payload.text
      : typeof payload?.message === 'string'
        ? payload.message
        : '';

  const normalizedReply = trimText(reply);
  return normalizedReply || fallbackReply;
};

export const requestAssistantChat = async (body, options = {}) => {
  const response = await fetch('/api/assistant-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(options.errorMessage || `Assistant request failed (${response.status})`);
  }

  const payload = await response.json();
  return formatAssistantReply(payload, options.fallbackReply);
};

import { helpContent } from '../../src/assistant/help-content.js';
import { handleQuery } from '../../src/brain/queryEngine.js';

const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
];

const MAX_INPUT_MESSAGE_CHARS = 2600;
const MAX_ASSISTANT_MESSAGES = 2;
const MAX_ASSISTANT_MESSAGE_CHARS = 2600;

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const buildAllowedOrigins = (env: Record<string, unknown> = {}) => {
  const envOrigins = [
    env.CORS_ALLOWED_ORIGINS,
    env.CLOUDFLARE_PAGES_URL,
    env.CLOUDFLARE_APP_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([
    'https://dmaher42.github.io',
    'https://memory-cue.pages.dev',
    ...envOrigins,
    ...LOCALHOST_ORIGINS,
  ]));
};

const jsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) => (
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
);

const applyCorsHeaders = (request: Request, env: Record<string, unknown> = {}) => {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {};
  if (!origin) {
    return headers;
  }

  const allowedOrigins = buildAllowedOrigins(env);
  if (!allowedOrigins.includes(origin)) {
    return headers;
  }

  headers['Access-Control-Allow-Origin'] = origin;
  headers.Vary = 'Origin';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
};

const keywordScore = (query: string, text: string) => {
  const queryTerms = toText(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!queryTerms.length) return 0;
  const haystack = toText(text).toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
};

const normalizeEntry = (entry: Record<string, unknown> = {}, type: string) => {
  const id = toText(entry?.id);
  const title = toText(entry?.title);
  const body = toText(entry?.body || entry?.text || entry?.notes);
  if (!id && !title && !body) return null;

  return {
    id: id || `${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: title || body.slice(0, 64) || `${type} entry`,
    body,
    createdAt: toText(entry?.createdAt),
    parsedType: toText(entry?.parsedType || (entry?.metadata as Record<string, unknown>)?.type || ''),
    keywords: Array.isArray((entry?.metadata as Record<string, unknown>)?.keywords)
      ? ((entry.metadata as Record<string, unknown>).keywords as unknown[])
        .map((keyword) => toText(keyword).toLowerCase())
        .filter(Boolean)
      : [],
  };
};

const gatherContext = (body: Record<string, unknown>) => {
  const inboxEntries = Array.isArray(body?.inboxEntries) ? body.inboxEntries : [];
  const notes = Array.isArray(body?.notes) ? body.notes : [];
  const reminders = Array.isArray(body?.reminders) ? body.reminders : [];
  const genericEntries = Array.isArray(body?.entries) ? body.entries : [];
  const memoryEntries = Array.isArray(body?.memoryEntries) ? body.memoryEntries : [];

  return [
    ...inboxEntries.map((entry) => normalizeEntry(entry as Record<string, unknown>, 'inbox')),
    ...notes.map((entry) => normalizeEntry(entry as Record<string, unknown>, 'note')),
    ...reminders.map((entry) => normalizeEntry(entry as Record<string, unknown>, 'reminder')),
    ...genericEntries.map((entry) => normalizeEntry(entry as Record<string, unknown>, 'entry')),
    ...memoryEntries.map((entry) => normalizeEntry(entry as Record<string, unknown>, 'entry')),
  ].filter(Boolean);
};

const buildKeywordSelectedContext = (message: string, contextEntries: ReturnType<typeof gatherContext>) => (
  contextEntries
    .map((entry) => ({ entry, score: keywordScore(message, `${entry.title} ${entry.body}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.entry)
);

const buildContextMatchKey = (entry: Record<string, unknown> = {}) => [
  toText(entry?.id).toLowerCase(),
  toText(entry?.type).toLowerCase(),
  toText(entry?.title).toLowerCase(),
  toText(entry?.body || entry?.text || entry?.notes).toLowerCase(),
].join('|');

const normalizeSemanticResult = (item: Record<string, unknown> = {}) => normalizeEntry({
  id: item?.id,
  title: item?.title || item?.text,
  body: item?.text || item?.body || item?.notes || item?.title,
  createdAt: item?.createdAt || item?.timestamp,
  parsedType: item?.parsedType || (item?.metadata as Record<string, unknown>)?.type || item?.source || item?.type,
  metadata: item?.metadata,
}, toText(item?.type) || 'entry');

const selectAssistantContext = async (message: string, contextEntries: ReturnType<typeof gatherContext>) => {
  const keywordFallback = () => buildKeywordSelectedContext(message, contextEntries);

  try {
    const queryResult = await handleQuery(message);
    const candidateItems = Array.isArray((queryResult as Record<string, unknown>)?.items)
      ? (queryResult as Record<string, unknown>).items as Record<string, unknown>[]
      : [
        ...(Array.isArray((queryResult as Record<string, unknown>)?.memories) ? (queryResult as Record<string, unknown>).memories as Record<string, unknown>[] : []),
        ...(Array.isArray((queryResult as Record<string, unknown>)?.reminders) ? (queryResult as Record<string, unknown>).reminders as Record<string, unknown>[] : []),
      ];

    if (!candidateItems.length) {
      return keywordFallback();
    }

    const contextById = new Map();
    const contextByKey = new Map();
    contextEntries.forEach((entry) => {
      if (entry?.id) {
        contextById.set(entry.id, entry);
      }
      contextByKey.set(buildContextMatchKey(entry), entry);
    });

    const selected: ReturnType<typeof gatherContext> = [];
    const seen = new Set<string>();

    candidateItems.forEach((item) => {
      const normalized = normalizeSemanticResult(item);
      if (!normalized) {
        return;
      }

      const matchedEntry = contextById.get(normalized.id) || contextByKey.get(buildContextMatchKey(normalized));
      const resolvedEntry = matchedEntry || normalized;
      const dedupeKey = buildContextMatchKey(resolvedEntry);
      if (seen.has(dedupeKey)) {
        return;
      }

      seen.add(dedupeKey);
      selected.push(resolvedEntry);
    });

    return selected.length ? selected.slice(0, 8) : keywordFallback();
  } catch (error) {
    console.warn('[assistant-chat] Semantic retrieval bridge failed; using keyword fallback.', error);
    return keywordFallback();
  }
};

const isHelpRequest = (message: string) => {
  const helpWords = [
    'help',
    'how do i use',
    'how do i use memory cue',
    'how do i use this',
    'how does this work',
    'how does memory cue work',
    'what can i type',
    'what can i type here',
    'what does inbox mean',
    'what is inbox',
    'how do reminders work',
  ];

  const normalized = toText(message).toLowerCase();
  return helpWords.some((word) => normalized.includes(word));
};

const buildHelpReply = (message: string) => {
  const normalized = toText(message).toLowerCase();

  if (normalized === 'help') {
    return [
      'How to use Memory Cue:',
      '',
      'Type anything into the message bar.',
      '',
      helpContent.examples,
      '',
      'I will automatically store it in reminders, notebooks, or inbox.',
    ].join('\n');
  }

  if (normalized.includes('inbox')) {
    return `${helpContent.sections.inbox}\n\n${helpContent.examples}`;
  }

  if (normalized.includes('reminder')) {
    return `${helpContent.sections.reminders}\n\n${helpContent.examples}`;
  }

  return [
    'Memory Cue works by capturing thoughts through the message bar.',
    '',
    helpContent.examples,
    '',
    'I will automatically store them in:',
    'Reminders',
    'Notebooks',
    'Inbox',
  ].join('\n');
};

const buildPrompt = (message: string, history: unknown[], selectedContext: ReturnType<typeof gatherContext>) => {
  const historyText = Array.isArray(history)
    ? history
      .slice(-10)
      .map((item) => `${toText((item as Record<string, unknown>)?.role) || 'user'}: ${toText((item as Record<string, unknown>)?.content)}`)
      .join('\n')
    : '';

  const contextText = selectedContext.length
    ? selectedContext.map((item, index) => {
      const details = [item.title, item.body].filter(Boolean).join(' - ');
      return `[${index + 1}] (${item.type}) ${details}`;
    }).join('\n')
    : 'No stored entries matched this message.';

  return [
    'You are Memory Cue, a personal assistant.',
    'Answer using the provided context when relevant.',
    'If context is insufficient, say so briefly and provide best guidance.',
    '',
    historyText ? `Conversation:\n${historyText}` : '',
    `Context:\n${contextText}`,
    '',
    `User: ${message}`,
  ].filter(Boolean).join('\n');
};

const normalizeTypeLabel = (value: string) => {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'coaching_drill') return 'coaching drill';
  if (normalized === 'lesson_idea') return 'lesson idea';
  return normalized;
};

const detectRecallType = (message: string) => {
  const normalized = toText(message).toLowerCase();
  if (!normalized) return null;
  if (/\bdrills?\b|\bcoaching drill\b/.test(normalized)) return 'coaching_drill';
  if (/\blesson ideas?\b|\blesson\b/.test(normalized)) return 'lesson_idea';
  if (/\breminders?\b/.test(normalized)) return 'reminder';
  if (/\bideas?\b/.test(normalized)) return 'idea';
  if (/\bnotes?\b/.test(normalized)) return 'note';
  return null;
};

const extractSearchTerms = (message: string) => {
  const normalized = toText(message).toLowerCase();
  const cleaned = normalized.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set(['what', 'did', 'i', 'write', 'down', 'save', 'saved', 'say', 'about', 'was', 'that', 'the', 'a', 'an', 'my']);
  return cleaned
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stopWords.has(term));
};

const buildIdeaHighlights = (message: string, contextEntries: ReturnType<typeof gatherContext>) => {
  const requestedType = detectRecallType(message);
  const searchTerms = extractSearchTerms(message);

  let matches = contextEntries.filter((entry) => entry.type === 'inbox');

  if (requestedType) {
    matches = matches.filter((entry) => normalizeTypeLabel(entry.parsedType) === normalizeTypeLabel(requestedType));
  }

  if (searchTerms.length) {
    matches = matches
      .map((entry) => {
        const haystack = `${entry.title} ${entry.body} ${(entry.keywords || []).join(' ')}`.toLowerCase();
        const score = searchTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  }

  const unique = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const key = `${match.id}:${match.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
    if (unique.length >= 8) break;
  }

  if (!unique.length) {
    return null;
  }

  const typeLabel = requestedType ? normalizeTypeLabel(requestedType) : 'ideas';
  const heading = requestedType
    ? `You wrote these ${typeLabel}${typeLabel.endsWith('s') ? '' : 's'}:`
    : 'Here are matching ideas you saved:';
  const list = unique.map((entry) => `- ${entry.body || entry.title}`).join('\n');

  return {
    reply: `${heading}\n\n${list}`,
    references: unique.map((entry) => ({ id: entry.id, type: entry.parsedType || entry.type, title: entry.title || entry.body })),
    contextUsed: unique,
  };
};

const normalizeAssistantMessages = (rawMessages: unknown[]) => {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages
    .slice(0, MAX_ASSISTANT_MESSAGES)
    .map((message) => {
      const role = toText((message as Record<string, unknown>)?.role).toLowerCase();
      const safeRole = role === 'system' ? 'system' : 'user';
      const content = toText((message as Record<string, unknown>)?.content).slice(0, MAX_ASSISTANT_MESSAGE_CHARS);
      if (!content) {
        return null;
      }
      return {
        role: safeRole,
        content: [{ type: 'input_text', text: content }],
      };
    })
    .filter(Boolean);
};

const getOpenAiResponse = async (
  prompt: string,
  messages: ReturnType<typeof normalizeAssistantMessages>,
  env: Record<string, unknown> = {},
) => {
  const apiKey = toText(env.OPENAI_API_KEY);
  if (!apiKey) {
    return 'Assistant is configured without OPENAI_API_KEY. I can still show matching context references below.';
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      store: false,
      max_output_tokens: 180,
      input: messages.length
        ? messages
        : [
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt.slice(0, MAX_INPUT_MESSAGE_CHARS) }],
          },
        ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LLM request failed: ${details}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  return toText(payload.output_text)
    || toText((((payload.output as unknown[])?.[0] as Record<string, unknown>)?.content as unknown[])?.[0] && (((((payload.output as unknown[])?.[0] as Record<string, unknown>)?.content as unknown[])?.[0] as Record<string, unknown>).text))
    || 'I could not generate a response.';
};

export const onRequestOptions = async (context: { request: Request; env: Record<string, unknown> }) => (
  new Response(null, {
    status: 200,
    headers: applyCorsHeaders(context.request, context.env as Record<string, unknown>),
  })
);

export const onRequestPost = async (context: { request: Request; env: Record<string, unknown> }) => {
  const corsHeaders = applyCorsHeaders(context.request, context.env as Record<string, unknown>);
  const body = await context.request.json().catch(() => ({})) as Record<string, unknown>;
  const message = toText(body.message || body.question || body.input);

  if (!message) {
    return jsonResponse({ error: 'Missing message' }, 400, corsHeaders);
  }

  if (isHelpRequest(message)) {
    return jsonResponse({
      success: true,
      reply: buildHelpReply(message),
      references: [],
      contextUsed: [],
    }, 200, corsHeaders);
  }

  try {
    const contextEntries = gatherContext(body);
    const ideaHighlights = buildIdeaHighlights(message, contextEntries);
    if (ideaHighlights) {
      return jsonResponse({
        success: true,
        reply: ideaHighlights.reply,
        references: ideaHighlights.references,
        contextUsed: ideaHighlights.contextUsed,
      }, 200, corsHeaders);
    }

    const selectedContext = await selectAssistantContext(message, contextEntries);
    const prompt = buildPrompt(message, Array.isArray(body.history) ? body.history : [], selectedContext);
    const assistantMessages = normalizeAssistantMessages(Array.isArray(body.messages) ? body.messages : []);
    const reply = await getOpenAiResponse(prompt, assistantMessages, context.env as Record<string, unknown>);

    return jsonResponse({
      success: true,
      reply,
      references: selectedContext.map((entry) => ({
        id: entry.id,
        type: entry.type,
        title: entry.title,
      })),
      contextUsed: selectedContext,
    }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse({
      error: 'Failed to process assistant request',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500, corsHeaders);
  }
};

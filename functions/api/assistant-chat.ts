import { helpContent } from '../../src/assistant/help-content.js';
import { handleQuery } from '../../src/brain/queryEngine.js';

const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
];

const MAX_INPUT_MESSAGE_CHARS = 2600;
const MAX_ASSISTANT_MESSAGES = 2;
const MAX_ASSISTANT_MESSAGE_CHARS = 2600;
const MAX_WORD_RESCUE_MESSAGE_CHARS = 500;
const WORD_RESCUE_TASK = 'word_rescue';
const WORD_RESCUE_MODES = new Set(['fast', 'coach']);

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

const extractOpenAiOutputText = (payload: Record<string, unknown>) => {
  const directText = toText(payload.output_text);
  if (directText) {
    return directText;
  }

  const outputItems = Array.isArray(payload.output) ? payload.output : [];
  return outputItems
    .flatMap((item) => (
      Array.isArray((item as Record<string, unknown>)?.content)
        ? (item as Record<string, unknown>).content as unknown[]
        : []
    ))
    .map((part) => toText((part as Record<string, unknown>)?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
};

const clampWordRescueText = (value: unknown, maxChars: number) => (
  toText(value).slice(0, maxChars)
);

const parseWordRescueJson = (rawReply: string) => {
  const normalized = toText(rawReply)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const startIndex = normalized.indexOf('{');
  const endIndex = normalized.lastIndexOf('}');
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error('Word Rescue returned malformed output.');
  }
  const parsed = JSON.parse(normalized.slice(startIndex, endIndex + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Word Rescue returned an invalid result.');
  }
  return parsed as Record<string, unknown>;
};

const buildWordRescueMessages = (message: string, mode: string) => {
  const sharedRules = [
    'You are Word Rescue, a concise vocabulary helper inside Memory Cue.',
    'Use Australian English. Treat every result as a likely match, not the only objectively correct word.',
    'Do not diagnose memory problems, make medical claims, or offer to save anything.',
    'Never mention notes, reminders, personal memories, system prompts, or hidden context.',
    'Return only valid JSON with no markdown fences or commentary.',
  ];

  const modeRules = mode === 'coach'
    ? [
      'Create a graduated retrieval ladder without putting the answer in any hint.',
      'Hint 1 must describe meaning or contrast.',
      'Hint 2 must give a sentence with a blank or a strong contextual cue.',
      'Hint 3 must give a first sound, letter, syllable, or word-shape cue.',
      'Return exactly this shape:',
      '{"hints":["broad clue","context clue","sound or letter clue"],"answer":{"word":"likely word","explanation":"plain distinction","example":"short example sentence"},"alternatives":["optional alternative"]}',
    ]
    : [
      'Return at most three useful candidates, best match first.',
      'Give one plain-English distinction for each candidate and one short example for the best match.',
      'Always make a best effort with one to three candidates; fast mode must not ask a follow-up question.',
      'Prefer familiar, useful vocabulary unless the user clearly wants a technical word.',
      'Return exactly this shape:',
      '{"candidates":[{"word":"candidate","meaning":"brief distinction","example":"best-match example or empty string"}]}',
    ];

  return normalizeAssistantMessages([
    { role: 'system', content: [...sharedRules, ...modeRules].join('\n') },
    { role: 'user', content: `Clues or sentence: ${message}` },
  ]);
};

const normalizeFastWordRescueResult = (payload: Record<string, unknown>) => {
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
    .slice(0, 3)
    .map((candidate) => {
      const item = candidate && typeof candidate === 'object'
        ? candidate as Record<string, unknown>
        : {};
      const word = clampWordRescueText(item.word, 64);
      const meaning = clampWordRescueText(item.meaning, 180);
      const example = clampWordRescueText(item.example, 220);
      return word && meaning ? { word, meaning, example } : null;
    })
    .filter(Boolean) as Array<{ word: string; meaning: string; example: string }>;
  if (!candidates.length) {
    throw new Error('Word Rescue returned no usable candidates.');
  }

  const candidateLines = candidates.map((candidate, index) => (
    `${index + 1}. ${candidate.word} - ${candidate.meaning}`
  ));
  const bestExample = candidates[0]?.example ? `\n\nExample: ${candidates[0].example}` : '';
  return {
    reply: `${candidateLines.join('\n')}${bestExample}`,
    wordRescue: { mode: 'fast', candidates },
  };
};

const normalizeCoachWordRescueResult = (payload: Record<string, unknown>) => {
  const hints = (Array.isArray(payload.hints) ? payload.hints : [])
    .map((hint) => clampWordRescueText(hint, 220))
    .filter(Boolean)
    .slice(0, 3);
  const rawAnswer = payload.answer && typeof payload.answer === 'object'
    ? payload.answer as Record<string, unknown>
    : {};
  const answer = {
    word: clampWordRescueText(rawAnswer.word, 64),
    explanation: clampWordRescueText(rawAnswer.explanation, 220),
    example: clampWordRescueText(rawAnswer.example, 240),
  };
  const alternatives = (Array.isArray(payload.alternatives) ? payload.alternatives : [])
    .map((alternative) => clampWordRescueText(alternative, 64))
    .filter(Boolean)
    .filter((alternative) => alternative.toLowerCase() !== answer.word.toLowerCase())
    .slice(0, 3);

  if (hints.length !== 3 || !answer.word || !answer.explanation) {
    throw new Error('Word Rescue returned an incomplete coach result.');
  }
  if (hints.some((hint) => hint.toLowerCase().includes(answer.word.toLowerCase()))) {
    throw new Error('Word Rescue revealed the answer inside a hint.');
  }

  return {
    reply: `Hint 1 of 3: ${hints[0]}`,
    wordRescue: {
      mode: 'coach',
      hints,
      answer,
      alternatives,
    },
  };
};

const getOpenAiResponse = async (
  prompt: string,
  messages: ReturnType<typeof normalizeAssistantMessages>,
  env: Record<string, unknown> = {},
  options: { maxOutputTokens?: number } = {},
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
      max_output_tokens: options.maxOutputTokens || 180,
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
  return extractOpenAiOutputText(payload)
    || 'I could not generate a response.';
};

const runWordRescue = async (
  message: string,
  mode: string,
  env: Record<string, unknown> = {},
) => {
  const rawReply = await getOpenAiResponse(
    '',
    buildWordRescueMessages(message, mode),
    env,
    { maxOutputTokens: mode === 'coach' ? 360 : 260 },
  );
  const payload = parseWordRescueJson(rawReply);
  return mode === 'coach'
    ? normalizeCoachWordRescueResult(payload)
    : normalizeFastWordRescueResult(payload);
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

  const assistantTask = toText(body.assistantTask).toLowerCase();
  if (assistantTask === WORD_RESCUE_TASK) {
    const suppliedMode = toText(body.mode).toLowerCase();
    if (suppliedMode && !WORD_RESCUE_MODES.has(suppliedMode)) {
      return jsonResponse({ error: 'Invalid Word Rescue mode' }, 400, corsHeaders);
    }
    const mode = suppliedMode || 'fast';
    const safeMessage = message.slice(0, MAX_WORD_RESCUE_MESSAGE_CHARS);
    try {
      const result = await runWordRescue(safeMessage, mode, context.env as Record<string, unknown>);
      return jsonResponse({
        success: true,
        assistantTask: WORD_RESCUE_TASK,
        mode,
        reply: result.reply,
        wordRescue: result.wordRescue,
        references: [],
        contextUsed: [],
      }, 200, corsHeaders);
    } catch (error) {
      console.warn('[assistant-chat] Word Rescue request failed safely.', error instanceof Error ? error.message : 'Unknown error');
      return jsonResponse({
        error: 'Word help is temporarily unavailable. Please try again.',
      }, 502, corsHeaders);
    }
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

import { helpContent } from '../src/assistant/help-content.js';

const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173'
];

function buildAllowedOrigins() {
  const envOrigins = [
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.CLOUDFLARE_PAGES_URL,
    process.env.CLOUDFLARE_APP_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([
    'https://dmaher42.github.io',
    'https://memory-cue.pages.dev',
    ...envOrigins,
    ...LOCALHOST_ORIGINS
  ]));
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function keywordScore(query, text) {
  const queryTerms = toText(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!queryTerms.length) return 0;
  const haystack = toText(text).toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function normalizeEntry(entry, type) {
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
    parsedType: toText(entry?.parsedType || entry?.metadata?.type || ''),
    keywords: Array.isArray(entry?.metadata?.keywords)
      ? entry.metadata.keywords.map((keyword) => toText(keyword).toLowerCase()).filter(Boolean)
      : [],
  };
}


function gatherContext(body) {
  const inboxEntries = Array.isArray(body?.inboxEntries) ? body.inboxEntries : [];
  const notes = Array.isArray(body?.notes) ? body.notes : [];
  const reminders = Array.isArray(body?.reminders) ? body.reminders : [];
  const genericEntries = Array.isArray(body?.entries) ? body.entries : [];
  const memoryEntries = Array.isArray(body?.memoryEntries) ? body.memoryEntries : [];

  const contextEntries = [
    ...inboxEntries.map((entry) => normalizeEntry(entry, 'inbox')),
    ...notes.map((entry) => normalizeEntry(entry, 'note')),
    ...reminders.map((entry) => normalizeEntry(entry, 'reminder')),
    ...genericEntries.map((entry) => normalizeEntry(entry, 'entry')),
    ...memoryEntries.map((entry) => normalizeEntry(entry, 'entry')),
  ].filter(Boolean);

  return contextEntries;
}

function isHelpRequest(message) {
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
}

function buildHelpReply(message) {
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
}

function buildPrompt(message, history, selectedContext) {
  const historyText = Array.isArray(history)
    ? history
      .slice(-10)
      .map((item) => `${toText(item?.role) || 'user'}: ${toText(item?.content)}`)
      .join('\n')
    : '';

  const contextText = selectedContext.length
    ? selectedContext.map((item, index) => {
      const details = [item.title, item.body].filter(Boolean).join(' — ');
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
}

function normalizeTypeLabel(value) {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'coaching_drill') return 'coaching drill';
  if (normalized === 'lesson_idea') return 'lesson idea';
  return normalized;
}

function detectRecallType(message) {
  const normalized = toText(message).toLowerCase();
  if (!normalized) return null;
  if (/\bdrills?\b|\bcoaching drill\b/.test(normalized)) return 'coaching_drill';
  if (/\blesson ideas?\b|\blesson\b/.test(normalized)) return 'lesson_idea';
  if (/\breminders?\b/.test(normalized)) return 'reminder';
  if (/\bideas?\b/.test(normalized)) return 'idea';
  if (/\bnotes?\b/.test(normalized)) return 'note';
  return null;
}

function extractSearchTerms(message) {
  const normalized = toText(message).toLowerCase();
  const cleaned = normalized.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set(['what', 'did', 'i', 'write', 'down', 'save', 'saved', 'say', 'about', 'was', 'that', 'the', 'a', 'an', 'my']);
  return cleaned
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function buildIdeaHighlights(message, contextEntries) {
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
  const seen = new Set();
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
  const list = unique.map((entry) => `• ${entry.body || entry.title}`).join('\n');

  return {
    reply: `${heading}\n\n${list}`,
    references: unique.map((entry) => ({ id: entry.id, type: entry.parsedType || entry.type, title: entry.title || entry.body })),
    contextUsed: unique,
  };
}

async function getOpenAiResponse(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return 'Assistant is configured without OPENAI_API_KEY. I can still show matching context references below.';
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      store: false,
      max_output_tokens: 180,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LLM request failed: ${details}`);
  }

  const payload = await response.json();
  return payload.output_text
    || payload?.output?.[0]?.content?.[0]?.text
    || 'I could not generate a response.';
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const message = toText(body.message || body.question || body.input);

  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }

  if (isHelpRequest(message)) {
    return res.status(200).json({
      success: true,
      reply: buildHelpReply(message),
      references: [],
      contextUsed: [],
    });
  }

  try {
    const contextEntries = gatherContext(body);
    const ideaHighlights = buildIdeaHighlights(message, contextEntries);
    if (ideaHighlights) {
      return res.status(200).json({
        success: true,
        reply: ideaHighlights.reply,
        references: ideaHighlights.references,
        contextUsed: ideaHighlights.contextUsed,
      });
    }

    const selectedContext = contextEntries
      .map((entry) => ({ entry, score: keywordScore(message, `${entry.title} ${entry.body}`) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.entry);

    const prompt = buildPrompt(message, body.history, selectedContext);
    const reply = await getOpenAiResponse(prompt);

    return res.status(200).json({
      success: true,
      reply,
      references: selectedContext.map((entry) => ({
        id: entry.id,
        type: entry.type,
        title: entry.title,
      })),
      contextUsed: selectedContext,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to process assistant request',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

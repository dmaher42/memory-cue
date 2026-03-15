// Deprecated: replaced by Cloudflare Pages Function
const PARSED_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['note', 'reminder', 'idea', 'lesson_idea', 'coaching_drill', 'question']
    },
    title: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    reminderDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        originalText: { type: 'string' },
        type: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        timestamp: { type: 'string' }
      },
      required: ['originalText', 'type', 'keywords', 'timestamp']
    }
  },
  required: ['type', 'title', 'tags', 'reminderDate', 'metadata']
};

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

const MAX_TEXT_LENGTH = 4000;
const PARSE_FALLBACK_STATUS = 200;
const ALLOWED_PARSED_TYPES = ['note', 'reminder', 'idea', 'lesson_idea', 'coaching_drill', 'question'];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'with', 'you', 'did', 'do'
]);

function sanitizePreview(value) {
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function isValidParsedEntry(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  const hasValidType = typeof parsed.type === 'string' && ALLOWED_PARSED_TYPES.includes(parsed.type);
  const hasValidTitle = typeof parsed.title === 'string';
  const hasValidTags = Array.isArray(parsed.tags) && parsed.tags.every((tag) => typeof tag === 'string');
  const hasValidReminderDate = typeof parsed.reminderDate === 'string' || parsed.reminderDate === null;
  const metadata = parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : null;
  const hasValidMetadata = Boolean(
    metadata
    && typeof metadata.originalText === 'string'
    && typeof metadata.type === 'string'
    && Array.isArray(metadata.keywords)
    && metadata.keywords.every((keyword) => typeof keyword === 'string')
    && typeof metadata.timestamp === 'string'
  );

  return hasValidType && hasValidTitle && hasValidTags && hasValidReminderDate && hasValidMetadata;
}

function extractKeywords(text) {
  const terms = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

  return Array.from(new Set(terms)).slice(0, 8);
}

function inferType(text) {
  const normalized = String(text || '').toLowerCase();

  if (/\b(remind|tomorrow|today|tonight|\d{1,2}(:\d{2})?\s?(am|pm))\b/.test(normalized)) {
    return 'reminder';
  }

  if (/\b(drill|coaching|warmup|scrimmage|hb\b|kick|passing|defence|offense|football|soccer|netball|basketball)\b/.test(normalized)) {
    return 'coaching_drill';
  }

  if (/\b(lesson|class|student|students|naplan|curriculum|sentence|writing|dependent clauses|activity)\b/.test(normalized)) {
    return 'lesson_idea';
  }

  if (/\?$/.test(normalized)) {
    return 'question';
  }

  if (/\b(idea|try|brainstorm|plan|could|should)\b/.test(normalized)) {
    return 'idea';
  }

  return 'note';
}

function toTitle(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function buildStructuredEntry(text) {
  const type = inferType(text);
  const keywords = extractKeywords(text);
  return {
    type,
    title: toTitle(text),
    tags: keywords,
    reminderDate: null,
    metadata: {
      originalText: text,
      type,
      keywords,
      timestamp: new Date().toISOString()
    }
  };
}

function buildFallbackEntry(text) {
  return {
    ...buildStructuredEntry(text),
    source: 'fallback'
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const body = typeof req.body === 'string' ? (() => {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return {};
    }
  })() : (req.body || {});

  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) {
    return res.status(400).json({ error: 'Invalid input: text must be a non-empty string.' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: 'Input too large.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(PARSE_FALLBACK_STATUS).json(buildStructuredEntry(text));
  }

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_output_tokens: 250,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: `Return ONLY JSON matching schema.\nClassify the message as one of: note, reminder, idea, lesson_idea, coaching_drill, question.\nInclude metadata with originalText, type, keywords, and timestamp.\nIf unsure, use note.`
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'parsed_entry',
            strict: true,
            schema: PARSED_ENTRY_SCHEMA
          }
        }
      })
    });
  } catch (error) {
    return res.status(500).json({ error: 'AI request failed', message: error.message });
  }

  if (!response.ok) {
    const details = await response.text();
    return res.status(response.status === 429 ? 429 : 500).json({ error: 'Failed to parse entry.', details });
  }

  try {
    const data = await response.json();
    const outputText =
      data.output_text ||
      (data.output &&
        data.output[0] &&
        data.output[0].content &&
        data.output[0].content[0] &&
        data.output[0].content[0].text) ||
      null;

    const outputTextLength = typeof outputText === 'string' ? outputText.length : 0;
    const outputTextPreview = sanitizePreview(outputText || '');

    if (!outputText) {
      console.warn('Model output missing parsable text. Returning fallback.', {
        outputTextLength,
        outputTextPreview
      });
      return res.status(PARSE_FALLBACK_STATUS).json(buildStructuredEntry(text));
    }

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(outputText);
    } catch (error) {
      console.warn('Failed to parse model output JSON', {
        rawModelOutput: outputText,
        outputTextLength,
        outputTextPreview,
        message: error.message
      });
      return res.status(PARSE_FALLBACK_STATUS).json(buildStructuredEntry(text));
    }

    if (!isValidParsedEntry(parsedOutput)) {
      console.warn('Model output failed schema shape validation', {
        outputTextLength,
        outputTextPreview
      });
      return res.status(PARSE_FALLBACK_STATUS).json(buildStructuredEntry(text));
    }

    return res.status(200).json(parsedOutput);
  } catch (error) {
    return res.status(500).json({ error: 'AI parse error', message: error.message });
  }
};

const PARSED_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['note', 'reminder', 'question']
    },
    content: { type: 'string' }
  },
  required: ['type', 'content']
};

const ALLOWED_ORIGINS = [
  'https://memory-cue.vercel.app',
  'https://dmaher42.github.io',
  'http://localhost:3000',
  'http://localhost:5173'
];

const MAX_TEXT_LENGTH = 4000;
const PARSE_FALLBACK_STATUS = 200;
const ALLOWED_PARSED_TYPES = ['note', 'reminder', 'question'];

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
  const hasValidContent = typeof parsed.content === 'string';

  return hasValidType && hasValidContent;
}

function buildFallbackEntry(text) {
  return {
    type: 'note',
    content: text,
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
    return res.status(500).json({ error: 'Server misconfiguration: missing OpenAI API key.' });
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
                text: `Return ONLY JSON matching schema.\nExtract:\n- type (note, reminder, question)\n- content (cleaned user text)\nIf unsure, use note.`
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
      return res.status(PARSE_FALLBACK_STATUS).json(buildFallbackEntry(text));
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
      return res.status(PARSE_FALLBACK_STATUS).json(buildFallbackEntry(text));
    }

    if (!isValidParsedEntry(parsedOutput)) {
      console.warn('Model output failed schema shape validation', {
        outputTextLength,
        outputTextPreview
      });
      return res.status(PARSE_FALLBACK_STATUS).json(buildFallbackEntry(text));
    }

    return res.status(200).json(parsedOutput);
  } catch (error) {
    return res.status(500).json({ error: 'AI parse error', message: error.message });
  }
};

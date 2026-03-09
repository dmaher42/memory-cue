const PARSED_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: [
        'note',
        'reminder',
        'drill',
        'idea',
        'task'
      ]
    },
    title: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    reminderDate: {
      type: ['string', 'null']
    }
  },
  required: ['type', 'title', 'tags', 'reminderDate']
};

const ALLOWED_ORIGINS = [
  'https://memory-cue.vercel.app',
  'https://dmaher42.github.io',
  'http://localhost:3000',
  'http://localhost:5173'
];

const MAX_TEXT_LENGTH = 4000;

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
                text: `Return ONLY JSON matching schema.\nExtract:\n- type (note, reminder, drill, idea, task)\n- title (short summary under 60 chars)\n- tags (lowercase keywords)\n- reminderDate (ISO string if date/time mentioned, else null)\nIf unsure, use note.`
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

    if (!outputText) {
      return res.status(500).json({ error: 'Failed to parse entry.' });
    }

    return res.status(200).json(JSON.parse(outputText));
  } catch (error) {
    return res.status(500).json({ error: 'AI parse error', message: error.message });
  }
};

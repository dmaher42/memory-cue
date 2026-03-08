const ALLOWED_ORIGINS = [
  'https://dmaher42.github.io',
  'https://memory-cue.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

const MAX_QUESTION_CHARS = 1000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_ENTRIES = 50;
const MAX_ENTRY_CHARS = 1200;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function trimEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = typeof entry.id === 'string' ? entry.id.slice(0, 128) : '';
  const type = typeof entry.type === 'string' ? entry.type.slice(0, 40) : 'note';
  const title = typeof entry.title === 'string' ? entry.title.slice(0, MAX_ENTRY_CHARS) : '';
  const body = typeof entry.body === 'string' ? entry.body.slice(0, MAX_ENTRY_CHARS) : '';
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt.slice(0, 64) : null;
  const tags = Array.isArray(entry.tags)
    ? entry.tags
        .map((tag) => (typeof tag === 'string' ? tag.slice(0, 64) : ''))
        .filter((tag, index, list) => tag && list.indexOf(tag) === index)
        .slice(0, 20)
    : [];

  if (!title && !body) {
    return null;
  }

  return { id, type, title, body, tags, createdAt };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: missing OpenAI API key.' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const question =
    typeof payload.question === 'string'
      ? payload.question.trim()
      : typeof payload.message === 'string'
      ? payload.message.trim()
      : '';
  const contextText = typeof payload.contextText === 'string' ? payload.contextText : '';
  const schemaVersion = payload.schemaVersion == null ? 2 : payload.schemaVersion;
  const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];

  if (schemaVersion !== 2) {
    return res.status(400).json({ error: 'Invalid schemaVersion.' });
  }

  if (!question || question.length > MAX_QUESTION_CHARS) {
    return res.status(400).json({ error: 'Invalid question length.' });
  }

  if (contextText.length > MAX_CONTEXT_CHARS) {
    return res.status(400).json({ error: 'contextText too large.' });
  }

  if (rawEntries.length > MAX_ENTRIES) {
    return res.status(400).json({ error: 'Too many entries.' });
  }

  const entries = rawEntries.map(trimEntry).filter(Boolean);

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
        max_output_tokens: 400,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: 'You are the Memory Cue assistant. Use only supplied entries/context. If answer is unknown, say so briefly.'
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Question:\n${question}\n\nContext:\n${contextText}\n\nEntries JSON:\n${JSON.stringify(entries)}`
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'memory_cue_answer',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                answer: { type: 'string' },
                cited_entry_ids: {
                  type: 'array',
                  items: { type: 'string' }
                },
                followups: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['answer', 'cited_entry_ids', 'followups']
            }
          }
        }
      })
    });
  } catch (_error) {
    return res.status(500).json({ error: 'Assistant failed.' });
  }

  if (!response.ok) {
    return res.status(response.status === 429 ? 429 : 500).json({
      error: response.status === 429 ? 'Rate limit exceeded.' : 'Assistant failed.'
    });
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
      return res.status(502).json({ error: 'Assistant returned no output.' });
    }

    const result = JSON.parse(outputText);

    return res.status(200).json({
      answer: result.answer,
      reply: result.answer,
      cited_entry_ids: Array.isArray(result.cited_entry_ids) ? result.cited_entry_ids : [],
      followups: Array.isArray(result.followups) ? result.followups : []
    });
  } catch (_error) {
    return res.status(500).json({ error: 'Assistant failed.' });
  }
};

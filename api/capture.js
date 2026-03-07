const ALLOWED_ORIGINS = [
  'https://dmaher42.github.io',
  'https://memory-cue.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

const MAX_INPUT_CHARS = 6000;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
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
  const schemaVersion = payload.schemaVersion;
  const input = typeof payload.input === 'string' ? payload.input.trim() : '';

  if (schemaVersion !== 1) {
    return res.status(400).json({ error: 'Invalid schemaVersion.' });
  }

  if (!input) {
    return res.status(400).json({ error: 'Missing input.' });
  }

  if (input.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: 'input too large.' });
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
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Turn the user\'s free-text input into one structured Memory Cue entry.',
                  'Keep titles short and useful.',
                  'Preserve the user\'s meaning.',
                  'Classify into practical types such as: task, reminder, lesson-idea, lesson-reflection, footy-drill, coaching-note, meeting-note, personal-note, resource.',
                  'Generate 0 to 5 short lowercase tags.',
                  'Choose a simple folder name like: Teaching, Coaching, Personal, Admin, Ideas.',
                  'Set priority as low, medium, or high based on urgency/importance.',
                  'Set actionDate to null unless the user clearly implies timing; if implied, return a short ISO-like string the app can store (for example: tomorrow morning, monday, before training, next lesson).',
                  'Set followUpQuestion to an empty string unless one short clarifying question would materially improve the entry later.',
                  'Lean into teacher/coach workflows by correctly routing school/lesson notes to Teaching and training/footy notes to Coaching when appropriate.',
                  'If uncertain, still return the best structure and lower the confidence score.',
                  'Never return markdown.',
                  'Never return extra keys.'
                ].join(' ')
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: input
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'memory_cue_capture_entry',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' }
                },
                folder: { type: 'string' },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high']
                },
                actionDate: {
                  type: ['string', 'null']
                },
                followUpQuestion: { type: 'string' },
                confidence: { type: 'number' }
              },
              required: [
                'type',
                'title',
                'body',
                'tags',
                'folder',
                'priority',
                'actionDate',
                'followUpQuestion',
                'confidence'
              ]
            }
          }
        }
      })
    });
  } catch (_error) {
    return res.status(500).json({ error: 'Capture failed.' });
  }

  if (!response.ok) {
    return res.status(response.status === 429 ? 429 : 500).json({
      error: response.status === 429 ? 'Rate limit exceeded.' : 'Capture failed.'
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
      return res.status(502).json({ error: 'Capture returned no output.' });
    }

    const result = JSON.parse(outputText);

    return res.status(200).json({
      entry: {
        type: result.type,
        title: result.title,
        body: result.body,
        tags: Array.isArray(result.tags) ? result.tags : [],
        folder: result.folder,
        priority:
          result.priority === 'high' || result.priority === 'medium' || result.priority === 'low'
            ? result.priority
            : 'low',
        actionDate: typeof result.actionDate === 'string' ? result.actionDate : null,
        followUpQuestion:
          typeof result.followUpQuestion === 'string' ? result.followUpQuestion : '',
        confidence: typeof result.confidence === 'number' ? result.confidence : 0
      }
    });
  } catch (_error) {
    return res.status(500).json({ error: 'Capture failed.' });
  }
};

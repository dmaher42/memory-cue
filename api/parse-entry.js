const PARSE_SCHEMA = {
  name: 'memory_cue_parse',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: [
          'footy_drill',
          'netball_note',
          'reflection',
          'reminder',
          'teaching_note',
          'general_note',
        ],
      },
      title: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      reminderDate: { type: ['string', 'null'] },
    },
    required: ['type', 'title', 'tags', 'reminderDate'],
  },
};

function readStructuredOutput(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    try {
      return JSON.parse(payload.output_text);
    } catch {
      // continue to other extraction paths
    }
  }

  if (!Array.isArray(payload.output)) {
    return null;
  }

  for (const item of payload.output) {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    for (const content of contentItems) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        try {
          return JSON.parse(content.text);
        } catch {
          // continue searching
        }
      }
      if (content?.type === 'json_schema' && content?.json && typeof content.json === 'object') {
        return content.json;
      }
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // OPENAI_API_KEY must be set in Vercel project environment variables.
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'Return structured data for the user\'s input. Keep title <= 60 chars. tags: 0–8 items, lowercase, unique, no spaces preferred (use hyphens if needed). If a date/time is implied (e.g., “tomorrow 4:30”), set reminderDate as ISO string in the user\'s local timezone Australia/Adelaide. If not present, null. If unsure of type, use general_note. Output must match the schema.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text,
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: PARSE_SCHEMA.name,
            strict: PARSE_SCHEMA.strict,
            schema: PARSE_SCHEMA.schema,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(500).json({ error: 'OpenAI request failed', details: errorText.slice(0, 500) });
    }

    const payload = await response.json();
    const parsed = readStructuredOutput(payload);

    if (!parsed || typeof parsed !== 'object') {
      return res.status(500).json({ error: 'Failed to parse structured response' });
    }

    return res.status(200).json({
      type: parsed.type,
      title: parsed.title,
      tags: parsed.tags,
      reminderDate: parsed.reminderDate,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to parse entry', details: error?.message || 'unknown error' });
  }
};

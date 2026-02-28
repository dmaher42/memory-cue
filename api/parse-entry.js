const PARSED_ENTRY_SCHEMA = {
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
        'general_note'
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const text = typeof req.body === 'string' ? (() => {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && parsed.text;
    } catch (_error) {
      return undefined;
    }
  })() : req.body && req.body.text;

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Invalid input: text must be a non-empty string.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
                text: `You are a structured data parser.\n\nReturn ONLY valid JSON.\n\nExtract from the user's input:\n- type (footy_drill, netball_note, reflection, reminder, teaching_note, general_note)\n- title (short clean summary under 60 characters)\n- tags (array of lowercase keywords)\n- reminderDate (ISO string if date/time mentioned, otherwise null)\n\nIf unsure, use general_note.`
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return res.status(500).json({ error: 'Failed to parse entry.' });
    }

    const data = await response.json();
    const outputText = data.output_text
      || (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text)
      || null;

    if (!outputText) {
      console.error('OpenAI response missing output text:', data);
      return res.status(500).json({ error: 'Failed to parse entry.' });
    }

    const parsedResult = JSON.parse(outputText);
    return res.status(200).json(parsedResult);
  } catch (error) {
    console.error('parse-entry error:', error);
    return res.status(500).json({ error: 'Failed to parse entry.' });
  }
};

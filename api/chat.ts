async function generateLLMResponse(prompt: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OpenAI API key');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
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
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LLM request failed: ${details}`);
  }

  const data = await response.json();
  return (
    data.output_text ||
    (data.output &&
      data.output[0] &&
      data.output[0].content &&
      data.output[0].content[0] &&
      data.output[0].content[0].text) ||
    ''
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { message, history = [] } = body;

  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }

  try {
    const searchRes = await fetch(process.env.APP_URL + '/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: message })
    });

    const { results = [] } = await searchRes.json();

    const contextNotes = results
      .map((n) => `• ${n.text}`)
      .join('\n');

    const conversationHistory = history
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `
SYSTEM:
You are Memory Cue, a personal memory assistant.

Use stored notes when answering questions.

CONVERSATION:
${conversationHistory}

MEMORY NOTES:
${contextNotes}

USER QUESTION:
${message}

Respond clearly and helpfully.
`;

    const reply = await generateLLMResponse(prompt);

    return res.json({
      success: true,
      reply,
      contextUsed: results
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to process chat request',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

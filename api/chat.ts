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
  const { message, history = [], memoryContext = '', memoryEntries = [] } = body;
  const configuredAppUrl = process.env.APP_URL?.trim();

  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }

  try {
    let searchUrl = configuredAppUrl ? `${configuredAppUrl}/api/search` : '';

    if (!searchUrl) {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const forwardedHost = req.headers['x-forwarded-host'];
      const hostHeader = req.headers.host;

      const proto = Array.isArray(forwardedProto)
        ? forwardedProto[0]
        : forwardedProto?.split(',')[0];
      const host = Array.isArray(forwardedHost)
        ? forwardedHost[0]
        : Array.isArray(hostHeader)
          ? hostHeader[0]
          : forwardedHost || hostHeader;

      if (!proto || !host) {
        return res.status(500).json({
          error: 'Failed to process chat request',
          message:
            'Unable to resolve search endpoint URL. Set APP_URL or provide x-forwarded-proto and host headers.'
        });
      }

      searchUrl = `${proto.trim()}://${host.toString().trim()}/api/search`;
    }

    let results = Array.isArray(memoryEntries) ? memoryEntries : [];

    if (!results.length) {
      const searchRes = await fetch(searchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message })
      });

      const payload = await searchRes.json();
      results = Array.isArray(payload?.results) ? payload.results : [];
    }

    const contextNotes = results
      .map((n) => {
        if (typeof n?.text === 'string' && n.text.trim()) {
          return `• ${n.text}`;
        }
        const title = typeof n?.title === 'string' ? n.title.trim() : '';
        const summary = typeof n?.summary === 'string'
          ? n.summary.trim()
          : typeof n?.body === 'string'
            ? n.body.trim().slice(0, 200)
            : '';
        const tags = Array.isArray(n?.tags) && n.tags.length ? ` (${n.tags.join(', ')})` : '';
        return [title ? `• ${title}${tags}` : '• Note', summary].filter(Boolean).join(' — ');
      })
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
${typeof memoryContext === 'string' && memoryContext.trim() ? `${memoryContext}\n\n` : ''}
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

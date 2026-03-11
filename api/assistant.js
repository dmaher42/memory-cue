const ALLOWED_ORIGINS = [
  'https://dmaher42.github.io',
  'https://memory-cue.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

async function generateLLMResponse(prompt) {
  const contextMatch = prompt.match(/CONTEXT:\n([\s\S]*)\n\nAnswer the question using the context\./);
  const contextText = contextMatch ? contextMatch[1].trim() : '';

  if (!contextText) {
    return "I don't know.";
  }

  return contextText.split('\n').find((line) => line.trim()) || "I don't know.";
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const input = typeof body.input === 'string'
    ? body.input.trim()
    : (typeof body.question === 'string' ? body.question.trim() : '');

  if (!input) {
    return res.status(400).json({ error: 'Missing input' });
  }

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const searchUrl = host ? `${protocol}://${host}/api/search` : '/api/search';

  let results = [];
  try {
    const search = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input })
    });

    const payload = await search.json();
    results = Array.isArray(payload && payload.results) ? payload.results : [];
  } catch (error) {
    console.error('[assistant] search failed', error);
  }

  const context = results.map((n) => n.text).join('\n\n');

  const prompt = `
QUESTION:
${input}

CONTEXT:
${context}

Answer the question using the context.
If the context does not contain the answer, say you don't know.
`;

  const reply = await generateLLMResponse(prompt);

  return res.status(200).json({
    success: true,
    reply,
    contextUsed: results
  });
};

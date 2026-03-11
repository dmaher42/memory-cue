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

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const input = typeof body.input === 'string' ? body.input.trim() : '';

  if (!input) {
    return res.status(400).json({ error: 'Missing input' });
  }

  console.log('[assistant request]', input);

  // TODO: Replace placeholder assistant response with real AI call.
  const reply = `You said: ${input}`;

  console.log('[assistant response]', reply);

  return res.status(200).json({
    success: true,
    reply
  });
};

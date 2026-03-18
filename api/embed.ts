const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173'
];

function buildAllowedOrigins() {
  const envOrigins = [
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.CLOUDFLARE_PAGES_URL,
    process.env.CLOUDFLARE_APP_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([
    'https://dmaher42.github.io',
    'https://memory-cue.pages.dev',
    ...envOrigins,
    ...LOCALHOST_ORIGINS
  ]));
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = toText(body.text);

  if (!text) {
    return res.status(400).json({
      success: false,
      error: 'Missing text',
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[embed] OPENAI_API_KEY is not configured');
    return res.status(500).json({
      success: false,
      error: 'Embedding service unavailable',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      console.warn('[embed] OpenAI embeddings request failed', { status: response.status });
      return res.status(response.status >= 400 && response.status < 500 ? 502 : 500).json({
        success: false,
        error: 'Failed to generate embedding',
      });
    }

    const payload = await response.json();
    const embedding = normalizeEmbedding(payload?.data?.[0]?.embedding);

    if (!embedding.length) {
      console.warn('[embed] OpenAI embeddings response did not include a valid vector');
      return res.status(502).json({
        success: false,
        error: 'Failed to generate embedding',
      });
    }

    return res.status(200).json({
      success: true,
      embedding,
    });
  } catch (error) {
    console.warn('[embed] Unexpected embedding error', error instanceof Error ? error.message : error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate embedding',
    });
  }
}

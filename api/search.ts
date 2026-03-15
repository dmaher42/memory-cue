const { getAllNotes } = require('./memory-store');

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

function similarity(query, text) {
  const q = String(query || '').toLowerCase();
  const t = String(text || '').toLowerCase();

  let score = 0;

  q.split(' ').forEach((word) => {
    if (word && t.includes(word)) score += 1;
  });

  return score;
}

function semanticBoost(query, note) {
  const q = String(query || '').toLowerCase();
  const text = `${note?.text || ''} ${(note?.tags || []).join(' ')}`.toLowerCase();

  const synonyms = [
    ['football', 'footy', 'drill', 'coaching'],
    ['lesson', 'teaching', 'class'],
    ['task', 'todo', 'to-do'],
  ];

  let score = 0;
  synonyms.forEach((group) => {
    if (group.some((term) => q.includes(term)) && group.some((term) => text.includes(term))) {
      score += 2;
    }
  });
  return score;
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
  const query = typeof body.query === 'string' ? body.query.trim() : '';

  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  const notes = await getAllNotes();

  const results = notes
    .map((note) => ({
      note,
      score: similarity(query, note.text) + semanticBoost(query, note)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return res.status(200).json({
    results: results.map((result) => result.note)
  });
};

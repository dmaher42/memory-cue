const { addRecord } = require('./memory-store');
const { classifyMemoryType, createStructuredMemory } = require('./memory-utils');

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

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const schemaVersion = body.schemaVersion;
  const input = typeof body.input === 'string' ? body.input.trim() : '';

  if (schemaVersion !== 2) {
    return res.status(400).json({ error: 'Invalid schemaVersion.' });
  }

  if (!input) {
    return res.status(400).json({ error: 'Missing input.' });
  }

  if (input.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: 'input too large.' });
  }

  const type = classifyMemoryType(input);
  const record = createStructuredMemory(input, type);
  const entry = {
    title: record.text.split(/\s+/).slice(0, 8).join(' '),
    body: record.text,
    tags: record.tags,
    type: record.type,
    folder: type === 'lesson idea' ? 'Teaching' : type === 'coaching idea' ? 'Coaching' : 'Inbox',
    confidence: 0.86,
  };

  addRecord(type, record);

  console.log('[capture classified]', type, record.tags);

  return res.status(200).json({
    success: true,
    type,
    tags: record.tags,
    confirmation: `Saved as: ${type.replace(/\b\w/g, (char) => char.toUpperCase())}`,
    record,
    entry,
  });
};

const { addRecord, getAllNotes, getCategory, searchByPerson } = require('./memory-store');
const { classifyMemoryType, createStructuredMemory } = require('./memory-utils');

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

function normalizeInput(body) {
  if (typeof body?.input === 'string') return body.input.trim();
  if (typeof body?.question === 'string') return body.question.trim();
  if (typeof body?.message === 'string') return body.message.trim();
  return '';
}

function detectIntent(inputText) {
  const normalized = inputText.toLowerCase();
  if (/\b(remember this|save this|add a task|capture this|note this)\b/.test(normalized)) return 'save';
  if (/\b(show|find|list)\b/.test(normalized)) return 'retrieve';
  return 'search';
}

function pickRetrievalType(inputText) {
  const normalized = inputText.toLowerCase();
  if (normalized.includes('lesson idea')) return 'lesson idea';
  if (normalized.includes('coaching') || normalized.includes('football') || normalized.includes('drill')) return 'coaching idea';
  if (normalized.includes('task')) return 'task';
  if (normalized.includes('question')) return 'question';
  if (normalized.includes('resource')) return 'resource';
  if (normalized.includes('note')) return 'note';
  return null;
}

function extractPersonQuery(inputText) {
  const match = String(inputText || '').match(/\bwhat\s+did\s+([^?]+?)\s+say\??\s*$/i);
  if (!match) return null;
  return match[1].trim();
}

function keywordScore(query, memory) {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${memory.text || ''} ${(memory.tags || []).join(' ')}`.toLowerCase();
  return q.reduce((sum, term) => (haystack.includes(term) ? sum + 1 : sum), 0);
}

function formatMemoryList(title, memories) {
  if (!memories.length) {
    return `## ${title}\n\nNo matches yet.`;
  }
  const lines = memories.map((memory) => `- ${memory.text}`);
  return `## ${title}\n\n${lines.join('\n')}`;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const input = normalizeInput(body);

  if (!input) {
    return res.status(400).json({ error: 'Missing input' });
  }

  const intent = detectIntent(input);
  let reply = "I don't know.";
  let results = [];

  const personQuery = extractPersonQuery(input);
  if (personQuery) {
    results = searchByPerson(personQuery);
    reply = formatMemoryList(`${personQuery} said`, results);

    return res.status(200).json({
      success: true,
      reply,
      contextUsed: results
    });
  }

  if (intent === 'save') {
    const type = classifyMemoryType(input);
    const memory = createStructuredMemory(input, type);
    addRecord(type, memory);
    reply = `Saved as: ${type.replace(/\b\w/g, (char) => char.toUpperCase())}\nTags: ${memory.tags.join(', ') || 'none'}`;
    results = [memory];
  } else if (intent === 'retrieve') {
    const type = pickRetrievalType(input);
    const normalizedQuery = input.replace(/\b(show|find|list|my|about)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const pool = type ? getCategory(type) : getAllNotes();
    const filtered = pool
      .map((memory) => ({ memory, score: keywordScore(normalizedQuery, memory) }))
      .filter((entry) => entry.score > 0 || !normalizedQuery)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.memory);
    const title = type ? `${type.replace(/\b\w/g, (char) => char.toUpperCase())}s` : 'Memories';
    reply = formatMemoryList(title, filtered);
    results = filtered;
  } else {
    const pool = getAllNotes();
    results = pool
      .map((memory) => ({ memory, score: keywordScore(input, memory) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.memory);
    reply = results.length ? results.map((memory) => memory.text).join('\n') : "I don't know.";
  }

  return res.status(200).json({
    success: true,
    reply,
    contextUsed: results
  });
}

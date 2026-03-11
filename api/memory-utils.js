const CATEGORY_KEYS = {
  task: 'tasks',
  'lesson idea': 'lessonIdeas',
  'coaching idea': 'coachingIdeas',
  note: 'notes',
  question: 'questions',
  resource: 'resources',
};

const CATEGORY_LIST = Object.keys(CATEGORY_KEYS);

const KEYWORD_TAGS = [
  { regex: /\byear\s*7\b/i, tag: 'year7' },
  { regex: /\byear\s*8\b/i, tag: 'year8' },
  { regex: /\byear\s*9\b/i, tag: 'year9' },
  { regex: /\bfootball\b|\bdrill\b/i, tag: 'coaching' },
  { regex: /\blesson\b|\bclass\b|\bpompeii\b/i, tag: 'teaching' },
  { regex: /\btriathlon\b|\brun\b|\btraining\b/i, tag: 'training' },
  { regex: /\bdebate\b|\bcivics\b|\bfairness\b/i, tag: 'civics' },
  { regex: /\bresource\b|\blink\b|\bwebsite\b|\bbook\b/i, tag: 'resource' },
];

function normalizeType(type) {
  const value = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (CATEGORY_LIST.includes(value)) {
    return value;
  }
  return 'note';
}

function classifyMemoryType(inputText) {
  const text = String(inputText || '').trim().toLowerCase();
  if (!text) return 'note';

  if (text.endsWith('?') || /\b(what|why|how|when|where|should i|can i)\b/.test(text)) return 'question';
  if (/\b(link|resource|website|video|book|worksheet|podcast)\b/.test(text)) return 'resource';
  if (/\b(task|todo|to do|buy|remember to|need to|must|due)\b/.test(text)) return 'task';
  if (/\b(drill|football|footy|defender|coaching)\b/.test(text)) return 'coaching idea';
  if (/\b(lesson|class|year\s*\d+|hook|starter|activity|pompeii|debate)\b/.test(text)) return 'lesson idea';
  return 'note';
}

function extractTags(inputText) {
  const text = String(inputText || '').trim();
  if (!text) return [];

  const tags = KEYWORD_TAGS.filter(({ regex }) => regex.test(text)).map(({ tag }) => tag);
  return [...new Set(tags)];
}


function extractPerson(inputText) {
  const text = String(inputText || '').trim();
  if (!text) return undefined;

  const saidMatch = text.match(/^([A-Z][a-z]+)\s+said\b/);
  if (saidMatch) return saidMatch[1];

  const fromMatch = text.match(/\bfrom\s+([A-Z][a-z]+)\b/);
  if (fromMatch) return fromMatch[1];

  return undefined;
}

function cleanMemoryText(inputText) {
  return String(inputText || '')
    .replace(/^\s*(remember this|add a task|save this|note|idea|question|resource)\s*[:\-]?\s*/i, '')
    .trim();
}

function createStructuredMemory(inputText, forcedType) {
  const type = normalizeType(forcedType || classifyMemoryType(inputText));
  return {
    id: crypto.randomUUID(),
    type,
    text: cleanMemoryText(inputText) || String(inputText || '').trim(),
    person: extractPerson(inputText),
    tags: extractTags(inputText),
    createdAt: new Date().toISOString(),
  };
}

function categoryKeyForType(type) {
  return CATEGORY_KEYS[normalizeType(type)] || CATEGORY_KEYS.note;
}

module.exports = {
  categoryKeyForType,
  CATEGORY_KEYS,
  CATEGORY_LIST,
  classifyMemoryType,
  createStructuredMemory,
  extractTags,
  normalizeType,
};

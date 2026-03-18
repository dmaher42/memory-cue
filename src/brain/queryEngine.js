import { intentRouter } from '../services/intentRouter.js';
import { getMemories } from '../services/memoryService.js';
import { getReminderList } from '../reminders/reminderService.js';
import { loadAllNotes } from '../../js/modules/notes-storage.js';
import { generateEmbedding } from './embeddingService.js';
import { semanticSearch } from './semanticSearchService.js';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeReminderDate = (reminder) => {
  const dueAt = normalizeText(reminder?.dueAt);
  if (dueAt) {
    return dueAt;
  }
  const due = normalizeText(reminder?.due);
  return due;
};

const normalizeEmbedding = (value) => (
  Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : []
);

const cosineSimilarity = (left, right) => {
  const a = normalizeEmbedding(left);
  const b = normalizeEmbedding(right);
  if (!a.length || !b.length) {
    return -1;
  }

  const dimensions = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let index = 0; index < dimensions; index += 1) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }

  if (!magA || !magB) {
    return -1;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

export function detectIntent(query) {
  const text = normalizeText(query);
  const routedIntent = intentRouter(text, {
    source: 'query_engine',
    entryPoint: 'queryEngine.detectIntent',
  });

  if (routedIntent?.type === 'reminder') {
    return { type: 'reminder_query', source: 'intent_router' };
  }

  if (routedIntent?.type === 'query') {
    return { type: 'memory_query', source: 'intent_router' };
  }

  if (routedIntent?.type !== 'unknown') {
    return { type: 'mixed_query', source: 'intent_router' };
  }

  const q = text.toLowerCase();
  const hasReminderKeywords = q.includes('remind') || q.includes('today') || q.includes('due') || q.includes('reminder');
  const hasMemoryKeywords = q.includes('what did i') || q.includes('notes') || q.includes('write') || q.includes('ideas');

  if (hasReminderKeywords && hasMemoryKeywords) {
    return { type: 'mixed_query', source: 'heuristic_fallback' };
  }

  if (hasReminderKeywords) {
    return { type: 'reminder_query', source: 'heuristic_fallback' };
  }

  if (hasMemoryKeywords) {
    return { type: 'memory_query', source: 'heuristic_fallback' };
  }

  return { type: 'mixed_query', source: 'heuristic_fallback' };
}

function filterToday(reminders) {
  const today = new Date().toISOString().slice(0, 10);
  return reminders.filter((reminder) => normalizeReminderDate(reminder).startsWith(today));
}

function filterRemindersByQuery(reminders, query) {
  const normalized = normalizeText(query).toLowerCase();
  if (!normalized) {
    return reminders;
  }

  return reminders.filter((reminder) => {
    const haystack = [reminder?.title, reminder?.text, reminder?.notes]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

async function handleReminderQuery(intent, query) {
  let reminders = getReminderList();

  if (/\btoday\b/i.test(query)) {
    reminders = filterToday(reminders);
  }

  reminders = filterRemindersByQuery(reminders, query);
  const semanticMatches = (await searchSemanticEntries(query))
    .filter((entry) => entry.type === 'reminder');

  return {
    type: 'reminder_results',
    items: mergeResults(reminders, semanticMatches),
    intent,
  };
}

function searchMemories(memories, query) {
  const q = normalizeText(query).toLowerCase();
  if (!q) {
    return memories;
  }

  return memories.filter((memory) => {
    const text = typeof memory?.text === 'string' ? memory.text.toLowerCase() : '';
    return text.includes(q);
  });
}

function getSemanticSourceEntries() {
  const notes = loadAllNotes().map((note) => ({
    id: note?.id,
    type: 'note',
    title: note?.title || '',
    text: note?.bodyText || note?.body || '',
    embedding: note?.semanticEmbedding,
    source: 'note',
  }));

  const reminders = getReminderList().map((reminder) => ({
    id: reminder?.id,
    type: 'reminder',
    title: reminder?.title || reminder?.text || '',
    text: reminder?.notes || reminder?.text || reminder?.title || '',
    embedding: reminder?.semanticEmbedding,
    due: normalizeReminderDate(reminder),
    source: 'reminder',
  }));

  return [...notes, ...reminders];
}

async function searchSemanticEntries(query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const sourceEntries = getSemanticSourceEntries();
  if (!sourceEntries.length) {
    return [];
  }

  let queryEmbedding = [];
  try {
    queryEmbedding = normalizeEmbedding(await generateEmbedding(normalizedQuery));
  } catch (error) {
    console.warn('[queryEngine] Failed to generate query embedding', error);
    return [];
  }

  if (!queryEmbedding.length) {
    return [];
  }

  return sourceEntries
    .map((entry) => ({
      ...entry,
      score: cosineSimilarity(queryEmbedding, entry?.embedding),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > -1)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

async function handleMemoryQuery(intent, query) {
  console.log('[semantic] query:', query);

  const memories = getMemories();
  const keywordResults = searchMemories(memories, query);
  const [semanticResults, semanticEntries] = await Promise.all([
    semanticSearch(query),
    searchSemanticEntries(query),
  ]);
  console.log('[semantic] results:', semanticResults.length);

  const merged = mergeResults(keywordResults, [...semanticResults, ...semanticEntries]);

  return {
    type: 'memory_results',
    items: merged,
    intent,
  };
}

function mergeResults(keyword, semantic) {
  const map = new Map();

  keyword.forEach((item) => map.set(item.id, item));
  semantic.forEach((item) => map.set(item.id, item));

  return Array.from(map.values()).slice(0, 10);
}

async function handleMixedQuery(intent, query) {
  const [memories, reminders, semanticEntries] = await Promise.all([
    handleMemoryQuery({ type: 'memory_query' }, query),
    handleReminderQuery({ type: 'reminder_query' }, query),
    searchSemanticEntries(query),
  ]);

  return {
    type: 'mixed_results',
    memories: memories.items,
    reminders: mergeResults(reminders.items, semanticEntries.filter((entry) => entry.type === 'reminder')),
    intent,
  };
}

async function fallbackSearch(query) {
  return handleMixedQuery({ type: 'mixed_query' }, query);
}

export async function handleQuery(query) {
  console.log('[queryEngine] query:', query);
  const intent = detectIntent(query);
  console.log('[queryEngine] intent:', intent);

  switch (intent.type) {
    case 'reminder_query':
      return handleReminderQuery(intent, query);
    case 'memory_query':
      return handleMemoryQuery(intent, query);
    case 'mixed_query':
      return handleMixedQuery(intent, query);
    default:
      return fallbackSearch(query);
  }
}

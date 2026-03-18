import { intentRouter } from '../services/intentRouter.js';
import { getMemories } from '../services/memoryService.js';
import { getReminderList } from '../reminders/reminderService.js';
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

export function detectIntent(query) {
  const text = normalizeText(query);
  const routedIntent = intentRouter(text, {
    source: 'query_engine',
    entryPoint: 'queryEngine.detectIntent',
  });
  const q = text.toLowerCase();

  if (routedIntent?.type === 'reminder') {
    return { type: 'reminder_query' };
  }

  const hasReminderKeywords = q.includes('remind') || q.includes('today') || q.includes('due') || q.includes('reminder');
  const hasMemoryKeywords = q.includes('what did i') || q.includes('notes') || q.includes('write') || q.includes('ideas');

  if (hasReminderKeywords && hasMemoryKeywords) {
    return { type: 'mixed_query' };
  }

  if (hasReminderKeywords) {
    return { type: 'reminder_query' };
  }

  if (hasMemoryKeywords || routedIntent?.type === 'query') {
    return { type: 'memory_query' };
  }

  return { type: 'mixed_query' };
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

  return {
    type: 'reminder_results',
    items: reminders,
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

async function handleMemoryQuery(intent, query) {
  console.log('[semantic] query:', query);

  const memories = getMemories();
  const keywordResults = searchMemories(memories, query);
  const semanticResults = await semanticSearch(query);
  console.log('[semantic] results:', semanticResults.length);

  const merged = mergeResults(keywordResults, semanticResults);

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
  const [memories, reminders] = await Promise.all([
    handleMemoryQuery({ type: 'memory_query' }, query),
    handleReminderQuery({ type: 'reminder_query' }, query),
  ]);

  return {
    type: 'mixed_results',
    memories: memories.items,
    reminders: reminders.items,
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

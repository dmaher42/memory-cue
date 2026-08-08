import { addMessage } from './messageStore.js';
import { captureInput } from '../core/capturePipeline.js';
import { executeCommand } from '../core/commandEngine.js';
import { saveInboxEntry } from '../services/inboxService.js';
import { suggestNotebookAndTags } from '../services/taggingEngine.js';
import { classifyIntentLocally, createChatIntentInput, routeIntent } from '../services/intentRouter.js';
import { semanticSearch } from '../services/semanticSearchService.js';
import { ensureFolderExistsByName } from '../../js/modules/ai-capture-save.js';
import { saveNote } from '../services/adapters/notePersistenceAdapter.js';
import { generateDailyPlan, renderDailyPlan } from '../services/planningService.js';
import { buildMemoryAssistantRequest, requestAssistantChat } from '../services/assistantOrchestrator.js';
import { answerFromActiveLesson, looksLikeActiveLessonPrompt } from '../services/teacherModeService.js';
import { findRelatedMemories } from '../../js/modules/memory-search.js';

export const ENABLE_CHAT_INTERFACE = true;

const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const normalizeRelatedMemoryReferences = (memories = []) => {
  if (!Array.isArray(memories)) {
    return [];
  }

  const seenNoteIds = new Set();
  return memories.reduce((references, memory) => {
    if (references.length >= 3) {
      return references;
    }

    const noteId = typeof memory?.noteId === 'string' ? memory.noteId.trim() : '';
    if (!noteId || seenNoteIds.has(noteId)) {
      return references;
    }

    const title = typeof memory?.title === 'string' ? memory.title.trim() : '';
    const noteTitle = typeof memory?.noteTitle === 'string' ? memory.noteTitle.trim() : '';
    const preview = typeof memory?.preview === 'string' ? memory.preview.trim() : '';
    const storedLabel = typeof memory?.label === 'string' ? memory.label.trim() : '';
    const score = Number(memory?.score);
    if (!Number.isFinite(score) || score < 2) {
      return references;
    }
    const label = storedLabel || (
      title && noteTitle && title.toLowerCase() !== noteTitle.toLowerCase()
        ? `${title} (${noteTitle})`
        : title || noteTitle || 'Related note'
    );

    seenNoteIds.add(noteId);
    references.push({
      noteId,
      label,
      score,
      ...(preview ? { preview } : {}),
    });
    return references;
  }, []);
};

const QUERY_RESULT_TYPES = new Set(['memory_results', 'reminder_results', 'mixed_results']);
const MAX_QUERY_RESULT_TITLE_LENGTH = 80;

const normalizeQueryResultText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= MAX_QUERY_RESULT_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_QUERY_RESULT_TITLE_LENGTH - 1).trimEnd()}…`;
};

const normalizeQueryResultItem = (item, typeHint = '') => {
  const source = item && typeof item === 'object' ? item : {};
  const rawType = String(typeHint || source.type || source.source || '').trim().toLowerCase();
  const type = rawType === 'reminder'
    ? 'reminder'
    : rawType === 'note'
      ? 'note'
      : '';
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const title = [source.title, source.noteTitle, source.text]
    .map(normalizeQueryResultText)
    .find(Boolean) || '';
  if (!type || !id || !title) {
    return null;
  }

  const due = type === 'reminder'
    ? [source.due, source.dueAt, source.dueDate]
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim() || ''
    : '';

  return {
    id,
    type,
    title,
    ...(due ? { due } : {}),
  };
};

const normalizeQueryResultItems = (data) => {
  if (!data || typeof data !== 'object' || !QUERY_RESULT_TYPES.has(data.type)) {
    return [];
  }

  const candidates = data.type === 'mixed_results'
    ? [
      ...(Array.isArray(data.memories) ? data.memories.map((item) => ({ item, hint: '' })) : []),
      ...(Array.isArray(data.reminders) ? data.reminders.map((item) => ({ item, hint: 'reminder' })) : []),
    ]
    : (Array.isArray(data.items)
      ? data.items.map((item) => ({ item, hint: data.type === 'reminder_results' ? 'reminder' : '' }))
      : []);

  const seen = new Set();
  return candidates.reduce((items, candidate) => {
    if (items.length >= 8) {
      return items;
    }
    const normalized = normalizeQueryResultItem(candidate.item, candidate.hint);
    const key = normalized ? `${normalized.type}:${normalized.id}` : '';
    if (!normalized || seen.has(key)) {
      return items;
    }
    seen.add(key);
    items.push(normalized);
    return items;
  }, []);
};

const buildQueryResultSummary = (items) => {
  const results = Array.isArray(items) ? items : [];
  const noteCount = results.filter((item) => item.type === 'note').length;
  const reminderCount = results.filter((item) => item.type === 'reminder').length;
  if (!noteCount && !reminderCount) {
    return "I couldn't find any matching notes or reminders.";
  }

  const parts = [];
  if (noteCount) {
    parts.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
  }
  if (reminderCount) {
    parts.push(`${reminderCount} ${reminderCount === 1 ? 'reminder' : 'reminders'}`);
  }
  return `I found ${parts.join(' and ')}.`;
};

const createMessage = (role, content, quickActions = [], relatedMemories = [], resultItems = []) => {
  const relatedMemoryReferences = normalizeRelatedMemoryReferences(relatedMemories);
  const queryResultItems = Array.isArray(resultItems)
    ? resultItems.filter((item) => item && typeof item === 'object')
    : [];
  return {
    id: generateMessageId(),
    role,
    content,
    quickActions,
    timestamp: Date.now(),
    ...(relatedMemoryReferences.length ? { relatedMemories: relatedMemoryReferences } : {}),
    ...(queryResultItems.length ? { resultItems: queryResultItems } : {}),
  };
};

const normalizeRouteResult = (result) => {
  if (typeof result === 'string') {
    return {
      message: result,
      quickActions: [],
      status: null,
      resultItems: [],
      isQueryResult: false,
      decisionType: '',
      wordRescue: null,
    };
  }

  const isQueryResult = QUERY_RESULT_TYPES.has(result?.data?.type);
  const resultItems = normalizeQueryResultItems(result?.data);
  const suppliedMessage = typeof result?.message === 'string' ? result.message.trim() : '';
  return {
    message: suppliedMessage || (isQueryResult ? buildQueryResultSummary(resultItems) : ''),
    quickActions: Array.isArray(result?.quickActions) ? result.quickActions : [],
    status: result?.status && typeof result.status === 'object' ? result.status : null,
    resultItems,
    isQueryResult,
    decisionType: typeof result?.decision?.decisionType === 'string'
      ? result.decision.decisionType
      : '',
    wordRescue: result?.wordRescue && typeof result.wordRescue === 'object'
      ? result.wordRescue
      : result?.data?.wordRescue && typeof result.data.wordRescue === 'object'
        ? result.data.wordRescue
        : null,
  };
};

const normalizeParsedEntry = (parsed, text = '') => {
  const payload = parsed && typeof parsed === 'object' ? parsed : {};
  const normalizedType = typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : '';
  const fallbackType = typeof text === 'string' && text.trim().endsWith('?') ? 'question' : 'unknown';

  return {
    type: normalizedType || fallbackType,
    title: typeof payload.title === 'string' ? payload.title.trim() : '',
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : '')).filter(Boolean)
      : [],
    reminderDate:
      typeof payload.reminderDate === 'string' && payload.reminderDate.trim()
        ? payload.reminderDate.trim()
        : null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
};

const parseEntry = async (text) => {
  const response = await fetch('/api/parse-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to parse entry (${response.status})`);
  }

  const parsed = await response.json();
  return normalizeParsedEntry(parsed, text);
};

const askAssistant = async (text, uid) => {
  const MAX_MEMORY_SNIPPETS = 5;
  const safeQuestion = typeof text === 'string' ? text.trim() : '';
  let memorySnippets = [];
  try {
    const memories = await semanticSearch(safeQuestion, uid);
    memorySnippets = memories
      .slice(0, MAX_MEMORY_SNIPPETS)
      .map((memory) => memory?.text)
      .filter(Boolean);
  } catch (error) {
    console.warn('[chat-manager] failed to retrieve relevant memories for assistant context', error);
  }

  const requestBody = buildMemoryAssistantRequest(safeQuestion, memorySnippets);
  return requestAssistantChat(requestBody, { fallbackReply: 'Here is what I found.' });
};

const OFFLINE_REMINDERS_KEY = 'memoryCue:offlineReminders';
const MAX_REMINDER_MATCHES = 5;
const REMINDER_QUERY_PREFIXES = ['what', 'show', 'find', 'list'];

const REMINDER_QUERY_STOP_WORDS = new Set([
  'what',
  'do',
  'did',
  'i',
  'have',
  'my',
  'was',
  'were',
  'the',
  'a',
  'an',
  'that',
  'this',
  'these',
  'those',
  'reminder',
  'reminders',
  'write',
  'wrote',
  'save',
  'saved',
  'lesson',
  'lessons',
  'idea',
  'ideas',
  'drill',
  'drills',
  'coaching',
]);

const normalizeReminderQuery = (text) => (typeof text === 'string' ? text.trim().toLowerCase() : '');

const shouldSearchReminders = (text) => {
  const normalized = normalizeReminderQuery(text);
  if (!normalized) {
    return false;
  }

  const startsWithRecallPrefix = REMINDER_QUERY_PREFIXES
    .some((prefix) => normalized.startsWith(`${prefix} `));

  if (!startsWithRecallPrefix) {
    return false;
  }

  return /\b(reminder|reminders|meeting|meetings|shopping|list|idea|ideas|lesson|lessons|drill|drills|coaching|today|tonight|tomorrow)\b/.test(normalized);
};

const readStoredReminders = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(OFFLINE_REMINDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Unable to read reminders from local storage.', error);
    return [];
  }
};

const extractReminderQueryTerms = (text) => {
  const normalized = normalizeReminderQuery(text).replace(/[^a-z0-9\s]/g, ' ');
  return normalized
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !REMINDER_QUERY_STOP_WORDS.has(term));
};

const isDueToday = (reminder) => {
  const due = typeof reminder?.due === 'string' ? reminder.due.trim() : '';
  if (!due) {
    return false;
  }

  const dueDate = new Date(due);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const now = new Date();
  return dueDate.getFullYear() === now.getFullYear()
    && dueDate.getMonth() === now.getMonth()
    && dueDate.getDate() === now.getDate();
};

const buildReminderSearchResponse = (queryText) => {
  if (!shouldSearchReminders(queryText)) {
    return null;
  }

  const reminders = readStoredReminders();
  if (!reminders.length) {
    return 'You have no reminders saved yet.';
  }

  const queryTerms = extractReminderQueryTerms(queryText);
  const includesToday = /\btoday\b/.test(normalizeReminderQuery(queryText));

  const matches = reminders
    .filter((reminder) => !reminder?.done)
    .map((reminder) => {
      const reminderKeywords = Array.isArray(reminder?.keywords)
        ? reminder.keywords
        : Array.isArray(reminder?.metadata?.keywords)
          ? reminder.metadata.keywords
          : [];
      const reminderText = `${reminder?.title || ''} ${reminder?.notes || ''} ${reminderKeywords.join(' ')}`.toLowerCase();
      const termScore = queryTerms.reduce((score, term) => score + (reminderText.includes(term) ? 1 : 0), 0);
      const todayScore = includesToday && isDueToday(reminder) ? 2 : 0;
      return { reminder, score: termScore + todayScore };
    })
    .filter(({ score }) => (queryTerms.length ? score > 0 : score >= 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_REMINDER_MATCHES)
    .map(({ reminder }) => {
      const title = typeof reminder?.title === 'string' ? reminder.title.trim() : '';
      return title || 'Untitled reminder';
    });

  if (!matches.length) {
    return 'I could not find any matching reminders.';
  }

  return `You wrote these reminders\n\n${matches.map((item) => `• ${item}`).join('\n')}`;
};

const getReminderScheduleLabel = (parsed, text) => {
  const dueValue =
    (typeof parsed?.reminderDate === 'string' && parsed.reminderDate.trim())
    || (typeof parsed?.metadata?.due === 'string' && parsed.metadata.due.trim())
    || (typeof parsed?.metadata?.dueAt === 'string' && parsed.metadata.dueAt.trim())
    || null;

  if (dueValue) {
    return dueValue;
  }

  const normalizedText = typeof text === 'string' ? text.toLowerCase() : '';
  if (normalizedText.includes('tomorrow')) {
    return 'tomorrow';
  }
  if (normalizedText.includes('today')) {
    return 'today';
  }

  return null;
};

const createNotebookNote = async (parsed, text) => {
  const title = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  const notebookSuggestion = await suggestNotebookAndTags(text);
  const folderName = notebookSuggestion?.notebook && notebookSuggestion.notebook !== 'Inbox'
    ? notebookSuggestion.notebook
    : null;
  const folderId = folderName ? ensureFolderExistsByName(folderName) : null;

  const note = saveNote({
    text,
    title,
    tags: Array.isArray(notebookSuggestion?.tags)
      ? notebookSuggestion.tags
      : Array.isArray(parsed?.tags)
        ? parsed.tags
        : [],
    folderId,
    source: 'chat',
    parsedType: 'note',
  });
  return { note, notebookName: folderName || 'Unsorted' };
};

const processParsedEntry = async (parsed, text, dependencies = {}) => {
  const intentInput = createChatIntentInput(parsed, text, { channel: 'assistant_chat' });
  const decision = routeIntent(intentInput.parsedEntry, intentInput.rawText, intentInput.hints);
  const parsedType = typeof decision?.parsedType === 'string' && decision.parsedType
    ? decision.parsedType
    : 'unknown';

  if (decision.decisionType === 'persist_reminder') {
    await executeCommand('reminder', {
      text: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text,
      keywords: Array.isArray(parsed?.metadata?.keywords) ? parsed.metadata.keywords : [],
      metadata: parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : null,
      handler: dependencies.createReminder,
    });
    const scheduleLabel = getReminderScheduleLabel(parsed, text);
    const title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text;
    const message = scheduleLabel
      ? `Reminder created for ${scheduleLabel}: ${title}`
      : `Reminder created: ${title}`;
    return { message };
  }

  if (decision.decisionType === 'persist_note') {
    const { notebookName } = await createNotebookNote(parsed, text);
    return { message: `Saved to notebook (${notebookName}).` };
  }

  if (decision.decisionType === 'plan_day') {
    const plan = await generateDailyPlan(dependencies.uid);
    return { message: renderDailyPlan(plan) };
  }

  // Canonical intent decision types: query_memory, plan_day, persist_reminder, persist_note, persist_inbox.
  if (decision.decisionType === 'query_memory') {
    const reminderSearchResponse = buildReminderSearchResponse(text);
    if (reminderSearchResponse) {
      return { message: reminderSearchResponse };
    }

    return { message: await askAssistant(text, dependencies.uid) };
  }

  saveInboxEntry({
    text,
    source: 'assistant',
    parsedType,
    tags: Array.isArray(parsed?.tags) ? parsed.tags : [],
    metadata: parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {},
  });
  return { message: 'Saved for later review.' };
};

export const handleChatMessage = async (text, dependencies = {}) => {
  const message = typeof text === 'string' ? text.trim() : '';
  if (!message) {
    return { message: '', quickActions: [], status: null };
  }

  addMessage(createMessage('user', message));

  const isExplicitWordRescue = dependencies?.assistantTask === 'word_rescue'
    || dependencies?.assistantMode === 'fast'
    || dependencies?.assistantMode === 'coach';
  const localWordRescueDecision = isExplicitWordRescue
    ? null
    : classifyIntentLocally(message, { source: 'chat', entryPoint: 'chat.handleChatMessage' });
  const isWordRescue = isExplicitWordRescue
    || (
      localWordRescueDecision?.decisionType === 'assistant_query'
      && localWordRescueDecision?.assistantTask === 'word_rescue'
    );

  if (!isWordRescue && looksLikeActiveLessonPrompt(message)) {
    const lessonReply = await answerFromActiveLesson(message);
    if (typeof lessonReply === 'string' && lessonReply.trim()) {
      const lessonResponse = { message: lessonReply.trim(), quickActions: [], status: null };
      addMessage(createMessage('assistant', lessonResponse.message, lessonResponse.quickActions));
      return lessonResponse;
    }
  }

  const routeResult = await captureInput({
    text: message,
    source: 'chat',
    metadata: {
      entryPoint: dependencies?.assistantTask === 'word_rescue' || dependencies?.assistantMode
        ? 'chat.handleChatMessage.wordRescue'
        : 'chat.handleChatMessage',
      uid: dependencies?.uid,
      assistantTask: dependencies?.assistantTask,
      assistantMode: dependencies?.assistantMode,
    },
  });

  const response = normalizeRouteResult(routeResult);
  
  // Keep note IDs beside the readable fallback text so the UI can open exact matches.
  if (!response.isQueryResult && response.decisionType !== 'assistant_query') {
    try {
      const related = findRelatedMemories(message);
      const relatedMemories = normalizeRelatedMemoryReferences(related);
      if (relatedMemories.length > 0) {
        response.relatedMemories = relatedMemories;
        const relatedList = relatedMemories.map((item) => `- ${item.label}`).join('\n');
        response.message += `\n\nRelated from your memory:\n${relatedList}`;
      }
    } catch (error) {
      console.warn('[chat-manager] Failed to fetch related memories', error);
    }
  }

  addMessage(createMessage(
    'assistant',
    response.message,
    response.quickActions,
    response.relatedMemories,
    response.resultItems,
  ));
  return response;
};

export const handleMessage = handleChatMessage;

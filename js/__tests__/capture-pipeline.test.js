/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCapturePipeline(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/core/capturePipeline.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { analyzeCaptureInput, captureInput };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Map,
    Math,
    RegExp,
    Promise,
    JSON,
    Boolean,
    saveMemory: overrides.saveMemory || (async (payload) => payload),
    createAndSaveNote: overrides.createAndSaveNote || (async (payload) => ({ id: 'note-1', ...payload })),
    createReminder: overrides.createReminder || (async (payload) => payload),
    semanticSearch: overrides.semanticSearch || (async () => []),
    handleQuery: overrides.handleQuery || (async () => ({})),
    saveInboxEntry: overrides.saveInboxEntry || (async (payload) => payload),
    buildMemoryAssistantRequest: overrides.buildMemoryAssistantRequest || (() => ({})),
    buildClassThoughtAssistantRequest: overrides.buildClassThoughtAssistantRequest || ((message, options = {}) => ({
      assistantTask: 'organise_class_thought',
      message,
      classHubName: options.classHubName || '',
    })),
    buildWordRescueAssistantRequest: overrides.buildWordRescueAssistantRequest || ((message, options = {}) => ({
      assistantTask: 'word_rescue',
      mode: options.mode || 'fast',
      message,
    })),
    requestAssistantChat: overrides.requestAssistantChat || (async () => ''),
    requestAssistantChatResult: overrides.requestAssistantChatResult || (async () => ({ reply: '' })),
    resolveShorthandText: overrides.resolveShorthandText || ((value) => value),
    getUnknownShorthandToken: overrides.getUnknownShorthandToken || (() => null),
    rememberShorthand: overrides.rememberShorthand || (() => null),
    intentRouter: overrides.intentRouter || (() => ({
      payload: {
        decisionType: 'persist_inbox',
        parsedType: 'unknown',
        parsedEntry: { type: 'unknown', title: '' },
      },
    })),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2024, 4, 15, 9, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

test('capture pipeline parses weekday time ranges and cleans reminder titles', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
  });

  const result = await captureInput({
    text: '! Archer Basketball Sunday 330-530',
    source: 'capture',
  });

  expect(result.message).toBe('Reminder created.');
  expect(createdReminders).toHaveLength(1);

  const expected = new Date();
  expected.setDate(expected.getDate() + 4);
  expected.setHours(15, 30, 0, 0);

  expect(createdReminders[0].text).toBe('Archer Basketball');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline expands known shorthand into a dated reminder', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
    resolveShorthandText: (value) => String(value || '')
      .replace(/\bCC\b/g, 'Classroom conversation with')
      .replace(/\bNR8\b/g, 'Year 8 Noria'),
  });

  const result = await captureInput({
    text: 'next wednesday CC NR8 8:30',
    source: 'capture',
  });

  const expected = new Date();
  expected.setDate(expected.getDate() + 7);
  expected.setHours(8, 30, 0, 0);

  expect(result.message).toBe('Reminder created.');
  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].text).toBe('Classroom conversation with Year 8 Noria');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline asks about unknown shorthand then remembers the answer', async () => {
  const learned = {};
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
    resolveShorthandText: (value) => String(value || '')
      .replace(/\bCC\b/g, 'Classroom conversation with')
      .replace(/\bY8N\b/g, learned.Y8N || 'Y8N'),
    getUnknownShorthandToken: (value) => (/\bY8N\b/.test(String(value || '')) ? 'Y8N' : null),
    rememberShorthand: (phrase, expansion) => {
      learned[phrase] = expansion;
      return { phrase, expansion };
    },
  });

  const clarification = await captureInput({
    text: 'next wednesday CC Y8N 8:30',
    source: 'capture',
  });

  expect(clarification.message).toBe('What does Y8N mean?');
  expect(createdReminders).toHaveLength(0);

  const result = await captureInput({
    text: 'Year 8 Noria',
    source: 'capture',
  });

  const expected = new Date();
  expected.setDate(expected.getDate() + 7);
  expected.setHours(8, 30, 0, 0);

  expect(learned.Y8N).toBe('Year 8 Noria');
  expect(result.message).toBe('Got it - I will remember Y8N means "Year 8 Noria". Reminder created.');
  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].text).toBe('Classroom conversation with Year 8 Noria');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline expands learned shorthand before running a memory query', async () => {
  const queries = [];
  const { captureInput } = loadCapturePipeline({
    resolveShorthandText: (value) => String(value || '').replace(/\bPDP\b/gi, 'Professional development plan'),
    intentRouter: (text) => ({
      payload: {
        decisionType: 'query_memory',
        parsedType: 'question',
        parsedEntry: { type: 'question', title: text },
      },
    }),
    handleQuery: async (query) => {
      queries.push(query);
      return { type: 'reminder_results', items: [] };
    },
  });

  await captureInput({
    text: 'when is m pdp',
    source: 'chat',
  });

  expect(queries).toEqual(['when is m Professional development plan']);
});

test('capture pipeline saves an unclassified capture as a visible note, not the invisible inbox', async () => {
  const savedNotes = [];
  const savedInbox = [];
  const { captureInput } = loadCapturePipeline({
    createAndSaveNote: async (payload = {}) => { savedNotes.push(payload); return { id: 'note-1', ...payload }; },
    saveInboxEntry: async (payload = {}) => { savedInbox.push(payload); return payload; },
    // default intentRouter (above) routes ambiguous text to persist_inbox
  });

  const result = await captureInput({
    text: 'some vague thought with no clear intent at all here',
    source: 'chat',
  });

  // It must become a real note (visible in the Notes screen), not an inbox/memory entry.
  expect(result.message).toBe('Saved note.');
  expect(savedInbox).toHaveLength(0);
  expect(savedNotes).toHaveLength(1);
  expect(savedNotes[0].parsedType).toBe('note');
});

test('capture pipeline does not read a four-digit year as a time', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
  });

  const result = await captureInput({
    text: '! Dentist on 5 March 2026',
    source: 'capture',
  });

  // No explicit time given, so it should default to 09:00 rather than 20:26 (from "2026").
  const expected = new Date();
  expected.setFullYear(2026, 2, 5);
  expected.setHours(9, 0, 0, 0);

  expect(result.message).toBe('Reminder created.');
  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline keeps an explicit time alongside a four-digit year', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
  });

  await captureInput({
    text: '! Dentist on 5 March 2026 at 1430',
    source: 'capture',
  });

  const expected = new Date();
  expected.setFullYear(2026, 2, 5);
  expected.setHours(14, 30, 0, 0);

  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('explicit Word Rescue mode calls the assistant without reading or writing saved memories', async () => {
  const createAndSaveNote = jest.fn();
  const createReminder = jest.fn();
  const handleQuery = jest.fn();
  const semanticSearch = jest.fn();
  const requestAssistantChatResult = jest.fn(async () => ({
    reply: 'Hint 1 of 3: It means avoiding a direct commitment.',
    wordRescue: {
      mode: 'coach',
      hints: ['Meaning clue', 'Context clue', 'Letter clue'],
      answer: { word: 'equivocate', explanation: 'Avoid committing clearly.', example: '' },
      alternatives: ['prevaricate'],
    },
  }));
  const { captureInput } = loadCapturePipeline({
    createAndSaveNote,
    createReminder,
    handleQuery,
    semanticSearch,
    requestAssistantChatResult,
    intentRouter: (text, hints = {}) => ({
      payload: {
        decisionType: 'assistant_query',
        parsedType: 'word_rescue',
        parsedEntry: { type: 'word_rescue', title: text },
        assistantTask: 'word_rescue',
        mode: hints.assistantMode,
      },
    }),
  });

  const result = await captureInput({
    text: 'someone who avoids giving a direct answer',
    source: 'chat',
    metadata: {
      entryPoint: 'chat.handleChatMessage.wordRescue',
      assistantTask: 'word_rescue',
      assistantMode: 'coach',
    },
  });

  expect(result.decision.decisionType).toBe('assistant_query');
  expect(result.message).toContain('Hint 1 of 3');
  expect(result.wordRescue.answer.word).toBe('equivocate');
  expect(requestAssistantChatResult).toHaveBeenCalledWith({
    assistantTask: 'word_rescue',
    mode: 'coach',
    message: 'someone who avoids giving a direct answer',
  }, expect.any(Object));
  expect(semanticSearch).not.toHaveBeenCalled();
  expect(handleQuery).not.toHaveBeenCalled();
  expect(createAndSaveNote).not.toHaveBeenCalled();
  expect(createReminder).not.toHaveBeenCalled();
});

test('explicit class thought organisation returns a review draft without reading or writing saved memories', async () => {
  const createAndSaveNote = jest.fn();
  const createReminder = jest.fn();
  const handleQuery = jest.fn();
  const semanticSearch = jest.fn();
  const resolveShorthandText = jest.fn(() => 'This should not replace the class thought.');
  const classThoughtDraft = {
    note: {
      title: 'Outdoor lesson follow-up',
      body: 'Two students left during the outdoor lesson.',
      tags: ['behaviour'],
    },
    followUps: [{ text: 'Speak to the two students next lesson' }],
  };
  const requestAssistantChatResult = jest.fn(async () => ({
    reply: 'Draft ready. Review it before saving.',
    classThoughtDraft,
  }));
  const { captureInput } = loadCapturePipeline({
    createAndSaveNote,
    createReminder,
    handleQuery,
    semanticSearch,
    resolveShorthandText,
    requestAssistantChatResult,
    intentRouter: (text, hints = {}) => ({
      payload: {
        decisionType: 'assistant_query',
        parsedType: 'class_thought',
        parsedEntry: { type: 'class_thought', title: text },
        assistantTask: hints.assistantTask,
        mode: null,
      },
    }),
  });

  const result = await captureInput({
    text: 'Two students left during the outdoor lesson.\nI need to speak to them next lesson.',
    source: 'class_hub',
    metadata: {
      entryPoint: 'class-hub.organise-thought',
      assistantTask: 'organise_class_thought',
      classHubName: 'Year 8 HPE',
    },
  });

  expect(result.decision.decisionType).toBe('assistant_query');
  expect(result.message).toBe('Draft ready. Review it before saving.');
  expect(result.classThoughtDraft).toEqual(classThoughtDraft);
  expect(requestAssistantChatResult).toHaveBeenCalledWith({
    assistantTask: 'organise_class_thought',
    message: 'Two students left during the outdoor lesson.\nI need to speak to them next lesson.',
    classHubName: 'Year 8 HPE',
  }, expect.any(Object));
  expect(semanticSearch).not.toHaveBeenCalled();
  expect(handleQuery).not.toHaveBeenCalled();
  expect(createAndSaveNote).not.toHaveBeenCalled();
  expect(createReminder).not.toHaveBeenCalled();
  expect(resolveShorthandText).not.toHaveBeenCalled();
});

test('natural fast Word Rescue decisions preserve task and mode through execution', async () => {
  const requestAssistantChatResult = jest.fn(async () => ({
    reply: '1. meticulous - very careful and precise',
    wordRescue: { mode: 'fast', candidates: [] },
  }));
  const { captureInput } = loadCapturePipeline({
    requestAssistantChatResult,
    intentRouter: (text) => ({
      payload: {
        decisionType: 'assistant_query',
        parsedType: 'word_rescue',
        parsedEntry: { type: 'word_rescue', title: text },
        assistantTask: 'word_rescue',
        mode: 'fast',
      },
    }),
  });

  const result = await captureInput({
    text: 'another word for very careful',
    source: 'chat',
  });

  expect(result.message).toContain('meticulous');
  expect(requestAssistantChatResult).toHaveBeenCalledWith(expect.objectContaining({
    assistantTask: 'word_rescue',
    mode: 'fast',
  }), expect.any(Object));
});

test('general assistant questions still work when personal-memory lookup is unavailable', async () => {
  const requestAssistantChat = jest.fn(async () => 'Spaced retrieval revisits information over increasing intervals.');
  const { captureInput } = loadCapturePipeline({
    semanticSearch: async () => { throw new Error('offline'); },
    requestAssistantChat,
    buildMemoryAssistantRequest: (question, snippets) => ({ question, snippets }),
    intentRouter: (text) => ({
      payload: {
        decisionType: 'assistant_query',
        parsedType: 'question',
        parsedEntry: { type: 'question', title: text },
        assistantTask: 'general',
        mode: null,
      },
    }),
  });

  const result = await captureInput({
    text: 'What is spaced retrieval practice?',
    source: 'chat',
  });

  expect(result.message).toContain('increasing intervals');
  expect(requestAssistantChat).toHaveBeenCalledWith({
    question: 'What is spaced retrieval practice?',
    snippets: [],
  }, expect.any(Object));
});

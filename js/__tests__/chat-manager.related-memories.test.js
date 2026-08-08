/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadChatManager(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/chat/chatManager.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { handleChatMessage };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Math,
    Set,
    crypto: { randomUUID: () => `message-${Math.random()}` },
    addMessage: overrides.addMessage || (() => null),
    captureInput: overrides.captureInput || (async () => ({ message: 'Saved for later review.' })),
    executeCommand: async () => ({}),
    saveInboxEntry: () => ({}),
    suggestNotebookAndTags: async () => ({}),
    classifyIntentLocally: overrides.classifyIntentLocally || (() => ({})),
    createChatIntentInput: () => ({}),
    routeIntent: () => ({}),
    semanticSearch: async () => [],
    ensureFolderExistsByName: () => '',
    saveNote: () => ({}),
    generateDailyPlan: async () => ({}),
    renderDailyPlan: () => '',
    buildMemoryAssistantRequest: () => ({}),
    requestAssistantChat: async () => '',
    answerFromActiveLesson: overrides.answerFromActiveLesson || (async () => ''),
    looksLikeActiveLessonPrompt: overrides.looksLikeActiveLessonPrompt || (() => false),
    findRelatedMemories: overrides.findRelatedMemories || (() => []),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('stores exact related-note references with the assistant message', async () => {
  const savedMessages = [];
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    captureInput: async () => ({ message: 'Reminder created.', quickActions: [] }),
    findRelatedMemories: () => [
      {
        noteId: 'curriculum-map',
        title: 'Curriculum map',
        noteTitle: 'Curriculum map',
        preview: 'Sequence and achievement standards.',
        score: 3,
      },
      {
        noteId: 'lesson-notes',
        title: 'Assessment ideas',
        noteTitle: 'Prior lesson notes',
        preview: 'Exit ticket and source analysis prompts.',
        score: 2,
      },
      {
        noteId: 'lesson-notes',
        title: 'Duplicate section',
        noteTitle: 'Prior lesson notes',
        score: 1,
      },
    ],
  });

  const response = await handleChatMessage('Prepare the lesson sequence');
  const assistantMessage = savedMessages[1];

  expect(savedMessages).toHaveLength(2);
  expect(response.relatedMemories).toEqual([
    {
      noteId: 'curriculum-map',
      label: 'Curriculum map',
      score: 3,
      preview: 'Sequence and achievement standards.',
    },
    {
      noteId: 'lesson-notes',
      label: 'Assessment ideas (Prior lesson notes)',
      score: 2,
      preview: 'Exit ticket and source analysis prompts.',
    },
  ]);
  expect(assistantMessage.relatedMemories).toEqual(response.relatedMemories);
  expect(assistantMessage.content).toContain([
    'Related from your memory:',
    '- Curriculum map',
    '- Assessment ideas (Prior lesson notes)',
  ].join('\n'));
});

test('turns note and reminder query data into a readable message with tappable result references', async () => {
  const savedMessages = [];
  const findRelatedMemories = jest.fn(() => []);
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    findRelatedMemories,
    captureInput: async () => ({
      message: '',
      data: {
        type: 'mixed_results',
        memories: [
          { id: 'note-1', type: 'note', title: 'Excursion checklist', text: 'Forms and medical details.' },
        ],
        reminders: [
          { id: 'reminder-1', type: 'reminder', title: 'Return excursion forms', due: '2026-08-04T09:00:00.000Z' },
        ],
      },
    }),
  });

  const response = await handleChatMessage('What notes and reminders mention the excursion?');
  const assistantMessage = savedMessages[1];

  expect(response.message).toBe('I found 1 note and 1 reminder.');
  expect(response.resultItems).toEqual([
    { id: 'note-1', type: 'note', title: 'Excursion checklist' },
    {
      id: 'reminder-1',
      type: 'reminder',
      title: 'Return excursion forms',
      due: '2026-08-04T09:00:00.000Z',
    },
  ]);
  expect(assistantMessage.resultItems).toEqual(response.resultItems);
  expect(findRelatedMemories).not.toHaveBeenCalled();
});

test('drops blank markup-only query results and shortens raw note bodies used as titles', async () => {
  const savedMessages = [];
  const longBody = 'This is a long pre-game note about supporting teammates, showing bravery, staying connected, and playing your role for the whole match.';
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    captureInput: async () => ({
      message: '',
      data: {
        type: 'memory_results',
        items: [
          { id: 'blank-note', type: 'note', text: '<br>' },
          { id: 'long-note', type: 'note', text: longBody },
        ],
      },
    }),
  });

  const response = await handleChatMessage('What did I write about pre-game?');

  expect(response.message).toBe('I found 1 note.');
  expect(response.resultItems).toHaveLength(1);
  expect(response.resultItems[0]).toEqual(expect.objectContaining({ id: 'long-note', type: 'note' }));
  expect(response.resultItems[0].title).not.toContain('<br>');
  expect(response.resultItems[0].title.length).toBeLessThanOrEqual(80);
  expect(response.resultItems[0].title.endsWith('…')).toBe(true);
  expect(savedMessages[1].resultItems).toEqual(response.resultItems);
});

test('passes Word Rescue mode through the canonical capture path without adding related notes', async () => {
  const savedMessages = [];
  const captureInput = jest.fn(async () => ({
    decision: { decisionType: 'assistant_query' },
    message: '1. meticulous - very careful and precise',
    wordRescue: { mode: 'fast', candidates: [] },
  }));
  const findRelatedMemories = jest.fn(() => [{ noteId: 'private-note', title: 'Private note', score: 3 }]);
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    captureInput,
    findRelatedMemories,
  });

  const response = await handleChatMessage('a stronger word for careful', {
    assistantTask: 'word_rescue',
    assistantMode: 'fast',
  });

  expect(captureInput).toHaveBeenCalledWith({
    text: 'a stronger word for careful',
    source: 'chat',
    metadata: {
      entryPoint: 'chat.handleChatMessage.wordRescue',
      uid: undefined,
      assistantTask: 'word_rescue',
      assistantMode: 'fast',
    },
  });
  expect(response.wordRescue).toEqual({ mode: 'fast', candidates: [] });
  expect(findRelatedMemories).not.toHaveBeenCalled();
  expect(savedMessages).toHaveLength(2);
  expect(savedMessages[1].content).not.toContain('Related from your memory');
});

test('explicit Word Rescue bypasses active-lesson question handling', async () => {
  const captureInput = jest.fn(async () => ({
    decision: { decisionType: 'assistant_query' },
    message: '1. eloquent - fluent and persuasive in expression',
    wordRescue: { mode: 'fast', candidates: [] },
  }));
  const answerFromActiveLesson = jest.fn(async () => 'Active lesson answer');
  const { handleChatMessage } = loadChatManager({
    captureInput,
    answerFromActiveLesson,
    looksLikeActiveLessonPrompt: () => true,
  });

  const response = await handleChatMessage('a word for a persuasive sentence', {
    assistantTask: 'word_rescue',
    assistantMode: 'fast',
  });

  expect(response.message).toContain('eloquent');
  expect(answerFromActiveLesson).not.toHaveBeenCalled();
  expect(captureInput).toHaveBeenCalledTimes(1);
});

test('naturally detected Word Rescue also bypasses active-lesson handling', async () => {
  const captureInput = jest.fn(async () => ({
    decision: { decisionType: 'assistant_query' },
    message: '1. phrasing - the way something is expressed',
    wordRescue: { mode: 'fast', candidates: [] },
  }));
  const answerFromActiveLesson = jest.fn(async () => 'Active lesson answer');
  const { handleChatMessage } = loadChatManager({
    captureInput,
    answerFromActiveLesson,
    looksLikeActiveLessonPrompt: () => true,
    classifyIntentLocally: () => ({
      decisionType: 'assistant_query',
      assistantTask: 'word_rescue',
      mode: 'fast',
    }),
  });

  const response = await handleChatMessage('I need another word for this sentence');

  expect(response.message).toContain('phrasing');
  expect(answerFromActiveLesson).not.toHaveBeenCalled();
  expect(captureInput).toHaveBeenCalledTimes(1);
});
